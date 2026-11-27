/**
 * Import of Open Food Facts' data export into `off_catalog`: the branded products sold in Germany,
 * Austria and Switzerland that have a name and an energy value. The export (a gzipped, tab separated
 * file of every product worldwide, about 1.5 GB) is read as a stream and never kept on disk.
 *
 * Rows are upserted under a run number while the search keeps answering from the table; rows of
 * older runs (products OFF dropped or that left the three countries) are deleted when the run ends.
 * OFF data © Open Food Facts contributors, Open Database License (ODbL).
 */
import { searchKey, type Food } from '@ft/shared';
import { eq, sql } from 'drizzle-orm';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import type { Db } from '../db/client.js';
import { appMeta, offCatalog } from '../db/schema.js';
import { log } from '../log.js';
import { OFF_COUNTRIES } from './client.js';
import { normalizeOffProduct } from './normalize.js';

export const OFF_DUMP_URL = 'https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz';
/** The export is renewed daily; products change slowly, so once a week is enough. */
export const IMPORT_EVERY_MS = 7 * 24 * 60 * 60 * 1000;
const META_KEY = 'off_catalog';
const BATCH = 500;
/** A run that found far fewer products than the table holds was cut off: it deletes nothing. */
const MIN_SHARE = 0.8;

export interface OffCatalogState {
  /** When the last complete import ended (epoch ms). */
  importedAt: number;
  rows: number;
}

type CatalogRow = typeof offCatalog.$inferInsert;

/** Column name → index, from the header line of the export. */
export type OffColumns = Map<string, number>;

export function offColumns(header: string): OffColumns {
  return new Map(header.split('\t').map((name, i) => [name, i]));
}

const GERMANY = OFF_COUNTRIES[0]!;

/** One line of the export as a catalog row; null for products of other countries or without values. */
export function parseOffLine(columns: OffColumns, line: string, run: number): CatalogRow | null {
  // Most lines are products of other countries: skip them before splitting 200 columns.
  if (!OFF_COUNTRIES.some((c) => line.includes(c))) return null;
  const fields = line.split('\t');
  const col = (name: string) => fields[columns.get(name) ?? -1] ?? '';
  const countries = col('countries_tags').split(',');
  if (!OFF_COUNTRIES.some((c) => countries.includes(c))) return null;
  const nutriments: Record<string, string> = {};
  for (const [name, i] of columns) {
    if (name.endsWith('_100g') && fields[i]) nutriments[name] = fields[i];
  }
  const food = normalizeOffProduct({
    code: col('code'),
    product_name: col('product_name'),
    generic_name_de: col('generic_name'),
    brands: col('brands') || col('brands_tags').split(',')[0],
    quantity: col('quantity'),
    serving_size: col('serving_size'),
    serving_quantity: col('serving_quantity'),
    product_quantity: col('product_quantity'),
    image_front_small_url: col('image_small_url') || undefined,
    nutriments,
    unique_scans_n: col('unique_scans_n'),
  });
  if (!food) return null;
  return {
    code: food.sourceId!,
    name: food.name,
    brand: food.brand,
    unit: food.unit,
    nutrients: food.nutrients,
    portions: food.portions,
    imageUrl: food.imageUrl ?? null,
    popularity: food.popularity ?? 0,
    german: countries.includes(GERMANY),
    searchKey: searchKey(`${food.name} ${food.brand ?? ''}`),
    run,
  };
}

export function catalogRowToFood(r: typeof offCatalog.$inferSelect): Food {
  return {
    id: `off:${r.code}`,
    source: 'off',
    sourceId: r.code,
    name: r.name,
    nameEn: null,
    brand: r.brand,
    group: null,
    unit: r.unit,
    nutrients: r.nutrients,
    portions: r.portions,
    imageUrl: r.imageUrl,
    ...(r.popularity ? { popularity: r.popularity } : {}),
  };
}

