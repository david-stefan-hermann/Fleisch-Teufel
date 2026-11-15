import { ageOn } from './dates.js';
import { KCAL_PER_G } from './nutrients.js';
import type { ISODate } from './dates.js';

export type Sex = 'male' | 'female';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';

/**
 * Physical activity level multipliers (classic Harris-Benedict/Mifflin multipliers).
 * Exercise is logged separately (feature #9), so users should pick their level *without* workouts.
 *
 * Why 1.2 for "Kaum aktiv" and not the PAL 1.4 of DGE and FAO: those describe the true expenditure,
 * but a target in the app is held against self-logged calories, which run low on average (Subar 2003:
 * 12 to 20 % in 24-hour recalls). The owner's own data (39 days, about 2150 kcal expenditure at a BMR
 * of 1793) fit 1.2, not 1.4. This is our own derivation, not the statement of a source.
 */
export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

export const ACTIVITY_LABELS_DE: Record<ActivityLevel, { title: string; hint: string }> = {
  sedentary: { title: 'Kaum aktiv', hint: 'Bürojob, wenig Bewegung im Alltag' },
  light: { title: 'Leicht aktiv', hint: 'Viel zu Fuß, stehende Tätigkeit zeitweise' },
  moderate: { title: 'Aktiv', hint: 'Überwiegend auf den Beinen' },
  active: { title: 'Sehr aktiv', hint: 'Körperlich fordernder Beruf' },
  very_active: { title: 'Extrem aktiv', hint: 'Schwere körperliche Arbeit' },
};

/** Energy content of body-weight change, kcal per kg (common approximation, Wishnofsky 1958). */
export const KCAL_PER_KG_BODY_WEIGHT = 7700;

/** Lowest daily target suggested without medical supervision (no sex given: the mean). */
export const MIN_KCAL: Record<Sex, number> = { male: 1500, female: 1200 };
const MIN_KCAL_UNKNOWN = 1350;

/**
 * Largest deficit as a share of the expenditure (from BMI 30 a little more). Our own caution limit
 * from the reviews on muscle loss in large deficits (Murphy 2021: from about 500 kcal deficit lean
 * mass gains suffer), not a standardised number.
 */
export const MAX_DEFICIT_SHARE = 0.25;
const MAX_DEFICIT_SHARE_OBESE = 0.3;

export const GOAL_KINDS = ['lose', 'maintain', 'gain_beginner', 'gain_advanced'] as const;
export type GoalKind = (typeof GOAL_KINDS)[number];

/**
 * The four goals: weekly rate in percent of body weight and the macro template they start with.
 * −0.5 % is the lower end of 0.5 to 1.0 % (Helms 2014, Garthe 2011). +0.25 % is the lower end of
 * Iraki 2019 for beginners. +0.1 % and the border of two years of training are convention (ACSM 2009,
 * MacroFactor), not a measured threshold.
 */
export const GOALS: Record<GoalKind, { ratePct: number; preset: Exclude<MacroPresetId, 'custom'> }> = {
  lose: { ratePct: -0.5, preset: 'cut' },
  maintain: { ratePct: 0, preset: 'high_protein' },
  gain_beginner: { ratePct: 0.25, preset: 'gain' },
  gain_advanced: { ratePct: 0.1, preset: 'gain' },
};

export const GOAL_LABELS_DE: Record<GoalKind, { title: string; hint: string | null }> = {
  lose: { title: 'Abnehmen', hint: null },
  maintain: { title: 'Gewicht halten', hint: null },
  gain_beginner: { title: 'Muskeln aufbauen', hint: 'Unter 2 Jahre Krafttraining' },
  gain_advanced: { title: 'Muskeln aufbauen', hint: 'Ab 2 Jahren Krafttraining' },
};

/** Weekly weight change of a goal at a body weight (kg, rounded to 0.01). */
export function weeklyRateForGoal(kind: GoalKind, weightKg: number): number {
  return Math.round(GOALS[kind].ratePct * weightKg) / 100;
}

