import { APP_NAME, type ServerInfo } from '@ft/shared';
import { serveStatic } from '@hono/node-server/serve-static';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { secureHeaders } from 'hono/secure-headers';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { log } from './log.js';
import { aiRoutes } from './routes/ai.js';
import { authRoutes, registrationOpen } from './routes/auth.js';
import { foodRoutes } from './routes/foods.js';
import { syncRoutes } from './routes/sync.js';
import type { AppEnv, Deps } from './types.js';

export function createApp(deps: Deps, opts: { webDist?: string } = {}) {
  const app = new Hono<AppEnv>();

  app.onError((err, c) => {
    log.error('unhandled error', {
      path: c.req.path,
      error: err instanceof Error ? (err.stack ?? err.message) : String(err),
    });
    return c.json({ error: 'internal' }, 500);
  });

  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://images.openfoodfacts.org'],
        connectSrc: ["'self'"],
        scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        workerSrc: ["'self'", 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        manifestSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
      },
      crossOriginEmbedderPolicy: false,
      permissionsPolicy: { camera: ['self'], microphone: [], geolocation: [] },
    }),
  );
  app.use('*', compress());

  // CSRF: state-changing API calls must come from our own origin (cookies are SameSite=Lax too).
  app.use('/api/*', async (c, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      const origin = c.req.header('origin');
      if (origin) {
        const host = c.req.header('x-forwarded-host') ?? c.req.header('host');
        let originHost: string | null = null;
        try {
          originHost = new URL(origin).host;
        } catch {
          /* invalid origin */
        }
        if (!host || originHost !== host) return c.json({ error: 'forbidden_origin' }, 403);
      }
    }
    await next();
  });

  const health = async (c: import('hono').Context) => {
    try {
      await deps.db.execute(sql`select 1`);
      return c.json({ ok: true, version: deps.version, blsFoods: deps.catalog.blsCount });
    } catch {
      return c.json({ ok: false, error: 'database_unavailable' }, 503);
    }
  };
  app.get('/health', health);
  app.get('/api/health', health);

  app.get('/api/info', async (c) => {
    const info: ServerInfo = {
      name: APP_NAME,
      version: deps.version,
      registrationOpen: await registrationOpen(deps),
      aiEnabled: deps.analyzer !== null,
      blsVersion: deps.catalog.blsVersion,
    };
    return c.json(info);
  });

  app.route('/api/auth', authRoutes(deps));
  app.route('/api/sync', syncRoutes(deps));
  app.route('/api/foods', foodRoutes(deps));
  app.route('/api/ai', aiRoutes(deps));
  app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404));

  const dist = opts.webDist;
  if (dist && existsSync(join(dist, 'index.html'))) {
    const indexHtml = readFileSync(join(dist, 'index.html'), 'utf8');
    // Hashed build assets never change; everything else (sw.js, manifest, data) must revalidate.
    app.use('*', async (c, next) => {
      await next();
      if (c.req.path.startsWith('/api/') || c.res.headers.has('Cache-Control')) return;
      const immutable = /^\/assets\/.+-[A-Za-z0-9_-]{8,}\.\w+$/.test(c.req.path);
      c.res.headers.set('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
    });
    app.use('*', serveStatic({ root: dist }));
    // SPA fallback for client-side routes.
    app.get('*', (c) => {
      if (/\.\w{2,5}$/.test(c.req.path)) return c.notFound();
      c.header('Cache-Control', 'no-cache');
      return c.html(indexHtml);
    });
  }

  return app;
}
