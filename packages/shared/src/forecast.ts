import { diffDays, type ISODate } from './dates.js';
import { KCAL_PER_KG_BODY_WEIGHT } from './tdee.js';

export interface WeightPoint {
  date: ISODate;
  kg: number;
}

/**
 * "Complete day" forecast (feature #10), as MyFitnessPal does it: if every day for the next
 * five weeks looked like today, weight changes by (goal − net intake) × 35 / 7700 kg.
 * `netKcal` is food minus credited exercise; `goalKcal` is the maintenance-adjusted target;
 * `maintenanceKcal` is the TDEE (goal minus planned deficit), the energy balance reference.
 */
export function fiveWeekForecast(params: {
  currentWeightKg: number;
  netKcal: number;
  maintenanceKcal: number;
  days?: number;
}): { kg: number; deltaKg: number } {
  const days = params.days ?? 35;
  const deltaKg = ((params.netKcal - params.maintenanceKcal) * days) / KCAL_PER_KG_BODY_WEIGHT;
  return { kg: params.currentWeightKg + deltaKg, deltaKg };
}

/**
 * Exponentially smoothed trend (Hacker's Diet: 10 % of each day's deviation). Gaps between
 * weigh-ins are bridged by applying the smoothing once per elapsed day.
 */
export function exponentialTrend(points: readonly WeightPoint[], alpha = 0.1): WeightPoint[] {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const out: WeightPoint[] = [];
  let trend: number | undefined;
  let prev: ISODate | undefined;
  for (const p of sorted) {
    if (trend === undefined || prev === undefined) {
      trend = p.kg;
    } else {
      const gap = Math.max(1, diffDays(prev, p.date));
      const a = 1 - (1 - alpha) ** gap;
      trend = trend + a * (p.kg - trend);
    }
    prev = p.date;
    out.push({ date: p.date, kg: trend });
  }
  return out;
}

/** Trailing moving average over `windowDays` calendar days (not points). */
export function movingAverage(points: readonly WeightPoint[], windowDays = 7): WeightPoint[] {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.map((p, i) => {
    let sum = 0;
    let n = 0;
    for (let j = i; j >= 0; j--) {
      const q = sorted[j]!;
      if (diffDays(q.date, p.date) >= windowDays) break;
      sum += q.kg;
      n++;
    }
    return { date: p.date, kg: sum / n };
  });
}

/** Least-squares line through the points; slope in kg per day. */
export function linearTrend(
  points: readonly WeightPoint[],
): { slopePerDay: number; intercept: number; origin: ISODate } | null {
  if (points.length < 2) return null;
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const origin = sorted[0]!.date;
  const xs = sorted.map((p) => diffDays(origin, p.date));
  const ys = sorted.map((p) => p.kg);
  const n = xs.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  if (den === 0) return null;
  const slopePerDay = num / den;
  return { slopePerDay, intercept: my - slopePerDay * mx, origin };
}

/** Latest weight on or before `date`. */
export function weightOn(points: readonly WeightPoint[], date: ISODate): number | undefined {
  let best: WeightPoint | undefined;
  for (const p of points) {
    if (p.date <= date && (!best || p.date > best.date)) best = p;
  }
  return best?.kg;
}
