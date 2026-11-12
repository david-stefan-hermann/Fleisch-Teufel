import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validGtin } from '@/components/BarcodeScanner';
import {
  fmtDayLongYear,
  fmtFixed,
  fmtGrams,
  fmtIngredients,
  fmtPercent,
  fmtRelativeDay,
  NO_VALUE,
  parseDecimal,
} from '@/lib/format';
import { defaultMealForNow, logTargetFor, STICKY_MEAL_MS } from '@/lib/meals';
import { errorMessage, ApiError, OfflineError } from '@/lib/api';
import { entryAmountLabel } from '@/features/diary/MealCard';
import { readExpanded, setGroupExpanded, writeExpanded } from '@/features/diary/expandedGroups';
import { dropFoodLogDraft, peekFoodLogDraft, stashFoodLogDraft } from '@/features/foods/foodLogDraft';
import { goBackOr } from '@/lib/history';
import { clearLogStart, rememberLogStart, returnToDiary, type LogFlowRouter } from '@/lib/logFlow';
import { resetDiaryScroll, showInDiary } from '@/features/diary/diaryScroll';
import { shareDayFileName } from '@/features/diary/share/shareDay';
import { resolveAppearance, setDiaryMacrosPref, startAppearance } from '@/lib/appearance';
import { buildChart } from '@/features/reports/chartData';
import { matchesTraining, trainingTitle } from '@/features/exercise/training';
import {
  convertAmount,
  editorPortions,
  MAX_AMOUNT,
  nearestIndex,
  normalizeAmount,
  positiveAmount,
  roundAmount,
  wheelValues,
} from '@/lib/amounts';
import { itemPortion, itemWithAmount } from '@/features/meals/IngredientCard';
import { today, type MealItem } from '@ft/shared';

