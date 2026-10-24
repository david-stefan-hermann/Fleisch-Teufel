/**
 * All local writes to synced tables go through here: the record gets a new version
 * (`updatedAt`, strictly increasing) and is queued in the outbox in the same transaction,
 * so a crash can never leave a change that is not scheduled for upload.
 */
import { nextVersion, SYNC_SCHEMAS, type SyncRecordMap, type SyncTable } from '@ft/shared';
import type { UserDb } from './dexie';

type Input<T extends SyncTable> = Omit<SyncRecordMap[T], 'updatedAt' | 'deleted'> & { deleted?: boolean };

export async function saveRecord<T extends SyncTable>(
  db: UserDb,
  table: T,
  input: Input<T>,
): Promise<SyncRecordMap[T]> {
  return (await writeRecord(db, table, input.id, () => input))!;
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
    const record = {
      ...input,
      deleted: input.deleted ?? false,
      updatedAt: nextVersion(prev?.updatedAt, Date.now() + db.clockOffset),
    } as SyncRecordMap[T];
    // Validate before it can ever reach the server (a rejected record would be dropped there).
    SYNC_SCHEMAS[table].parse(record);
    await t.put(record);
    await db.outbox.put({ key: `${table}:${record.id}`, table, id: record.id, updatedAt: record.updatedAt });
    return record;
  });
}

/** Soft delete (tombstone) so the deletion syncs to other devices. */
export async function deleteRecord(db: UserDb, table: SyncTable, id: string): Promise<void> {
  await patchRecord(db, table, id, { deleted: true } as never);
}

/** Restores a soft-deleted record (undo). */
export async function restoreRecord(db: UserDb, table: SyncTable, id: string): Promise<void> {
  await patchRecord(db, table, id, { deleted: false } as never);
}
