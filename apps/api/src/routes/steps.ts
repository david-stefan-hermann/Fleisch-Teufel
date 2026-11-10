/**
 * Steps from Apple Health. The app creates a personal access token (`api_tokens`, kind `steps`); an
 * iOS shortcut sends the last week of steps and walking distance with it to `POST /import`, and the
 * server keeps one training per day (`s:<date>`) up to date. The token is good for this route only,
 * a session token is refused here, and the writes go through the normal sync (`push`), so every
 * device gets them with its next pull.
 */
import {
  DEFAULT_WEIGHT_KG,
  nextVersion,
  weightForDay,
  STEPS_LOG_SIZE,
  type ExerciseEntry,
  type StepsImportLog,
  type StepsStatus,
} from '@ft/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { createHash, randomBytes } from 'node:crypto';
import { requireUser } from '../auth/session.js';
import { apiTokens, exerciseEntries, userSettings, weightEntries } from '../db/schema.js';
import { log } from '../log.js';
import { RateLimiter } from '../rate-limit.js';
import {
  stepsDays,
  stepsImportSchema,
  stepsRecord,
  stepsWarnings,
  hasUsableDistance,
  type StepsDay,
} from '../steps/import.js';
import { StepsParseError } from '../steps/parse.js';
import { lockUser, push, toWire } from '../sync/service.js';
import type { Db } from '../db/client.js';
import type { AppEnv, Deps } from '../types.js';
import { clientIp, parseJson } from './util.js';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Token prefix, so a leaked token says what it is for. */
const TOKEN_PREFIX = 'ftst_';

type StepsEnv = { Variables: { stepsUser: string; stepsToken: string } };

function bearer(header: string | undefined): string | null {
  return header?.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() || null : null;
}

/** Accepts only a steps token (looked up in `api_tokens`); sessions are no access here. */
function requireApiToken(db: Db, failures: RateLimiter): MiddlewareHandler<StepsEnv> {
  return async (c, next) => {
    const ipKey = clientIp(c);
    const wait = failures.blocked(ipKey);
    if (wait > 0) return c.json({ error: 'too_many_requests', retryAfterMs: wait }, 429);
    const token = bearer(c.req.header('authorization'));
    const [row] = token
      ? await db
          .select({ id: apiTokens.id, userId: apiTokens.userId })
          .from(apiTokens)
          .where(and(eq(apiTokens.id, sha256(token)), eq(apiTokens.kind, 'steps')))
      : [];
    if (!row) {
      failures.take(ipKey);
      return c.json({ error: 'unauthorized' }, 401);
    }
    c.set('stepsUser', row.userId);
    c.set('stepsToken', row.id);
    await next();
  };
}

export interface StepsImportResult {
  ok: true;
  days: { date: string; steps: number; written: boolean }[];
  /** Readable in the shortcut's answer: what went through but looks wrong. */
  warnings: string[];
}

/**
 * Writes the days of one import in one transaction under the user's sync lock: reads the steps
 * entries of these days (tombstones included), the minimum and the weights, and pushes what changed.
 */
export async function importSteps(db: Db, userId: string, days: StepsDay[], now = Date.now()) {
  const written = new Set<string>();
  await db.transaction(async (tx) => {
    await lockUser(tx, userId);
    const ids = days.map((d) => `s:${d.date}`);
    const rows = ids.length
      ? ((await tx
          .select()
          .from(exerciseEntries)
          .where(and(eq(exerciseEntries.userId, userId), inArray(exerciseEntries.id, ids)))) as Record<
          string,
          unknown
        >[])
      : [];
    const existing = new Map(rows.map((r) => [r.id as string, toWire(r) as ExerciseEntry]));
    const [settings] = await tx
      .select({ stepsMinimum: userSettings.stepsMinimum })
      .from(userSettings)
      .where(eq(userSettings.userId, userId));
    const weights = await tx
      .select({ date: weightEntries.date, kg: weightEntries.kg, deleted: weightEntries.deleted })
      .from(weightEntries)
      .where(eq(weightEntries.userId, userId));
    const points = weights.filter((w) => !w.deleted);
    const records = [];
    for (const day of days) {
      const prev = existing.get(`s:${day.date}`);
      const rec = stepsRecord({
        day,
        existing: prev,
        weightKg: weightForDay(points, day.date) ?? DEFAULT_WEIGHT_KG,
        minimum: settings?.stepsMinimum ?? null,
        now,
      });
      if (!rec) continue;
      // A device may run up to five minutes ahead: the new version must still beat what it wrote.
      records.push({
        table: 'exerciseEntries' as const,
        data: { ...rec, updatedAt: nextVersion(prev?.updatedAt, now) },
      });
      written.add(day.date);
    }
    if (records.length) {
      const result = await push(tx, userId, { records }, now);
      if (result.stale.length || result.rejected.length)
        throw new Error(
          `steps import not applied: ${JSON.stringify({ stale: result.stale, rejected: result.rejected })}`,
        );
    }
  });
  return days.map((d) => ({ date: d.date, steps: d.steps, written: written.has(d.date) }));
}

