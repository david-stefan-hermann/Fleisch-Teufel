/**
 * The assistant's line of utterances (pattern of `features/ai/queue.ts`): a recording or a typed
 * sentence becomes an `assistantTurns` row first, then one serial run sends it with the device's
 * context and applies what comes back (`applyOps`, one transaction with the turn's undo steps).
 * Offline a turn waits (the button shows the count) and is sent once connected: then it is "late",
 * which keeps the microphone closed and asks before the camera opens. A timeout is never repeated by
 * itself: the server may have answered and paid; "Wiederholen" keeps the `requestId`, so a repeat
 * costs nothing when it did.
 */
import {
  addDays,
  get,
  isStepsEntry,
  N,
  targetsForDate,
  today as todayOf,
  toISODate,
  uuidv7,
  type AssistantContext,
  type AssistantTurnResult,
  type ContextDay,
  type ISODate,
} from '@ft/shared';
import type { AssistantTurn, UserDb } from '@/db/dexie';
import { runUndo } from '@/db/undo';
import { DEFAULT_SETTINGS } from '@/db/settings';
import { api, ApiError, OfflineError, TimeoutError, errorMessage } from '@/lib/api';
import { applyOps, lastTarget, summaryText, type ApplyResult } from './execute';

/** How long a turn may take on the server (transcription and all rounds); tests shorten it. */
export const queueOptions = { timeoutMs: 120_000 };

/** What the button shows after a run: the turn as stored, what was applied, whether it waited. */
export interface TurnEvent {
  turn: AssistantTurn;
  result: ApplyResult | null;
  /** Sent later than spoken (it waited for a connection, or another device's answer). */
  late: boolean;
  error?: string;
}

const listeners = new Set<(e: TurnEvent) => void>();

/** Subscribes to finished turns (the button shows toast, question or "Nicht verstanden"). */
export function onAssistantTurn(fn: (e: TurnEvent) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const pad = (n: number) => String(n).padStart(2, '0');
/** Local "YYYY-MM-DDTHH:MM" of an epoch ms. */
export function localStamp(ms: number): string {
  const d = new Date(ms);
  return `${toISODate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function dayOf(db: UserDb, date: ISODate): Promise<ContextDay> {
  const [entries, trainings, weight, meals] = await Promise.all([
    db.foodEntries.where('date').equals(date).sortBy('loggedAt'),
    db.exerciseEntries.where('date').equals(date).sortBy('loggedAt'),
    db.weightEntries.where('date').equals(date).toArray(),
    db.meals.toArray(),
  ]);
  const mealName = new Map(meals.map((m) => [m.id, m.name]));
  return {
    date,
    entries: entries
      .filter((e) => !e.deleted)
      .map((e) => ({
        id: e.id,
        meal: e.meal,
        name: e.name,
        grams: e.grams,
        kcal: Math.round(get(e.nutrients, N.kcal)),
        proteinG: Math.round(get(e.nutrients, N.protein) * 10) / 10,
        group: e.groupName ?? (e.mealId ? (mealName.get(e.mealId) ?? null) : null),
      })),
    trainings: trainings
      .filter((t) => !t.deleted && !isStepsEntry(t))
      .map((t) => ({ id: t.id, name: t.name, minutes: t.minutes, intensity: t.intensity })),
    weightKg: weight.find((w) => !w.deleted)?.kg ?? null,
  };
}

/**
 * What the device tells the server about this utterance: its time, the diary of that day and the day
 * before, targets, the last three utterances, where the directly previous one wrote, an open question.
 */
export async function contextFor(db: UserDb, turn: AssistantTurn): Promise<AssistantContext> {
  const today = todayOf(new Date(turn.createdAt));
  const settings = (await db.settings.toArray())[0] ?? DEFAULT_SETTINGS;
  const goals = (await db.goals.toArray()).filter((g) => !g.deleted);
  const targets = goals.length ? targetsForDate(goals, today) : null;
  const before = (await db.assistantTurns.where('createdAt').below(turn.createdAt).toArray())
    .filter((t) => t.status === 'done' || t.status === 'asking')
    .sort((a, b) => a.createdAt - b.createdAt);
  const prev = before.at(-1);
  const asked = turn.answersTo !== undefined ? await db.assistantTurns.get(turn.answersTo) : undefined;
  const target = prev && !prev.undoneAt ? lastTarget(prev.applied ?? []) : null;
  return {
    now: localStamp(turn.createdAt),
    shownDate: turn.shownDate,
    mealNames: settings.mealNames,
    targets: targets ? { kcal: targets.kcal, proteinG: targets.proteinG } : null,
    days: [await dayOf(db, today), await dayOf(db, addDays(today, -1))],
    recent: before.slice(-3).map((t) => ({
      at: localStamp(t.createdAt).slice(11),
      said: (t.transcript ?? t.text ?? '').slice(0, 2000),
      done: (t.undoneAt
        ? 'rückgängig gemacht'
        : (t.applied ?? []).map((a) => a.text).join('; ') || 'nothing'
      ).slice(0, 2000),
      reply: (t.question ? `asked: ${t.question.text}` : (t.reply ?? '')).slice(0, 500),
    })),
    previousTarget: target,
    openQuestion: asked?.question ?? null,
  };
}

/** Sends one turn: a recording (field `audio`) or text, with the context and its key. */
export async function sendTurn(turn: AssistantTurn, context: AssistantContext): Promise<AssistantTurnResult> {
  const form = new FormData();
  if (turn.text?.trim()) form.set('text', turn.text.trim());
  else if (turn.audio)
    form.set(
      'audio',
      new File([turn.audio], `utterance.${turn.audioType?.includes('mp4') ? 'm4a' : 'webm'}`, {
        type: turn.audioType ?? 'audio/webm',
      }),
    );
  form.set('context', JSON.stringify(context));
  form.set('requestId', turn.requestId);
  return api<AssistantTurnResult>('/api/assistant/turn', {
    method: 'POST',
    body: form,
    timeoutMs: queueOptions.timeoutMs,
  });
}

/** Text mode during a recording: the recording as text to edit (same key as the later turn). */
export async function transcribeTurn(audio: Blob, requestId: string, signal?: AbortSignal): Promise<string> {
  const form = new FormData();
  form.set('audio', new File([audio], audio.type.includes('mp4') ? 'u.m4a' : 'u.webm', { type: audio.type }));
  form.set('requestId', requestId);
  const r = await api<{ text: string }>('/api/assistant/transcribe', {
    method: 'POST',
    body: form,
    timeoutMs: 60_000,
    ...(signal ? { signal } : {}),
  });
  return r.text;
}

/** Tells the server what became of a turn (history); best effort. */
function reportOutcome(requestId: string, outcome: 'applied' | 'undone' | 'discarded'): void {
  void api(`/api/assistant/turns/${encodeURIComponent(requestId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ outcome }),
    timeoutMs: 10_000,
  }).catch(() => {});
}

