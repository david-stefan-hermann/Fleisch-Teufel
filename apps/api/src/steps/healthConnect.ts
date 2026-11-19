/**
 * Reading what the Android app HC Webhook sends from Health Connect. With the resolution "Täglich"
 * it posts one row per calendar day: a finished day from midnight to midnight, the running day from
 * midnight up to the sync. The oldest day of its 48 hour window starts at some time of day and holds
 * only a part of the steps, so only rows that cover a day count: a part would make a correct value smaller.
 */
import { z } from 'zod';
import type { StepsImportBody } from './import.js';

/** More rows than a sync of daily values ever has. */
const MAX_ROWS = 5_000;
/** How far the end of the running day may lie from the time of the sync. */
const SYNC_SLACK_MS = 10 * 60_000;

const interval = { start_time: z.string().max(100), end_time: z.string().max(100) };

export const healthConnectSchema = z.object({
  /** Set by the app's test button: its values are made up. */
  test: z.boolean().optional(),
  timestamp: z.string().max(100),
  steps: z
    .array(z.object({ count: z.number().nonnegative(), ...interval }))
    .max(MAX_ROWS)
    .optional(),
  distance: z
    .array(z.object({ meters: z.number().nonnegative(), ...interval }))
    .max(MAX_ROWS)
    .optional(),
});
export type HealthConnectBody = z.infer<typeof healthConnectSchema>;

type Interval = { start_time: string; end_time: string };

const MIDNIGHT = /^(\d{4}-\d{2}-\d{2})T00:00(?::00(?:\.0+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** The local day a row covers, or null when it is not a whole day or the running day. */
function dayOf(row: Interval, sentAt: number): string | null {
  const day = MIDNIGHT.exec(row.start_time)?.[1];
  const start = Date.parse(row.start_time);
  const end = Date.parse(row.end_time);
  if (!day || Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
  const endsAtMidnight = MIDNIGHT.test(row.end_time) && row.end_time.slice(0, 10) > day;
  const hours = (end - start) / 3_600_000;
  // 23 and 25 hours: the days the clocks change.
  if (endsAtMidnight) return hours >= 23 && hours <= 25 ? day : null;
  return row.end_time.slice(0, 10) === day && Math.abs(end - sentAt) <= SYNC_SLACK_MS ? day : null;
}

/** The usable rows per day; of a day sent twice the reading that ends last. */
function byDay<T extends Interval>(rows: readonly T[], sentAt: number): Map<string, T> {
  const out = new Map<string, T>();
  for (const row of rows) {
    const day = dayOf(row, sentAt);
    if (!day) continue;
    const seen = out.get(day);
    if (!seen || Date.parse(row.end_time) > Date.parse(seen.end_time)) out.set(day, row);
  }
  return out;
}

/** The sync as the lists of the import, and what the person should change when no row was usable. */
export function healthConnectBody(sync: HealthConnectBody): { body: StepsImportBody; warnings: string[] } {
  const sentAt = Date.parse(sync.timestamp);
  const steps = byDay(sync.steps ?? [], sentAt);
  const distance = byDay(sync.distance ?? [], sentAt);
  const warnings =
    (sync.steps?.length ?? 0) > 0 && steps.size === 0
      ? ['Keine Tageswerte: in HC Webhook bei Schritte „Täglich“ und als Zeitformat die Ortszeit wählen.']
      : [];
  return {
    body: {
      stepDates: [...steps.keys()],
      stepValues: [...steps.values()].map((r) => String(Math.round(r.count))),
      distanceDates: [...distance.keys()],
      distanceValues: [...distance.values()].map((r) => `${Math.round(r.meters)} m`),
      now: sync.timestamp,
    },
    warnings,
  };
}
