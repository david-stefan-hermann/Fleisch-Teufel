import { uuidv7, type AssistantTurnResult, type Food } from '@ft/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserDb } from '@/db/dexie';
import {
  contextFor,
  discardTurn,
  enqueueTurn,
  onAssistantTurn,
  processAssistantQueue,
  queueOptions,
  retryTurn,
  undoTurn,
  type TurnEvent,
} from '@/features/assistant/queue';

const db = () => new UserDb(`t-${uuidv7()}`);
const TODAY = new Date().toISOString().slice(0, 10);

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
    expect((await contextFor(d, next)).previousTarget).toEqual({ date: TODAY, meal: 1 });
    await undoTurn(d, first);
    expect((await contextFor(d, next)).previousTarget).toBeNull();
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
