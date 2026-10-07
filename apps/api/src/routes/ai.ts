import type { AiAnalysisResult } from '@ft/shared';
import Anthropic from '@anthropic-ai/sdk';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { AiOutputError, AiRefusalError, type ImageMediaType } from '../ai/analyze.js';
import { matchItem } from '../ai/match.js';
import { requireUser } from '../auth/session.js';
import { aiAnalyses } from '../db/schema.js';
import { log } from '../log.js';
import { RateLimiter } from '../rate-limit.js';
import type { AppEnv, Deps } from '../types.js';

const MEDIA_TYPES: ImageMediaType[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // Claude API limit per image

export function aiRoutes(deps: Deps) {
  const { db, analyzer, catalog } = deps;
  const limiter = new RateLimiter(60, 60 * 60_000);
  const app = new Hono<AppEnv>();
  app.use('*', requireUser(db));

  app.get('/status', (c) =>
    c.json({ enabled: analyzer !== null, model: analyzer ? deps.env.AI_MODEL : null }),
  );

  app.post(
    '/analyze',
    bodyLimit({ maxSize: 8 * 1024 * 1024, onError: (c) => c.json({ error: 'too_large' }, 413) }),
    async (c) => {
      if (!analyzer) return c.json({ error: 'ai_disabled' }, 503);
      const user = c.get('user');
      if (limiter.take(user.id) > 0) return c.json({ error: 'too_many_requests' }, 429);

      let form: FormData;
      try {
        form = await c.req.formData();
      } catch {
        return c.json({ error: 'expected_multipart' }, 400);
      }
      const image = form.get('image');
      const text = typeof form.get('text') === 'string' ? (form.get('text') as string).slice(0, 1000) : null;
      if (!(image instanceof File)) return c.json({ error: 'image_missing' }, 400);
      const mediaType = image.type as ImageMediaType;
      if (!MEDIA_TYPES.includes(mediaType)) return c.json({ error: 'unsupported_image_type' }, 415);
      if (image.size > MAX_IMAGE_BYTES) return c.json({ error: 'too_large' }, 413);

      const started = Date.now();
      try {
        const out = await analyzer.analyze({
          imageBase64: Buffer.from(await image.arrayBuffer()).toString('base64'),
          mediaType,
          text: text?.trim() || null,
        });
        const items = out.items.map((item) => ({
          ...item,
          candidates: matchItem(item, (q, n) => catalog.searchLocal(q, n)),
        }));
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
            result: { dishName: out.dishName, items: out.items, notes: out.notes },
          })
          .returning({ id: aiAnalyses.id });
        log.info('ai analysis', {
          user: user.id,
          model: out.model,
          ...out.usage,
          ms: Date.now() - started,
          items: items.length,
        });
        const result: AiAnalysisResult = {
          analysisId: row!.id,
          dishName: out.dishName,
          items,
          notes: out.notes,
          model: out.model,
          usage: out.usage,
        };
        return c.json(result);
      } catch (e) {
        if (e instanceof AiRefusalError) return c.json({ error: 'refused', category: e.category }, 422);
        if (e instanceof AiOutputError) return c.json({ error: 'no_result' }, 502);
        if (e instanceof Anthropic.RateLimitError) return c.json({ error: 'upstream_rate_limited' }, 503);
        if (e instanceof Anthropic.AuthenticationError) {
          log.error('Anthropic API key rejected');
          return c.json({ error: 'ai_misconfigured' }, 503);
        }
        if (e instanceof Anthropic.APIError) {
          log.error('Anthropic API error', { status: e.status, message: e.message });
          return c.json({ error: 'upstream_error' }, 502);
        }
        throw e;
      }
    },
  );

  return app;
}
