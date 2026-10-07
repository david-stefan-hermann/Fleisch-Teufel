import { Hono } from 'hono';
import { requireUser } from '../auth/session.js';
import { log } from '../log.js';
import { OffRateLimitedError } from '../off/client.js';
import type { AppEnv, Deps } from '../types.js';

export function foodRoutes({ db, catalog }: Deps) {
  const app = new Hono<AppEnv>();
  app.use('*', requireUser(db));

  /** Online search in Open Food Facts (the device searches BLS itself, offline). */
  app.get('/search', async (c) => {
    const q = (c.req.query('q') ?? '').trim();
    const limit = Math.min(50, Math.max(1, Number(c.req.query('limit') ?? 20) || 20));
    if (q.length < 2) return c.json({ foods: [], limited: false });
    const local = c.req.query('source') === 'local';
    if (local) return c.json({ foods: catalog.searchLocal(q, limit).map((h) => h.food), limited: false });
    return c.json(await catalog.searchOff(q.slice(0, 100), limit));
  });

  app.get('/barcode/:ean', async (c) => {
    try {
      const food = await catalog.barcode(c.req.param('ean'));
      return food ? c.json({ food }) : c.json({ error: 'not_found' }, 404);
    } catch (e) {
      if (e instanceof OffRateLimitedError) {
        c.header('Retry-After', String(Math.ceil(e.retryAfterMs / 1000)));
        return c.json({ error: 'rate_limited' }, 429);
      }
      log.warn('barcode lookup failed', { error: String(e) });
      return c.json({ error: 'upstream_unavailable' }, 502);
    }
  });

  app.get('/:id', async (c) => {
    const food = await catalog.get(c.req.param('id'));
    return food ? c.json({ food }) : c.json({ error: 'not_found' }, 404);
  });

  return app;
}
