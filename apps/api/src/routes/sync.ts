import { MAX_PULL_RECORDS, pushRequestSchema } from '@ft/shared';
import { Hono } from 'hono';
import { requireUser } from '../auth/session.js';
import { pull, push } from '../sync/service.js';
import type { AppEnv, Deps } from '../types.js';
import { parseJson } from './util.js';

export function syncRoutes({ db }: Deps) {
  const app = new Hono<AppEnv>();
  app.use('*', requireUser(db));

  app.post('/push', async (c) => {
    const body = await parseJson(c, pushRequestSchema);
    if (!body.ok) return body.response;
    return c.json(await push(db, c.get('user').id, body.data));
  });

  app.get('/pull', async (c) => {
    const since = Number(c.req.query('since') ?? 0);
    const limit = Math.min(MAX_PULL_RECORDS, Math.max(1, Number(c.req.query('limit') ?? MAX_PULL_RECORDS)));
    if (!Number.isSafeInteger(since) || since < 0 || !Number.isFinite(limit))
      return c.json({ error: 'invalid_cursor' }, 400);
    return c.json(await pull(db, c.get('user').id, since, Math.floor(limit)));
  });

  return app;
}
