/**
 * Last-write-wins sync over all user tables.
 *
 * Push: records are validated with the shared Zod schemas, compared with the stored version
 * using the shared `incomingWins` rule and upserted; every stored write gets a fresh value from
 * the global `sync_seq` sequence. A per-user advisory lock serializes pushes of one user so
 * sequence values become visible in commit order, so a puller can never skip a lower value that
 * commits later.
 *
 * Pull: returns records with change_seq > cursor across all tables, merged in sequence order.
 */
import {
  incomingWins,
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
import { syncTables } from '../db/schema.js';

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

export async function push(db: Db, userId: string, req: PushRequest): Promise<PushResult> {
  const result: PushResult = { applied: 0, stale: [], rejected: [] };

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
    const expected = requiredId(name, rec as unknown as Record<string, unknown>);
    if (expected !== null && rec.id !== expected) {
      result.rejected.push({ table: name, id: rec.id, error: `id must be ${expected}` });
      continue;
    }
    const m = byTable.get(name) ?? new Map<string, AnySyncRecord>();
    if (incomingWins(m.get(rec.id), rec)) m.set(rec.id, rec);
    byTable.set(name, m);
  }
  if (byTable.size === 0) return result;

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
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

export async function pull(
  db: Db,
  userId: string,
  since: number,
  limit = MAX_PULL_RECORDS,
): Promise<PullResult> {
  const perTable = await Promise.all(
    SYNC_TABLES.map(async (name) => {
      const t = table(name) as unknown as PgTable & { userId: any; changeSeq: any };
      const rows = (await db
        .select()
        .from(t)
        .where(and(eq(t.userId, userId), gt(t.changeSeq, since)))
        .orderBy(asc(t.changeSeq))
        .limit(limit + 1)) as Record<string, unknown>[];
      return rows.map((r) => ({ table: name, seq: r.changeSeq as number, data: toWire(r) }));
    }),
  );
  const all = perTable.flat().sort((a, b) => a.seq - b.seq);
  // Each table returned its first limit+1 rows, so the first `limit` of the merge are complete.
  const page = all.slice(0, limit);
  const hasMore = all.length > limit;
  const cursor = page.length ? page[page.length - 1]!.seq : since;
  return { changes: page.map(({ table: t, data }) => ({ table: t, data })), cursor, hasMore };
}
