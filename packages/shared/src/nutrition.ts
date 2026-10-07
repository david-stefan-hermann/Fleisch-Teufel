import { KCAL_PER_G, N, type NutrientMap } from './nutrients.js';

/** Rounds to `digits` decimals and removes floating-point noise (e.g. 0.30000000000000004). */
export function round(value: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round((value + Number.EPSILON) * f) / f;
}

/** Scales per-100 g values to `grams`. */
export function scaleNutrients(per100: NutrientMap, grams: number): NutrientMap {
  const factor = grams / 100;
  const out: NutrientMap = {};
  for (const [k, v] of Object.entries(per100)) out[k] = round(v * factor, 4);
  return out;
}

/** Multiplies every value by `factor`. */
export function multiplyNutrients(map: NutrientMap, factor: number): NutrientMap {
  const out: NutrientMap = {};
  for (const [k, v] of Object.entries(map)) out[k] = round(v * factor, 4);
  return out;
}

/** Sums nutrient maps key by key; a key missing in one map counts as 0 for that map. */
export function sumNutrients(maps: Iterable<NutrientMap>): NutrientMap {
  const out: NutrientMap = {};
  for (const m of maps) {
    for (const [k, v] of Object.entries(m)) out[k] = (out[k] ?? 0) + v;
  }
  for (const k of Object.keys(out)) out[k] = round(out[k]!, 4);
  return out;
}

export function get(map: NutrientMap | undefined, key: string): number {
  return map?.[key] ?? 0;
}

export interface Macros {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
}

export function macrosOf(map: NutrientMap | undefined): Macros {
  return {
    kcal: get(map, N.kcal),
    protein: get(map, N.protein),
    fat: get(map, N.fat),
    carbs: get(map, N.carbs),
  };
}

/**
 * Energy share of protein/fat/carbs in percent (Atwater factors). Shares refer to the energy
 * from these three macros, so they sum to 100 (alcohol and fibre are left out on purpose).
 */
export function macroEnergyShares(m: Pick<Macros, 'protein' | 'fat' | 'carbs'>): {
  protein: number;
  fat: number;
  carbs: number;
} {
  const p = m.protein * KCAL_PER_G.protein;
  const f = m.fat * KCAL_PER_G.fat;
  const c = m.carbs * KCAL_PER_G.carbs;
  const total = p + f + c;
  if (total <= 0) return { protein: 0, fat: 0, carbs: 0 };
  return { protein: (p / total) * 100, fat: (f / total) * 100, carbs: (c / total) * 100 };
}

/** Grams of a macro needed for `pct` percent of `kcal`. */
export function gramsForEnergyShare(kcal: number, pct: number, kcalPerGram: number): number {
  return (kcal * pct) / 100 / kcalPerGram;
}

/** Display formatter: German decimal comma, sensible precision per magnitude. */
export function formatAmount(value: number, unit?: string): string {
  const abs = Math.abs(value);
  const digits = unit === 'kcal' || unit === 'kJ' ? 0 : abs >= 100 ? 0 : abs >= 10 ? 1 : abs >= 1 ? 1 : 2;
  const s = round(value, digits).toLocaleString('de-DE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
  return unit ? `${s} ${unit}` : s;
}

export type MacroKey = 'protein' | 'carbs' | 'fat';
export const MACRO_KEYS: readonly MacroKey[] = ['protein', 'carbs', 'fat'];

/** One macro of an `EnergyBreakdown`. */
export interface MacroEnergy {
  grams: number;
  /** Energy of the grams (Atwater: 4 / 4 / 9 kcal per g). */
  kcal: number;
  /** Share of the macro energy, 0..1; the three shares sum to 1 (or are all 0). */
  share: number;
  /** `share` as whole percent, rounded so that the three always sum to exactly 100 (or are all 0). */
  percent: number;
}

export interface EnergyBreakdown {
  /** Reported energy of the item (ENERCC): the headline number. */
  kcal: number;
  macros: Record<MacroKey, MacroEnergy>;
}

/**
 * Whole percents for shares that sum to 1, using the largest-remainder method: the displayed
 * numbers always add up to exactly 100 (plain rounding of 24.2 / 48.5 / 27.3 would give 99).
 */
export function wholePercents(shares: readonly number[]): number[] {
  const total = shares.reduce((s, x) => s + x, 0);
  if (total <= 0) return shares.map(() => 0);
  const raw = shares.map((s) => (s / total) * 100);
  const out = raw.map(Math.floor);
  let missing = 100 - out.reduce((s, x) => s + x, 0);
  const order = raw.map((r, i) => ({ i, rest: r - Math.floor(r) })).sort((a, b) => b.rest - a.rest);
  for (const { i } of order) {
    if (missing <= 0) break;
    out[i]!++;
    missing--;
  }
  return out;
}

/**
 * Energy split of protein, carbs and fat for the nutrient overview. Shares refer to the energy of
 * the three macros, so the stacked bar is always full and the percents sum to 100. The macro kcal
 * may differ slightly from the headline `kcal` (fibre, alcohol, rounding in the source data): that
 * is intended and honest. An empty map gives all zeros, never NaN.
 */
export function energyBreakdown(map: NutrientMap | undefined): EnergyBreakdown {
  const grams = { protein: get(map, N.protein), carbs: get(map, N.carbs), fat: get(map, N.fat) };
  const kcal = {
    protein: grams.protein * KCAL_PER_G.protein,
    carbs: grams.carbs * KCAL_PER_G.carbs,
    fat: grams.fat * KCAL_PER_G.fat,
  };
  const total = kcal.protein + kcal.carbs + kcal.fat;
  const percents = wholePercents(MACRO_KEYS.map((k) => kcal[k]));
  const macros = {} as Record<MacroKey, MacroEnergy>;
  MACRO_KEYS.forEach((k, i) => {
    macros[k] = {
      grams: grams[k],
      kcal: round(kcal[k], 1),
      share: total > 0 ? kcal[k] / total : 0,
      percent: percents[i]!,
    };
  });
  return { kcal: get(map, N.kcal), macros };
}
