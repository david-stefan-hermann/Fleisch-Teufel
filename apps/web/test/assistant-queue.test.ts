import { dayId, today, uuidv7, type AssistantTurnResult, type Food } from '@ft/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserDb } from '@/db/dexie';
import { saveSettings } from '@/db/settings';
import { saveRecord } from '@/db/write';
import {
  contextFor,
  discardTurn,
  enqueueTurn,
  onAssistantTurn,
  processAssistantQueue,
  queueOptions,
  RECENT_UTTERANCE_MS,
  retryTurn,
  undoTurn,
  type TurnEvent,
} from '@/features/assistant/queue';

const db = () => new UserDb(`t-${uuidv7()}`);
const TODAY = today();

const quark: Food = {
  id: 'bls:M1',
  source: 'bls',
  sourceId: 'M1',
  name: 'Magerquark',
  nameEn: null,
  brand: null,
  group: null,
  unit: 'g',
  nutrients: { ENERCC: 67 },
  portions: [],
  imageUrl: null,
};

const answer = (over: Partial<AssistantTurnResult> = {}): AssistantTurnResult => ({
  turnId: 'x',
  transcript: '200 Gramm Magerquark.',
  ops: [
    {
      kind: 'logFood',
      date: TODAY,
      meal: 1,
      diaryMealId: null,
      mealName: null,
      items: [{ food: quark, grams: 200, portion: null, guessed: false }],
      groupName: null,
    },
  ],
  question: null,
  reply: 'Eingetragen.',
  usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
  ...over,
});

/** What the fake server does with the next requests, in order. */
let responses: ((init: RequestInit) => Promise<Response>)[] = [];
let sent: { url: string; body: FormData | null }[] = [];
const json =
  (body: unknown, status = 200) =>
  () =>
    Promise.resolve(
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
    );
const offline = () => () => Promise.reject(new TypeError('Failed to fetch'));
const hang = () => (init: RequestInit) =>
  new Promise<Response>((_, reject) =>
    init.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
  );

let events: TurnEvent[] = [];
let stop: () => void;

beforeEach(() => {
  responses = [];
  sent = [];
  events = [];
  queueOptions.timeoutMs = 120_000;
  stop = onAssistantTurn((e) => events.push(e));
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    sent.push({ url, body: init.body instanceof FormData ? init.body : null });
    // Reports of the outcome (PATCH) answer ok; a turn without a prepared answer finds no server.
    if (!url.endsWith('/turn')) return json({ ok: true })();
    const next = responses.shift();
    return next ? next(init) : offline()();
  });
});
afterEach(() => {
  stop();
  vi.unstubAllGlobals();
});

const text = (d: UserDb, t: string, over: { answersTo?: number } = {}) =>
  enqueueTurn(d, { source: 'text', text: t, shownDate: TODAY, ...over });

