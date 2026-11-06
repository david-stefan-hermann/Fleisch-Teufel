import type { ISODate } from '@ft/shared';
import { useToday } from '@/hooks/data';
import { fmtDayLong, fmtRelativeDay } from '@/lib/format';

/**
 * Says which day a food form logs for when it is not today (logging for yesterday after midnight,
 * or for a past day of the diary): one grey line above the form ("Gestern, Donnerstag, 5. November").
 * Nothing for today.
 */
export function DayNote({ date }: { date: ISODate }) {
  const today = useToday();
  if (date === today) return null;
  const relative = fmtRelativeDay(date, today);
  const long = fmtDayLong(date);
  return (
    <p className="mb-3 text-sm text-muted-foreground">{relative === long ? long : `${relative}, ${long}`}</p>
  );
}
