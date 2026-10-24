/**
 * Finding foods, on the device first:
 *   - BLS (offline index), the user's own foods and every product used before (food cache)
 *   - Open Food Facts via the server when online (search and barcode)
 * BLS foods are enriched with the full 138 components from the server when reachable, so diary
 * entries store complete nutrients for later micronutrient reports; offline the compact set is used.
 */
import {
  addDays,
  foodIds,
  get,
  indexItem,
  N,
  search,
  searchKey,
  suggestQuery,
  type CustomFood,
  type Food,
  type FoodEntry,
  type FoodPortion,
  type IndexedItem,
  type Meal,
  type Portion,
} from '@ft/shared';
import type { CachedFood, UserDb } from '@/db/dexie';
import { endpoints, OfflineError, ApiError } from '@/lib/api';
import { fmt2, fmtGrams } from '@/lib/format';
import { loadBls } from './bls';

export function customToFood(c: CustomFood): Food {
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

/**
 * Filter for the "Eigene" tab: own foods by name or brand, saved meals by name or ingredient.
 * Umlauts and accents fold (`normalize`, then "ae" → "a"), so "kase", "kaese" and "käse" all find
 * "Käse"; an empty query keeps everything.
 */
export function filterOwn(
  query: string,
  custom: readonly CustomFood[],
  meals: readonly Meal[],
): { custom: CustomFood[]; meals: Meal[] } {
  const q = searchKey(query);
  if (!q) return { custom: [...custom], meals: [...meals] };
  const hit = (text: string | null | undefined) => !!text && searchKey(text).includes(q);
  return {
    custom: custom.filter((c) => hit(c.name) || hit(c.brand)),
    meals: meals.filter((m) => hit(m.name) || m.items.some((i) => hit(i.name))),
  };
}

export async function rememberFood(db: UserDb, food: Food): Promise<void> {
  if (food.source === 'custom') return;
  const cached: CachedFood = { ...food, lastUsedAt: Date.now() };
  await db.foodCache.put(cached);
}

/** How often (and when last) each food was logged, from `recentAndFrequent`. */
export type FoodUsage = Map<string, { count: number; lastLoggedAt: number; last?: FoodEntry }>;

/**
 * Ranking boost for foods the user logged before: enough to put a used "Brötchen, Weizen" above an
 * unused exact match "Brötchen" (≈ 40 points apart), growing a little with the number of entries.
 */
export function usageBoost(usage: FoodUsage | undefined, foodId: string): number {
  const used = usage?.get(foodId);
  return used ? 60 + Math.min(30, used.count * 6) : 0;
}

/**
 * Own foods and saved meals rank above database foods, also above an exact database name when
 * they only add a word ("Hafer Flocken Bio" before "Hafer Flocken"). Same value in the AI search.
 */
const OWN_BOOST = 55;
/** Products used before (food cache) a little above new ones. */
const CACHED_BOOST = 15;

/** One row of the search: a food or a saved meal. */
export type SearchRow =
  | { kind: 'food'; id: string; food: Food; score: number; fuzzy?: boolean }
  | { kind: 'meal'; id: string; meal: Meal; score: number };

export interface LocalSearchResult {
  rows: SearchRow[];
  /** The query with typos corrected ("jogurt" → "Joghurt"), when a word matched nothing. */
  suggestion: string | null;
}

type MealSearchable = { id: string; name: string; keywords: string; source: 'meal'; meal: Meal };

/** Indexes of the own data, rebuilt only when it changed (the search runs on every keystroke). */
let ownCache: { sig: string; foods: IndexedItem<Food>[]; meals: IndexedItem<MealSearchable>[] } | null = null;

function ownIndexes(foods: Food[], meals: Meal[]) {
  // Nutrients and portions are part of the signature: an edited own food must show its new values.
  const sig = [
    ...foods.map(
      (f) =>
        `${f.id}:${f.name}:${f.brand ?? ''}:${f.unit}:${Object.entries(f.nutrients).join('/')}:${f.portions.map((p) => `${p.label}=${p.grams}`).join('/')}`,
    ),
    '|',
    ...meals.map((m) => `${m.id}:${m.updatedAt}`),
  ].join(',');
  if (ownCache?.sig !== sig) {
    ownCache = {
      sig,
      foods: foods.map(indexItem),
      meals: meals.map((meal) =>
        indexItem({
          id: `meal:${meal.id}`,
          name: meal.name,
          keywords: meal.items.map((i) => i.name).join(' '),
          source: 'meal' as const,
          meal,
        }),
      ),
    };
  }
  return ownCache;
}

/**
 * Local search: BLS + own foods + cached products (+ saved meals with `meals`), ranked together.
 * Own foods, meals and cached products get a boost, and with `usage` everything logged before ranks
 * first. Only matches are boosted (`search` skips non-matching items), so usage never brings in
 * unrelated foods.
 */
export async function searchLocal(
  db: UserDb,
  query: string,
  limit = 40,
  usage?: FoodUsage,
  opts: { meals?: boolean } = {},
): Promise<LocalSearchResult> {
  const [bls, custom, cached, meals] = await Promise.all([
    loadBls().catch(() => null),
    db.customFoods.filter((f) => !f.deleted).toArray(),
    db.foodCache.where('id').startsWith('off:').toArray(),
    opts.meals ? db.meals.filter((m) => !m.deleted).toArray() : Promise.resolve([] as Meal[]),
  ]);
  const own = ownIndexes([...custom.map(customToFood), ...cached], meals);
  const boost = (f: Food) => (f.source === 'custom' ? OWN_BOOST : CACHED_BOOST) + usageBoost(usage, f.id);
  const foodHits = [
    ...search(own.foods, query, limit, boost),
    ...(bls ? search(bls.index, query, limit, (f) => usageBoost(usage, f.id)) : []),
  ];
  const seen = new Set<string>();
  const rows: SearchRow[] = foodHits
    .filter((h) => (seen.has(h.item.id) ? false : (seen.add(h.item.id), true)))
    .map((h) => ({
      kind: 'food' as const,
      id: h.item.id,
      food: h.item,
      score: h.score,
      ...(h.fuzzy ? { fuzzy: true } : {}),
    }));
  for (const h of search(own.meals, query, limit, () => OWN_BOOST)) {
    rows.push({ kind: 'meal', id: h.item.id, meal: h.item.meal, score: h.score });
  }
  rows.sort((a, b) => b.score - a.score);
  const indexes = [own.foods, own.meals, ...(bls ? [bls.index] : [])];
  return { rows: rows.slice(0, limit), suggestion: suggestQuery(indexes, query) };
}

/**
 * Online products (Open Food Facts) sorted into the local results by the same ranking: a product
 * that is a better match than a database food stands above it. Products already in the list stay
 * where they are; products OFF found by other fields (ingredients) follow at the end.
 */
export function mergeOnline(
  rows: SearchRow[],
  online: Food[],
  query: string,
  usage?: FoodUsage,
): SearchRow[] {
  const ids = new Set(rows.map((r) => r.id));
  const fresh = online.filter((f) => !ids.has(f.id));
  if (fresh.length === 0) return rows;
  const ranked = search(fresh.map(indexItem), query, fresh.length, (f) => usageBoost(usage, f.id));
  const matched = new Set(ranked.map((h) => h.item.id));
  const merged: SearchRow[] = [
    ...rows,
    ...ranked.map((h) => ({ kind: 'food' as const, id: h.item.id, food: h.item, score: h.score })),
  ].sort((a, b) => b.score - a.score);
  const rest = fresh
    .filter((f) => !matched.has(f.id))
    .map((f) => ({ kind: 'food' as const, id: f.id, food: f, score: 0 }));
  return [...merged, ...rest];
}

/** An amount to show with a search result, with its energy. */
export interface RowAmount {
  label: string;
  kcal: number;
}

/**
 * The amount a search row shows: the last logged amount, else the person's own portion, else the
 * food's first portion that is not the whole package (OFF serving, own food portion); null shows the
 * values per 100 g.
 */
export function rowAmount(food: Food, usage?: FoodUsage, userPortion?: Portion): RowAmount | null {
  const kcalPer100 = get(food.nutrients, N.kcal);
  const unit = food.unit === 'ml' ? 'ml' : 'g';
  const last = usage?.get(food.id)?.last;
  if (last && last.source !== 'quick' && last.grams !== null && last.grams > 0) {
    const label =
      last.portionLabel && last.portionGrams !== null && !/^(100|1)\s?(g|ml)$/.test(last.portionLabel)
        ? `${fmt2(last.quantity)} × ${last.portionLabel}`
        : fmtGrams(last.grams, unit);
    return { label, kcal: (kcalPer100 * last.grams) / 100 };
  }
  // A whole package ("Packung (1 kg)") is no serving: 2.480 kcal for a cheese says nothing.
  const portion = userPortion ?? food.portions.find((p) => !/^packung\b/i.test(p.label));
  if (portion && portion.grams > 0) {
    const label = /\d\s*(k?g|m?l)\b/i.test(portion.label)
      ? portion.label
      : `${portion.label} (${fmtGrams(portion.grams, unit)})`;
    return { label, kcal: (kcalPer100 * portion.grams) / 100 };
  }
  return null;
}

export async function searchOnline(
  query: string,
  signal?: AbortSignal,
): Promise<{ foods: Food[]; limited: boolean }> {
  return endpoints.searchOff(query, signal);
}

/** Resolves a food by id from the device, enriching BLS/OFF data from the server if possible. */
export async function getFood(db: UserDb, id: string, opts: { enrich?: boolean } = {}): Promise<Food | null> {
  if (!id.startsWith('bls:') && !id.startsWith('off:')) {
    const c = await db.customFoods.get(id);
    return c && !c.deleted ? customToFood(c) : null;
  }
  const cached = await db.foodCache.get(id);
  // BLS foods are complete in the cache once enriched (more keys than the compact set).
  if (cached && (id.startsWith('off:') || Object.keys(cached.nutrients).length > 15)) return cached;
  let local: Food | null = cached ?? null;
  // The catalog file can be missing offline before the first precache: then only the server knows.
  if (!local && id.startsWith('bls:')) local = (await loadBls().catch(() => null))?.foods.get(id) ?? null;
  if (opts.enrich === false) return local;
  try {
    const { food } = await endpoints.food(id, local ? 2500 : 8000);
    await db.foodCache.put({ ...food, lastUsedAt: cached?.lastUsedAt ?? 0 });
    return food;
  } catch {
    return local;
  }
}

export type BarcodeResult =
  | { status: 'found'; food: Food }
  | { status: 'not_found' }
  | { status: 'offline' }
  | { status: 'error'; message: string };

export async function lookupBarcode(db: UserDb, raw: string): Promise<BarcodeResult> {
  const ean = raw.replace(/\D/g, '');
  // UPC-A (12 digits) and EAN-13 with a leading zero are the same code; own foods may hold either.
  const variants =
    ean.length === 12
      ? [`0${ean}`, ean]
      : ean.length === 13 && ean.startsWith('0')
        ? [ean, ean.slice(1)]
        : [ean];
  const custom = await db.customFoods
    .where('barcode')
    .anyOf(variants)
    .filter((f) => !f.deleted)
    .first();
  if (custom) return { status: 'found', food: customToFood(custom) };
  for (const v of variants) {
    const cached = await db.foodCache.get(foodIds.off(v));
    if (cached) return { status: 'found', food: cached };
  }
  try {
    const { food } = await endpoints.barcode(ean);
    await rememberFood(db, food);
    return { status: 'found', food };
  } catch (e) {
    if (e instanceof OfflineError) return { status: 'offline' };
    if (e instanceof ApiError && e.status === 404) return { status: 'not_found' };
    return { status: 'error', message: e instanceof ApiError ? e.code : 'unknown' };
  }
}

/** User-defined portions for a food. */
export async function userPortions(db: UserDb, foodId: string): Promise<(Portion & { id: string })[]> {
  const list: FoodPortion[] = await db.foodPortions
    .where('foodId')
    .equals(foodId)
    .filter((p) => !p.deleted)
    .toArray();
  return list.map((p) => ({ id: p.id, label: p.label, grams: p.grams }));
}

export interface RecentFood {
  foodId: string;
  name: string;
  brand: string | null;
  last: FoodEntry;
  count: number;
}

/**
 * "Kürzlich" (most recent first) and "Häufig" (most logged in the last 90 days), derived from
 * the diary so they sync across devices for free. `usage` covers every food of that period (also
 * those logged once) and feeds the search ranking.
 */
export async function recentAndFrequent(
  db: UserDb,
  today: string,
): Promise<{ recent: RecentFood[]; frequent: RecentFood[]; usage: FoodUsage }> {
  const from = addDays(today, -90);
  const entries = await db.foodEntries
    .where('date')
    .aboveOrEqual(from)
    .filter((e) => !e.deleted && e.foodId !== null)
    .toArray();
  const byFood = new Map<string, RecentFood>();
  for (const e of entries) {
    const r = byFood.get(e.foodId!);
    if (!r) byFood.set(e.foodId!, { foodId: e.foodId!, name: e.name, brand: e.brand, last: e, count: 1 });
    else {
      r.count++;
      if (e.loggedAt > r.last.loggedAt) r.last = e;
    }
  }
  const all = [...byFood.values()];
  const usage: FoodUsage = new Map(
    all.map((r) => [r.foodId, { count: r.count, lastLoggedAt: r.last.loggedAt, last: r.last }]),
  );
  return {
    usage,
    recent: [...all].sort((a, b) => b.last.loggedAt - a.last.loggedAt).slice(0, 40),
    frequent: all
      .filter((r) => r.count >= 2)
      .sort((a, b) => b.count - a.count || b.last.loggedAt - a.last.loggedAt)
      .slice(0, 40),
  };
}
