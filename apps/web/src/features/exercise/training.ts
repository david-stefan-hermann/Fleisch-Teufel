import {
  EXERCISE_TYPES,
  formatDuration,
  INTENSITY_LABELS_DE,
  metFor,
  normalize,
  tokenize,
  trainingKcal,
  diffDays,
  type ExerciseEntry,
  type ISODate,
  type ExerciseTemplate,
  type Intensity,
} from '@ft/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { useDb } from '@/app/session';
import type { TrainingToLog } from '@/db/entries';
import { fmtDate, fmtDayMonth, fmtWeekday } from '@/lib/format';

/** A sport to pick: one of the built-in types or an own one (`custom`, single MET value). */
export interface TypeOption {
  key: string;
  name: string;
  met: { light?: number; moderate: number; vigorous?: number };
  custom: boolean;
}

/** What is chosen for one training: duration, intensity, note (and the saved training it comes from). */
export interface TrainingInput {
  minutes: number;
  intensity: Intensity;
  note: string | null;
  templateId?: string | null;
}

/** A training of a sport as it is logged: name, MET and kcal with the given weight (one place for them). */
export function toLog(type: TypeOption, values: TrainingInput, weightKg: number): TrainingToLog {
  const intensity = type.custom ? 'moderate' : values.intensity;
  const met = metFor(type, intensity);
  return {
    typeKey: type.key,
    name: type.name,
    minutes: values.minutes,
    intensity,
    met,
    weightKg,
    kcal: trainingKcal(met, weightKg, values.minutes),
    note: values.note?.trim() || null,
    templateId: values.templateId ?? null,
  };
}

/**
 * The activities of a suggestion or saved training as trainings to log, with the given weight. A
 * saved training's activities share a group mark and carry its id. Activities whose sport no longer
 * exists are left out and named in `missing`.
 */
export function rowsToLog(
  options: readonly TypeOption[],
  items: readonly {
    typeKey: string;
    name: string;
    minutes: number;
    intensity: Intensity;
    note: string | null;
  }[],
  weightKg: number,
  templateId: string | null,
): { rows: TrainingToLog[]; missing: string[] } {
  const rows: TrainingToLog[] = [];
  const missing: string[] = [];
  for (const item of items) {
    const type = options.find((o) => o.key === item.typeKey);
    if (!type) {
      missing.push(item.name);
      continue;
    }
    const row = toLog(type, { ...item, templateId }, weightKg);
    rows.push(templateId ? { ...row, group: templateId } : row);
  }
  return { rows, missing };
}

/** Toast text for activities whose sport was deleted. */
export const missingSportsText = (missing: readonly string[]) =>
  missing.length ? `${missing.join(', ')} gibt es nicht mehr.` : '';

/** "Zuletzt heute", "Zuletzt gestern", "Zuletzt am Dienstag" (within a week), "Zuletzt am 3. Oktober". */
export function lastLoggedLabel(lastDate: ISODate, today: ISODate): string {
  const days = diffDays(lastDate, today);
  if (days <= 0) return 'Zuletzt heute';
  if (days === 1) return 'Zuletzt gestern';
  if (days < 7) return `Zuletzt am ${fmtWeekday(lastDate)}`;
  return `Zuletzt am ${fmtDayMonth(lastDate)}`;
}

/** Saved trainings in list order: pinned first, then by name. */
export function sortTrainings<T extends { name: string; pinned?: boolean | null }>(list: readonly T[]): T[] {
  return [...list].sort(
    (a, b) =>
      Number(b.pinned === true) - Number(a.pinned === true) ||
      a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }),
  );
}

/** Values a sport starts with without history: 30 minutes, moderate. */
export const DEFAULT_SPORT_VALUES = { minutes: 30, intensity: 'moderate' as Intensity, note: null };

/** The saved trainings (not deleted) in list order. */
export function useTrainings(): ExerciseTemplate[] | undefined {
  const db = useDb();
  return useLiveQuery(
    async () => sortTrainings(await db.exerciseTemplates.filter((t) => !t.deleted).toArray()),
    [db],
  );
}

const BUILT_IN: TypeOption[] = EXERCISE_TYPES.map((t) => ({
  key: t.key,
  name: t.name,
  met: t.met,
  custom: false,
}));

/** Own sports first, then the built-in ones; undefined until the own sports are read. */
export function useLoadedTypeOptions(): TypeOption[] | undefined {
  const db = useDb();
  const customTypes = useLiveQuery(() => db.exerciseTypes.filter((t) => !t.deleted).toArray(), [db]);
  return useMemo(
    () =>
      customTypes && [
        ...customTypes.map((t) => ({ key: t.id, name: t.name, met: { moderate: t.met }, custom: true })),
        ...BUILT_IN,
      ],
    [customTypes],
  );
}

/** Own sports first, then the built-in ones (only the built-in ones until the own sports are read). */
export function useTypeOptions(): TypeOption[] {
  return useLoadedTypeOptions() ?? BUILT_IN;
}

/** Names of the saved trainings by id, deleted ones included (an entry keeps showing its name). */
export function useTrainingNames(): ReadonlyMap<string, string> | undefined {
  const db = useDb();
  return useLiveQuery(
    async () => new Map((await db.exerciseTemplates.toArray()).map((t) => [t.id, t.name])),
    [db],
  );
}

/**
 * What a training entry is called: the name of the saved training it was logged from (its current
 * name, also when that training was deleted, like the name of a saved meal), else the sport. `sport`
 * is the sport for the line below, only when the title is not the sport itself.
 */
export function trainingTitle(
  entry: Pick<ExerciseEntry, 'name'> & { templateId?: string | null },
  names: ReadonlyMap<string, string> | undefined,
): { title: string; sport: string | null } {
  const saved = entry.templateId ? names?.get(entry.templateId) : undefined;
  if (!saved || saved === entry.name) return { title: entry.name, sport: null };
  return { title: saved, sport: entry.name };
}

/** "Joggen · 1 Std. · Mittel · 6.10. · Notiz" (parts left out when missing). */
export function describe(
  typeName: string | null,
  minutes: number,
  intensity: Intensity,
  note: string | null,
  date?: string,
): string {
  return [typeName, formatDuration(minutes), INTENSITY_LABELS_DE[intensity], date && fmtDate(date), note]
    .filter(Boolean)
    .join(' · ');
}

/** "45 Min. · Mittel": duration and intensity of an activity. */
export const describeValues = (v: { minutes: number; intensity: Intensity }) =>
  describe(null, v.minutes, v.intensity, null);

/**
 * Training search: every word of the query occurs in one of the fields (name, sport, note),
 * case and umlauts ignored like the food search. An empty query matches everything.
 */
export function matchesTraining(query: string, fields: (string | null | undefined)[]): boolean {
  const words = tokenize(query);
  if (words.length === 0) return true;
  const haystack = normalize(fields.filter(Boolean).join(' '));
  return words.every((w) => haystack.includes(w));
}
