import {
  EXERCISE_TYPES,
  INTENSITY_LABELS_DE,
  metFor,
  normalize,
  tokenize,
  trainingKcal,
  type ExerciseEntry,
  type Intensity,
} from '@ft/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { useDb } from '@/app/session';
import type { TrainingToLog } from '@/db/entries';
import { fmt0, fmtDate } from '@/lib/format';

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

/** Own sports first, then the built-in ones. */
export function useTypeOptions(): TypeOption[] {
  const db = useDb();
  const customTypes = useLiveQuery(() => db.exerciseTypes.filter((t) => !t.deleted).toArray(), [db]);
  return useMemo(
    () => [
      ...(customTypes ?? []).map((t) => ({
        key: t.id,
        name: t.name,
        met: { moderate: t.met },
        custom: true,
      })),
      ...EXERCISE_TYPES.map((t) => ({ key: t.key, name: t.name, met: t.met, custom: false })),
    ],
    [customTypes],
  );
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

/** "Joggen · 60 Min. · mittel · 6.10. · Notiz" (parts left out when missing). */
export function describe(
  typeName: string | null,
  minutes: number,
  intensity: Intensity,
  note: string | null,
  date?: string,
): string {
  return [typeName, `${fmt0(minutes)} Min.`, INTENSITY_LABELS_DE[intensity], date && fmtDate(date), note]
    .filter(Boolean)
    .join(' · ');
}

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
