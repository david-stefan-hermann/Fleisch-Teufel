import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pushSubscriptions } from '../src/db/schema.js';
import { knownPushEndpoint } from '../src/routes/push.js';
import {
  dueSubscriptions,
  GIVE_UP_MS,
  localClock,
  REMINDER_PAYLOAD,
  sendReminders,
  type PushSender,
  type PushTarget,
} from '../src/push.js';
import { createTestContext, registeredClient, TestClient, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let alice: TestClient;
let bob: TestClient;
const sent: { target: PushTarget; payload: string }[] = [];
/** What the fake push service answers per endpoint (default ok). */
const outcomes = new Map<string, 'ok' | 'gone' | 'error'>();
const sender: PushSender = {
  publicKey: 'test-public-key',
  async send(target, payload) {
    sent.push({ target, payload });
    return outcomes.get(target.endpoint) ?? 'ok';
  },
};

beforeAll(async () => {
  ctx = await createTestContext({ push: sender, env: { ALLOW_REGISTRATION: 'true' } });
  alice = await registeredClient(ctx, 'push-alice@example.com');
  bob = await registeredClient(ctx, 'push-bob@example.com');
});
afterAll(() => ctx.close());

const sub = (endpoint: string, remindAt = '20:00', tz = 'Europe/Berlin') => ({
  endpoint: `https://web.push.apple.com/${endpoint}`,
  keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
  remindAt,
  tz,
});
/** 2026-10-24 19:30 in Berlin (CEST, UTC+2). */
const at = (hhmm: string, date = '2026-10-24') => new Date(`${date}T${hhmm}:00+02:00`);

describe('local clock', () => {
  it('reads date and minutes in the subscription time zone', () => {
    const berlin = localClock(new Date('2026-10-24T22:30:00Z'), 'Europe/Berlin');
    expect(berlin).toEqual({ date: '2026-10-25', minutes: 30 });
    expect(localClock(new Date('2026-10-24T22:30:00Z'), 'America/New_York')).toEqual({
      date: '2026-10-24',
      minutes: 18 * 60 + 30,
    });
  });

  it('finds the subscriptions whose time has come and that were not handled today', () => {
    const rows = [
      { endpoint: 'a', remindAt: '20:00', tz: 'Europe/Berlin', lastSentOn: null },
      { endpoint: 'b', remindAt: '21:00', tz: 'Europe/Berlin', lastSentOn: null },
      { endpoint: 'c', remindAt: '20:00', tz: 'Europe/Berlin', lastSentOn: '2026-10-24' },
      { endpoint: 'd', remindAt: '20:00', tz: 'Europe/Berlin', lastSentOn: '2026-10-23' },
      { endpoint: 'e', remindAt: '20:00', tz: 'Not/AZone', lastSentOn: null },
      { endpoint: 'f', remindAt: '9:00', tz: 'Europe/Berlin', lastSentOn: null },
    ];
    expect(dueSubscriptions(rows, at('20:30')).map((r) => r.endpoint)).toEqual(['a', 'd']);
    expect(dueSubscriptions(rows, at('20:30'))[0]!.localDate).toBe('2026-10-24');
    expect(dueSubscriptions(rows, at('19:59'))).toEqual([]);
  });
});

describe('subscription routes', () => {
  it('tells the browser the public key, stores and updates a subscription per endpoint', async () => {
    const cfg = await alice.req('GET', '/api/push/config');
    expect(cfg.json).toEqual({ enabled: true, publicKey: 'test-public-key' });
    expect((await alice.req('PUT', '/api/push/subscription', sub('dev-1'))).status).toBe(200);
    const stored = await alice.req(
      'GET',
      `/api/push/subscription?endpoint=${encodeURIComponent(sub('dev-1').endpoint)}`,
    );
    expect(stored.json).toEqual({ remindAt: '20:00', tz: 'Europe/Berlin' });
    // A new time replaces the old one for the same device.
    await alice.req('PUT', '/api/push/subscription', sub('dev-1', '07:30'));
    const rows = await ctx.db.select().from(pushSubscriptions);
    expect(rows.filter((r) => r.endpoint.endsWith('dev-1'))).toHaveLength(1);
    expect(rows.find((r) => r.endpoint.endsWith('dev-1'))!.remindAt).toBe('07:30');
  });

  it('validates time, zone and endpoint, and needs a login', async () => {
    expect((await alice.req('PUT', '/api/push/subscription', sub('x', '25:00'))).status).toBe(400);
    expect((await alice.req('PUT', '/api/push/subscription', sub('x', '20:00', 'Mars/Olympus'))).status).toBe(
      400,
    );
    expect((await alice.req('PUT', '/api/push/subscription', { ...sub('x'), endpoint: 'nope' })).status).toBe(
      400,
    );
    expect((await new TestClient(ctx.app).req('PUT', '/api/push/subscription', sub('x'))).status).toBe(401);
  });

  it('accepts only endpoints of known push services', async () => {
    for (const ok of [
      'https://web.push.apple.com/abc',
      'https://api.push.apple.com/abc',
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://wns2-par02p.notify.windows.com/w/?token=abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
    ])
      expect(knownPushEndpoint(ok), ok).toBe(true);
    for (const bad of [
      'http://web.push.apple.com/abc',
      'https://web.push.apple.com:8443/abc',
      'https://push.apple.com.evil.example/abc',
      'https://evilpush.apple.com/abc',
      'https://192.168.1.10/abc',
      'https://nas.local/hook',
      'not a url',
    ])
      expect(knownPushEndpoint(bad), bad).toBe(false);
    const r = await alice.req('PUT', '/api/push/subscription', {
      ...sub('x'),
      endpoint: 'https://10.0.0.1/internal',
    });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('push_endpoint');
  });

  it('moves a shared device to the account that signs in, and deletes only own subscriptions', async () => {
    await alice.req('PUT', '/api/push/subscription', sub('shared'));
    await bob.req('PUT', '/api/push/subscription', sub('shared', '12:00'));
    const [row] = await ctx.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, sub('shared').endpoint));
    expect(row!.remindAt).toBe('12:00');
    // Alice no longer owns it: her delete is a no-op, Bob's removes it.
    await alice.req('DELETE', '/api/push/subscription', { endpoint: sub('shared').endpoint });
    expect((await ctx.db.select().from(pushSubscriptions)).some((r) => r.endpoint.endsWith('shared'))).toBe(
      true,
    );
    await bob.req('DELETE', '/api/push/subscription', { endpoint: sub('shared').endpoint });
    expect((await ctx.db.select().from(pushSubscriptions)).some((r) => r.endpoint.endsWith('shared'))).toBe(
      false,
    );
  });
});

