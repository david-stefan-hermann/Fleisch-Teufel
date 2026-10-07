import { parseISODate, type ISODate } from '@ft/shared';

const nf0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

/** Whole number (kcal). */
export const fmt0 = (n: number) => nf0.format(Math.round(n));
/** One decimal max (grams of macros). */
export const fmt1 = (n: number) => nf1.format(n);
export const fmt2 = (n: number) => nf2.format(n);

/** Grams with sensible precision: 0.4 g, 12.5 g, 230 g. */
export function fmtGrams(n: number, unit = 'g'): string {
  const v = Math.abs(n) >= 100 ? nf0.format(n) : Math.abs(n) >= 1 ? nf1.format(n) : nf2.format(n);
  return `${v}\u00a0${unit}`;
}

export const fmtKcal = (n: number) => `${fmt0(n)}\u00a0kcal`;

/** Parses German or English decimal input ("1,5" / "1.5"); NaN for empty/invalid. */
export function parseDecimal(input: string): number {
  const s = input.trim().replace(/\s/g, '').replace(',', '.');
  if (!s || !/^-?\d*\.?\d*$/.test(s)) return Number.NaN;
  return Number.parseFloat(s);
}

const dayLong = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
const dayShort = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
const dateNumeric = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const monthYear = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' });
const timeShort = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });

export const fmtDayLong = (d: ISODate) => dayLong.format(parseISODate(d));
export const fmtDayShort = (d: ISODate) => dayShort.format(parseISODate(d));
export const fmtDate = (d: ISODate) => dateNumeric.format(parseISODate(d));
export const fmtMonth = (d: ISODate) => monthYear.format(parseISODate(d));
export const fmtTime = (ms: number) => timeShort.format(new Date(ms));

/** "Heute", "Gestern", "Morgen" or the long date. */
export function fmtRelativeDay(d: ISODate, today: ISODate): string {
  const rtf = new Intl.RelativeTimeFormat('de-DE', { numeric: 'auto' });
  const diff = Math.round((parseISODate(d).getTime() - parseISODate(today).getTime()) / 86_400_000);
  if (Math.abs(diff) <= 1) {
    const s = rtf.format(diff, 'day');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  return fmtDayLong(d);
}

export function fmtAgo(ms: number, now = Date.now()): string {
  const rtf = new Intl.RelativeTimeFormat('de-DE', { numeric: 'auto' });
  const s = Math.round((ms - now) / 1000);
  if (Math.abs(s) < 60) return 'gerade eben';
  const m = Math.round(s / 60);
  if (Math.abs(m) < 60) return rtf.format(m, 'minute');
  const h = Math.round(m / 60);
  if (Math.abs(h) < 24) return rtf.format(h, 'hour');
  return rtf.format(Math.round(h / 24), 'day');
}
