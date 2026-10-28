/**
 * "Zuletzt & häufig": the trainings a person usually logs, from the diary itself. Every sport logged
 * in the last `SUGGESTION_DAYS` scores by how often and how recently it was logged, the same weekday
 * a little higher (the Monday gym day), and carries the duration, intensity and note of its last
 * entry (what Hevy does: the values from last time). Shown as badges under the diary's training
 * card (one tap logs it) and on the page "Training eintragen" (one tap selects it).
 *
 * Free of `@/` aliases on purpose (the API test suite imports `db/*`).
 */
import { addDays, diffDays, type ExerciseEntry, type Intensity, type ISODate } from '@ft/shared';
import type { UserDb } from './dexie';
import { SUGGESTION_DAYS } from './suggestions';

/** Weight halves every 14 days: last week's run counts about twice as much as the one 3 weeks ago. */
const HALF_LIFE_DAYS = 14;
const SAME_WEEKDAY_BONUS = 1.5;
const weekday = (date: string) => new Date(`${date}T12:00:00`).getDay();

/** Duration, intensity and note of a training as logged last time. */
export interface TrainingValues {
  typeKey: string;
  name: string;
  minutes: number;
  intensity: Intensity;
  note: string | null;
}

export interface TrainingSuggestion extends TrainingValues {
  /** Times the sport was logged within `SUGGESTION_DAYS`. */
  count: number;
  score: number;
  lastDate: ISODate;
}

export interface TrainingHistory {
  /** Best first, without the sports already logged on the date (unless `withLogged`), cut to the limit. */
  suggestions: TrainingSuggestion[];
  /** Last values of every sport logged in the window (also the ones logged on the date). */
  last: Map<string, TrainingValues>;
}

/**
 * Suggestions for `date` and the last values per sport, from one read of the trainings of the last
 * `SUGGESTION_DAYS` days up to the date. A sport already logged on the date is no suggestion in the
 * diary (the next best moves up before the cut); the page "Training eintragen" shows it anyway
 * (`withLogged`: a second run of the day is a tap away).
 */
export async function trainingHistory(
  db: UserDb,
  date: ISODate,
  { limit = 6, withLogged = false }: { limit?: number; withLogged?: boolean } = {},
): Promise<TrainingHistory> {
  const entries = await db.exerciseEntries
    .where('date')
    .between(addDays(date, -SUGGESTION_DAYS), date, true, true)
    .filter((e) => !e.deleted)
    .toArray();
  const wd = weekday(date);
  const byType = new Map<string, TrainingSuggestion & { loggedAt: number }>();
  const today = new Set<string>();
  for (const e of entries) {
    if (e.date === date) today.add(e.typeKey);
    const w =
      0.5 ** (diffDays(e.date, date) / HALF_LIFE_DAYS) * (weekday(e.date) === wd ? SAME_WEEKDAY_BONUS : 1);
    const have = byType.get(e.typeKey);
    if (!have) {
      byType.set(e.typeKey, { ...values(e), count: 1, score: w, lastDate: e.date, loggedAt: e.loggedAt });
      continue;
    }
    have.count += 1;
    have.score += w;
    // The last entry gives the values; `loggedAt` orders entries of the same day.
    if (e.date > have.lastDate || (e.date === have.lastDate && e.loggedAt > have.loggedAt)) {
      Object.assign(have, values(e), { lastDate: e.date, loggedAt: e.loggedAt });
    }
  }
  const all = [...byType.values()];
  const last = new Map(all.map((s) => [s.typeKey, values(s)]));
  const suggestions = all
    .filter((s) => withLogged || !today.has(s.typeKey))
    .sort((a, b) => b.score - a.score || b.lastDate.localeCompare(a.lastDate))
    .slice(0, limit)
    .map(({ loggedAt: _l, ...s }) => s);
  return { suggestions, last };
}

function values(
  e: Pick<ExerciseEntry, 'typeKey' | 'name' | 'minutes' | 'intensity' | 'note'>,
): TrainingValues {
  return {
    typeKey: e.typeKey,
    name: e.name,
    minutes: e.minutes,
    intensity: e.intensity,
    note: e.note ?? null,
  };
}
