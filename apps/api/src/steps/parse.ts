/**
 * Reading what the iOS shortcut sends. Shortcuts hand lists over as arrays or as text with one line
 * per item, dates in the format of the phone unless the shortcut sets one, numbers with a comma and
 * sometimes a unit. Everything here is pure, so the tests can feed it the exact text an iPhone sent.
 */
import { isISODate, type ISODate } from '@ft/shared';

/** More lines than a week of single Health samples ever has. */
export const MAX_LINES = 20_000;

export class StepsParseError extends Error {}

/** A list from the shortcut: an array of strings or numbers, or text with one item per line. */
export function parseList(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  let items: unknown[];
  if (Array.isArray(value)) items = value;
  else if (typeof value === 'string' || typeof value === 'number') items = String(value).split(/\r\n|\r|\n/);
  else throw new StepsParseError(`${field}: expected a list or text`);
  const lines = items.map((v) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : null));
  if (lines.some((l) => l === null)) throw new StepsParseError(`${field}: expected text or numbers`);
  const out = (lines as string[]).filter((l) => l !== '');
  if (out.length > MAX_LINES) throw new StepsParseError(`${field}: more than ${MAX_LINES} lines`);
  return out;
}

/**
 * The calendar day of a date as the iPhone wrote it: ISO 8601 (`2026-11-10`, `2026-11-10T14:02:11+01:00`:
 * the first ten characters, the phone's local day) or day first (`10.11.2026, 14:02`, `10/11/2026`).
 */
export function parseDay(text: string): ISODate | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) {
    const day = `${iso[1]}-${iso[2]}-${iso[3]}`;
    return isISODate(day) ? day : null;
  }
  const dmy = /^(\d{1,2})[./](\d{1,2})[./](\d{4})(?!\d)/.exec(text);
  if (dmy) {
    const day = `${dmy[3]}-${dmy[2]!.padStart(2, '0')}-${dmy[1]!.padStart(2, '0')}`;
    return isISODate(day) ? day : null;
  }
  return null;
}

/** Separators a phone may put between thousands. */
const GROUP = /[.,'’\u00a0\u202f ]/;

/**
 * The leading number of a value: `8432`, `8.432` or `8 432 Schritte` (a count: a separator before
 * exactly three digits groups thousands), `6,1 km`, `6.1` (a distance: one separator is the decimal
 * point; with both, the last one is).
 */
export function parseNumber(text: string, kind: 'count' | 'distance'): number | null {
  const m = /^[+]?\d+(?:[.,'’\u00a0\u202f ]\d+)*/.exec(text.trim());
  if (!m) return null;
  const raw = m[0];
  const seps = [...raw.matchAll(/[^\d]/g)].map((x) => x[0]);
  let normalized: string;
  if (seps.length === 0) normalized = raw;
  else {
    const last = seps.at(-1)!;
    const lastIsDecimal =
      (last === '.' || last === ',') &&
      (new Set(seps).size > 1 ? true : seps.length === 1 && (kind === 'distance' || !/[.,]\d{3}$/.test(raw)));
    if (lastIsDecimal) {
      const i = raw.lastIndexOf(last);
      normalized = raw.slice(0, i).replace(new RegExp(GROUP.source, 'g'), '') + '.' + raw.slice(i + 1);
    } else normalized = raw.replace(new RegExp(GROUP.source, 'g'), '');
  }
  const n = Number(normalized.replace(/^\+/, ''));
  return Number.isFinite(n) ? n : null;
}

/** A distance in meters: the number with its unit (`km`, `m`, `mi`; without one the shortcut sends km). */
export function parseDistanceM(text: string): number | null {
  const n = parseNumber(text, 'distance');
  if (n === null) return null;
  const unit = text
    .trim()
    .replace(/^[+]?\d+(?:[.,'’\u00a0\u202f ]\d+)*/, '')
    .trim()
    .toLowerCase();
  if (unit === '' || /^(km|kilometer)/.test(unit)) return n * 1000;
  if (/^(mi|meile|mile)/.test(unit)) return n * 1609.344;
  if (/^(m|meter)\b/.test(unit) || unit === 'm') return n;
  return null;
}