async function writeBatch(db: Db, rows: CatalogRow[]) {
  const unique = [...new Map(rows.map((r) => [r.code, r])).values()];
  await db
    .insert(offCatalog)
    .values(unique)
    .onConflictDoUpdate({
      target: offCatalog.code,
      set: {
        name: sql`excluded.name`,
        brand: sql`excluded.brand`,
        unit: sql`excluded.unit`,
        nutrients: sql`excluded.nutrients`,
        portions: sql`excluded.portions`,
        imageUrl: sql`excluded.image_url`,
        popularity: sql`excluded.popularity`,
        german: sql`excluded.german`,
        searchKey: sql`excluded.search_key`,
        run: sql`excluded.run`,
      },
    });
}

export async function offCatalogState(db: Db): Promise<OffCatalogState | null> {
  const [meta] = await db.select().from(appMeta).where(eq(appMeta.key, META_KEY));
  if (!meta) return null;
  try {
    return JSON.parse(meta.value) as OffCatalogState;
  } catch {
    return null;
  }
}

/**
 * Reads the export line by line (`lines`: the text of the file, header first) into `off_catalog`.
 * Returns the number of products written.
 */
export async function importOffLines(
  db: Db,
  lines: AsyncIterable<string>,
  now = Date.now(),
): Promise<OffCatalogState> {
  const run = Math.floor(now / 1000);
  let columns: OffColumns | null = null;
  let batch: CatalogRow[] = [];
  let rows = 0;
  for await (const line of lines) {
    if (!columns) {
      columns = offColumns(line);
      if (!columns.has('code') || !columns.has('countries_tags') || !columns.has('product_name'))
        throw new Error('OFF export: unexpected header');
      continue;
    }
    const row = parseOffLine(columns, line, run);
    if (!row) continue;
    batch.push(row);
    if (batch.length >= BATCH) {
      await writeBatch(db, batch);
      rows += batch.length;
      batch = [];
    }
  }
  if (batch.length > 0) {
    await writeBatch(db, batch);
    rows += batch.length;
  }
  const total = await db.$count(offCatalog);
  const current = await db.$count(offCatalog, eq(offCatalog.run, run));
  if (current === 0) throw new Error('OFF export: no products found');
  if (current >= total * MIN_SHARE) await db.delete(offCatalog).where(sql`${offCatalog.run} <> ${run}`);
  else log.warn('OFF import: fewer products than before, old rows kept', { found: current, before: total });
  const state: OffCatalogState = { importedAt: Date.now(), rows: await db.$count(offCatalog) };
  await db
    .insert(appMeta)
    .values({ key: META_KEY, value: JSON.stringify(state) })
    .onConflictDoUpdate({ target: appMeta.key, set: { value: JSON.stringify(state) } });
  log.info('OFF catalog imported', { rows: state.rows, read: rows });
  return state;
}

/** The lines of a gzipped export, from a URL or a local file path. */
export async function offDumpLines(source: string, userAgent: string): Promise<AsyncIterable<string>> {
  let input: Readable;
  if (/^https?:/.test(source)) {
    const res = await fetch(source, { headers: { 'User-Agent': userAgent } });
    if (!res.ok || !res.body) throw new Error(`OFF export HTTP ${res.status}`);
    input = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream);
  } else {
    const { createReadStream } = await import('node:fs');
    input = createReadStream(source);
  }
  const text = input.pipe(createGunzip());
  input.on('error', (e) => text.destroy(e));
  return createInterface({ input: text, crlfDelay: Infinity });
}

let running: Promise<OffCatalogState> | null = null;

/** Downloads and imports the export; a second call while one runs joins it. */
export function importOffCatalog(db: Db, source: string, userAgent: string): Promise<OffCatalogState> {
  running ??= (async () => {
    try {
      return await importOffLines(db, await offDumpLines(source, userAgent));
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Whether the weekly import is due (never run, or the last one is older than a week). */
export async function offImportDue(db: Db, now = Date.now()): Promise<boolean> {
  const state = await offCatalogState(db);
  return !state || now - state.importedAt >= IMPORT_EVERY_MS;
}
