import { describe, expect, it } from 'vitest';
import { foodFromCompactBls, parseServingGrams, portionsFor } from '../src/foods.js';
import { toCsv } from '../src/csv.js';

describe('foods', () => {
  it('expands compact BLS rows', () => {
    const f = foodFromCompactBls([
      'C131000',
      'Hafer ganzes Korn, roh',
      'Oat whole grain, raw',
      343,
      1443,
      11.4,
      7.1,
      55,
      9.7,
      1,
      1.2,
      0.01,
      4,
      null,
    ]);
    expect(f).toMatchObject({ id: 'bls:C131000', group: 'Getreide & Getreideprodukte', unit: 'g' });
    expect(f.nutrients.ENERCC).toBe(343);
    expect(f.nutrients.ALC).toBeUndefined();
  });

  it('parses serving sizes', () => {
    expect(parseServingGrams('1 Riegel (45g)')).toBe(45);
    expect(parseServingGrams('2 Scheiben (37,5 g)')).toBe(37.5);
    expect(parseServingGrams('0.33 l')).toBe(330);
    expect(parseServingGrams('25 cl')).toBe(250);
    expect(parseServingGrams('1 Stück')).toBeNull();
  });

  it('offers user and food portions first, de-duplicated', () => {
    const p = portionsFor({ unit: 'g', portions: [{ label: '1 Riegel', grams: 45 }] }, [
      { label: 'Meine Schale', grams: 80 },
    ]);
    expect(p[0]!.label).toBe('Meine Schale');
    expect(p[1]!.label).toBe('1 Riegel');
    expect(p.filter((x) => x.label === '100 g')).toHaveLength(1);
  });
});

describe('csv', () => {
  const cols = [
    { header: 'Name', value: (r: { n: string; v: number }) => r.n },
    { header: 'Wert', value: (r: { n: string; v: number }) => r.v },
  ];

  it('writes German Excel CSV with BOM and decimal comma', () => {
    const s = toCsv([{ n: 'Käse; alt', v: 1.5 }], cols);
    expect(s).toBe('\uFEFFName;Wert\r\n"Käse; alt";1,5\r\n');
  });

  it('writes standard CSV and neutralizes formulas', () => {
    const s = toCsv([{ n: '=HYPERLINK("x")', v: -2 }], cols, 'standard');
    expect(s).toBe('Name,Wert\r\n"\'=HYPERLINK(""x"")",-2\r\n');
  });
});
