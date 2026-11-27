/**
 * Food catalog: BLS 4.0 (all 138 components, kept in memory and seeded into Postgres) plus the
 * Open Food Facts cache. Provides id lookup, barcode lookup and text search for the API and
 * the AI matcher. The search algorithm is the same one the device uses offline (`@ft/shared`).
 */
import {
  blsGroup,
  blsUnit,
  completeNutrients,
  foodIds,
  indexItem,
  queryTerms,
  queryWords,
  search,
  searchKey,
  stem,
  type Food,
  type IndexedItem,
} from '@ft/shared';
import { and, eq, gt, inArray, sql, type SQL } from 'drizzle-orm';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import type { Db } from '../db/client.js';
import { appMeta, foods, offCatalog, offMisses } from '../db/schema.js';
import { log } from '../log.js';
import { OffRateLimitedError, type OffClient } from '../off/client.js';
import { catalogRowToFood, offCatalogState, type OffCatalogState } from '../off/import.js';
import { cleanBrand, hasTagBrand, normalizeBarcode } from '../off/normalize.js';

export interface BlsFile {
  version: string;
  citation: string;
  foods: {
    code: string;
    name: string;
    nameEn: string;
    note: string | null;
    nutrients: Record<string, number>;
  }[];
}

export function blsDataPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const p of [
    resolve(here, 'data/bls-4.0.json.gz'),
    resolve(here, '../data/bls-4.0.json.gz'),
    resolve(here, '../../data/bls-4.0.json.gz'),
  ]) {
    if (existsSync(p)) return p;
  }
  throw new Error('BLS data file bls-4.0.json.gz not found (run `pnpm bls:import`)');
}

export function loadBls(path = blsDataPath()): BlsFile {
  return JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')) as BlsFile;
}

export function blsToFood(f: BlsFile['foods'][number]): Food {
  return {
    id: foodIds.bls(f.code),
    source: 'bls',
    sourceId: f.code,
    name: f.name,
    nameEn: f.nameEn || null,
    brand: null,
    group: blsGroup(f.code),
    unit: blsUnit(f.code),
    nutrients: completeNutrients(f.nutrients),
    portions: [],
    imageUrl: null,
  };
}

const OFF_FRESH_MS = 30 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 24 * 60 * 60 * 1000;
const SEARCH_CACHE_MS = 6 * 60 * 60 * 1000;
/** An empty answer of the live search is kept only briefly: OFF may just have been slow to index. */
const EMPTY_CACHE_MS = 5 * 60 * 1000;
/** Products fetched per live request. */
const LIVE_PAGE = 50;
/** Fewer matching products than this make the live search ask for the single words too. */
const RELAX_BELOW = 5;
/** Products of the own catalog handed to the ranking per query (the most scanned that match). */
const CANDIDATES = 300;
/** Fewer candidates than this let words also match as typos (`pg_trgm`). */
const TYPO_BELOW = 5;
/** Trigram word similarity from which a product counts as a candidate for a mistyped word. */
const TYPO_SIMILARITY = 0.45;

export interface OffSearchResult {
  foods: Food[];
  /** True when OFF was not asked (rate limit or error) and only cached products are returned. */
  limited: boolean;
}

export class FoodCatalog {
  readonly blsVersion: string;
  private readonly bls = new Map<string, Food>();
  private readonly blsIndex: IndexedItem<Food>[];
  private offIndex = new Map<string, IndexedItem<Food>>();
  private searchCache = new Map<string, { at: number; foods: Food[] }>();

  constructor(
    private readonly db: Db,
    private readonly off: OffClient,
    blsFile: BlsFile,
  ) {
    this.blsVersion = blsFile.version;
    for (const f of blsFile.foods) {
      const food = blsToFood(f);
      this.bls.set(food.id, food);
    }
    this.blsIndex = [...this.bls.values()].map(indexItem);
  }

