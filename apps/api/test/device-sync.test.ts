/**
 * End-to-end sync: two "devices" (real Dexie databases on fake-indexeddb, the web app's real
 * SyncEngine and write helpers) talk to the real API backed by PostgreSQL.
 */
import 'fake-indexeddb/auto';
import { dayId, SYNC_TABLES, uuidv7, type ExerciseEntry, type FoodEntry } from '@ft/shared';
import { gt, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { photos as photoRows, syncTables } from '../src/db/schema.js';
import { UserDb } from '../../web/src/db/dexie';
import { loadPhoto, pruneLocalPhotos, storePhoto } from '../../web/src/db/photos';
import { createBackup, restoreBackup } from '../../web/src/db/backup';
import { deleteRecord, patchRecord, saveRecord } from '../../web/src/db/write';
import { SyncEngine, type SyncEngineOptions } from '../../web/src/sync/syncEngine';
import { createTestContext, registeredClient, TestClient, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let cookie: string;

beforeAll(async () => {
  // The steps import trusts the phone's date only near the server's: its day is 2026-10-08 here.
  ctx = await createTestContext({ clock: () => Date.parse('2026-10-08T12:00:00Z') });
  cookie = (await registeredClient(ctx, 'device@example.com')).cookie!;
});
afterAll(() => ctx.close());

/** The test API with the account's cookie. */
async function server(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set('cookie', cookie);
  return ctx.app.request(path, { ...init, headers });
}

function device(
  name: string,
  opts: {
    online?: () => boolean;
    appVersion?: string;
    db?: UserDb;
    calls?: string[];
    onReset?: SyncEngineOptions['onReset'];
  } = {},
) {
  const db = opts.db ?? new UserDb(`${name}-${uuidv7()}`);
  const engine = new SyncEngine(db, {
    pullPageSize: 3,
    appVersion: opts.appVersion,
    onReset: opts.onReset,
    fetch: async (path, init) => {
      if (opts.online && !opts.online()) throw new TypeError('Failed to fetch');
      opts.calls?.push(path);
      return server(path, init);
    },
  });
  return { db, engine };
}

/** A training as an app version before the steps import wrote it: steps copied under a fresh id. */
const strayStepsCopy = (): ExerciseEntry => ({
  id: uuidv7(),
  updatedAt: Date.now(),
  deleted: false,
  date: '2026-10-08',
  loggedAt: 1,
  typeKey: 'steps',
  name: 'Schritte',
  minutes: 76,
  intensity: 'moderate',
  met: 3.5,
  weightKg: 80,
  kcal: 333,
  note: null,
  templateId: null,
  groupId: null,
  steps: 8432,
  distanceM: 6100,
});

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
  groupId: null,
  groupName: null,
  photoId: null,
  photoIds: null,
  note: null,
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

  it('gets the steps the shortcut sent and keeps kcal typed on the device', async () => {
    const phone = device('steps-phone');
    const app = new TestClient(ctx.app, { cookie });
    const token = (await app.post('/api/steps/token')).json.token as string;
    const shortcut = new TestClient(ctx.app, { authorization: `Bearer ${token}` });
    const send = (steps: string) =>
      shortcut.post('/api/steps/import', { stepDates: '2026-10-08', stepValues: steps, now: '2026-10-08' });

    expect((await send('8000')).json.days[0].written).toBe(true);
    await phone.engine.sync();
    const id = dayId.steps('2026-10-08');
    const pulled = (await phone.db.exerciseEntries.get(id))!;
    expect(pulled).toMatchObject({ typeKey: 'steps', steps: 8000 });

    await patchRecord(phone.db, 'exerciseEntries', id, { kcal: 290 });
    await phone.engine.sync();
    await send('9500');
    await phone.engine.sync();
    expect(await phone.db.exerciseEntries.get(id)).toMatchObject({ steps: 9500, kcal: 290, minutes: 95 });
  });

  it('reports an expired session', async () => {
    const db = new UserDb(`unauth-${uuidv7()}`);
    let called = false;
    const engine = new SyncEngine(db, {
      fetch: async (p, i) => ctx.app.request(p, i),
      onUnauthorized: () => (called = true),
    });
    await expect(engine.sync()).rejects.toThrow('HTTP 401');
    expect(engine.getState().status).toBe('unauthorized');
    expect(called).toBe(true);
  });

  it('skips changes of a table this app version does not know and asks for an update', async () => {
    const a = device('future-writer');
    const b = device('future-reader');
    const e = entry();
    await saveRecord(a.db, 'foodEntries', e);
    await a.engine.sync();
    // The server (a newer version) also sends a table and a record shape this device cannot store.
    const engine = new SyncEngine(b.db, {
      fetch: async (path, init) => {
        const headers = new Headers(init?.headers);
        headers.set('cookie', cookie);
        const res = await ctx.app.request(path, { ...init, headers });
        if (!path.startsWith('/api/sync/pull')) return res;
        const body = (await res.json()) as { changes: unknown[] };
        body.changes.unshift(
          { table: 'waterEntries', data: { id: 'x', updatedAt: 1, deleted: false, ml: 250 } },
          { table: 'weightEntries', data: { id: 'w:1999-01-01', updatedAt: 1, deleted: false, kg: 'viel' } },
        );
        return new Response(JSON.stringify(body), { status: 200 });
      },
    });
    await engine.sync();
    expect(await b.db.foodEntries.get(e.id)).toBeTruthy();
    expect(await b.db.weightEntries.get('w:1999-01-01')).toBeUndefined();
    expect(engine.getState()).toMatchObject({ status: 'idle', needsUpdate: true });
    expect((await b.db.kv.get('sync.cursor'))?.value).toBeGreaterThan(0);
  });

  it('keeps "update the app" across starts and loads everything again after an update', async () => {
    const a = device('update-writer');
    const e = entry({ name: 'Neues Feld' });
    await saveRecord(a.db, 'foodEntries', e);
    await a.engine.sync();
    // Version 1 of the app cannot read this record (as if it had a shape only a newer version knows).
    const db = new UserDb(`update-reader-${uuidv7()}`);
    const old = new SyncEngine(db, {
      appVersion: '1',
      fetch: async (path, init) => {
        const res = await server(path, init);
        if (!path.startsWith('/api/sync/pull')) return res;
        const body = (await res.json()) as { changes: { data: { id: string; grams: unknown } }[] };
        for (const c of body.changes) if (c.data.id === e.id) c.data.grams = 'viel';
        return new Response(JSON.stringify(body), { status: 200 });
      },
    });
    await old.sync();
    expect(old.getState().needsUpdate).toBe(true);
    expect(await db.foodEntries.get(e.id)).toBeUndefined();
    expect((await db.kv.get('sync.needsUpdate'))?.value).toEqual({ version: '1' });

    // Restarted with the same version: the flag is back, the cursor stays.
    const calls: string[] = [];
    const again = device('update-reader', { db, appVersion: '1', calls });
    await again.engine.sync();
    expect(again.engine.getState().needsUpdate).toBe(true);
    expect(calls.find((p) => p.startsWith('/api/sync/pull'))).not.toContain('since=0&');
    expect(await db.foodEntries.get(e.id)).toBeUndefined();

    // Updated: the first pull starts at 0, the skipped record arrives and the flag is gone.
    calls.length = 0;
    const updated = device('update-reader', { db, appVersion: '2', calls });
    await updated.engine.sync();
    expect(calls.find((p) => p.startsWith('/api/sync/pull'))).toContain('since=0&');
    expect(await db.foodEntries.get(e.id)).toMatchObject({ grams: 60 });
    expect(updated.engine.getState().needsUpdate).toBe(false);
    expect(await db.kv.get('sync.needsUpdate')).toBeUndefined();
  });

  it('drops a record the server rejected, keeps it in the list and reloads from the server', async () => {
    const calls: string[] = [];
    const a = device('rejected', { calls });
    const e = entry({ name: 'Gültig' });
    await saveRecord(a.db, 'foodEntries', e);
    await a.engine.sync();
    expect((await a.db.kv.get('sync.cursor'))?.value).toBeGreaterThan(0);
    // Broken on the device, bypassing the write checks: an invalid edit and a stray steps copy.
    const broken = { ...(await a.db.foodEntries.get(e.id))!, meal: 9, updatedAt: Date.now() + 1000 };
    const stray = strayStepsCopy();
    await a.db.foodEntries.put(broken);
    await a.db.exerciseEntries.put(stray);
    await a.db.outbox.bulkPut([
      { key: `foodEntries:${e.id}`, table: 'foodEntries', id: e.id, updatedAt: broken.updatedAt },
      {
        key: `exerciseEntries:${stray.id}`,
        table: 'exerciseEntries',
        id: stray.id,
        updatedAt: stray.updatedAt,
      },
    ]);
    calls.length = 0;
    const s = await a.engine.sync();
    expect(s.rejected).toBe(2);
    expect(a.engine.getState()).toMatchObject({ status: 'idle', rejected: 2 });
    expect(await a.db.outbox.count()).toBe(0);
    // Gone from the device (no tombstone), the server's valid version is back.
    expect(await a.db.exerciseEntries.get(stray.id)).toBeUndefined();
    expect(await a.db.foodEntries.get(e.id)).toMatchObject({ meal: 1, name: 'Gültig' });
    expect(calls.find((p) => p.startsWith('/api/sync/pull'))).toContain('since=0&');
    const list = (await a.db.kv.get('sync.rejected'))?.value as {
      table: string;
      id: string;
      error: string;
      record: { id: string; kcal?: number };
    }[];
    expect(list.map((r) => r.record.id).sort()).toEqual([e.id, stray.id].sort());
    expect(list.find((r) => r.id === stray.id)).toMatchObject({
      table: 'exerciseEntries',
      error: `id must be ${dayId.steps('2026-10-08')}`,
      record: { kcal: 333 },
    });
    // A second run sends nothing again and pulls from where it stopped.
    calls.length = 0;
    expect((await a.engine.sync()).rejected).toBe(0);
    expect(calls.find((p) => p.startsWith('/api/sync/pull'))).not.toContain('since=0&');
  });

  it('a restored backup never undoes newer server changes or deletions', async () => {
    const a = device('backup-source');
    const kept = entry({ name: 'Bleibt' });
    const gone = entry({ name: 'Später gelöscht' });
    const food = {
      id: uuidv7(),
      name: 'Alter Name',
      brand: null,
      barcode: null,
      unit: 'g' as const,
      nutrients: {},
      portions: [],
    };
    await saveRecord(a.db, 'foodEntries', kept);
    await saveRecord(a.db, 'foodEntries', gone);
    await saveRecord(a.db, 'customFoods', food);
    await a.engine.sync();
    const backup = await createBackup(a.db, 'test');
    // Only in the backup: a record that never reached the server.
    const lost = { ...entry({ name: 'Nur in der Sicherung' }), updatedAt: 1_000, deleted: false };
    (backup.foodEntries as unknown[]).push(lost);
    // After the backup: one deletion, one rename.
    await deleteRecord(a.db, 'foodEntries', gone.id);
    await patchRecord(a.db, 'customFoods', food.id, { name: 'Neuer Name' });
    await a.engine.sync();

    // A device that syncs first (as "Daten & Sync" does), and one that restores without it.
    for (const syncFirst of [true, false]) {
      const b = device(`backup-target-${syncFirst}`);
      if (syncFirst) await b.engine.sync();
      const r = await restoreBackup(b.db, backup);
      if (syncFirst) expect(r.restored).toBe(1);
      await b.engine.sync();
      expect(await b.db.foodEntries.get(gone.id)).toMatchObject({ deleted: true });
      expect(await b.db.customFoods.get(food.id)).toMatchObject({ name: 'Neuer Name' });
      expect(await b.db.foodEntries.get(kept.id)).toMatchObject({ deleted: false });
      expect(await b.db.foodEntries.get(lost.id)).toMatchObject({ name: 'Nur in der Sicherung' });
    }
    // The server agrees: another device sees the deletion, the new name and the missing record.
    const c = device('backup-check');
    await c.engine.sync();
    expect(await c.db.foodEntries.get(gone.id)).toMatchObject({ deleted: true });
    expect(await c.db.customFoods.get(food.id)).toMatchObject({ name: 'Neuer Name' });
    expect(await c.db.foodEntries.get(lost.id)).toMatchObject({ updatedAt: 1_000, deleted: false });
  });

  it('reports a storage error as an error, not as offline', async () => {
    const a = device('broken');
    await saveRecord(a.db, 'foodEntries', entry());
    a.db.close();
    await expect(a.engine.sync()).rejects.toThrow();
    expect(a.engine.getState().status).toBe('error');
    expect(a.engine.getState().error).toBeTruthy();
  });

  it('pushes records even when a photo upload fails, and reports the failure afterwards', async () => {
    const a = device('photo-fail');
    const b = device('photo-fail-reader');
    let photosDown = true;
    a.engine = new SyncEngine(a.db, {
      fetch: async (path, init) => {
        if (photosDown && path.startsWith('/api/photos/')) return new Response(null, { status: 503 });
        const headers = new Headers(init?.headers);
        headers.set('cookie', cookie);
        return ctx.app.request(path, { ...init, headers });
      },
    });
    const photoId = await storePhoto(a.db, new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1])]));
    const e = entry({ photoId, photoIds: [photoId] });
    await saveRecord(a.db, 'foodEntries', e);
    await expect(a.engine.sync()).rejects.toThrow('HTTP 503');
    expect(a.engine.getState().status).toBe('error');
    // The record is on the server, the photo is still waiting.
    await b.engine.sync();
    expect(await b.db.foodEntries.get(e.id)).toBeTruthy();
    expect((await a.db.photos.get(photoId))?.uploaded).toBe(0);
    photosDown = false;
    await a.engine.sync();
    expect(a.engine.getState().status).toBe('idle');
    expect((await a.db.photos.get(photoId))?.uploaded).toBe(1);
  });

  it('re-versions records a device stamped in the future and learns its clock offset', async () => {
    const a = device('fast-clock');
    const b = device('fast-clock-reader');
    const e = entry();
    await saveRecord(a.db, 'foodEntries', e);
    // As written by a device whose clock runs ten minutes ahead.
    const future = Date.now() + 10 * 60_000;
    await a.db.foodEntries.update(e.id, { updatedAt: future });
    await a.db.outbox.update(`foodEntries:${e.id}`, { updatedAt: future });
    const s = await a.engine.sync();
    expect(s.rejected).toBe(0);
    expect(await a.db.outbox.count()).toBe(0);
    const local = (await a.db.foodEntries.get(e.id))!;
    expect(local.updatedAt).toBeLessThan(future);
    await b.engine.sync();
    expect((await b.db.foodEntries.get(e.id))?.updatedAt).toBe(local.updatedAt);
    // The clock looked fine to the server (same process), so no offset is applied.
    expect(a.db.clockOffset).toBe(0);
  });

  it('prunes old uploaded photos nothing references, never pending ones', async () => {
    const a = device('prune');
    const old = Date.now() - 40 * 24 * 60 * 60 * 1000;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1]);
    const orphan = await storePhoto(a.db, new Blob([bytes]));
    const used = await storePhoto(a.db, new Blob([bytes]));
    const pending = await storePhoto(a.db, new Blob([bytes]));
    await a.db.photos.update(orphan, { uploaded: 1, createdAt: old });
    await a.db.photos.update(used, { uploaded: 1, createdAt: old });
    await a.db.photos.update(pending, { createdAt: old });
    await saveRecord(a.db, 'foodEntries', entry({ photoId: used, photoIds: [used] }));
    expect(await pruneLocalPhotos(a.db)).toBe(1);
    expect((await a.db.photos.toArray()).map((p) => p.id).sort()).toEqual([pending, used].sort());
  });

  it('refuses invalid local writes before they reach the outbox', async () => {
    const a = device('invalid');
    await expect(saveRecord(a.db, 'foodEntries', entry({ meal: 9 }))).rejects.toThrow();
    expect(await a.db.outbox.count()).toBe(0);
  });

  it('uploads a meal photo before the meal and lets another device download it', async () => {
    const phone = device('photo-phone');
    const laptop = device('photo-laptop');
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]);
    const photoId = await storePhoto(phone.db, new Blob([bytes], { type: 'image/jpeg' }));
    await saveRecord(phone.db, 'meals', {
      id: uuidv7(),
      name: 'Spaghetti',
      photoId,
      cookedGrams: null,
      items: [
        {
          foodId: null,
          source: 'quick',
          name: 'Spaghetti',
          brand: null,
          grams: null,
          portionLabel: null,
          portionGrams: null,
          quantity: 1,
          per100: null,
          nutrients: { ENERCC: 600 },
        },
      ],
    });
    await phone.engine.sync();
    expect((await phone.db.photos.get(photoId))?.uploaded).toBe(1);

    await laptop.engine.sync();
    const [meal] = await laptop.db.meals.toArray();
    expect(meal?.photoId).toBe(photoId);
    const blob = await loadPhoto(laptop.db, photoId, (path, init) => {
      const headers = new Headers(init?.headers);
      headers.set('cookie', cookie);
      return Promise.resolve(ctx.app.request(path, { ...init, headers }));
    });
    expect(new Uint8Array(await new Response(blob).arrayBuffer())).toEqual(bytes);
  });

  it('re-uploads everything after the server database was rolled back', async () => {
    type ResetInfo = Parameters<NonNullable<SyncEngineOptions['onReset']>>[0];
    const resets: Record<string, ResetInfo[]> = { a: [], b: [] };
    const a = device('restore-a', { onReset: (i) => resets.a!.push(i) });
    const b = device('restore-b', { onReset: (i) => resets.b!.push(i) });
    await a.engine.sync();
    await b.engine.sync();
    // The backup: everything up to here.
    const [{ last: snapshot } = { last: 0 }] = (await ctx.db.execute(
      sql`select last_value as last from sync_seq`,
    )) as unknown as { last: number }[];

    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7]);
    const photoId = await storePhoto(a.db, new Blob([bytes], { type: 'image/jpeg' }));
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const e = entry({ meal: 2, photoId: i === 0 ? photoId : null, photoIds: i === 0 ? [photoId] : null });
      ids.push(e.id);
      await saveRecord(a.db, 'foodEntries', e);
    }
    await a.engine.sync();
    await b.engine.sync();
    expect(await b.db.foodEntries.where('id').anyOf(ids).count()).toBe(3);

    // Restore the backup: the rows written after it are gone, the sequence is back.
    for (const t of Object.values(syncTables))
      await ctx.db.delete(t).where(gt(t.changeSeq, Number(snapshot)));
    await ctx.db.delete(photoRows).where(sql`${photoRows.id} = ${photoId}`);
    await ctx.db.execute(sql`select setval('sync_seq', ${Number(snapshot)})`);
    const lost = await server('/api/sync/pull?since=0&limit=1000').then((r) => r.json());
    expect(lost.changes.filter((c: { data: { id: string } }) => ids.includes(c.data.id))).toHaveLength(0);

    await a.engine.sync();
    expect(resets.a).toHaveLength(1);
    expect(resets.a![0]!.reason).toBe('reset');
    let local = 0;
    for (const t of SYNC_TABLES) local += await a.db.syncTable(t).count();
    expect(resets.a![0]!.records).toBe(local);
    expect(await a.db.outbox.count()).toBe(0);
    expect((await a.db.photos.get(photoId))?.uploaded).toBe(1);
    const back = await server('/api/sync/pull?since=0&limit=1000').then((r) => r.json());
    expect(back.changes.filter((c: { data: { id: string } }) => ids.includes(c.data.id))).toHaveLength(3);
    expect((await server(`/api/photos/${photoId}`)).status).toBe(200);

    // The other device learns of the restore by the new epoch and ends with the same records.
    await b.engine.sync();
    expect(resets.b).toHaveLength(1);
    expect(await b.db.outbox.count()).toBe(0);
    expect(await b.db.foodEntries.where('id').anyOf(ids).count()).toBe(3);
    expect((await a.engine.sync()).pulled).toBe(0);
    expect(resets.a).toHaveLength(1);
  });

  it('resets when the epoch changed although the cursor is still valid', async () => {
    const resets: { reason: string; records: number }[] = [];
    const a = device('epoch-a', { onReset: (i) => resets.push(i) });
    await saveRecord(a.db, 'foodEntries', entry({ meal: 3 }));
    await a.engine.sync();
    expect(resets).toHaveLength(0);
    const before = await a.db.foodEntries.toArray();
    await a.db.kv.put({ key: 'sync.epoch', value: 'old' });

    // Pull only, so the queued records stay visible.
    await a.engine.pull();
    expect(resets).toHaveLength(1);
    expect(resets[0]!.reason).toBe('epoch');
    expect(await a.db.outbox.count()).toBe(resets[0]!.records);
    expect(resets[0]!.records).toBeGreaterThanOrEqual(before.length);
    expect((await a.db.kv.get('sync.epoch'))?.value).not.toBe('old');
    expect(await a.db.kv.get('sync.cursor')).toBeUndefined();

    await a.engine.sync();
    expect(await a.db.outbox.count()).toBe(0);
    expect(await a.db.foodEntries.toArray()).toEqual(before);
    expect(resets).toHaveLength(1);
  });
});
