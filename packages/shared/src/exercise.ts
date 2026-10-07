/**
 * Simple training log (feature #9): type + duration → kcal = MET × body weight (kg) × hours.
 *
 * MET values are rounded from the Compendium of Physical Activities
 * (Ainsworth et al. 2011, Med Sci Sports Exerc 43(8):1575-81; updated by Herrmann et al. 2024,
 * J Sport Health Sci 13(1):6-12, https://pacompendium.com). MET values are measured facts;
 * the activity selection and German labels are our own. Activity codes are given for traceability.
 *
 * The gross MET formula includes resting metabolism (1 MET) for the workout period. Since the
 * daily goal already contains that resting energy, `netExerciseKcal` subtracts it to avoid
 * double counting; that is what gets added to the day's budget.
 */

export type Intensity = 'light' | 'moderate' | 'vigorous';

export interface ExerciseType {
  key: string;
  name: string;
  category: 'cardio' | 'strength' | 'sport' | 'mind' | 'everyday';
  /** MET by intensity; `moderate` is required, others optional. */
  met: { light?: number; moderate: number; vigorous?: number };
  compendium?: string;
}

export const EXERCISE_TYPES: readonly ExerciseType[] = [
  {
    key: 'walking',
    name: 'Gehen / Spazieren',
    category: 'everyday',
    met: { light: 2.8, moderate: 3.5, vigorous: 5.0 },
    compendium: '17190/17200/17220',
  },
  {
    key: 'hiking',
    name: 'Wandern',
    category: 'cardio',
    met: { light: 5.3, moderate: 6.0, vigorous: 7.8 },
    compendium: '17080',
  },
  {
    key: 'running',
    name: 'Laufen / Joggen',
    category: 'cardio',
    met: { light: 7.0, moderate: 9.8, vigorous: 11.8 },
    compendium: '12020/12050/12090',
  },
  {
    key: 'treadmill',
    name: 'Laufband',
    category: 'cardio',
    met: { light: 5.0, moderate: 8.3, vigorous: 11.0 },
    compendium: '12029',
  },
  {
    key: 'cycling',
    name: 'Radfahren',
    category: 'cardio',
    met: { light: 4.0, moderate: 6.8, vigorous: 10.0 },
    compendium: '01010/01015/01040',
  },
  {
    key: 'mtb',
    name: 'Mountainbike',
    category: 'cardio',
    met: { light: 7.0, moderate: 8.5, vigorous: 14.0 },
    compendium: '01013',
  },
  {
    key: 'ergometer',
    name: 'Ergometer / Indoor-Bike',
    category: 'cardio',
    met: { light: 3.5, moderate: 6.8, vigorous: 8.8 },
    compendium: '02011-02014',
  },
  {
    key: 'spinning',
    name: 'Spinning-Kurs',
    category: 'cardio',
    met: { moderate: 8.5, vigorous: 10.0 },
    compendium: '02017',
  },
  {
    key: 'swimming',
    name: 'Schwimmen',
    category: 'cardio',
    met: { light: 6.0, moderate: 8.3, vigorous: 9.8 },
    compendium: '18310/18240/18230',
  },
  {
    key: 'rowing',
    name: 'Rudergerät',
    category: 'cardio',
    met: { light: 4.8, moderate: 7.0, vigorous: 8.5 },
    compendium: '02071-02073',
  },
  {
    key: 'elliptical',
    name: 'Crosstrainer',
    category: 'cardio',
    met: { light: 4.0, moderate: 5.0, vigorous: 7.0 },
    compendium: '02048',
  },
  {
    key: 'stairs',
    name: 'Stepper / Treppensteigen',
    category: 'cardio',
    met: { light: 4.0, moderate: 9.0, vigorous: 9.0 },
    compendium: '02065',
  },
  {
    key: 'jump_rope',
    name: 'Seilspringen',
    category: 'cardio',
    met: { light: 8.8, moderate: 11.8, vigorous: 12.3 },
    compendium: '15551-15552',
  },
  {
    key: 'hiit',
    name: 'HIIT / Zirkeltraining',
    category: 'cardio',
    met: { light: 4.3, moderate: 6.0, vigorous: 8.0 },
    compendium: '02040',
  },
  {
    key: 'aerobics',
    name: 'Aerobic / Fitnesskurs',
    category: 'cardio',
    met: { light: 5.0, moderate: 6.5, vigorous: 7.3 },
    compendium: '03015',
  },
  {
    key: 'strength',
    name: 'Krafttraining',
    category: 'strength',
    met: { light: 3.5, moderate: 5.0, vigorous: 6.0 },
    compendium: '02050/02052/02054',
  },
  {
    key: 'calisthenics',
    name: 'Bodyweight / Calisthenics',
    category: 'strength',
    met: { light: 2.8, moderate: 3.8, vigorous: 8.0 },
    compendium: '02020/02022',
  },
  {
    key: 'crossfit',
    name: 'CrossFit / Functional',
    category: 'strength',
    met: { moderate: 6.0, vigorous: 8.0 },
    compendium: '02040',
  },
  {
    key: 'yoga',
    name: 'Yoga',
    category: 'mind',
    met: { light: 2.5, moderate: 3.0, vigorous: 4.0 },
    compendium: '02150/02160',
  },
  {
    key: 'pilates',
    name: 'Pilates',
    category: 'mind',
    met: { light: 2.8, moderate: 3.0, vigorous: 4.0 },
    compendium: '02105',
  },
  {
    key: 'stretching',
    name: 'Dehnen / Mobility',
    category: 'mind',
    met: { light: 2.3, moderate: 2.5 },
    compendium: '02101',
  },
  {
    key: 'football',
    name: 'Fußball',
    category: 'sport',
    met: { light: 7.0, moderate: 7.0, vigorous: 10.0 },
    compendium: '15605/15610',
  },
  {
    key: 'basketball',
    name: 'Basketball',
    category: 'sport',
    met: { light: 4.5, moderate: 6.5, vigorous: 8.0 },
    compendium: '15040/15055',
  },
  {
    key: 'volleyball',
    name: 'Volleyball',
    category: 'sport',
    met: { light: 3.0, moderate: 4.0, vigorous: 6.0 },
    compendium: '15710/15711',
  },
  {
    key: 'tennis',
    name: 'Tennis',
    category: 'sport',
    met: { light: 5.0, moderate: 7.3, vigorous: 8.0 },
    compendium: '15675/15685',
  },
  {
    key: 'badminton',
    name: 'Badminton',
    category: 'sport',
    met: { light: 5.5, moderate: 5.5, vigorous: 7.0 },
    compendium: '15030/15020',
  },
  {
    key: 'squash',
    name: 'Squash',
    category: 'sport',
    met: { moderate: 7.3, vigorous: 12.0 },
    compendium: '15652',
  },
  {
    key: 'table_tennis',
    name: 'Tischtennis',
    category: 'sport',
    met: { light: 4.0, moderate: 4.0, vigorous: 5.0 },
    compendium: '15660',
  },
  {
    key: 'martial_arts',
    name: 'Kampfsport',
    category: 'sport',
    met: { light: 5.3, moderate: 7.8, vigorous: 10.3 },
    compendium: '15430/15425',
  },
  {
    key: 'boxing',
    name: 'Boxen (Sandsack)',
    category: 'sport',
    met: { light: 5.5, moderate: 7.8, vigorous: 12.8 },
    compendium: '15100',
  },
  {
    key: 'climbing',
    name: 'Klettern / Bouldern',
    category: 'sport',
    met: { light: 5.8, moderate: 7.3, vigorous: 8.0 },
    compendium: '17120',
  },
  {
    key: 'dancing',
    name: 'Tanzen',
    category: 'sport',
    met: { light: 3.0, moderate: 5.5, vigorous: 7.8 },
    compendium: '03025/03031',
  },
  {
    key: 'skiing',
    name: 'Ski alpin',
    category: 'sport',
    met: { light: 4.3, moderate: 5.3, vigorous: 8.0 },
    compendium: '19150/19160',
  },
  {
    key: 'xc_skiing',
    name: 'Skilanglauf',
    category: 'sport',
    met: { light: 6.8, moderate: 9.0, vigorous: 12.5 },
    compendium: '19080',
  },
  {
    key: 'inline',
    name: 'Inlineskaten',
    category: 'sport',
    met: { light: 7.5, moderate: 9.8, vigorous: 12.3 },
    compendium: '15591',
  },
  { key: 'golf', name: 'Golf (zu Fuß)', category: 'sport', met: { moderate: 4.8 }, compendium: '15255' },
  {
    key: 'gardening',
    name: 'Gartenarbeit',
    category: 'everyday',
    met: { light: 2.3, moderate: 3.8, vigorous: 5.0 },
    compendium: '08245',
  },
  {
    key: 'housework',
    name: 'Hausarbeit',
    category: 'everyday',
    met: { light: 2.3, moderate: 3.3, vigorous: 3.8 },
    compendium: '05020',
  },
] as const;

