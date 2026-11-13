/**
 * Runs the tool calls of one utterance. Read tools answer from the database (foods with portions and
 * the last amount, trainings with their last values, days other than today and yesterday). Write tools
 * are never executed here: each call is checked (ids only from the context, from `get_day` or from the
 * searches, meals by name, plausible numbers), turned into an `AssistantOp` and answered with a short
 * receipt. The device carries the operations out. `ask` ends the turn.
 */
import {
  addDays,
  assistantOpSchema,
  EXERCISE_TYPE_MAP,
  EXERCISE_TYPES,
  get,
  indexItem,
  isISODate,
  N,
  normalize,
  portionsFor,
  search,
  STEPS_TYPE_KEY,
  trainingItemsOf,
  type AssistantContext,
  type AssistantOp,
  type AssistantQuestion,
  type Food,
} from '@ft/shared';
import { and, eq, ne, sql } from 'drizzle-orm';
import { createFoodSearch } from '../ai/foodSearch.js';
import {
  exerciseEntries,
  exerciseTemplates,
  exerciseTypes,
  foodEntries,
  meals,
  weightEntries,
} from '../db/schema.js';
import type { Deps } from '../types.js';
import { Aliases, dayText, type DayLines } from './prompt.js';
import { READ_TOOLS } from './tools.js';
import type { ToolHost } from './types.js';

export interface TurnState {
  ops: AssistantOp[];
  question: AssistantQuestion | null;
}

/** A tool input as the model sent it (checked field by field below). */
type Input = Record<string, unknown>;

class ToolInputError extends Error {}

const INTENSITY_DE: Record<string, string> = { light: 'leicht', moderate: 'mittel', vigorous: 'intensiv' };

function words(text: string): string[] {
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
}

/** Loose name match for sports and trainings ("Mobility Patty", "Joggen" in "Laufen / Joggen"). */
function nameMatches(query: string, name: string): boolean {
  const q = words(query);
  const n = words(name);
  return q.some((a) => n.some((b) => a.slice(0, 5) === b.slice(0, 5) || b.includes(a) || a.includes(b)));
}

