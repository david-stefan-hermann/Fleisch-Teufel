/**
 * The food search the model uses during a photo analysis (`search_foods`). It sees what the person
 * would find: BLS and cached OFF products, the person's own foods, a live OFF search when little
 * turns up locally, and marks for foods chosen in earlier reviews or logged often. Every food handed
 * to the model is kept in `seen`: only those ids are accepted as its choice.
 */
import {
  get,
  indexItem,
  isBaseUnit,
  N,
  normalize,
  portionsFor,
  search,
  type Food,
  type Portion,
} from '@ft/shared';
import { and, count, eq, isNotNull, sql } from 'drizzle-orm';
import { aiFoodChoices, customFoods, foodEntries, foodPortions } from '../db/schema.js';
import type { Deps } from '../types.js';

/** Hits per search shown to the model. */
export const SEARCH_LIMIT = 15;
/** Fewer local hits than this trigger the live OFF search. */
export const OFF_BELOW = 3;
/** Entries of a food from which it counts as logged often. */
export const OFTEN_FROM = 3;
/** Ranking boost of the person's own foods, as in the device search. */
const OWN_BOOST = 55;

export interface FoodSearch {
  /** Runs a search and returns the hits as text for the model. */
  search(query: string): Promise<string>;
  /** Every food returned by `search` in this analysis, by id. */
  seen: Map<string, Food>;
  /** The person's own portions per food id (only with `detail`). */
  userPortions: Map<string, Portion[]>;
}

function customToFood(c: typeof customFoods.$inferSelect): Food {
  return {
    id: c.id,
    source: 'custom',
    sourceId: c.barcode,
    name: c.name,
    nameEn: null,
    brand: c.brand,
    group: 'Eigene Lebensmittel',
    unit: c.unit,
    nutrients: c.nutrients,
    portions: c.portions,
    imageUrl: null,
  };
}

const SOURCE_LABEL: Record<Food['source'], string> = {
  bls: 'BLS',
  off: 'Open Food Facts',
  custom: 'eigenes Lebensmittel',
};

const r1 = (n: number) => Math.round(n * 10) / 10;

function line(food: Food, marks: string[]): string {
  const n = food.nutrients;
  const parts = [
    `id=${food.id}`,
    food.brand ? `${food.name} (${food.brand})` : food.name,
    SOURCE_LABEL[food.source],
    `${Math.round(get(n, N.kcal))} kcal/100 ${food.unit}`,
    `E ${r1(get(n, N.protein))} F ${r1(get(n, N.fat))} KH ${r1(get(n, N.carbs))}`,
    ...marks,
  ];
  return parts.join(' | ');
}

/** Whether an earlier choice for `term` applies to the query (one names the other). */
function termMatches(term: string, query: string): boolean {
  if (term === query) return true;
  const [short, long] = term.length <= query.length ? [term, query] : [query, term];
  return short.length >= 4 && long.includes(short);
}

/** Portions shown per hit with `detail` (the assistant picks the one the person's word names). */
const DETAIL_PORTIONS = 5;

const fmtGrams = (g: number) => `${Math.round(g * 10) / 10} g`;

export async function createFoodSearch(
  { db, catalog }: Pick<Deps, 'db' | 'catalog'>,
  userId: string,
  /**
   * The assistant's search: every hit also names its portions and the amount logged last
   * ("zuletzt 500 g"), so a word like "Packung" or "wie immer" turns into grams without a question.
   */
  opts: { detail?: boolean } = {},
): Promise<FoodSearch> {
  const [ownRows, choices, usage] = await Promise.all([
    db
      .select()
      .from(customFoods)
      .where(and(eq(customFoods.userId, userId), eq(customFoods.deleted, false))),
    db.select().from(aiFoodChoices).where(eq(aiFoodChoices.userId, userId)),
    db
      .select({ foodId: foodEntries.foodId, n: count() })
      .from(foodEntries)
      .where(
        and(eq(foodEntries.userId, userId), eq(foodEntries.deleted, false), isNotNull(foodEntries.foodId)),
      )
      .groupBy(foodEntries.foodId),
  ]);
  const userPortions = new Map<string, Portion[]>();
  const lastGrams = new Map<string, number>();
  if (opts.detail) {
    const [portions, last] = await Promise.all([
      db
        .select({ foodId: foodPortions.foodId, label: foodPortions.label, grams: foodPortions.grams })
        .from(foodPortions)
        .where(and(eq(foodPortions.userId, userId), eq(foodPortions.deleted, false))),
      db.execute(sql`
        select distinct on (food_id) food_id, grams from food_entries
        where user_id = ${userId} and not deleted and food_id is not null and grams is not null
        order by food_id, logged_at desc
      `) as unknown as Promise<{ food_id: string; grams: number }[]>,
    ]);
    for (const p of portions)
      userPortions.set(p.foodId, [...(userPortions.get(p.foodId) ?? []), { label: p.label, grams: p.grams }]);
    for (const r of last) lastGrams.set(r.food_id, Number(r.grams));
  }
  const own = ownRows.map(customToFood);
  const ownById = new Map(own.map((f) => [f.id, f]));
  const ownIndex = own.map(indexItem);
  const logged = new Map(usage.map((u) => [u.foodId!, u.n]));
  const seen = new Map<string, Food>();

  const resolve = async (id: string) => ownById.get(id) ?? (await catalog.get(id));

  return {
    seen,
    userPortions,
    async search(raw) {
      const query = raw.trim().slice(0, 100);
      const norm = normalize(query);
      if (norm.length < 2) return 'Suchbegriff zu kurz.';

      // Foods chosen before for an item of this name come first, even when the search would miss them.
      const chosen: Food[] = [];
      const hitChoices = choices
        .filter((c) => termMatches(c.term, norm))
        .sort((a, b) => b.count - a.count || b.updatedAt.getTime() - a.updatedAt.getTime());
      for (const c of hitChoices) {
        if (chosen.some((f) => f.id === c.foodId)) continue;
        const food = await resolve(c.foodId);
        if (food) chosen.push(food);
      }
      const chosenIds = new Set(chosen.map((f) => f.id));

      const local = [
        ...catalog.searchLocal(query, SEARCH_LIMIT),
        ...search(ownIndex, query, SEARCH_LIMIT, () => OWN_BOOST).map((h) => ({
          food: h.item,
          score: h.score,
        })),
      ]
        .sort((a, b) => b.score - a.score)
        .map((h) => h.food);
      const online = local.length < OFF_BELOW ? (await catalog.searchOff(query, 8)).foods : [];

      const foods = [...new Map([...chosen, ...local, ...online].map((f) => [f.id, f])).values()].slice(
        0,
        SEARCH_LIMIT,
      );
      if (foods.length === 0) return `Keine Treffer für „${query}“.`;
      for (const f of foods) seen.set(f.id, f);
      return foods
        .map((f) => {
          const marks: string[] = [];
          if (chosenIds.has(f.id)) marks.push('früher gewählt');
          const n = logged.get(f.id) ?? 0;
          if (opts.detail) {
            const portions = portionsFor(f, userPortions.get(f.id))
              .filter((p) => !isBaseUnit(p))
              .slice(0, DETAIL_PORTIONS);
            if (portions.length) marks.push(`Portionen: ${portions.map((p) => p.label).join(', ')}`);
            const last = lastGrams.get(f.id);
            if (last) marks.push(`zuletzt ${fmtGrams(last)} (${n}× eingetragen)`);
          } else if (n >= OFTEN_FROM) marks.push(`oft eingetragen (${n}×)`);
          return line(f, marks);
        })
        .join('\n');
    },
  };
}
