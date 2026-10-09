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
import { resolveAppearance } from '@/lib/appearance';
import { buildChart } from '@/features/reports/chartData';
import { matchesTraining } from '@/features/exercise/training';
import { clampAmount, MAX_AMOUNT, roundAmount, sliderRange } from '@/lib/amounts';

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
  };

  it('comes back only for the same history entry', () => {
    stashFoodLogDraft('/food/x', 'k1', draft);
    expect(peekFoodLogDraft('/food/x', 'k1')).toEqual(draft);
    expect(peekFoodLogDraft('/food/x', 'k2')).toBeNull();
    expect(peekFoodLogDraft('/food/y', 'k1')).toBeNull();
    dropFoodLogDraft('/food/x');
    expect(peekFoodLogDraft('/food/x', 'k1')).toBeNull();
  });

  it('reads drafts of older versions that still carry extra days', () => {
    sessionStorage.setItem(
      'ft:foodlog:/food/x',
      JSON.stringify({ ...draft, extraDays: ['2026-10-07'], entryKey: 'k1' }),
    );
    expect(peekFoodLogDraft('/food/x', 'k1')).toEqual(draft);
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

describe('report chart: calories split by macros', () => {
  const row = (date: string, nutrients: Record<string, number>, logged = true) => ({
    date,
    logged,
    nutrients,
    targetKcal: 1700,
    targetProteinG: 130,
    targetFatG: 55,
    targetCarbsG: 170,
    exerciseKcal: 100,
    exerciseMinutes: 20,
    weightKg: null,
  });
  const rows = [
    row('2026-10-05', { ENERCC: 620, PROT625: 35, CHO: 60, FAT: 25 }),
    row('2026-10-06', { ENERCC: 300 }),
    row('2026-10-07', {}, false),
  ];

  it('stacks protein, carbs and fat up to the eaten kcal; legend only "Gegessen" and the target', () => {
    const { data, series, hasData } = buildChart(rows, 'kcal');
    expect(hasData).toBe(true);
    expect(series.filter((s) => s.legend !== false).map((s) => s.label)).toEqual([
      'Gegessen',
      'Ziel inkl. Training',
    ]);
    const [, total, pc, p, neutral, eaten, target] = data;
    // 35 g protein = 140 kcal, 60 g carbs = 240, 25 g fat = 225 → shares of 605 kcal of the macros.
    expect(total![0]).toBe(620);
    expect(p![0]).toBeCloseTo((620 * 140) / 605, 6);
    expect(pc![0]).toBeCloseTo((620 * 380) / 605, 6);
    // The segments add up to the eaten kcal: protein + carbs + fat = top of the stack.
    const fatPart = total![0]! - pc![0]!;
    expect(p![0]! + (pc![0]! - p![0]!) + fatPart).toBeCloseTo(620, 6);
    expect(neutral![0]).toBeNull();
    expect(eaten![0]).toBe(620);
    expect(target).toEqual([1800, 1800, 1800]);
  });

  it('draws a day without macros as one neutral bar and leaves days without entries empty', () => {
    const [, total, pc, p, neutral, eaten] = buildChart(rows, 'kcal').data;
    expect([total![1], pc![1], p![1]]).toEqual([null, null, null]);
    expect(neutral![1]).toBe(300);
    expect(eaten![1]).toBe(300);
    expect([total![2], pc![2], p![2], neutral![2], eaten![2]]).toEqual([null, null, null, null, null]);
  });

  it('keeps the series objects stable across periods (the chart only swaps data)', () => {
    expect(buildChart(rows, 'kcal').series).toBe(buildChart(rows.slice(0, 1), 'kcal').series);
  });
});

describe('appearance', () => {
  it('resolves the app theme and the icon variant', () => {
    expect(resolveAppearance('system', 'auto', true)).toMatchObject({ mode: 'dark', iconMode: 'dark' });
    expect(resolveAppearance('system', 'auto', false)).toMatchObject({ mode: 'light', iconMode: 'light' });
    expect(resolveAppearance('light', 'auto', true)).toMatchObject({ mode: 'light', iconMode: 'light' });
    expect(resolveAppearance('dark', 'light', false)).toMatchObject({ mode: 'dark', iconMode: 'light' });
    expect(resolveAppearance('light', 'dark', false)).toMatchObject({ mode: 'light', iconMode: 'dark' });
  });
});

describe('amount slider range', () => {
  it('puts the start exactly in the middle', () => {
    for (const start of [20, 80, 3050]) {
      const { min, max } = sliderRange(start, 'base');
      expect(min).toBe(0);
      expect((start - min) / (max - min)).toBe(0.5);
    }
    expect(sliderRange(1.1, 'portion')).toEqual({ min: 0, max: 2.2, step: 0.1 });
    expect(sliderRange(60, 'base').step).toBe(1);
  });

  it('shows 20 g, 80 g and 3050 g at different places of one range', () => {
    // The bug: the end followed the value, so every amount sat at the same spot.
    const { max } = sliderRange(80, 'base');
    const at = (g: number) => Math.min(g, max) / max;
    expect(new Set([at(20), at(80), at(3050)]).size).toBe(3);
  });

  it('does not grow while the value is dragged to the end again and again', () => {
    const start = 80;
    let value = start;
    for (let i = 0; i < 20; i++) value = sliderRange(start, 'base').max;
    expect(value).toBe(160);
  });

  it('never ends beyond the maximum of the field', () => {
    expect(sliderRange(6000, 'base').max).toBe(MAX_AMOUNT.base);
    expect(sliderRange(80, 'portion').max).toBe(MAX_AMOUNT.portion);
  });

  it('falls back to 100 g or one portion without a start amount', () => {
    expect(sliderRange(null, 'base').max).toBe(200);
    expect(sliderRange(0, 'portion').max).toBe(2);
  });

  it('keeps tiny starts usable', () => {
    expect(sliderRange(0.1, 'portion').max).toBe(0.2);
    expect(sliderRange(0.5, 'base').max).toBe(2);
  });

  it('clamps and rounds to the raster', () => {
    expect(clampAmount(0, 'base')).toBe(1);
    expect(clampAmount(12.6, 'base')).toBe(13);
    expect(clampAmount(1e21, 'base')).toBe(9999);
    expect(clampAmount(0.30000000000000004, 'portion')).toBe(0.3);
    expect(clampAmount(0, 'portion')).toBe(0.1);
    expect(clampAmount(150, 'portion')).toBe(99);
    expect(roundAmount(1.15, 'portion')).toBe(1.2);
  });
});