export const EXERCISE_TYPE_MAP: ReadonlyMap<string, ExerciseType> = new Map(
  EXERCISE_TYPES.map((t) => [t.key, t]),
);

export const INTENSITY_LABELS_DE: Record<Intensity, string> = {
  light: 'Locker',
  moderate: 'Mittel',
  vigorous: 'Intensiv',
};

/** MET for a type at an intensity, falling back to moderate. */
export function metFor(type: Pick<ExerciseType, 'met'>, intensity: Intensity = 'moderate'): number {
  return type.met[intensity] ?? type.met.moderate;
}

/** Gross energy expenditure: MET × kg × h. */
export function exerciseKcal(met: number, weightKg: number, minutes: number): number {
  return met * weightKg * (minutes / 60);
}

/** Energy above resting for the workout ((MET − 1) × kg × h): what is added to the daily budget. */
export function netExerciseKcal(met: number, weightKg: number, minutes: number): number {
  return Math.max(0, met - 1) * weightKg * (minutes / 60);
}

/** Fallback body weight when none is logged yet (only used for the estimate, UI asks to log weight). */
export const DEFAULT_WEIGHT_KG = 75;

/** The fields that make two trainings "the same" for the quick selection. */
export interface TrainingSetup {
  typeKey: string;
  name: string;
  minutes: number;
  intensity: Intensity;
  note: string | null;
}

/**
 * The last `limit` distinct trainings (newest first, by `loggedAt`) for the quick selection.
 * Entries with the same type, duration, intensity and note count once.
 */
export function recentTrainings<T extends TrainingSetup & { loggedAt: number; deleted?: boolean }>(
  entries: T[],
  limit = 5,
): T[] {
  const out: T[] = [];
  const keys = new Set<string>();
  for (const e of [...entries].sort((a, b) => b.loggedAt - a.loggedAt)) {
    if (e.deleted) continue;
    const key = JSON.stringify([e.typeKey, e.minutes, e.intensity, e.note?.trim() || null]);
    if (keys.has(key)) continue;
    keys.add(key);
    out.push(e);
    if (out.length === limit) break;
  }
  return out;
}
