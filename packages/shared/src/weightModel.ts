/**
 * The weight as a time series (plan `docs/plans/2026-11-gewichtsprognosen.md`, mockup v9): a Kalman filter
 * whose state is the level (body weight without water), the maintenance (kcal a day) and the weekday effect.
 * Logged calories move the level by (net kcal − maintenance) / 7 700; every weigh-in corrects level,
 * maintenance and weekday pattern. A forecast from day d runs the model on without weigh-ins, eating like the
 * 28 days before d, so it uses nothing after d. The band is checked against the person's own weigh-ins
 * (back-test) and widened or narrowed until 8 of 10 land in it.
 *
 * Mode `trend` is the same filter without calories (level plus a slope that drifts): the comparison line
 * "Ohne Kalorien".
 */
import { addDays, diffDays, type ISODate } from './dates.js';
import { creditedTrainingKcal, type Credit } from './diary.js';
import type { WeightPoint } from './forecast.js';
import { N } from './nutrients.js';
import { get } from './nutrition.js';
import { isCompleteDay, type DailyRow } from './reports.js';
import { KCAL_PER_KG_BODY_WEIGHT } from './tdee.js';

/** One calendar day of input: its weigh-in (mean of the day) and its net kcal when the day is complete. */
export interface ModelDay {
  date: ISODate;
  kg: number | null;
  kcal: number | null;
}

export type ModelMode = 'kcal' | 'trend';

export interface ModelParams {
  /** Spread of a weigh-in around level plus weekday (kg). */
  obs: number;
  /** Daily drift of the level beyond the calories (kg). */
  ql: number;
  /** Daily drift of the maintenance (kcal) or, in mode `trend`, of the slope (kg a day). */
  qb: number;
  /** Daily drift of the weekday effect (kg). */
  qg: number;
}

export interface ForecastPoint {
  date: ISODate;
  /** Expected weigh-in: level plus the weekday effect. */
  kg: number;
  /** `kg` lightly smoothed (¼ day before, ½ the day, ¼ day after): what the chart draws. */
  show: number;
  level: number;
  /** Uncertainty of the level (kg, one standard deviation). */
  levelSd: number;
  /** Uncertainty of a single weigh-in around the level (kg, one standard deviation). */
  obsSd: number;
  /** Maintenance (kcal) in mode `kcal`, slope (kg a day) in mode `trend`. */
  b: number;
}

export interface Calibration {
  /** Multiplier of `obsSd` for the 80 % band (1.28 for a well calibrated model). */
  factor: number;
  /** Weigh-ins checked. */
  checks: number;
  /** Share of checked weigh-ins inside ±1.28 · obsSd (before calibration). */
  coverModel: number;
  /** Share inside ±factor · obsSd per distance; index 1 to `CHECK_DAYS`, null without checks. */
  coverByDays: (number | null)[];
}

export interface WeightModel {
  mode: ModelMode;
  params: ModelParams;
  /** Every day from the first weigh-in to the last input day. */
  dates: ISODate[];
  /** Filtered level per day of `dates`. */
  level: number[];
  /** Filtered maintenance (mode `kcal`) or slope (mode `trend`) per day of `dates`. */
  b: number[];
  /** First day with a forecast (`FIRST_FORECAST_DAYS` after the first weigh-in). */
  firstForecast: ISODate;
  /** The forecast made on `date` for it and the `days` after it; null where the model makes none. */
  forecast: (date: ISODate, days: number) => ForecastPoint[] | null;
  /** What a forecast made on `date` assumes for the days after it: the last `EAT_DAYS` logged days. */
  eatingAt: (date: ISODate) => { mean: number; sd: number } | null;
  calibration: Calibration;
}

/** Days of logged calories averaged for forgotten days and for the eating after a forecast's day. */
export const EAT_DAYS = 28;
/** A run of days without complete entries this long or longer is a gap (holiday), not forgetting. */
export const GAP_DAYS = 3;
/** How far a day inside a gap may be off the maintenance (kcal). */
export const MISSING_SD = 600;
/** Days after the first weigh-in before the first forecast (each weekday seen a few times). */
export const FIRST_FORECAST_DAYS = 21;
/** A day whose last weigh-in is older than this has no forecast. */
export const MAX_WEIGH_AGE_DAYS = 14;
/** Days the parameters are fitted on and the back-test looks at. */
export const FIT_DAYS = 180;
/** Distances (days) the back-test checks. */
export const CHECK_DAYS = 14;
/** z of the 80 % band of a normal distribution. */
export const BAND_Z = 1.28;
const MIN_CHECKS = 20;
/** Starting uncertainty of the maintenance (kcal). */
const START_SD = 250;

