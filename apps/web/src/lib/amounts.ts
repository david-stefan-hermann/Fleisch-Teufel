import type { Portion } from '@ft/shared';

/**
 * Amount math of the amount editor: a wheel on a coarse raster plus a field for any value.
 */

/** Highest amount a field accepts: grams/millilitres, or pieces of a portion. */
export const MAX_AMOUNT = { base: 9999, portion: 99 } as const;

/** Whether an amount counts the base unit (1 g / 1 ml) or pieces of a portion. */
export type AmountKind = 'base' | 'portion';

/** Raster of the wheel: 5 g / 5 ml, or half portions. */
export const amountStep = (kind: AmountKind) => (kind === 'base' ? 5 : 0.5);

/** Where the raster of the wheel ends; larger amounts are typed. */
export const WHEEL_MAX = { base: 1000, portion: 10 } as const;

export const maxAmount = (kind: AmountKind) => MAX_AMOUNT[kind];

/** Precision of an amount: whole grams, hundredths of a portion (avoids float noise). */
export function roundAmount(v: number, kind: AmountKind): number {
  return kind === 'base' ? Math.round(v) : Math.round(v * 100) / 100;
}

/** A computed amount in its precision, above 0 (0 is never an amount) and at most the maximum. */
export function clampAmount(v: number, kind: AmountKind): number {
  return Math.min(maxAmount(kind), Math.max(kind === 'base' ? 1 : 0.01, roundAmount(v, kind)));
}

/**
 * Amounts on the wheel, ascending: the raster up to `WHEEL_MAX`, plus `extra` (a typed or stored
 * amount off the raster, e.g. 137 g or 1,25 portions) at its place, so wheel and field can always
 * show the same amount.
 */
export function wheelValues(kind: AmountKind, extra: number | null = null): number[] {
  const step = amountStep(kind);
  const out: number[] = [];
  for (let i = 1; i * step <= WHEEL_MAX[kind]; i++) out.push(i * step);
  if (extra !== null && extra > 0 && extra <= maxAmount(kind) && !out.includes(extra)) {
    out.push(extra);
    out.sort((a, b) => a - b);
  }
  return out;
}

/** Index of the wheel amount closest to `value` (the first one without a value). */
export function nearestIndex(values: readonly number[], value: number | null): number {
  if (value === null) return 0;
  let best = 0;
  for (let i = 1; i < values.length; i++)
    if (Math.abs(values[i]! - value) < Math.abs(values[best]! - value)) best = i;
  return best;
}

const BASE_LABEL = /^1\s?(g|ml)$/;
const HUNDRED_LABEL = /^100\s?(g|ml)$/;

/** The base unit as a portion: "1 g" or "1 ml" of 1 g. */
export const basePortion = (unit: 'g' | 'ml'): Portion => ({ label: `1 ${unit}`, grams: 1 });

export const isBasePortion = (p: Pick<Portion, 'label'>) => BASE_LABEL.test(p.label);

export const amountKind = (p: Pick<Portion, 'label'>): AmountKind => (isBasePortion(p) ? 'base' : 'portion');

/**
 * Units of the amount editor: the base unit first, then the portions. "100 g" is left out (grams
 * cover it), unless it is the current portion of an older entry.
 * The current portion is always offered, duplicates (same label) only once.
 */
export function editorPortions(unit: 'g' | 'ml', portions: readonly Portion[], current?: Portion): Portion[] {
  const out: Portion[] = [];
  const seen = new Set<string>();
  const add = (p: Portion) => {
    const key = p.label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(p);
  };
  add(current && isBasePortion(current) ? current : basePortion(unit));
  for (const p of portions) {
    if (isBasePortion(p)) continue;
    if (HUNDRED_LABEL.test(p.label) && p.label !== current?.label) continue;
    if (!(p.grams > 0)) continue;
    add(p);
  }
  if (current) add(current);
  return out;
}

/** The same amount in another unit: the grams stay (whole grams, hundredths of a portion). */
export function convertAmount(quantity: number | null, from: Portion, to: Portion): number | null {
  if (quantity === null || !(quantity > 0)) return null;
  return clampAmount((quantity * from.grams) / to.grams, amountKind(to));
}

/** An amount in "100 g" portions as grams (1,5 × 100 g → 150 g); others stay as they are. */
export function normalizeAmount<T extends { portion: Portion; quantity: number | null }>(
  v: T,
  unit: 'g' | 'ml',
): T {
  if (!HUNDRED_LABEL.test(v.portion.label)) return v;
  return {
    ...v,
    portion: basePortion(unit),
    quantity: v.quantity === null ? null : Math.round(v.quantity * v.portion.grams * 100) / 100,
  };
}
