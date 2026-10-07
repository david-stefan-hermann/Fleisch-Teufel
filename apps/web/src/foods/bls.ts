/**
 * Offline BLS catalog: the compact BLS file (`/data/bls-compact.json`, precached by the service
 * worker) is stored in IndexedDB once per version and kept in memory as a search index.
 */
import {
  COMPACT_NUTRIENTS,
  foodFromCompactBls,
  indexItem,
  type CompactBlsFile,
  type CompactBlsRow,
  type Food,
  type IndexedItem,
} from '@ft/shared';
import { CommonDb } from '@/db/dexie';

let common: CommonDb | null = null;
const commonDb = () => (common ??= new CommonDb());

interface BlsIndex {
  version: string;
  foods: Map<string, Food>;
  index: IndexedItem<Food>[];
}

let loading: Promise<BlsIndex> | null = null;

async function build(rows: CompactBlsRow[], keys: readonly string[], version: string): Promise<BlsIndex> {
  const foods = new Map<string, Food>();
  for (const r of rows) {
    const f = foodFromCompactBls(r, keys);
    foods.set(f.id, f);
  }
  return { version, foods, index: [...foods.values()].map(indexItem) };
}

async function load(): Promise<BlsIndex> {
  const db = commonDb();
  const stored = (await db.kv.get('bls.version'))?.value as string | undefined;
  const storedKeys = ((await db.kv.get('bls.keys'))?.value as string[] | undefined) ?? [...COMPACT_NUTRIENTS];
  let remote: CompactBlsFile | null = null;
  try {
    const res = await fetch('/data/bls-compact.json');
    if (res.ok) remote = (await res.json()) as CompactBlsFile;
  } catch {
    /* offline and not precached yet → use IndexedDB */
  }
  if (remote && remote.version !== stored) {
    await db.transaction('rw', db.bls, db.kv, async () => {
      await db.bls.clear();
      await db.bls.bulkPut(remote.rows.map((row) => ({ id: row[0], row })));
      await db.kv.bulkPut([
        { key: 'bls.version', value: remote.version },
        { key: 'bls.keys', value: remote.keys },
      ]);
    });
    return build(remote.rows, remote.keys, remote.version);
  }
  if (remote) return build(remote.rows, remote.keys, remote.version);
  const rows = (await db.bls.toArray()).map((r) => r.row as CompactBlsRow);
  if (rows.length === 0) throw new Error('BLS not available offline yet');
  return build(rows, storedKeys, stored ?? 'unknown');
}

export function loadBls(): Promise<BlsIndex> {
  loading ??= load().catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}
