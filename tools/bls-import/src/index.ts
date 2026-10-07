/**
 * BLS 4.0 import: download → unzip → parse XLSX → write
 *   apps/api/data/bls-4.0.json.gz          (all 138 components, server side)
 *   apps/web/public/data/bls-compact.json  (core nutrients, offline client search)
 *   packages/shared/src/nutrients-catalog.json
 *
 * Usage: pnpm bls:import [--zip path/to/BLS_4_0_2025_DE.zip] [--no-verify]
 * Source: Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0. Karlsruhe.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import ExcelJS from 'exceljs';
import { unzipSync } from 'fflate';
import { COMPACT_NUTRIENTS, type CompactBlsFile, type CompactBlsRow } from '@ft/shared';
import {
  parseComponentRow,
  parseHeader,
  parseRow,
  type BlsFood,
  type CatalogEntry,
  type ParsedHeader,
} from './parse.js';

export const BLS_URL = 'https://www.blsdb.de/assets/uploads/BLS_4_0_2025_DE.zip';
export const BLS_VERSION = '4.0-2025';
export const BLS_CITATION =
  'Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0. Karlsruhe.';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const cacheDir = resolve(here, '../cache');

async function loadZip(zipArg: string | undefined): Promise<Uint8Array> {
  if (zipArg) return new Uint8Array(await readFile(zipArg));
  const cached = join(cacheDir, 'BLS_4_0_2025_DE.zip');
  if (existsSync(cached)) return new Uint8Array(await readFile(cached));
  console.log(`Downloading ${BLS_URL} …`);
  const res = await fetch(BLS_URL);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  await mkdir(cacheDir, { recursive: true });
  await writeFile(cached, buf);
  return buf;
}

async function* sheetRows(xlsx: Uint8Array): AsyncGenerator<unknown[]> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(Buffer.from(xlsx)), {
    sharedStrings: 'cache',
    hyperlinks: 'ignore',
    styles: 'ignore',
    worksheets: 'emit',
  });
  for await (const ws of reader) {
    for await (const row of ws as AsyncIterable<ExcelJS.Row>) {
      // ExcelJS rows are 1-based sparse arrays.
      const values = row.values as unknown[];
      yield Array.from({ length: Math.max(0, values.length - 1) }, (_, i) => values[i + 1] ?? null);
    }
    break; // first sheet only
  }
}

export async function importBls(opts: { zip?: string; verify?: boolean } = {}) {
  const zip = unzipSync(await loadZip(opts.zip));
  const pick = (suffix: string) => {
    const name = Object.keys(zip).find((n) => n.endsWith(suffix));
    if (!name) throw new Error(`${suffix} not found in ZIP`);
    return zip[name]!;
  };

  const catalog: CatalogEntry[] = [];
  for await (const row of sheetRows(pick('BLS_4_0_Components_DE_EN.xlsx'))) {
    const c = parseComponentRow(row);
    if (c) catalog.push(c);
  }

  const foods: BlsFood[] = [];
  let header: ParsedHeader | undefined;
  for await (const row of sheetRows(pick('BLS_4_0_Daten_2025_DE.xlsx'))) {
    if (!header) {
      header = parseHeader(row);
      continue;
    }
    const f = parseRow(row, header);
    if (f) foods.push(f);
  }
  if (!header) throw new Error('empty data sheet');

  if (opts.verify !== false) verify(foods, catalog, header);

  const compactRows: CompactBlsRow[] = foods.map((f) => [
    f.code,
    f.name,
    f.nameEn,
    ...COMPACT_NUTRIENTS.map((k) => f.nutrients[k] ?? null),
  ]);
  const hash = createHash('sha256').update(JSON.stringify(compactRows)).digest('hex').slice(0, 8);
  const version = `${BLS_VERSION}+${hash}`;
  const compact: CompactBlsFile = { version, keys: [...COMPACT_NUTRIENTS], rows: compactRows };

  const full = { version, citation: BLS_CITATION, source: BLS_URL, foods };
  const out = {
    full: join(root, 'apps/api/data/bls-4.0.json.gz'),
    compact: join(root, 'apps/web/public/data/bls-compact.json'),
    catalog: join(root, 'packages/shared/src/nutrients-catalog.json'),
  };
  for (const p of Object.values(out)) await mkdir(dirname(p), { recursive: true });
  await writeFile(out.full, gzipSync(JSON.stringify(full), { level: 9 }));
  await writeFile(out.compact, JSON.stringify(compact));
  await writeFile(out.catalog, JSON.stringify(catalog, null, 1) + '\n');

  console.log(`BLS ${version}: ${foods.length} foods, ${header.values.length} components`);
  for (const [k, p] of Object.entries(out)) console.log(`  ${k}: ${p}`);
  return { foods, catalog, version };
}

function verify(foods: BlsFood[], catalog: CatalogEntry[], header: ParsedHeader) {
  const problems: string[] = [];
  if (foods.length !== 7140) problems.push(`expected 7140 foods, got ${foods.length}`);
  if (header.values.length !== 138)
    problems.push(`expected 138 nutrient columns, got ${header.values.length}`);
  if (catalog.length !== 138) problems.push(`expected 138 catalog entries, got ${catalog.length}`);
  const oat = foods.find((f) => f.code === 'C131000');
  if (oat?.nutrients.ENERCC !== 343)
    problems.push(`C131000 Hafer ENERCC expected 343, got ${oat?.nutrients.ENERCC}`);
  const missing = COMPACT_NUTRIENTS.filter((k) => !header.values.some((v) => v.code === k));
  if (missing.length) problems.push(`compact nutrients missing in BLS: ${missing.join(', ')}`);
  if (new Set(foods.map((f) => f.code)).size !== foods.length) problems.push('duplicate BLS codes');
  if (problems.length) throw new Error(`BLS verification failed:\n- ${problems.join('\n- ')}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const zipIdx = args.indexOf('--zip');
  importBls({ zip: zipIdx >= 0 ? args[zipIdx + 1] : undefined, verify: !args.includes('--no-verify') }).catch(
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
