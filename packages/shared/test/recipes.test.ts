import { describe, expect, it } from 'vitest';
import { N } from '../src/nutrients.js';
import {
  foodFromMeal,
  mealFactorForGrams,
  mealPer100,
  mealRawGrams,
  mealWeightGrams,
} from '../src/recipes.js';
import type { MealItem } from '../src/schemas.js';

const item = (name: string, grams: number, kcalPer100: number): MealItem => ({
  foodId: `bls:${name}`,
  source: 'bls',
  name,
  brand: null,
  grams,
  portionLabel: '1 g',
  portionGrams: 1,
  quantity: grams,
  per100: { [N.kcal]: kcalPer100, [N.protein]: 10 },
  nutrients: { [N.kcal]: (kcalPer100 * grams) / 100, [N.protein]: (10 * grams) / 100 },
});

// 500 g dry rice (350 kcal/100 g) and 300 g chicken (110): 1 750 + 330 = 2 080 kcal in 800 g raw.
const items = [item('Reis', 500, 350), item('Huhn', 300, 110)];

describe('recipe mode', () => {
  it('sums the raw weight and uses the cooked weight when given', () => {
    expect(mealRawGrams(items)).toBe(800);
    expect(mealWeightGrams({ items })).toBe(800);
    expect(mealWeightGrams({ items, cookedGrams: 1600 })).toBe(1600);
    expect(mealWeightGrams({ items: [{ grams: null }] as MealItem[] })).toBeNull();
  });

  it('computes per 100 g of the cooked meal: same nutrients, more mass', () => {
    expect(mealPer100({ items })![N.kcal]).toBe(260);
    // Rice takes up water: 1 600 g cooked, so 130 kcal per 100 g.
    expect(mealPer100({ items, cookedGrams: 1600 })![N.kcal]).toBe(130);
    expect(mealPer100({ items, cookedGrams: 1600 })![N.protein]).toBe(5);
  });

  it('turns grams eaten into the factor of the whole meal', () => {
    expect(mealFactorForGrams({ items, cookedGrams: 1600 }, 400)).toBe(0.25);
    expect(mealFactorForGrams({ items }, 400)).toBe(0.5);
    expect(mealFactorForGrams({ items: [] }, 400)).toBeNull();
  });

  it('makes an own food per 100 g cooked with the whole recipe as a portion', () => {
    const food = foodFromMeal({ name: 'Reis mit Huhn', items, cookedGrams: 1600 }, 'f1', ' Meal-Prep Reis ')!;
    expect(food).toMatchObject({
      id: 'f1',
      name: 'Meal-Prep Reis',
      unit: 'g',
      brand: null,
      barcode: null,
      portions: [{ label: 'Ganzes Rezept', grams: 1600 }],
    });
    expect(food.nutrients[N.kcal]).toBe(130);
    expect(foodFromMeal({ name: 'x', items: [] }, 'f2')).toBeNull();
  });
});