/** The stored goal, else (set up before goals existed) the one the sign of the weekly rate means. */
export function goalKindOf(settings: { goalKind?: GoalKind | null; weeklyRateKg: number }): GoalKind {
  if (settings.goalKind) return settings.goalKind;
  return settings.weeklyRateKg < 0 ? 'lose' : settings.weeklyRateKg > 0 ? 'gain_beginner' : 'maintain';
}

/** The weekly rate to plan with: the goal's rate at the current weight, else the stored rate. */
export function currentWeeklyRate(
  settings: { goalKind?: GoalKind | null; weeklyRateKg: number },
  weightKg: number | null | undefined,
): number {
  return settings.goalKind && weightKg != null
    ? weeklyRateForGoal(settings.goalKind, weightKg)
    : settings.weeklyRateKg;
}

export interface BodyProfile {
  /** `null`: no answer; the formula then uses the mean of both constants. */
  sex: Sex | null;
  ageYears: number;
  heightCm: number;
  weightKg: number;
}

/** Basal metabolic rate, Mifflin-St Jeor (1990): 10·kg + 6.25·cm − 5·age + (5 | −161). */
export function bmrMifflinStJeor(p: BodyProfile): number {
  const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.ageYears;
  return base + (p.sex === 'male' ? 5 : p.sex === 'female' ? -161 : -78);
}

/**
 * The body profile of the settings on a date, or `null` while birth date or height are missing.
 * Used wherever the energy need is computed from the profile (onboarding, day forecast).
 */
export function bodyProfile(
  settings: { sex: Sex | null; birthDate: ISODate | null; heightCm: number | null },
  weightKg: number | null | undefined,
  on: ISODate,
): BodyProfile | null {
  if (!settings.birthDate || settings.heightCm === null || weightKg == null) return null;
  return {
    sex: settings.sex,
    ageYears: ageOn(settings.birthDate, on),
    heightCm: settings.heightCm,
    weightKg,
  };
}

export function tdee(p: BodyProfile, activity: ActivityLevel): number {
  return bmrMifflinStJeor(p) * ACTIVITY_FACTORS[activity];
}

/** Daily energy delta for a weekly weight change. */
export function dailyDeltaForWeeklyRate(weeklyRateKg: number): number {
  return (weeklyRateKg * KCAL_PER_KG_BODY_WEIGHT) / 7;
}

/** Which limit raised the target: the largest deficit or the lowest target (`minimum` wins when both do). */
export type KcalClamp = 'deficit' | 'minimum' | null;

/**
 * Daily kcal target from an expenditure and a weekly rate: the deficit at most `MAX_DEFICIT_SHARE`
 * of the expenditure (from BMI 30: 30 %), then never below `MIN_KCAL`, rounded to 10.
 */
export function kcalTarget(
  expenditureKcal: number,
  weeklyRateKg: number,
  opts: { sex: Sex | null; bmi?: number | null },
): { kcal: number; clamped: KcalClamp } {
  let raw = expenditureKcal + dailyDeltaForWeeklyRate(weeklyRateKg);
  let clamped: KcalClamp = null;
  const share = opts.bmi != null && opts.bmi >= 30 ? MAX_DEFICIT_SHARE_OBESE : MAX_DEFICIT_SHARE;
  const floor = expenditureKcal * (1 - share);
  if (raw < floor) {
    raw = floor;
    clamped = 'deficit';
  }
  const min = opts.sex ? MIN_KCAL[opts.sex] : MIN_KCAL_UNKNOWN;
  if (raw < min) {
    raw = min;
    clamped = 'minimum';
  }
  return { kcal: roundTo(raw, 10), clamped };
}