  /** Seeds BLS into Postgres once per BLS version and loads the OFF cache index. */
  async init(): Promise<void> {
    const [meta] = await this.db.select().from(appMeta).where(eq(appMeta.key, 'bls_version'));
    if (meta?.value !== this.blsVersion) {
      const rows = [...this.bls.values()].map((f) => ({
        id: f.id,
        source: 'bls' as const,
        sourceId: f.sourceId!,
        name: f.name,
        nameEn: f.nameEn,
        brand: null,
        group: f.group,
        unit: f.unit,
        nutrients: f.nutrients,
        portions: [],
        imageUrl: null,
      }));
      await this.db.transaction(async (tx) => {
        for (let i = 0; i < rows.length; i += 500) {
          await tx
            .insert(foods)
            .values(rows.slice(i, i + 500))
            .onConflictDoUpdate({
              target: foods.id,
              set: {
                name: sql`excluded.name`,
                nameEn: sql`excluded.name_en`,
                group: sql`excluded.group`,
                unit: sql`excluded.unit`,
                nutrients: sql`excluded.nutrients`,
                fetchedAt: sql`now()`,
              },
            });
        }
        await tx
          .insert(appMeta)
          .values({ key: 'bls_version', value: this.blsVersion })
          .onConflictDoUpdate({ target: appMeta.key, set: { value: this.blsVersion } });
      });
      log.info('BLS seeded', { version: this.blsVersion, foods: rows.length });
    }
    const cached = await this.db.select().from(foods).where(eq(foods.source, 'off'));
    for (const r of cached) {
      // Brands the search once delivered with a language prefix ("xx:gut-gunstig").
      if (r.brand && /^[a-z]{2}:/.test(r.brand)) {
        r.brand = cleanBrand(r.brand).brand;
        await this.db.update(foods).set({ brand: r.brand }).where(eq(foods.id, r.id));
      }
      this.indexOff(rowToFood(r));
    }
    await this.refreshCatalog();
  }

  /** State of the own product catalog (`off_catalog`); null until the first import ended. */
  catalogState: OffCatalogState | null = null;
  private catalogRows = 0;

  /** Reads the state of `off_catalog` again (after an import). */
  async refreshCatalog(): Promise<void> {
    this.catalogState = await offCatalogState(this.db);
    this.catalogRows = await this.db.$count(offCatalog);
  }

  get blsCount(): number {
    return this.bls.size;
  }

  async get(id: string): Promise<Food | null> {
    const b = this.bls.get(id);
    if (b) return b;
    const [row] = await this.db.select().from(foods).where(eq(foods.id, id));
    if (row) return rowToFood(row);
    return id.startsWith('off:') ? this.fromCatalog([id.slice(4)]) : null;
  }

  /** A product of the own catalog by barcode; whoever asks for one uses it, so it moves into `foods`. */
  private async fromCatalog(codes: string[]): Promise<Food | null> {
    if (this.catalogRows === 0) return null;
    const [row] = await this.db.select().from(offCatalog).where(inArray(offCatalog.code, codes));
    if (!row) return null;
    const food = catalogRowToFood(row);
    await this.store([food]);
    return food;
  }

  /** Local search over BLS and cached OFF products (no network). */
  searchLocal(
    query: string,
    limit = 20,
    opts: { includeOff?: boolean } = {},
  ): { food: Food; score: number }[] {
    const bls = search(this.blsIndex, query, limit);
    const off = opts.includeOff === false ? [] : search(this.offList(), query, limit);
    return [...bls, ...off]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((h) => ({ food: h.item, score: h.score }));
  }

  async barcode(raw: string): Promise<Food | null> {
    const ean = normalizeBarcode(raw);
    if (!ean) return null;
    const candidates = ean.length === 13 && ean.startsWith('0') ? [ean, ean.slice(1)] : [ean];
    for (const code of candidates) {
      const [row] = await this.db
        .select()
        .from(foods)
        .where(eq(foods.id, foodIds.off(code)));
      if (row && Date.now() - row.fetchedAt.getTime() < OFF_FRESH_MS) return rowToFood(row);
    }
    const known = await this.fromCatalog(candidates);
    if (known) return known;
    const [miss] = await this.db
      .select()
      .from(offMisses)
      .where(and(eq(offMisses.ean, ean), gt(offMisses.checkedAt, new Date(Date.now() - MISS_TTL_MS))));
    if (miss) return null;
    try {
      const food = await this.off.product(ean);
      if (food) {
        await this.store([food]);
        return food;
      }
      await this.db
        .insert(offMisses)
        .values({ ean })
        .onConflictDoUpdate({ target: offMisses.ean, set: { checkedAt: sql`now()` } });
      return null;
    } catch (e) {
      // Stale cache beats nothing when OFF is down or rate-limited.
      const [row] = await this.db
        .select()
        .from(foods)
        .where(eq(foods.id, foodIds.off(ean)));
      if (row) return rowToFood(row);
      throw e;
    }
  }

