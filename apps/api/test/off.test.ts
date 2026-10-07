import { describe, expect, it } from 'vitest';
import { createOffClient, OffRateLimitedError } from '../src/off/client.js';
import { normalizeBarcode, normalizeOffProduct, offNutrients } from '../src/off/normalize.js';

const ritter = {
  code: '4000417025005',
  product_name: 'Ritter Sport Nugat',
  product_name_de: 'Nugat',
  brands: 'Ritter Sport, Alfred Ritter',
  quantity: '100 g',
  serving_size: '1 Stück (6,5 g)',
  serving_quantity: '6.5',
  product_quantity: 100,
  nutriments: {
    'energy-kcal_100g': 496,
    'energy-kj_100g': 2069,
    fat_100g: 27,
    'saturated-fat_100g': 10,
    carbohydrates_100g: 52,
    sugars_100g: 50,
    fiber_100g: 6.2,
    proteins_100g: 6.9,
    salt_100g: 0.25,
    sodium_100g: 0.1,
  },
};

describe('OFF normalization', () => {
  it('maps nutriments to BLS codes and units', () => {
    const f = normalizeOffProduct(ritter)!;
    expect(f).toMatchObject({
      id: 'off:4000417025005',
      source: 'off',
      name: 'Nugat',
      brand: 'Ritter Sport',
      unit: 'g',
    });
    expect(f.nutrients).toMatchObject({
      ENERCC: 496,
      ENERCJ: 2069,
      FAT: 27,
      FASAT: 10,
      CHO: 52,
      SUGAR: 50,
      FIBT: 6.2,
      PROT625: 6.9,
      NACL: 0.25,
      NA: 100,
    });
    expect(f.portions).toEqual([
      { label: 'Portion (1 Stück (6,5 g))', grams: 6.5 },
      { label: 'Packung (100 g)', grams: 100 },
    ]);
  });

  it('derives kcal from kJ-only energy and salt from sodium', () => {
    const n = offNutrients({ energy_100g: 418.4, sodium_100g: 0.4 });
    expect(n.ENERCC).toBeCloseTo(100);
    expect(n.NACL).toBe(1);
  });

  it('detects liquids and converts alcohol %vol to g/100 ml', () => {
    const f = normalizeOffProduct({
      code: '4100000000001',
      product_name: 'Pils',
      quantity: '0,5 l',
      nutriments: { 'energy-kcal_100g': 42, alcohol_100g: 4.9 },
    })!;
    expect(f.unit).toBe('ml');
    expect(f.nutrients.ALC).toBeCloseTo(3.87, 2);
  });

  it('drops products without name or energy', () => {
    expect(normalizeOffProduct({ code: '123456789', nutriments: { 'energy-kcal_100g': 1 } })).toBeNull();
    expect(normalizeOffProduct({ code: '123456789', product_name: 'x' })).toBeNull();
    expect(
      normalizeOffProduct({ code: 'abc', product_name: 'x', nutriments: { 'energy-kcal_100g': 1 } }),
    ).toBeNull();
  });

  it('normalizes barcodes (UPC-A → EAN-13)', () => {
    expect(normalizeBarcode('036000291452')).toBe('0036000291452');
    expect(normalizeBarcode(' 4000417-025005 ')).toBe('4000417025005');
    expect(normalizeBarcode('12')).toBeNull();
  });
});

describe('OFF client', () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('sends a descriptive User-Agent and parses products', async () => {
    const seen: { url: string; ua: string | null }[] = [];
    const client = createOffClient({
      baseUrl: 'https://off.test',
      searchUrl: 'https://search.test',
      userAgent: 'FleischTeufel/test (me@example.com)',
      fetch: async (url, init) => {
        seen.push({ url: String(url), ua: new Headers(init?.headers).get('user-agent') });
        return json({ status: 1, product: ritter });
      },
    });
    const f = await client.product('4000417025005');
    expect(f?.name).toBe('Nugat');
    expect(seen[0]!.url).toMatch(/^https:\/\/off\.test\/api\/v2\/product\/4000417025005\?fields=/);
    expect(seen[0]!.ua).toBe('FleischTeufel/test (me@example.com)');
  });

  it('returns null for unknown products', async () => {
    const client = createOffClient({
      baseUrl: 'https://off.test',
      searchUrl: 'https://s.test',
      userAgent: 'x',
      fetch: async () => json({ status: 0 }, 404),
    });
    expect(await client.product('1234567890123')).toBeNull();
  });

  it('falls back to the classic search when search-a-licious fails', async () => {
    const urls: string[] = [];
    const client = createOffClient({
      baseUrl: 'https://off.test',
      searchUrl: 'https://search.test',
      userAgent: 'x',
      fetch: async (url) => {
        urls.push(String(url));
        if (String(url).startsWith('https://search.test'))
          return new Response('<html>down</html>', { status: 503, headers: { 'content-type': 'text/html' } });
        return json({ products: [ritter] });
      },
    });
    const r = await client.search('nugat');
    expect(r.map((f) => f.id)).toEqual(['off:4000417025005']);
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain('/cgi/search.pl?search_terms=nugat');
  });

  it('enforces the OFF rate limit of 10 searches per minute', async () => {
    const client = createOffClient({
      baseUrl: 'https://o.test',
      searchUrl: 'https://s.test',
      userAgent: 'x',
      fetch: async () => json({ hits: [] }),
    });
    for (let i = 0; i < 10; i++) await client.search(`q${i}`);
    await expect(client.search('q11')).rejects.toBeInstanceOf(OffRateLimitedError);
  });
});
