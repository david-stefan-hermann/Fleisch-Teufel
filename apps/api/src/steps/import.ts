/**
 * Turning a shortcut's payload into days and days into steps entries. `stepsDays` is pure (the
 * shortcut's lists in, one row per day out); `stepsRecord` decides what one day's entry becomes.
 * The route (`routes/steps.ts`) reads the stored records and writes the result through the sync.
 */
import {
  addDays,
  dayId,
  DEFAULT_STEPS_MINIMUM,
  isAutoTrainingKcal,
  STEPS_MET,
  STEPS_TYPE_KEY,
  stepsValues,
  type ExerciseEntry,
  type ISODate,
} from '@ft/shared';
import { z } from 'zod';
import { parseDay, parseDistanceM, parseList, parseNumber, StepsParseError } from './parse.js';

/** Days the shortcut asks Health for ("in den letzten 7 Tagen"). */
export const STEPS_WINDOW_DAYS = 7;

const listSchema = z.union([z.string(), z.array(z.union([z.string(), z.number()])), z.number()]).optional();

export const stepsImportSchema = z.object({
  stepDates: listSchema,
  stepValues: listSchema,
  distanceDates: listSchema,
  distanceValues: listSchema,
  /** The phone's current date (the import's "today"); without it the oldest day is left out. */
  now: z.string().max(100).optional(),
});
export type StepsImportBody = z.infer<typeof stepsImportSchema>;

export interface StepsDay {
  date: ISODate;
  steps: number;
  /** Walking distance of the day in meters, null when Health sent none. */
  distanceM: number | null;
}

function phoneDay(now: string): ISODate {
  const day = parseDay(now.trim());
  if (!day) throw new StepsParseError(`now: unreadable date "${now.slice(0, 40)}"`);
  return day;
}

/** The phone's date when it is more than a day away from the server's (and therefore not used). */
export function phoneDateIgnored(body: StepsImportBody, serverToday: ISODate): ISODate | null {
  if (body.now === undefined) return null;
  const day = phoneDay(body.now);
  return day < addDays(serverToday, -1) || day > addDays(serverToday, 1) ? day : null;
}

/** Sums one list pair per day. */
function sumByDay(
  dates: string[],
  values: string[],
  read: (v: string) => number | null,
  field: string,
): Map<ISODate, number> {
  if (dates.length !== values.length)
    throw new StepsParseError(
      `${field}: ${dates.length} dates but ${values.length} values (both lists must come from the same Health action)`,
    );
  const out = new Map<ISODate, number>();
  for (const [i, d] of dates.entries()) {
    const day = parseDay(d);
    if (!day) throw new StepsParseError(`${field}: unreadable date "${d.slice(0, 40)}"`);
    const v = read(values[i]!);
    if (v === null || v < 0)
      throw new StepsParseError(`${field}: unreadable value "${values[i]!.slice(0, 40)}"`);
    out.set(day, (out.get(day) ?? 0) + v);
  }
  return out;
}

/**
 * The days of a payload with their sums, oldest first. Only "today" and the six days before it
 * count: Health's window ("in den letzten 7 Tagen") starts at the same time of day a week ago, so
 * the day before them would come in cut short and make a correct value smaller. Without `now`,
 * "today" is the latest day sent and the oldest day sent is left out for the same reason. A `now`
 * more than a day away from the server's date (`serverToday`) is not trusted: the server's date
 * counts instead (`phoneDateIgnored` says so).
 */
