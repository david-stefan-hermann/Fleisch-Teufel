/**
 * Housekeeping that runs at start and once a day: photos nobody references any more, sessions that
 * expired, and cached Open Food Facts products nobody uses. All grow without bound otherwise (every
 * analysed plate stays as bytea forever, every online search keeps up to 50 products in memory).
 */
import { sql } from 'drizzle-orm';
import type { Db } from './db/client.js';
import type { FoodCatalog } from './foods/catalog.js';
import { log } from './log.js';

/** A photo must be this old before it may go: a device may still be about to push the meal that uses it. */
export const PHOTO_GRACE_MS = 30 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Deletes photos older than the grace period that no meal and no diary entry (tombstones included,
 * so the trash can still show them) points to. Returns the number removed.
 */
export async function cleanupPhotos(db: Db, now = Date.now()): Promise<number> {
  const cutoff = new Date(now - PHOTO_GRACE_MS).toISOString();
  const result = await db.execute(sql`
    delete from photos p
    where p.created_at < ${cutoff}::timestamptz
      and not exists (select 1 from meals m where m.user_id = p.user_id and m.photo_id = p.id)
      and not exists (
        select 1 from food_entries e
        where e.user_id = p.user_id
          and (e.photo_id = p.id or (e.photo_ids is not null and e.photo_ids @> to_jsonb(array[p.id])))
      )
  `);
  return Number((result as unknown as { count?: number }).count ?? 0);
}

/** Deletes sessions whose expiry passed (they are refused anyway, but the rows stayed). */
export async function cleanupSessions(db: Db, now = Date.now()): Promise<number> {
  const at = new Date(now).toISOString();
  const result = await db.execute(sql`delete from sessions where expires_at < ${at}::timestamptz`);
  return Number((result as unknown as { count?: number }).count ?? 0);
}

/** A cached OFF product nobody refers to goes once it was not fetched again for this long. */
export const OFF_UNUSED_MS = 90 * DAY_MS;

/**
 * Deletes cached OFF products fetched longer than `OFF_UNUSED_MS` ago that nothing refers to: no diary
 * entry (tombstones included), no saved meal, no own portion, no own food with the same barcode, no
 * learned AI choice. Returns the ids removed (the catalog drops them from its index).
 */
export async function cleanupOffFoods(db: Db, now = Date.now()): Promise<string[]> {
  const cutoff = new Date(now - OFF_UNUSED_MS).toISOString();
  const rows = (await db.execute(sql`
    delete from foods f
    where f.source = 'off'
      and f.fetched_at < ${cutoff}::timestamptz
      and not exists (select 1 from food_entries e where e.food_id = f.id)
      and not exists (
        select 1 from meals m where m.items @> jsonb_build_array(jsonb_build_object('foodId', f.id))
      )
      and not exists (select 1 from food_portions p where p.food_id = f.id)
      and not exists (select 1 from custom_foods c where c.barcode = f.source_id)
      and not exists (select 1 from ai_food_choices a where a.food_id = f.id)
    returning f.id
  `)) as unknown as { id: string }[];
  return rows.map((r) => r.id);
}

export async function runMaintenance(db: Db, catalog?: FoodCatalog): Promise<void> {
  try {
    const photos = await cleanupPhotos(db);
    const sessions = await cleanupSessions(db);
    const off = await cleanupOffFoods(db);
    catalog?.dropOff(off);
    if (photos || sessions || off.length) log.info('maintenance', { photos, sessions, offFoods: off.length });
  } catch (e) {
    log.warn('maintenance failed', { error: e instanceof Error ? e.message : String(e) });
  }
}

/** Runs the housekeeping now and then daily; the timer never keeps the process alive. */
export function startMaintenance(db: Db, catalog?: FoodCatalog): () => void {
  void runMaintenance(db, catalog);
  const timer = setInterval(() => void runMaintenance(db, catalog), DAY_MS);
  timer.unref();
  return () => clearInterval(timer);
}