  /**
   * Branded products for a typed query: from the own catalog once it is imported (`off_catalog` plus
   * the products already used), else from OFF's live search.
   */
  async searchOff(query: string, limit = 20): Promise<OffSearchResult> {
    if (this.hasCatalog) return { foods: await this.searchCatalog(query, limit), limited: false };
    return this.searchLive(query, limit);
  }

  /**
   * The own catalog: PostgreSQL picks the candidates (every word somewhere in name or brand, the most
   * scanned first), the shared ranking orders them, together with the products already in use.
   */
  async searchCatalog(query: string, limit = 20): Promise<Food[]> {
    return (await this.searchCatalogHits(query, limit)).map((h) => h.food);
  }

  /** Whether the own product catalog is imported (the text search then never asks OFF). */
  get hasCatalog(): boolean {
    return this.catalogRows > 0;
  }

  async searchCatalogHits(query: string, limit = 20): Promise<{ food: Food; score: number }[]> {
    const words = queryWords(query);
    if (words.length === 0) return [];
    const like = (w: string) => sql`${offCatalog.searchKey} like ${`%${stem(w)}%`}`;
    const candidates = (conds: SQL[], db: Pick<Db, 'select'> = this.db) =>
      db
        .select()
        .from(offCatalog)
        .where(and(...conds))
        .orderBy(sql`${offCatalog.popularity} desc, length(${offCatalog.name})`)
        .limit(CANDIDATES);
    let rows = await candidates(words.map(like));
    if (rows.length < TYPO_BELOW && words.some((w) => w.length >= 5)) {
      // Swapped letters cost a short word half its trigrams, hence the low threshold.
      const loose = await this.db.transaction(async (tx) => {
        await tx.execute(
          sql`set local pg_trgm.word_similarity_threshold = ${sql.raw(String(TYPO_SIMILARITY))}`,
        );
        return candidates(
          words.map((w) => (w.length >= 5 ? sql`(${like(w)} or ${w} <% ${offCatalog.searchKey})` : like(w))),
          tx,
        );
      });
      rows = [...new Map([...rows, ...loose].map((r) => [r.code, r])).values()];
    }
    const german = new Map(rows.map((r) => [`off:${r.code}`, r.german]));
    const hits = [
      ...search(rows.map(catalogRowToFood).map(indexItem), query, limit * 2),
      ...search(this.offList(), query, limit * 2),
    ].sort(
      // On equal points (to the whole point) products sold in Germany come first.
      (a, b) =>
        Math.round(b.score) - Math.round(a.score) ||
        Number(german.get(b.item.id) ?? true) - Number(german.get(a.item.id) ?? true) ||
        b.score - a.score ||
        a.item.name.length - b.item.name.length,
    );
    const scores = new Map<string, number>();
    for (const h of hits) if (!scores.has(h.item.id)) scores.set(h.item.id, h.score);
    return uniqueProducts(hits.map((h) => h.item))
      .slice(0, limit)
      .map((food) => ({ food, score: scores.get(food.id)! }));
  }

  /** OFF's live search, used until the own catalog is imported. */
  private async searchLive(query: string, limit: number): Promise<OffSearchResult> {
    const key = query.trim().toLowerCase();
    const hit = this.searchCache.get(key);
    if (hit && Date.now() - hit.at < (hit.foods.length > 0 ? SEARCH_CACHE_MS : EMPTY_CACHE_MS))
      return { foods: hit.foods.slice(0, limit), limited: false };
    const local = () => search(this.offList(), query, LIVE_PAGE).map((h) => h.item);
    try {
      const first = await this.off.search(query, LIVE_PAGE);
      const matching = (list: Food[]) => search(list.map(indexItem), query, list.length).map((h) => h.item);
      const extra: Food[] = [];
      const terms = queryTerms(query);
      if (terms.length > 1 && matching(first).length < RELAX_BELOW) {
        // OFF wants all words in one field: "skyr" (name) plus "gut günstig" (brand) finds nothing.
        // Ask for the single words and keep what our ranking accepts for the whole query.
        for (const term of [...terms].sort((a, b) => b.length - a.length).slice(0, 2)) {
          try {
            extra.push(...matching(await this.off.search(term, LIVE_PAGE)));
          } catch (e) {
            if (!(e instanceof OffRateLimitedError)) log.warn('OFF search failed', { error: String(e) });
            break;
          }
        }
      }
      const fresh = [...first, ...extra];
      await this.store(fresh);
      const found = rankProducts(query, [...fresh, ...local()]);
      this.searchCache.set(key, { at: Date.now(), foods: found });
      if (this.searchCache.size > 500) this.searchCache.delete(this.searchCache.keys().next().value!);
      return { foods: found.slice(0, limit), limited: false };
    } catch (e) {
      if (!(e instanceof OffRateLimitedError)) log.warn('OFF search failed', { error: String(e) });
      return { foods: local().slice(0, limit), limited: true };
    }
  }

