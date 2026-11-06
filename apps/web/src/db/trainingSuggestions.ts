/**
 * "Zuletzt & häufig": the trainings a person usually logs, from the diary itself. Every sport and
 * every saved training logged in the last `SUGGESTION_DAYS` scores by how often and how recently it
 * was logged, the same weekday a little higher (the Monday gym day). A sport carries the duration,
 * intensity and note of its last entry (the values from last time); a saved training carries its
 * saved activities (what it always logs). Pinned saved trainings come first, also before they were
 * ever logged. Shown as chips under the diary's training card (one tap logs it) and used by the
 * training search ("Häufig", "Kürzlich", "N× eingetragen") and the sport page ("Zuletzt …").
 *
 * Free of `@/` aliases on purpose (the API test suite imports `db/*`).
 */
import {
  addDays,
  diffDays,
  trainingItemsOf,
  type ExerciseEntry,
  type ExerciseTemplate,
  type Intensity,
  type ISODate,
} from '@ft/shared';
import type { UserDb } from './dexie';
import { SUGGESTION_DAYS } from './suggestions';

/** Weight halves every 14 days: last week's run counts about twice as much as the one 3 weeks ago. */
const HALF_LIFE_DAYS = 14;
const SAME_WEEKDAY_BONUS = 1.5;
const weekday = (date: string) => new Date(`${date}T12:00:00`).getDay();

/** One activity to log: sport, duration, intensity and note. */
export interface TrainingValues {
  typeKey: string;
  /** Name of the sport. */
  name: string;
  minutes: number;
  intensity: Intensity;
  note: string | null;
}

/** How often and when something was logged within `SUGGESTION_DAYS`. */
export interface TrainingStats {
  count: number;
  lastDate: ISODate;
}

export interface TrainingSuggestion {
  /** What the suggestion stands for: `t:<templateId>` for a saved training, else the sport's key. */
  key: string;
  /** The saved training's current name, else the sport's name. */
  title: string;
  /** The saved training (not deleted), else null. */
  templateId: string | null;
  pinned: boolean;
  /** A sport: one item with the values of its last entry. A saved training: its saved activities. */
  items: TrainingValues[];
  /** Times it was logged within `SUGGESTION_DAYS` (a saved training once per logging, not per activity). */
  count: number;
  score: number;
  /** Null for a pinned saved training that was not logged in the window. */
  lastDate: ISODate | null;
}

export interface TrainingHistory {
  /** Pinned first, then best first, without what is already logged on the date (unless `withLogged`), cut to the limit. */
  suggestions: TrainingSuggestion[];
  /** Last values of every sport logged in the window (also parts of saved trainings and the date itself). */
  last: Map<string, TrainingValues>;
  /** Count and last date per key (`trainingKey`) of everything logged in the window. */
  stats: Map<string, TrainingStats>;
}

/** Key of a suggestion: the saved training an entry was logged from, else its sport. */
export const trainingKey = (templateId: string | null, typeKey: string) =>
  templateId ? `t:${templateId}` : typeKey;

/** The activities of a saved training as values to log. */
export const templateValues = (t: ExerciseTemplate): TrainingValues[] =>
  trainingItemsOf(t).map((i) => ({
    typeKey: i.typeKey,
    name: i.typeName,
    minutes: i.minutes,
    intensity: i.intensity,
    note: i.note,
  }));

/**
 * Suggestions for `date`, the last values per sport and the stats per key, from one read of the
 * trainings of the last `SUGGESTION_DAYS` days up to the date. Entries logged from a saved training
 * count for it (once per logging: the activities of one logging share a `groupId`); all others, and
 * those of a deleted saved training, count for their sport. What is already logged on the date is no
 * suggestion in the diary (the next best moves up before the cut); `withLogged` keeps it.
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
  const templates = new Map(
    (await db.exerciseTemplates.filter((t) => !t.deleted).toArray()).map((t) => [t.id, t]),
  );
  const wd = weekday(date);
  type Latest<T> = T & { lastDate: ISODate; loggedAt: number };
  const byKey = new Map<string, Latest<{ values: TrainingValues; count: number; score: number }>>();
  const byType = new Map<string, Latest<TrainingValues>>();
  const today = new Set<string>();
  /** Loggings already counted per key (`groupId` of a saved training's activities, else the entry id). */
  const counted = new Set<string>();
  // The last entry gives the values; `loggedAt` orders entries of the same day.
  const newer = (e: ExerciseEntry, have: { lastDate: ISODate; loggedAt: number }) =>
    e.date > have.lastDate || (e.date === have.lastDate && e.loggedAt > have.loggedAt);
  for (const e of entries) {
    const v = values(e);
    const at = { lastDate: e.date, loggedAt: e.loggedAt };
    const sport = byType.get(e.typeKey);
    if (!sport || newer(e, sport)) byType.set(e.typeKey, { ...v, ...at });
    const templateId = e.templateId && templates.has(e.templateId) ? e.templateId : null;
    const key = trainingKey(templateId, e.typeKey);
    if (e.date === date) today.add(key);
    const logging = `${key}|${templateId ? (e.groupId ?? e.id) : e.id}`;
    const first = !counted.has(logging);
    counted.add(logging);
    const w = first
      ? 0.5 ** (diffDays(e.date, date) / HALF_LIFE_DAYS) * (weekday(e.date) === wd ? SAME_WEEKDAY_BONUS : 1)
      : 0;
    const have = byKey.get(key);
    if (!have) {
      byKey.set(key, { values: v, count: 1, score: w, ...at });
      continue;
    }
    if (first) have.count += 1;
    have.score += w;
    if (newer(e, have)) Object.assign(have, { values: v }, at);
  }
  const last = new Map(
    [...byType].map(([typeKey, { lastDate: _d, loggedAt: _l, ...v }]) => [typeKey, v as TrainingValues]),
  );
  const stats = new Map([...byKey].map(([key, s]) => [key, { count: s.count, lastDate: s.lastDate }]));

  const all: TrainingSuggestion[] = [...byKey].map(([key, s]) => {
    const t = key.startsWith('t:') ? templates.get(key.slice(2)) : undefined;
    return {
      key,
      title: t ? t.name : s.values.name,
      templateId: t?.id ?? null,
      pinned: t?.pinned === true,
      items: t ? templateValues(t) : [s.values],
      count: s.count,
      score: s.score,
      lastDate: s.lastDate,
    };
  });
  // Pinned saved trainings are suggestions also before they were ever logged.
  for (const t of templates.values())
    if (t.pinned === true && !byKey.has(trainingKey(t.id, t.typeKey)))
      all.push({
        key: trainingKey(t.id, t.typeKey),
        title: t.name,
        templateId: t.id,
        pinned: true,
        items: templateValues(t),
        count: 0,
        score: 0,
        lastDate: null,
      });
  const suggestions = all
    .filter((s) => withLogged || !today.has(s.key))
    .sort(compareSuggestions)
    .slice(0, limit);
  return { suggestions, last, stats };
}

/** Pinned first (never logged ones by name), then by score, then the more recent one. */
export function compareSuggestions(a: TrainingSuggestion, b: TrainingSuggestion): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  return (
    b.score - a.score ||
    (b.lastDate ?? '').localeCompare(a.lastDate ?? '') ||
    a.title.localeCompare(b.title, 'de')
  );
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
