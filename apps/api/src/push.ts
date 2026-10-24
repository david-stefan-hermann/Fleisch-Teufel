/**
 * The daily reminder ("Heute noch nichts eingetragen") over Web Push: one subscription per device
 * with a local time of day. Every minute the server looks for subscriptions whose time has come in
 * their own time zone, skips those whose person already logged food today, sends the rest once, and
 * drops endpoints the push service reports as gone. Forgetting is the most common reason diaries
 * stay empty; one reminder a day, off by default, is the whole feature.
 */
import { and, eq, sql } from 'drizzle-orm';
import webPush from 'web-push';
import type { Db } from './db/client.js';
import { foodEntries, pushSubscriptions } from './db/schema.js';
import { log } from './log.js';

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type PushOutcome = 'ok' | 'gone' | 'error';

export interface PushSender {
  publicKey: string;
  send(target: PushTarget, payload: string): Promise<PushOutcome>;
}

/** Sends through the push services with VAPID (the `web-push` library does the encryption). */
export function createWebPushSender(keys: {
  publicKey: string;
  privateKey: string;
  subject: string;
}): PushSender {
  webPush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);
  return {
    publicKey: keys.publicKey,
    async send(target, payload) {
      try {
        await webPush.sendNotification(
          { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
          payload,
          { TTL: 6 * 60 * 60, urgency: 'normal' },
        );
        return 'ok';
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        // 404/410: the subscription expired or was revoked; everything else is a hiccup to retry.
        if (status === 404 || status === 410) return 'gone';
        log.warn('push failed', { status, error: e instanceof Error ? e.message : String(e) });
        return 'error';
      }
    },
  };
}

/** Whether `tz` is a time zone the runtime knows. */
export function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Local date (YYYY-MM-DD) and minutes since midnight of `now` in `tz`. */
export function localClock(now: Date, tz: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

export const REMIND_AT = /^([01]\d|2[0-3]):[0-5]\d$/;

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Subscriptions whose local time has come today and that were not handled for today yet. */
export function dueSubscriptions<T extends { remindAt: string; tz: string; lastSentOn: string | null }>(
  rows: readonly T[],
  now: Date,
): (T & { localDate: string })[] {
  const out: (T & { localDate: string })[] = [];
  for (const r of rows) {
    if (!REMIND_AT.test(r.remindAt) || !validTimeZone(r.tz)) continue;
    const { date, minutes } = localClock(now, r.tz);
    if (r.lastSentOn === date || minutes < minutesOf(r.remindAt)) continue;
    out.push({ ...r, localDate: date });
  }
  return out;
}

/** After this many consecutive delivery errors a subscription is given up. */
const MAX_FAILURES = 5;

export const REMINDER_PAYLOAD = JSON.stringify({
  title: 'Fleisch-Teufel',
  body: 'Heute noch nichts eingetragen. Ein Foto oder zwei Wörter reichen.',
  url: '/',
  tag: 'reminder',
});

/**
 * One pass: sends the reminders that are due to people without a diary entry today (their local
 * day), marks the day as handled either way, removes gone endpoints.
 */
export async function sendReminders(
  db: Db,
  sender: PushSender,
  now = new Date(),
): Promise<{ sent: number; skipped: number; removed: number; failed: number }> {
  const result = { sent: 0, skipped: 0, removed: 0, failed: 0 };
  const rows = await db.select().from(pushSubscriptions);
  for (const sub of dueSubscriptions(rows, now)) {
    const [logged] = await db
      .select({ id: foodEntries.id })
      .from(foodEntries)
      .where(
        and(
          eq(foodEntries.userId, sub.userId),
          eq(foodEntries.date, sub.localDate),
          eq(foodEntries.deleted, false),
        ),
      )
      .limit(1);
    const handled = () =>
      db
        .update(pushSubscriptions)
        .set({ lastSentOn: sub.localDate, failures: 0 })
        .where(eq(pushSubscriptions.endpoint, sub.endpoint));
    if (logged) {
      await handled();
      result.skipped++;
      continue;
    }
    const outcome = await sender.send(sub, REMINDER_PAYLOAD);
    if (outcome === 'ok') {
      await handled();
      result.sent++;
    } else if (outcome === 'gone' || sub.failures + 1 >= MAX_FAILURES) {
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, sub.endpoint));
      result.removed++;
    } else {
      await db
        .update(pushSubscriptions)
        .set({ failures: sql`${pushSubscriptions.failures} + 1` })
        .where(eq(pushSubscriptions.endpoint, sub.endpoint));
      result.failed++;
    }
  }
  return result;
}

/** Runs `sendReminders` every minute; the timer never keeps the process alive. */
export function startReminders(db: Db, sender: PushSender): () => void {
  const run = async () => {
    try {
      const r = await sendReminders(db, sender);
      if (r.sent || r.removed || r.failed) log.info('reminders', r);
    } catch (e) {
      log.warn('reminders failed', { error: e instanceof Error ? e.message : String(e) });
    }
  };
  void run();
  const timer = setInterval(() => void run(), 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
