/**
 * Last-write-wins sync over all user tables.
 *
 * Push: records are validated with the shared Zod schemas, compared with the stored version
 * using the shared `incomingWins` rule and upserted; every stored write gets a fresh value from
 * the global `sync_seq` sequence. A per-user advisory lock serializes pushes of one user so
 * sequence values become visible in commit order, so a puller can never skip a lower value that
 * commits later.
 *
 * Pull: returns records with change_seq > cursor across all tables, merged in sequence order. All
 * tables are read in one repeatable-read transaction (one snapshot).
 *
 * Epoch: every pull answer carries the database's sync epoch (`app_meta` key `sync_epoch`). After a
 * restore the devices hold cursors above `sync_seq`; a pull with such a cursor rotates the epoch and
 * answers `reset`. A device that sees `reset` or another epoch than the one it stored uploads all its
 * records again and pulls from 0 (see docs/sync.md).
 */
import {
  CLOCK_AHEAD,
  incomingWins,
  MAX_CLOCK_AHEAD_MS,
  MAX_PULL_RECORDS,
  requiredId,
  SYNC_SCHEMAS,
  SYNC_TABLES,
  type AnySyncRecord,
  type PullResult,
  type PushRequest,
  type PushResult,
  type SyncTable,
} from '@ft/shared';
import { and, asc, eq, getTableColumns, gt, inArray, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { Db } from '../db/client.js';
import { appMeta, syncTables } from '../db/schema.js';
import { log } from '../log.js';

/** Column name as created by Drizzle's `casing: 'snake_case'` (keys carry no explicit names). */
const snakeCase = (key: string) => key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);

type AnyTable = (typeof syncTables)[SyncTable];

function table(name: SyncTable): AnyTable {
  return syncTables[name];
}

/** DB row → wire record (drops server-only columns). */
export function toWire(row: Record<string, unknown>): AnySyncRecord {
  const { userId: _u, changeSeq: _c, ...rest } = row;
  return rest as unknown as AnySyncRecord;
}

/**
 * Serializes the writes of one user until the transaction ends (pushes, the steps import). Re-entrant
 * within one transaction, so a caller holding it can run `push` inside the same transaction.
 */
export async function lockUser(tx: Pick<Db, 'execute'>, userId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
}

/**
 * Applies a batch of records. `db` may also be an open transaction (the steps import): the writes
 * then run in a savepoint of it.
 */
export async function push(
  db: Pick<Db, 'transaction'>,
  userId: string,
  req: PushRequest,
  now = Date.now(),
): Promise<PushResult> {
  const result: PushResult = { applied: 0, stale: [], rejected: [], serverTime: now };

  // Validate and group; within one batch the winning version per id survives.
  const byTable = new Map<SyncTable, Map<string, AnySyncRecord>>();
  for (const { table: name, data } of req.records) {
    const parsed = SYNC_SCHEMAS[name].safeParse(data);
    const rawId = typeof data.id === 'string' ? data.id : null;
    if (!parsed.success) {
      result.rejected.push({
        table: name,
        id: rawId,
        error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      });
      continue;
    }
    const rec = parsed.data as AnySyncRecord;
    if (rec.updatedAt > now + MAX_CLOCK_AHEAD_MS) {
      result.rejected.push({ table: name, id: rec.id, error: CLOCK_AHEAD });
      continue;
    }
    const expected = requiredId(name, rec as unknown as Record<string, unknown>);
    if (expected !== null && rec.id !== expected) {
      result.rejected.push({ table: name, id: rec.id, error: `id must be ${expected}` });
      continue;
    }
    const m = byTable.get(name) ?? new Map<string, AnySyncRecord>();
    if (incomingWins(m.get(rec.id), rec)) m.set(rec.id, rec);
    byTable.set(name, m);
  }
  // Without this line nobody notices that a device keeps records the server refuses (ids and
  // reasons only, never contents).
  if (result.rejected.length)
    log.warn('sync records rejected', {
      userId,
      count: result.rejected.length,
      rejected: result.rejected.slice(0, 20),
    });
  if (byTable.size === 0) return result;

  await db.transaction(async (tx) => {
    await lockUser(tx, userId);
    for (const [name, records] of byTable) {
      const t = table(name) as unknown as PgTable & { userId: any; id: any };
      const ids = [...records.keys()];
      const existing = (await tx
        .select()
        .from(t)
        .where(and(eq(t.userId, userId), inArray(t.id, ids)))) as Record<string, unknown>[];
      const current = new Map(existing.map((r) => [r.id as string, toWire(r)]));
      const winners: AnySyncRecord[] = [];
      for (const rec of records.values()) {
        if (incomingWins(current.get(rec.id), rec)) winners.push(rec);
        else result.stale.push({ table: name, id: rec.id });
      }
      if (winners.length === 0) continue;
      const cols = getTableColumns(t);
      const set: Record<string, unknown> = {};
      for (const [key, col] of Object.entries(cols)) {
        if (key === 'userId' || key === 'id') continue;
        set[key] =
          key === 'changeSeq' ? sql`nextval('sync_seq')` : sql.raw(`excluded."${snakeCase(col.name)}"`);
      }
      await tx
        .insert(t)
        .values(winners.map((w) => ({ ...w, userId, changeSeq: sql`nextval('sync_seq')` })) as any)
        .onConflictDoUpdate({ target: [t.userId, t.id], set });
      result.applied += winners.length;
    }
  });
  return result;
}

