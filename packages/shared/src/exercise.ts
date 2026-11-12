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

import {
  dayId,
  STEPS_TYPE_KEY,
  type ExerciseEntry,
  type ExerciseTemplate,
  type TrainingItem,
} from './schemas.js';

export { STEPS_TYPE_KEY };

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

/**
 * Energy above resting for the workout ((MET − 1) × kg × h): what is added to the daily budget.
 * Deliberately generous: the activity level (PAL) already contains some everyday movement during
 * these hours, so part of a workout is counted twice. The person chooses the level "without
 * workouts" (see `ACTIVITY_FACTORS`), which keeps that overlap small.
 */
export function netExerciseKcal(met: number, weightKg: number, minutes: number): number {
  return Math.max(0, met - 1) * weightKg * (minutes / 60);
}

/** Fallback body weight when none is logged yet (only used for the estimate, UI asks to log weight). */
export const DEFAULT_WEIGHT_KG = 75;

/** The kcal a training credits to the day, in whole kcal (what an entry stores when nothing was typed). */
export function trainingKcal(met: number, weightKg: number, minutes: number): number {
  return Math.round(netExerciseKcal(met, weightKg, minutes));
}

/** Longest duration of one training in minutes (a day). */
export const MAX_MINUTES = 1440;

/** "45 Min.", "1 Std.", "1 Std. 15 Min." (minutes rounded to whole ones). */
export function formatDuration(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} Min.`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} Std. ${rest} Min.` : `${h} Std.`;
}

/**
 * Durations on the wheel, ascending: every 5 minutes up to 2 hours, then every 15 minutes up to 6
 * hours, plus `extra` (a typed or stored duration off the raster, e.g. 47) at its place.
 */
export function durationWheelValues(extra: number | null = null): number[] {
  const out: number[] = [];
  for (let m = 5; m <= 120; m += 5) out.push(m);
  for (let m = 135; m <= 360; m += 15) out.push(m);
  if (extra !== null && extra >= 1 && extra <= MAX_MINUTES && !out.includes(extra)) {
    out.push(extra);
    out.sort((a, b) => a - b);
  }
  return out;
}

/** The activities of a saved training in order: the flat fields (activity 1), then `extraItems`. */
export function trainingItemsOf(
  t: Pick<ExerciseTemplate, 'typeKey' | 'typeName' | 'minutes' | 'intensity' | 'note'> & {
    extraItems?: TrainingItem[] | null;
  },
): TrainingItem[] {
  return [
    {
      typeKey: t.typeKey,
      typeName: t.typeName,
      minutes: t.minutes,
      intensity: t.intensity,
      note: t.note ?? null,
    },
    ...(t.extraItems ?? []),
  ];
}

/**
 * Whether an entry's kcal are the computed ones (from its own MET, weight and minutes), not typed
 * (a value from a watch). There is no stored flag; one kcal of rounding is tolerated.
 */
export function isAutoTrainingKcal(
  entry: Pick<ExerciseEntry, 'kcal' | 'met' | 'weightKg' | 'minutes'>,
): boolean {
  return Math.abs(entry.kcal - trainingKcal(entry.met, entry.weightKg, entry.minutes)) <= 1;
}

/** A row of the diary's training card: a single entry, or the entries logged together from a saved training. */
export type TrainingRow<E extends TrainingRowEntry = ExerciseEntry> =
  { kind: 'entry'; entry: E } | { kind: 'group'; groupId: string; templateId: string | null; entries: E[] };

type TrainingRowEntry = Pick<ExerciseEntry, 'id' | 'loggedAt'> & {
  groupId?: string | null;
  templateId?: string | null;
};

/**
 * Groups entries that share a `groupId` into one row at the place of its first entry (`loggedAt`
 * order). A group needs at least two entries; what is left of one (the others deleted) is a single
 * row. Titles are resolved by the app (`trainingTitle`), not here.
 */
