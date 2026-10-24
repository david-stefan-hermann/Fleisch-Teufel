/**
 * Review state of an AI photo analysis, stored on the queue item so it survives navigating to the
 * food search (to add an ingredient) and closing the app.
 */
import type { AiAnalysisResult, Food, Portion } from '@ft/shared';
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
      // Whole grams, but never 0 for something the model saw (a pinch of spice stays 1 g).
      grams: it.grams > 0 ? Math.max(1, Math.round(it.grams)) : 0,
      confidence: it.confidence,
      candidates: it.candidates.map((c) => c.food),
      foodId: it.candidates[0]?.food.id ?? null,
    })),
  };
}

export function currentDraft(item: AiQueueItem): AiDraft {
  return item.draft ?? draftFromResult(item);
}

/**
 * Whether the ingredients of the review differ from the analysis (amount, chosen food, removed or
 * added rows), so a re-analysis would throw changes away. Meal and name do not count.
 */
export function draftChanged(item: Pick<AiQueueItem, 'meal' | 'result' | 'draft'>): boolean {
  if (!item.draft || !item.result) return false;
  const now = item.draft.rows;
  const initial = draftFromResult(item).rows;
  return (
    now.length !== initial.length ||
    now.some((r, i) => {
      const o = initial[i]!;
      return r.key !== o.key || r.grams !== o.grams || r.foodId !== o.foodId;
    })
  );
}

/** Applies a change to the draft (creating it from the result on first edit). */
export async function updateDraft(
  db: UserDb,
  localId: number,
  change: (d: AiDraft) => AiDraft,
): Promise<boolean> {
  return db.transaction('rw', db.aiQueue, async () => {
    const item = await db.aiQueue.get(localId);
    // A review exists once there is a result (also after a failed re-analysis), not while it runs.
    if (!item?.result || item.status === 'pending' || item.status === 'analyzing') return false;
    await db.aiQueue.update(localId, { draft: change(currentDraft(item)) });
    return true;
  });
}

export function patchRow(d: AiDraft, key: string, patch: Partial<AiDraftRow>): AiDraft {
  return { ...d, rows: d.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) };
}

/** One confirmed ingredient of the review: the chosen food, its grams and the unit they were set in. */
export interface AiItem {
  food: Food;
  grams: number;
  portion?: Portion | null;
}

/**
 * Takes a food from the food search into the review: as the food of the row the search was opened
 * for ("Selbst suchen", `searchRowKey`; the row keeps its name, so the choice can be learned), else
 * as a new ingredient the model missed.
 */
export async function addFoodToDraft(
  db: UserDb,
  localId: number,
  food: Food,
  grams: number,
  /** The unit the amount was set in (kept for the row, like the review's own portions). */
  portion: Portion | null = null,
): Promise<boolean> {
  return updateDraft(db, localId, (d) => {
    const { searchRowKey, ...rest } = d;
    if (searchRowKey && d.rows.some((r) => r.key === searchRowKey))
      return {
        ...rest,
        rows: d.rows.map((r) =>
          r.key === searchRowKey
            ? {
                ...r,
                grams: Math.round(grams),
                candidates: [food, ...r.candidates.filter((c) => c.id !== food.id)],
                foodId: food.id,
                portion,
              }
            : r,
        ),
      };
    return {
      ...rest,
      rows: [
        ...d.rows,
        {
          key: `user-${Date.now().toString(36)}`,
          name: food.name,
          grams: Math.round(grams),
          confidence: null,
          candidates: [food],
          foodId: food.id,
          portion,
        },
      ],
    };
  });
}

/**
 * The foods the person picked instead of the proposed one, by the model's item name (rows of the
 * analysis only, estimated foods left out). Sent to the server when the review is logged, so the
 * next analysis offers them first.
 */
export function draftChoices(
  item: Pick<AiQueueItem, 'meal' | 'result'>,
  draft: AiDraft,
): { name: string; foodId: string }[] {
  if (!item.result) return [];
  const proposed = new Map(draftFromResult(item).rows.map((r) => [r.key, r.foodId]));
  return draft.rows.flatMap((r) => {
    const food = r.candidates.find((c) => c.id === r.foodId);
    if (!food || food.estimated || !proposed.has(r.key) || proposed.get(r.key) === food.id) return [];
    return [{ name: r.name, foodId: food.id }];
  });
}

/** Grams per row key, the reference point of the "Gesamtmenge" slider. */
export type RowGrams = Record<string, number | null>;

export function rowGrams(d: AiDraft): RowGrams {
  return Object.fromEntries(d.rows.map((r) => [r.key, r.grams]));
}

/**
 * Scales every row to `factor` × its grams in `base`: whole grams, or tenths of the row's portion
 * (at least 0,1). Scaling always starts from the base, not from the previous step, so moving the
 * slider back and forth does not accumulate rounding errors. Rows without amount (or missing from
 * `base`) stay as they are.
 */
export function scaleDraft(d: AiDraft, base: RowGrams, factor: number): AiDraft {
  return {
    ...d,
    rows: d.rows.map((r) => {
      const g = base[r.key];
      if (g == null) return r;
      const pg = r.portion?.grams;
      // Like the meal editor: scaling never takes an ingredient below 1 g.
      if (!pg) return { ...r, grams: Math.max(1, Math.round(g * factor)) };
      const pieces = Math.max(0.1, Math.round(((g * factor) / pg) * 10) / 10);
      return { ...r, grams: Math.round(pieces * pg * 100) / 100 };
    }),
  };
}
