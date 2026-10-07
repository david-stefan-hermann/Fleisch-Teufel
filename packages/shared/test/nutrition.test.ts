import { describe, expect, it } from 'vitest';
import { completeNutrients, N, saltFromSodiumMg } from '../src/nutrients.js';
import { formatAmount, macroEnergyShares, round, scaleNutrients, sumNutrients } from '../src/nutrition.js';
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