export function stepsRoutes(deps: Deps) {
  const { db } = deps;
  const app = new Hono<AppEnv & StepsEnv>();
  /** Wrong tokens per IP, and imports per token (a shortcut runs a few times a day). */
  const failures = new RateLimiter(20, 15 * 60_000);
  const imports = new RateLimiter(60, 60 * 60_000);

  /** Notes a call on the token: `lastUsedAt` (↻ waits for it) and the list of the last calls. */
  async function remember(tokenId: string, entry: Omit<StepsImportLog, 'at'>) {
    const now = new Date();
    const item: StepsImportLog = { at: now.getTime(), ...entry };
    await db
      .update(apiTokens)
      .set({
        lastUsedAt: now,
        recent: sql`(jsonb_build_array(${JSON.stringify(item)}::jsonb) || coalesce(${apiTokens.recent}, '[]'::jsonb)) - ${STEPS_LOG_SIZE}::int`,
      })
      .where(eq(apiTokens.id, tokenId));
  }

  /** A call that could not be read: logged, kept in the list of calls, answered with the reason. */
  async function refuse(tokenId: string, message: string, status: 400 | 500, c: Context) {
    log.warn('steps import refused', { message });
    await remember(tokenId, { days: 0, written: 0, withDistance: 0, error: message, warnings: [] });
    return c.json({ error: status === 400 ? 'validation' : 'internal', message }, status);
  }

  app.post('/import', requireApiToken(db, failures), async (c) => {
    const tokenId = c.get('stepsToken');
    const wait = imports.take(tokenId);
    if (wait > 0) return c.json({ error: 'too_many_requests', retryAfterMs: wait }, 429);
    const body = await parseJson(c, stepsImportSchema);
    if (!body.ok) {
      const json = (await body.response.clone().json()) as {
        error: string;
        issues?: { path: string; message: string }[];
      };
      const message =
        json.error === 'invalid_json'
          ? 'Kein gültiges JSON (Anfragetext „JSON“ wählen).'
          : `Felder passen nicht: ${(json.issues ?? []).map((i) => `${i.path}: ${i.message}`).join('; ')}`;
      return refuse(tokenId, message, 400, c);
    }
    let days: StepsDay[];
    try {
      days = stepsDays(body.data);
    } catch (e) {
      if (e instanceof StepsParseError) return refuse(tokenId, e.message, 400, c);
      throw e;
    }
    const userId = c.get('stepsUser');
    let result: StepsImportResult['days'];
    try {
      result = await importSteps(db, userId, days);
    } catch (e) {
      log.error('steps import failed', { error: e instanceof Error ? e.message : String(e) });
      return refuse(tokenId, 'Fehler auf dem Server.', 500, c);
    }
    const warnings = stepsWarnings(days);
    const written = result.filter((d) => d.written).length;
    const withDistance = days.filter(hasUsableDistance).length;
    log.info('steps import', { days: days.length, written, withDistance, warnings: warnings.length });
    await remember(tokenId, { days: days.length, written, withDistance, error: null, warnings });
    const out: StepsImportResult = { ok: true, days: result, warnings };
    return c.json(out);
  });

  const user = requireUser(db);

  app.get('/status', user, async (c) => {
    const me = c.get('user');
    const [row] = await db
      .select({ createdAt: apiTokens.createdAt, lastUsedAt: apiTokens.lastUsedAt, recent: apiTokens.recent })
      .from(apiTokens)
      .where(and(eq(apiTokens.userId, me.id), eq(apiTokens.kind, 'steps')));
    const status: StepsStatus = {
      configured: !!row,
      createdAt: row?.createdAt.getTime() ?? null,
      lastUsedAt: row?.lastUsedAt?.getTime() ?? null,
      recent: row?.recent ?? [],
    };
    return c.json(status);
  });

  /** Creates the access or replaces it (the old token stops working); the token is in this answer only. */
  app.post('/token', user, async (c) => {
    const me = c.get('user');
    const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
    await db.transaction(async (tx) => {
      await tx.delete(apiTokens).where(and(eq(apiTokens.userId, me.id), eq(apiTokens.kind, 'steps')));
      await tx.insert(apiTokens).values({ id: sha256(token), userId: me.id, kind: 'steps' });
    });
    return c.json({ token });
  });

  app.delete('/token', user, async (c) => {
    const me = c.get('user');
    await db.delete(apiTokens).where(and(eq(apiTokens.userId, me.id), eq(apiTokens.kind, 'steps')));
    return c.json({ ok: true });
  });

  return app;
}
