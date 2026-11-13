/**
 * Carries out the operations the assistant planned, with the app's own write functions, in one Dexie
 * transaction: either all of them happen or none (a failing one rolls the turn back). Every write
 * records how to undo it (`UndoStep`, kept on the turn). Ids this device does not know (deleted,
 * not synced yet) leave out only that operation. Nutrients always come from the foods the server's
 * search returned, never from the model, except for an estimate (a quick entry marked "geschätzt").
 */
import {
  addDays,
  DEFAULT_WEIGHT_KG,
  EXERCISE_TYPES,
  rescaleItem,
  trainingItemsOf,
  weightForDay,
  type AssistantOp,
  type ExerciseEntry,
  type FoodEntry,
  type ISODate,
  type Intensity,
} from '@ft/shared';
import type { AppliedOp, UndoStep, UserDb } from '@/db/dexie';
import {
  aiMealItems,
  diaryParts,
  logItems,
  logParts,
  logQuickEntry,
  logTrainings,
  saveMealFromEntries,
  type TrainingToLog,
} from '@/db/entries';
import { setWeight } from '@/db/weights';
import { deleteRecord, patchRecord } from '@/db/write';
import { rowsToLog, toLog, type TypeOption } from '@/features/exercise/training';
import { rememberFood } from '@/foods/foodService';
import { fmt0, fmt2, fmtGrams, fmtRelativeDay } from '@/lib/format';
import { logTargetFor } from '@/lib/meals';

export interface ApplyEnv {
  /** Epoch ms of the utterance (the meal for "no meal named" is chosen for this moment). */
  now: number;
  today: ISODate;
  mealNames: readonly string[];
}

export type CameraOp = Extract<AssistantOp, { kind: 'openCamera' }>;

export interface ApplyResult {
  applied: AppliedOp[];
  undo: UndoStep[];
  /** Operations left out (their records are not on this device). */
  skipped: number;
  /** "Ich hab Fotos": the caller opens the camera (or asks first). */
  camera: CameraOp | null;
}

const DEFAULT_SPORT = { minutes: 30, intensity: 'moderate' as Intensity };

/** Day and meal for an operation without a meal: the rules of the "+" in the tab bar. */
async function targetResolver(db: UserDb, env: ApplyEnv) {
  const recent = await db.foodEntries
    .where('date')
    .anyOf([env.today, addDays(env.today, -1)])
    .toArray();
  const pending = (await db.aiQueue.toArray()).filter((i) => !i.result);
  const chosen = new Map<ISODate, { date: ISODate; meal: number }>();
  return (date: ISODate, meal: number | null): { date: ISODate; meal: number } => {
    if (meal !== null) return { date, meal };
    // All operations of one turn that name no meal go to the same one.
    const known = chosen.get(date);
    if (known) return known;
    // The day is the "+"'s shown day: today follows its rules fully (over midnight that can be
    // yesterday's meal), another day named on purpose stays and the clock picks the meal.
    const picked = logTargetFor({
      shownDate: date,
      today: env.today,
      now: env.now,
      entries: recent,
      pending,
    });
    chosen.set(date, picked);
    return picked;
  };
}

/** Day and meal for an operation (the camera of "Ich hab Fotos"): its own, else the rules of the "+". */
export async function targetFor(
  db: UserDb,
  date: ISODate,
  meal: number | null,
  env: Omit<ApplyEnv, 'mealNames'>,
): Promise<{ date: ISODate; meal: number }> {
  return (await targetResolver(db, { ...env, mealNames: [] }))(date, meal);
}

async function typeOptions(db: UserDb): Promise<TypeOption[]> {
  const own = (await db.exerciseTypes.toArray()).filter((t) => !t.deleted);
  return [
    ...own.map((t) => ({ key: t.id, name: t.name, met: { moderate: t.met }, custom: true })),
    ...EXERCISE_TYPES.map((t) => ({ key: t.key, name: t.name, met: t.met, custom: false })),
  ];
}

/** The last minutes and intensity logged for a sport ("Badminton" without a duration). */
async function lastOfSport(db: UserDb, typeKey: string): Promise<ExerciseEntry | undefined> {
  const rows = (await db.exerciseEntries.filter((e) => e.typeKey === typeKey && !e.deleted).toArray()).sort(
    (a, b) => b.loggedAt - a.loggedAt,
  );
  return rows[0];
}

