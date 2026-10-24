/**
 * Recipe mode of saved meals: a meal has a weight after cooking (`cookedGrams`), so it can be
 * logged by grams eaten and saved as an own food per 100 g cooked (meal prep, leftovers). The
 * nutrients stay the sum of the ingredients; only the mass they sit in changes (Cronometer's
 * "cooked weight" idea, without inventing a water ingredient).
 */
import type { NutrientMap } from './nutrients.js';
import { multiplyNutrients, round, sumNutrients } from './nutrition.js';
import type { CustomFood, Meal, MealItem } from './schemas.js';

/** Sum of the ingredients' grams as logged (quick entries without grams count 0). */
export function mealRawGrams(items: readonly Pick<MealItem, 'grams'>[]): number {
  return round(
    items.reduce((s, i) => s + (i.grams ?? 0), 0),
    2,
  );
}

/** The weight the whole meal has: after cooking when known, else the raw sum; null when neither is above 0. */
export function mealWeightGrams(
  meal: Pick<Meal, 'items'> & Partial<Pick<Meal, 'cookedGrams'>>,
): number | null {
  const w = meal.cookedGrams ?? mealRawGrams(meal.items);
  return w > 0 ? w : null;
}

/** Nutrients of the whole meal. */
export function mealNutrients(items: readonly Pick<MealItem, 'nutrients'>[]): NutrientMap {
  return sumNutrients(items.map((i) => i.nutrients));
}

/** Nutrients per 100 g of the (cooked) meal; null when its weight is unknown. */
export function mealPer100(
  meal: Pick<Meal, 'items'> & Partial<Pick<Meal, 'cookedGrams'>>,
): NutrientMap | null {
  const weight = mealWeightGrams(meal);
  if (weight === null) return null;
  return multiplyNutrients(mealNutrients(meal.items), 100 / weight);
}

/** Factor of the whole meal that `grams` eaten are (0,5 for half of it); null when its weight is unknown. */
export function mealFactorForGrams(
  meal: Pick<Meal, 'items'> & Partial<Pick<Meal, 'cookedGrams'>>,
  grams: number,
): number | null {
  const weight = mealWeightGrams(meal);
  return weight === null ? null : round(grams / weight, 3);
}

/**
 * The meal as an own food ("Als Lebensmittel speichern"): per 100 g cooked, one portion for the
 * whole recipe (a quarter of it is "0,25 × Ganzes Rezept"). Returns null when the weight is unknown.
 */
export function foodFromMeal(
  meal: Pick<Meal, 'name' | 'items'> & Partial<Pick<Meal, 'cookedGrams'>>,
  id: string,
  name = meal.name,
): Omit<CustomFood, 'updatedAt' | 'deleted'> | null {
  const weight = mealWeightGrams(meal);
  const per100 = mealPer100(meal);
  if (weight === null || !per100) return null;
  const nutrients: NutrientMap = {};
  for (const [k, v] of Object.entries(per100)) nutrients[k] = round(v, 2);
  return {
    id,
    name: name.trim().slice(0, 200) || meal.name,
    brand: null,
    barcode: null,
    unit: 'g',
    nutrients,
    portions: [{ label: 'Ganzes Rezept', grams: round(weight, 2) }],
  };
}
