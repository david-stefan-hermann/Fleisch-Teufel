import {
  aiChoicesSchema,
  cleanGtin,
  cleanTypedValues,
  ESTIMATED_BRAND,
  ESTIMATED_ID_PREFIX,
  kcalFromMacrosEu,
  MAX_ANALYSIS_PHOTOS,
  MAX_HINT_LENGTH,
  MAX_LABEL_PHOTOS,
  N,
  normalize,
  type AiAnalysisResult,
  type AiCandidate,
  type AiItem,
  type AiLabelResult,
  type Food,
  type NutrientMap,
} from '@ft/shared';
import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import {
  AiCallError,
  AiOutputError,
  AiRefusalError,
  type AiUsage,
  type ImageMediaType,
} from '../ai/analyze.js';
import { budgetExceeded } from '../ai/budget.js';
import { readingHasContent, sanitizeReading } from '../ai/label.js';
import { createFoodSearch } from '../ai/foodSearch.js';
import { matchItem, type LocalSearch } from '../ai/match.js';
import { requireUser } from '../auth/session.js';
import { customFoods } from '../db/schema.js';
import { sniffImage } from './photos.js';
import { aiAnalyses, aiFoodChoices } from '../db/schema.js';
import { log } from '../log.js';
import { RateLimiter } from '../rate-limit.js';
import type { AppEnv, Deps } from '../types.js';
import { parseJson } from './util.js';

/** The form field `typed` of an analysis: the typed values that are usable, or null. */
function typedValues(field: unknown) {
  if (typeof field !== 'string' || field.length > 500) return null;
  try {
    return cleanTypedValues(JSON.parse(field));
  } catch {
    return null;
  }
}

