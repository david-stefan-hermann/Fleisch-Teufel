import type { Food } from '@ft/shared';
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { inject } from 'vitest';
import type { FoodAnalyzer } from '../src/ai/analyze.js';
import { createApp } from '../src/app.js';
import { createDb, runMigrations, type Db } from '../src/db/client.js';
import { loadEnv } from '../src/env.js';
import { FoodCatalog, type BlsFile } from '../src/foods/catalog.js';
import type { OffClient } from '../src/off/client.js';
import type { Deps } from '../src/types.js';

export const BLS_FIXTURE: BlsFile = {
  version: 'test-1',
  citation: 'test',
  foods: [
    {
      code: 'C133000',
      name: 'Hafer Flocken',
      nameEn: 'Oat flakes',
      note: null,
      nutrients: { ENERCC: 348, PROT625: 13.22, FAT: 6.65, CHO: 53.3, FIBT: 10.98, VITB12: 0 },
    },
    {
      code: 'V411100',
      name: 'Hähnchen Brust, ohne Haut, roh',
      nameEn: 'Chicken breast, raw',
      note: null,
      nutrients: { ENERCC: 102, PROT625: 23, FAT: 1 },
    },
    {
      code: 'V411180',
      name: 'Hähnchen Brust, ohne Haut, gebraten ohne Fett (Pfanne)',
      nameEn: 'Chicken breast, fried',
      note: null,
      nutrients: { ENERCC: 140, PROT625: 30, FAT: 2 },
    },
    {
      code: 'E411000',
      name: 'Teigwaren eifrei, gekocht',
      nameEn: 'Pasta, cooked',
      note: null,
      nutrients: { ENERCC: 150, PROT625: 5, FAT: 0.6, CHO: 30 },
    },
    {
      code: 'Q110000',
      name: 'Rapsöl',
      nameEn: 'Rapeseed oil',
      note: null,
      nutrients: { ENERCC: 900, FAT: 100 },
    },
    {
      code: 'M5B1600',
      name: 'Gouda mind. 45 % Fett i. Tr.',
      nameEn: 'Gouda',
      note: null,
      nutrients: { ENERCC: 356, NA: 800 },
    },
  ],
};

export function fakeOff(overrides: Partial<OffClient> = {}): OffClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async product(ean) {
      calls.push(`product:${ean}`);
      return overrides.product ? overrides.product(ean) : null;
    },
    async search(q, limit) {
      calls.push(`search:${q}`);
      return overrides.search ? overrides.search(q, limit) : [];
    },
  };
}

export interface TestCtx {
  deps: Deps;
  db: Db;
  app: ReturnType<typeof createApp>;
  off: ReturnType<typeof fakeOff>;
  close: () => Promise<void>;
}

export async function createTestContext(
  opts: {
    off?: Partial<OffClient>;
    analyzer?: FoodAnalyzer | null;
    env?: Record<string, string>;
    bls?: BlsFile;
  } = {},
): Promise<TestCtx> {
  const base = inject('pgUrl');
  const name = `t_${randomBytes(6).toString('hex')}`;
  const admin = postgres(`${base}/postgres`, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database ${name}`);
  await admin.end();
  const env = loadEnv({ DATABASE_URL: `${base}/${name}`, NODE_ENV: 'test', ...opts.env });
  const db = createDb(env.DATABASE_URL, { max: 4 });
  await runMigrations(db);
  const off = fakeOff(opts.off);
  const catalog = new FoodCatalog(db, off, opts.bls ?? BLS_FIXTURE);
  await catalog.init();
  const deps: Deps = { db, env, catalog, off, analyzer: opts.analyzer ?? null, version: 'test' };
  return { deps, db, app: createApp(deps), off, close: () => db.$client.end({ timeout: 1 }) };
}

/** Minimal cookie-aware client around `app.request`. */
export class TestClient {
  cookie: string | null = null;
  constructor(
    private readonly app: TestCtx['app'],
    private readonly headers: Record<string, string> = {},
  ) {}

  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const h: Record<string, string> = { ...this.headers, ...headers };
    if (this.cookie) h.cookie = this.cookie;
    let payload: FormData | string | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      h['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await this.app.request(path, { method, headers: h, body: payload });
    const set = res.headers.get('set-cookie');
    if (set) {
      const m = /ft_session=([^;]*)/.exec(set);
      if (m) this.cookie = m[1] ? `ft_session=${m[1]}` : null;
    }
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, json, headers: res.headers };
  }

  get = (p: string, h?: Record<string, string>) => this.req('GET', p, undefined, h);
  post = (p: string, b?: unknown, h?: Record<string, string>) => this.req('POST', p, b, h);
}

export async function registeredClient(
  ctx: TestCtx,
  email = 'a@example.com',
  password = 'secret-password',
): Promise<TestClient> {
  const c = new TestClient(ctx.app);
  let r = await c.post('/api/auth/register', { email, password });
  if (r.status === 403 || r.status === 409) r = await c.post('/api/auth/login', { email, password });
  if (r.status >= 300) throw new Error(`auth failed: ${r.status} ${JSON.stringify(r.json)}`);
  return c;
}

export const offFood = (ean: string, name = 'Testprodukt'): Food => ({
  id: `off:${ean}`,
  source: 'off',
  sourceId: ean,
  name,
  nameEn: null,
  brand: 'Marke',
  group: null,
  unit: 'g',
  nutrients: { ENERCC: 500, ENERCJ: 2092 },
  portions: [{ label: 'Portion (30 g)', grams: 30 }],
  imageUrl: null,
});
