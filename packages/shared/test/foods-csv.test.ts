import { describe, expect, it } from 'vitest';
import { foodFromCompactBls, householdPortionsFor, parseServingGrams, portionsFor } from '../src/foods.js';
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

  it('offers only household measures that fit the food', () => {
    const labels = (food: Parameters<typeof householdPortionsFor>[0]) =>
      householdPortionsFor(food).map((p) => p.label.split(' ')[0]);
    const bls = (sourceId: string, name: string, unit: 'g' | 'ml' = 'g') =>
      labels({ unit, name, source: 'bls', sourceId });
    // Bread: nothing, neither by group nor by name.
    expect(bls('B301000', 'Toastbrot')).toEqual([]);
    expect(labels({ unit: 'g', name: 'Golden Toast Buttertoast', source: 'off', sourceId: '4000' })).toEqual(
      [],
    );
    expect(bls('Q120000', 'Olivenöl')).toEqual(['Teelöffel', 'Esslöffel']);
    expect(bls('C133000', 'Hafer Flocken')).toEqual(['Esslöffel', 'Schale']);
    expect(bls('N610000', 'Apfelsaft', 'ml')).toEqual(['Teelöffel', 'Esslöffel', 'Tasse', 'Glas', 'Becher']);
    expect(bls('M111000', 'Vollmilch frisch')).toEqual(['Esslöffel', 'Tasse', 'Glas', 'Becher']);
    expect(bls('M400000', 'Gouda Käse')).toEqual([]);
    expect(bls('D500000', 'Käsekuchen')).toEqual([]);
    expect(bls('X500000', 'Linsensuppe')).toEqual(['Esslöffel', 'Tasse', 'Schale']);
    expect(bls('U100000', 'Rind Hackfleisch')).toEqual([]);
    expect(bls('F110000', 'Apfel roh')).toEqual([]);
    // Without a BLS code only the name counts; unknown names get nothing, drinks always a glass.
    expect(labels({ unit: 'g', name: 'Knuspermüsli' })).toEqual(['Esslöffel', 'Schale']);
    expect(labels({ unit: 'g', name: 'Proteinriegel' })).toEqual([]);
    expect(labels({ unit: 'g', name: 'Schwein Kotelett' })).toEqual([]);
    expect(labels({ unit: 'g', name: 'Buttermilch' })).toContain('Glas');
    expect(labels({ unit: 'g', name: 'Salzkartoffeln' })).toEqual([]);
    expect(labels({ unit: 'g' })).toEqual([]);
    expect(labels({ unit: 'ml', name: 'Kakaogetränk' })).toContain('Glas');
    expect(labels({ unit: 'ml' })).toContain('Glas');
  });

  it('keeps grams, own and user portions for a food without household measures', () => {
    const p = portionsFor(
      { unit: 'g', name: 'Toastbrot', source: 'bls', sourceId: 'B301000', portions: [] },
      [{ label: 'Scheibe', grams: 25 }],
    );
    expect(p.map((x) => x.label)).toEqual(['Scheibe', '100 g', '1 g']);
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
