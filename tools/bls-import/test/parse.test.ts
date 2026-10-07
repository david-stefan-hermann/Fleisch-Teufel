import { describe, expect, it } from 'vitest';
import { cleanFloat, parseComponentRow, parseHeader, parseRow, parseValue } from '../src/parse.js';

const header = [
  'BLS Code',
  'Lebensmittelbezeichnung',
  'Food name',
  'ENERCC Energie (Kilokalorien) [kcal/100g]',
  'ENERCC Datenherkunft',
  'ENERCC Referenz',
  'F18:3CN3 Fettsäure C18:3 n-3 all-cis (Alpha-Linolensäure) [g/100g]',
  'F18:3CN3 Datenherkunft',
  'F18:3CN3 Referenz',
  'NA Natrium [mg/100g]',
  'NA Datenherkunft',
  'NA Referenz',
  'VITB12 Vitamin B12 (Cobalamine) [µg/100g]',
  'VITB12 Datenherkunft',
  'VITB12 Referenz',
  'Hinweis',
];

describe('BLS parser', () => {
  it('parses value column headers including codes with colons', () => {
    const h = parseHeader(header);
    expect(h.values.map((v) => [v.code, v.unit, v.index])).toEqual([
      ['ENERCC', 'kcal', 3],
      ['F18:3CN3', 'g', 6],
      ['NA', 'mg', 9],
      ['VITB12', 'µg', 12],
    ]);
    expect(h.noteIndex).toBe(15);
  });

  it('fails loudly on unexpected headers', () => {
    expect(() => parseHeader(['Code', 'Name'])).toThrow(/BLS Code/);
  });

  it('converts cells: numbers, no-data, below-limit and float noise', () => {
    expect(parseValue(343)).toBe(343);
    expect(parseValue(0.30000000000000004)).toBe(0.3);
    expect(parseValue('-')).toBeUndefined();
    expect(parseValue(null)).toBeUndefined();
    expect(parseValue('<LOD')).toBe(0);
    expect(parseValue('<LOD or <LOQ')).toBe(0);
    expect(parseValue('TR')).toBe(0);
    expect(parseValue('1,5')).toBe(1.5);
    expect(parseValue({ result: 12.5 })).toBe(12.5);
    expect(cleanFloat(11.375000000001)).toBe(11.375);
  });

  it('parses a data row', () => {
    const h = parseHeader(header);
    const row = [
      'C131000',
      'Hafer ganzes Korn, roh',
      'Oat whole grain, raw',
      343,
      'Formelberechnung',
      '-',
      1.03,
      'Literatur',
      'x',
      'TR',
      'Analyse',
      '-',
      '-',
      '-',
      '-',
      null,
    ];
    expect(parseRow(row, h)).toEqual({
      code: 'C131000',
      name: 'Hafer ganzes Korn, roh',
      nameEn: 'Oat whole grain, raw',
      note: null,
      nutrients: { ENERCC: 343, 'F18:3CN3': 1.03, NA: 0 },
    });
    expect(parseRow(['', 'leer'], h)).toBeNull();
    expect(parseRow(['M5B1600', 'Käse', 'Cheese'], h)?.code).toBe('M5B1600');
  });

  it('parses component catalog rows', () => {
    expect(
      parseComponentRow([
        40,
        'NACL',
        'Salz (Natriumchlorid)',
        'Salt (sodium chloride)',
        'g',
        'Elemente',
        'Elements',
        'NACL[g] = NA[g]*2.5',
        'x',
      ]),
    ).toEqual({
      code: 'NACL',
      de: 'Salz (Natriumchlorid)',
      en: 'Salt (sodium chloride)',
      unit: 'g',
      group: 'Elemente',
      groupEn: 'Elements',
    });
    expect(parseComponentRow(['Index', 'Nährstoffcode / Component code'])).toBeNull();
    expect(parseComponentRow([null, null])).toBeNull();
  });
});