const MEDIA_TYPES: ImageMediaType[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // Claude API limit per image

/** Estimated kcal further than this from the macro formula are replaced by the formula's value. */
const KCAL_TOLERANCE = 0.2;

/**
 * A food made of the model's estimate (last resort, no database food and no components found). It
 * exists only in this analysis; the app marks it and logs it without a food id.
 */
export function estimatedFood(item: AiItem, id: string): Food | null {
  const e = item.estimate;
  if (!e) return null;
  const g = (v: number) => Math.round(Math.min(100, Math.max(0, v)) * 10) / 10;
  const nutrients: NutrientMap = {
    [N.protein]: g(e.protein),
    [N.carbs]: g(e.carbs),
    [N.sugar]: g(Math.min(e.sugar, e.carbs)),
    [N.fat]: g(e.fat),
    [N.satFat]: g(Math.min(e.satFat, e.fat)),
    [N.fiber]: g(e.fiber),
    [N.salt]: g(e.salt),
  };
  // More than 100 g of nutrients in 100 g: the model described something else than the item (seen:
  // a broth estimated as pure chili oil, 2.300 kcal for a bowl). No estimate is better than that one.
  const mass = nutrients[N.protein]! + nutrients[N.carbs]! + nutrients[N.fat]! + nutrients[N.fiber]!;
  if (mass > 100) return null;
  const formula = kcalFromMacrosEu(nutrients);
  const stated = Math.min(900, Math.max(0, e.kcal));
  const kcal = formula > 0 && Math.abs(stated - formula) > formula * KCAL_TOLERANCE ? formula : stated;
  if (kcal <= 0 && formula <= 0) return null;
  nutrients[N.kcal] = Math.round(kcal);
  nutrients[N.kj] = Math.round(kcal * 4.184);
  return {
    id,
    source: 'custom',
    sourceId: null,
    name: item.name,
    nameEn: null,
    brand: ESTIMATED_BRAND,
    group: null,
    unit: 'g',
    nutrients,
    portions: [],
    imageUrl: null,
    estimated: true,
  };
}

/**
 * Candidates of an item: the food the model chose and its alternatives (only ids its searches
 * returned). Without a valid choice its estimate comes first (the alternatives are then only
 * near misses to switch to), and without either the term matching without the model's choice.
 */
export function candidatesFor(
  item: AiItem,
  seen: ReadonlyMap<string, Food>,
  estimateId: string,
  searchLocal: LocalSearch,
  maxCandidates = 5,
): AiCandidate[] {
  const chosen = item.foodId ? seen.get(item.foodId) : undefined;
  const estimated = chosen ? null : estimatedFood(item, estimateId);
  const others = [...new Set(item.alternatives)]
    .filter((id) => id !== chosen?.id)
    .flatMap((id) => seen.get(id) ?? []);
  const foods = [chosen ?? estimated, ...others].filter((f) => !!f).slice(0, maxCandidates);
  if (foods.length > 0) return foods.map((food, i) => ({ food, score: 100 - i }));
  return matchItem(item, searchLocal, maxCandidates);
}

/**
 * Whole budget of one analysis over all tool rounds and retries. Below the device's 120 s, so the
 * person gets a clear answer instead of a client timeout while the server still pays for rounds.
 */
export const ANALYSIS_BUDGET_MS = 100_000;

/** Reads the uploaded images; the format comes from the bytes, not from the declared type. */
async function readImages(files: File[]): Promise<{ base64: string; mediaType: ImageMediaType }[] | null> {
  const out: { base64: string; mediaType: ImageMediaType }[] = [];
  for (const f of files) {
    const buf = Buffer.from(await f.arrayBuffer());
    const mediaType = sniffImage(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    if (!mediaType || !MEDIA_TYPES.includes(mediaType)) return null;
    out.push({ base64: buf.toString('base64'), mediaType });
  }
  return out;
}

export interface AiErrorInfo {
  status: ContentfulStatusCode;
  code: string;
  /** Refusals only: the category the safety classifier named. */
  category?: string | null;
}

/**
 * Status and error code of a failed Claude call (shared by meal photos and labels); null for errors
 * that are not about the call (a bug, the database).
 */
export function classifyAiError(e: unknown): AiErrorInfo | null {
  const cause = e instanceof AiCallError ? e.cause : e;
  if (cause instanceof AiRefusalError) return { status: 422, code: 'refused', category: cause.category };
  if (cause instanceof AiOutputError && cause.message === 'timeout')
    return { status: 504, code: 'ai_timeout' };
  if (cause instanceof AiOutputError) return { status: 502, code: 'no_result' };
  if (
    cause instanceof Anthropic.APIUserAbortError ||
    (cause instanceof DOMException && cause.name === 'TimeoutError')
  )
    return { status: 504, code: 'ai_timeout' };
  if (cause instanceof Anthropic.RateLimitError) return { status: 503, code: 'upstream_rate_limited' };
  if (cause instanceof Anthropic.AuthenticationError) return { status: 503, code: 'ai_misconfigured' };
  if (cause instanceof Anthropic.APIError) return { status: 502, code: 'upstream_error' };
  return null;
}

/** A request the route turns down before calling Claude (budget, rate limit). */
class AiRouteRefusal extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly body: Record<string, unknown>,
  ) {
    super(String(body.error));
  }
}

function aiError(c: Context<AppEnv>, e: unknown) {
  if (e instanceof AiRouteRefusal) return c.json(e.body, e.status);
  const info = classifyAiError(e);
  if (!info) throw e;
  const cause = e instanceof AiCallError ? e.cause : e;
  if (info.code === 'ai_misconfigured') log.error('Anthropic API key rejected');
  else if (cause instanceof Anthropic.APIError && info.code === 'upstream_error')
    log.error('Anthropic API error', { status: cause.status, message: cause.message });
  return c.json(
    info.category !== undefined ? { error: info.code, category: info.category } : { error: info.code },
    info.status,
  );
}

const NO_USAGE: AiUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

/** The device's idempotency key of a meal analysis (field `requestId`), or null. */
function requestIdOf(field: unknown): string | null {
  return typeof field === 'string' && /^[\w-]{1,64}$/.test(field) ? field : null;
}

function isUniqueViolation(e: unknown): boolean {
  const code = (x: unknown) => (x && typeof x === 'object' && 'code' in x ? x.code : undefined);
  return code(e) === '23505' || (e instanceof Error && code(e.cause) === '23505');
}

