import { uuidv7, type AssistantContext, type FoodEntry } from '@ft/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AiCallError, AiOutputError } from '../src/ai/analyze.js';
import { transcriptionCostUsd } from '../src/ai/pricing.js';
import { sniffAudio } from '../src/assistant/transcribe.js';
import type { Assistant, AudioInput, ToolHost } from '../src/assistant/types.js';
import { aiAnalyses, assistantAudio, users } from '../src/db/schema.js';
import { cleanupAssistantAudio } from '../src/maintenance.js';
import { createTestContext, registeredClient, TestClient, type TestCtx } from './helpers.js';

/** A tool call the fake model makes; `from` takes an id out of an earlier tool result. */
type Call = { name: string; input: unknown | ((results: string[]) => unknown) };

let script: Call[] = [];
let reply: string | null = 'Erledigt.';
let understood: { prompt: string; results: string[] }[] = [];
let transcribed: AudioInput[] = [];
let nextError: unknown = null;

const fakeAssistant: Assistant = {
  canTranscribe: true,
  async transcribe(audio) {
    transcribed.push(audio);
    return {
      text: 'Ich habe Haferflocken gegessen.',
      model: 'gpt-transcribe',
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0.0005 },
    };
  },
  async understand(input, host: ToolHost) {
    const results: string[] = [];
    understood.push({ prompt: input.prompt, results });
    if (nextError) {
      const e = nextError;
      nextError = null;
      throw e;
    }
    for (const call of script) {
      const args = typeof call.input === 'function' ? call.input(results) : call.input;
      const out = await host.call(call.name, args);
      results.push(out.result);
      if (out.stop) return { reply: null, model: 'claude-haiku-5-5', usage: usage(), rounds: results.length };
    }
    return { reply, model: 'claude-haiku-5-5', usage: usage(), rounds: results.length + 1 };
  },
};
const usage = () => ({ inputTokens: 1000, outputTokens: 100, costUsd: 0.001 });

const TODAY = '2026-11-13';
const context = (over: Partial<AssistantContext> = {}): AssistantContext => ({
  now: `${TODAY}T20:15`,
  shownDate: TODAY,
  mealNames: ['Frühstück', 'Mittagessen', 'Abendessen', 'Snacks'],
  targets: { kcal: 2400, proteinG: 160 },
  days: [],
  recent: [],
  previousTarget: null,
  openQuestion: null,
  ...over,
});

const turn = (c: TestClient, fields: Record<string, string | Blob>) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  if (!fields.context) form.set('context', JSON.stringify(context()));
  if (!fields.requestId) form.set('requestId', uuidv7());
  return c.req('POST', '/api/assistant/turn', form);
};

/** A minimal WAV header: enough for the format check, the fake transcribes anything. */
const wav = (size = 64) => {
  const b = new Uint8Array(size);
  b.set(new TextEncoder().encode('RIFF'), 0);
  b.set(new TextEncoder().encode('WAVE'), 8);
  return new Blob([b], { type: 'audio/wav' });
};

const entry = (over: Partial<FoodEntry> = {}): FoodEntry => ({
  id: uuidv7(),
  updatedAt: 1000,
  deleted: false,
  date: '2026-11-01',
  meal: 0,
  loggedAt: 1000,
  foodId: 'bls:C133000',
  source: 'bls',
  name: 'Hafer Flocken',
  brand: null,
  grams: 50,
  portionLabel: '100 g',
  portionGrams: 100,
  quantity: 0.5,
  per100: { ENERCC: 348 },
  nutrients: { ENERCC: 174, PROT625: 6.6 },
  mealId: null,
  aiAnalysisId: null,
  groupId: null,
  groupName: null,
  photoId: null,
  photoIds: null,
  note: null,
  ...over,
});

let ctx: TestCtx;
let alice: TestClient;

beforeAll(async () => {
  ctx = await createTestContext({ assistant: fakeAssistant, env: { ALLOW_REGISTRATION: 'true' } });
  alice = await registeredClient(ctx);
});
afterAll(() => ctx.close());
beforeEach(() => {
  script = [];
  reply = 'Erledigt.';
  understood = [];
  transcribed = [];
  nextError = null;
});

