/**
 * Housekeeping that runs at start and once a day: photos nobody references any more and sessions
 * that expired. Both grow without bound otherwise (every analysed plate stays as bytea forever).
 */
import { sql } from 'drizzle-orm';
import type { Db } from './db/client.js';
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

export async function runMaintenance(db: Db): Promise<void> {
  try {
    const photos = await cleanupPhotos(db);
    const sessions = await cleanupSessions(db);
    if (photos || sessions) log.info('maintenance', { photos, sessions });
  } catch (e) {
    log.warn('maintenance failed', { error: e instanceof Error ? e.message : String(e) });
  }
}

/** Runs the housekeeping now and then daily; the timer never keeps the process alive. */
export function startMaintenance(db: Db): () => void {
  void runMaintenance(db);
  const timer = setInterval(() => void runMaintenance(db), DAY_MS);
  timer.unref();
  return () => clearInterval(timer);
}
