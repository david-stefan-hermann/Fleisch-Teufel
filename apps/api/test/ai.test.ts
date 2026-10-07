import type { AiItem } from '@ft/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AiRefusalError, type AnalyzeInput, type FoodAnalyzer } from '../src/ai/analyze.js';
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
let refuse = false;

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
