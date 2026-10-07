import { describe, expect, it } from 'vitest';
import { completeNutrients, N, saltFromSodiumMg } from '../src/nutrients.js';
import {
  energyBreakdown,
  formatAmount,
  macroEnergyShares,
  round,
  scaleNutrients,
  sumNutrients,
  wholePercents,
} from '../src/nutrition.js';
import { computeItem, quickAddNutrients, rescaleItem } from '../src/diary.js';

describe('nutrition math', () => {
  it('scales per-100 g values', () => {
    expect(scaleNutrients({ ENERCC: 343, PROT625: 11.375 }, 40)).toEqual({ ENERCC: 137.2, PROT625: 4.55 });
  });

  it('sums maps and removes float noise', () => {
    expect(sumNutrients([{ FAT: 0.1 }, { FAT: 0.2, CHO: 1 }])).toEqual({ FAT: 0.3, CHO: 1 });
    expect(round(0.1 + 0.2)).toBe(0.3);
  });

  it('derives salt/sodium and kJ/kcal without overwriting', () => {
    expect(saltFromSodiumMg(400)).toBe(1);
    const c = completeNutrients({ ENERCJ: 418.4, NA: 400 });
    expect(c[N.kcal]).toBeCloseTo(100);
    expect(c[N.salt]).toBe(1);
    expect(completeNutrients({ NACL: 2, NA: 1 })[N.sodium]).toBe(1);
  });

  it('computes macro energy shares', () => {
    const s = macroEnergyShares({ protein: 25, fat: 10, carbs: 25 });
    expect(s.protein + s.fat + s.carbs).toBeCloseTo(100);
    expect(s.fat).toBeCloseTo(31.03, 1);
  });

  it('splits energy into macro shares that fill the bar and sum to 100 %', () => {
    const b = energyBreakdown({ ENERCC: 200, PROT625: 10, CHO: 20, FAT: 5 });
    expect(b.kcal).toBe(200);
    expect(b.macros.protein).toMatchObject({ grams: 10, kcal: 40, percent: 24 });
    expect(b.macros.carbs).toMatchObject({ grams: 20, kcal: 80, percent: 49 });
    expect(b.macros.fat).toMatchObject({ grams: 5, kcal: 45, percent: 27 });
    expect(b.macros.protein.share + b.macros.carbs.share + b.macros.fat.share).toBeCloseTo(1);
    // The macro kcal (165) may differ from the reported energy (fibre, alcohol): headline stays 200.
    expect(b.macros.protein.kcal + b.macros.carbs.kcal + b.macros.fat.kcal).toBe(165);
    // Mockup example: 35 g / 60 g / 25 g → 23 / 40 / 37 %.
    const m = energyBreakdown({ ENERCC: 620, PROT625: 35, CHO: 60, FAT: 25 });
    expect([m.macros.protein.percent, m.macros.carbs.percent, m.macros.fat.percent]).toEqual([23, 40, 37]);
  });

  it('gives 100 % to a single macro and zeros (no NaN) for an empty map', () => {
    const only = energyBreakdown({ ENERCC: 100, CHO: 25 });
    expect(only.macros.carbs).toMatchObject({ share: 1, percent: 100, kcal: 100 });
    expect(only.macros.fat).toMatchObject({ share: 0, percent: 0, grams: 0 });
    for (const map of [{}, undefined]) {
      const b = energyBreakdown(map);
      expect(b.kcal).toBe(0);
      for (const k of ['protein', 'carbs', 'fat'] as const)
        expect(b.macros[k]).toEqual({ grams: 0, kcal: 0, share: 0, percent: 0 });
    }
  });

  it('rounds percents with the largest remainder', () => {
    expect(wholePercents([1, 1, 1])).toEqual([34, 33, 33]);
    expect(wholePercents([0.242, 0.485, 0.273])).toEqual([24, 49, 27]);
    expect(wholePercents([0, 0, 0])).toEqual([0, 0, 0]);
    for (const s of [
      [3, 7, 11],
      [0.1, 0.1, 0.8],
      [5, 0, 0],
    ])
      expect(wholePercents(s).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('formats German numbers', () => {
    expect(formatAmount(1234.4, 'kcal')).toBe('1.234 kcal');
    expect(formatAmount(2.345, 'g')).toBe('2,3 g');
    expect(formatAmount(0.456)).toBe('0,46');
  });

  it('computes portions × quantity and rescales items', () => {
    const r = computeItem({
      per100: { ENERCC: 200 },
      portionGrams: 30,
      portionLabel: 'Riegel',
      quantity: 1.5,
    });
    expect(r).toEqual({ grams: 45, nutrients: { ENERCC: 90 } });
    const item = {
      grams: 45,
      portionGrams: 30,
      quantity: 1.5,
      per100: { ENERCC: 200 },
      nutrients: r.nutrients,
    };
    expect(rescaleItem(item, 3)).toMatchObject({ grams: 90, nutrients: { ENERCC: 180 } });
    const quick = {
      grams: null,
      portionGrams: null,
      quantity: 1,
      per100: null,
      nutrients: quickAddNutrients({ kcal: 300, proteinG: 20 }),
    };
    expect(rescaleItem(quick, 2).nutrients).toEqual({ ENERCC: 600, PROT625: 40 });
  });
});
