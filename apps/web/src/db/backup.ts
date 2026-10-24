/**
 * The JSON backup ("Daten & Sync"): a dump of every synced table, and the way back in. Restoring
 * writes every record through `saveRecord`, so it gets a fresh version, lands in the outbox and
 * reaches the server and the other devices like any edit. Records a device knows in a newer state are
 * skipped (a backup never undoes what happened after it was taken); tombstones stay tombstones.
 *
 * Free of `@/` aliases on purpose (the API test suite imports `db/*`).
 */
import { SYNC_SCHEMAS, SYNC_TABLES, type AnySyncRecord, type SyncTable } from '@ft/shared';
import type { UserDb } from './dexie';
import { saveRecord } from './write';

export interface Backup {
  app: 'fleisch-teufel';
  exportedAt: string;
  version: string;
  [table: string]: unknown;
}

export interface RestoreResult {
  restored: number;
  /** Records the device already had in the same or a newer version. */
  unchanged: number;
  /** Records that do not match the schema of this app version (listed by table). */
  invalid: Record<string, number>;
}

export async function createBackup(db: UserDb, version: string): Promise<Backup> {
  const dump: Backup = { app: 'fleisch-teufel', exportedAt: new Date().toISOString(), version };
  for (const t of SYNC_TABLES) dump[t] = await db.syncTable(t).toArray();
  return dump;
}

export function parseBackup(text: string): Backup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Die Datei ist kein JSON.');
  }
  if (!data || typeof data !== 'object' || (data as Backup).app !== 'fleisch-teufel')
    throw new Error('Das ist keine Fleisch-Teufel-Sicherung.');
  return data as Backup;
}

export async function restoreBackup(db: UserDb, backup: Backup): Promise<RestoreResult> {
  const result: RestoreResult = { restored: 0, unchanged: 0, invalid: {} };
  for (const table of SYNC_TABLES) {
    const rows = backup[table];
    if (!Array.isArray(rows)) continue;
    for (const raw of rows) {
      const parsed = SYNC_SCHEMAS[table].safeParse(raw);
      if (!parsed.success) {
        result.invalid[table] = (result.invalid[table] ?? 0) + 1;
        continue;
      }
      const rec = parsed.data as AnySyncRecord;
      const current = await db.syncTable(table as SyncTable).get(rec.id);
      if (current && current.updatedAt >= rec.updatedAt) {
        result.unchanged++;
        continue;
      }
      const { updatedAt: _u, ...rest } = rec;
      await saveRecord(db, table as SyncTable, rest as never);
      result.restored++;
    }
  }
  return result;
}
