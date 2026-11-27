import { assistantContextSchema, uuidv7, type FoodEntry } from '@ft/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { AiCallError, AiOutputError } from '../src/ai/analyze.js';
import { transcriptionCostUsd } from '../src/ai/pricing.js';
import { Aliases, ASSISTANT_SYSTEM, replyOf, utterancePrompt } from '../src/assistant/prompt.js';
import { assistantTools } from '../src/assistant/tools.js';
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

/** The context as a device sends it (older app versions leave out the newer keys). */
type Context = z.input<typeof assistantContextSchema>;

const TODAY = '2026-11-13';
const YESTERDAY = '2026-11-12';
const context = (over: Partial<Context> = {}): Context => ({
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
  diaryMealId: null,
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
        diaryMealId: null,
        mealName: null,
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

  it('checks dates against the day of the app and knows the entries of the shown day', async () => {
    const old = uuidv7();
    script = [
      // The clock says the 13th, the person's day is still the 12th: the 14th is two days ahead.
      { name: 'set_weight', input: { date: '2026-11-14', kg: 80 } },
      { name: 'set_weight', input: { date: TODAY, kg: 80 } },
      { name: 'get_day', input: { date: '2026-11-09' } },
      { name: 'update_entry', input: { entryId: 'e1', grams: 300 } },
    ];
    const r = await turn(alice, {
      text: 'Das waren 300 Gramm.',
      context: JSON.stringify(
        context({
          now: `${TODAY}T01:30`,
          today: YESTERDAY,
          shownDate: '2026-11-09',
          days: [
            {
              date: '2026-11-09',
              closed: true,
              entries: [
                { id: old, meal: 2, name: 'Lasagne', grams: 400, kcal: 600, proteinG: 30, group: null },
              ],
              trainings: [],
              weightKg: null,
            },
          ],
        }),
      ),
    });
    expect(understood[0]!.results[0]).toContain('future');
    expect(understood[0]!.results[2]).toBe('That day is in the prompt.');
    expect(understood[0]!.prompt).toContain('Diary of the shown day (2026-11-09):');
    expect(r.json.ops).toEqual([
      { kind: 'setWeight', date: TODAY, kg: 80 },
      { kind: 'updateEntry', entryId: old, grams: 300 },
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
    // An older app version: the four names are the meals, as before.
    expect(understood[0]!.prompt).toContain('Meals: Frühstück, Mittagessen, Abendessen, Snacks.\n');
    expect(understood[0]!.prompt).toContain('  Frühstück:\n    e1: Magerquark');
    expect(understood[0]!.prompt).toContain('  Mittagessen: (leer)');
    expect(r.json.ops).toEqual([
      { kind: 'updateEntry', entryId: id, grams: 750 },
      {
        kind: 'moveEntries',
        entryIds: [id],
        toDate: TODAY,
        toMeal: 1,
        toDiaryMealId: null,
        toMealName: null,
      },
    ]);
  });

  it('swaps the food of an entry keeping its amount, and deletes trainings by their ids', async () => {
    const milk = uuidv7();
    const quick = uuidv7();
    const run = uuidv7();
    const swap = (entryId: string, grams?: number) => (r: string[]) => ({
      entryId,
      foodId: /id=(\S+)/.exec(r[0]!)![1],
      ...(grams && { grams }),
    });
    script = [
      { name: 'search_foods', input: { query: 'Haferflocken' } },
      { name: 'replace_entry', input: swap('e1') },
      { name: 'replace_entry', input: swap('e2') },
      { name: 'replace_entry', input: swap('e2', 40) },
      { name: 'delete_trainings', input: { trainingIds: ['x1'] } },
    ];
    const r = await turn(alice, {
      text: 'Die Milch gegen Haferflocken tauschen.',
      context: JSON.stringify(
        context({
          days: [
            {
              date: TODAY,
              entries: [
                { id: milk, meal: 0, name: 'H-Milch', grams: 150, kcal: 96, proteinG: 5, group: null },
                { id: quick, meal: 0, name: 'Kuchen', grams: null, kcal: 300, proteinG: 4, group: null },
              ],
              trainings: [{ id: run, name: 'Laufen', minutes: 30, intensity: 'moderate' }],
              weightKg: null,
            },
          ],
        }),
      ),
    });
    expect(understood[0]!.prompt).toContain('x1: Laufen 30 Min.');
    expect(understood[0]!.results[2]).toContain('grams missing');
    expect(r.json.ops.map((o: { kind: string }) => o.kind)).toEqual([
      'replaceEntry',
      'replaceEntry',
      'deleteTrainings',
    ]);
    expect(r.json.ops[0]).toMatchObject({ entryId: milk, item: { grams: 150, food: { id: 'bls:C133000' } } });
    expect(r.json.ops[1]).toMatchObject({ entryId: quick, item: { grams: 40 } });
    expect(r.json.ops[2]).toEqual({ kind: 'deleteTrainings', entryIds: [run] });
  });

  it('opens the camera for photos that replace an entry; the entry stays until they are logged', async () => {
    const id = uuidv7();
    script = [
      { name: 'open_camera', input: { date: TODAY, meal: 'Frühstück', hint: '', replaceEntryIds: ['e1'] } },
    ];
    const r = await turn(alice, {
      text: 'Davon habe ich Fotos.',
      context: JSON.stringify(
        context({
          days: [
            {
              date: TODAY,
              entries: [{ id, meal: 0, name: 'Pizza', grams: 300, kcal: 800, proteinG: 30, group: null }],
              trainings: [],
              weightKg: null,
            },
          ],
        }),
      ),
    });
    expect(r.json.ops).toEqual([
      {
        kind: 'openCamera',
        date: TODAY,
        meal: 0,
        diaryMealId: null,
        mealName: null,
        hint: '',
        replaces: [id],
      },
    ]);
  });

  it('drops a reply that only says nothing was done', async () => {
    script = [];
    reply = 'Ich habe nichts eingetragen, weil die Äußerung kein Lebensmittel nennt.';
    expect((await turn(alice, { text: 'Hm.' })).json.reply).toBeNull();
    reply = 'Du hast heute noch nichts eingetragen.';
    expect((await turn(alice, { text: 'Was habe ich heute gegessen?' })).json.reply).toBe(reply);
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

  describe('with the meals of the day (newer app versions)', () => {
    const at = (date: string, h: number, m = 0) => ({
      date,
      time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
    });
    const breakfast = { id: uuidv7(), name: 'Frühstück', ...at(TODAY, 8, 10), night: false, slot: 0 };
    const snack1 = { id: uuidv7(), name: 'Snacks', ...at(TODAY, 10, 30), night: false, slot: 3 };
    const snack2 = { id: uuidv7(), name: 'Snacks', ...at(TODAY, 15, 30), night: false, slot: 3 };
    /** Yesterday is a day from before the meals: its first meal keeps the old name. */
    const oldBreakfast = {
      id: `dm:${YESTERDAY}:0`,
      name: 'Frühstück',
      ...at(YESTERDAY, 7, 50),
      night: false,
      slot: 0,
    };
    const quark = uuidv7();
    const nuts = uuidv7();
    const eggs = uuidv7();
    const strip = ({ date: _date, ...m }: typeof breakfast) => m;
    const withMeals = (over: Partial<Context> = {}) =>
      JSON.stringify(
        context({
          // The standard names were renamed; old days keep theirs.
          mealNames: ['Morgens', 'Mittagessen', 'Abendessen', 'Snacks'],
          days: [
            {
              date: TODAY,
              meals: [breakfast, snack1, snack2].map(strip),
              entries: [
                {
                  id: quark,
                  meal: 0,
                  name: 'Magerquark',
                  grams: 250,
                  kcal: 168,
                  proteinG: 30,
                  group: null,
                  diaryMealId: breakfast.id,
                },
                {
                  id: nuts,
                  meal: 3,
                  name: 'Nüsse',
                  grams: 30,
                  kcal: 190,
                  proteinG: 6,
                  group: null,
                  diaryMealId: snack2.id,
                },
              ],
              trainings: [],
              weightKg: null,
            },
            {
              date: YESTERDAY,
              meals: [strip(oldBreakfast)],
              entries: [
                {
                  id: eggs,
                  meal: 0,
                  name: 'Rührei',
                  grams: 150,
                  kcal: 220,
                  proteinG: 18,
                  group: null,
                  diaryMealId: oldBreakfast.id,
                },
              ],
              trainings: [],
              weightKg: null,
            },
          ],
          ...over,
        }),
      );

    it('lists the meals with ids and times, the entries in them, old days with their old names', async () => {
      script = [];
      await turn(alice, { text: 'Was habe ich gegessen?', context: withMeals() });
      const prompt = understood[0]!.prompt;
      expect(prompt).toContain('Usual meal names: Morgens, Mittagessen, Abendessen, Snacks.\n');
      expect(prompt).toContain('  m1 Frühstück (08:10):\n    e1: Magerquark, 250 g');
      expect(prompt).toContain('  m2 Snacks (10:30): (leer)\n  m3 Snacks (15:30):\n    e2: Nüsse');
      expect(prompt).toContain(`Diary yesterday (${YESTERDAY}):\n  m4 Frühstück (07:50):\n    e3: Rührei`);
      expect(prompt).not.toContain('Morgens:');
      // The tools name no meal: the list is the same for everyone and stays cached.
      expect(JSON.stringify(assistantTools())).not.toContain('Frühstück');
    });

    it('logs into a meal by id or name, starts a named meal the day lacks, leaves the rest to the device', async () => {
      script = [
        { name: 'log_quick', input: { date: TODAY, meal: 'm1', kcal: 100 } },
        { name: 'log_quick', input: { date: TODAY, meal: 'frühstück', kcal: 110 } },
        { name: 'log_quick', input: { date: TODAY, meal: 'Kuchen bei Oma', kcal: 400 } },
        { name: 'log_quick', input: { date: TODAY, meal: 'Mittagessen', kcal: 500 } },
        { name: 'log_quick', input: { date: YESTERDAY, meal: 'Frühstück', kcal: 120 } },
        { name: 'log_quick', input: { date: TODAY, kcal: 130 } },
      ];
      const r = await turn(alice, { text: 'Kuchen bei Oma.', context: withMeals() });
      const meals = r.json.ops.map((o: Record<string, unknown>) => [o.meal, o.diaryMealId, o.mealName]);
      expect(meals).toEqual([
        [0, breakfast.id, 'Frühstück'],
        [0, breakfast.id, 'Frühstück'],
        // Not a standard name: the first free index.
        [1, null, 'Kuchen bei Oma'],
        // A standard name the day does not have yet is a new meal too, with its own index.
        [1, null, 'Mittagessen'],
        [0, oldBreakfast.id, 'Frühstück'],
        [null, null, null],
      ]);
    });

    it('tells two meals of one name apart by their ids', async () => {
      script = [
        { name: 'log_quick', input: { date: TODAY, meal: 'Snacks', kcal: 100 } },
        { name: 'log_quick', input: { date: TODAY, meal: 'm3', kcal: 100 } },
        { name: 'move_entries', input: { entryIds: ['e1'], toDate: TODAY, toMeal: 'm2' } },
        { name: 'copy_entries', input: { entryIds: ['e3'], toDate: TODAY, toMeal: 'm4' } },
        { name: 'log_quick', input: { date: TODAY, meal: 'm9', kcal: 100 } },
      ];
      const r = await turn(alice, { text: 'Zu den Snacks.', context: withMeals() });
      expect(understood[0]!.results[0]).toContain(
        '2 meals of 2026-11-13 are called Snacks: pass one id (m2, m3)',
      );
      expect(understood[0]!.results[3]).toContain(`meal m4 belongs to ${YESTERDAY}`);
      expect(understood[0]!.results[4]).toContain('unknown meal id m9');
      expect(r.json.ops).toEqual([
        expect.objectContaining({ kind: 'logQuick', meal: 3, diaryMealId: snack2.id, mealName: 'Snacks' }),
        {
          kind: 'moveEntries',
          entryIds: [quark],
          toDate: TODAY,
          toMeal: 3,
          toDiaryMealId: snack1.id,
          toMealName: 'Snacks',
        },
      ]);
    });

    it('names the meal the previous utterance wrote to', async () => {
      script = [];
      await turn(alice, {
        text: 'Und noch ein Kaffee.',
        context: withMeals({ previousTarget: { date: TODAY, meal: 3, diaryMealId: snack2.id } }),
      });
      expect(understood[0]!.prompt).toContain(`The previous utterance wrote to: ${TODAY} Snacks (m3).`);
    });

    it('reads the meals of other days from the server, also to log into them', async () => {
      const day = '2026-11-02';
      const cake = {
        id: uuidv7(),
        date: day,
        name: 'Kuchen bei Oma',
        eatenAt: 1000,
        slot: 3,
        timeEdited: false,
      };
      const piece = entry({ date: day, meal: 3, name: 'Käsekuchen', diaryMealId: cake.id });
      const old = entry({ date: day, meal: 0, name: 'Brötchen' });
      await alice.post('/api/sync/push', {
        records: [
          { table: 'diaryMeals', data: { ...cake, updatedAt: 1000, deleted: false } },
          { table: 'foodEntries', data: piece },
          { table: 'foodEntries', data: old },
        ],
      });
      script = [
        { name: 'log_quick', input: { date: day, meal: 'kuchen bei oma', kcal: 300 } },
        { name: 'get_day', input: { date: day } },
        { name: 'log_quick', input: { date: day, meal: 'm2', kcal: 200 } },
      ];
      const r = await turn(alice, {
        text: 'Am 2. noch ein Stück Kuchen.',
        context: withMeals({
          mealNames: ['Frühstück', 'Mittagessen', 'Abendessen', 'Snacks'],
          days: [{ date: TODAY, meals: [], entries: [], trainings: [], weightKg: null }],
        }),
      });
      expect(r.json.ops.map((o: Record<string, unknown>) => [o.meal, o.diaryMealId, o.mealName])).toEqual([
        [3, cake.id, 'Kuchen bei Oma'],
        [0, `dm:${day}:0`, 'Frühstück'],
      ]);
      expect(understood[0]!.results[1]).toMatch(/m2 Frühstück:\n {4}e\d+: Brötchen/);
      expect(understood[0]!.results[1]).toMatch(/m1 Kuchen bei Oma:\n {4}e\d+: Käsekuchen/);
    });
  });

  it('prices the transcription per audio minute', () => {
    expect(transcriptionCostUsd('gpt-transcribe', 60)).toBeCloseTo(0.0045);
    expect(transcriptionCostUsd('unknown', 60)).toBeCloseTo(0.006);
  });
});

describe('assistant prompt', () => {
  const said = { said: 'Lasagne', done: 'nothing', reply: '' };
  it('dates recent utterances when the device sends the day', () => {
    const ctx = assistantContextSchema.parse(
      context({ recent: [{ ...said, date: YESTERDAY, at: '18:05' }] }),
    );
    expect(utterancePrompt(ctx, 'Ich habe Fotos', new Aliases())).toContain(
      `- ${YESTERDAY} 18:05 said: "Lasagne"`,
    );
  });

  it('shows only the time for an older app', () => {
    const ctx = assistantContextSchema.parse(context({ recent: [{ ...said, at: '18:05' }] }));
    expect(utterancePrompt(ctx, 'Ich habe Fotos', new Aliases())).toContain('\n- 18:05 said: "Lasagne"');
  });

  const emptyDay = (date: string, closed?: boolean) => ({
    date,
    entries: [],
    trainings: [],
    weightKg: null,
    meals: [],
    ...(closed !== undefined && { closed }),
  });
  const promptOf = (over: Partial<Context>) =>
    utterancePrompt(assistantContextSchema.parse(context(over)), 'M&Ms und eine Mate', new Aliases());

  it('takes the calendar day of the clock as today for an older app', () => {
    const text = promptOf({ now: `${TODAY}T01:30` });
    expect(text).toContain(`Now: Freitag ${TODAY} 01:30. Today: ${TODAY}. Yesterday: ${YESTERDAY}. `);
    expect(text).toContain(`Diary today (${TODAY}):`);
  });

  it('names the day of the app next to the real clock before the day begins', () => {
    const text = promptOf({ now: `${TODAY}T01:30`, today: YESTERDAY, shownDate: YESTERDAY });
    expect(text).toContain(
      `Now: Freitag ${TODAY} 01:30. Today: Donnerstag ${YESTERDAY} (the person's day has not ended yet). Yesterday: 2026-11-11. `,
    );
    expect(text).toContain(`Diary today (${YESTERDAY}):`);
    expect(text).toContain('Diary yesterday (2026-11-11):');
    expect(text).not.toContain('The diary shows');
  });

  it('says that the diary shows an earlier day, and whether it is closed', () => {
    const open = promptOf({ today: TODAY, shownDate: YESTERDAY, days: [emptyDay(YESTERDAY, false)] });
    expect(open).toContain(`The diary shows Donnerstag ${YESTERDAY}, an earlier day. `);
    expect(open).not.toContain('Diary of the shown day');
    const closed = promptOf({ today: TODAY, shownDate: YESTERDAY, days: [emptyDay(YESTERDAY, true)] });
    expect(closed).toContain(
      `The diary shows Donnerstag ${YESTERDAY}, an earlier day, closed (abgeschlossen). `,
    );
  });

  it('lists a shown day older than yesterday as a third diary', () => {
    const id = uuidv7();
    const text = promptOf({
      today: TODAY,
      shownDate: '2026-11-10',
      days: [
        emptyDay(TODAY),
        emptyDay(YESTERDAY),
        {
          ...emptyDay('2026-11-10', true),
          meals: [{ id: 'dm:2026-11-10:2', name: 'Abendessen', time: '19:00', night: false, slot: 2 }],
          entries: [
            {
              id,
              meal: 2,
              name: 'Lasagne',
              grams: 400,
              kcal: 600,
              proteinG: 30,
              group: null,
              diaryMealId: 'dm:2026-11-10:2',
            },
          ],
        },
      ],
    });
    expect(text).toContain('The diary shows Dienstag 2026-11-10, an earlier day, closed (abgeschlossen). ');
    expect(text).toContain('Diary of the shown day (2026-11-10):\n  m1 Abendessen (19:00):\n    e1: Lasagne');
  });

  it('keeps a later shown day as it was', () => {
    expect(promptOf({ shownDate: '2026-11-14' })).toContain('The diary shows 2026-11-14. ');
  });

  it('accepts three days and refuses a fourth', () => {
    const days = [TODAY, YESTERDAY, '2026-11-10', '2026-11-09'].map((d) => emptyDay(d));
    expect(assistantContextSchema.safeParse(context({ days: days.slice(0, 3) })).success).toBe(true);
    expect(assistantContextSchema.safeParse(context({ days })).success).toBe(false);
  });

  it('has the rules of the day and of the closed day', () => {
    expect(ASSISTANT_SYSTEM).toContain('"heute" is always Today');
    expect(ASSISTANT_SYSTEM).toContain('Trotzdem dort eintragen?');
    expect(replyOf('Nicht eingetragen.', 0)).toBe('Nicht eingetragen.');
  });
});