const GRID: Record<ModelMode, Record<keyof ModelParams, number[]>> = {
  kcal: { obs: [0.2, 0.3, 0.4, 0.5], ql: [0.01, 0.02, 0.03], qb: [2, 5, 10, 20], qg: [0.005, 0.02, 0.05] },
  trend: {
    obs: [0.2, 0.3, 0.4, 0.5],
    ql: [0.01, 0.02, 0.03, 0.05],
    qb: [0.0005, 0.001, 0.003, 0.01],
    qg: [0.005, 0.02, 0.05],
  },
};

/** The input of the model: weigh-ins (mean per day) and net kcal of complete days, from `from` to `to`. */
export function modelDays(params: {
  rows: readonly DailyRow[];
  weights: readonly WeightPoint[];
  from: ISODate;
  to: ISODate;
  credit: Credit;
}): ModelDay[] {
  const sums = new Map<ISODate, { kg: number; n: number }>();
  for (const w of params.weights) {
    if (w.date < params.from || w.date > params.to) continue;
    const s = sums.get(w.date) ?? { kg: 0, n: 0 };
    s.kg += w.kg;
    s.n++;
    sums.set(w.date, s);
  }
  const rows = new Map(params.rows.map((r) => [r.date, r]));
  const out: ModelDay[] = [];
  for (let d = params.from; d <= params.to; d = addDays(d, 1)) {
    const r = rows.get(d);
    const s = sums.get(d);
    out.push({
      date: d,
      kg: s ? s.kg / s.n : null,
      kcal:
        r && isCompleteDay(r, { today: params.to })
          ? get(r.nutrients, N.kcal) - creditedTrainingKcal(r.exerciseKcal, r.stepsKcal, params.credit)
          : null,
    });
  }
  return out;
}

// ---------- 8 × 8 Kalman algebra on flat arrays: state [level, b, g1..g6] ----------
const K = 8;
type Vec = Float64Array;
type Mat = Float64Array;

function transitionMatrix(levelFromB: number): Mat {
  const F = new Float64Array(K * K);
  F[0] = 1;
  F[1] = levelFromB;
  F[K + 1] = 1;
  for (let j = 2; j < K; j++) F[2 * K + j] = -1;
  for (let j = 3; j < K; j++) F[j * K + j - 1] = 1;
  return F;
}
const F_TREND = transitionMatrix(1);
const F_KCAL = transitionMatrix(-1 / KCAL_PER_KG_BODY_WEIGHT);
const F_FREE = transitionMatrix(0);

const tmp = new Float64Array(K * K);
/** x ← F x + c·e0;  P ← F P Fᵀ + diag(q0, qb², qg², 0, …). */
function predict(x: Vec, P: Mat, F: Mat, c0: number, q0: number, qb2: number, qg2: number): void {
  const x2 = new Float64Array(K);
  for (let i = 0; i < K; i++) {
    let s = 0;
    for (let k = 0; k < K; k++) s += F[i * K + k]! * x[k]!;
    x2[i] = s;
  }
  x2[0]! += c0;
  x.set(x2);
  // tmp = F P
  for (let i = 0; i < K; i++)
    for (let j = 0; j < K; j++) {
      let s = 0;
      for (let k = 0; k < K; k++) s += F[i * K + k]! * P[k * K + j]!;
      tmp[i * K + j] = s;
    }
  // P = tmp Fᵀ
  for (let i = 0; i < K; i++)
    for (let j = 0; j < K; j++) {
      let s = 0;
      for (let k = 0; k < K; k++) s += tmp[i * K + k]! * F[j * K + k]!;
      P[i * K + j] = s;
    }
  P[0]! += q0;
  P[K + 1]! += qb2;
  P[2 * K + 2]! += qg2;
}

/** Weigh-in y = level + g1. Returns the log-likelihood term. */
function update(x: Vec, P: Mat, y: number, obs2: number): number {
  const S = P[0]! + 2 * P[2]! + P[2 * K + 2]! + obs2;
  const v = y - (x[0]! + x[2]!);
  const PZ = new Float64Array(K);
  for (let i = 0; i < K; i++) PZ[i] = P[i * K]! + P[i * K + 2]!;
  for (let i = 0; i < K; i++) x[i]! += (PZ[i]! / S) * v;
  for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) P[i * K + j]! -= (PZ[i]! * PZ[j]!) / S;
  return -0.5 * (Math.log(S) + (v * v) / S);
}

