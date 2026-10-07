/** Diary write operations used by several screens (kept outside components: pure data logic). */
import {
  computeItem,
  uuidv7,
  type AiAnalysisResult,
  type ExerciseEntry,
  type Food,
  type FoodEntry,
} from '@ft/shared';
import type { UserDb } from './dexie';
import { saveRecord } from './write';

export type NewFoodEntry = Omit<FoodEntry, 'id' | 'updatedAt' | 'deleted' | 'date' | 'loggedAt'>;

/** Logs the same item on one or more days (multi-day log). */
export async function logFoodEntry(db: UserDb, item: NewFoodEntry, dates: string[]): Promise<void> {
  const now = Date.now();
  for (const [i, date] of dates.entries()) {
    await saveRecord(db, 'foodEntries', { ...item, id: uuidv7(), date, loggedAt: now + i });
  }
}

export async function saveExercise(
  db: UserDb,
  data: Omit<ExerciseEntry, 'id' | 'updatedAt' | 'deleted' | 'loggedAt'>,
  existing: ExerciseEntry | null,
): Promise<void> {
  if (existing) await saveRecord(db, 'exerciseEntries', { ...existing, ...data });
  else await saveRecord(db, 'exerciseEntries', { ...data, id: uuidv7(), loggedAt: Date.now() });
}

/** Saves the confirmed items of an AI photo analysis as diary entries (source "ai"). */
export async function saveAiItems(
  db: UserDb,
  items: { food: Food; grams: number }[],
  target: { date: string; meal: number },
  analysis: Pick<AiAnalysisResult, 'analysisId'>,
): Promise<void> {
  const now = Date.now();
  for (const [i, { food, grams }] of items.entries()) {
    const { nutrients } = computeItem({
      per100: food.nutrients,
      portionLabel: '1 g',
      portionGrams: 1,
      quantity: grams,
    });
    await saveRecord(db, 'foodEntries', {
      id: uuidv7(),
      date: target.date,
      meal: target.meal,
      loggedAt: now + i,
      foodId: food.id,
      source: 'ai',
      name: food.name,
      brand: food.brand,
      grams,
      portionLabel: food.unit === 'ml' ? '1 ml' : '1 g',
      portionGrams: 1,
      quantity: grams,
      per100: food.nutrients,
      nutrients,
      mealId: null,
      aiAnalysisId: analysis.analysisId,
    });
  }
}
