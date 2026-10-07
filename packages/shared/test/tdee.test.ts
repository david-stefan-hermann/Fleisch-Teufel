import { describe, expect, it } from 'vitest';
import {
  bmrMifflinStJeor,
  calorieGoal,
  dailyDeltaForWeeklyRate,
  defaultMacros,
  kcalFromMacros,
  tdee,
} from '../src/tdee.js';

describe('Mifflin-St Jeor', () => {
  it('matches the published formula', () => {
    // 10·80 + 6.25·180 − 5·30 + 5 = 1780
    expect(bmrMifflinStJeor({ sex: 'male', ageYears: 30, heightCm: 180, weightKg: 80 })).toBe(1780);
    // 10·60 + 6.25·165 − 5·40 − 161 = 1270.25
    expect(bmrMifflinStJeor({ sex: 'female', ageYears: 40, heightCm: 165, weightKg: 60 })).toBeCloseTo(
      1270.25,
    );
  });

  it('applies activity factors', () => {
    expect(tdee({ sex: 'male', ageYears: 30, heightCm: 180, weightKg: 80 }, 'moderate')).toBeCloseTo(
      1780 * 1.55,
    );
  });

  it('derives the daily deficit from the weekly rate (7700 kcal/kg)', () => {
    expect(dailyDeltaForWeeklyRate(-0.5)).toBeCloseTo(-550);
  });

  it('builds a calorie goal and clamps to a safe minimum', () => {
    const g = calorieGoal({ sex: 'male', ageYears: 30, heightCm: 180, weightKg: 80 }, 'sedentary', -0.5);
    expect(g.tdee).toBe(2136);
    expect(g.kcal).toBe(1590);
    expect(g.clamped).toBe(false);
    const low = calorieGoal({ sex: 'female', ageYears: 70, heightCm: 150, weightKg: 45 }, 'sedentary', -1);
    expect(low.kcal).toBe(1200);
    expect(low.clamped).toBe(true);
  });
});

describe('default macros', () => {
  it('splits protein by weight, fat by share, carbs as rest', () => {
    const m = defaultMacros(2000, 80);
    expect(m.proteinG).toBe(144);
    expect(m.fatG).toBe(67);
    expect(m.carbsG).toBe(206);
    expect(kcalFromMacros(m)).toBeGreaterThan(1990);
    expect(kcalFromMacros(m)).toBeLessThan(2010);
  });

  it('caps protein at 35 % of energy', () => {
    const m = defaultMacros(1200, 120);
    expect(m.proteinG).toBe(105);
  });
});
