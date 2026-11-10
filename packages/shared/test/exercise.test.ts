import { describe, expect, it } from 'vitest';
import {
  durationWheelValues,
  EXERCISE_TYPE_MAP,
  EXERCISE_TYPES,
  exerciseKcal,
  formatDuration,
  isAutoTrainingKcal,
  isStepsEntry,
  MAX_MINUTES,
  metFor,
  netExerciseKcal,
  STEPS_MET,
  stepsValues,
  trainingKcal,
} from '../src/exercise.js';
import { weightForDay } from '../src/forecast.js';

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

describe('training durations and kcal', () => {
  it('rounds the net kcal to whole kcal', () => {
    expect(trainingKcal(6.8, 80, 45)).toBe(348);
    expect(trainingKcal(0.5, 80, 45)).toBe(0);
  });

  it('formats durations in minutes and hours', () => {
    expect(formatDuration(45)).toBe('45 Min.');
    expect(formatDuration(60)).toBe('1 Std.');
    expect(formatDuration(75)).toBe('1 Std. 15 Min.');
    expect(formatDuration(360)).toBe('6 Std.');
  });

  it('builds the wheel raster with an extra value at its place', () => {
    const v = durationWheelValues();
    expect(v[0]).toBe(5);
    expect(v.slice(22, 26)).toEqual([115, 120, 135, 150]);
    expect(v.at(-1)).toBe(360);
    const with47 = durationWheelValues(47);
    expect(with47.slice(8, 11)).toEqual([45, 47, 50]);
    expect(durationWheelValues(45)).toEqual(v);
    expect(durationWheelValues(MAX_MINUTES + 1)).toEqual(v);
    expect(durationWheelValues(500).at(-1)).toBe(500);
  });
});

describe('steps from Apple Health', () => {
  it('turns the distance into walking time at 4,8 km/h and kcal like a training', () => {
    // 6,1 km at 80 m per minute: 76 minutes; (3,5 − 1) × 80 kg × 76/60 h = 253 kcal.
    expect(stepsValues({ steps: 8432, distanceM: 6100, weightKg: 80 })).toEqual({
      minutes: 76,
      kcal: 253,
      distanceM: 6100,
    });
    const v = stepsValues({ steps: 8432, distanceM: 6100, weightKg: 80 });
    expect(isAutoTrainingKcal({ kcal: v.kcal, met: STEPS_MET, weightKg: 80, minutes: v.minutes })).toBe(true);
  });

  it('falls back to 100 steps a minute without a believable distance', () => {
    expect(stepsValues({ steps: 8432, distanceM: null, weightKg: 80 })).toMatchObject({
      minutes: 84,
      distanceM: null,
    });
    // 0,05 m and 3 m per step are not a walk: the distance is dropped.
    expect(stepsValues({ steps: 10_000, distanceM: 500, weightKg: 80 }).distanceM).toBeNull();
    expect(stepsValues({ steps: 1000, distanceM: 3000, weightKg: 80 }).distanceM).toBeNull();
  });

  it('keeps the duration between one minute and a day', () => {
    expect(stepsValues({ steps: 20, distanceM: 15, weightKg: 80 }).minutes).toBe(1);
    expect(stepsValues({ steps: 200_000, distanceM: 150_000, weightKg: 80 }).minutes).toBe(MAX_MINUTES);
  });

  it('knows a steps entry by its type', () => {
    expect(isStepsEntry({ typeKey: 'steps' })).toBe(true);
    expect(isStepsEntry({ typeKey: 'walking' })).toBe(false);
  });
});

describe('weightForDay', () => {
  const points = [
    { date: '2026-11-03', kg: 81 },
    { date: '2026-11-01', kg: 82 },
  ];
  it('takes the last weight up to the day, before the first weigh-in the earliest', () => {
    expect(weightForDay(points, '2026-11-02')).toBe(82);
    expect(weightForDay(points, '2026-11-10')).toBe(81);
    expect(weightForDay(points, '2026-10-01')).toBe(82);
    expect(weightForDay([], '2026-10-01')).toBeUndefined();
  });
});