const EPOCH_KEY = 'sync_epoch';

/** The current sync epoch; created on first use (a fresh database or one from before epochs). */
export async function syncEpoch(db: Pick<Db, 'select' | 'insert'>): Promise<string> {
  const read = async () =>
    (await db.select().from(appMeta).where(eq(appMeta.key, EPOCH_KEY)))[0]?.value ?? null;
  const current = await read();
  if (current) return current;
  await db.insert(appMeta).values({ key: EPOCH_KEY, value: crypto.randomUUID() }).onConflictDoNothing();
  return (await read())!;
}

/**
 * Replaces the epoch `seen` by a new one and returns the epoch now in force. When another request
 * rotated it meanwhile, that one stays (one rotation per restore, not one per device).
 */
export async function rotateEpoch(
  db: Pick<Db, 'select' | 'update'>,
  seen: string,
  context: Record<string, unknown> = {},
): Promise<string> {
  const next = crypto.randomUUID();
  const rows = await db
    .update(appMeta)
    .set({ value: next })
    .where(and(eq(appMeta.key, EPOCH_KEY), eq(appMeta.value, seen)))
    .returning();
  if (rows.length === 0) {
    const [row] = await db.select().from(appMeta).where(eq(appMeta.key, EPOCH_KEY));
    return row?.value ?? seen;
  }
  log.warn('sync epoch rotated: cursor beyond sequence', context);
  return next;
}

export async function pull(
  db: Db,
  userId: string,
  since: number,
  limit = MAX_PULL_RECORDS,
): Promise<PullResult> {
  // One snapshot for all tables: a push committing between two table reads would otherwise show
  // its higher sequence (in a later table) but not its lower one, and the cursor would skip it.
  const epoch = await syncEpoch(db);
  const { perTable, last } = await db.transaction(
    async (tx) => {
      // Highest sequence value ever handed out (global over all users), so no cursor can be above it.
      const [seq] = (await tx.execute(
        sql`select case when is_called then last_value else last_value - 1 end as last from sync_seq`,
      )) as unknown as { last: string | number }[];
      const tables = await Promise.all(
        SYNC_TABLES.map(async (name) => {
          const t = table(name) as unknown as PgTable & { userId: any; changeSeq: any };
          const rows = (await tx
            .select()
            .from(t)
            .where(and(eq(t.userId, userId), gt(t.changeSeq, since)))
            .orderBy(asc(t.changeSeq))
            .limit(limit + 1)) as Record<string, unknown>[];
          return rows.map((r) => ({ table: name, seq: r.changeSeq as number, data: toWire(r) }));
        }),
      );
      return { perTable: tables, last: Number(seq?.last ?? 0) };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
  if (since > last) {
    // The database is older than what this device has seen: it was restored from a backup.
    const rotated = await rotateEpoch(db, epoch, { userId, since, last });
    return { changes: [], cursor: 0, hasMore: false, serverTime: Date.now(), epoch: rotated, reset: true };
  }
  const all = perTable.flat().sort((a, b) => a.seq - b.seq);
  // Each table returned its first limit+1 rows, so the first `limit` of the merge are complete.
  const page = all.slice(0, limit);
  const hasMore = all.length > limit;
  const cursor = page.length ? page[page.length - 1]!.seq : since;
  return {
    changes: page.map(({ table: t, data }) => ({ table: t, data })),
    cursor,
    hasMore,
    serverTime: Date.now(),
    epoch,
  };
}
