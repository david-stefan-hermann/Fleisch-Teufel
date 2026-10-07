/**
 * CSV writer. Default dialect targets German Excel (semicolon separator, decimal comma, UTF-8 BOM)
 * so a double-click opens the file correctly; `dialect: 'standard'` produces RFC 4180 with `,` and `.`.
 */
export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | boolean | null | undefined;
}

export type CsvDialect = 'excel-de' | 'standard';

export function toCsv<T>(
  rows: readonly T[],
  columns: readonly CsvColumn<T>[],
  dialect: CsvDialect = 'excel-de',
): string {
  const sep = dialect === 'excel-de' ? ';' : ',';
  const cell = (v: string | number | boolean | null | undefined): string => {
    if (v === null || v === undefined) return '';
    let s: string;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return '';
      s = String(Math.round(v * 1000) / 1000);
      if (dialect === 'excel-de') s = s.replace('.', ',');
    } else {
      s = String(v);
    }
    // Quote when needed; neutralize spreadsheet formula injection (=, +, -, @ at start of text).
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return s.includes(sep) || /["\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => cell(c.header)).join(sep)];
  for (const r of rows) lines.push(columns.map((c) => cell(c.value(r))).join(sep));
  const body = lines.join('\r\n') + '\r\n';
  return dialect === 'excel-de' ? `\uFEFF${body}` : body;
}
