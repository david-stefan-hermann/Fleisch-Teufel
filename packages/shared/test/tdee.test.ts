import { describe, expect, it } from 'vitest';
import {
  bmi,
  bmrMifflinStJeor,
  calorieGoal,
  currentWeeklyRate,
  dailyDeltaForWeeklyRate,
  defaultMacros,
  GOAL_KINDS,
  GOALS,
  goalKindOf,
  kcalFromMacros,
  kcalTarget,
  macrosExceedKcal,
  macrosForPlan,
  planFromPreset,
  tdee,
  weeklyRateForGoal,
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
    // 2136 − 550 = 1586 is a deficit above 25 %: 2136 × 0,75 = 1602.
    expect(g.kcal).toBe(1600);
    expect(g.clamped).toBe('deficit');
    expect(g.source).toBe('formula');
    expect(calorieGoal({ sex: 'male', ageYears: 30, heightCm: 180, weightKg: 80 }, 'sedentary', -0.4)).toMatchObject({
      kcal: 1700,
      clamped: null,
    });
    const low = calorieGoal({ sex: 'female', ageYears: 70, heightCm: 150, weightKg: 45 }, 'sedentary', -1);
    expect(low.kcal).toBe(1200);
    expect(low.clamped).toBe('minimum');
  });
});

describe('default macros', () => {
  it('splits protein by weight, fat by share, carbs as rest', () => {
    const m = defaultMacros(2000, 80);
    expect(m.proteinG).toBe(160);
    expect(m.fatG).toBe(67);
    expect(m.carbsG).toBe(190);
    expect(kcalFromMacros(m)).toBeGreaterThan(1990);
    expect(kcalFromMacros(m)).toBeLessThan(2010);
  });

  it('does not cap protein', () => {
    const m = defaultMacros(1200, 120);
    expect(m.proteinG).toBe(240);
    expect(m.carbsG).toBe(0);
  });

  it('keeps fat at 0.5 g per kg at least', () => {
    // 25 % of 1200 kcal = 33 g, floor 30 g: the share wins.
    expect(defaultMacros(1200, 60, { proteinPerKg: 2, fatPct: 25 }).fatG).toBe(33);
    // 25 % of 1500 kcal = 42 g, floor 50 g: the floor wins.
    expect(defaultMacros(1500, 100, { proteinPerKg: 2, fatPct: 25 }).fatG).toBe(50);
    // Low carb: fat is the rest, but never below the floor.
    expect(defaultMacros(1500, 100, { proteinPerKg: 3, carbsPct: 20 }).fatG).toBe(50);
  });

  it('tells when protein and fat alone exceed the target', () => {
    expect(macrosExceedKcal(2000, 80, planFromPreset('cut'))).toBe(false);
    expect(macrosExceedKcal(1200, 120, planFromPreset('cut'))).toBe(true);
    expect(macrosExceedKcal(1200, 120, planFromPreset('low_carb'))).toBe(true);
  });
});

describe('goals', () => {
  it('turns the goal into a weekly rate by body weight', () => {
    expect(weeklyRateForGoal('lose', 80)).toBe(-0.4);
    expect(weeklyRateForGoal('maintain', 80)).toBe(0);
    expect(weeklyRateForGoal('gain_beginner', 80)).toBe(0.2);
    expect(weeklyRateForGoal('gain_advanced', 80)).toBe(0.08);
    expect(weeklyRateForGoal('lose', 93.3)).toBe(-0.47);
  });

  it('reads the goal of older settings from the sign of the rate', () => {
    expect(goalKindOf({ goalKind: null, weeklyRateKg: -0.5 })).toBe('lose');
    expect(goalKindOf({ goalKind: null, weeklyRateKg: 0 })).toBe('maintain');
    expect(goalKindOf({ goalKind: null, weeklyRateKg: 0.25 })).toBe('gain_beginner');
    expect(goalKindOf({ goalKind: 'gain_advanced', weeklyRateKg: 0.25 })).toBe('gain_advanced');
  });

  it('lets the rate follow the weight while a goal is stored', () => {
    expect(currentWeeklyRate({ goalKind: 'lose', weeklyRateKg: -0.4 }, 90)).toBe(-0.45);
    expect(currentWeeklyRate({ goalKind: null, weeklyRateKg: -0.75 }, 90)).toBe(-0.75);
    expect(currentWeeklyRate({ goalKind: 'lose', weeklyRateKg: -0.4 }, undefined)).toBe(-0.4);
  });

  it('computes the control table (man, 80 kg, 178 cm, expenditure 2150 kcal)', () => {
    const p = { sex: 'male' as const, ageYears: 35, heightCm: 178, weightKg: 80 };
    const expected = {
      lose: [1710, 176, 48, 145, -0.4],
      maintain: [2150, 160, 72, 216, 0],
      gain_beginner: [2370, 160, 66, 284, 0.2],
      gain_advanced: [2240, 160, 62, 260, 0.08],
    };
    for (const kind of GOAL_KINDS) {
      const rate = weeklyRateForGoal(kind, 80);
      const g = calorieGoal(p, 'sedentary', rate, { expenditureKcal: 2150 });
      expect(g.source).toBe('data');
      expect(g.tdee).toBe(2150);
      const m = macrosForPlan(g.kcal, 80, planFromPreset(GOALS[kind].preset));
      expect([g.kcal, m.proteinG, m.fatG, m.carbsG, rate]).toEqual(expected[kind]);
    }
  });
});

describe('kcal target', () => {
  it('limits the deficit to 25 % of the expenditure (30 % from BMI 30)', () => {
    expect(kcalTarget(2150, -0.4, { sex: 'male' })).toEqual({ kcal: 1710, clamped: null });
    // −1 kg a week = −1100 kcal, more than 25 % of 2400 (600).
    expect(kcalTarget(2400, -1, { sex: 'male', bmi: 25 })).toEqual({ kcal: 1800, clamped: 'deficit' });
    expect(kcalTarget(2400, -1, { sex: 'male', bmi: 32 })).toEqual({ kcal: 1680, clamped: 'deficit' });
    expect(kcalTarget(2400, -1, { sex: null })).toEqual({ kcal: 1800, clamped: 'deficit' });
  });

  it('never goes below the minimum, which wins when both limits apply', () => {
    expect(kcalTarget(1500, -0.25, { sex: 'female' })).toEqual({ kcal: 1230, clamped: null });
    expect(kcalTarget(1600, -0.25, { sex: 'male' })).toEqual({ kcal: 1500, clamped: 'minimum' });
    // 25 % of 1700 gives 1275, still below the 1500 for men.
    expect(kcalTarget(1700, -1, { sex: 'male' })).toEqual({ kcal: 1500, clamped: 'minimum' });
  });

  it('uses the BMI of the profile in calorieGoal', () => {
    const p = { sex: 'male' as const, ageYears: 40, heightCm: 175, weightKg: 110 };
    expect(bmi(110, 175)).toBeGreaterThan(30);
    const g = calorieGoal(p, 'sedentary', -1.1, { expenditureKcal: 2800 });
    expect(g).toMatchObject({ kcal: 1960, clamped: 'deficit' });
  });
});
