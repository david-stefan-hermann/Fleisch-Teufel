/** Production entry: migrate → seed BLS → serve API + web app on PORT (3000). */
import { serve } from '@hono/node-server';
import { APP_NAME } from '@ft/shared';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClaudeAnalyzer } from './ai/analyze.js';
import { createApp } from './app.js';
import { createDb, runMigrations } from './db/client.js';
import { loadEnv, type Env } from './env.js';
import { FoodCatalog, loadBls } from './foods/catalog.js';
import { log, setLogLevel } from './log.js';
import { createOffClient } from './off/client.js';
import type { Deps } from './types.js';

declare const __APP_VERSION__: string | undefined;
export const VERSION =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : (process.env.APP_VERSION ?? 'dev');

export async function buildDeps(env: Env): Promise<Deps> {
  const db = createDb(env.DATABASE_URL);
  await runMigrations(db);
  const off = createOffClient({
    baseUrl: env.OFF_BASE_URL,
    searchUrl: env.OFF_SEARCH_URL,
    userAgent: `FleischTeufel/${VERSION} (${env.OFF_CONTACT_EMAIL})`,
  });
  const catalog = new FoodCatalog(db, off, loadBls());
  await catalog.init();
  const analyzer =
    env.aiEnabled && env.ANTHROPIC_API_KEY
      ? createClaudeAnalyzer({ apiKey: env.ANTHROPIC_API_KEY, model: env.AI_MODEL, effort: env.AI_EFFORT })
      : null;
  return { db, env, catalog, off, analyzer, version: VERSION };
}

export async function main() {
  const env = loadEnv();
  setLogLevel(env.LOG_LEVEL);
  const deps = await buildDeps(env);
  const here = dirname(fileURLToPath(import.meta.url));
  const webDist = env.WEB_DIST ?? resolve(here, 'public');
  const app = createApp(deps, { webDist });
  const server = serve({ fetch: app.fetch, port: env.PORT, hostname: env.HOST }, (info) => {
    log.info(`${APP_NAME} ${VERSION} listening`, {
      port: info.port,
      ai: deps.analyzer !== null,
      registration: env.ALLOW_REGISTRATION,
    });
  });
  const shutdown = (signal: string) => {
    log.info('shutting down', { signal });
    server.close(() => {
      void deps.db.$client.end({ timeout: 5 }).finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    log.error('startup failed', { error: e instanceof Error ? (e.stack ?? e.message) : String(e) });
    process.exit(1);
  });
}
