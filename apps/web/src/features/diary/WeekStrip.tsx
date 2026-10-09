import { addDays, dateRange, parseISODate, startOfWeek, WEEKDAYS_SHORT_DE, type ISODate } from '@ft/shared';
import { Link } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLoggedDates, useTrainedDates } from '@/hooks/data';
import { cn } from '@/lib/utils';

/**
 * Mon to Sun of the shown day with week arrows. Under each date a dot row of fixed height: red (left)
 * when food was logged, blue (right) when a training was; the day's link label says the same.
 */
export function WeekStrip({ date, today }: { date: ISODate; today: ISODate }) {
  const monday = startOfWeek(date);
  const days = dateRange(monday, addDays(monday, 6));
  const logged = useLoggedDates(days[0]!, days[6]!);
  const trained = useTrainedDates(days[0]!, days[6]!);
  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon-sm" asChild>
        <Link to="/" search={{ date: addDays(date, -7) }} aria-label="Vorherige Woche">
          <ChevronLeft aria-hidden />
        </Link>
      </Button>
      <ol className="grid flex-1 grid-cols-7 gap-1">
        {days.map((d, i) => {
          const selected = d === date;
          const isToday = d === today;
          const food = !!logged?.has(d);
          const training = !!trained?.has(d);
          const dayName = new Intl.DateTimeFormat('de-DE', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          }).format(parseISODate(d));
          return (
            <li key={d}>
              <Link
                to="/"
                search={{ date: d === today ? undefined : d }}
                aria-current={selected ? 'date' : undefined}
                aria-label={[dayName, food && 'Essen eingetragen', training && 'Training eingetragen']
                  .filter(Boolean)
                  .join(', ')}
                className={cn(
                  'flex h-14 touch-manipulation flex-col items-center justify-center rounded-xl text-xs transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                  selected ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
                  !selected && isToday && 'font-semibold text-primary',
                )}
              >
                <span className={cn('opacity-80', selected && 'opacity-100')}>{WEEKDAYS_SHORT_DE[i]}</span>
                <span className="tabular text-base font-semibold">{parseISODate(d).getDate()}</span>
                <span aria-hidden className="mt-0.5 flex h-1 gap-[3px]">
                  {food && (
                    <span
                      data-dot="food"
                      className={cn('size-1 rounded-full', selected ? 'bg-primary-foreground' : 'bg-primary')}
                    />
                  )}
                  {training && <span data-dot="training" className="size-1 rounded-full bg-exercise" />}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
      <Button variant="ghost" size="icon-sm" asChild>
        <Link to="/" search={{ date: addDays(date, 7) }} aria-label="Nächste Woche">
          <ChevronRight aria-hidden />
        </Link>
      </Button>
    </div>
  );
}