describe('sending reminders', () => {
  it('reminds once a day, only people without an entry, and drops gone endpoints', async () => {
    await ctx.db.delete(pushSubscriptions);
    sent.length = 0;
    await alice.req('PUT', '/api/push/subscription', sub('a-phone', '20:00'));
    await bob.req('PUT', '/api/push/subscription', sub('b-phone', '20:00'));
    // Bob logged lunch today (Berlin date).
    await bob.post('/api/sync/push', {
      records: [
        {
          table: 'foodEntries',
          data: {
            id: 'e-bob-1',
            updatedAt: 1,
            deleted: false,
            date: '2026-10-20',
            meal: 1,
            loggedAt: 1,
            foodId: null,
            source: 'quick',
            name: 'Mittag',
            brand: null,
            grams: null,
            portionLabel: null,
            portionGrams: null,
            quantity: 1,
            per100: null,
            nutrients: { ENERCC: 600 },
            mealId: null,
            aiAnalysisId: null,
            groupId: null,
            groupName: null,
            photoId: null,
            photoIds: null,
          },
        },
      ],
    });
    // Too early: nothing.
    expect(await sendReminders(ctx.db, sender, at('19:59', '2026-10-20'))).toEqual({
      sent: 0,
      skipped: 0,
      removed: 0,
      failed: 0,
    });
    // Time has come: Alice gets it, Bob is skipped; both count as handled for today.
    expect(await sendReminders(ctx.db, sender, at('20:00', '2026-10-20'))).toEqual({
      sent: 1,
      skipped: 1,
      removed: 0,
      failed: 0,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.target.endpoint).toBe(sub('a-phone').endpoint);
    expect(JSON.parse(sent[0]!.payload)).toMatchObject({ title: 'Fleisch-Teufel', url: '/' });
    expect(sent[0]!.payload).toBe(REMINDER_PAYLOAD);
    expect(await sendReminders(ctx.db, sender, at('22:00', '2026-10-20'))).toEqual({
      sent: 0,
      skipped: 0,
      removed: 0,
      failed: 0,
    });
    // The next day it runs again: Alice's endpoint is gone (removed), Bob's delivery fails once
    // (counted, retried the next minute), then succeeds.
    outcomes.set(sub('a-phone').endpoint, 'gone');
    outcomes.set(sub('b-phone').endpoint, 'error');
    expect(await sendReminders(ctx.db, sender, at('20:05', '2026-10-21'))).toEqual({
      sent: 0,
      skipped: 0,
      removed: 1,
      failed: 1,
    });
    const left = await ctx.db.select().from(pushSubscriptions);
    expect(left.map((r) => r.endpoint)).toEqual([sub('b-phone').endpoint]);
    expect(left[0]!.failures).toBe(1);
    outcomes.delete(sub('b-phone').endpoint);
    expect(await sendReminders(ctx.db, sender, at('20:06', '2026-10-21'))).toEqual({
      sent: 1,
      skipped: 0,
      removed: 0,
      failed: 0,
    });
    expect((await ctx.db.select().from(pushSubscriptions))[0]).toMatchObject({
      failures: 0,
      lastSentOn: '2026-10-21',
      failingSince: null,
    });
  });

  it('keeps a subscription through errors and gives it up only after a week without success', async () => {
    await ctx.db.delete(pushSubscriptions);
    await alice.req('PUT', '/api/push/subscription', sub('flaky', '19:00'));
    const endpoint = sub('flaky').endpoint;
    outcomes.set(endpoint, 'error');
    try {
      // Errors every minute of an evening (`at` is CEST, Berlin is on CET by then): retried, never
      // dropped, the day stays open.
      for (let m = 0; m < 10; m++)
        expect(
          (await sendReminders(ctx.db, sender, at(`20:${String(m).padStart(2, '0')}`, '2026-11-01'))).failed,
        ).toBe(1);
      let [row] = await ctx.db.select().from(pushSubscriptions);
      expect(row).toMatchObject({ failures: 10, lastSentOn: null });
      const since = row!.failingSince!.getTime();
      expect(since).toBe(at('20:00', '2026-11-01').getTime());
      // Six days later still failing: kept.
      expect((await sendReminders(ctx.db, sender, at('20:00', '2026-11-07'))).removed).toBe(0);
      // A week after the first error: given up.
      const late = new Date(since + GIVE_UP_MS);
      expect((await sendReminders(ctx.db, sender, late)).removed).toBe(1);
      expect(await ctx.db.select().from(pushSubscriptions)).toEqual([]);

      // One success in between starts the count again.
      await alice.req('PUT', '/api/push/subscription', sub('flaky', '19:00'));
      await sendReminders(ctx.db, sender, at('20:00', '2026-11-10'));
      outcomes.delete(endpoint);
      await sendReminders(ctx.db, sender, at('20:01', '2026-11-10'));
      [row] = await ctx.db.select().from(pushSubscriptions);
      expect(row).toMatchObject({ failures: 0, failingSince: null, lastSentOn: '2026-11-10' });
    } finally {
      outcomes.delete(endpoint);
    }
  });

  it('answers 503 for subscriptions when the server has no keys', async () => {
    const bare = await createTestContext({ env: { ALLOW_REGISTRATION: 'true' } });
    try {
      const c = await registeredClient(bare, 'nokeys@example.com');
      expect((await c.req('GET', '/api/push/config')).json).toEqual({ enabled: false, publicKey: null });
      expect((await c.req('PUT', '/api/push/subscription', sub('x'))).status).toBe(503);
    } finally {
      await bare.close();
    }
  });
});
