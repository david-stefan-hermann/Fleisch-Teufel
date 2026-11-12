import { indexItem, MAX_ANALYSIS_PHOTOS, search, type AiItem } from '@ft/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AiCallError,
  AiOutputError,
  AiRefusalError,
  type AnalyzeInput,
  type FoodAnalyzer,
  type LabelInput,
} from '../src/ai/analyze.js';
import { budgetExceeded, DAY_MS } from '../src/ai/budget.js';
import type { LabelReading } from '../src/ai/label.js';
import { matchItem, type LocalSearch } from '../src/ai/match.js';
import { aiAnalyses, customFoods } from '../src/db/schema.js';
import { candidatesFor, estimatedFood } from '../src/routes/ai.js';
import { blsToFood, loadBls } from '../src/foods/catalog.js';
import { costUsd, knownModel } from '../src/ai/pricing.js';
import { userPrompt } from '../src/ai/prompt.js';
import { createTestContext, registeredClient, TestClient, type TestCtx } from './helpers.js';

const item = (over: Partial<AiItem>): AiItem => ({
  name: 'x',
  grams: 100,
  confidence: 'medium',
  preparation: null,
  packaged: false,
  searchTerms: [],
  foodId: null,
  alternatives: [],
  estimate: null,
  ...over,
});

let ctx: TestCtx;
let c: TestClient;
const received: AnalyzeInput[] = [];
const labels: LabelInput[] = [];
const labelSignals: (AbortSignal | undefined)[] = [];
let refuse = false;
/** Thrown by the next fake call (then cleared), e.g. an `AiCallError` with the usage spent so far. */
let nextError: unknown = null;
/** While set, the fake analysis waits for it (parallel requests with the same key). */
let gate: Promise<void> | null = null;
/** What the fake model searches for, and what it then answers (null: the default dish). */
let queries: string[] = [];
let nextItems: AiItem[] | null = null;
let searchResults: string[] = [];

const proteinBar = (over: Partial<LabelReading> = {}): LabelReading => ({
  name: 'Proteinriegel Schoko',
  brand: 'Bergkorn',
  barcode: '4006040123453',
  unit: 'g',
  basis: 'per100',
  servingGrams: 45,
  servingLabel: '1 Riegel',
  nutrients: {
    kcal: 389,
    kj: 1628,
    protein: 33,
    carbs: 36,
    sugar: 4.7,
    fat: 13.8,
    satFat: 7.6,
    fiber: null,
    salt: 0.4,
    sodium: null,
  },
  notes: 'Ballaststoffe nicht angegeben.',
  ...over,
});
let nextLabel: LabelReading = proteinBar();

const fakeAnalyzer: FoodAnalyzer = {
  async analyze(input, searchFoods) {
    received.push(input);
    if (refuse) throw new AiRefusalError('general_harms');
    if (gate) await gate;
    if (nextError) {
      const e = nextError;
      nextError = null;
      throw e;
    }
    searchResults = [];
    for (const q of queries) searchResults.push(await searchFoods(q));
    return {
      dishName: 'Hähnchen mit Nudeln',
      items: nextItems ?? [
        item({
          name: 'Hähnchenbrust',
          grams: 150,
          confidence: 'high',
          preparation: 'gebraten',
          searchTerms: ['Hähnchen Brust gebraten', 'Hähnchen Brust'],
        }),
        item({ name: 'Nudeln', grams: 200, searchTerms: ['Teigwaren gekocht', 'Nudeln'] }),
        item({ name: 'Bratöl', grams: 5, confidence: 'low', searchTerms: ['Rapsöl', 'Öl'] }),
      ],
      notes: 'Ölmenge geschätzt.',
      model: 'claude-opus-5-5',
      usage: {
        inputTokens: 3000,
        outputTokens: 1500,
        costUsd: costUsd('claude-opus-5-5', { inputTokens: 3000, outputTokens: 1500 }),
      },
    };
  },
  async readLabel(input, signal) {
    labels.push(input);
    labelSignals.push(signal);
    if (refuse) throw new AiRefusalError('general_harms');
    if (nextError) {
      const e = nextError;
      nextError = null;
      throw e;
    }
    return {
      reading: nextLabel,
      model: 'claude-opus-5-5',
      usage: { inputTokens: 5000, outputTokens: 800, costUsd: 0.036 },
    };
  },
};

beforeAll(async () => {
  ctx = await createTestContext({ analyzer: fakeAnalyzer, env: { ALLOW_REGISTRATION: 'true' } });
  c = await registeredClient(ctx);
});
afterAll(() => ctx.close());

/** A meal analysis request: `count` photos (field `image` repeated), the last one `lastBytes` large. */
/** A fake JPEG (the server reads the format from the bytes, so the file starts with the JPEG signature). */
function photo(type = 'image/jpeg', bytes = 1000, count = 1, lastBytes = bytes) {
  const form = new FormData();
  for (let i = 0; i < count; i++) {
    const data = new Uint8Array(i === count - 1 ? lastBytes : bytes);
    if (type === 'image/jpeg') data.set([0xff, 0xd8, 0xff, 0xe0]);
    form.append('image', new File([data], `meal-${i + 1}.jpg`, { type }));
  }
  form.set('text', 'mit etwas Öl gebraten');
  return form;
}