  private async store(list: Food[]) {
    if (list.length === 0) return;
    // A brand that arrived only as a tag never replaces the spelling of an earlier scan.
    const unique = [...new Map(list.map((f) => [f.id, f])).values()].map((f) => {
      const known = hasTagBrand(f) ? this.offIndex.get(f.id)?.item.brand : null;
      return known ? { ...f, brand: known } : f;
    });
    await this.db
      .insert(foods)
      .values(
        unique.map((f) => ({
          id: f.id,
          source: 'off' as const,
          sourceId: f.sourceId!,
          name: f.name,
          nameEn: f.nameEn,
          brand: f.brand,
          group: f.group,
          unit: f.unit,
          nutrients: f.nutrients,
          portions: f.portions,
          imageUrl: f.imageUrl ?? null,
        })),
      )
      .onConflictDoUpdate({
        target: foods.id,
        set: {
          name: sql`excluded.name`,
          brand: sql`excluded.brand`,
          unit: sql`excluded.unit`,
          nutrients: sql`excluded.nutrients`,
          portions: sql`excluded.portions`,
          imageUrl: sql`excluded.image_url`,
          fetchedAt: sql`now()`,
        },
      });
    for (const f of unique) this.indexOff(f);
  }

  /** Forgets cached OFF products the housekeeping deleted (`cleanupOffFoods`). */
  dropOff(ids: readonly string[]) {
    if (ids.length === 0) return;
    for (const id of ids) this.offIndex.delete(id);
    this.offListCache = null;
    this.searchCache.clear();
  }

  /** Number of cached OFF products in the search index. */
  get offCount(): number {
    return this.offIndex.size;
  }

  private indexOff(f: Food) {
    this.offIndex.set(f.id, indexItem(f));
    this.offListCache = null;
  }

  /** The cached OFF index as one stable array (the search keeps its word list per array). */
  private offListCache: IndexedItem<Food>[] | null = null;
  private offList(): IndexedItem<Food>[] {
    return (this.offListCache ??= [...this.offIndex.values()]);
  }
}

/**
 * OFF search results in our ranking (the same as for local foods: name and brand, popularity), one
 * product per name and brand. Products OFF found by other fields (ingredients) follow in OFF's order.
 */
export function rankProducts(query: string, found: Food[]): Food[] {
  const unique = uniqueProducts(found);
  const ranked = search(unique.map(indexItem), query, unique.length).map((h) => h.item);
  const ids = new Set(ranked.map((f) => f.id));
  return [...ranked, ...unique.filter((f) => !ids.has(f.id))];
}

/** One product per id and per name and brand (the first of each stays). */
function uniqueProducts(list: Food[]): Food[] {
  const seen = new Set<string>();
  return list.filter((f) => {
    const key = `${searchKey(f.name)}|${searchKey(f.brand ?? '')}`;
    if (seen.has(f.id) || seen.has(key)) return false;
    seen.add(f.id);
    seen.add(key);
    return true;
  });
}

function rowToFood(r: typeof foods.$inferSelect): Food {
  return {
    id: r.id,
    source: r.source,
    sourceId: r.sourceId,
    name: r.name,
    nameEn: r.nameEn,
    brand: r.brand,
    group: r.group,
    unit: r.unit,
    nutrients: r.nutrients,
    portions: r.portions,
    imageUrl: r.imageUrl,
  };
}
