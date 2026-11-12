/**
 * All local writes to synced tables go through here: the record gets a new version
 * (`updatedAt`, strictly increasing) and is queued in the outbox in the same transaction,
 * so a crash can never leave a change that is not scheduled for upload.
 */
import {
  incomingWins,
  nextVersion,
  requiredId,
  SYNC_SCHEMAS,
  type SyncRecordMap,
  type SyncTable,
} from '@ft/shared';
import type { UserDb } from './dexie';

/**
 * Tables whose tombstones show in the trash and can be removed from it for good ("Papierkorb leeren"):
 * the record gets `purgedAt` and stays a tombstone for the sync.
 */
export const PURGEABLE_TABLES = ['weightEntries', 'meals', 'exerciseTemplates', 'exerciseEntries'] as const;
export type PurgeableTable = (typeof PURGEABLE_TABLES)[number];

function isPurgeable(table: SyncTable): table is PurgeableTable {
  return (PURGEABLE_TABLES as readonly string[]).includes(table);
}

type Input<T extends SyncTable> = Omit<SyncRecordMap[T], 'updatedAt' | 'deleted' | 'purgedAt'> & {
  deleted?: boolean;
  purgedAt?: number | null;
};

export async function saveRecord<T extends SyncTable>(
  db: UserDb,
  table: T,
  input: Input<T>,
): Promise<SyncRecordMap[T]> {
  return (await writeRecord(db, table, input.id, () => input))!;
}

/**
 * Saves a record over the stored one: fields the input does not name keep their stored value. Use it
 * wherever a page builds a record from its form fields, so a field added by a newer app version
 * (synced in, unknown to this code) survives the save instead of being dropped. `build` gets the
 * record as stored right now (read in the write transaction). Always a live record afterwards.
 */
export async function upsertRecord<T extends SyncTable>(
  db: UserDb,
  table: T,
  id: string,
  build: (prev: SyncRecordMap[T] | undefined) => Input<T>,
): Promise<SyncRecordMap[T]> {
  return (await writeRecord(db, table, id, (prev) => {
    const input = build(prev);
    return { ...prev, ...input, deleted: input.deleted ?? false } as Input<T>;
  }))!;
}

/**
 * Partial update of an existing record. The current version is read inside the write transaction,
 * so a pull (or a second patch) landing in between cannot be overwritten with stale fields.
 */
export async function patchRecord<T extends SyncTable>(
  db: UserDb,
  table: T,
  id: string,
  patch: Partial<Omit<SyncRecordMap[T], 'id' | 'updatedAt'>>,
): Promise<SyncRecordMap[T] | undefined> {
  return writeRecord(db, table, id, (prev) => (prev ? ({ ...prev, ...patch } as Input<T>) : undefined));
}

/** Read-modify-write of one record and its outbox entry in a single transaction. */
async function writeRecord<T extends SyncTable>(
  db: UserDb,
  table: T,
  id: string,
  build: (prev: SyncRecordMap[T] | undefined) => Input<T> | undefined,
): Promise<SyncRecordMap[T] | undefined> {
  return db.transaction('rw', [db.syncTable(table), db.outbox], async () => {
    const t = db.syncTable(table);
    const prev = (await t.get(id)) as SyncRecordMap[T] | undefined;
    const input = build(prev);
    if (!input) return undefined;
    const deleted = input.deleted ?? false;
    const record = {
      ...input,
      // A live record is never purged: deleting it again puts it back into the trash.
      ...(isPurgeable(table) && { purgedAt: deleted ? (input.purgedAt ?? null) : null }),
      deleted,
      updatedAt: nextVersion(prev?.updatedAt, Date.now() + db.clockOffset),
    } as SyncRecordMap[T];
    // Validate before it can ever reach the server (a rejected record would be dropped there).
    validate(table, record);
    await t.put(record);
    await db.outbox.put({ key: `${table}:${record.id}`, table, id: record.id, updatedAt: record.updatedAt });
    return record;
  });
}

/** The checks of the server's push: the schema and the fixed id of one-per-day records. */
function validate(table: SyncTable, record: SyncRecordMap[SyncTable]): void {
  SYNC_SCHEMAS[table].parse(record);
  const expected = requiredId(table, record as unknown as Record<string, unknown>);
  if (expected !== null && record.id !== expected) throw new Error(`id must be ${expected}`);
}

/**
 * Takes a record from a JSON backup as it is, with the version it had (`updatedAt` is kept), so the
 * last-write-wins rule decides against the device and later the server: a newer change or deletion
 * there always beats the backup. Returns false when the device's record wins (nothing written).
 */
export async function importRecord<T extends SyncTable>(
  db: UserDb,
  table: T,
  record: SyncRecordMap[T],
): Promise<boolean> {
  validate(table, record);
  return db.transaction('rw', [db.syncTable(table), db.outbox], async () => {
    const t = db.syncTable(table);
    if (!incomingWins(await t.get(record.id), record)) return false;
    await t.put(record);
    await db.outbox.put({ key: `${table}:${record.id}`, table, id: record.id, updatedAt: record.updatedAt });
    return true;
  });
}

/** Soft delete (tombstone) so the deletion syncs to other devices. */
export async function deleteRecord(db: UserDb, table: SyncTable, id: string): Promise<void> {
  await patchRecord(db, table, id, { deleted: true } as never);
}

/** Restores a soft-deleted record (undo, trash); a live record is never purged (`purgedAt` back to null). */
export async function restoreRecord(db: UserDb, table: SyncTable, id: string): Promise<void> {
  await patchRecord(db, table, id, { deleted: false } as never);
}
