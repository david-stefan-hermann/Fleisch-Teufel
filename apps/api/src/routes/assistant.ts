/**
 * The assistant. `POST /turn` takes a recording or a typed sentence with the device's context and
 * answers with operations for the device (never written here), a question or a reply. Every
 * utterance is a row in `assistant_turns` (id = the device's `requestId`: a repeated request gets the
 * stored answer instead of a second paid call); recordings are kept `ASSISTANT_AUDIO_DAYS`. Every
 * paid call (transcription, model) is a row in `ai_analyses` and shares budget and rate limit with
 * the photo analysis.
 */
import {
  assistantContextSchema,
  MAX_AUDIO_BYTES,
  MAX_SKIN_BYTES,
  MAX_SKINS,
  type SkinInfo,
  MAX_UTTERANCE_LENGTH,
  type AssistantContext,
  type AssistantTurnResult,
  type AssistantTurnRow,
} from '@ft/shared';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { aiError, aiGate, NO_USAGE, requestIdOf } from '../ai/admit.js';
import type { AiUsage } from '../ai/analyze.js';
import { Aliases, utterancePrompt } from '../assistant/prompt.js';
import { createTurnHost } from '../assistant/host.js';
import { sniffAudio } from '../assistant/transcribe.js';
import { requireUser } from '../auth/session.js';
import { aiAnalyses, assistantAudio, assistantSkins, assistantTurns } from '../db/schema.js';
import { log } from '../log.js';
import type { AppEnv, Deps } from '../types.js';

/** Budget of one turn (transcription and all rounds); below the device's 120 s. */
export const TURN_BUDGET_MS = 90_000;
const TURNS_PAGE = 50;

const add = (a: AiUsage, b: AiUsage): AiUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  costUsd: a.costUsd + b.costUsd,
});

const outcomeSchema = z.object({ outcome: z.enum(['applied', 'undone', 'discarded']) });

