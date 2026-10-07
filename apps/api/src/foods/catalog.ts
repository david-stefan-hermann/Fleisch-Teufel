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
  search,
  type Food,
  type IndexedItem,
} from '@ft/shared';
import { and, eq, gt, sql } from 'drizzle-orm';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import type { Db } from '../db/client.js';
import { appMeta, foods, offMisses } from '../db/schema.js';
import { log } from '../log.js';
import { OffRateLimitedError, type OffClient } from '../off/client.js';
import { normalizeBarcode } from '../off/normalize.js';

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
    for (const r of cached) this.indexOff(rowToFood(r));
  }

  get blsCount(): number {
    return this.bls.size;
  }

  async get(id: string): Promise<Food | null> {
    const b = this.bls.get(id);
    if (b) return b;
    const [row] = await this.db.select().from(foods).where(eq(foods.id, id));
    return row ? rowToFood(row) : null;
  }

  /** Local search over BLS and cached OFF products (no network). */
  searchLocal(
    query: string,
    limit = 20,
    opts: { includeOff?: boolean } = {},
  ): { food: Food; score: number }[] {
    const bls = search(this.blsIndex, query, limit);
    const off = opts.includeOff === false ? [] : search([...this.offIndex.values()], query, limit);
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

  async searchOff(query: string, limit = 20): Promise<OffSearchResult> {
    const key = query.trim().toLowerCase();
    const hit = this.searchCache.get(key);
    if (hit && Date.now() - hit.at < SEARCH_CACHE_MS)
      return { foods: hit.foods.slice(0, limit), limited: false };
    try {
      const found = await this.off.search(query, limit);
      await this.store(found);
      this.searchCache.set(key, { at: Date.now(), foods: found });
      if (this.searchCache.size > 500) this.searchCache.delete(this.searchCache.keys().next().value!);
      return { foods: found, limited: false };
    } catch (e) {
      if (!(e instanceof OffRateLimitedError)) log.warn('OFF search failed', { error: String(e) });
      const local = search([...this.offIndex.values()], query, limit).map((h) => h.item);
      return { foods: local, limited: true };
    }
  }

  private async store(list: Food[]) {
    if (list.length === 0) return;
    const unique = [...new Map(list.map((f) => [f.id, f])).values()];
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

  private indexOff(f: Food) {
    this.offIndex.set(f.id, indexItem(f));
  }
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