/** Queues an utterance; returns its `localId`. The run starts right away. */
export async function enqueueTurn(
  db: UserDb,
  input: Pick<
    AssistantTurn,
    'source' | 'shownDate' | 'text' | 'audio' | 'audioType' | 'durationMs' | 'answersTo'
  > & {
    requestId?: string;
  },
): Promise<number> {
  // The answer closes the question it answers.
  if (input.answersTo !== undefined) await closeQuestion(db, input.answersTo);
  const localId = (await db.assistantTurns.add({
    ...input,
    requestId: input.requestId ?? uuidv7(),
    createdAt: Date.now(),
    status: 'waiting',
    // Spoken while offline: whatever comes back comes back later.
    ...(typeof navigator !== 'undefined' && navigator.onLine === false && { late: true }),
  })) as number;
  void processAssistantQueue(db);
  return localId;
}

let current: Promise<void> | null = null;
let again = false;

/** Sends waiting turns one by one; stops at the first network failure. */
export async function processAssistantQueue(db: UserDb): Promise<void> {
  if (current) {
    again = true;
    return current;
  }
  current = (async () => {
    try {
      do {
        again = false;
        await exclusive(db, () => runQueue(db));
      } while (again);
    } finally {
      current = null;
    }
  })();
  return current;
}

/**
 * One queue run at a time across tabs of this account: another tab would put a turn this one is
 * sending back to "waiting" and apply its answer a second time.
 */
function exclusive(db: UserDb, fn: () => Promise<void>): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.locks) return fn();
  return navigator.locks.request(`ft-assistant-queue:${db.name}`, fn);
}

async function runQueue(db: UserDb): Promise<void> {
  // A turn stuck in "sending" (app closed mid-request) is sent again with the same key: free when
  // the server finished it.
  await db.assistantTurns
    .where('status')
    .equals('sending')
    .modify((t) => {
      t.status = 'waiting';
      t.late = true;
    });
  for (;;) {
    // Taken in one transaction: a "Verwerfen" in between cannot be overwritten.
    const turn = await db.transaction('rw', db.assistantTurns, async () => {
      const next = (await db.assistantTurns.where('status').equals('waiting').sortBy('createdAt'))[0];
      if (next) await db.assistantTurns.update(next.localId!, { status: 'sending' });
      return next;
    });
    if (!turn) break;
    let answer: AssistantTurnResult;
    try {
      answer = await sendTurn(turn, await contextFor(db, turn));
    } catch (e) {
      if (e instanceof OfflineError) {
        await db.assistantTurns.update(turn.localId!, { status: 'waiting', late: true });
        break;
      }
      const error =
        e instanceof TimeoutError ? 'Der Server hat zu lange nicht geantwortet.' : errorMessage(e);
      await db.assistantTurns.update(turn.localId!, { status: 'failed', error });
      const failed = (await db.assistantTurns.get(turn.localId!))!;
      emit({ turn: failed, result: null, late: !!turn.late, error });
      if (e instanceof ApiError && (e.status === 401 || e.code === 'ai_budget')) break;
      continue;
    }
    await finishTurn(db, turn, answer);
  }
}

