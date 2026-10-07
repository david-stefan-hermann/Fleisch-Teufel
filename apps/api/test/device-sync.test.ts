/**
 * End-to-end sync: two "devices" (real Dexie databases on fake-indexeddb, the web app's real
 * SyncEngine and write helpers) talk to the real API backed by PostgreSQL.
 */
import 'fake-indexeddb/auto';
import { dayId, uuidv7, type FoodEntry } from '@ft/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UserDb } from '../../web/src/db/dexie';
import { deleteRecord, patchRecord, saveRecord } from '../../web/src/db/write';
import { SyncEngine } from '../../web/src/sync/syncEngine';
import { createTestContext, registeredClient, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let cookie: string;

beforeAll(async () => {
  ctx = await createTestContext();
  cookie = (await registeredClient(ctx, 'device@example.com')).cookie!;
});
afterAll(() => ctx.close());

function device(name: string, opts: { online?: () => boolean } = {}) {
  const db = new UserDb(`${name}-${uuidv7()}`);
  const engine = new SyncEngine(db, {
    pullPageSize: 3,
    fetch: async (path, init) => {
      if (opts.online && !opts.online()) throw new TypeError('Failed to fetch');
      const headers = new Headers(init?.headers);
      headers.set('cookie', cookie);
      return ctx.app.request(path, { ...init, headers });
    },
  });
  return { db, engine };
}

const entry = (over: Partial<FoodEntry> = {}): Omit<FoodEntry, 'updatedAt' | 'deleted'> => ({
  id: uuidv7(),
  date: '2026-10-07',
  meal: 1,
  loggedAt: Date.now(),
  foodId: 'bls:C133000',
  source: 'bls',
  name: 'Hafer Flocken',
  brand: null,
  grams: 60,
  portionLabel: '100 g',
  portionGrams: 100,
  quantity: 0.6,
  per100: { ENERCC: 348 },
  nutrients: { ENERCC: 208.8 },
  mealId: null,
  aiAnalysisId: null,
  ...over,
});

describe('device ↔ server sync', () => {
  it('moves records from one device to another, across paged pulls', async () => {
    const phone = device('phone');
    const laptop = device('laptop');
    for (let i = 0; i < 7; i++) await saveRecord(phone.db, 'foodEntries', entry({ meal: i % 4 }));
    await saveRecord(phone.db, 'weightEntries', {
      id: dayId.weight('2026-10-07'),
      date: '2026-10-07',
      kg: 81.2,
    });
    expect(await phone.db.outbox.count()).toBe(8);

    const s1 = await phone.engine.sync();
    expect(s1.pushed).toBe(8);
    expect(await phone.db.outbox.count()).toBe(0);

    const s2 = await laptop.engine.sync();
    expect(s2.pulled).toBe(8);
    expect(await laptop.db.foodEntries.count()).toBe(7);
    expect((await laptop.db.weightEntries.get('w:2026-10-07'))?.kg).toBe(81.2);
    expect(laptop.engine.getState().status).toBe('idle');
  });

  it('resolves concurrent offline edits with last write wins on both devices', async () => {
    const a = device('a');
    const b = device('b');
    await a.engine.sync();
    await b.engine.sync();
    const e = entry();
    await saveRecord(a.db, 'foodEntries', e);
    await a.engine.sync();
    await b.engine.sync();

    // Both edit offline; b edits later → b wins everywhere.
    await patchRecord(a.db, 'foodEntries', e.id, { quantity: 2 });
    await new Promise((r) => setTimeout(r, 5));
    await patchRecord(b.db, 'foodEntries', e.id, { quantity: 3 });
    await a.engine.sync();
    await b.engine.sync();
    await a.engine.sync();
    expect((await a.db.foodEntries.get(e.id))?.quantity).toBe(3);
    expect((await b.db.foodEntries.get(e.id))?.quantity).toBe(3);
    expect(await a.db.outbox.count()).toBe(0);
  });

  it('keeps a newer local edit when an older remote version arrives', async () => {
    const a = device('a2');
    const b = device('b2');
    const e = entry();
    await saveRecord(a.db, 'foodEntries', e);
    await a.engine.sync();
    await b.engine.sync();
    await patchRecord(a.db, 'foodEntries', e.id, { quantity: 5 }); // older edit, not yet pushed
    await new Promise((r) => setTimeout(r, 5));
    await patchRecord(b.db, 'foodEntries', e.id, { quantity: 9 }); // newer, pushed first
    await b.engine.sync();
    // a pushes its (older) edit: server keeps b's; a then pulls b's.
    await a.engine.sync();
    expect((await a.db.foodEntries.get(e.id))?.quantity).toBe(9);
  });

  it('propagates deletions', async () => {
    const a = device('a3');
    const b = device('b3');
    const e = entry();
    await saveRecord(a.db, 'foodEntries', e);
    await a.engine.sync();
    await b.engine.sync();
    await deleteRecord(b.db, 'foodEntries', e.id);
    await b.engine.sync();
    await a.engine.sync();
    expect((await a.db.foodEntries.get(e.id))?.deleted).toBe(true);
  });

  it('converges one-per-day records written offline on two devices', async () => {
    const a = device('a4');
    const b = device('b4');
    await saveRecord(a.db, 'dayNotes', {
      id: dayId.note('2026-10-06'),
      date: '2026-10-06',
      note: 'Handy',
      completedAt: null,
    });
    await new Promise((r) => setTimeout(r, 5));
    await saveRecord(b.db, 'dayNotes', {
      id: dayId.note('2026-10-06'),
      date: '2026-10-06',
      note: 'Laptop',
      completedAt: null,
    });
    await a.engine.sync();
    await b.engine.sync();
    await a.engine.sync();
    expect((await a.db.dayNotes.get('n:2026-10-06'))?.note).toBe('Laptop');
    expect(await b.db.dayNotes.where('date').equals('2026-10-06').count()).toBe(1);
  });

  it('works offline and catches up when the connection returns', async () => {
    let online = false;
    const a = device('offline', { online: () => online });
    await saveRecord(a.db, 'foodEntries', entry());
    await expect(a.engine.sync()).rejects.toThrow();
    expect(a.engine.getState().status).toBe('offline');
    expect(await a.db.outbox.count()).toBe(1);
    online = true;
    const s = await a.engine.sync();
    expect(s.pushed).toBe(1);
    expect(a.engine.getState().status).toBe('idle');
  });

  it('reports an expired session', async () => {
    const db = new UserDb(`unauth-${uuidv7()}`);
    let called = false;
    const engine = new SyncEngine(db, {
      fetch: (p, i) => ctx.app.request(p, i),
      onUnauthorized: () => (called = true),
    });
    await expect(engine.sync()).rejects.toThrow('HTTP 401');
    expect(engine.getState().status).toBe('unauthorized');
    expect(called).toBe(true);
  });

  it('refuses invalid local writes before they reach the outbox', async () => {
    const a = device('invalid');
    await expect(saveRecord(a.db, 'foodEntries', entry({ meal: 9 }))).rejects.toThrow();
    expect(await a.db.outbox.count()).toBe(0);
  });
});
