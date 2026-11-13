/**
 * What every paid AI route shares (meal photos, labels, the assistant): the spending limit and the
 * hourly rate limit before a call, the error mapping, and the log row of a failed call. One gate per
 * app (`aiGate(deps)`), so all AI routes count against the same budget and the same limit.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { aiAnalyses } from '../db/schema.js';
import { log } from '../log.js';
import { RateLimiter } from '../rate-limit.js';
import type { AppEnv, Deps } from '../types.js';
import { AiCallError, AiOutputError, AiRefusalError, type AiUsage } from './analyze.js';
import { budgetExceeded } from './budget.js';

export interface AiErrorInfo {
  status: ContentfulStatusCode;
  code: string;
  /** Refusals only: the category the safety classifier named. */
  category?: string | null;
}

/**
 * An error that a non-Anthropic step (the transcription) maps itself: status and code as the routes
 * answer them, `usage` what it cost.
 */
export class UpstreamError extends Error {
  constructor(
    public readonly info: AiErrorInfo,
    message: string,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

/**
 * Status and error code of a failed AI call (meal photos, labels, the assistant); null for errors
 * that are not about the call (a bug, the database).
 */
export function classifyAiError(e: unknown): AiErrorInfo | null {
  const cause = e instanceof AiCallError ? e.cause : e;
  if (cause instanceof UpstreamError) return cause.info;
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

/** A request the route turns down before calling the model (budget, rate limit). */
export class AiRouteRefusal extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly body: Record<string, unknown>,
  ) {
    super(String(body.error));
  }
}

/** The answer to a failed AI request; rethrows what is no AI error. */
export function aiError(c: Context<AppEnv>, e: unknown) {
  if (e instanceof AiRouteRefusal) return c.json(e.body, e.status);
  const info = classifyAiError(e);
  if (!info) throw e;
  const cause = e instanceof AiCallError ? e.cause : e;
  if (info.code === 'ai_misconfigured') log.error('AI API key rejected');
  else if (cause instanceof Anthropic.APIError && info.code === 'upstream_error')
    log.error('Anthropic API error', { status: cause.status, message: cause.message });
  return c.json(
    info.category !== undefined ? { error: info.code, category: info.category } : { error: info.code },
    info.status,
  );
}

export const NO_USAGE: AiUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

/** The device's idempotency key of a request (field `requestId`), or null. */
export function requestIdOf(field: unknown): string | null {
  return typeof field === 'string' && /^[\w-]{1,64}$/.test(field) ? field : null;
}

export function isUniqueViolation(e: unknown): boolean {
  const code = (x: unknown) => (x && typeof x === 'object' && 'code' in x ? x.code : undefined);
  return code(e) === '23505' || (e instanceof Error && code(e.cause) === '23505');
}

export interface AiGate {
  /**
   * The checks right before a paid call: the spending limit of the account (`ai/budget.ts`), then
   * the hourly rate limit as a second brake. Throws `AiRouteRefusal`.
   */
  admit(userId: string): Promise<void>;
  /** Logs a failed call with what it cost (its rounds were paid for and count towards the budget). */
  logFailure(
    e: unknown,
    row: {
      userId: string;
      model: string;
      userText: string | null;
      requestId?: string | null;
      started: number;
    },
    result: Record<string, unknown>,
  ): Promise<void>;
}

const gates = new WeakMap<Deps, AiGate>();

/** The gate of this app (one rate limiter for all AI routes). */
export function aiGate(deps: Deps): AiGate {
  const known = gates.get(deps);
  if (known) return known;
  const { db } = deps;
  const limiter = new RateLimiter(60, 60 * 60_000);
  const budget = { dayUsd: deps.env.AI_BUDGET_DAY_USD, monthUsd: deps.env.AI_BUDGET_MONTH_USD };
  const gate: AiGate = {
    async admit(userId) {
      const over = await budgetExceeded(db, userId, budget);
      if (over) {
        log.warn('ai budget exceeded', { user: userId, scope: over });
        throw new AiRouteRefusal(429, { error: 'ai_budget', scope: over });
      }
      // Counted only for a request that is actually analysed (an invalid one costs nothing).
      if (limiter.take(userId) > 0) throw new AiRouteRefusal(429, { error: 'too_many_requests' });
    },
    async logFailure(e, row, result) {
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
    },
  };
  gates.set(deps, gate);
  return gate;
}
