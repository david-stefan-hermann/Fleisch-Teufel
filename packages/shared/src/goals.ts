import { weekdayIndex, type ISODate } from './dates.js';
import { KCAL_PER_G, MICRO_NUTRIENTS, N, type MicroKey } from './nutrients.js';
import { gramsForEnergyShare } from './nutrition.js';
import type { Goal, DayTarget } from './schemas.js';

/**
 * Micronutrient guidance shown on the nutrient card (feature #7). Defaults follow the
 * Deutsche Gesellschaft für Ernährung (DGE):
 * - Fibre: at least 30 g/day (DGE reference value for adults, 2015/2021).
 * - Salt: at most 6 g/day (DGE position 2016, "Speisesalzzufuhr in Deutschland").
 * - Free sugars: less than 10 % of energy (DGE/DAG/DDG consensus 2018, in line with WHO 2015).
 * - Saturated fatty acids: at most 10 % of energy (DGE reference values for fat, 2015).
 * `kind` tells the UI whether the value is a minimum to reach or a maximum to stay below.
 */
export const MICRO_DEFAULTS: Record<
  MicroKey,
  { kind: 'min' | 'max'; grams?: number; energyPct?: number; source: string }
> = {
  [N.fiber]: { kind: 'min', grams: 30, source: 'DGE-Referenzwert: mind. 30 g/Tag' },
  [N.salt]: { kind: 'max', grams: 6, source: 'DGE: max. 6 g Speisesalz/Tag' },
  [N.sugar]: { kind: 'max', energyPct: 10, source: 'DGE/WHO: freie Zucker < 10 % der Energie' },
  [N.satFat]: { kind: 'max', energyPct: 10, source: 'DGE: gesättigte Fettsäuren max. 10 % der Energie' },
};

export interface ResolvedTargets extends DayTarget {
  goalId: string | null;
  micros: Record<MicroKey, { grams: number; kind: 'min' | 'max'; custom: boolean }>;
}

export const FALLBACK_TARGET: DayTarget = { kcal: 2000, proteinG: 120, fatG: 67, carbsG: 225 };

/** Goal valid on `date`: the one with the latest `validFrom` ≤ date (history keeps old days correct). */
export function goalForDate(goals: readonly Goal[], date: ISODate): Goal | undefined {
  let best: Goal | undefined;
  for (const g of goals) {
    if (g.deleted || g.validFrom > date) continue;
    if (!best || g.validFrom > best.validFrom) best = g;
  }
  // Before the first goal ever: use the earliest one rather than nothing.
  if (!best) {
    for (const g of goals) {
      if (g.deleted) continue;
      if (!best || g.validFrom < best.validFrom) best = g;
    }
  }
  return best;
}

export function microTarget(key: MicroKey, kcal: number, custom?: number | null): number {
  if (custom !== undefined && custom !== null) return custom;
  const d = MICRO_DEFAULTS[key];
  if (d.grams !== undefined) return d.grams;
  const kcalPerGram = key === N.satFat ? KCAL_PER_G.fat : KCAL_PER_G.carbs;
  return Math.round(gramsForEnergyShare(kcal, d.energyPct ?? 0, kcalPerGram));
}

/** Targets for a date: weekday-specific macro grams plus micronutrient targets. */
export function targetsForDate(goals: readonly Goal[], date: ISODate): ResolvedTargets {
  const goal = goalForDate(goals, date);
  const day = goal?.days[weekdayIndex(date)] ?? FALLBACK_TARGET;
  const micros = {} as ResolvedTargets['micros'];
  for (const key of MICRO_NUTRIENTS) {
    const custom = goal?.micros?.[key] ?? null;
    micros[key] = {
      grams: microTarget(key, day.kcal, custom),
      kind: MICRO_DEFAULTS[key].kind,
      custom: custom !== null,
    };
  }
  return { ...day, goalId: goal?.id ?? null, micros };
}

/** Same target for all seven weekdays. */
export function uniformWeek(target: DayTarget): DayTarget[] {
  return Array.from({ length: 7 }, () => ({ ...target }));
}