export interface CalorieGoal {
  bmr: number;
  /** The expenditure used: from the person's data or BMR × activity factor. */
  tdee: number;
  kcal: number;
  /** The limit that raised the target (see `kcalTarget`). */
  clamped: KcalClamp;
  source: 'data' | 'formula';
}

/**
 * The calorie target of a profile. With `expenditureKcal` (estimate from the person's own data) that
 * replaces BMR × activity factor.
 */
export function calorieGoal(
  p: BodyProfile,
  activity: ActivityLevel,
  weeklyRateKg: number,
  opts: { expenditureKcal?: number | null } = {},
): CalorieGoal {
  const bmr = bmrMifflinStJeor(p);
  const fromData = opts.expenditureKcal != null;
  const t = fromData ? opts.expenditureKcal! : bmr * ACTIVITY_FACTORS[activity];
  const { kcal, clamped } = kcalTarget(t, weeklyRateKg, { sex: p.sex, bmi: bmi(p.weightKg, p.heightCm) });
  return { bmr: Math.round(bmr), tdee: Math.round(t), kcal, clamped, source: fromData ? 'data' : 'formula' };
}

export interface MacroGrams {
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
}

/** Lowest fat per kg body weight (lower end of 0.5 to 1.5 g/kg, Iraki 2019, Helms 2014). */
export const FAT_FLOOR_PER_KG = 0.5;

export interface MacroSplitOptions {
  /**
   * Protein per kg body weight. Default 2.0 g/kg: 1.6 is the well supported lower bound, the
   * confidence interval and advice of Morton 2018 reach 2.2; Iraki 2019 and Stokes 2018 give 1.6 to
   * 2.2. In a deficit the need rises (Helms 2014).
   */
  proteinPerKg?: number;
  /** Fat share of energy in percent. Default 30 % (DGE guideline value for adults: 30 %). */
  fatPct?: number;
  /**
   * Carbohydrate share of energy in percent. When set, carbs are fixed and fat fills the rest
   * (low carb); `fatPct` is ignored.
   */
  carbsPct?: number | null;
}

/**
 * Default macro split: protein by body weight (no cap), fat by energy share but at least
 * `FAT_FLOOR_PER_KG`, carbohydrates fill the rest (at least 0); or, with `carbsPct`, carbohydrates
 * fixed and fat fills the rest (again at least the floor).
 */
export function defaultMacros(kcal: number, weightKg: number, opts: MacroSplitOptions = {}): MacroGrams {
  const proteinPerKg = opts.proteinPerKg ?? 2.0;
  const proteinG = proteinPerKg * weightKg;
  const proteinKcal = proteinG * KCAL_PER_G.protein;
  const fatFloorG = FAT_FLOOR_PER_KG * weightKg;
  let fatG: number;
  let carbsG: number;
  if (opts.carbsPct != null) {
    carbsG = (kcal * opts.carbsPct) / 100 / KCAL_PER_G.carbs;
    fatG = Math.max(fatFloorG, (kcal - proteinKcal - carbsG * KCAL_PER_G.carbs) / KCAL_PER_G.fat);
  } else {
    fatG = Math.max(fatFloorG, (kcal * (opts.fatPct ?? 30)) / 100 / KCAL_PER_G.fat);
    carbsG = Math.max(0, kcal - proteinKcal - fatG * KCAL_PER_G.fat) / KCAL_PER_G.carbs;
  }
  return {
    kcal: Math.round(kcal),
    proteinG: Math.round(proteinG),
    fatG: Math.round(fatG),
    carbsG: Math.round(carbsG),
  };
}

export const MACRO_PRESET_IDS = ['balanced', 'high_protein', 'gain', 'cut', 'low_carb', 'custom'] as const;
export type MacroPresetId = (typeof MACRO_PRESET_IDS)[number];

export interface MacroPreset {
  id: Exclude<MacroPresetId, 'custom'>;
  label: string;
  hint: string;
  proteinPerKg: number;
  fatPct: number | null;
  carbsPct: number | null;
}

