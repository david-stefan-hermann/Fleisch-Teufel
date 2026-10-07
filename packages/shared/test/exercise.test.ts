import { describe, expect, it } from 'vitest';
import { EXERCISE_TYPE_MAP, EXERCISE_TYPES, exerciseKcal, metFor, netExerciseKcal } from '../src/exercise.js';

describe('exercise', () => {
  it('has ~30+ unique activities with sane MET values', () => {
    expect(EXERCISE_TYPES.length).toBeGreaterThanOrEqual(30);
    expect(EXERCISE_TYPE_MAP.size).toBe(EXERCISE_TYPES.length);
    for (const t of EXERCISE_TYPES) {
      for (const v of Object.values(t.met)) {
        expect(v).toBeGreaterThan(1);
        expect(v).toBeLessThan(20);
      }
    }
  });

  it('computes MET × kg × h', () => {
    expect(exerciseKcal(8, 75, 30)).toBe(300);
    expect(netExerciseKcal(8, 75, 30)).toBe(262.5);
  });

  it('falls back to moderate when an intensity is missing', () => {
    expect(metFor(EXERCISE_TYPE_MAP.get('golf')!, 'vigorous')).toBe(4.8);
  });
});