describe('format', () => {
  it('parses German and English decimals', () => {
    expect(parseDecimal('1,5')).toBe(1.5);
    expect(parseDecimal(' 2.25 ')).toBe(2.25);
    // German thousands grouping is not a decimal point.
    expect(parseDecimal('1.000')).toBe(1000);
    expect(parseDecimal('12.500,5')).toBe(12500.5);
    expect(parseDecimal('1.5')).toBe(1.5);
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

describe('meal for the next entry (20 minute rule)', () => {
  const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).getTime();
  const TODAY = '2026-11-06';
  const YESTERDAY = '2026-11-05';
  const logged = (date: string, meal: number, loggedAt: number) => ({ date, meal, loggedAt });
  const target = (now: number, entries: ReturnType<typeof logged>[], shownDate = TODAY) =>
    logTargetFor({ shownDate, today: TODAY, now, entries });

  it('stays in the meal of the last entry for 20 minutes, then follows the clock', () => {
    // Breakfast logged at 10:25; at 10:40 the clock says lunch.
    const entries = [logged(TODAY, 0, at(6, 8)), logged(TODAY, 0, at(6, 10, 25))];
    expect(target(at(6, 10, 40), entries)).toEqual({ date: TODAY, meal: 0 });
    expect(target(at(6, 10, 44), entries)).toEqual({ date: TODAY, meal: 0 });
    expect(target(at(6, 10, 46), entries)).toEqual({ date: TODAY, meal: 1 });
    // Nothing logged: the clock.
    expect(target(at(6, 18), [])).toEqual({ date: TODAY, meal: 2 });
    expect(STICKY_MEAL_MS).toBe(20 * 60_000);
  });

  it('follows an entry that was moved to another meal (its time stays)', () => {
    // Logged into lunch at 12:00, dragged to snacks: the next one goes to snacks.
    expect(target(at(6, 12, 10), [logged(TODAY, 3, at(6, 12))])).toEqual({ date: TODAY, meal: 3 });
  });

  it('counts only the youngest entry, deleted ones not at all', () => {
    const entries = [logged(TODAY, 1, at(6, 12)), logged(TODAY, 2, at(6, 12, 5))];
    expect(target(at(6, 12, 10), entries)).toEqual({ date: TODAY, meal: 2 });
    expect(
      logTargetFor({
        shownDate: TODAY,
        today: TODAY,
        now: at(6, 12, 10),
        entries: [...entries.slice(0, 1), { ...entries[1]!, deleted: true }],
      }),
    ).toEqual({ date: TODAY, meal: 1 });
  });

  it('over midnight the late entry still belongs to yesterday, for 20 minutes', () => {
    const late = [logged(YESTERDAY, 3, at(5, 23, 55))];
    expect(target(at(6, 0, 10), late)).toEqual({ date: YESTERDAY, meal: 3 });
    // 00:20: 25 minutes later, a new day begins with breakfast.
    expect(target(at(6, 0, 20), late)).toEqual({ date: TODAY, meal: 0 });
  });

  it('an entry added to yesterday today triggers nothing', () => {
    // At 14:00 something was added to yesterday's dinner; at 14:05 the "+" means today, by the clock.
    expect(target(at(6, 14, 5), [logged(YESTERDAY, 2, at(6, 14))])).toEqual({ date: TODAY, meal: 1 });
  });

  it('on a past day the shown day and the clock decide', () => {
    const entries = [logged(TODAY, 0, at(6, 12))];
    expect(target(at(6, 12, 5), entries, '2026-11-04')).toEqual({ date: '2026-11-04', meal: 1 });
    expect(target(at(6, 12, 5), entries, YESTERDAY)).toEqual({ date: YESTERDAY, meal: 1 });
  });

  it('a photo that waits for its analysis counts like an entry', () => {
    expect(
      logTargetFor({
        shownDate: TODAY,
        today: TODAY,
        now: at(6, 15, 10),
        entries: [logged(TODAY, 0, at(6, 9))],
        pending: [{ date: TODAY, meal: 1, createdAt: at(6, 14, 58) }],
      }),
    ).toEqual({ date: TODAY, meal: 1 });
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
    ).toBe('Schnell eingetragen');
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

describe('logging flow: back to the diary', () => {
  /** A router whose history is at `index`; `go` lands on `landing` and reports it like the router does. */
  const fakeRouter = (index: number, landing = { pathname: '/', search: {} as { date?: string } }) => {
    const went: number[] = [];
    const navigated: { to: string; search: { date: string }; replace: boolean }[] = [];
    const listeners = new Set<(e: { toLocation: typeof landing }) => void>();
    const router: LogFlowRouter = {
      history: {
        location: { state: { __TSR_index: index } },
        go: (d) => {
          went.push(d);
          queueMicrotask(() => [...listeners].forEach((fn) => fn({ toLocation: landing })));
        },
      },
      subscribe: (_event, fn) => {
        listeners.add(fn as never);
        return () => listeners.delete(fn as never);
      },
      navigate: async (opts) => void navigated.push(opts),
    };
    return { router, went, navigated, listeners };
  };
  const startAt = (index: number, path: string, date: string) =>
    rememberLogStart({ location: { state: { __TSR_index: index } }, go: () => {} }, { path, date });
  const TODAY = today();

  beforeEach(() => {
    sessionStorage.clear();
    resetDiaryScroll();
  });

  it('goes back to the diary the flow started on and drops the forms from the history', async () => {
    startAt(2, '/', TODAY);
    const { router, went, navigated, listeners } = fakeRouter(5);
    await returnToDiary(router, { date: TODAY, focus: { rows: ['e1'], meal: 2 } });
    expect(went).toEqual([-3]);
    expect(navigated).toEqual([]);
    expect(listeners.size).toBe(0);
    // The start is used up: a second return has nothing to go back to.
    await returnToDiary(router, { date: TODAY });
    expect(went).toEqual([-3]);
    expect(navigated).toEqual([{ to: '/', search: { date: TODAY }, replace: true }]);
  });

  it('replaces the form with the diary when the flow started elsewhere', async () => {
    const replaced = [{ to: '/', search: { date: '2026-11-05' }, replace: true }];
    // Another day than the diary showed (logged for yesterday after midnight).
    startAt(2, '/', '2026-11-06');
    let r = fakeRouter(5);
    await returnToDiary(r.router, { date: '2026-11-05' });
    expect(r.went).toEqual([]);
    expect(r.navigated).toEqual(replaced);
    // Another page (the meal page, another tab).
    startAt(2, '/diary-meal', '2026-11-05');
    r = fakeRouter(5);
    await returnToDiary(r.router, { date: '2026-11-05' });
    expect(r.navigated).toEqual(replaced);
    // No start at all (reload, deep link), or one that is not behind the current page.
    r = fakeRouter(5);
    await returnToDiary(r.router, { date: '2026-11-05' });
    expect(r.navigated).toEqual(replaced);
    startAt(5, '/', '2026-11-05');
    r = fakeRouter(5);
    await returnToDiary(r.router, { date: '2026-11-05' });
    expect(r.went).toEqual([]);
    expect(r.navigated).toEqual(replaced);
  });

  it('falls back when the history entry is not the diary of that day after all', async () => {
    startAt(1, '/', '2026-11-05');
    const other = fakeRouter(3, { pathname: '/', search: { date: '2026-11-04' } });
    await returnToDiary(other.router, { date: '2026-11-05' });
    expect(other.went).toEqual([-2]);
    expect(other.navigated).toEqual([{ to: '/', search: { date: '2026-11-05' }, replace: true }]);
    startAt(1, '/', '2026-11-05');
    const same = fakeRouter(3, { pathname: '/', search: { date: '2026-11-05' } });
    await returnToDiary(same.router, { date: '2026-11-05' });
    expect(same.navigated).toEqual([]);
  });

  it('a diary that is reached forgets the start', async () => {
    startAt(2, '/', TODAY);
    clearLogStart();
    const { router, went, navigated } = fakeRouter(5);
    await returnToDiary(router, { date: TODAY });
    expect(went).toEqual([]);
    expect(navigated).toHaveLength(1);
  });
});

describe('diary position and new rows', () => {
  beforeEach(() => resetDiaryScroll());

  it('scrolls a row into the space between header and tab bar only when it is outside', () => {
    document.body.innerHTML =
      '<header></header><ul><li data-row="a"></li><li data-row="group:g" data-rows="b c"></li></ul>' +
      '<section data-meal="2"></section><nav aria-label="Hauptnavigation"></nav>';
    const rect = (top: number, height: number) => ({ top, bottom: top + height, height }) as DOMRect;
    const boxes = new Map<Element, DOMRect>([
      [document.querySelector('header')!, rect(0, 100)],
      [document.querySelector('nav')!, rect(700, 80)],
      [document.querySelector('[data-row="a"]')!, rect(300, 56)],
      [document.querySelector('[data-row="group:g"]')!, rect(900, 56)],
      [document.querySelector('[data-meal="2"]')!, rect(-50, 800)],
    ]);
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      return boxes.get(this) ?? rect(0, 0);
    });
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    // On the screen: nothing moves.
    showInDiary(document.querySelector('[data-row="a"]')!);
    expect(scrollTo).not.toHaveBeenCalled();
    // Below the tab bar: centred between header (100) and tab bar (700).
    showInDiary(document.querySelector('[data-row="group:g"]')!);
    expect(scrollTo).toHaveBeenLastCalledWith(0, 900 + 28 - 400);
    // Higher than the space: its upper edge under the header.
    showInDiary(document.querySelector('[data-meal="2"]')!);
    expect(scrollTo).toHaveBeenLastCalledWith(0, 0);
    spy.mockRestore();
    scrollTo.mockRestore();
    document.body.innerHTML = '';
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

describe('training title', () => {
  const names = new Map([
    ['t1', 'Push Day'],
    ['t2', 'Laufen'],
  ]);
  it('is the name of the saved training with the sport below, else the sport', () => {
    expect(trainingTitle({ name: 'Krafttraining', templateId: 't1' }, names)).toEqual({
      title: 'Push Day',
      sport: 'Krafttraining',
    });
    expect(trainingTitle({ name: 'Krafttraining', templateId: null }, names)).toEqual({
      title: 'Krafttraining',
      sport: null,
    });
    // Older records have no field; an unknown id (not synced yet) and names still loading: the sport.
    expect(trainingTitle({ name: 'Yoga' }, names).title).toBe('Yoga');
    expect(trainingTitle({ name: 'Yoga', templateId: 'gone' }, names).title).toBe('Yoga');
    expect(trainingTitle({ name: 'Yoga', templateId: 't1' }, undefined).title).toBe('Yoga');
    // A saved training called like its sport says it once.
    expect(trainingTitle({ name: 'Laufen', templateId: 't2' }, names)).toEqual({
      title: 'Laufen',
      sport: null,
    });
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
    stepsKcal: 0,
    exerciseMinutes: 20,
    steps: null,
    distanceM: null,
    weightKg: null,
    mealsLogged: logged ? 3 : 0,
    completed: false,
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

  it('draws an incomplete day (one meal only) as one neutral bar too', () => {
    const half = { ...rows[0]!, mealsLogged: 1 };
    const [, total, , , neutral, eaten] = buildChart([half], 'kcal').data;
    expect(total![0]).toBeNull();
    expect(neutral![0]).toBe(620);
    expect(eaten![0]).toBe(620);
    // Closed by hand: complete, stacked as usual.
    expect(buildChart([{ ...half, completed: true }], 'kcal').data[1]![0]).toBe(620);
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

  it('diary macros: plain numbers by default, the bar on request', () => {
    expect(resolveAppearance('system', 'auto', false).diaryMacros).toBe('numbers');
    expect(resolveAppearance('dark', 'auto', false, 'bar')).toMatchObject({
      mode: 'dark',
      diaryMacros: 'bar',
    });
  });

  it('keeps the diary macros per device; the default removes the key', () => {
    startAppearance();
    setDiaryMacrosPref('bar');
    expect(localStorage.getItem('ft.diaryMacros')).toBe('bar');
    setDiaryMacrosPref('numbers');
    expect(localStorage.getItem('ft.diaryMacros')).toBeNull();
  });
});

describe('amount wheel', () => {
  it('runs in 5 g steps to 1.000 g and in half portions to 10', () => {
    const g = wheelValues('base');
    expect(g.slice(0, 3)).toEqual([5, 10, 15]);
    expect(g.at(-1)).toBe(1000);
    expect(g).toHaveLength(200);
    const p = wheelValues('portion');
    expect(p.slice(0, 4)).toEqual([0.5, 1, 1.5, 2]);
    expect(p.at(-1)).toBe(10);
  });

  it('gives an amount off the raster its own place', () => {
    expect(wheelValues('base', 137).slice(26, 29)).toEqual([135, 137, 140]);
    expect(wheelValues('portion', 1.25).slice(1, 4)).toEqual([1, 1.25, 1.5]);
    // Beyond the raster it sits at the end; on the raster nothing is added.
    expect(wheelValues('base', 2500).at(-1)).toBe(2500);
    expect(wheelValues('base', 60)).toHaveLength(200);
    expect(wheelValues('base', 0)).toHaveLength(200);
    expect(wheelValues('base', MAX_AMOUNT.base + 1)).toHaveLength(200);
  });

  it('finds the row of an amount', () => {
    const g = wheelValues('base', 137);
    expect(g[nearestIndex(g, 137)]).toBe(137);
    expect(g[nearestIndex(g, 62)]).toBe(60);
    expect(nearestIndex(g, null)).toBe(0);
  });

  it('rounds computed amounts and keeps them above 0', () => {
    expect(positiveAmount(0, 'base')).toBe(1);
    expect(positiveAmount(12.6, 'base')).toBe(13);
    expect(positiveAmount(0.30000000000000004, 'portion')).toBe(0.3);
    expect(positiveAmount(0, 'portion')).toBe(0.01);
    // Not clamped to the maximum: the editor shows too much as an error (see amounts.test.tsx).
    expect(positiveAmount(150, 'portion')).toBe(150);
    expect(roundAmount(1.254, 'portion')).toBe(1.25);
  });
});

describe('amount editor units', () => {
  it('offers grams first, drops 100 g and keeps the current portion', () => {
    const list = editorPortions('g', [
      { label: '1 Stück', grams: 60 },
      { label: '100 g', grams: 100 },
      { label: '1 g', grams: 1 },
      { label: '1 STÜCK', grams: 61 },
    ]);
    expect(list.map((p) => p.label)).toEqual(['1 g', '1 Stück']);
    const old = editorPortions('g', [{ label: '1 Stück', grams: 60 }], { label: '100 g', grams: 100 });
    expect(old.map((p) => p.label)).toEqual(['1 g', '1 Stück', '100 g']);
    expect(editorPortions('ml', [])[0]).toEqual({ label: '1 ml', grams: 1 });
  });

  it('converts between units keeping the grams', () => {
    const g = { label: '1 g', grams: 1 };
    const el = { label: 'Esslöffel (EL)', grams: 15 };
    expect(convertAmount(80, g, el)).toBe(5.33);
    expect(convertAmount(5.33, el, g)).toBe(80);
    expect(convertAmount(30, g, { label: 'Schale', grams: 300 })).toBe(0.1);
    expect(convertAmount(2, el, g)).toBe(30);
    expect(convertAmount(1, g, { label: 'Schale', grams: 300 })).toBe(0.01);
    expect(convertAmount(null, g, el)).toBeNull();
  });

  it('shows "100 g" amounts as grams', () => {
    expect(normalizeAmount({ portion: { label: '100 g', grams: 100 }, quantity: 1.5 }, 'g')).toEqual({
      portion: { label: '1 g', grams: 1 },
      quantity: 150,
    });
    const piece = { portion: { label: '1 Stück', grams: 60 }, quantity: 2 };
    expect(normalizeAmount(piece, 'g')).toBe(piece);
  });

  const egg: MealItem = {
    foodId: 'bls:egg',
    source: 'bls',
    name: 'Ei',
    brand: null,
    grams: 120,
    portionLabel: '1 Stück',
    portionGrams: 60,
    quantity: 2,
    per100: { ENERCC: 137 },
    nutrients: { ENERCC: 164.4 },
  };

  it('changes the amount of an ingredient, also in another unit', () => {
    expect(itemWithAmount(egg, { portion: itemPortion(egg), quantity: 3 })).toMatchObject({
      quantity: 3,
      grams: 180,
      nutrients: { ENERCC: 246.6 },
    });
    expect(itemWithAmount(egg, { portion: { label: '1 g', grams: 1 }, quantity: 90 })).toMatchObject({
      portionLabel: '1 g',
      portionGrams: 1,
      quantity: 90,
      grams: 90,
      nutrients: { ENERCC: 123.3 },
    });
  });

  it('scales a quick entry without portion by its count', () => {
    const quick: MealItem = {
      ...egg,
      source: 'quick',
      grams: null,
      portionLabel: null,
      portionGrams: null,
      quantity: 1,
      per100: null,
      nutrients: { ENERCC: 150 },
    };
    expect(itemPortion(quick)).toEqual({ label: 'Portion', grams: 0 });
    const twice = itemWithAmount(quick, { portion: itemPortion(quick), quantity: 2 });
    expect(twice).toMatchObject({ quantity: 2, portionLabel: null, nutrients: { ENERCC: 300 } });
  });
});

describe('sharing a day', () => {
  it('names the day with weekday and year, the file with the ISO date', () => {
    expect(fmtDayLongYear('2026-11-02')).toBe('Montag, 2. November 2026');
    expect(shareDayFileName('2026-11-02')).toBe('fleisch-teufel_tagebuch_2026-11-02.png');
  });
});