export function aiRoutes(deps: Deps) {
  const { db, analyzer, catalog } = deps;
  const limiter = new RateLimiter(60, 60 * 60_000);
  const budget = { dayUsd: deps.env.AI_BUDGET_DAY_USD, monthUsd: deps.env.AI_BUDGET_MONTH_USD };
  /** Meal analyses running in this process, by `<user>:<requestId>`: a repeated request waits for the same one. */
  const inflight = new Map<string, Promise<AiAnalysisResult>>();
  const app = new Hono<AppEnv>();
  app.use('*', requireUser(db));

  /**
   * The checks right before a paid call: the spending limit of the account (`ai/budget.ts`), then
   * the hourly rate limit as a second brake. Throws `AiRouteRefusal`.
   */
  const admit = async (userId: string) => {
    const over = await budgetExceeded(db, userId, budget);
    if (over) {
      log.warn('ai budget exceeded', { user: userId, scope: over });
      throw new AiRouteRefusal(429, { error: 'ai_budget', scope: over });
    }
    // Counted only for a request that is actually analysed (an invalid one costs nothing).
    if (limiter.take(userId) > 0) throw new AiRouteRefusal(429, { error: 'too_many_requests' });
  };

  /** Logs a failed call with what it cost (its rounds were paid for and count towards the budget). */
  const logFailure = async (
    e: unknown,
    row: {
      userId: string;
      model: string;
      userText: string | null;
      requestId?: string | null;
      started: number;
    },
    result: Record<string, unknown>,
  ) => {
    const usage = e instanceof AiCallError ? e.usage : NO_USAGE;
    const code = classifyAiError(e)?.code ?? 'internal';
    const model = (e instanceof AiCallError && e.model) || row.model;
    log.warn('ai call failed', {
      user: row.userId,
      model,
      code,
      ...usage,
      rounds: e instanceof AiCallError ? e.rounds : undefined,
      ms: Date.now() - row.started,
    });
    try {
      await db.insert(aiAnalyses).values({
        userId: row.userId,
        model,
        userText: row.userText,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costUsd: usage.costUsd,
        durationMs: Date.now() - row.started,
        status: 'failed',
        error: code,
        requestId: row.requestId ?? null,
        result: { ...result, failed: code },
      });
    } catch (err) {
      log.error('could not log a failed ai call', { error: String(err) });
    }
  };

  /** The answer an earlier successful analysis with this key gave (replayed without a Claude call). */
  const storedResponse = async (userId: string, requestId: string) => {
    const [prev] = await db
      .select({ response: aiAnalyses.response })
      .from(aiAnalyses)
      .where(
        and(eq(aiAnalyses.userId, userId), eq(aiAnalyses.requestId, requestId), eq(aiAnalyses.status, 'ok')),
      );
    return prev?.response ?? null;
  };

  // Own foods carry their record id (no prefix); catalog ids are "bls:…" or "off:…".
  const foodExists = async (foodId: string, userId: string): Promise<boolean> => {
    if (!foodId.includes(':')) {
      const [row] = await db
        .select({ id: customFoods.id })
        .from(customFoods)
        .where(and(eq(customFoods.userId, userId), eq(customFoods.id, foodId)));
      return !!row;
    }
    return (await catalog.get(foodId)) !== null;
  };

  app.get('/status', (c) =>
    c.json({ enabled: analyzer !== null, model: analyzer ? deps.env.AI_MODEL : null }),
  );

  app.post(
    '/analyze',
    bodyLimit({
      maxSize: MAX_ANALYSIS_PHOTOS * MAX_IMAGE_BYTES + 1024 * 1024,
      onError: (c) => c.json({ error: 'too_large' }, 413),
    }),
    async (c) => {
      if (!analyzer) return c.json({ error: 'ai_disabled' }, 503);
      const user = c.get('user');

      let form: FormData;
      try {
        form = await c.req.formData();
      } catch {
        return c.json({ error: 'expected_multipart' }, 400);
      }
      // One meal, one to MAX_ANALYSIS_PHOTOS photos (field `image` repeated, like the label reading), or
      // none and a description in `text` ("Eingeben" on the food page).
      const images = form.getAll('image');
      const text =
        typeof form.get('text') === 'string' ? (form.get('text') as string).slice(0, MAX_HINT_LENGTH) : null;
      // Values typed next to a description (field `typed`, JSON): a clue for the model. Anything
      // unreadable or implausible in it is ignored, never a reason to refuse the analysis.
      const typed = typedValues(form.get('typed'));
      if (!images.every((i) => i instanceof File)) return c.json({ error: 'image_missing' }, 400);
      if (images.length === 0 && !text?.trim()) return c.json({ error: 'image_missing' }, 400);
      if (images.length > MAX_ANALYSIS_PHOTOS) return c.json({ error: 'too_many_images' }, 400);
      const files = images as File[];
      if (files.some((f) => f.size > MAX_IMAGE_BYTES)) return c.json({ error: 'too_large' }, 413);
      const read = await readImages(files);
      if (!read) return c.json({ error: 'unsupported_image_type' }, 415);
      // The queue item's key: a repeated request (connection lost while the server analysed) gets the
      // stored answer, or waits for the analysis still running, instead of paying for a second one.
      const requestId = requestIdOf(form.get('requestId'));
      const key = requestId ? `${user.id}:${requestId}` : null;
      if (requestId) {
        const prev = await storedResponse(user.id, requestId);
        if (prev) return c.json(prev);
      }
      const running = key ? inflight.get(key) : undefined;
      if (running) {
        try {
          return c.json(await running);
        } catch (e) {
          return aiError(c, e);
        }
      }

      const run = async (): Promise<AiAnalysisResult> => {
        await admit(user.id);
        const started = Date.now();
        const foodSearch = await createFoodSearch(deps, user.id);
        let out;
        try {
          out = await analyzer.analyze(
            { images: read, text: text?.trim() || null, ...(typed && { typed }) },
            foodSearch.search,
            AbortSignal.timeout(ANALYSIS_BUDGET_MS),
          );
        } catch (e) {
          await logFailure(
            e,
            { userId: user.id, model: deps.env.AI_MODEL, userText: text, requestId, started },
            { photos: files.length },
          );
          throw e;
        }
        // The id is known before the insert: the stored answer contains it (and the estimate ids).
        const id = randomUUID();
        const items = out.items.map((item, i) => ({
          ...item,
          candidates: candidatesFor(item, foodSearch.seen, `${ESTIMATED_ID_PREFIX}${id}:${i}`, (q, n) =>
            catalog.searchLocal(q, n),
          ),
        }));
        const result: AiAnalysisResult = {
          analysisId: id,
          dishName: out.dishName,
          items,
          notes: out.notes,
          model: out.model,
          usage: out.usage,
        };
        try {
          await db.insert(aiAnalyses).values({
            id,
            userId: user.id,
            model: out.model,
            userText: text,
            inputTokens: out.usage.inputTokens,
            outputTokens: out.usage.outputTokens,
            costUsd: out.usage.costUsd,
            durationMs: Date.now() - started,
            // Only the number of photos is kept (no images), like the label reading.
            result: { dishName: out.dishName, items: out.items, notes: out.notes, photos: files.length },
            requestId,
            response: result,
          });
        } catch (e) {
          // The same key finished in another process (a restart between two requests): its answer counts.
          const prev = requestId && isUniqueViolation(e) ? await storedResponse(user.id, requestId) : null;
          if (prev) return prev;
          throw e;
        }
        log.info('ai analysis', {
          user: user.id,
          model: out.model,
          ...out.usage,
          ms: Date.now() - started,
          rounds: out.rounds,
          photos: files.length,
          items: items.length,
          chosen: out.items.filter((it) => it.foodId && foodSearch.seen.has(it.foodId)).length,
          estimated: items.filter((it) => it.candidates[0]?.food.estimated).length,
          unmatched: items.filter((it) => it.candidates.length === 0).length,
        });
        return result;
      };

      const job = run();
      if (key) {
        inflight.set(key, job);
        job.then(
          () => inflight.delete(key),
          () => inflight.delete(key),
        );
      }
      try {
        return c.json(await job);
      } catch (e) {
        return aiError(c, e);
      }
    },
  );

  /**
   * Foods the person picked in the review instead of the proposed one. Later analyses mark them in
   * the model's search results ("früher gewählt"). Estimated foods are not foods and are skipped.
   */
  app.post('/choices', async (c) => {
    const user = c.get('user');
    const body = await parseJson(c, aiChoicesSchema);
    if (!body.ok) return body.response;
    const [analysis] = await db
      .select({ id: aiAnalyses.id })
      .from(aiAnalyses)
      .where(and(eq(aiAnalyses.id, body.data.analysisId), eq(aiAnalyses.userId, user.id)));
    if (!analysis) return c.json({ error: 'not_found' }, 404);
    const rows = new Map<string, { userId: string; term: string; foodId: string }>();
    for (const ch of body.data.choices) {
      const term = normalize(ch.name);
      if (!term || ch.foodId.startsWith(ESTIMATED_ID_PREFIX)) continue;
      // Only foods that exist (catalog, or this person's own): the table feeds later prompts.
      if (!(await foodExists(ch.foodId, user.id))) continue;
      rows.set(`${term}\n${ch.foodId}`, { userId: user.id, term, foodId: ch.foodId });
    }
    if (rows.size > 0)
      await db
        .insert(aiFoodChoices)
        .values([...rows.values()])
        .onConflictDoUpdate({
          target: [aiFoodChoices.userId, aiFoodChoices.term, aiFoodChoices.foodId],
          set: { count: sql`${aiFoodChoices.count} + 1`, updatedAt: sql`now()` },
        });
    return c.json({ ok: true, saved: rows.size });
  });

  /**
   * The hint the person gave with an analysis; "Neu analysieren" of a logged group starts from it.
   */
  app.get('/analyses/:id/hint', async (c) => {
    const user = c.get('user');
    const id = z.uuid().safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'not_found' }, 404);
    const [analysis] = await db
      .select({ text: aiAnalyses.userText })
      .from(aiAnalyses)
      .where(and(eq(aiAnalyses.id, id.data), eq(aiAnalyses.userId, user.id)));
    if (!analysis) return c.json({ error: 'not_found' }, 404);
    return c.json({ text: analysis.text ?? '' });
  });

  /**
   * Food label photos (1 to `MAX_LABEL_PHOTOS`, field `image` repeated) → the values printed on it. The barcode is
   * kept only with a valid check digit. Shares the budget and the rate limit with the meal analysis.
   */
  app.post(
    '/label',
    bodyLimit({
      maxSize: MAX_LABEL_PHOTOS * MAX_IMAGE_BYTES + 1024 * 1024,
      onError: (c) => c.json({ error: 'too_large' }, 413),
    }),
    async (c) => {
      if (!analyzer) return c.json({ error: 'ai_disabled' }, 503);
      const user = c.get('user');
      let form: FormData;
      try {
        form = await c.req.formData();
      } catch {
        return c.json({ error: 'expected_multipart' }, 400);
      }
      const images = form.getAll('image');
      const text =
        typeof form.get('text') === 'string' ? (form.get('text') as string).slice(0, MAX_HINT_LENGTH) : null;
      if (images.length === 0 || !images.every((i) => i instanceof File))
        return c.json({ error: 'image_missing' }, 400);
      if (images.length > MAX_LABEL_PHOTOS) return c.json({ error: 'too_many_images' }, 400);
      const files = images as File[];
      if (files.some((f) => f.size > MAX_IMAGE_BYTES)) return c.json({ error: 'too_large' }, 413);
      const read = await readImages(files);
      if (!read) return c.json({ error: 'unsupported_image_type' }, 415);

      const started = Date.now();
      try {
        await admit(user.id);
        let out;
        try {
          out = await analyzer.readLabel(
            { images: read, text: text?.trim() || null },
            AbortSignal.timeout(ANALYSIS_BUDGET_MS),
          );
        } catch (e) {
          await logFailure(
            e,
            { userId: user.id, model: deps.env.AI_LABEL_MODEL ?? deps.env.AI_MODEL, userText: text, started },
            { kind: 'label', photos: files.length },
          );
          throw e;
        }
        const reading = sanitizeReading(out.reading);
        const barcode = cleanGtin(reading.barcode);
        const [row] = await db
          .insert(aiAnalyses)
          .values({
            userId: user.id,
            model: out.model,
            userText: text,
            inputTokens: out.usage.inputTokens,
            outputTokens: out.usage.outputTokens,
            costUsd: out.usage.costUsd,
            durationMs: Date.now() - started,
            result: { kind: 'label', photos: files.length, ...reading, barcode },
          })
          .returning({ id: aiAnalyses.id });
        log.info('ai label', {
          user: user.id,
          model: out.model,
          ...out.usage,
          ms: Date.now() - started,
          photos: files.length,
          barcode: barcode !== null,
        });
        if (!readingHasContent(reading)) return c.json({ error: 'no_label', notes: reading.notes }, 422);
        const result: AiLabelResult = {
          analysisId: row!.id,
          ...reading,
          barcode,
          model: out.model,
          usage: out.usage,
        };
        return c.json(result);
      } catch (e) {
        return aiError(c, e);
      }
    },
  );

  return app;
}
