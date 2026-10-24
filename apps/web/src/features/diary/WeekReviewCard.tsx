import { addDays, dailyRows, startOfWeek, weekdayIndex, weekSummary, type ISODate } from '@ft/shared';
import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronRight, X } from 'lucide-react';
import { useDb } from '@/app/session';
import { Section } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { useSettings } from '@/hooks/data';
import { fmt0, fmt2, NO_VALUE } from '@/lib/format';

const DISMISS_KEY = 'weekReview.dismissed';

/** Whether the card belongs on this diary day: today, and today is a Monday. */
export function showsWeekReview(date: ISODate, today: ISODate): boolean {
  return date === today && weekdayIndex(today) === 0;
}

/**
 * "Letzte Woche" at the top of Monday's diary: average kcal against the budget, average protein,
 * weight trend and how many days were complete, one line each, without a verdict. Tapping opens the
 * week in the reports; X hides it until next Monday. The diary stays the start page.
 */
export function WeekReviewCard({ today }: { today: ISODate }) {
  const db = useDb();
  const settings = useSettings();
  const monday = startOfWeek(addDays(today, -7));
  const sunday = addDays(monday, 6);
  const data = useLiveQuery(async () => {
    const dismissed = (await db.kv.get(DISMISS_KEY))?.value;
    if (dismissed === startOfWeek(today)) return { dismissed: true as const };
    const [entries, exercises, notes, weights, goals] = await Promise.all([
      db.foodEntries
        .where('date')
        .between(monday, sunday, true, true)
        .filter((e) => !e.deleted)
        .toArray(),
      db.exerciseEntries
        .where('date')
        .between(monday, sunday, true, true)
        .filter((e) => !e.deleted)
        .toArray(),
      db.dayNotes
        .where('date')
        .between(monday, sunday, true, true)
        .filter((n) => !n.deleted)
        .toArray(),
      db.weightEntries.filter((w) => !w.deleted).toArray(),
      db.goals.filter((g) => !g.deleted).toArray(),
    ]);
    const rows = dailyRows({ from: monday, to: sunday, entries, exercises, weights, goals, notes });
    return { dismissed: false as const, rows, weights };
  }, [db, monday, sunday, today]);
  if (!data || data.dismissed || !settings) return null;
  const s = weekSummary(data.rows, data.weights, { creditExercise: settings.addExerciseCalories });
  if (s.loggedDays === 0) return null;
  return (
    <Section
      title="Letzte Woche"
      action={
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Wochenrückblick ausblenden"
          onClick={() => void db.kv.put({ key: DISMISS_KEY, value: startOfWeek(today) })}
        >
          <X aria-hidden />
        </Button>
      }
    >
      <dl className="tabular grid grid-cols-3 gap-2 px-4 pb-2 text-center">
        <div>
          <dt className="text-xs text-muted-foreground">Ø kcal</dt>
          <dd className="text-lg font-semibold">{s.avgKcal === null ? NO_VALUE : fmt0(s.avgKcal)}</dd>
          <dd className="text-[11px] text-muted-foreground">
            Ziel Ø {s.avgBudgetKcal === null ? NO_VALUE : fmt0(s.avgBudgetKcal)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Ø Protein</dt>
          <dd className="text-lg font-semibold">
            {s.avgProteinG === null ? NO_VALUE : `${fmt0(s.avgProteinG)} g`}
          </dd>
          <dd className="text-[11px] text-muted-foreground">
            Ziel {s.avgProteinTargetG === null ? NO_VALUE : `${fmt0(s.avgProteinTargetG)} g`}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Gewicht</dt>
          <dd className="text-lg font-semibold">
            {s.weightDeltaKg === null
              ? NO_VALUE
              : `${s.weightDeltaKg > 0 ? '+' : ''}${fmt2(s.weightDeltaKg)} kg`}
          </dd>
          <dd className="text-[11px] text-muted-foreground">
            {s.weighIns === 0 ? 'nicht gewogen' : `${fmt0(s.weighIns)}× gewogen`}
          </dd>
        </div>
      </dl>
      <Link
        to="/reports"
        search={{ range: 'week', end: sunday }}
        className="flex min-h-11 items-center justify-between gap-2 border-t border-border/70 px-4 text-sm text-muted-foreground hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none"
      >
        <span>
          {fmt0(s.completeDays)} von 7 Tagen vollständig erfasst
          {s.loggedDays > s.completeDays ? `, ${fmt0(s.loggedDays - s.completeDays)} nur zum Teil` : ''}
        </span>
        <ChevronRight className="size-4 shrink-0" aria-hidden />
      </Link>
    </Section>
  );
}