export function assistantRoutes(deps: Deps) {
  const { db, assistant } = deps;
  const { admit, logFailure } = aiGate(deps);
  /** Turns running in this process, by `<user>:<requestId>`: a repeated request waits for the same one. */
  const inflight = new Map<string, Promise<AssistantTurnResult>>();
  const app = new Hono<AppEnv>();
  app.use('*', requireUser(db));

  const turnRow = async (userId: string, id: string) =>
    (
      await db
        .select()
        .from(assistantTurns)
        .where(and(eq(assistantTurns.userId, userId), eq(assistantTurns.id, id)))
    )[0] ?? null;

  /** The form of an upload; null (answered 400/413/415) when it is unusable. */
  const readForm = async (c: Context<AppEnv>) => {
    try {
      return await c.req.formData();
    } catch {
      return null;
    }
  };

  /** The recording of a form: bytes and detected type, or an error code. */
  const readAudio = async (field: FormDataEntryValue | null) => {
    if (!(field instanceof File)) return { error: 'audio_missing' as const };
    if (field.size > MAX_AUDIO_BYTES) return { error: 'too_large' as const };
    const bytes = new Uint8Array(await field.arrayBuffer());
    if (bytes.length === 0) return { error: 'audio_missing' as const };
    const kind = sniffAudio(bytes);
    if (!kind) return { error: 'unsupported_audio_type' as const };
    return { bytes, mime: kind.mime };
  };

  /**
   * Transcribes a recording (logged as a paid call) and keeps it with the turn. A turn whose audio was
   * transcribed before keeps that text (no second call).
   */
  const transcribe = async (
    userId: string,
    requestId: string,
    audio: { bytes: Uint8Array; mime: string },
  ): Promise<{ text: string; usage: AiUsage }> => {
    const prev = await turnRow(userId, requestId);
    if (prev?.transcript !== null && prev?.transcript !== undefined && prev.source === 'voice')
      return { text: prev.transcript, usage: NO_USAGE };
    const started = Date.now();
    let out;
    try {
      out = await assistant!.transcribe(audio, AbortSignal.timeout(60_000));
    } catch (e) {
      await logFailure(
        e,
        { userId, model: deps.env.TRANSCRIBE_MODEL, userText: null, started },
        {
          kind: 'transcribe',
        },
      );
      throw e;
    }
    await db.insert(aiAnalyses).values({
      userId,
      model: out.model,
      userText: out.text,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: out.usage.costUsd,
      durationMs: Date.now() - started,
      result: { kind: 'transcribe', bytes: audio.bytes.length, turnId: requestId },
    });
    await db
      .insert(assistantTurns)
      .values({ userId, id: requestId, source: 'voice', transcript: out.text })
      .onConflictDoUpdate({
        target: [assistantTurns.userId, assistantTurns.id],
        set: { transcript: out.text, source: 'voice' },
      });
    await db
      .insert(assistantAudio)
      .values({
        userId,
        turnId: requestId,
        mime: audio.mime,
        bytes: audio.bytes.length,
        data: Buffer.from(audio.bytes),
      })
      .onConflictDoNothing();
    return { text: out.text, usage: out.usage };
  };

  /**
   * Text mode while recording: the recording becomes text to edit. The same `requestId` then goes
   * to `/turn` with the edited text, without a second transcription.
   */
  app.post('/transcribe', async (c) => {
    if (!assistant) return c.json({ error: 'ai_disabled' }, 503);
    if (!assistant.canTranscribe) return c.json({ error: 'voice_disabled' }, 503);
    const user = c.get('user');
    const form = await readForm(c);
    if (!form) return c.json({ error: 'expected_multipart' }, 400);
    const requestId = requestIdOf(form.get('requestId'));
    if (!requestId) return c.json({ error: 'request_id_missing' }, 400);
    const audio = await readAudio(form.get('audio'));
    if ('error' in audio) return c.json({ error: audio.error }, audio.error === 'too_large' ? 413 : 400);
    try {
      const prev = await turnRow(user.id, requestId);
      if (prev?.transcript == null) await admit(user.id);
      const { text } = await transcribe(user.id, requestId, audio);
      return c.json({ text });
    } catch (e) {
      return aiError(c, e);
    }
  });

  app.post('/turn', async (c) => {
    if (!assistant) return c.json({ error: 'ai_disabled' }, 503);
    const user = c.get('user');
    const form = await readForm(c);
    if (!form) return c.json({ error: 'expected_multipart' }, 400);
    const requestId = requestIdOf(form.get('requestId'));
    if (!requestId) return c.json({ error: 'request_id_missing' }, 400);
    let context: AssistantContext;
    try {
      const parsed = assistantContextSchema.safeParse(JSON.parse(String(form.get('context') ?? '')));
      if (!parsed.success) return c.json({ error: 'validation' }, 400);
      context = parsed.data;
    } catch {
      return c.json({ error: 'validation' }, 400);
    }
    const typed = typeof form.get('text') === 'string' ? (form.get('text') as string).trim() : '';
    if (typed.length > MAX_UTTERANCE_LENGTH) return c.json({ error: 'too_large' }, 413);
    const audioField = form.get('audio');
    let audio: { bytes: Uint8Array; mime: string } | null = null;
    if (!typed) {
      const read = await readAudio(audioField);
      if ('error' in read) return c.json({ error: read.error }, read.error === 'too_large' ? 413 : 400);
      if (!assistant.canTranscribe) return c.json({ error: 'voice_disabled' }, 503);
      audio = read;
    }

    const prev = await turnRow(user.id, requestId);
    if (prev?.status === 'ok' && prev.response) return c.json(prev.response);
    const key = `${user.id}:${requestId}`;
    const running = inflight.get(key);
    if (running) {
      try {
        return c.json(await running);
      } catch (e) {
        return aiError(c, e);
      }
    }

    const run = async (): Promise<AssistantTurnResult> => {
      await admit(user.id);
      const started = Date.now();
      const signal = AbortSignal.timeout(TURN_BUDGET_MS);
      let usage = NO_USAGE;
      let transcript = typed;
      const source = typed && !(prev?.source === 'voice') ? 'text' : 'voice';
      if (audio) {
        const t = await transcribe(user.id, requestId, audio);
        transcript = t.text;
        usage = add(usage, t.usage);
      }
      await db
        .insert(assistantTurns)
        .values({ userId: user.id, id: requestId, source, transcript, context })
        .onConflictDoUpdate({
          target: [assistantTurns.userId, assistantTurns.id],
          set: { transcript, context, status: 'pending', error: null },
        });

      const finish = async (result: AssistantTurnResult) => {
        await db
          .update(assistantTurns)
          .set({
            status: 'ok',
            ops: result.ops,
            question: result.question,
            reply: result.reply,
            response: result,
          })
          .where(and(eq(assistantTurns.userId, user.id), eq(assistantTurns.id, requestId)));
        return result;
      };
      // Silence or noise: nothing to understand, nothing to pay for.
      if (!transcript.trim())
        return finish({ turnId: requestId, transcript: '', ops: [], question: null, reply: null, usage });

      const aliases = new Aliases();
      const prompt = utterancePrompt(context, transcript, aliases);
      const { host, state } = await createTurnHost(deps, user.id, context, aliases);
      let out;
      try {
        out = await assistant.understand({ prompt, mealNames: context.mealNames }, host, signal);
      } catch (e) {
        await logFailure(
          e,
          { userId: user.id, model: deps.env.ASSISTANT_MODEL, userText: transcript, started },
          { kind: 'assistant', turnId: requestId },
        );
        await db
          .update(assistantTurns)
          .set({ status: 'failed', error: String((e as Error).message ?? e).slice(0, 200) })
          .where(and(eq(assistantTurns.userId, user.id), eq(assistantTurns.id, requestId)));
        throw e;
      }
      usage = add(usage, out.usage);
      await db.insert(aiAnalyses).values({
        userId: user.id,
        model: out.model,
        userText: transcript,
        inputTokens: out.usage.inputTokens,
        outputTokens: out.usage.outputTokens,
        costUsd: out.usage.costUsd,
        durationMs: Date.now() - started,
        result: {
          kind: 'assistant',
          turnId: requestId,
          ops: state.ops.map((o) => o.kind),
          rounds: out.rounds,
        },
      });
      log.info('assistant turn', {
        user: user.id,
        model: out.model,
        ...usage,
        ms: Date.now() - started,
        rounds: out.rounds,
        ops: state.ops.length,
        asked: state.question !== null,
      });
      return finish({
        turnId: requestId,
        transcript,
        ops: state.ops,
        question: state.question,
        reply: state.question ? null : out.reply,
        usage,
      });
    };

    const job = run();
    inflight.set(key, job);
    job.then(
      () => inflight.delete(key),
      () => inflight.delete(key),
    );
    try {
      return c.json(await job);
    } catch (e) {
      return aiError(c, e);
    }
  });

  /** What the device did with a turn's operations (history: "rückgängig gemacht"). */
  app.patch('/turns/:id', async (c) => {
    const user = c.get('user');
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'validation' }, 400);
    }
    const parsed = outcomeSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'validation' }, 400);
    const rows = await db
      .update(assistantTurns)
      .set({ outcome: parsed.data.outcome })
      .where(and(eq(assistantTurns.userId, user.id), eq(assistantTurns.id, c.req.param('id'))))
      .returning({ id: assistantTurns.id });
    if (rows.length === 0) return c.json({ error: 'not_found' }, 404);
    return c.json({ ok: true });
  });

  /** The history, newest first; `before` (ISO time) pages back. */
  app.get('/turns', async (c) => {
    const user = c.get('user');
    const before = c.req.query('before');
    const beforeDate = before && !Number.isNaN(Date.parse(before)) ? new Date(before) : null;
    const rows = await db
      .select({
        id: assistantTurns.id,
        createdAt: assistantTurns.createdAt,
        source: assistantTurns.source,
        transcript: assistantTurns.transcript,
        ops: assistantTurns.ops,
        question: assistantTurns.question,
        reply: assistantTurns.reply,
        status: assistantTurns.status,
        error: assistantTurns.error,
        outcome: assistantTurns.outcome,
        hasAudio: sql<boolean>`exists (select 1 from assistant_audio a where a.user_id = ${assistantTurns.userId} and a.turn_id = ${assistantTurns.id})`,
      })
      .from(assistantTurns)
      .where(
        and(
          eq(assistantTurns.userId, user.id),
          beforeDate ? lt(assistantTurns.createdAt, beforeDate) : undefined,
        ),
      )
      .orderBy(desc(assistantTurns.createdAt))
      .limit(TURNS_PAGE);
    const turns: AssistantTurnRow[] = rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      source: r.source,
      transcript: r.transcript,
      ops: r.ops ?? [],
      question: r.question ?? null,
      reply: r.reply,
      status: r.status === 'pending' ? 'failed' : r.status,
      error: r.status === 'pending' ? 'pending' : r.error,
      outcome: r.outcome,
      hasAudio: !!r.hasAudio,
    }));
    return c.json({ turns, more: rows.length === TURNS_PAGE });
  });

  app.get('/turns/:id/audio', async (c) => {
    const [row] = await db
      .select({ mime: assistantAudio.mime, data: assistantAudio.data })
      .from(assistantAudio)
      .where(and(eq(assistantAudio.userId, c.get('user').id), eq(assistantAudio.turnId, c.req.param('id'))));
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.body(new Uint8Array(row.data), 200, {
      'content-type': row.mime,
      'cache-control': 'private, max-age=86400',
      'x-content-type-options': 'nosniff',
    });
  });

  // ---------------------------------------------------------------- figures (packs the person uploaded)

  const SKIN_ID = /^[\w-]{8,64}$/;

  app.get('/skins', async (c) => {
    const rows = await db
      .select({
        id: assistantSkins.id,
        name: assistantSkins.name,
        bytes: assistantSkins.bytes,
        createdAt: assistantSkins.createdAt,
      })
      .from(assistantSkins)
      .where(eq(assistantSkins.userId, c.get('user').id))
      .orderBy(assistantSkins.createdAt);
    const skins: SkinInfo[] = rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
    return c.json({ skins });
  });

  app.get('/skins/:id', async (c) => {
    const [row] = await db
      .select({ data: assistantSkins.data })
      .from(assistantSkins)
      .where(and(eq(assistantSkins.userId, c.get('user').id), eq(assistantSkins.id, c.req.param('id'))));
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.body(new Uint8Array(row.data), 200, {
      'content-type': 'application/zip',
      'cache-control': 'private, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    });
  });

  /**
   * A pack as the device checked it (zip with `skin.json`, PNG/WebP pictures): kept as sent, at most
   * `MAX_SKINS` per account. The device reads and checks the content; the server only stores it.
   */
  app.put('/skins/:id', async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    if (!SKIN_ID.test(id)) return c.json({ error: 'invalid_id' }, 400);
    const name = (c.req.query('name') ?? '').trim().slice(0, 40);
    if (!name) return c.json({ error: 'validation' }, 400);
    if (Number(c.req.header('content-length') ?? 0) > MAX_SKIN_BYTES)
      return c.json({ error: 'too_large' }, 413);
    const buf = new Uint8Array(await c.req.arrayBuffer());
    if (buf.length > MAX_SKIN_BYTES) return c.json({ error: 'too_large' }, 413);
    if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b || buf[2] !== 0x03 || buf[3] !== 0x04)
      return c.json({ error: 'not_a_zip' }, 415);
    const [{ n } = { n: 0 }] = await db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(assistantSkins)
      .where(and(eq(assistantSkins.userId, user.id), sql`${assistantSkins.id} <> ${id}`));
    if (n >= MAX_SKINS) return c.json({ error: 'too_many_skins' }, 409);
    await db
      .insert(assistantSkins)
      .values({ userId: user.id, id, name, bytes: buf.length, data: Buffer.from(buf) })
      .onConflictDoNothing();
    return c.json({ ok: true, id });
  });

  app.delete('/skins/:id', async (c) => {
    await db
      .delete(assistantSkins)
      .where(and(eq(assistantSkins.userId, c.get('user').id), eq(assistantSkins.id, c.req.param('id'))));
    return c.json({ ok: true });
  });

  return app;
}
