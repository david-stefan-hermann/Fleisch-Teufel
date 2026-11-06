import { describe, expect, it } from 'vitest';
import {
  durationWheelValues,
  EXERCISE_TYPE_MAP,
  EXERCISE_TYPES,
  exerciseKcal,
  formatDuration,
  MAX_MINUTES,
  metFor,
  netExerciseKcal,
  trainingKcal,
} from '../src/exercise.js';

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
