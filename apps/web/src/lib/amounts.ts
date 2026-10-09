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