export function stepsDays(body: StepsImportBody, serverToday?: ISODate): StepsDay[] {
  const steps = sumByDay(
    parseList(body.stepDates, 'stepDates'),
    parseList(body.stepValues, 'stepValues'),
    (v) => parseNumber(v, 'count'),
    'steps',
  );
  const distance = sumByDay(
    parseList(body.distanceDates, 'distanceDates'),
    parseList(body.distanceValues, 'distanceValues'),
    parseDistanceM,
    'distance',
  );
  const sent = [...steps.keys()].sort();
  if (sent.length === 0) return [];
  let today: ISODate;
  let from: ISODate;
  if (body.now !== undefined) {
    const day = phoneDay(body.now);
    today = serverToday && phoneDateIgnored(body, serverToday) ? serverToday : day;
    from = addDays(today, -(STEPS_WINDOW_DAYS - 1));
  } else {
    today = sent.at(-1)!;
    from = sent.length > 1 ? addDays(sent[0]!, 1) : sent[0]!;
    if (from < addDays(today, -(STEPS_WINDOW_DAYS - 1))) from = addDays(today, -(STEPS_WINDOW_DAYS - 1));
  }
  return sent
    .filter((d) => d >= from && d <= today)
    .map((date) => ({
      date,
      steps: Math.round(steps.get(date)!),
      distanceM: distance.has(date) ? Math.round(distance.get(date)!) : null,
    }));
}

/**
 * What a day's steps entry becomes, or null when nothing is to be written: below the person's
 * minimum without an entry yet, deleted by the person (a tombstone stays deleted), or unchanged.
 * A live entry gets the new steps, distance and duration; its kcal and weight are recomputed only
 * while they are the computed ones (typed kcal stay), its note always stays.
 */
export function stepsRecord(p: {
  day: StepsDay;
  existing: ExerciseEntry | undefined;
  weightKg: number;
  minimum: number | null;
  now: number;
}): Omit<ExerciseEntry, 'updatedAt'> | null {
  const { day, existing, weightKg } = p;
  if (existing?.deleted) return null;
  if (!existing && day.steps < (p.minimum ?? DEFAULT_STEPS_MINIMUM)) return null;
  const v = stepsValues({ steps: day.steps, distanceM: day.distanceM, weightKg });
  if (!existing)
    return {
      id: dayId.steps(day.date),
      deleted: false,
      date: day.date,
      typeKey: STEPS_TYPE_KEY,
      name: 'Schritte',
      minutes: v.minutes,
      intensity: 'moderate',
      met: STEPS_MET,
      weightKg,
      kcal: v.kcal,
      loggedAt: p.now,
      note: null,
      templateId: null,
      groupId: null,
      steps: day.steps,
      distanceM: v.distanceM,
      purgedAt: null,
    };
  const auto = isAutoTrainingKcal(existing);
  const { updatedAt: _u, ...rest } = existing;
  const next = {
    ...rest,
    steps: day.steps,
    distanceM: v.distanceM,
    minutes: v.minutes,
    ...(auto ? { weightKg, kcal: v.kcal } : {}),
  };
  const same =
    next.steps === existing.steps &&
    next.distanceM === existing.distanceM &&
    next.minutes === existing.minutes &&
    next.weightKg === existing.weightKg &&
    next.kcal === existing.kcal;
  return same ? null : next;
}

/** Whether a day came with a distance that fits its steps (else the steps alone count). */
export function hasUsableDistance(d: StepsDay): boolean {
  return (
    d.distanceM !== null &&
    stepsValues({ steps: d.steps, distanceM: d.distanceM, weightKg: 1 }).distanceM !== null
  );
}

/**
 * What looks wrong in a payload that went through: no distance at all (the second Health action is
 * missing or filters the steps instead of searching), or a distance that does not fit the steps of
 * its day (wrong unit) and was left out. German, for the shortcut's answer and Mehr → Schritte.
 */
export function stepsWarnings(days: readonly StepsDay[]): string[] {
  if (days.length === 0) return [];
  if (days.every((d) => d.distanceM === null))
    return [
      'Keine Strecke empfangen: Aktion „Health-Messungen suchen“ mit „Strecke (Gehen und Laufen)“ prüfen.',
    ];
  return days.flatMap((d) =>
    d.distanceM !== null && !hasUsableDistance(d)
      ? [
          `${d.date}: ${(d.distanceM / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} km passen nicht zu ${d.steps.toLocaleString('de-DE')} Schritten, Strecke nicht übernommen (Einheit km?).`,
        ]
      : [],
  );
}