describe('pricing', () => {
  it('computes cost from tokens', () => {
    expect(costUsd('claude-opus-5-5', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(24);
    expect(costUsd('claude-sonnet-5-5', { inputTokens: 3000, outputTokens: 1500 })).toBeCloseTo(0.021);
    expect(costUsd('claude-haiku-4-5-20251001', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(6);
    expect(costUsd('claude-haiku-5-5', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(0.6);
  });

  it('prices cache reads and writes per model', () => {
    const cached = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 };
    expect(costUsd('claude-opus-5-5', cached)).toBeCloseTo(0.2);
    expect(costUsd('claude-fable-5-1', cached)).toBeCloseTo(0.25);
    expect(costUsd('claude-sonnet-5-5', cached)).toBeCloseTo(0.2);
    expect(
      costUsd('claude-opus-5-5', { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 1_000_000 }),
    ).toBeCloseTo(5);
  });

  it('recognizes a model by its id or a dated snapshot, not by a prefix', () => {
    expect(knownModel('claude-opus-5-5')).toBe('claude-opus-5-5');
    expect(knownModel('claude-opus-5-20260301')).toBe('claude-opus-5');
    expect(knownModel('claude-haiku-5-5')).toBe('claude-haiku-5-5');
    expect(knownModel('claude-opus-5-6')).toBeNull();
  });
});

/** Local search over the real BLS 4.0 file (the test context only has a small fixture). */
let realSearch: LocalSearch | null = null;
function realBlsSearch(): LocalSearch {
  if (!realSearch) {
    const index = loadBls().foods.map(blsToFood).map(indexItem);
    realSearch = (q, n) => search(index, q, n).map((h) => ({ food: h.item, score: h.score }));
  }
  return realSearch;
}

describe('matching', () => {
  it('prefers the preparation-specific BLS food', () => {
    const r = matchItem(
      item({ preparation: 'gebraten', searchTerms: ['Hähnchen Brust gebraten', 'Hähnchen Brust'] }),
      (q, n) => ctx.deps.catalog.searchLocal(q, n),
    );
    expect(r[0]!.food.id).toBe('bls:V411180');
    expect(r.map((x) => x.food.id)).toContain('bls:V411100');
  });

  it('never picks the instant powder for a prepared food (Köttbullar with mash and gravy)', () => {
    const search = realBlsSearch();
    const mash = matchItem(
      item({ name: 'Kartoffelpüree', grams: 200, searchTerms: ['Kartoffelpüree', 'Kartoffelbrei'] }),
      search,
    );
    // Before: "Kartoffelpüree Instantpulver" (329 kcal, 71 g carbs per 100 g) came first.
    expect(mash[0]!.food.name).not.toMatch(/pulver/i);
    expect(mash[0]!.food.name).toMatch(/^Kartoffelpüree/);
    expect(mash[0]!.food.nutrients.ENERCC).toBeLessThan(120);
    const gravy = matchItem(
      item({ name: 'Bratensoße', grams: 80, searchTerms: ['Bratensoße', 'Soße'] }),
      search,
    );
    expect(gravy[0]!.food.name).toMatch(/Bratensoße/);
    expect(gravy[0]!.food.name).not.toMatch(/Instantpulver$/);
    // The powder stays findable further down.
    expect(search('Bratensoße', 15).map((h) => h.food.name)).toContain('Bratensoße Instantpulver');
  });

  it('pushes down dry products unless the item is the dry product', () => {
    const food = (id: string, name: string) => ({
      id,
      source: 'bls' as const,
      sourceId: id,
      name,
      nameEn: null,
      brand: null,
      group: null,
      unit: 'g' as const,
      nutrients: {},
      portions: [],
    });
    const hits = [
      { food: food('p', 'Erbsensuppe Instantpulver'), score: 80 },
      { food: food('z', 'Erbsensuppe aus Instantpulver, zubereitet mit Wasser'), score: 70 },
      { food: food('k', 'Erbsensuppe Konserve'), score: 72 },
      { food: food('t', 'Linsen Trockenprodukt'), score: 60 },
    ];
    const search = () => hits;
    const soup = matchItem(item({ name: 'Erbsensuppe', searchTerms: ['Erbsensuppe'] }), search);
    // Prepared (with a small boost) and canned before the powder; dry lentils at the end.
    expect(soup.map((c) => c.food.id)).toEqual(['z', 'k', 'p', 't']);
    // Packaged items get no boost for "zubereitet".
    const packaged = matchItem(
      item({ name: 'Erbsensuppe', packaged: true, searchTerms: ['Erbsensuppe'] }),
      search,
    );
    expect(packaged.map((c) => c.food.id).slice(0, 2)).toEqual(['k', 'z']);
    // Asked for the powder itself: no penalty.
    const powder = matchItem(
      item({ name: 'Erbsensuppe Pulver', searchTerms: ['Erbsensuppe Instantpulver'] }),
      search,
    );
    expect(powder[0]!.food.id).toBe('p');
  });

  it('keeps protein powder and dry wine as they are', () => {
    const search = realBlsSearch();
    const wine = matchItem(item({ name: 'Weißwein', searchTerms: ['Weißwein trocken', 'Weißwein'] }), search);
    expect(wine[0]!.food.name).toMatch(/^Weißwein/);
    const milkPowder = matchItem(
      item({ name: 'Magermilchpulver', searchTerms: ['Magermilchpulver'] }),
      search,
    );
    expect(milkPowder[0]!.food.name).toBe('Magermilchpulver');
  });

  it('returns no candidates for unknown foods', () => {
    expect(
      matchItem(item({ name: 'Drachenfrucht-Sorbet', searchTerms: ['Drachenfrucht Sorbet'] }), (q, n) =>
        ctx.deps.catalog.searchLocal(q, n),
      ),
    ).toEqual([]);
  });
});

describe('POST /api/ai/analyze', () => {
  it('reports status', async () => {
    expect((await c.get('/api/ai/status')).json).toEqual({ enabled: true, model: 'claude-opus-5-5' });
  });

  it('analyzes a photo, matches candidates and logs usage', async () => {
    const r = await c.req('POST', '/api/ai/analyze', photo());
    expect(r.status).toBe(200);
    expect(received.at(-1)).toMatchObject({
      images: [{ mediaType: 'image/jpeg' }],
      text: 'mit etwas Öl gebraten',
    });
    expect(r.json.dishName).toBe('Hähnchen mit Nudeln');
    expect(r.json.items).toHaveLength(3);
    expect(r.json.items[0].candidates[0].food.id).toBe('bls:V411180');
    expect(r.json.items[1].candidates[0].food.id).toBe('bls:E411000');
    expect(r.json.items[2].candidates[0].food.id).toBe('bls:Q110000');
    expect(r.json.usage.costUsd).toBeCloseTo(0.042);
    const [row] = await ctx.db
      .$client`select model, input_tokens, output_tokens, user_text from ai_analyses where id = ${r.json.analysisId}`;
    expect(row).toMatchObject({
      model: 'claude-opus-5-5',
      input_tokens: 3000,
      output_tokens: 1500,
      user_text: 'mit etwas Öl gebraten',
    });
  });

  it('takes the foods the model chose from its searches', async () => {
    queries = ['Hähnchen Brust'];
    nextItems = [
      // The raw one on purpose: the term matching would put the fried one first.
      item({
        name: 'Hähnchenbrust',
        preparation: 'gebraten',
        searchTerms: ['Hähnchen Brust gebraten'],
        foodId: 'bls:V411100',
        alternatives: ['bls:V411180', 'bls:NOPE', 'bls:V411100'],
      }),
      // An id no search returned is not trusted: back to the term matching.
      item({ name: 'Nudeln', searchTerms: ['Teigwaren gekocht'], foodId: 'bls:E411000' }),
    ];
    const r = await c.req('POST', '/api/ai/analyze', photo());
    queries = [];
    nextItems = null;
    expect(searchResults[0]).toContain(
      'id=bls:V411100 | Hähnchen Brust, ohne Haut, roh | BLS | 102 kcal/100 g',
    );
    expect(r.json.items[0].candidates.map((x: { food: { id: string } }) => x.food.id)).toEqual([
      'bls:V411100',
      'bls:V411180',
    ]);
    expect(r.json.items[1].candidates[0].food.id).toBe('bls:E411000');
  });

  it('turns an estimate into a marked food when nothing was found', async () => {
    queries = ['Takoyaki'];
    nextItems = [
      item({
        name: 'Takoyaki',
        grams: 180,
        confidence: 'low',
        searchTerms: ['Takoyaki'],
        estimate: { kcal: 175, protein: 7, carbs: 22, sugar: 3, fat: 6, satFat: 1.2, fiber: 1, salt: 1.1 },
      }),
      item({ name: 'Drachenfrucht-Sorbet', searchTerms: ['Drachenfrucht Sorbet'] }),
    ];
    const r = await c.req('POST', '/api/ai/analyze', photo());
    queries = [];
    nextItems = null;
    expect(searchResults[0]).toBe('Keine Treffer für „Takoyaki“.');
    // Too few local hits: the search also asked Open Food Facts.
    expect(ctx.off.calls).toContain('search:Takoyaki');
    const [takoyaki, sorbet] = r.json.items;
    expect(takoyaki.candidates).toHaveLength(1);
    expect(takoyaki.candidates[0].food).toMatchObject({
      id: `est:${r.json.analysisId}:0`,
      name: 'Takoyaki',
      brand: 'KI-Schätzung',
      estimated: true,
      nutrients: { ENERCC: 175, PROT625: 7, CHO: 22, FAT: 6 },
    });
    expect(sorbet.candidates).toEqual([]);
  });

  it('corrects estimated kcal that do not fit the macros', () => {
    const est = (kcal: number) =>
      estimatedFood(
        item({ estimate: { kcal, protein: 10, carbs: 20, sugar: 30, fat: 5, satFat: 9, fiber: 0, salt: 0 } }),
        'est:x:0',
      )!;
    // 10 * 4 + 20 * 4 + 5 * 9 = 165
    expect(est(170).nutrients.ENERCC).toBe(170);
    expect(est(400).nutrients.ENERCC).toBe(165);
    // Sugar and saturated fat never exceed carbs and fat.
    expect(est(170).nutrients).toMatchObject({ SUGAR: 20, FASAT: 5 });
    expect(estimatedFood(item({}), 'est:x:0')).toBeNull();
    // Seen with a real photo: 250 g of broth estimated as pure fat.
    const oil = { kcal: 925, protein: 3, carbs: 3, sugar: 1, fat: 100, satFat: 15, fiber: 0, salt: 1 };
    expect(estimatedFood(item({ estimate: oil }), 'est:x:0')).toBeNull();
  });

  it('puts the estimate before alternatives when the model chose no food', () => {
    const dry = { ...blsToFood(loadBls().foods[0]!), id: 'off:dry' };
    const seen = new Map([[dry.id, dry]]);
    const estimate = { kcal: 150, protein: 0, carbs: 37, sugar: 12, fat: 0, satFat: 0, fiber: 0.5, salt: 0 };
    const ids = (over: Partial<AiItem>) =>
      candidatesFor(item({ name: 'Tapiokaperlen', ...over }), seen, 'est:x:1', () => []).map(
        (x) => x.food.id,
      );
    // Seen with a real photo: no food chosen, an estimate, and the dry product as a near miss.
    expect(ids({ estimate, alternatives: ['off:dry'] })).toEqual(['est:x:1', 'off:dry']);
    expect(ids({ estimate, foodId: 'off:dry', alternatives: ['off:dry'] })).toEqual(['off:dry']);
    expect(ids({ alternatives: ['off:dry', 'off:unknown'] })).toEqual(['off:dry']);
    expect(ids({ estimate, foodId: 'off:unknown' })).toEqual(['est:x:1']);
  });

  it('shows own foods and earlier choices in the search', async () => {
    const [user] = await ctx.db.$client`select id from users where email = 'a@example.com'`;
    await ctx.db.insert(customFoods).values({
      userId: user!.id,
      id: 'own-takoyaki',
      updatedAt: 1,
      name: 'Takoyaki vom Imbiss',
      brand: null,
      barcode: null,
      unit: 'g',
      nutrients: { ENERCC: 190, PROT625: 8, FAT: 7, CHO: 23 },
      portions: [],
    });
    queries = ['Takoyaki', 'Oktopusbällchen'];
    nextItems = [item({ name: 'Oktopusbällchen', foodId: 'own-takoyaki' })];
    let r = await c.req('POST', '/api/ai/analyze', photo());
    expect(searchResults[0]).toBe(
      'id=own-takoyaki | Takoyaki vom Imbiss | eigenes Lebensmittel | 190 kcal/100 g | E 8 F 7 KH 23',
    );
    expect(searchResults[1]).toBe('Keine Treffer für „Oktopusbällchen“.');
    expect(r.json.items[0].candidates[0].food).toMatchObject({ id: 'own-takoyaki', source: 'custom' });

    // The person picked the own food for "Oktopusbällchen" (twice) and oats once.
    const body = {
      analysisId: r.json.analysisId,
      choices: [
        { name: 'Oktopusbällchen', foodId: 'own-takoyaki' },
        { name: ' oktopusbällchen ', foodId: 'own-takoyaki' },
        { name: 'Oktopusbällchen', foodId: 'est:abc:0' },
      ],
    };
    expect((await c.post('/api/ai/choices', body)).json).toEqual({ ok: true, saved: 1 });
    expect((await c.post('/api/ai/choices', body)).status).toBe(200);
    const rows = await ctx.db.$client`select term, food_id, count from ai_food_choices`;
    expect(rows).toEqual([{ term: 'oktopusbaellchen', food_id: 'own-takoyaki', count: 2 }]);

    queries = ['Oktopusbällchen frittiert'];
    r = await c.req('POST', '/api/ai/analyze', photo());
    queries = [];
    nextItems = null;
    expect(searchResults[0]).toBe(
      'id=own-takoyaki | Takoyaki vom Imbiss | eigenes Lebensmittel | 190 kcal/100 g | E 8 F 7 KH 23 | früher gewählt',
    );
    expect(r.json.items[0].candidates[0].food.id).toBe('own-takoyaki');
  });

  it('ignores choices for foods that do not exist', async () => {
    const r = await c.req('POST', '/api/ai/analyze', photo());
    const body = {
      analysisId: r.json.analysisId,
      choices: [
        { name: 'Nudeln', foodId: 'bls:NOPE000' },
        { name: 'Nudeln', foodId: 'not-my-food' },
        { name: 'Nudeln', foodId: 'own-takoyaki' },
      ],
    };
    expect((await c.post('/api/ai/choices', body)).json).toEqual({ ok: true, saved: 1 });
  });

  it('accepts choices only for own analyses', async () => {
    const other = await registeredClient(ctx, 'b@example.com');
    const r = await c.req('POST', '/api/ai/analyze', photo());
    const body = { analysisId: r.json.analysisId, choices: [{ name: 'Nudeln', foodId: 'bls:E411000' }] };
    expect((await other.post('/api/ai/choices', body)).status).toBe(404);
    expect((await c.post('/api/ai/choices', { ...body, analysisId: 'x' })).status).toBe(400);
    expect((await c.post('/api/ai/choices', { ...body, choices: [] })).status).toBe(400);
    expect((await new TestClient(ctx.app).post('/api/ai/choices', body)).status).toBe(401);
  });

  it('returns the hint of an own analysis', async () => {
    const other = await registeredClient(ctx, 'c@example.com');
    const r = await c.req('POST', '/api/ai/analyze', photo());
    const path = `/api/ai/analyses/${r.json.analysisId}/hint`;
    expect((await c.get(path)).json).toEqual({ text: 'mit etwas Öl gebraten' });
    expect((await other.get(path)).status).toBe(404);
    expect((await c.get('/api/ai/analyses/x/hint')).status).toBe(404);
  });

  it('analyzes several photos of one meal in one call and keeps their number', async () => {
    const r = await c.req('POST', '/api/ai/analyze', photo('image/jpeg', 1000, 3));
    expect(r.status).toBe(200);
    expect(received.at(-1)!.images.map((i) => i.mediaType)).toEqual([
      'image/jpeg',
      'image/jpeg',
      'image/jpeg',
    ]);
    const [row] = await ctx.db.$client`select result from ai_analyses where id = ${r.json.analysisId}`;
    expect(row!.result.photos).toBe(3);
  });

  it('analyzes a meal described in words, without any photo', async () => {
    const form = new FormData();
    form.set('text', 'Döner mit allem, kleine Pommes, Cola 0,33 l');
    const r = await c.req('POST', '/api/ai/analyze', form);
    expect(r.status).toBe(200);
    expect(received.at(-1)).toEqual({ images: [], text: 'Döner mit allem, kleine Pommes, Cola 0,33 l' });
    const [row] = await ctx.db
      .$client`select result, user_text from ai_analyses where id = ${r.json.analysisId}`;
    expect(row!.result.photos).toBe(0);
    expect(row!.user_text).toBe('Döner mit allem, kleine Pommes, Cola 0,33 l');
    // Neither a photo nor a description is nothing to analyse.
    const blank = new FormData();
    blank.set('text', '   ');
    expect((await c.req('POST', '/api/ai/analyze', blank)).status).toBe(400);
  });

  it('passes typed calories and macros on as a clue and ignores what is unusable', async () => {
    const send = async (typed: string) => {
      const form = new FormData();
      form.set('text', 'Nudeln mit Pesto');
      form.set('typed', typed);
      const r = await c.req('POST', '/api/ai/analyze', form);
      expect(r.status).toBe(200);
      return received.at(-1);
    };
    expect(await send(JSON.stringify({ kcal: 600, proteinG: 40, carbsG: 0, fatG: -3 }))).toEqual({
      images: [],
      text: 'Nudeln mit Pesto',
      typed: { kcal: 600, proteinG: 40 },
    });
    // Nothing usable: analysed like a plain description.
    for (const junk of ['{"kcal":"viel"}', 'kein json', '{}', JSON.stringify({ kcal: 999_999 })])
      expect(await send(junk)).toEqual({ images: [], text: 'Nudeln mit Pesto' });
  });

  it('puts the typed values into the prompt as a clue for the amounts', () => {
    expect(userPrompt('Nudeln mit Pesto', 0, { kcal: 600, proteinG: 40.25 })).toBe(
      'Kein Foto. Beschreibung der Mahlzeit durch die Person: """Nudeln mit Pesto"""\n\n' +
        'Angabe der Person zur ganzen Mahlzeit: etwa 600 kcal, 40,3 g Protein. ' +
        'Nimm sie als Anhaltspunkt für die Mengen.\n\nAnalysiere die beschriebene Mahlzeit.',
    );
    expect(userPrompt('halbe Portion', 1, { fatG: 20 })).toContain(
      'Angabe der Person zur ganzen Mahlzeit: etwa 20 g Fett.',
    );
    // Without values the prompt is what it was.
    expect(userPrompt('Nudeln', 0, null)).toBe(userPrompt('Nudeln', 0));
    expect(userPrompt(null, 2, {})).toBe('Analysiere die 2 Fotos zusammen als eine Mahlzeit.');
  });

  it('refuses more photos than one analysis takes, and an oversized one among them', async () => {
    const calls = received.length;
    const tooMany = await c.req(
      'POST',
      '/api/ai/analyze',
      photo('image/jpeg', 1000, MAX_ANALYSIS_PHOTOS + 1),
    );
    expect(tooMany.status).toBe(400);
    expect(tooMany.json).toEqual({ error: 'too_many_images' });
    const big = await c.req('POST', '/api/ai/analyze', photo('image/jpeg', 1000, 2, 5 * 1024 * 1024 + 1));
    expect(big.status).toBe(413);
    expect(received.length).toBe(calls);
  });

  it('validates the upload', async () => {
    expect((await c.req('POST', '/api/ai/analyze', photo('image/heic'))).status).toBe(415);
    expect((await c.req('POST', '/api/ai/analyze', new FormData())).status).toBe(400);
    expect((await c.post('/api/ai/analyze', { image: 'x' })).status).toBe(400);
    expect((await new TestClient(ctx.app).req('POST', '/api/ai/analyze', photo())).status).toBe(401);
  });

  it('maps refusals to 422', async () => {
    refuse = true;
    const r = await c.req('POST', '/api/ai/analyze', photo());
    refuse = false;
    expect(r.status).toBe(422);
    expect(r.json).toEqual({ error: 'refused', category: 'general_harms' });
    const [row] = await ctx.db
      .$client`select status, error, cost_usd from ai_analyses order by created_at desc limit 1`;
    expect(row).toMatchObject({ status: 'failed', error: 'refused', cost_usd: 0 });
  });

  it('logs a failed analysis with what its rounds cost', async () => {
    nextError = new AiCallError(
      new AiOutputError('timeout'),
      { inputTokens: 2000, outputTokens: 10, costUsd: 0.02 },
      'claude-opus-5-5',
      3,
    );
    const r = await c.req('POST', '/api/ai/analyze', photo());
    expect(r.status).toBe(504);
    expect(r.json).toEqual({ error: 'ai_timeout' });
    const [row] = await ctx.db.$client`
      select status, error, cost_usd, input_tokens, result from ai_analyses order by created_at desc limit 1`;
    expect(row).toMatchObject({ status: 'failed', error: 'ai_timeout', cost_usd: 0.02, input_tokens: 2000 });
    expect(row!.result).toMatchObject({ photos: 1, failed: 'ai_timeout' });

    nextError = new AiCallError(
      new AiRefusalError('cyber'),
      { inputTokens: 900, outputTokens: 5, costUsd: 0.004 },
      'claude-opus-5-5',
      1,
    );
    const refused = await c.req('POST', '/api/ai/analyze', photo());
    expect(refused.json).toEqual({ error: 'refused', category: 'cyber' });
  });

  it('is disabled without an analyzer', async () => {
    const off = await createTestContext();
    try {
      const u = await registeredClient(off);
      expect((await u.get('/api/ai/status')).json.enabled).toBe(false);
      expect((await u.req('POST', '/api/ai/analyze', photo())).status).toBe(503);
    } finally {
      await off.close();
    }
  });
});

describe('idempotent analyses (requestId)', () => {
  const keyed = (requestId: string) => {
    const form = photo();
    form.set('requestId', requestId);
    return form;
  };

  it('answers a repeated request from the stored result without calling Claude again', async () => {
    const calls = received.length;
    const first = await c.req('POST', '/api/ai/analyze', keyed('r1'));
    expect(first.status).toBe(200);
    const again = await c.req('POST', '/api/ai/analyze', keyed('r1'));
    expect(again.status).toBe(200);
    expect(again.json).toEqual(first.json);
    expect(received).toHaveLength(calls + 1);
    const [row] = await ctx.db
      .$client`select request_id, response from ai_analyses where id = ${first.json.analysisId}`;
    expect(row!.request_id).toBe('r1');
    expect(row!.response.items[0].candidates.length).toBeGreaterThan(0);
  });

  it('analyzes again after a failed first attempt', async () => {
    nextError = new AiCallError(
      new AiOutputError('no response'),
      { inputTokens: 1, outputTokens: 1, costUsd: 0.001 },
      null,
      1,
    );
    const calls = received.length;
    expect((await c.req('POST', '/api/ai/analyze', keyed('r2'))).status).toBe(502);
    const r = await c.req('POST', '/api/ai/analyze', keyed('r2'));
    expect(r.status).toBe(200);
    expect(received).toHaveLength(calls + 2);
  });

  it('keeps keys apart per account, and requests without a key as before', async () => {
    const other = await registeredClient(ctx, 'other@example.com');
    const calls = received.length;
    const mine = await c.req('POST', '/api/ai/analyze', keyed('r1'));
    const theirs = await other.req('POST', '/api/ai/analyze', keyed('r1'));
    expect(theirs.status).toBe(200);
    expect(theirs.json.analysisId).not.toBe(mine.json.analysisId);
    expect((await c.req('POST', '/api/ai/analyze', photo())).status).toBe(200);
    expect((await c.req('POST', '/api/ai/analyze', photo())).status).toBe(200);
    expect(received).toHaveLength(calls + 3);
  });

  it('lets a parallel request with the same key wait for the running analysis', async () => {
    let open!: () => void;
    gate = new Promise((resolve) => (open = resolve));
    const calls = received.length;
    const a = c.req('POST', '/api/ai/analyze', keyed('r3'));
    // The second request arrives while the first one is still with the model.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const b = c.req('POST', '/api/ai/analyze', keyed('r3'));
    await new Promise((resolve) => setTimeout(resolve, 100));
    gate = null;
    open();
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.status).toBe(200);
    expect(rb.json.analysisId).toBe(ra.json.analysisId);
    expect(received).toHaveLength(calls + 1);
  });
});

describe('AI budget', () => {
  it('answers 429 ai_budget once the day budget is used up, failed calls included', async () => {
    const b = await createTestContext({
      analyzer: fakeAnalyzer,
      env: { ALLOW_REGISTRATION: 'true', AI_BUDGET_DAY_USD: '0.04' },
    });
    try {
      const u = await registeredClient(b);
      nextError = new AiCallError(
        new AiOutputError('timeout'),
        { inputTokens: 2000, outputTokens: 10, costUsd: 0.02 },
        'claude-opus-5-5',
        2,
      );
      expect((await u.req('POST', '/api/ai/analyze', photo())).status).toBe(504);
      expect((await u.req('POST', '/api/ai/analyze', photo())).status).toBe(200);
      const calls = received.length;
      const labelCalls = labels.length;
      const over = await u.req('POST', '/api/ai/analyze', photo());
      expect(over.status).toBe(429);
      expect(over.json).toEqual({ error: 'ai_budget', scope: 'day' });
      const form = photo();
      form.set('text', 'Etikett');
      expect((await u.req('POST', '/api/ai/label', form)).json).toEqual({ error: 'ai_budget', scope: 'day' });
      expect(received).toHaveLength(calls);
      expect(labels).toHaveLength(labelCalls);
    } finally {
      await b.close();
    }
  });

  it('answers 429 with scope month for the 30-day budget, and 0 turns a limit off', async () => {
    const b = await createTestContext({
      analyzer: fakeAnalyzer,
      env: { ALLOW_REGISTRATION: 'true', AI_BUDGET_DAY_USD: '0', AI_BUDGET_MONTH_USD: '0.04' },
    });
    try {
      const u = await registeredClient(b);
      expect((await u.req('POST', '/api/ai/analyze', photo())).status).toBe(200);
      expect((await u.req('POST', '/api/ai/analyze', photo())).json).toEqual({
        error: 'ai_budget',
        scope: 'month',
      });
    } finally {
      await b.close();
    }
    const off = await createTestContext({
      analyzer: fakeAnalyzer,
      env: { ALLOW_REGISTRATION: 'true', AI_BUDGET_DAY_USD: '0', AI_BUDGET_MONTH_USD: '0' },
    });
    try {
      const u = await registeredClient(off);
      for (let i = 0; i < 3; i++) expect((await u.req('POST', '/api/ai/analyze', photo())).status).toBe(200);
    } finally {
      await off.close();
    }
  });

  it('sums rolling windows of 24 hours and 30 days', async () => {
    const userId = (await c.get('/api/auth/me')).json.user.id as string;
    const b = await createTestContext({ env: { ALLOW_REGISTRATION: 'true' } });
    try {
      const u = await registeredClient(b);
      const id = (await u.get('/api/auth/me')).json.user.id as string;
      const now = Date.now();
      const row = (ago: number, cost: number) => ({
        userId: id,
        createdAt: new Date(now - ago),
        model: 'claude-opus-5-5',
        inputTokens: 0,
        outputTokens: 0,
        costUsd: cost,
        durationMs: 0,
        result: {},
      });
      await b.db.insert(aiAnalyses).values([row(DAY_MS + 60_000, 3), row(60_000, 1), row(31 * DAY_MS, 100)]);
      expect(await budgetExceeded(b.db, id, { dayUsd: 1.5, monthUsd: 5 }, now)).toBeNull();
      expect(await budgetExceeded(b.db, id, { dayUsd: 1, monthUsd: 5 }, now)).toBe('day');
      expect(await budgetExceeded(b.db, id, { dayUsd: 0, monthUsd: 4 }, now)).toBe('month');
      expect(await budgetExceeded(b.db, userId, { dayUsd: 1, monthUsd: 4 }, now)).toBeNull();
    } finally {
      await b.close();
    }
  });
});

describe('POST /api/ai/label', () => {
  const labelForm = (n: number, type = 'image/jpeg') => {
    const form = new FormData();
    for (let i = 0; i < n; i++) {
      const data = new Uint8Array(500 + i);
      if (type === 'image/jpeg') data.set([0xff, 0xd8, 0xff, 0xe0]);
      form.append('image', new File([data], `l${i}.jpg`, { type }));
    }
    form.set('text', 'Riegel');
    return form;
  };

  it('reads 1 to 3 photos in one call and logs it as a label', async () => {
    nextLabel = proteinBar();
    const r = await c.req('POST', '/api/ai/label', labelForm(2));
    expect(r.status).toBe(200);
    expect(labels.at(-1)!.images.map((i) => i.mediaType)).toEqual(['image/jpeg', 'image/jpeg']);
    expect(labels.at(-1)!.text).toBe('Riegel');
    // The label reading runs within the same time budget as the analysis.
    expect(labelSignals.at(-1)).toBeInstanceOf(AbortSignal);
    expect(r.json).toMatchObject({
      name: 'Proteinriegel Schoko',
      brand: 'Bergkorn',
      barcode: '4006040123453',
      basis: 'per100',
      unit: 'g',
      notes: 'Ballaststoffe nicht angegeben.',
    });
    expect(r.json.nutrients).toMatchObject({ kcal: 389, kj: 1628, fiber: null });
    const [row] = await ctx.db
      .$client`select result, input_tokens from ai_analyses where id = ${r.json.analysisId}`;
    expect(row!.input_tokens).toBe(5000);
    expect(row!.result).toMatchObject({ kind: 'label', photos: 2, barcode: '4006040123453' });
    const calls = labels.length;
    expect((await c.req('POST', '/api/ai/label', labelForm(3))).status).toBe(200);
    expect(labels).toHaveLength(calls + 1);
    expect(labels.at(-1)!.images).toHaveLength(3);
  });

  it('refuses a fourth photo, other files and missing photos without calling Claude', async () => {
    const calls = labels.length;
    expect((await c.req('POST', '/api/ai/label', labelForm(4))).json).toEqual({ error: 'too_many_images' });
    expect((await c.req('POST', '/api/ai/label', labelForm(0))).status).toBe(400);
    expect((await c.req('POST', '/api/ai/label', labelForm(1, 'image/heic'))).status).toBe(415);
    expect((await new TestClient(ctx.app).req('POST', '/api/ai/label', labelForm(1))).status).toBe(401);
    expect(labels).toHaveLength(calls);
  });

  it('keeps a barcode only with a valid check digit and drops impossible values', async () => {
    nextLabel = proteinBar({
      barcode: '4006040123456',
      servingGrams: -1,
      nutrients: { ...proteinBar().nutrients, sugar: -2, fat: Number.NaN },
    });
    let r = await c.req('POST', '/api/ai/label', labelForm(1));
    expect(r.json.barcode).toBeNull();
    expect(r.json.servingGrams).toBeNull();
    expect(r.json.nutrients).toMatchObject({ sugar: null, fat: null, kcal: 389 });
    nextLabel = proteinBar({ barcode: '4006040 12345 3' });
    r = await c.req('POST', '/api/ai/label', labelForm(1));
    expect(r.json.barcode).toBe('4006040123453');
  });

  it('answers 422 when nothing could be read, and maps refusals', async () => {
    const empty = Object.fromEntries(Object.keys(proteinBar().nutrients).map((k) => [k, null]));
    nextLabel = proteinBar({
      name: null,
      brand: null,
      nutrients: empty as LabelReading['nutrients'],
      notes: 'Kein Etikett.',
    });
    const r = await c.req('POST', '/api/ai/label', labelForm(1));
    expect(r.status).toBe(422);
    expect(r.json).toEqual({ error: 'no_label', notes: 'Kein Etikett.' });
    refuse = true;
    const refused = await c.req('POST', '/api/ai/label', labelForm(1));
    refuse = false;
    expect(refused.status).toBe(422);
    expect(refused.json.error).toBe('refused');
  });

  it('maps a label timeout to 504 and logs it', async () => {
    nextError = new AiCallError(
      new AiOutputError('timeout'),
      { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      null,
      1,
    );
    const r = await c.req('POST', '/api/ai/label', labelForm(1));
    expect(r.status).toBe(504);
    expect(r.json).toEqual({ error: 'ai_timeout' });
    const [row] = await ctx.db
      .$client`select status, error, model, result from ai_analyses order by created_at desc limit 1`;
    expect(row).toMatchObject({ status: 'failed', error: 'ai_timeout', model: 'claude-opus-5-5' });
    expect(row!.result).toMatchObject({ kind: 'label', failed: 'ai_timeout' });
  });

  it('is disabled without an analyzer', async () => {
    const off = await createTestContext();
    try {
      const u = await registeredClient(off);
      expect((await u.req('POST', '/api/ai/label', labelForm(1))).status).toBe(503);
    } finally {
      await off.close();
    }
  });
});
