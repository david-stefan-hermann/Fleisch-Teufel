import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import * as schema from './schema.js';

export type Db = PostgresJsDatabase<typeof schema> & { $client: postgres.Sql };

export function createDb(url: string, opts: { max?: number } = {}): Db {
  const client = postgres(url, { max: opts.max ?? 10, onnotice: () => {} });
  return drizzle({ client, schema, casing: 'snake_case' }) as Db;
}

/** Migrations folder: next to the bundle in production (`dist/drizzle`), `apps/api/drizzle` in dev. */
export function migrationsFolder(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    resolve(here, 'drizzle'),
    resolve(here, '../drizzle'),
    resolve(here, '../../drizzle'),
  ]) {
    if (existsSync(resolve(candidate, 'meta/_journal.json'))) return candidate;
  }
  throw new Error('drizzle migrations folder not found');
}

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: migrationsFolder() });
}
