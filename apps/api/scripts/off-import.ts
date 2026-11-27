/**
 * Imports Open Food Facts' data export into `off_catalog` now, whatever the weekly schedule says:
 * `pnpm --filter @ft/api off:import [file-or-url]` (needs DATABASE_URL; default: the export's URL).
 * A running server reads the new state at its next start or weekly run.
 */
import { createDb, runMigrations } from '../src/db/client.js';
import { loadEnv } from '../src/env.js';
import { importOffCatalog } from '../src/off/import.js';

const env = loadEnv();
const db = createDb(env.DATABASE_URL, { max: 2 });
await runMigrations(db);
const started = Date.now();
const state = await importOffCatalog(
  db,
  process.argv[2] ?? env.OFF_DUMP_URL,
  `FleischTeufel/import (${env.OFF_CONTACT_EMAIL})`,
);
console.log(`${state.rows} products in ${Math.round((Date.now() - started) / 1000)} s`);
await db.$client.end({ timeout: 5 });
