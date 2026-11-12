/**
 * Unsaved edits of a saved training (its editor), like `mealDraft.ts`: nothing is written to the
 * synced `exerciseTemplates` record until "Speichern"; the draft lives on this device in `kv` so it
 * survives the way through the training search ("Aktivität hinzufügen", `/exercise?into=training:<id>`
 * → sport page → back) and a reload. "Neues Training" is a draft with `isNew` and no record.
 *
 * Free of `@/` aliases on purpose (the API test suite imports `db/*`).
 */
import { trainingItemsOf, uuidv7, type ExerciseTemplate, type TrainingItem } from '@ft/shared';
import type { UserDb } from './dexie';
import { saveTraining, updateTraining } from './entries';

export interface TrainingDraft {
  templateId: string;
  name: string;
  items: TrainingItem[];
  pinned: boolean;
  /** `updatedAt` of the training the draft started from (another device may change it meanwhile). */
  baseUpdatedAt?: number;
  /** "Neues Training": there is no record yet; saving creates it under `templateId`. */
  isNew?: true;
}

export const trainingDraftKey = (templateId: string) => `trainingDraft:${templateId}`;

export function draftFromTraining(t: ExerciseTemplate): TrainingDraft {
  return {
    templateId: t.id,
    name: t.name,
    items: trainingItemsOf(t),
    pinned: t.pinned === true,
    baseUpdatedAt: t.updatedAt,
  };
}

/** Whether the training changed since the draft was started (another device, or a pull). */
export function isTrainingDraftStale(draft: TrainingDraft, t: Pick<ExerciseTemplate, 'updatedAt'>): boolean {
  return draft.baseUpdatedAt !== undefined && draft.baseUpdatedAt !== t.updatedAt;
}

const itemKey = (i: TrainingItem) =>
  JSON.stringify([i.typeKey, i.typeName, i.minutes, i.intensity, i.note?.trim() || null]);

/** Whether the draft differs from the saved training (name, activities, pin). */
export function isTrainingDirty(draft: TrainingDraft, t: ExerciseTemplate): boolean {
  return (
    (draft.name.trim() || t.name) !== t.name ||
    draft.pinned !== (t.pinned === true) ||
    draft.items.map(itemKey).join('|') !== trainingItemsOf(t).map(itemKey).join('|')
  );
}

export async function readTrainingDraft(db: UserDb, templateId: string): Promise<TrainingDraft | null> {
  const row = await db.kv.get(trainingDraftKey(templateId));
  return (row?.value as TrainingDraft | undefined) ?? null;
}

export async function writeTrainingDraft(db: UserDb, draft: TrainingDraft): Promise<void> {
  await db.kv.put({ key: trainingDraftKey(draft.templateId), value: draft });
}

export async function clearTrainingDraft(db: UserDb, templateId: string): Promise<void> {
  await db.kv.delete(trainingDraftKey(templateId));
}

/** "Neues Training": an empty draft under a new id, the record follows on "Speichern". Returns the id. */
export async function startNewTraining(db: UserDb): Promise<string> {
  const templateId = uuidv7();
  await writeTrainingDraft(db, { templateId, name: '', items: [], pinned: false, isNew: true });
  return templateId;
}

/** Stand-in for the record of a new training while only its draft exists (the editor needs one). */
export function newTrainingPlaceholder(templateId: string): ExerciseTemplate {
  return {
    id: templateId,
    name: '',
    typeKey: '-',
    typeName: '-',
    minutes: 30,
    intensity: 'moderate',
    note: null,
    extraItems: null,
    pinned: null,
    purgedAt: null,
    updatedAt: 0,
    deleted: false,
  };
}

/**
 * Writes the draft to the training (one synced change) and drops it; a new training's draft creates
 * the record. Returns false when the training is gone (deleted meanwhile).
 */
export async function saveTrainingDraft(db: UserDb, draft: TrainingDraft): Promise<boolean> {
  if (draft.items.length === 0) throw new Error('A saved training needs an activity');
  return db.transaction('rw', [db.exerciseTemplates, db.outbox, db.kv], async () => {
    const t = await db.exerciseTemplates.get(draft.templateId);
    if (!t && draft.isNew) {
      if (!draft.name.trim()) throw new Error('A saved training needs a name');
      await saveTraining(
        db,
        { name: draft.name, items: draft.items, pinned: draft.pinned },
        draft.templateId,
      );
    } else if (!(await updateTraining(db, draft.templateId, draft))) return false;
    await clearTrainingDraft(db, draft.templateId);
    return true;
  });
}

/**
 * Appends an activity to the draft of a saved training (the search with `into=training:<id>`),
 * starting a draft from the saved training when there is none. Returns false when it is gone.
 */
export async function addActivityToTraining(
  db: UserDb,
  templateId: string,
  item: TrainingItem,
): Promise<boolean> {
  return db.transaction('rw', [db.exerciseTemplates, db.kv], async () => {
    const t = await db.exerciseTemplates.get(templateId);
    const saved = await readTrainingDraft(db, templateId);
    if (!t && !saved?.isNew) return false;
    if (t?.deleted) return false;
    const draft = saved ?? draftFromTraining(t!);
    await writeTrainingDraft(db, { ...draft, items: [...draft.items, item] });
    return true;
  });
}
