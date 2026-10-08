import { EXERCISE_TYPES, INTENSITY_LABELS_DE, type Intensity } from '@ft/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { useDb } from '@/app/session';
import { fmt0, fmtDate } from '@/lib/format';

/** A sport to pick: one of the built-in types or an own one (`custom`, single MET value). */
export interface TypeOption {
  key: string;
  name: string;
  met: { light?: number; moderate: number; vigorous?: number };
  custom: boolean;
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

export interface TrainingSetup {
  typeKey: string | null;
  minutes: number | null;
  intensity: Intensity;
  note: string | null;
}

/** Whether a form state matches a saved or earlier training (quick selection shows it as picked). */
export function sameSetup(
  a: TrainingSetup,
  b: { typeKey: string; minutes: number; intensity: Intensity; note: string | null },
): boolean {
  return (
    a.typeKey === b.typeKey &&
    a.minutes === b.minutes &&
    a.intensity === b.intensity &&
    (a.note ?? null) === (b.note?.trim() || null)
  );
}
