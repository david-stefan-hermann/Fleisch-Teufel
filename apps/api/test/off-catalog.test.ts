import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { foods, offCatalog } from '../src/db/schema.js';
import {
  importOffLines,
  offCatalogState,
  offColumns,
  offImportDue,
  parseOffLine,
} from '../src/off/import.js';
import { cleanBrand, normalizeOffProduct } from '../src/off/normalize.js';
import { createTestContext, registeredClient, TestClient, type TestCtx } from './helpers.js';

const HEADER = [
  'code',
  'product_name',
  'generic_name',
  'quantity',
  'brands',
  'brands_tags',
  'countries_tags',
  'serving_size',
  'serving_quantity',
  'product_quantity',
  'unique_scans_n',
  'image_small_url',
  'energy-kcal_100g',
  'proteins_100g',
  'fat_100g',
  'carbohydrates_100g',
];

interface DumpRow {
  code: string;
  name: string;
  brands?: string;
  brandsTags?: string;
  countries?: string;
  scans?: number;
  kcal?: number | null;
}

function dumpLine(r: DumpRow): string {
  const values: Record<string, string> = {
    code: r.code,
    product_name: r.name,
    quantity: '450 g',
    brands: r.brands ?? '',
    brands_tags: r.brandsTags ?? '',
    countries_tags: r.countries ?? 'en:germany',
    unique_scans_n: String(r.scans ?? 0),
    'energy-kcal_100g': r.kcal === null ? '' : String(r.kcal ?? 62),
    proteins_100g: '11',
    fat_100g: '0.2',
    carbohydrates_100g: '4',
  };
  return HEADER.map((h) => values[h] ?? '').join('\t');
}

async function* dump(rows: DumpRow[]) {
  yield HEADER.join('\t');
  for (const r of rows) yield dumpLine(r);
}

/** Skyr of six brands, as the export has them, plus what must not be found. */
const SKYR: DumpRow[] = [
  { code: '4311501657751', name: 'SKYR Natur', brands: 'GUT&GÜNSTIG', scans: 6 },
  { code: '4061458016827', name: 'Skyr Natur', brands: 'Milsani', scans: 40 },
  { code: '5760466996808', name: 'Skyr Natur', brands: 'Arla', scans: 120 },
  { code: '4388860619331', name: 'Skyr', brands: 'ja!', scans: 30 },
  { code: '4337256783248', name: 'Skyr Vanille', brands: 'REWE Beste Wahl', scans: 20 },
  {
    code: '4056489216162',
    name: 'Skyr natur',
    brands: 'Milbona',
    scans: 80,
    countries: 'en:austria,en:germany',
  },
  { code: '4311501000013', name: 'Gouda jung', brands: 'Gut & Günstig', scans: 15 },
  { code: '4311501000020', name: 'Speisequark Magerstufe', brands: '', brandsTags: 'gut-gunstig', scans: 9 },
  { code: '7610000000017', name: 'Joghurt Nature', brands: 'Emmi', countries: 'en:switzerland', scans: 5 },
  { code: '0041000000010', name: 'Skyr Plain', brands: 'Siggis', countries: 'en:united-states', scans: 900 },
  { code: '4000000000019', name: 'Skyr ohne Werte', brands: 'Namenlos', kcal: null },
];

describe('brands', () => {
  it('makes OFF brands readable', () => {
    expect(cleanBrand('xx:Milsani')).toEqual({ brand: 'Milsani', tag: false });
    expect(cleanBrand('gut-gunstig')).toEqual({ brand: 'Gut Gunstig', tag: true });
    expect(cleanBrand('GUT&GÜNSTIG')).toEqual({ brand: 'GUT&GÜNSTIG', tag: false });
    expect(cleanBrand('  ')).toEqual({ brand: null, tag: false });
    const product = (brands: string | string[]) =>
      normalizeOffProduct({
        code: '4311501657751',
        product_name: 'Skyr',
        brands,
        nutriments: { 'energy-kcal_100g': 62 },
      });
    expect(product('Gut & Günstig, Edeka')!.brand).toBe('Gut & Günstig');
    expect(product(['xx:Edeka', 'xx:Gut & Günstig'])!.brand).toBe('Edeka');
  });
});

