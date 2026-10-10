import type { Portion } from '@ft/shared';

/**
 * Amount math of the amount sliders. The range comes from a start amount that sits exactly in the
 * middle (end = 2 × start); it never comes from the value being dragged, or every step would push
 * the end further out (the "exploding slider" of round 7).
 */

/** Highest amount a field accepts: grams/millilitres, or pieces of a portion. */
export const MAX_AMOUNT = { base: 9999, portion: 99 } as const;

/** Whether an amount counts the base unit (1 g / 1 ml) or pieces of a portion. */
export type AmountKind = 'base' | 'portion';

/** Raster of slider, field rounding and −/+: 1 g / 1 ml, or tenths of a portion. */
export const amountStep = (kind: AmountKind) => (kind === 'base' ? 1 : 0.1);

export const maxAmount = (kind: AmountKind) => MAX_AMOUNT[kind];

/** Rounds to the raster (avoids float noise like 0.30000000000000004). */
export function roundAmount(v: number, kind: AmountKind): number {
  return kind === 'base' ? Math.round(v) : Math.round(v * 10) / 10;
}

/** Start amount when there is none yet (empty field): 100 g / 100 ml or one portion. */
export const defaultStart = (kind: AmountKind) => (kind === 'base' ? 100 : 1);

/**
 * Slider range for a start amount: 0 to 2 × start (capped at `MAX_AMOUNT`), so the start sits
 * exactly in the middle. A missing or non-positive start falls back to `defaultStart`.
 */
export function sliderRange(start: number | null, kind: AmountKind): { min: 0; max: number; step: number } {
  const s = start !== null && start > 0 ? start : defaultStart(kind);
  const step = amountStep(kind);
  const max = Math.min(maxAmount(kind), Math.max(2 * step, roundAmount(2 * s, kind)));
  return { min: 0, max, step };
}

/** A slider or −/+ value on the raster, at least one step (0 is never an amount) and at most the maximum. */
export function clampAmount(v: number, kind: AmountKind): number {
  const step = amountStep(kind);
  return Math.min(maxAmount(kind), Math.max(step, roundAmount(v, kind)));
}

const BASE_LABEL = /^1\s?(g|ml)$/;
const HUNDRED_LABEL = /^100\s?(g|ml)$/;

/** The base unit as a portion: "1 g" or "1 ml" of 1 g. */
export const basePortion = (unit: 'g' | 'ml'): Portion => ({ label: `1 ${unit}`, grams: 1 });

export const isBasePortion = (p: Pick<Portion, 'label'>) => BASE_LABEL.test(p.label);

export const amountKind = (p: Pick<Portion, 'label'>): AmountKind => (isBasePortion(p) ? 'base' : 'portion');

/**
 * Units of the amount editor: the base unit first, then the portions. "100 g" is left out (grams
 * cover it, with a 1 g raster instead of 10 g), unless it is the current portion of an older entry.
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

/** The same amount in another unit (grams stay), on the raster of the new unit. */
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
