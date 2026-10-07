/**
 * Review state of an AI photo analysis, stored on the queue item so it survives navigating to the
 * food search (to add an ingredient) and closing the app.
 */
import type { AiAnalysisResult, Food } from '@ft/shared';
import type { AiDraft, AiDraftRow, AiQueueItem, UserDb } from './dexie';

/** Initial rows from the analysis: first candidate preselected, grams rounded. */
export function draftFromResult(item: Pick<AiQueueItem, 'meal' | 'result'>): AiDraft {
  const result = item.result as AiAnalysisResult;
  return {
    meal: item.meal,
    mealName:
      result.dishName ??
      (result.items
        .slice(0, 3)
        .map((i) => i.name)
        .join(', ') ||
        'Foto-Meal'),
    rows: result.items.map((it, i) => ({
      key: `ai-${i}`,
      name: it.name,
      grams: Math.round(it.grams),
      confidence: it.confidence,
      candidates: it.candidates.map((c) => c.food),
      foodId: it.candidates[0]?.food.id ?? null,
    })),
  };
}

export function currentDraft(item: AiQueueItem): AiDraft {
  return item.draft ?? draftFromResult(item);
}

/** Applies a change to the draft (creating it from the result on first edit). */
export async function updateDraft(
  db: UserDb,
  localId: number,
  change: (d: AiDraft) => AiDraft,
): Promise<void> {
  await db.transaction('rw', db.aiQueue, async () => {
    const item = await db.aiQueue.get(localId);
    if (!item || item.status !== 'done') return;
    await db.aiQueue.update(localId, { draft: change(currentDraft(item)) });
  });
}

export function patchRow(d: AiDraft, key: string, patch: Partial<AiDraftRow>): AiDraft {
  return { ...d, rows: d.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) };
}

/** Adds an ingredient the model missed (from the food search). */
export async function addFoodToDraft(db: UserDb, localId: number, food: Food, grams: number): Promise<void> {
  await updateDraft(db, localId, (d) => ({
    ...d,
    rows: [
      ...d.rows,
      {
        key: `user-${Date.now().toString(36)}`,
        name: food.name,
        grams: Math.round(grams),
        confidence: null,
        candidates: [food],
        foodId: food.id,
      },
    ],
  }));
}