function emit(e: TurnEvent) {
  for (const fn of listeners) fn(e);
}

/** Applies the answer and stores it on the turn in the same transaction. */
async function finishTurn(db: UserDb, turn: AssistantTurn, answer: AssistantTurnResult): Promise<void> {
  const settings = (await db.settings.toArray())[0] ?? DEFAULT_SETTINGS;
  let result: ApplyResult;
  try {
    result = await applyOps(
      db,
      answer.ops,
      { now: turn.createdAt, today: todayOf(new Date(turn.createdAt)), mealNames: settings.mealNames },
      async (r) => {
        // Discarded meanwhile (swipe in the history): nothing of it may land in the diary.
        const now = await db.assistantTurns.get(turn.localId!);
        if (!now || now.status === 'discarded') throw new Discarded();
        await db.assistantTurns.update(turn.localId!, {
          status: answer.question ? 'asking' : 'done',
          transcript: answer.transcript,
          ops: answer.ops,
          question: answer.question,
          reply: answer.reply,
          applied: r.applied,
          skipped: r.skipped,
          undo: r.undo,
          audio: undefined,
          audioType: undefined,
          error: undefined,
        });
      },
    );
  } catch (e) {
    if (e instanceof Discarded) return;
    // The answer cannot be written (invalid data, storage full): nothing of it is in the diary.
    await db.assistantTurns.update(turn.localId!, {
      status: 'failed',
      transcript: answer.transcript,
      error: errorMessage(e),
    });
    emit({
      turn: (await db.assistantTurns.get(turn.localId!))!,
      result: null,
      late: !!turn.late,
      error: errorMessage(e),
    });
    return;
  }
  if (result.applied.length > 0) reportOutcome(turn.requestId, 'applied');
  emit({ turn: (await db.assistantTurns.get(turn.localId!))!, result, late: !!turn.late });
}

class Discarded extends Error {}

/** "Rückgängig" from the toast or the history: the turn's writes are taken back. */
export async function undoTurn(db: UserDb, localId: number): Promise<boolean> {
  const turn = await db.assistantTurns.get(localId);
  if (!turn?.undo?.length || turn.undoneAt) return false;
  const steps = turn.undo;
  const tables = [...new Set(steps.map((s) => db.syncTable(s.table)))];
  // Together: a turn never shows "Rückgängig" again after its writes were taken back.
  const done = await db.transaction('rw', [...tables, db.outbox, db.assistantTurns], async () => {
    const now = await db.assistantTurns.get(localId);
    if (!now || now.undoneAt) return false;
    await runUndo(db, steps);
    await db.assistantTurns.update(localId, { undoneAt: Date.now() });
    return true;
  });
  if (!done) return false;
  reportOutcome(turn.requestId, 'undone');
  return true;
}

/** "Verwerfen" of a waiting turn (history): it is never sent. */
export async function discardTurn(db: UserDb, localId: number): Promise<void> {
  const turn = await db.transaction('rw', db.assistantTurns, async () => {
    const t = await db.assistantTurns.get(localId);
    if (!t || (t.status !== 'waiting' && t.status !== 'failed')) return null;
    await db.assistantTurns.update(localId, { status: 'discarded', audio: undefined, audioType: undefined });
    return t;
  });
  if (!turn) return;
  reportOutcome(turn.requestId, 'discarded');
}

/** "Wiederholen" of a failed turn: same key, so the server answers a finished one for free. */
export async function retryTurn(db: UserDb, localId: number): Promise<void> {
  // Only a failed one: a second tap after the first retry finished must not apply it again.
  const retried = await db.transaction('rw', db.assistantTurns, async () => {
    if ((await db.assistantTurns.get(localId))?.status !== 'failed') return false;
    await db.assistantTurns.update(localId, { status: 'waiting', error: undefined, late: true });
    return true;
  });
  if (retried) void processAssistantQueue(db);
}

/** A question nobody answered is closed (bubble X): the turn counts as done. */
export async function closeQuestion(db: UserDb, localId: number): Promise<void> {
  const turn = await db.assistantTurns.get(localId);
  if (turn?.status === 'asking') await db.assistantTurns.update(localId, { status: 'done' });
}

export { summaryText };

export function startAssistantQueue(db: UserDb): () => void {
  const run = () => void processAssistantQueue(db);
  window.addEventListener('online', run);
  document.addEventListener('visibilitychange', run);
  run();
  return () => {
    window.removeEventListener('online', run);
    document.removeEventListener('visibilitychange', run);
  };
}
