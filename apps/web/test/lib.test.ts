import { describe, expect, it } from 'vitest';
import { validGtin } from '@/components/BarcodeScanner';
import { fmtGrams, fmtIngredients, fmtPercent, fmtRelativeDay, NO_VALUE, parseDecimal } from '@/lib/format';
import { defaultMealForNow } from '@/lib/meals';
import { errorMessage, ApiError, OfflineError } from '@/lib/api';
import { entryAmountLabel } from '@/features/diary/MealCard';
import { readExpanded, setGroupExpanded, writeExpanded } from '@/features/diary/expandedGroups';

describe('format', () => {
  it('parses German and English decimals', () => {
    expect(parseDecimal('1,5')).toBe(1.5);
    expect(parseDecimal(' 2.25 ')).toBe(2.25);
    expect(parseDecimal('')).toBeNaN();
    expect(parseDecimal('1,2,3')).toBeNaN();
    expect(parseDecimal('abc')).toBeNaN();
  });

  it('formats grams with non-breaking spaces and sensible precision', () => {
    expect(fmtGrams(230.4)).toBe('230 g');
    expect(fmtGrams(12.34)).toBe('12,3 g');
    expect(fmtGrams(0.456)).toBe('0,46 g');
  });

  it('formats percentages and the missing-value placeholder', () => {
    expect(fmtPercent(1.2)).toBe('120\u00a0%');
    expect(fmtIngredients(1)).toBe('1\u00a0Zutat');
    expect(fmtIngredients(3)).toBe('3\u00a0Zutaten');
    expect(fmtPercent(0.25)).toBe('25\u00a0%');
    expect(NO_VALUE).toBe('\u2013');
  });

  it('names relative days', () => {
    expect(fmtRelativeDay('2026-10-07', '2026-10-07')).toBe('Heute');
    expect(fmtRelativeDay('2026-10-06', '2026-10-07')).toBe('Gestern');
    expect(fmtRelativeDay('2026-10-01', '2026-10-07')).toContain('Oktober');
  });
});

describe('barcodes', () => {
  it('checks GTIN check digits', () => {
    expect(validGtin('4000417025005')).toBe(true);
    expect(validGtin('4000417025006')).toBe(false);
    expect(validGtin('96385074')).toBe(true); // EAN-8
    expect(validGtin('036000291452')).toBe(true); // UPC-A
    expect(validGtin('12345')).toBe(false);
  });
});

describe('meal slot by time', () => {
  it('picks the meal for the time of day', () => {
    const at = (h: number, m = 0) => defaultMealForNow(new Date(2026, 9, 7, h, m));
    expect([at(7), at(10, 29), at(10, 30), at(14, 59), at(18), at(22)]).toEqual([0, 0, 1, 1, 2, 3]);
  });
});

describe('labels', () => {
  it('describes entry amounts', () => {
    expect(
      entryAmountLabel({
        source: 'bls',
        quantity: 1.5,
        portionLabel: '100 g',
        portionGrams: 100,
        grams: 150,
      }),
    ).toBe('150 g');
    expect(
      entryAmountLabel({ source: 'off', quantity: 2, portionLabel: 'Riegel', portionGrams: 45, grams: 90 }),
    ).toBe('2 × Riegel · 90 g');
    expect(
      entryAmountLabel({ source: 'quick', quantity: 1, portionLabel: null, portionGrams: null, grams: null }),
    ).toBe('Schnell hinzugefügt');
  });

  it('turns API errors into actionable German messages', () => {
    expect(errorMessage(new OfflineError())).toMatch(/WireGuard/);
    expect(errorMessage(new ApiError(401, 'invalid_credentials'))).toBe('E-Mail oder Passwort stimmt nicht.');
    expect(errorMessage(new ApiError(500, 'x'))).toMatch(/500/);
  });
});

describe('expanded diary groups', () => {
  it('remembers expanded group ids in sessionStorage', () => {
    sessionStorage.clear();
    expect(readExpanded().size).toBe(0);
    setGroupExpanded('g1', true);
    setGroupExpanded('g2', true);
    setGroupExpanded('g1', false);
    expect([...readExpanded()]).toEqual(['g2']);
    writeExpanded(new Set(['a', 'b']));
    expect(readExpanded()).toEqual(new Set(['a', 'b']));
  });

  it('treats broken or foreign data as nothing expanded', () => {
    sessionStorage.setItem('ft.diary.expanded', '{not json');
    expect(readExpanded().size).toBe(0);
    sessionStorage.setItem('ft.diary.expanded', '{"a":1}');
    expect(readExpanded().size).toBe(0);
    sessionStorage.setItem('ft.diary.expanded', '["a",2,null]');
    expect([...readExpanded()]).toEqual(['a']);
    sessionStorage.clear();
  });
});
