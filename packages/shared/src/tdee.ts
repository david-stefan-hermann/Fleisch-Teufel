import { KCAL_PER_G } from './nutrients.js';

export type Sex = 'male' | 'female';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';

/**
 * Physical activity level multipliers (classic Harris-Benedict/Mifflin multipliers).
 * Exercise is logged separately (feature #9), so users should pick their level *without* workouts.
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

/** Lowest daily target suggested without medical supervision. */
export const MIN_KCAL: Record<Sex, number> = { male: 1500, female: 1200 };

/** Weekly rates offered in onboarding (kg/week; negative = lose). */
export const WEEKLY_RATES = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5] as const;

export interface BodyProfile {
  sex: Sex;
  ageYears: number;
  heightCm: number;
  weightKg: number;
}

/** Basal metabolic rate, Mifflin-St Jeor (1990): 10·kg + 6.25·cm − 5·age + (5 | −161). */
export function bmrMifflinStJeor(p: BodyProfile): number {
  const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.ageYears;
  return base + (p.sex === 'male' ? 5 : -161);
}

export function tdee(p: BodyProfile, activity: ActivityLevel): number {
  return bmrMifflinStJeor(p) * ACTIVITY_FACTORS[activity];
}

/** Daily energy delta for a weekly weight change. */
export function dailyDeltaForWeeklyRate(weeklyRateKg: number): number {
  return (weeklyRateKg * KCAL_PER_KG_BODY_WEIGHT) / 7;
}

export interface CalorieGoal {
  bmr: number;
  tdee: number;
  kcal: number;
  /** True when the raw target fell below MIN_KCAL and was raised. */
  clamped: boolean;
}

export function calorieGoal(p: BodyProfile, activity: ActivityLevel, weeklyRateKg: number): CalorieGoal {
  const bmr = bmrMifflinStJeor(p);
  const t = bmr * ACTIVITY_FACTORS[activity];
  const raw = t + dailyDeltaForWeeklyRate(weeklyRateKg);
  const min = MIN_KCAL[p.sex];
  const kcal = Math.max(raw, min);
  return { bmr: Math.round(bmr), tdee: Math.round(t), kcal: roundTo(kcal, 10), clamped: raw < min };
}

export interface MacroGrams {
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
}

export interface MacroSplitOptions {
  /** Protein per kg body weight. Default 1.8 g/kg (ISSN position stand: 1.4 to 2.0 g/kg for active people). */
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
 * Default macro split: protein by body weight (capped at 35 % of energy), fat by energy share,
 * carbohydrates fill the rest; or, with `carbsPct`, carbohydrates fixed and fat fills the rest.
 */
export function defaultMacros(kcal: number, weightKg: number, opts: MacroSplitOptions = {}): MacroGrams {
  const proteinPerKg = opts.proteinPerKg ?? 1.8;
  const proteinG = Math.min(proteinPerKg * weightKg, (kcal * 0.35) / KCAL_PER_G.protein);
  const proteinKcal = proteinG * KCAL_PER_G.protein;
  let fatG: number;
  let carbsG: number;
  if (opts.carbsPct != null) {
    carbsG = (kcal * opts.carbsPct) / 100 / KCAL_PER_G.carbs;
    fatG = Math.max(0, kcal - proteinKcal - carbsG * KCAL_PER_G.carbs) / KCAL_PER_G.fat;
  } else {
    fatG = (kcal * (opts.fatPct ?? 30)) / 100 / KCAL_PER_G.fat;
    carbsG = Math.max(0, kcal - proteinKcal - fatG * KCAL_PER_G.fat) / KCAL_PER_G.carbs;
  }
  return {
    kcal: Math.round(kcal),
    proteinG: Math.round(proteinG),
    fatG: Math.round(fatG),
    carbsG: Math.round(carbsG),
  };
}

export const MACRO_PRESET_IDS = ['balanced', 'high_protein', 'cut', 'low_carb', 'custom'] as const;
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
    id: 'balanced',
    label: 'Ausgewogen',
    hint: '1,0 g Eiweiß/kg · 30 % Fett, nah an den DGE-Empfehlungen',
    proteinPerKg: 1.0,
    fatPct: 30,
    carbsPct: null,
  },
  {
    id: 'high_protein',
    label: 'Proteinreich',
    hint: '1,6 g Eiweiß/kg · 30 % Fett, sättigt besser, gut bei Sport',
    proteinPerKg: 1.6,
    fatPct: 30,
    carbsPct: null,
  },
  {
    id: 'cut',
    label: 'Diät / Muskelerhalt',
    hint: '2,0 g Eiweiß/kg · 25 % Fett, schützt Muskeln im Defizit',
    proteinPerKg: 2.0,
    fatPct: 25,
    carbsPct: null,
  },
  {
    id: 'low_carb',
    label: 'Low Carb',
    hint: '1,8 g Eiweiß/kg · 20 % Kohlenhydrate, Rest Fett',
    proteinPerKg: 1.8,
    fatPct: null,
    carbsPct: 20,
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
  proteinPerKg: 1.6,
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