describe('assistant', () => {
  it('answers 503 without an assistant and reports it in the server info', async () => {
    const off = await createTestContext({ env: { ALLOW_REGISTRATION: 'true' } });
    try {
      const u = await registeredClient(off);
      expect((await turn(u, { text: 'Banane' })).json).toEqual({ error: 'ai_disabled' });
      expect((await off.app.request('/api/info')).headers.get('content-type')).toContain('json');
    } finally {
      await off.close();
    }
    const info = await (await ctx.app.request('/api/info')).json();
    expect(info).toMatchObject({ assistantEnabled: true, voiceEnabled: true });
  });

  it('turns a typed sentence into operations with the searched food, never values of its own', async () => {
    script = [
      { name: 'search_foods', input: { query: 'Haferflocken' } },
      {
        name: 'log_food',
        input: (r: string[]) => ({
          date: TODAY,
          items: [{ foodId: /id=(\S+)/.exec(r[0]!)![1], grams: 80, guessed: true }],
        }),
      },
    ];
    const r = await turn(alice, { text: 'Ich habe Haferflocken gegessen.' });
    expect(r.status).toBe(200);
    expect(understood[0]!.prompt).toContain(
      'Transcript of the new utterance:\nIch habe Haferflocken gegessen.',
    );
    expect(understood[0]!.results[0]).toContain('Hafer Flocken');
    expect(r.json.ops).toEqual([
      {
        kind: 'logFood',
        date: TODAY,
        meal: null,
        items: [expect.objectContaining({ grams: 80, guessed: true, portion: null })],
        groupName: null,
      },
    ]);
    expect(r.json.ops[0].items[0].food).toMatchObject({ id: 'bls:C133000', nutrients: { ENERCC: 348 } });
    expect(r.json).toMatchObject({
      transcript: 'Ich habe Haferflocken gegessen.',
      question: null,
      reply: 'Erledigt.',
    });
  });

  it('refuses food ids the search did not return and entry ids the device did not send', async () => {
    script = [
      { name: 'log_food', input: { date: TODAY, items: [{ foodId: 'bls:C133000', grams: 50 }] } },
      { name: 'delete_entries', input: { entryIds: ['e1'] } },
      { name: 'set_weight', input: { date: '2027-01-01', kg: 80 } },
      { name: 'log_quick', input: { date: TODAY, meal: 'Brunch', kcal: 100 } },
    ];
    const r = await turn(alice, { text: 'Lösch das.' });
    expect(r.json.ops).toEqual([]);
    expect(understood[0]!.results).toEqual([
      expect.stringContaining('unknown foodId'),
      expect.stringContaining('unknown entry id'),
      expect.stringContaining('future'),
      expect.stringContaining('unknown meal'),
    ]);
  });

  it('maps short entry ids from the context back to the real ones', async () => {
    const id = uuidv7();
    script = [
      { name: 'update_entry', input: { entryId: 'e1', grams: 750 } },
      { name: 'move_entries', input: { entryIds: ['e1'], toDate: TODAY, toMeal: 'Mittagessen' } },
    ];
    const r = await turn(alice, {
      text: 'Das waren 750 Gramm.',
      context: JSON.stringify(
        context({
          days: [
            {
              date: TODAY,
              entries: [
                { id, meal: 0, name: 'Magerquark', grams: 500, kcal: 335, proteinG: 60, group: null },
              ],
              trainings: [],
              weightKg: null,
            },
          ],
        }),
      ),
    });
    expect(understood[0]!.prompt).toContain('e1: Magerquark, 500 g, 335 kcal');
    expect(r.json.ops).toEqual([
      { kind: 'updateEntry', entryId: id, grams: 750 },
      { kind: 'moveEntries', entryIds: [id], toDate: TODAY, toMeal: 1 },
    ]);
  });

  it('reads other days without tombstones and without other people', async () => {
    const bob = await registeredClient(ctx, 'bob@example.com');
    const live = entry({ name: 'Rührei' });
    const gone = entry({ name: 'Weggeworfen', deleted: true });
    await alice.post('/api/sync/push', {
      records: [
        { table: 'foodEntries', data: live },
        { table: 'foodEntries', data: gone },
      ],
    });
    await bob.post('/api/sync/push', {
      records: [{ table: 'foodEntries', data: entry({ name: 'Bobs Brot' }) }],
    });
    script = [
      { name: 'get_day', input: { date: '2026-11-01' } },
      { name: 'delete_entries', input: (r: string[]) => ({ entryIds: [/(e\d+): Rührei/.exec(r[0]!)![1]] }) },
      { name: 'get_day', input: { date: TODAY } },
    ];
    const r = await turn(alice, { text: 'Lösch das Rührei vom 1.' });
    const day = understood[0]!.results[0]!;
    expect(day).toContain('Rührei');
    expect(day).not.toContain('Weggeworfen');
    expect(day).not.toContain('Bobs Brot');
    expect(r.json.ops).toEqual([{ kind: 'deleteEntries', entryIds: [live.id] }]);
    expect(understood[0]!.results[2]).toContain('in the prompt');
  });

  it('ends the turn with a question and drops a repeated one', async () => {
    script = [
      {
        name: 'ask',
        input: { question: 'Salatgurken oder Gewürzgurken?', options: ['Salatgurken', 'Gewürzgurken'] },
      },
      { name: 'set_weight', input: { date: TODAY, kg: 80 } },
    ];
    const asked = await turn(alice, { text: 'Drei Gurken.' });
    expect(asked.json).toMatchObject({
      ops: [],
      question: { text: 'Salatgurken oder Gewürzgurken?', options: ['Salatgurken', 'Gewürzgurken'] },
      reply: null,
    });
    const answered = await turn(alice, {
      text: 'Gewürzgurken.',
      context: JSON.stringify(context({ openQuestion: asked.json.question })),
    });
    expect(understood[1]!.results[0]).toBe('already answered by this utterance');
    expect(answered.json).toMatchObject({ question: null, ops: [{ kind: 'setWeight', kg: 80 }] });
  });

  it('answers a repeated request id with the stored answer, without a second model call', async () => {
    const requestId = uuidv7();
    script = [{ name: 'set_weight', input: { date: TODAY, kg: 79.9 } }];
    const first = await turn(alice, { text: 'Ich wiege 79,9.', requestId });
    const again = await turn(alice, { text: 'Ich wiege 79,9.', requestId });
    expect(again.json).toEqual(first.json);
    expect(understood).toHaveLength(1);
  });

  it('transcribes a recording once, keeps it and lists it in the history', async () => {
    const requestId = uuidv7();
    const form = new FormData();
    form.set('audio', wav());
    form.set('requestId', requestId);
    const t = await alice.req('POST', '/api/assistant/transcribe', form);
    expect(t.json).toEqual({ text: 'Ich habe Haferflocken gegessen.' });
    // The edited text goes to /turn with the same key: no second transcription.
    const r = await turn(alice, { text: 'Ich habe 80 g Haferflocken gegessen.', requestId });
    expect(r.json.transcript).toBe('Ich habe 80 g Haferflocken gegessen.');
    const spoken = await turn(alice, { audio: wav() });
    expect(spoken.json.transcript).toBe('Ich habe Haferflocken gegessen.');
    expect(transcribed).toHaveLength(2);

    const list = await alice.get('/api/assistant/turns');
    const row = list.json.turns.find((x: { id: string }) => x.id === requestId);
    expect(row).toMatchObject({ source: 'voice', status: 'ok', hasAudio: true, outcome: null });
    const audio = await ctx.app.request(`/api/assistant/turns/${requestId}/audio`, {
      headers: { cookie: alice.cookie! },
    });
    expect(audio.headers.get('content-type')).toBe('audio/wav');
    expect(
      (await alice.req('PATCH', `/api/assistant/turns/${requestId}`, { outcome: 'undone' })).status,
    ).toBe(200);
    const after = await alice.get('/api/assistant/turns');
    expect(after.json.turns.find((x: { id: string }) => x.id === requestId).outcome).toBe('undone');
    const bob = await registeredClient(ctx, 'bob@example.com');
    expect((await bob.get(`/api/assistant/turns/${requestId}/audio`)).status).toBe(404);
    expect((await bob.req('PATCH', `/api/assistant/turns/${requestId}`, { outcome: 'undone' })).status).toBe(
      404,
    );
  });

  it('checks the recording: format from the bytes, size', async () => {
    const odd = await turn(alice, { audio: new Blob([new Uint8Array(64).fill(7)]) });
    expect(odd).toMatchObject({ status: 400, json: { error: 'unsupported_audio_type' } });
    const big = await turn(alice, { audio: wav(3 * 1024 * 1024 + 10) });
    expect(big).toMatchObject({ status: 413, json: { error: 'too_large' } });
    expect(transcribed).toHaveLength(0);
    const head = (s: string) => new Uint8Array([...new TextEncoder().encode(s), ...new Uint8Array(16)]);
    expect(sniffAudio(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...new Uint8Array(12)]))?.mime).toBe(
      'audio/webm',
    );
    expect(sniffAudio(head('\0\0\0\x1cftypM4A '))?.mime).toBe('audio/mp4');
    expect(sniffAudio(head('OggS'))?.mime).toBe('audio/ogg');
  });

  it('logs failed calls with their cost and shares the budget with the photo analysis', async () => {
    const b = await createTestContext({
      assistant: fakeAssistant,
      env: { ALLOW_REGISTRATION: 'true', AI_BUDGET_DAY_USD: '0.05' },
    });
    try {
      const u = await registeredClient(b);
      nextError = new AiCallError(
        new AiOutputError('timeout'),
        { inputTokens: 2000, outputTokens: 10, costUsd: 0.06 },
        'claude-haiku-5-5',
        2,
      );
      const failed = await turn(u, { text: 'Banane' });
      expect(failed).toMatchObject({ status: 504, json: { error: 'ai_timeout' } });
      const rows = await b.db.select().from(aiAnalyses);
      expect(rows).toEqual([expect.objectContaining({ status: 'failed', costUsd: 0.06 })]);
      const over = await turn(u, { text: 'Banane' });
      expect(over).toMatchObject({ status: 429, json: { error: 'ai_budget', scope: 'day' } });
      const form = new FormData();
      form.set('image', new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' }));
      expect((await u.req('POST', '/api/ai/analyze', form)).status).toBe(503); // no analyzer here
    } finally {
      await b.close();
    }
  });

  it('removes recordings after seven days and keeps the text', async () => {
    const [user] = await ctx.db.select({ id: users.id }).from(users).limit(1);
    const old = new Date(Date.now() - 8 * 86_400_000);
    await ctx.db.insert(assistantAudio).values({
      userId: user!.id,
      turnId: 'old-one',
      mime: 'audio/wav',
      bytes: 4,
      data: Buffer.from([1, 2, 3, 4]),
      createdAt: old,
    });
    const before = (await ctx.db.select().from(assistantAudio)).length;
    expect(await cleanupAssistantAudio(ctx.db)).toBe(1);
    expect((await ctx.db.select().from(assistantAudio)).length).toBe(before - 1);
  });

  it('keeps uploaded figure packs per account: size, number, owner', async () => {
    const zip = (n = 64) => {
      const b = new Uint8Array(n);
      b.set([0x50, 0x4b, 0x03, 0x04]);
      return b;
    };
    const put = (c: TestClient, id: string, body: Uint8Array, name = 'Elfenmagierin') =>
      ctx.app.request(`/api/assistant/skins/${id}?name=${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: { cookie: c.cookie!, 'content-type': 'application/zip' },
        body: new Blob([body as Uint8Array<ArrayBuffer>]),
      });
    const owner = await registeredClient(ctx, 'skins@example.com');
    expect((await put(owner, 'skin-0001', zip())).status).toBe(200);
    expect((await put(owner, 'skin-0002', new Uint8Array(64).fill(1))).status).toBe(415);
    expect((await put(owner, 'skin-0003', zip(3 * 1024 * 1024 + 1))).status).toBe(413);
    for (let i = 2; i <= 5; i++) expect((await put(owner, `skin-000${i}`, zip())).status).toBe(200);
    expect((await put(owner, 'skin-0006', zip())).status).toBe(409);
    // Uploading the same pack again is no new one.
    expect((await put(owner, 'skin-0001', zip())).status).toBe(200);
    const list = await owner.get('/api/assistant/skins');
    expect(list.json.skins).toHaveLength(5);
    expect(list.json.skins[0]).toMatchObject({ id: 'skin-0001', name: 'Elfenmagierin', bytes: 64 });
    const other = await registeredClient(ctx, 'other@example.com');
    expect((await other.get('/api/assistant/skins')).json.skins).toEqual([]);
    expect((await other.get('/api/assistant/skins/skin-0001')).status).toBe(404);
    const got = await ctx.app.request('/api/assistant/skins/skin-0001', {
      headers: { cookie: owner.cookie! },
    });
    expect(new Uint8Array(await got.arrayBuffer()).slice(0, 2)).toEqual(new Uint8Array([0x50, 0x4b]));
    expect((await owner.req('DELETE', '/api/assistant/skins/skin-0001')).status).toBe(200);
    expect((await owner.get('/api/assistant/skins')).json.skins).toHaveLength(4);
  });

  it('prices the transcription per audio minute', () => {
    expect(transcriptionCostUsd('gpt-transcribe', 60)).toBeCloseTo(0.0045);
    expect(transcriptionCostUsd('unknown', 60)).toBeCloseTo(0.006);
  });
});
