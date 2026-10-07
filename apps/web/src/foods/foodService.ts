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
  indexItem,
  normalize,
  search,
  type CustomFood,
  type Food,
  type FoodEntry,
  type FoodPortion,
  type Meal,
  type Portion,
} from '@ft/shared';
import type { CachedFood, UserDb } from '@/db/dexie';
import { endpoints, OfflineError, ApiError } from '@/lib/api';
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
  const loose = (text: string) => normalize(text).replace(/([aou])e/g, '$1');
  const q = loose(query);
  if (!q) return { custom: [...custom], meals: [...meals] };
  const hit = (text: string | null | undefined) => !!text && loose(text).includes(q);
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

export interface SearchHit {
  food: Food;
  score: number;
}

/** How often (and when last) each food was logged, from `recentAndFrequent`. */
export type FoodUsage = Map<string, { count: number; lastLoggedAt: number }>;

/**
 * Ranking boost for foods the user logged before: enough to put a used "Brötchen, Weizen" above an
 * unused exact match "Brötchen" (≈ 40 points apart), growing a little with the number of entries.
 */
export function usageBoost(usage: FoodUsage | undefined, foodId: string): number {
  const used = usage?.get(foodId);
  return used ? 60 + Math.min(30, used.count * 6) : 0;
}

/**
 * Local search: BLS + own foods + cached products. Own foods and cached products get a boost, and
 * with `usage` everything logged before ranks first. Only matches are boosted (`search` skips
 * non-matching items), so usage never brings in unrelated foods.
 */
export async function searchLocal(
  db: UserDb,
  query: string,
  limit = 40,
  usage?: FoodUsage,
): Promise<SearchHit[]> {
  const [bls, custom, cached] = await Promise.all([
    loadBls().catch(() => null),
    db.customFoods.filter((f) => !f.deleted).toArray(),
    db.foodCache.where('id').startsWith('off:').toArray(),
  ]);
  const own = [...custom.map(customToFood), ...cached].map(indexItem);
  const ownHits = search(
    own,
    query,
    limit,
    (f) => (f.source === 'custom' ? 40 : 15) + usageBoost(usage, f.id),
  );
  const blsHits = bls ? search(bls.index, query, limit, (f) => usageBoost(usage, f.id)) : [];
  const seen = new Set<string>();
  return [...ownHits, ...blsHits]
    .sort((a, b) => b.score - a.score)
    .filter((h) => (seen.has(h.item.id) ? false : (seen.add(h.item.id), true)))
    .slice(0, limit)
    .map((h) => ({ food: h.item, score: h.score }));
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
  if (!local && id.startsWith('bls:')) local = (await loadBls()).foods.get(id) ?? null;
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
  const custom = await db.customFoods
    .where('barcode')
    .equals(ean)
    .filter((f) => !f.deleted)
    .first();
  if (custom) return { status: 'found', food: customToFood(custom) };
  const variants =
    ean.length === 12
      ? [`0${ean}`, ean]
      : ean.length === 13 && ean.startsWith('0')
        ? [ean, ean.slice(1)]
        : [ean];
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
    all.map((r) => [r.foodId, { count: r.count, lastLoggedAt: r.last.loggedAt }]),
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