describe('assistant queue', () => {
  it('sends a sentence with the context, applies the answer and undoes it', async () => {
    const d = db();
    responses = [json(answer())];
    const id = await text(d, '200 Gramm Magerquark zum Mittagessen.');
    await processAssistantQueue(d);
    const turn = (await d.assistantTurns.get(id))!;
    expect(turn).toMatchObject({ status: 'done', transcript: '200 Gramm Magerquark.' });
    expect(turn.applied![0]!.text).toBe('Mittagessen: Magerquark');
    const form = sent[0]!.body!;
    expect(form.get('text')).toBe('200 Gramm Magerquark zum Mittagessen.');
    expect(form.get('requestId')).toBe(turn.requestId);
    expect(JSON.parse(String(form.get('context')))).toMatchObject({ shownDate: TODAY, recent: [] });
    expect(events.at(-1)).toMatchObject({ late: false, result: { applied: [{ kind: 'logFood' }] } });
    expect((await d.foodEntries.toArray()).filter((e) => !e.deleted)).toHaveLength(1);

    expect(await undoTurn(d, id)).toBe(true);
    expect((await d.foodEntries.toArray()).filter((e) => !e.deleted)).toHaveLength(0);
    expect(await undoTurn(d, id)).toBe(false);
    expect(sent.some((s) => s.url.endsWith(`/turns/${turn.requestId}`))).toBe(true);
  });

  it('keeps a turn waiting while offline and sends it later as late', async () => {
    const d = db();
    responses = [offline()];
    const id = await text(d, 'Banane');
    await processAssistantQueue(d);
    expect((await d.assistantTurns.get(id))!).toMatchObject({ status: 'waiting', late: true });
    responses = [json(answer())];
    await processAssistantQueue(d);
    expect((await d.assistantTurns.get(id))!.status).toBe('done');
    expect(events.at(-1)!.late).toBe(true);
  });

  it('never repeats a timeout by itself; "Wiederholen" keeps the key', async () => {
    const d = db();
    queueOptions.timeoutMs = 30;
    responses = [hang()];
    const id = await text(d, 'Banane');
    await processAssistantQueue(d);
    const failed = (await d.assistantTurns.get(id))!;
    expect(failed.status).toBe('failed');
    await processAssistantQueue(d);
    expect(sent.filter((s) => s.url.endsWith('/turn'))).toHaveLength(1);
    responses = [json(answer())];
    await retryTurn(d, id);
    await processAssistantQueue(d);
    const ok = (await d.assistantTurns.get(id))!;
    expect(ok.status).toBe('done');
    expect(sent.filter((s) => s.url.endsWith('/turn')).map((s) => s.body!.get('requestId'))).toEqual([
      failed.requestId,
      failed.requestId,
    ]);
  });

  it('a question waits for the answer; the answer carries it as the open question', async () => {
    const d = db();
    responses = [
      json(answer({ ops: [], question: { text: 'Welche Gurken?', options: ['Salat', 'Gewürz'] } })),
    ];
    const asked = await text(d, 'Drei Gurken.');
    await processAssistantQueue(d);
    expect((await d.assistantTurns.get(asked))!.status).toBe('asking');
    responses = [json(answer())];
    const reply = await text(d, 'Gewürz', { answersTo: asked });
    await processAssistantQueue(d);
    expect((await d.assistantTurns.get(asked))!.status).toBe('done');
    const ctx = JSON.parse(String(sent.find((s) => s.body?.get('text') === 'Gewürz')!.body!.get('context')));
    expect(ctx.openQuestion).toEqual({ text: 'Welche Gurken?', options: ['Salat', 'Gewürz'] });
    expect(ctx.recent.at(-1)).toMatchObject({
      said: '200 Gramm Magerquark.',
      reply: 'asked: Welche Gurken?',
    });
    expect((await d.assistantTurns.get(reply))!.status).toBe('done');
  });

  it('tells the follow-up where the previous utterance wrote, unless it was undone', async () => {
    const d = db();
    responses = [json(answer())];
    const first = await text(d, 'Quark');
    await processAssistantQueue(d);
    const next = {
      requestId: 'n',
      createdAt: Date.now() + 1000,
      source: 'text' as const,
      shownDate: TODAY,
      status: 'waiting' as const,
    };
    const ctx = await contextFor(d, next);
    const lunch = `dm:${TODAY}:1`;
    expect(ctx.previousTarget).toEqual({ date: TODAY, meal: 1, diaryMealId: lunch });
    // The meals of the day as the diary shows them, every entry in its meal.
    // Before the day's start the meal is one of the night (the test runs on the real clock).
    expect(ctx.days[0]!.meals).toEqual([
      {
        id: lunch,
        name: 'Mittagessen',
        time: expect.stringMatching(/^\d\d:\d\d$/),
        night: new Date().getHours() < 5,
        slot: 1,
      },
    ]);
    expect(ctx.days[0]!.entries).toEqual([
      expect.objectContaining({ name: 'Magerquark', diaryMealId: lunch }),
    ]);
    expect(ctx.days[1]!.meals).toEqual([]);
    await undoTurn(d, first);
    expect((await contextFor(d, next)).previousTarget).toBeNull();
  });

  it('keeps utterances older than the window out of the conversation', async () => {
    const d = db();
    const now = Date.now();
    const done = (createdAt: number, said: string) =>
      d.assistantTurns.add({
        requestId: uuidv7(),
        createdAt,
        source: 'text',
        text: said,
        shownDate: TODAY,
        status: 'done',
        applied: [{ kind: 'logFood', text: 'Abendessen: Lasagne', target: { date: TODAY, meal: 2 } }],
      });
    const next = (createdAt: number) => ({
      requestId: uuidv7(),
      createdAt,
      source: 'text' as const,
      shownDate: TODAY,
      status: 'waiting' as const,
    });
    await done(now - 7 * 86_400_000, 'Lasagne bei Oma');
    const old = await contextFor(d, next(now));
    expect(old.recent).toEqual([]);
    expect(old.previousTarget).toBeNull();

    await done(now - 10 * 60_000, 'Ein Apfel');
    const ctx = await contextFor(d, next(now));
    expect(ctx.recent).toEqual([
      expect.objectContaining({
        said: 'Ein Apfel',
        date: expect.stringMatching(/^\d{4}-\d\d-\d\d$/),
        at: expect.stringMatching(/^\d\d:\d\d$/),
      }),
    ]);
    expect(ctx.previousTarget).toEqual({ date: TODAY, meal: 2, diaryMealId: null });

    // The window counts from the utterance itself: one that waited offline keeps its conversation.
    const waited = now - 2 * 86_400_000;
    await done(waited - 10 * 60_000, 'Zwei Eier');
    await done(waited - RECENT_UTTERANCE_MS - 60_000, 'Brot');
    expect((await contextFor(d, next(waited))).recent.map((r) => r.said)).toEqual(['Zwei Eier']);
  });

  it('sends the day of the app, and the shown day with its closed flag when it lies further back', async () => {
    const d = db();
    // 01:30 on the 14th: with the day starting at 5 it is still the 13th.
    const night = new Date(2026, 10, 14, 1, 30).getTime();
    const turn = (shownDate: string) => ({
      requestId: uuidv7(),
      createdAt: night,
      source: 'text' as const,
      shownDate,
      status: 'waiting' as const,
    });
    await saveRecord(d, 'dayNotes', {
      id: dayId.note('2026-11-10'),
      date: '2026-11-10',
      note: '',
      completedAt: night - 86_400_000,
    });
    const ctx = await contextFor(d, turn('2026-11-10'));
    expect(ctx.now).toBe('2026-11-14T01:30');
    expect(ctx.today).toBe('2026-11-13');
    expect(ctx.days.map((x) => [x.date, x.closed])).toEqual([
      ['2026-11-13', false],
      ['2026-11-12', false],
      ['2026-11-10', true],
    ]);
    // Yesterday is in the list anyway.
    expect((await contextFor(d, turn('2026-11-12'))).days).toHaveLength(2);

    await saveSettings(d, { dayStartHour: 0 });
    const midnight = await contextFor(d, turn('2026-11-13'));
    expect(midnight.today).toBe('2026-11-14');
    expect(midnight.days.map((x) => x.date)).toEqual(['2026-11-14', '2026-11-13']);
  });

  it('drops a discarded turn, also when its answer arrives late', async () => {
    const d = db();
    responses = [offline()];
    const id = await text(d, 'Banane');
    await processAssistantQueue(d);
    const tries = sent.filter((s) => s.url.endsWith('/turn')).length;
    await discardTurn(d, id);
    responses = [json(answer())];
    await processAssistantQueue(d);
    expect((await d.assistantTurns.get(id))!.status).toBe('discarded');
    expect(sent.filter((s) => s.url.endsWith('/turn'))).toHaveLength(tries);
    expect(await d.foodEntries.count()).toBe(0);
  });
});