export async function createTurnHost(
  deps: Pick<Deps, 'db' | 'catalog'>,
  userId: string,
  ctx: AssistantContext,
  aliases: Aliases,
): Promise<{ host: ToolHost; state: TurnState }> {
  const { db } = deps;
  const today = ctx.now.slice(0, 10);
  const yesterday = addDays(today, -1);
  const state: TurnState = { ops: [], question: null };

  const [foodSearch, mealRows, ownTypes, templates, lastRows] = await Promise.all([
    createFoodSearch(deps, userId, { detail: true }),
    db
      .select({ id: meals.id, name: meals.name, items: meals.items, deleted: meals.deleted })
      .from(meals)
      .where(eq(meals.userId, userId)),
    db
      .select({ id: exerciseTypes.id, name: exerciseTypes.name })
      .from(exerciseTypes)
      .where(and(eq(exerciseTypes.userId, userId), eq(exerciseTypes.deleted, false))),
    db
      .select()
      .from(exerciseTemplates)
      .where(and(eq(exerciseTemplates.userId, userId), eq(exerciseTemplates.deleted, false))),
    db.execute(sql`
      select distinct on (type_key) type_key, minutes, intensity from exercise_entries
      where user_id = ${userId} and not deleted and type_key <> ${STEPS_TYPE_KEY}
      order by type_key, logged_at desc
    `) as unknown as Promise<{ type_key: string; minutes: number; intensity: string }[]>,
  ]);
  const savedMeals = mealRows.filter((m) => !m.deleted);
  const mealIndex = savedMeals.map((m) =>
    indexItem({ id: m.id, name: m.name, source: 'meal', sourceId: null }),
  );
  const mealNameById = new Map(mealRows.map((m) => [m.id, m.name]));
  const lastBySport = new Map(lastRows.map((r) => [r.type_key, r]));
  const ownTypeIds = new Set(ownTypes.map((t) => t.id));
  const templateIds = new Set(templates.map((t) => t.id));

  /** Entries the model may name: today and yesterday from the device, other days from `get_day`. */
  const knownEntries = new Map<string, { quick: boolean }>();
  for (const d of ctx.days)
    for (const e of d.entries) {
      aliases.alias('e', e.id);
      knownEntries.set(e.id, { quick: e.grams === null });
    }
  const seenMeals = new Set<string>();

  // ------------------------------------------------------------------ checks
  const text = (v: unknown, what: string, max = 200): string => {
    if (typeof v !== 'string' || !v.trim()) throw new ToolInputError(`${what} missing`);
    return v.trim().slice(0, max);
  };
  const optText = (v: unknown, max = 200): string | null =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
  const number = (v: unknown, what: string, min: number, max: number): number => {
    const n = typeof v === 'string' ? Number(v.replace(',', '.')) : v;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max)
      throw new ToolInputError(`${what} must be a number between ${min} and ${max}`);
    return n;
  };
  const optNumber = (v: unknown, what: string, min: number, max: number): number | null =>
    v === undefined || v === null ? null : number(v, what, min, max);
  const date = (v: unknown): string => {
    if (typeof v !== 'string' || !isISODate(v)) throw new ToolInputError('date must be YYYY-MM-DD');
    if (v > addDays(today, 1)) throw new ToolInputError('date lies in the future');
    if (v < addDays(today, -366)) throw new ToolInputError('date lies more than a year back');
    return v;
  };
  const meal = (v: unknown, required = false): number | null => {
    if (v === undefined || v === null || v === '') {
      if (required) throw new ToolInputError('meal missing');
      return null;
    }
    const i = ctx.mealNames.findIndex((n) => normalize(n) === normalize(String(v)));
    if (i < 0) throw new ToolInputError(`unknown meal; one of ${ctx.mealNames.join(', ')}`);
    return i;
  };
  const entryIds = (v: unknown): string[] => {
    const list = Array.isArray(v) ? v : [v];
    if (list.length === 0) throw new ToolInputError('entryIds missing');
    return list.map((x) => {
      const real = typeof x === 'string' ? aliases.real(x) : null;
      if (!real || !knownEntries.has(real))
        throw new ToolInputError(`unknown entry id ${String(x)}: only ids from the diary or get_day`);
      return real;
    });
  };
  const add = (op: unknown): string => {
    const parsed = assistantOpSchema.safeParse(op);
    if (!parsed.success) throw new ToolInputError(`invalid: ${parsed.error.issues[0]?.message ?? 'input'}`);
    state.ops.push(parsed.data);
    return 'ok';
  };
  const portionOf = (food: Food, label: unknown, grams: number) => {
    if (typeof label !== 'string' || !label.trim()) return null;
    const want = normalize(label);
    const p = portionsFor(food, foodSearch.userPortions.get(food.id)).find(
      (x) => normalize(x.label) === want || normalize(x.label).startsWith(`${want} (`),
    );
    // A portion counts only when the grams are a sensible count of it (0.25 steps).
    return p && p.grams > 0 && Math.abs((grams / p.grams) * 4 - Math.round((grams / p.grams) * 4)) < 0.01
      ? p
      : null;
  };

  // ------------------------------------------------------------------ read tools
  const searchFoods = async (input: Input) => {
    const query = text(input.query, 'query', 100);
    const hits = await foodSearch.search(query);
    const found = search(mealIndex, query, 5).map((h) => savedMeals.find((m) => m.id === h.item.id)!);
    for (const m of found) seenMeals.add(m.id);
    const mealLines = found.map(
      (m) =>
        `mealId=${m.id} | ${m.name} | gespeichertes Meal | ${Math.round(
          m.items.reduce((s, i) => s + get(i.nutrients, N.kcal), 0),
        )} kcal | ${m.items.map((i) => i.name).join(', ')}`,
    );
    return [hits, ...mealLines].join('\n');
  };

  const searchTrainings = (input: Input) => {
    const query = text(input.query, 'query', 100);
    const last = (key: string) => {
      const r = lastBySport.get(key);
      return r ? ` | zuletzt ${Math.round(r.minutes)} Min. ${r.intensity}` : '';
    };
    const saved = templates
      .filter(
        (t) => nameMatches(query, t.name) || trainingItemsOf(t).some((i) => nameMatches(query, i.typeName)),
      )
      .map(
        (t) =>
          `savedTrainingId=${t.id} | ${t.name} | gespeichertes Training | ${trainingItemsOf(t)
            .map((i) => `${i.typeName} ${Math.round(i.minutes)} Min. ${INTENSITY_DE[i.intensity]}`)
            .join('; ')}`,
      );
    const sports = [
      ...ownTypes.map((t) => ({ key: t.id, name: t.name, own: true })),
      ...EXERCISE_TYPES.map((t) => ({ key: t.key, name: t.name, own: false })),
    ]
      .filter((s) => nameMatches(query, s.name))
      .slice(0, 8)
      .map((s) => `sportKey=${s.key} | ${s.name}${s.own ? ' | eigene Sportart' : ''}${last(s.key)}`);
    if (saved.length + sports.length > 0) return [...saved, ...sports].join('\n');
    return (
      `Keine Treffer für „${query}“. Sportarten: ` +
      [
        ...ownTypes.map((t) => `${t.name} (${t.id})`),
        ...EXERCISE_TYPES.map((t) => `${t.name} (${t.key})`),
      ].join(', ')
    );
  };

  const getDay = async (input: Input) => {
    const d = date(input.date);
    if (d === today || d === yesterday) return 'Today and yesterday are in the prompt.';
    const [entries, trainings, weights] = await Promise.all([
      db
        .select()
        .from(foodEntries)
        .where(and(eq(foodEntries.userId, userId), eq(foodEntries.date, d), eq(foodEntries.deleted, false)))
        .orderBy(foodEntries.loggedAt),
      db
        .select()
        .from(exerciseEntries)
        .where(
          and(
            eq(exerciseEntries.userId, userId),
            eq(exerciseEntries.date, d),
            eq(exerciseEntries.deleted, false),
            ne(exerciseEntries.typeKey, STEPS_TYPE_KEY),
          ),
        )
        .orderBy(exerciseEntries.loggedAt),
      db
        .select({ kg: weightEntries.kg })
        .from(weightEntries)
        .where(
          and(eq(weightEntries.userId, userId), eq(weightEntries.date, d), eq(weightEntries.deleted, false)),
        ),
    ]);
    const day: DayLines = {
      date: d,
      entries: entries.map((e) => ({
        id: e.id,
        meal: e.meal,
        name: e.name,
        grams: e.grams,
        kcal: get(e.nutrients, N.kcal),
        proteinG: get(e.nutrients, N.protein),
        group: e.groupName ?? (e.mealId ? (mealNameById.get(e.mealId) ?? null) : null),
      })),
      trainings: trainings.map((t) => ({
        id: t.id,
        name: t.name,
        minutes: t.minutes,
        intensity: t.intensity,
      })),
      weightKg: weights[0]?.kg ?? null,
    };
    for (const e of entries) knownEntries.set(e.id, { quick: e.grams === null });
    return `Diary ${d}:\n${dayText(day, ctx.mealNames, aliases)}`;
  };

  // ------------------------------------------------------------------ write tools
  const write: Record<string, (input: Input) => string> = {
    log_food(input) {
      const items = Array.isArray(input.items) ? (input.items as Input[]) : [];
      if (items.length === 0) throw new ToolInputError('items missing');
      const out = items.map((it) => {
        const foodId = text(it.foodId, 'foodId', 100);
        const food = foodSearch.seen.get(foodId);
        if (!food) throw new ToolInputError(`unknown foodId ${foodId}: only ids from search_foods`);
        const grams = number(it.grams, 'grams', 0.1, 10_000);
        return { food, grams, portion: portionOf(food, it.portion, grams), guessed: it.guessed === true };
      });
      add({
        kind: 'logFood',
        date: date(input.date),
        meal: meal(input.meal),
        items: out,
        groupName: out.length > 1 ? optText(input.groupName, 120) : null,
      });
      return `ok, ${out.length} logged`;
    },
    log_estimate(input) {
      return add({
        kind: 'logEstimate',
        date: date(input.date),
        meal: meal(input.meal),
        name: text(input.name, 'name', 120),
        grams: number(input.grams, 'grams', 0.1, 10_000),
        kcal: number(input.kcal, 'kcal', 0, 20_000),
        proteinG: number(input.proteinG, 'proteinG', 0, 2_000),
        carbsG: number(input.carbsG, 'carbsG', 0, 2_000),
        fatG: number(input.fatG, 'fatG', 0, 2_000),
      });
    },
    log_saved_meal(input) {
      const mealId = text(input.mealId, 'mealId', 100);
      if (!seenMeals.has(mealId)) throw new ToolInputError('unknown mealId: only ids from search_foods');
      return add({ kind: 'logSavedMeal', date: date(input.date), meal: meal(input.meal), mealId });
    },
    log_quick(input) {
      return add({
        kind: 'logQuick',
        date: date(input.date),
        meal: meal(input.meal),
        kcal: number(input.kcal, 'kcal', 0, 20_000),
        proteinG: optNumber(input.proteinG, 'proteinG', 0, 2_000),
        carbsG: optNumber(input.carbsG, 'carbsG', 0, 2_000),
        fatG: optNumber(input.fatG, 'fatG', 0, 2_000),
        text: optText(input.text, 1000) ?? '',
      });
    },
    update_entry(input) {
      const [entryId] = entryIds(input.entryId);
      if (knownEntries.get(entryId!)?.quick) throw new ToolInputError('a quick entry has no amount');
      return add({ kind: 'updateEntry', entryId, grams: number(input.grams, 'grams', 0.1, 10_000) });
    },
    move_entries(input) {
      return add({
        kind: 'moveEntries',
        entryIds: entryIds(input.entryIds),
        toDate: date(input.toDate),
        toMeal: meal(input.toMeal, true),
      });
    },
    copy_entries(input) {
      return add({
        kind: 'copyEntries',
        entryIds: entryIds(input.entryIds),
        toDate: date(input.toDate),
        toMeal: meal(input.toMeal),
      });
    },
    delete_entries(input) {
      return add({ kind: 'deleteEntries', entryIds: entryIds(input.entryIds) });
    },
    save_meal(input) {
      return add({
        kind: 'saveMeal',
        name: text(input.name, 'name', 120),
        entryIds: entryIds(input.entryIds),
      });
    },
    set_weight(input) {
      return add({ kind: 'setWeight', date: date(input.date), kg: number(input.kg, 'kg', 20, 400) });
    },
    log_training(input) {
      const items = Array.isArray(input.items) ? (input.items as Input[]) : [];
      if (items.length === 0) throw new ToolInputError('items missing');
      const out = items.map((it) => {
        const typeKey = optText(it.sportKey, 64);
        const templateId = optText(it.savedTrainingId, 64);
        if (templateId && !templateIds.has(templateId))
          throw new ToolInputError(`unknown savedTrainingId ${templateId}`);
        if (!templateId && !(typeKey && (EXERCISE_TYPE_MAP.has(typeKey) || ownTypeIds.has(typeKey))))
          throw new ToolInputError(`unknown sportKey ${String(typeKey)}: use search_trainings`);
        const intensity = ['light', 'moderate', 'vigorous'].includes(String(it.intensity))
          ? (it.intensity as 'light' | 'moderate' | 'vigorous')
          : null;
        return {
          typeKey: templateId ? null : typeKey,
          templateId,
          minutes: optNumber(it.minutes, 'minutes', 1, 1440),
          intensity,
        };
      });
      return add({ kind: 'logTraining', date: date(input.date), items: out });
    },
    open_camera(input) {
      return add({
        kind: 'openCamera',
        date: date(input.date),
        meal: meal(input.meal),
        hint: optText(input.hint, 1000) ?? '',
      }).replace('ok', 'camera opens; the analysis logs the food');
    },
  };

  const host: ToolHost = {
    async call(name, raw) {
      const input = (raw && typeof raw === 'object' ? raw : {}) as Input;
      try {
        if (READ_TOOLS.has(name)) {
          if (name === 'search_foods') return { result: await searchFoods(input) };
          if (name === 'search_trainings') return { result: searchTrainings(input) };
          return { result: await getDay(input) };
        }
        if (name === 'ask') {
          const question = text(input.question, 'question', 300);
          // The open question is answered by this utterance: asking it again would loop.
          if (ctx.openQuestion && normalize(ctx.openQuestion.text) === normalize(question))
            return { result: 'already answered by this utterance' };
          const options = Array.isArray(input.options)
            ? input.options.flatMap((o) => (typeof o === 'string' && o.trim() ? [o.trim().slice(0, 80)] : []))
            : [];
          state.question = { text: question, options: options.slice(0, 4) };
          return { result: 'question shown; the answer arrives as the next utterance', stop: true };
        }
        const run = write[name];
        if (!run) return { result: `error: unknown tool ${name}` };
        return { result: run(input) };
      } catch (e) {
        if (e instanceof ToolInputError) return { result: `error: ${e.message}` };
        throw e;
      }
    },
  };
  return { host, state };
}
