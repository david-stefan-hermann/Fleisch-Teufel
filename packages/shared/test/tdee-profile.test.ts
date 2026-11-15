import { describe, expect, it } from 'vitest';
import { bmrMifflinStJeor, bodyProfile, calorieGoal } from '../src/tdee.js';

describe('body profile without a sex', () => {
  const base = { ageYears: 30, heightCm: 175, weightKg: 75 };
  it('uses the mean of both constants and a mean minimum', () => {
    const m = bmrMifflinStJeor({ ...base, sex: 'male' });
    const f = bmrMifflinStJeor({ ...base, sex: 'female' });
    expect(bmrMifflinStJeor({ ...base, sex: null })).toBeCloseTo((m + f) / 2, 5);
    const g = calorieGoal({ sex: null, ageYears: 60, heightCm: 150, weightKg: 45 }, 'sedentary', -1);
    expect(Number.isFinite(g.kcal)).toBe(true);
    expect(g.kcal).toBe(1350);
    expect(g.clamped).toBe('minimum');
  });

  it('takes the expenditure from own data instead of the formula', () => {
    const p = { sex: 'female' as const, ageYears: 30, heightCm: 168, weightKg: 62 };
    const formula = calorieGoal(p, 'light', 0);
    expect(formula.source).toBe('formula');
    const data = calorieGoal(p, 'light', -0.31, { expenditureKcal: 2050 });
    expect(data).toMatchObject({ tdee: 2050, kcal: 1710, source: 'data', clamped: null });
    expect(data.bmr).toBe(formula.bmr);
    expect(calorieGoal(p, 'light', 0, { expenditureKcal: null }).source).toBe('formula');
  });

  it('builds the profile from the settings on a date, or none while something is missing', () => {
    const s = { sex: 'female' as const, birthDate: '1990-06-15', heightCm: 168 };
    expect(bodyProfile(s, 62, '2026-10-24')).toEqual({
      sex: 'female',
      ageYears: 36,
      heightCm: 168,
      weightKg: 62,
    });
    expect(bodyProfile({ ...s, heightCm: null }, 62, '2026-10-24')).toBeNull();
    expect(bodyProfile(s, undefined, '2026-10-24')).toBeNull();
  });
});
