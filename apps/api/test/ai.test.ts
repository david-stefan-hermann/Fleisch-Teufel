import type { AiItem } from '@ft/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AiRefusalError, type AnalyzeInput, type FoodAnalyzer, type LabelInput } from '../src/ai/analyze.js';
import type { LabelReading } from '../src/ai/label.js';
import { matchItem } from '../src/ai/match.js';
import { costUsd } from '../src/ai/pricing.js';
import { createTestContext, registeredClient, TestClient, type TestCtx } from './helpers.js';

const item = (over: Partial<AiItem>): AiItem => ({
  name: 'x',
  grams: 100,
  confidence: 'medium',
  preparation: null,
  packaged: false,
  searchTerms: [],
  ...over,
});

let ctx: TestCtx;
let c: TestClient;
const received: AnalyzeInput[] = [];
const labels: LabelInput[] = [];
let refuse = false;

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
  async analyze(input) {
    received.push(input);
    if (refuse) throw new AiRefusalError('general_harms');
    return {
      dishName: 'Hähnchen mit Nudeln',
      items: [
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
  async readLabel(input) {
    labels.push(input);
    if (refuse) throw new AiRefusalError('general_harms');
    return {
      reading: nextLabel,
      model: 'claude-opus-5-5',
      usage: { inputTokens: 5000, outputTokens: 800, costUsd: 0.036 },
    };
  },
};

beforeAll(async () => {
  ctx = await createTestContext({ analyzer: fakeAnalyzer });
  c = await registeredClient(ctx);
});
afterAll(() => ctx.close());

function photo(type = 'image/jpeg', bytes = 1000) {
  const form = new FormData();
  form.set('image', new File([new Uint8Array(bytes)], 'meal.jpg', { type }));
  form.set('text', 'mit etwas Öl gebraten');
  return form;
}

describe('pricing', () => {
  it('computes cost from tokens', () => {
    expect(costUsd('claude-opus-5-5', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(24);
    expect(costUsd('claude-sonnet-5-5', { inputTokens: 3000, outputTokens: 1500 })).toBeCloseTo(0.021);
  });
});

describe('matching', () => {
  it('prefers the preparation-specific BLS food', () => {
    const r = matchItem(
      item({ preparation: 'gebraten', searchTerms: ['Hähnchen Brust gebraten', 'Hähnchen Brust'] }),
      (q, n) => ctx.deps.catalog.searchLocal(q, n),
    );
    expect(r[0]!.food.id).toBe('bls:V411180');
    expect(r.map((x) => x.food.id)).toContain('bls:V411100');
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
    expect(received.at(-1)).toMatchObject({ mediaType: 'image/jpeg', text: 'mit etwas Öl gebraten' });
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

describe('POST /api/ai/label', () => {
  const labelForm = (n: number, type = 'image/jpeg') => {
    const form = new FormData();
    for (let i = 0; i < n; i++)
      form.append('image', new File([new Uint8Array(500 + i)], `l${i}.jpg`, { type }));
    form.set('text', 'Riegel');
    return form;
  };

  it('reads 1 to 3 photos in one call and logs it as a label', async () => {
    nextLabel = proteinBar();
    const r = await c.req('POST', '/api/ai/label', labelForm(2));
    expect(r.status).toBe(200);
    expect(labels.at(-1)!.images.map((i) => i.mediaType)).toEqual(['image/jpeg', 'image/jpeg']);
    expect(labels.at(-1)!.text).toBe('Riegel');
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