const entryNames = (entries: readonly Pick<FoodEntry, 'name'>[]) => entries.map((e) => e.name).join(', ');

/** Amount of an entry for the history: "200 g", "1 Stück (120 g)". */
function amountOf(e: Pick<FoodEntry, 'grams' | 'portionLabel' | 'portionGrams' | 'quantity'>): string {
  if (e.grams === null) return '';
  const portion = e.portionLabel && e.portionGrams && e.portionGrams !== 1 && e.portionGrams !== 100;
  return portion ? `${fmt2(e.quantity)} ${e.portionLabel}` : fmtGrams(e.grams);
}

const kcalOf = (e: Pick<FoodEntry, 'nutrients'>) => e.nutrients.ENERCC ?? 0;

/**
 * Applies the operations of one turn. `inside` runs in the same transaction at the end (the turn
 * record takes its undo steps there, so the app being killed never leaves entries without them).
 */
export async function applyOps(
  db: UserDb,
  ops: readonly AssistantOp[],
  env: ApplyEnv,
  inside?: (result: ApplyResult) => Promise<void>,
): Promise<ApplyResult> {
  // Everything that is not an IndexedDB read of the write tables comes first: the transaction would
  // close while it waits for anything else.
  const resolve = await targetResolver(db, env);
  const weights = (await db.weightEntries.toArray()).filter((w) => !w.deleted);
  const options = await typeOptions(db);
  const lastSport = new Map<string, ExerciseEntry | undefined>();
  for (const op of ops)
    if (op.kind === 'logTraining')
      for (const it of op.items)
        if (it.typeKey && !lastSport.has(it.typeKey))
          lastSport.set(it.typeKey, await lastOfSport(db, it.typeKey));

  const dayLabel = (date: ISODate) =>
    date === env.today ? '' : `${fmtRelativeDay(date, env.today, true)}, `;
  const where = (t: { date: ISODate; meal: number }) => `${dayLabel(t.date)}${env.mealNames[t.meal]}`;

  const result: ApplyResult = { applied: [], undo: [], skipped: 0, camera: null };
  const liveEntries = async (ids: readonly string[]) =>
    (await db.foodEntries.bulkGet([...ids])).filter((e): e is FoodEntry => !!e && !e.deleted);

  await db.transaction(
    'rw',
    [
      db.foodEntries,
      db.meals,
      db.exerciseEntries,
      db.exerciseTemplates,
      db.weightEntries,
      db.outbox,
      db.assistantTurns,
    ],
    async () => {
      for (const op of ops) {
        switch (op.kind) {
          case 'logFood': {
            const target = resolve(op.date, op.meal);
            const items = aiMealItems(op.items).map((it, i) => ({ ...it, source: op.items[i]!.food.source }));
            const ids = await logItems(db, items, target, {
              groupName: op.items.length > 1 ? op.groupName : null,
            });
            result.undo.push({ kind: 'delete', table: 'foodEntries', ids });
            result.applied.push({
              kind: op.kind,
              text: `${where(target)}: ${op.groupName && op.items.length > 1 ? op.groupName : entryNames(items)}`,
              detail: `${where(target)}: ${items.map((it) => `${it.name}, ${amountOf(it)}`).join(' · ')}`,
              kcal: items.reduce((s, it) => s + kcalOf(it), 0),
              guessed: op.items.some((i) => i.guessed),
              target,
              entryIds: ids,
            });
            break;
          }
          case 'logEstimate':
          case 'logQuick': {
            const target = resolve(op.date, op.meal);
            const text =
              op.kind === 'logEstimate' ? `${op.name} (${fmtGrams(op.grams)}, geschätzt)` : op.text;
            const id = await logQuickEntry(db, target.date, {
              meal: target.meal,
              text,
              kcal: op.kcal,
              proteinG: op.proteinG,
              carbsG: op.carbsG,
              fatG: op.fatG,
            });
            const entry = (await db.foodEntries.get(id))!;
            result.undo.push({ kind: 'delete', table: 'foodEntries', ids: [id] });
            result.applied.push({
              kind: op.kind,
              text: `${where(target)}: ${entry.name}`,
              detail: `${where(target)}: ${entry.name}, ${fmt0(op.kcal)} kcal`,
              kcal: op.kcal,
              guessed: op.kind === 'logEstimate',
              target,
              entryIds: [id],
            });
            break;
          }
          case 'logSavedMeal': {
            const meal = await db.meals.get(op.mealId);
            if (!meal || meal.deleted) {
              result.skipped++;
              break;
            }
            const target = resolve(op.date, op.meal);
            const ids = await logItems(db, meal.items, target, {
              mealId: meal.id,
              photoIds: meal.photoId ? [meal.photoId] : null,
            });
            result.undo.push({ kind: 'delete', table: 'foodEntries', ids });
            result.applied.push({
              kind: op.kind,
              text: `${where(target)}: ${meal.name}`,
              detail: `${where(target)}: ${meal.items.map((it) => `${it.name}, ${amountOf(it)}`).join(' · ')}`,
              kcal: meal.items.reduce((s, it) => s + kcalOf(it), 0),
              target,
              entryIds: ids,
            });
            break;
          }
          case 'updateEntry': {
            const [entry] = await liveEntries([op.entryId]);
            if (!entry || entry.grams === null || entry.quantity <= 0) {
              result.skipped++;
              break;
            }
            const perUnit = entry.portionGrams ?? entry.grams / entry.quantity;
            const next = rescaleItem(entry, Math.round((op.grams / perUnit) * 1000) / 1000);
            await patchRecord(db, 'foodEntries', entry.id, {
              quantity: next.quantity,
              grams: next.grams,
              nutrients: next.nutrients,
            });
            result.undo.push({
              kind: 'patch',
              table: 'foodEntries',
              id: entry.id,
              fields: { quantity: entry.quantity, grams: entry.grams, nutrients: entry.nutrients },
            });
            result.applied.push({
              kind: op.kind,
              text: `${entry.name}: ${amountOf(next)}`,
              kcal: kcalOf(next) - kcalOf(entry),
              target: { date: entry.date, meal: entry.meal },
              entryIds: [entry.id],
            });
            break;
          }
          case 'moveEntries': {
            const entries = await liveEntries(op.entryIds);
            const moved = entries.filter((e) => e.date !== op.toDate || e.meal !== op.toMeal);
            if (entries.length === 0) {
              result.skipped++;
              break;
            }
            for (const e of moved) {
              await patchRecord(db, 'foodEntries', e.id, { date: op.toDate, meal: op.toMeal });
              result.undo.push({
                kind: 'patch',
                table: 'foodEntries',
                id: e.id,
                fields: { date: e.date, meal: e.meal },
              });
            }
            const target = { date: op.toDate, meal: op.toMeal };
            result.applied.push({
              kind: op.kind,
              text: `Verschoben nach ${where(target)}: ${entryNames(entries)}`,
              target,
              entryIds: entries.map((e) => e.id),
            });
            break;
          }
          case 'copyEntries': {
            const entries = (await liveEntries(op.entryIds)).sort((a, b) => a.loggedAt - b.loggedAt);
            if (entries.length === 0) {
              result.skipped++;
              break;
            }
            const target = resolve(op.toDate, op.toMeal);
            const ids = await logParts(db, diaryParts(entries), target);
            result.undo.push({ kind: 'delete', table: 'foodEntries', ids });
            result.applied.push({
              kind: op.kind,
              text: `${where(target)}: ${entryNames(entries)}`,
              detail: `${where(target)}: ${entries.map((e) => `${e.name}, ${amountOf(e)}`).join(' · ')}`,
              kcal: entries.reduce((s, e) => s + kcalOf(e), 0),
              target,
              entryIds: ids,
            });
            break;
          }
          case 'deleteEntries': {
            const entries = await liveEntries(op.entryIds);
            if (entries.length === 0) {
              result.skipped++;
              break;
            }
            for (const e of entries) await deleteRecord(db, 'foodEntries', e.id);
            result.undo.push({ kind: 'restore', table: 'foodEntries', ids: entries.map((e) => e.id) });
            result.applied.push({
              kind: op.kind,
              text: `Gelöscht: ${entryNames(entries)}`,
              kcal: -entries.reduce((s, e) => s + kcalOf(e), 0),
            });
            break;
          }
          case 'saveMeal': {
            const entries = (await liveEntries(op.entryIds)).sort((a, b) => a.loggedAt - b.loggedAt);
            if (entries.length === 0) {
              result.skipped++;
              break;
            }
            const id = await saveMealFromEntries(db, op.name, entries);
            result.undo.push({ kind: 'delete', table: 'meals', ids: [id] });
            result.applied.push({
              kind: op.kind,
              text: `Meal gespeichert: ${op.name}`,
              detail: entryNames(entries),
            });
            break;
          }
          case 'setWeight': {
            result.undo.push(...(await setWeight(db, op.date, op.kg)));
            // The new weight replaces that day's (a training later in this turn counts with it).
            weights.splice(0, weights.length, ...weights.filter((w) => w.date !== op.date));
            weights.push({ id: '', updatedAt: 0, deleted: false, purgedAt: null, date: op.date, kg: op.kg });
            result.applied.push({ kind: op.kind, text: `${dayLabel(op.date)}Gewicht: ${fmt2(op.kg)} kg` });
            break;
          }
          case 'logTraining': {
            const weightKg = weightForDay(weights, op.date) ?? DEFAULT_WEIGHT_KG;
            const rows: TrainingToLog[] = [];
            const names: string[] = [];
            for (const item of op.items) {
              if (item.templateId) {
                const t = await db.exerciseTemplates.get(item.templateId);
                if (!t || t.deleted) continue;
                const items = trainingItemsOf(t).map((i) => ({
                  typeKey: i.typeKey,
                  name: i.typeName,
                  minutes: i.minutes,
                  intensity: i.intensity,
                  note: i.note,
                }));
                const built = rowsToLog(options, items, weightKg, t.id);
                rows.push(...built.rows);
                if (built.rows.length) names.push(t.name);
                continue;
              }
              const type = options.find((o) => o.key === item.typeKey);
              if (!type) continue;
              const last = lastSport.get(type.key);
              const minutes = item.minutes ?? last?.minutes ?? DEFAULT_SPORT.minutes;
              rows.push(
                toLog(
                  type,
                  {
                    minutes,
                    intensity: item.intensity ?? last?.intensity ?? DEFAULT_SPORT.intensity,
                    note: null,
                  },
                  weightKg,
                ),
              );
              names.push(`${type.name.split(' / ')[0]}, ${fmt0(minutes)} Min.`);
            }
            if (rows.length === 0) {
              result.skipped++;
              break;
            }
            const ids = await logTrainings(db, op.date, rows);
            result.undo.push({ kind: 'delete', table: 'exerciseEntries', ids });
            result.applied.push({
              kind: op.kind,
              text: `${dayLabel(op.date)}Training: ${names.join(', ')}`,
              kcal: rows.reduce((s, r) => s + r.kcal, 0),
              entryIds: ids,
            });
            break;
          }
          case 'openCamera':
            result.camera = op;
            break;
        }
      }
      await inside?.(result);
    },
  );
  for (const op of ops) if (op.kind === 'logFood') for (const it of op.items) await rememberFood(db, it.food);
  return result;
}

/** The toast of a turn: "Mittagessen: Magerquark, Banane · 241 kcal". */
export function summaryText(applied: readonly AppliedOp[]): string {
  const text = applied.map((a) => a.text).join('; ');
  const kcal = applied.reduce((s, a) => s + (a.kcal && a.kcal > 0 ? a.kcal : 0), 0);
  const adds = applied.some((a) =>
    ['logFood', 'logEstimate', 'logQuick', 'logSavedMeal', 'copyEntries', 'logTraining'].includes(a.kind),
  );
  return adds && kcal > 0 ? `${text} · ${fmt0(kcal)} kcal` : text;
}

/** Where the turn wrote last (the next utterance's follow-ups go there). */
export function lastTarget(applied: readonly AppliedOp[]): { date: string; meal: number } | null {
  for (let i = applied.length - 1; i >= 0; i--) if (applied[i]!.target) return applied[i]!.target!;
  return null;
}