describe('parseOffLine', () => {
  const columns = offColumns(HEADER.join('\t'));
  it('keeps products of Germany, Austria and Switzerland with a name and energy', () => {
    const row = parseOffLine(columns, dumpLine(SKYR[0]!), 7)!;
    expect(row).toMatchObject({
      code: '4311501657751',
      name: 'SKYR Natur',
      brand: 'GUT&GÜNSTIG',
      popularity: 6,
      german: true,
      searchKey: 'skyr natur gut gunstig',
      run: 7,
    });
    expect(row.nutrients).toMatchObject({ ENERCC: 62, PROT625: 11 });
    expect(row.portions).toEqual([{ label: 'Packung (450 g)', grams: 450 }]);
    expect(parseOffLine(columns, dumpLine(SKYR[8]!), 7)).toMatchObject({ german: false });
    expect(parseOffLine(columns, dumpLine(SKYR[7]!), 7)).toMatchObject({ brand: 'Gut Gunstig' });
  });
  it('drops other countries and products without values', () => {
    expect(parseOffLine(columns, dumpLine(SKYR[9]!), 7)).toBeNull();
    expect(parseOffLine(columns, dumpLine(SKYR[10]!), 7)).toBeNull();
    // A country only named in another column does not count.
    expect(
      parseOffLine(
        columns,
        dumpLine({ code: '0041000000027', name: 'en:germany', countries: 'en:france' }),
        7,
      ),
    ).toBeNull();
  });
});

describe('own product catalog', () => {
  let ctx: TestCtx;
  let c: TestClient;
  const names = async (q: string) =>
    (await ctx.deps.catalog.searchCatalog(q, 10)).map((f) => `${f.name} | ${f.brand}`);

  beforeAll(async () => {
    ctx = await createTestContext({
      off: {
        async search() {
          throw new Error('live search used');
        },
      },
    });
    c = await registeredClient(ctx);
  });
  afterAll(() => ctx.close());

  it('is empty before the first import', async () => {
    expect(ctx.deps.catalog.hasCatalog).toBe(false);
    expect(await offImportDue(ctx.db)).toBe(true);
    expect((await c.get('/api/info')).json).toMatchObject({ offProducts: 0, offImportedAt: null });
  });

  it('imports the export and answers the search from it', async () => {
    const state = await importOffLines(ctx.db, dump(SKYR), 1_000_000);
    expect(state.rows).toBe(9);
    await ctx.deps.catalog.refreshCatalog();
    expect(ctx.deps.catalog.hasCatalog).toBe(true);
    expect(await offImportDue(ctx.db)).toBe(false);
    expect(await offImportDue(ctx.db, Date.now() + 8 * 24 * 60 * 60 * 1000)).toBe(true);
    expect((await c.get('/api/info')).json).toMatchObject({ offProducts: 9 });

    const r = await c.get('/api/foods/search?q=skyr');
    expect(r.json.limited).toBe(false);
    expect(r.json.foods).toHaveLength(6);
    expect(ctx.off.calls.filter((x) => x.startsWith('search:'))).toHaveLength(0);
  });

  it('finds a product by name and brand, however the brand is typed', async () => {
    for (const q of [
      'skyr gut und günstig',
      'gut & günstig skyr',
      'Skyr - Gut und Günstig',
      'skyr gut guenstig',
      'skyr gut u',
      'skyr gut&günstig',
    ])
      expect((await names(q))[0], q).toBe('SKYR Natur | GUT&GÜNSTIG');
    expect((await names('skyr milsani'))[0]).toBe('Skyr Natur | Milsani');
    expect((await names('ja skyr'))[0]).toBe('Skyr | ja!');
    // Only the brand: its products, whatever they are.
    expect((await names('gut und günstig')).sort()).toEqual(
      [
        'Gouda jung | Gut & Günstig',
        'SKYR Natur | GUT&GÜNSTIG',
        'Speisequark Magerstufe | Gut Gunstig',
      ].sort(),
    );
  });

  it('ranks the most scanned first and forgives typos', async () => {
    expect((await names('skyr natur'))[0]).toBe('Skyr Natur | Arla');
    expect((await names('skyr natru'))[0]).toBe('Skyr Natur | Arla');
    expect(await names('speisequrak')).toEqual(['Speisequark Magerstufe | Gut Gunstig']);
    expect(await names('xyzzy')).toEqual([]);
  });

  it('forgives typos in brands, also with swapped letters', async () => {
    expect(await names('milsni skyr')).toEqual(['Skyr Natur | Milsani']);
    expect(await names('skyr mislani')).toEqual(['Skyr Natur | Milsani']);
    expect(await names('mlibona')).toEqual(['Skyr natur | Milbona']);
    expect((await names('skyr gut und günstg'))[0]).toBe('SKYR Natur | GUT&GÜNSTIG');
    expect((await names('skyr gut u günstig'))[0]).toBe('SKYR Natur | GUT&GÜNSTIG');
    // Four letters and doubled letters.
    expect((await names('skyr alra'))[0]).toBe('Skyr Natur | Arla');
    expect(await names('millsanni')).toEqual(['Skyr Natur | Milsani']);
    // A word still being typed.
    expect(await names('speisequra')).toEqual(['Speisequark Magerstufe | Gut Gunstig']);
    // The device ranks the answer with the same rule.
    const r = await c.get(`/api/foods/search?q=${encodeURIComponent('milsni skyr')}`);
    expect(r.json.foods.map((f: { brand: string }) => f.brand)).toEqual(['Milsani']);
  });

  it('serves a catalog product by id and by barcode and keeps it in foods', async () => {
    const byId = await c.get('/api/foods/off:4311501657751');
    expect(byId.json.food).toMatchObject({ name: 'SKYR Natur', brand: 'GUT&GÜNSTIG', source: 'off' });
    const [kept] = await ctx.db.select().from(foods).where(eq(foods.id, 'off:4311501657751'));
    expect(kept?.name).toBe('SKYR Natur');
    const scan = await c.get('/api/foods/barcode/4061458016827');
    expect(scan.json.food).toMatchObject({ name: 'Skyr Natur', brand: 'Milsani' });
    expect(ctx.off.calls.filter((x) => x.startsWith('product:'))).toHaveLength(0);
    // A product in use is found once, not twice.
    expect((await names('skyr gut und günstig')).filter((n) => n.includes('GUT&GÜNSTIG'))).toHaveLength(1);
  });

  it('keeps the old rows when a run was cut off, and drops vanished products after a full one', async () => {
    await importOffLines(ctx.db, dump(SKYR.slice(0, 3)), 2_000_000);
    expect(await ctx.db.$count(offCatalog)).toBe(9);
    const renamed = SKYR.slice(1).map((r) => (r.code === '4388860619331' ? { ...r, name: 'Skyr Pur' } : r));
    const state = await importOffLines(ctx.db, dump(renamed), 3_000_000);
    expect(state.rows).toBe(8);
    expect((await offCatalogState(ctx.db))?.rows).toBe(8);
    const [changed] = await ctx.db.select().from(offCatalog).where(eq(offCatalog.code, '4388860619331'));
    expect(changed?.name).toBe('Skyr Pur');
    expect(await ctx.db.$count(offCatalog, eq(offCatalog.code, '4311501657751'))).toBe(0);
    await expect(importOffLines(ctx.db, dump([]), 4_000_000)).rejects.toThrow();
    await expect(
      importOffLines(
        ctx.db,
        (async function* () {
          yield 'not\tthe\texport';
        })(),
      ),
    ).rejects.toThrow('unexpected header');
  });
});

