/**
 * "Zuletzt & häufig": the trainings a person usually logs, from the diary itself. Every sport (and
 * every saved training) logged in the last `SUGGESTION_DAYS` scores by how often and how recently
 * it was logged, the same weekday a little higher (the Monday gym day), and carries the duration,
 * intensity and note of its last entry (what Hevy does: the values from last time). Shown as badges under the diary's training
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
  /** Name of the sport. */
  name: string;
  minutes: number;
  intensity: Intensity;
  note: string | null;
  /** The saved training the entry was logged from, while it exists (not deleted); else null. */
  templateId: string | null;
  /** Its current name: what the suggestion is called. Null without a saved training. */
  templateName: string | null;
}

export interface TrainingSuggestion extends TrainingValues {
  /** What the suggestion stands for: `t:<templateId>` for a saved training, else the sport's key. */
  key: string;
  /** Times it was logged within `SUGGESTION_DAYS`. */
  count: number;
  score: number;
  lastDate: ISODate;
}

export interface TrainingHistory {
  /** Best first, without what is already logged on the date (unless `withLogged`), cut to the limit. */
  suggestions: TrainingSuggestion[];
  /** Last values of every sport logged in the window (also the ones logged on the date). */
  last: Map<string, TrainingValues>;
}

/** Key of a suggestion: the saved training an entry was logged from, else its sport. */
export const trainingKey = (templateId: string | null, typeKey: string) =>
  templateId ? `t:${templateId}` : typeKey;

/**
 * Suggestions for `date` and the last values per sport, from one read of the trainings of the last
 * `SUGGESTION_DAYS` days up to the date. Entries logged from a saved training form a suggestion of
 * their own, named like the saved training (two saved trainings of one sport are two suggestions);
 * all others, and those of a deleted saved training, count for their sport. The values are always
 * the ones of the last entry, not the current ones of the saved training. What is already logged on
 * the date is no suggestion in the diary (the next best moves up before the cut); the page "Training
 * eintragen" shows it anyway (`withLogged`: a second run of the day is a tap away).
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
  const saved = new Map(
    (await db.exerciseTemplates.filter((t) => !t.deleted).toArray()).map((t) => [t.id, t.name]),
  );
  const wd = weekday(date);
  type Latest<T> = T & { lastDate: ISODate; loggedAt: number };
  const byKey = new Map<string, Latest<TrainingSuggestion>>();
  const byType = new Map<string, Latest<TrainingValues>>();
  const today = new Set<string>();
  // The last entry gives the values; `loggedAt` orders entries of the same day.
  const newer = (e: ExerciseEntry, have: { lastDate: ISODate; loggedAt: number }) =>
    e.date > have.lastDate || (e.date === have.lastDate && e.loggedAt > have.loggedAt);
  for (const e of entries) {
    const v = values(e, saved);
    const at = { lastDate: e.date, loggedAt: e.loggedAt };
    const sport = byType.get(e.typeKey);
    if (!sport || newer(e, sport)) byType.set(e.typeKey, { ...v, ...at });
    const key = trainingKey(v.templateId, e.typeKey);
    if (e.date === date) today.add(key);
    const w =
      0.5 ** (diffDays(e.date, date) / HALF_LIFE_DAYS) * (weekday(e.date) === wd ? SAME_WEEKDAY_BONUS : 1);
    const have = byKey.get(key);
    if (!have) {
      byKey.set(key, { ...v, key, count: 1, score: w, ...at });
      continue;
    }
    have.count += 1;
    have.score += w;
    if (newer(e, have)) Object.assign(have, v, at);
  }
  const last = new Map(
    [...byType].map(([typeKey, { lastDate: _d, loggedAt: _l, ...v }]) => [typeKey, v as TrainingValues]),
  );
  const suggestions = [...byKey.values()]
    .filter((s) => withLogged || !today.has(s.key))
    .sort((a, b) => b.score - a.score || b.lastDate.localeCompare(a.lastDate))
    .slice(0, limit)
    .map(({ loggedAt: _l, ...s }) => s);
  return { suggestions, last };
}

function values(
  e: Pick<ExerciseEntry, 'typeKey' | 'name' | 'minutes' | 'intensity' | 'note'> & {
    templateId?: string | null;
  },
  saved: ReadonlyMap<string, string>,
): TrainingValues {
  const templateName = e.templateId ? (saved.get(e.templateId) ?? null) : null;
  return {
    typeKey: e.typeKey,
    name: e.name,
    minutes: e.minutes,
    intensity: e.intensity,
    note: e.note ?? null,
    templateId: templateName === null ? null : e.templateId!,
    templateName,
  };
}
