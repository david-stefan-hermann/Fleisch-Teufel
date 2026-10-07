/**
 * Pure parsing helpers for the BLS 4.0 XLSX files (unit-tested with fixture rows).
 *
 * Data sheet layout (`BLS_4_0_Daten_2025_DE.xlsx`): columns `BLS Code`, `Lebensmittelbezeichnung`,
 * `Food name`, then per component three columns `<CODE> <Name> [<unit>/100g]`, `<CODE> Datenherkunft`,
 * `<CODE> Referenz`, and a final `Hinweis` column. Codes may contain `:` (e.g. `F18:3CN3`).
 */

export interface ValueColumn {
  code: string;
  name: string;
  unit: string;
  index: number;
}

export interface ParsedHeader {
  codeIndex: number;
  nameIndex: number;
  nameEnIndex: number;
  noteIndex: number | null;
  values: ValueColumn[];
}

const VALUE_HEADER = /^(\S+)\s+(.+?)\s*\[([^\]/]+)\/100\s?g\]$/;

export function parseHeader(header: readonly unknown[]): ParsedHeader {
  const cells = header.map((c) => (typeof c === 'string' ? c.trim() : ''));
  const find = (label: string) => {
    const i = cells.indexOf(label);
    if (i < 0) throw new Error(`BLS header: column "${label}" not found`);
    return i;
  };
  const codeIndex = find('BLS Code');
  const nameIndex = find('Lebensmittelbezeichnung');
  const nameEnIndex = find('Food name');
  const values: ValueColumn[] = [];
  cells.forEach((c, index) => {
    const m = VALUE_HEADER.exec(c);
    if (m) values.push({ code: m[1]!, name: m[2]!, unit: m[3]!, index });
  });
  if (values.length === 0) throw new Error('BLS header: no nutrient columns found');
  const note = cells.indexOf('Hinweis');
  return {
    codeIndex,
    nameIndex,
    nameEnIndex,
    noteIndex: note >= 0 ? note : null,
    values,
  };
}

/**
 * Cell → number. `-` (no data) → undefined. Values below detection/quantification limit
 * (`<LOD`, `<LOQ`, `TR` = trace) → 0: nutritionally negligible, and treating them as missing
 * would make sums look incomplete. Float noise from the export is rounded away.
 */
export function parseValue(cell: unknown): number | undefined {
  if (cell === null || cell === undefined) return undefined;
  if (typeof cell === 'number') return Number.isFinite(cell) ? cleanFloat(cell) : undefined;
  if (typeof cell === 'object' && 'result' in (cell as object))
    return parseValue((cell as { result: unknown }).result);
  const s = String(cell).trim();
  if (s === '' || s === '-') return undefined;
  if (/^(<\s*LOD|<\s*LOQ|TR)\b/i.test(s)) return 0;
  const n = Number.parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) ? cleanFloat(n) : undefined;
}

/** Rounds to 6 significant digits (enough for every BLS value, removes 0.30000000000000004 noise). */
export function cleanFloat(n: number): number {
  if (n === 0) return 0;
  return Number.parseFloat(n.toPrecision(6));
}

export interface BlsFood {
  code: string;
  name: string;
  nameEn: string;
  note: string | null;
  nutrients: Record<string, number>;
}

export function parseRow(row: readonly unknown[], header: ParsedHeader): BlsFood | null {
  const code = typeof row[header.codeIndex] === 'string' ? (row[header.codeIndex] as string).trim() : '';
  // "mostly [letter][6 digits]" (BLS docs) — some codes contain letters, e.g. M5B1600.
  if (!/^[A-Z][0-9A-Z]{6}$/.test(code)) return null;
  const nutrients: Record<string, number> = {};
  for (const col of header.values) {
    const v = parseValue(row[col.index]);
    if (v !== undefined) nutrients[col.code] = v;
  }
  const note = header.noteIndex === null ? null : row[header.noteIndex];
  return {
    code,
    name: String(row[header.nameIndex] ?? '').trim(),
    nameEn: String(row[header.nameEnIndex] ?? '').trim(),
    note: typeof note === 'string' && note.trim() ? note.trim() : null,
    nutrients,
  };
}

export interface CatalogEntry {
  code: string;
  de: string;
  en: string;
  unit: string;
  group: string;
  groupEn: string;
}

/** Components sheet: Index | Code | Name DE | Name EN | Unit | Group DE | Group EN | … */
export function parseComponentRow(row: readonly unknown[]): CatalogEntry | null {
  const [index, code, de, en, unit, group, groupEn] = row.map((c) => (typeof c === 'string' ? c.trim() : c));
  if (typeof index !== 'number' || typeof code !== 'string' || !code) return null;
  return {
    code,
    de: String(de ?? ''),
    en: String(en ?? ''),
    unit: String(unit ?? ''),
    group: String(group ?? ''),
    groupEn: String(groupEn ?? ''),
  };
}