describe('live search until the catalog is imported', () => {
  let ctx: TestCtx;
  const product = (code: string, name: string, brands: string) =>
    normalizeOffProduct({ code, product_name: name, brands, nutriments: { 'energy-kcal_100g': 62 } })!;
  const answers: Record<string, ReturnType<typeof product>[]> = {
    // OFF wants every word in one field: name plus brand finds nothing.
    'skyr gut und günstig': [],
    günstig: [
      product('4311501000013', 'Gouda jung', 'Gut & Günstig'),
      product('4311501657751', 'Skyr Natur', 'Gut & Günstig'),
    ],
    skyr: [
      product('5760466996808', 'Skyr Natur', 'Arla'),
      product('4311501657751', 'Skyr Natur', 'gut-gunstig'),
    ],
  };

  beforeAll(async () => {
    ctx = await createTestContext({ off: { search: async (q) => answers[q] ?? [] } });
  });
  afterAll(() => ctx.close());

  it('asks for the single words when the whole query finds too little', async () => {
    const r = await ctx.deps.catalog.searchOff('skyr gut und günstig', 10);
    expect(ctx.off.calls).toEqual(['search:skyr gut und günstig', 'search:günstig', 'search:skyr']);
    // A brand that came as a tag does not replace the spelling already known.
    expect(r.foods.map((f) => `${f.name} | ${f.brand}`)).toEqual(['Skyr Natur | Gut & Günstig']);
    // Cached: no second round.
    await ctx.deps.catalog.searchOff('skyr gut und günstig', 10);
    expect(ctx.off.calls).toHaveLength(3);
  });

  it('caches an empty answer only briefly and keeps single words as they are', async () => {
    await ctx.deps.catalog.searchOff('skyr', 10);
    expect(ctx.off.calls.at(-1)).toBe('search:skyr');
    expect(ctx.off.calls).toHaveLength(4);
  });
});
