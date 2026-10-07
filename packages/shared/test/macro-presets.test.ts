import { describe, expect, it } from 'vitest';
import { mealSchema, settingsSchema } from '../src/schemas.js';
import { defaultMacros, kcalFromMacros, MACRO_PRESETS, macrosForPlan, planFromPreset } from '../src/tdee.js';

describe('macro presets', () => {
  it('scale protein with body weight and fill the calories', () => {
    for (const p of MACRO_PRESETS) {
      const m = macrosForPlan(2000, 80, planFromPreset(p.id));
      expect(m.proteinG).toBe(Math.round(p.proteinPerKg * 80));
      expect(Math.abs(kcalFromMacros(m) - 2000)).toBeLessThan(15);
    }
  });

  it('low carb fixes carbohydrates and lets fat fill the rest', () => {
    const m = macrosForPlan(2000, 80, planFromPreset('low_carb'));
    expect(m.carbsG).toBe(100); // 20 % of 2000 kcal / 4
    expect(m.proteinG).toBe(144);
    expect(m.fatG).toBe(Math.round((2000 - 144 * 4 - 100 * 4) / 9));
  });

  it('caps protein at 35 % of energy for heavy people on small budgets', () => {
    const m = defaultMacros(1500, 140, { proteinPerKg: 2.0 });
    expect(m.proteinG).toBe(Math.round((1500 * 0.35) / 4));
  });

  it('keeps carbs and fat non-negative when protein is high', () => {
    const m = defaultMacros(1200, 120, { proteinPerKg: 2.5, fatPct: 40 });
    expect(m.carbsG).toBeGreaterThanOrEqual(0);
    const lc = defaultMacros(1200, 120, { proteinPerKg: 2.5, carbsPct: 70 });
    expect(lc.fatG).toBeGreaterThanOrEqual(0);
  });
});

describe('schema defaults for newer fields', () => {
  it('fills macroPlan and photoId with null for older records', () => {
    const settings = settingsSchema.parse({
      id: 'profile',
      updatedAt: 1,
      deleted: false,
      sex: null,
      birthDate: null,
      heightCm: null,
      activityLevel: 'light',
      targetWeightKg: null,
      weeklyRateKg: 0,
      mealNames: ['Frühstück', 'Mittagessen', 'Abendessen', 'Snacks'],
      addExerciseCalories: true,
      onboardedAt: null,
    });
    expect(settings.macroPlan).toBeNull();
    const meal = mealSchema.parse({
      id: 'm',
      updatedAt: 1,
      deleted: false,
      name: 'Müsli',
      items: [
        {
          foodId: null,
          source: 'quick',
          name: 'Müsli',
          brand: null,
          grams: null,
          portionLabel: null,
          portionGrams: null,
          quantity: 1,
          per100: null,
          nutrients: { ENERCC: 300 },
        },
      ],
    });
    expect(meal.photoId).toBeNull();
  });
});
