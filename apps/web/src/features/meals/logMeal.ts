import type { Meal } from '@ft/shared';

export { logItems } from '@/db/entries';

export function mealKcal(m: Pick<Meal, 'items'>): number {
  return m.items.reduce((s, i) => s + (i.nutrients.ENERCC ?? 0), 0);
}
