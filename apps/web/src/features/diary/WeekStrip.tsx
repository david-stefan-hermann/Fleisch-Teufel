import { addDays, parseISODate, WEEKDAYS_SHORT_DE, weekdayIndex, type ISODate } from '@ft/shared';
import { Link } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStripMarks } from '@/hooks/data';
import { useAppearance } from '@/lib/appearance';
import { cn } from '@/lib/utils';
import { stripDays } from './stripDays';
import { StripDay, stripDayClass, stripDayData, stripDayLabel, stripDayTinted } from './StripDay';

const DAY_NAME = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });

/**
 * Seven days around the shown one (`stripDays`: the calendar week or the recent days, a setting of
 * the device) with arrows that move a week. Each day shows food, training and whether it kept the
 * budget in the look chosen under Mehr → Aussehen (`StripDay`); the day's link label says the same.
 */
export function WeekStrip({ date, today }: { date: ISODate; today: ISODate }) {
  const { weekStrip, weekMarks: variant } = useAppearance();
  const days = stripDays(date, today, weekStrip);
  const marks = useStripMarks(days[0]!, days[6]!);
  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon-sm" asChild>
        <Link
          to="/"
          search={{ date: dateParam(addDays(date, -7), today) }}
          aria-label="Vorherige Woche"
          activeOptions={{ exact: true }}
        >
          <ChevronLeft aria-hidden />
        </Link>
      </Button>
      <ol className="grid flex-1 grid-cols-7 gap-1" data-marks={variant}>
        {days.map((d) => {
          const selected = d === date;
          const mark = marks?.get(d);
          return (
            <li key={d}>
              <Link
                to="/"
                search={{ date: d === today ? undefined : d }}
                // Partly matching search params would make today's link (no `date`) current on every day.
                activeOptions={{ exact: true }}
                aria-current={selected ? 'date' : undefined}
                {...stripDayData(mark, variant)}
                className={cn(
                  stripDayClass({ mark, selected, today: d === today, variant }),
                  'touch-manipulation transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                  !stripDayTinted(mark, selected, variant) && 'hover:bg-accent',
                )}
              >
                {/* The name is the full text (an aria-label differing from the visible "Mo 9" is an axe finding). */}
                <span className="sr-only">
                  {stripDayLabel(DAY_NAME.format(parseISODate(d)), mark, variant)}
                </span>
                <StripDay
                  weekday={WEEKDAYS_SHORT_DE[weekdayIndex(d)]!}
                  day={parseISODate(d).getDate()}
                  mark={mark}
                  selected={selected}
                  variant={variant}
                />
              </Link>
            </li>
          );
        })}
      </ol>
      <Button variant="ghost" size="icon-sm" asChild>
        <Link
          to="/"
          search={{ date: dateParam(addDays(date, 7), today) }}
          aria-label="Nächste Woche"
          activeOptions={{ exact: true }}
        >
          <ChevronRight aria-hidden />
        </Link>
      </Button>
    </div>
  );
}

/** Today has no `date` in the URL (one address per day, same scroll restoration). */
function dateParam(d: string, today: string): string | undefined {
  return d === today ? undefined : d;
}
