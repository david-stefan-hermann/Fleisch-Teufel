import { uuidv7 } from '@ft/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupPhotos, cleanupSessions, PHOTO_GRACE_MS } from '../src/maintenance.js';
import { createTestContext, registeredClient, type TestClient, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let alice: TestClient;
beforeAll(async () => {
  ctx = await createTestContext();
  alice = await registeredClient(ctx, 'maint@example.com');
});
afterAll(() => ctx.close());

const jpeg = () => {
  const b = new Uint8Array(64);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  return b;
};
const put = (id: string) =>
  ctx.app.request(`/api/photos/${id}`, {
    method: 'PUT',
    headers: { cookie: alice.cookie!, 'content-type': 'image/jpeg' },
    body: jpeg(),
  });
const entry = (id: string, photoId: string | null, photoIds: string[] | null, deleted = false) => ({
  id,
  updatedAt: 1000,
  deleted,
  date: '2026-10-07',
  meal: 0,
  loggedAt: 1000,
  foodId: null,
  source: 'quick',
  name: 'x',
  brand: null,
  grams: null,
  portionLabel: null,
  portionGrams: null,
  quantity: 1,
  per100: null,
  nutrients: { ENERCC: 1 },
  mealId: null,
  aiAnalysisId: null,
  groupId: null,
  groupName: null,
  photoId,
  photoIds,
});

describe('maintenance', () => {
  it('removes only old photos that nothing references (tombstones count as references)', async () => {
    const ids = ['orphan', 'fresh', 'onmeal', 'onentry', 'inlist', 'ondeleted'].map(
      (n) => `${n}${uuidv7().slice(-6)}`,
    );
    const [orphan, fresh, onMeal, onEntry, inList, onDeleted] = ids as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    for (const id of ids) expect((await put(id)).status).toBe(200);
    const meal = {
      id: uuidv7(),
      updatedAt: 1000,
      deleted: false,
      name: 'M',
      photoId: onMeal,
      items: [entry('i', null, null)].map(({ photoId: _p, photoIds: _q, ...rest }) => rest),
    };
    const r = await alice.post('/api/sync/push', {
      records: [
        { table: 'meals', data: meal },
        { table: 'foodEntries', data: entry(uuidv7(), onEntry, null) },
        { table: 'foodEntries', data: entry(uuidv7(), null, ['other', inList]) },
        { table: 'foodEntries', data: entry(uuidv7(), onDeleted, null, true) },
      ],
    });
    expect(r.json.rejected).toEqual([]);
    // Everything but "fresh" is older than the grace period.
    await ctx.db.execute(sql`update photos set created_at = now() - interval '40 days' where id <> ${fresh}`);
    const removed = await cleanupPhotos(ctx.db);
    expect(removed).toBe(1);
    const left = (await ctx.db.execute(sql`select id from photos order by id`)) as unknown as {
      id: string;
    }[];
    expect(left.map((p) => p.id).sort()).toEqual([fresh, onMeal, onEntry, inList, onDeleted].sort());
    expect(left.some((p) => p.id === orphan)).toBe(false);
    // Later, with nothing new: the fresh one is past the grace period too, still an orphan.
    expect(await cleanupPhotos(ctx.db, Date.now() + PHOTO_GRACE_MS + 1000)).toBe(1);
  });

  it('removes expired sessions', async () => {
    const other = await registeredClient(ctx, 'maint2@example.com').catch(() => null);
    void other;
    await ctx.db.execute(
      sql`update sessions set expires_at = now() - interval '1 day' where user_id in (select id from users where email = 'maint@example.com')`,
    );
    expect(await cleanupSessions(ctx.db)).toBeGreaterThanOrEqual(1);
    expect((await alice.get('/api/auth/me')).status).toBe(401);
  });
});
