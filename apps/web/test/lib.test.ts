import { describe, expect, it } from 'vitest';
import { validGtin } from '@/components/BarcodeScanner';
import {
  fmtFixed,
  fmtGrams,
  fmtIngredients,
  fmtPercent,
  fmtRelativeDay,
  NO_VALUE,
  parseDecimal,
} from '@/lib/format';
import { defaultMealForNow } from '@/lib/meals';
import { errorMessage, ApiError, OfflineError } from '@/lib/api';
import { entryAmountLabel } from '@/features/diary/MealCard';
import { readExpanded, setGroupExpanded, writeExpanded } from '@/features/diary/expandedGroups';
import { dropFoodLogDraft, peekFoodLogDraft, stashFoodLogDraft } from '@/features/foods/foodLogDraft';
import { goBackOr } from '@/lib/history';
import { matchesTraining } from '@/features/exercise/training';

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

describe('fmtFixed', () => {
  it('always shows the given number of decimals', () => {
    expect(fmtFixed(80, 2)).toBe('80,00');
    expect(fmtFixed(84.5, 2)).toBe('84,50');
    expect(fmtFixed(84.555, 2)).toBe('84,56');
    expect(fmtFixed(1, 1)).toBe('1,0');
    expect(fmtFixed(1234.5, 0)).toBe('1.235');
  });
});

describe('goBackOr', () => {
  const history = (index: number | undefined) => {
    const calls: number[] = [];
    return { calls, location: { state: { __TSR_index: index } }, go: (d: number) => calls.push(d) };
  };

  it('goes back when the history has enough entries, else falls back', () => {
    const h = history(3);
    let fell = 0;
    goBackOr(h, 2, () => fell++);
    expect(h.calls).toEqual([-2]);
    const first = history(1);
    goBackOr(first, 2, () => fell++);
    expect(first.calls).toEqual([]);
    goBackOr(history(undefined), 1, () => fell++);
    expect(fell).toBe(2);
  });
});

describe('food page draft (pencil and back)', () => {
  const draft = {
    portion: { label: '1 Stück', grams: 120 },
    quantity: 2,
    meal: 3,
    extraDays: ['2026-10-07'],
  };

  it('comes back only for the same history entry', () => {
    stashFoodLogDraft('/food/x', 'k1', draft);
    expect(peekFoodLogDraft('/food/x', 'k1')).toEqual(draft);
    expect(peekFoodLogDraft('/food/x', 'k2')).toBeNull();
    expect(peekFoodLogDraft('/food/y', 'k1')).toBeNull();
    dropFoodLogDraft('/food/x');
    expect(peekFoodLogDraft('/food/x', 'k1')).toBeNull();
  });

  it('ignores broken or foreign data and entries without a key', () => {
    sessionStorage.setItem('ft:foodlog:/food/x', '{"entryKey":"k1","portion":{}}');
    expect(peekFoodLogDraft('/food/x', 'k1')).toBeNull();
    sessionStorage.setItem('ft:foodlog:/food/x', 'nope');
    expect(peekFoodLogDraft('/food/x', 'k1')).toBeNull();
    stashFoodLogDraft('/food/z', undefined, draft);
    expect(sessionStorage.getItem('ft:foodlog:/food/z')).toBeNull();
  });
});

describe('training quick search', () => {
  it('needs every word somewhere in name, sport or note, ignoring case and umlauts', () => {
    const fields = ['Bahntraining', 'Laufen, 10 km/h', 'Intervalle 6 × 400 m'];
    expect(matchesTraining('', fields)).toBe(true);
    expect(matchesTraining('  ', fields)).toBe(true);
    expect(matchesTraining('LAUF', fields)).toBe(true);
    expect(matchesTraining('bahn 400', fields)).toBe(true);
    expect(matchesTraining('bahn yoga', fields)).toBe(false);
    expect(matchesTraining('rücken', ['Rückentraining', null, undefined])).toBe(true);
    expect(matchesTraining('ruecken', ['Rückentraining'])).toBe(true);
  });
});
