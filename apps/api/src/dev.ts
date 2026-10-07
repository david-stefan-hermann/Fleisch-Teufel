/**
 * Development runner: starts an embedded PostgreSQL 17 (no Docker needed), then the API on
 * port 3000. Reads secrets from the root `.env`. The data directory defaults to
 * `~/.local/share/fleisch-teufel/dev-db` (override with DEV_DB_DIR): PostgreSQL requires 0700
 * permissions, which SMB-shared project folders usually cannot provide.
 */
import EmbeddedPostgres from 'embedded-postgres';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const envFile = resolve(root, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
  }
}

const port = Number(process.env.DEV_DB_PORT ?? 54329);
const dataDir = process.env.DEV_DB_DIR ?? resolve(homedir(), '.local/share/fleisch-teufel/dev-db');
mkdirSync(dirname(dataDir), { recursive: true });
if (existsSync(dataDir)) chmodSync(dataDir, 0o700);
const fresh = !!process.env.DEV_DB_FRESH;
const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  port,
  user: 'postgres',
  password: 'postgres',
  persistent: !fresh,
  onLog: () => {},
});
if (!existsSync(resolve(dataDir, 'PG_VERSION'))) await pg.initialise();
await pg.start();
try {
  await pg.createDatabase('fleisch_teufel');
} catch {
  /* exists */
}
process.env.DATABASE_URL ??= `postgres://postgres:postgres@127.0.0.1:${port}/fleisch_teufel`;
process.env.ALLOW_REGISTRATION ??= 'true';

// Only the API reloads on changes; the database keeps running.
const child = spawn(
  process.execPath,
  ['--import', 'tsx', '--watch', resolve(root, 'apps/api/src/server.ts')],
  {
    stdio: 'inherit',
    env: process.env,
  },
);
const stop = async () => {
  child.kill('SIGTERM');
  await pg.stop().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => {
  if (code !== null && code !== 0) void stop();
});
