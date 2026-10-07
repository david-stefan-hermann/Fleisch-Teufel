import { rescaleItem, uuidv7, type Meal, type MealItem } from '@ft/shared';
import type { UserDb } from '@/db/dexie';
import { saveRecord } from '@/db/write';

/** Logs every item of a saved meal (optionally scaled, e.g. 0.5 for half) into a diary meal. */
export async function logItems(
  db: UserDb,
  items: MealItem[],
  target: { date: string; meal: number },
  opts: { factor?: number; mealId?: string | null } = {},
): Promise<number> {
  const factor = opts.factor ?? 1;
  const now = Date.now();
  let i = 0;
  for (const item of items) {
    const scaled = factor === 1 ? item : rescaleItem(item, Math.round(item.quantity * factor * 1000) / 1000);
    await saveRecord(db, 'foodEntries', {
      ...scaled,
      id: uuidv7(),
      date: target.date,
      meal: target.meal,
      loggedAt: now + i++,
      mealId: opts.mealId ?? null,
      aiAnalysisId: null,
    });
  }
  return items.length;
}

export function mealKcal(m: Pick<Meal, 'items'>): number {
  return m.items.reduce((s, i) => s + (i.nutrients.ENERCC ?? 0), 0);
}