export function groupTrainingEntries<E extends TrainingRowEntry>(entries: readonly E[]): TrainingRow<E>[] {
  const sorted = [...entries].sort((a, b) => a.loggedAt - b.loggedAt);
  const byGroup = new Map<string, E[]>();
  for (const e of sorted) {
    if (!e.groupId) continue;
    const list = byGroup.get(e.groupId);
    if (list) list.push(e);
    else byGroup.set(e.groupId, [e]);
  }
  const rows: TrainingRow<E>[] = [];
  const seen = new Set<string>();
  for (const e of sorted) {
    const group = e.groupId ? byGroup.get(e.groupId) : undefined;
    if (!group || group.length < 2) {
      rows.push({ kind: 'entry', entry: e });
      continue;
    }
    if (seen.has(e.groupId!)) continue;
    seen.add(e.groupId!);
    rows.push({ kind: 'group', groupId: e.groupId!, templateId: e.templateId ?? null, entries: group });
  }
  return rows;
}

/** The name of a sport for short lists: up to the first " / " ("Dehnen / Mobility" is "Dehnen"). */
export const shortSportName = (name: string) => name.split(' / ')[0]!;

/** "Krafttraining · Dehnen · 1 Std. 15 Min.": the sports and the total duration of some activities. */
export function trainingSummary(items: readonly { typeName: string; minutes: number }[]): string {
  const total = items.reduce((s, i) => s + i.minutes, 0);
  return [...items.map((i) => shortSportName(i.typeName)), formatDuration(total)].join(' · ');
}

// ---------------------------------------------------------------- steps from Apple Health

/** Walking at a moderate pace (Compendium 17190/17200), the MET of a steps entry. */
export const STEPS_MET = 3.5;
/** Steps are logged from this many a day unless the person chose another limit (`settings.stepsMinimum`). */
export const DEFAULT_STEPS_MINIMUM = 1000;
/** Distance per minute at 4,8 km/h: the walking time behind a distance. */
const STEPS_METERS_PER_MINUTE = 80;
/** Without a usable distance: steps per minute of walking. */
const STEPS_PER_MINUTE = 100;
/** A distance counts when one step is between these lengths (else Health sent something odd). */
const STEP_LENGTH_M = { min: 0.3, max: 1.5 };

/** Whether a training is the day's steps (shown and counted apart from the other trainings). */
export function isStepsEntry(e: Pick<ExerciseEntry, 'typeKey'>): boolean {
  return e.typeKey === STEPS_TYPE_KEY;
}

/**
 * A steps record under any other id than `dayId.steps(date)`: the server refuses it (an older app
 * copied one as a training), so it is never shown or counted, also before the sync drops it.
 */
export function isStraySteps(e: Pick<ExerciseEntry, 'id' | 'typeKey' | 'date'>): boolean {
  return isStepsEntry(e) && e.id !== dayId.steps(e.date);
}

/** The day's steps entry: only the one with the fixed id `s:<date>`, never a stray copy. */
export function stepsEntryOf<T extends Pick<ExerciseEntry, 'id' | 'typeKey' | 'date' | 'deleted'>>(
  entries: readonly T[],
  date: string,
): T | undefined {
  const id = dayId.steps(date);
  return entries.find((e) => e.id === id && !e.deleted && isStepsEntry(e));
}

/**
 * Duration and kcal of a day's steps: walking time from the distance at 4,8 km/h (or 100 steps a
 * minute when the distance is missing or implausible), kcal like any training at `STEPS_MET`.
 * `distanceM` is null when it was not usable.
 */
export function stepsValues(p: { steps: number; distanceM: number | null; weightKg: number }): {
  minutes: number;
  kcal: number;
  distanceM: number | null;
} {
  const perStep = p.distanceM !== null && p.steps > 0 ? p.distanceM / p.steps : 0;
  const distanceM =
    p.distanceM !== null && perStep >= STEP_LENGTH_M.min && perStep <= STEP_LENGTH_M.max
      ? Math.round(p.distanceM)
      : null;
  const raw = distanceM !== null ? distanceM / STEPS_METERS_PER_MINUTE : p.steps / STEPS_PER_MINUTE;
  const minutes = Math.min(MAX_MINUTES, Math.max(1, Math.round(raw)));
  return { minutes, kcal: trainingKcal(STEPS_MET, p.weightKg, minutes), distanceM };
}
