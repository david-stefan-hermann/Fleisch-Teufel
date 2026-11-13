/** Undo of an assistant turn. Free of `@/` aliases (API tests import `db/*`). */
import type { UndoStep, UserDb } from './dexie';
import { deleteRecord, patchRecord, restoreRecord } from './write';

/** Runs undo steps backwards in one transaction; records that are gone are skipped silently. */
export async function runUndo(db: UserDb, steps: readonly UndoStep[]): Promise<void> {
  const tables = [...new Set(steps.map((s) => db.syncTable(s.table)))];
  await db.transaction('rw', [...tables, db.outbox], async () => {
    for (const step of [...steps].reverse()) {
      const table = db.syncTable(step.table);
      if (step.kind === 'patch') {
        if (await table.get(step.id)) await patchRecord(db, step.table, step.id, step.fields as never);
        continue;
      }
      for (const id of step.ids) {
        const rec = await table.get(id);
        if (!rec) continue;
        if (step.kind === 'delete' && !rec.deleted) await deleteRecord(db, step.table, id);
        if (step.kind === 'restore' && rec.deleted) await restoreRecord(db, step.table, id);
      }
    }
  });
}