/** Mean square of the seven weekday effects in the state. */
function weekdayVar(x: Vec): number {
  let sum = 0;
  let sq = 0;
  for (let j = 2; j < K; j++) {
    sum += x[j]!;
    sq += x[j]! ** 2;
  }
  return (sq + sum * sum) / 7;
}
/** The weekday block holds the effects of the coming days in turn: g1 is always the current day's. */
function initialState(level: number, b: number, bSd: number): { x: Vec; P: Mat } {
  const x = new Float64Array(K);
  x[0] = level;
  x[1] = b;
  const P = new Float64Array(K * K);
  P[0] = 1;
  P[K + 1] = bSd * bSd;
  for (let j = 2; j < K; j++) P[j * K + j] = 0.4 ** 2;
  return { x, P };
}

/**
 * The filter, its fitted parameters, forecasts and back-test. Null without at least two weigh-ins. `days` must be
 * contiguous and ascending (one per calendar day); `startMaintenance` is the formula value (mode `kcal`).
 */
export function buildWeightModel(params: {
  days: readonly ModelDay[];
  mode: ModelMode;
  startMaintenance?: number;
  /** Fixed parameters instead of the fit (tests). */
  params?: ModelParams;
}): WeightModel | null {
  const { mode } = params;
  const firstIdx = params.days.findIndex((d) => d.kg !== null);
  if (firstIdx < 0 || params.days.filter((d) => d.kg !== null).length < 2) return null;
  const days = params.days.slice(firstIdx);
  const n = days.length;
  const dates = days.map((d) => d.date);
  const kcal = days.map((d) => d.kcal);
  const kg = days.map((d) => d.kg);

  // Eating up to day i: mean and spread of the last EAT_DAYS logged days.
  const eating: ({ mean: number; sd: number } | null)[] = new Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    let s2 = 0;
    let m = 0;
    for (let k = i; k > i - EAT_DAYS && k >= 0; k--) {
      const v = kcal[k];
      if (v == null) continue;
      s += v;
      s2 += v * v;
      m++;
    }
    eating[i] = m ? { mean: s / m, sd: Math.sqrt(Math.max(0, s2 / m - (s / m) ** 2)) } : null;
  }
  // A forgotten day (inside a run shorter than GAP_DAYS) counts with the eating so far.
  const fill: ({ mean: number; sd: number } | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n;) {
    if (kcal[i] != null) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < n && kcal[j + 1] == null) j++;
    if (j - i + 1 < GAP_DAYS) for (let k = i; k <= j; k++) fill[k] = eating[k] ?? null;
    i = j + 1;
  }

  const start = (): number => {
    if (mode === 'trend') return 0;
    if (params.startMaintenance !== undefined) return params.startMaintenance;
    const first = eating.find((e) => e !== null);
    return first?.mean ?? 2000;
  };

  /** Transition from day i to i + 1 with what was eaten on day i. */
  function step(x: Vec, P: Mat, i: number, p: ModelParams): void {
    if (mode === 'trend') return predict(x, P, F_TREND, 0, p.ql ** 2, p.qb ** 2, p.qg ** 2);
    const logged = kcal[i];
    const f = logged == null ? fill[i] : null;
    if (logged != null)
      return predict(x, P, F_KCAL, logged / KCAL_PER_KG_BODY_WEIGHT, p.ql ** 2, p.qb ** 2, p.qg ** 2);
    if (f)
      return predict(
        x,
        P,
        F_KCAL,
        f.mean / KCAL_PER_KG_BODY_WEIGHT,
        p.ql ** 2 + (f.sd / KCAL_PER_KG_BODY_WEIGHT) ** 2,
        p.qb ** 2,
        p.qg ** 2,
      );
    predict(x, P, F_FREE, 0, p.ql ** 2 + (MISSING_SD / KCAL_PER_KG_BODY_WEIGHT) ** 2, p.qb ** 2, p.qg ** 2);
  }

  /** Runs the filter from day `from`; keeps the states when `keep`. */
  function run(p: ModelParams, from: number, keep: boolean) {
    const found = kg.findIndex((v, i) => i >= from && v !== null);
    const first = found < 0 ? 0 : found;
    const { x, P } = initialState(kg[first]!, start(), mode === 'kcal' ? START_SD : 0.05);
    const states: { x: Vec; P: Mat }[] = [];
    let ll = 0;
    for (let i = first; i < n; i++) {
      if (i > first) step(x, P, i - 1, p);
      const y = kg[i];
      if (y != null) {
        const term = update(x, P, y, p.obs ** 2);
        if (i > first + 14) ll += term;
      }
      if (keep) states[i] = { x: x.slice(), P: P.slice() };
    }
    return { ll, states };
  }

  function fit(): ModelParams {
    const fitFrom = Math.max(0, n - FIT_DAYS - 30);
    const G = GRID[mode];
    let best: { ll: number; p: ModelParams } | null = null;
    for (const obs of G.obs)
      for (const ql of G.ql)
        for (const qb of G.qb)
          for (const qg of G.qg) {
            const p = { obs, ql, qb, qg };
            const { ll } = run(p, fitFrom, false);
            if (!best || ll > best.ll) best = { ll, p };
          }
    return best!.p;
  }

  // Maximum likelihood on the grid, over the last FIT_DAYS (plus a month to settle).
  const P0 = params.params ?? fit();
  const { states } = run(P0, 0, true);

  const lastWeigh: number[] = new Array(n);
  for (let i = 0, last = -1; i < n; i++) {
    if (kg[i] != null) last = i;
    lastWeigh[i] = last;
  }
  const firstForecast = Math.min(n - 1, FIRST_FORECAST_DAYS);
  const index = (date: ISODate) => diffDays(dates[0]!, date);

  function forecastAt(i: number, h: number): ForecastPoint[] | null {
    if (i < firstForecast || i >= n || i - lastWeigh[i]! > MAX_WEIGH_AGE_DAYS) return null;
    const s = states[i]!;
    const x = s.x.slice();
    const P = s.P.slice();
    const gVar = weekdayVar(x);
    const eat = mode === 'kcal' ? eating[i] : null;
    const pts: ForecastPoint[] = [];
    const push = (k: number) =>
      pts.push({
        date: addDays(dates[i]!, k),
        kg: x[0]! + x[2]!,
        show: 0,
        level: x[0]!,
        levelSd: Math.sqrt(P[0]!),
        obsSd: Math.sqrt(P[0]! + P0.obs ** 2 + gVar),
        b: x[1]!,
      });
    push(0);
    for (let k = 1; k <= h; k++) {
      if (mode === 'trend') predict(x, P, F_TREND, 0, P0.ql ** 2, P0.qb ** 2, P0.qg ** 2);
      else if (eat)
        predict(
          x,
          P,
          F_KCAL,
          eat.mean / KCAL_PER_KG_BODY_WEIGHT,
          P0.ql ** 2 + (eat.sd / KCAL_PER_KG_BODY_WEIGHT) ** 2,
          P0.qb ** 2,
          P0.qg ** 2,
        );
      else
        predict(
          x,
          P,
          F_FREE,
          0,
          P0.ql ** 2 + (MISSING_SD / KCAL_PER_KG_BODY_WEIGHT) ** 2,
          P0.qb ** 2,
          P0.qg ** 2,
        );
      push(k);
    }
    pts.forEach((p, k) => {
      const prev = pts[k - 1]?.kg ?? p.kg;
      const next = pts[k + 1]?.kg ?? p.kg;
      p.show = 0.25 * prev + 0.5 * p.kg + 0.25 * next;
    });
    return pts;
  }

  // Back-test: every weigh-in 1 to CHECK_DAYS days after each day of the last FIT_DAYS, against that day's forecast.
  const zs: number[] = [];
  const zByDays: number[][] = Array.from({ length: CHECK_DAYS + 1 }, () => []);
  for (let i = Math.max(firstForecast, n - 1 - FIT_DAYS); i < n - 1; i++) {
    const fc = forecastAt(i, Math.min(CHECK_DAYS, n - 1 - i));
    if (!fc) continue;
    for (let h = 1; h < fc.length; h++) {
      const y = kg[i + h];
      if (y == null) continue;
      const z = Math.abs(y - fc[h]!.level) / fc[h]!.obsSd;
      zs.push(z);
      zByDays[h]!.push(z);
    }
  }
  const sorted = [...zs].sort((a, b) => a - b);
  const factor = zs.length >= MIN_CHECKS ? sorted[Math.floor(0.8 * (sorted.length - 1))]! : BAND_Z;
  const calibration: Calibration = {
    factor,
    checks: zs.length,
    coverModel: zs.length ? zs.filter((z) => z <= BAND_Z).length / zs.length : 0,
    coverByDays: zByDays.map((xs, h) =>
      h === 0 || !xs.length ? null : xs.filter((z) => z <= factor).length / xs.length,
    ),
  };

  return {
    mode,
    params: P0,
    dates,
    level: states.map((s) => s.x[0]!),
    b: states.map((s) => s.x[1]!),
    firstForecast: dates[firstForecast]!,
    forecast: (date, h) => forecastAt(index(date), h),
    eatingAt: (date) => {
      const i = index(date);
      return i >= 0 && i < n ? eating[i]! : null;
    },
    calibration,
  };
}
