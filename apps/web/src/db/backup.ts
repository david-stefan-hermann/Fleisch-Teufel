/**
 * The JSON backup ("Daten & Sync"): a dump of every synced table, and the way back in. Restoring
 * brings back only what is missing: every record keeps the version it had in the backup
 * (`importRecord`), so the last-write-wins rule decides against the device and the server, and a
 * change or deletion made after the backup was taken always wins. The page syncs first, so the device
 * knows those newer versions before anything is imported. Records deleted in the backup are skipped.
 *
 * Free of `@/` aliases on purpose (the API test suite imports `db/*`).
 */
import { requiredId, SYNC_SCHEMAS, SYNC_TABLES, type AnySyncRecord, type SyncTable } from '@ft/shared';
import type { UserDb } from './dexie';
import { importRecord } from './write';

export interface Backup {
  app: 'fleisch-teufel';
  exportedAt: string;
  version: string;
  [table: string]: unknown;
}

export interface RestoreResult {
  restored: number;
  /** Records the device already had in the same or a newer version, and deleted ones. */
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
      const expected = parsed.success ? requiredId(table, raw as Record<string, unknown>) : null;
      if (!parsed.success || (expected !== null && parsed.data.id !== expected)) {
        result.invalid[table] = (result.invalid[table] ?? 0) + 1;
        continue;
      }
      // As written in the backup: fields of a newer app version stay (Zod would strip them).
      const rec = raw as AnySyncRecord;
      if (rec.deleted || !(await importRecord(db, table as SyncTable, rec as never))) {
        result.unchanged++;
        continue;
      }
      result.restored++;
    }
  }
  return result;
}