/**
 * Macro templates for the goal editor. Protein per kg body weight is what matters most in practice;
 * fat or carbohydrates are set as energy share, the remaining macro fills up the calories.
 */
export const MACRO_PRESETS: readonly MacroPreset[] = [
  {
    id: 'high_protein',
    label: 'Proteinreich',
    hint: '2,0 g Eiweiß/kg · 30 % Fett',
    proteinPerKg: 2.0,
    fatPct: 30,
    carbsPct: null,
  },
  {
    id: 'cut',
    label: 'Diät / Muskelerhalt',
    hint: '2,2 g Eiweiß/kg · 25 % Fett',
    proteinPerKg: 2.2,
    fatPct: 25,
    carbsPct: null,
  },
  {
    id: 'gain',
    label: 'Muskelaufbau',
    hint: '2,0 g Eiweiß/kg · 25 % Fett',
    proteinPerKg: 2.0,
    fatPct: 25,
    carbsPct: null,
  },
  {
    id: 'low_carb',
    label: 'Low Carb',
    hint: '2,0 g Eiweiß/kg · 20 % Kohlenhydrate',
    proteinPerKg: 2.0,
    fatPct: null,
    carbsPct: 20,
  },
  {
    id: 'balanced',
    label: 'Ausgewogen',
    hint: '1,0 g Eiweiß/kg · 30 % Fett',
    proteinPerKg: 1.0,
    fatPct: 30,
    carbsPct: null,
  },
];

/** A chosen macro plan (template or own values), stored in the settings. */
export interface MacroPlan {
  preset: MacroPresetId;
  proteinPerKg: number;
  fatPct: number | null;
  carbsPct: number | null;
}

export const DEFAULT_MACRO_PLAN: MacroPlan = {
  preset: 'high_protein',
  proteinPerKg: 2.0,
  fatPct: 30,
  carbsPct: null,
};

export function planFromPreset(id: MacroPreset['id']): MacroPlan {
  const p = MACRO_PRESETS.find((x) => x.id === id)!;
  return { preset: p.id, proteinPerKg: p.proteinPerKg, fatPct: p.fatPct, carbsPct: p.carbsPct };
}

/** Macro grams for a calorie target and body weight according to a plan. */
export function macrosForPlan(kcal: number, weightKg: number, plan: MacroPlan): MacroGrams {
  return defaultMacros(kcal, weightKg, {
    proteinPerKg: plan.proteinPerKg,
    fatPct: plan.fatPct ?? undefined,
    carbsPct: plan.carbsPct,
  });
}

/** True when protein and fat (after the floor) of a plan alone need more than `kcal`. */
export function macrosExceedKcal(kcal: number, weightKg: number, plan: MacroPlan): boolean {
  const proteinKcal = plan.proteinPerKg * weightKg * KCAL_PER_G.protein;
  const fatG =
    plan.carbsPct != null
      ? FAT_FLOOR_PER_KG * weightKg
      : Math.max(FAT_FLOOR_PER_KG * weightKg, (kcal * (plan.fatPct ?? 30)) / 100 / KCAL_PER_G.fat);
  const carbsKcal = plan.carbsPct != null ? (kcal * plan.carbsPct) / 100 : 0;
  return proteinKcal + fatG * KCAL_PER_G.fat + carbsKcal > kcal + 0.5;
}

/** Energy implied by macro grams (for the "macros don't add up" hint in the goal editor). */
export function kcalFromMacros(g: Pick<MacroGrams, 'proteinG' | 'fatG' | 'carbsG'>): number {
  return g.proteinG * KCAL_PER_G.protein + g.fatG * KCAL_PER_G.fat + g.carbsG * KCAL_PER_G.carbs;
}

/** Body-mass index. */
export function bmi(weightKg: number, heightCm: number): number {
  const m = heightCm / 100;
  return weightKg / (m * m);
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}
