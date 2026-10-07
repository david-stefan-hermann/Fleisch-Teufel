import { addDays, MEAL_COUNT } from '@ft/shared';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { CalendarDays, ChevronLeft, ChevronRight, Target } from 'lucide-react';
import { useRef } from 'react';
import { Page } from '@/components/Page';
import { SyncIndicator } from '@/components/SyncIndicator';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useDayEntries, useDayExercises, useDaySummary, useGoals, useSettings, useToday } from '@/hooks/data';
import { fmtRelativeDay } from '@/lib/format';
import { CalorieCard } from './CalorieCard';
import { ExerciseCard } from './ExerciseCard';
import { MealCard } from './MealCard';
import { NoteCard } from './NoteCard';
import { NutrientCard } from './NutrientCard';
import { WeekStrip } from './WeekStrip';

export function DiaryPage() {
  const today = useToday();
  const search = useSearch({ from: '/authed/' });
  const date = search.date ?? today;
  const summary = useDaySummary(date);
  const entries = useDayEntries(date);
  const exercises = useDayExercises(date);
  const settings = useSettings();
  const goals = useGoals();
  const dateInput = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const go = (d: string) => void navigate({ to: '/', search: { date: d === today ? undefined : d } });

  return (
    <Page
      title={
        <span className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => go(addDays(date, -1))}
            aria-label="Vorheriger Tag"
          >
            <ChevronLeft aria-hidden />
          </Button>
          <span className="min-w-0 truncate">{fmtRelativeDay(date, today)}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => go(addDays(date, 1))}
            aria-label="Nächster Tag"
          >
            <ChevronRight aria-hidden />
          </Button>
        </span>
      }
      actions={
        <>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Datum wählen"
            onClick={() => dateInput.current?.showPicker?.() ?? dateInput.current?.click()}
          >
            <CalendarDays aria-hidden />
          </Button>
          <input
            ref={dateInput}
            type="date"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            value={date}
            onChange={(e) => e.target.value && go(e.target.value)}
          />
          <SyncIndicator />
        </>
      }
      headerExtra={<WeekStrip date={date} today={today} />}
    >
      {goals && goals.length === 0 && (
        <Link
          to="/onboarding"
          className="mb-4 flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4 transition-colors hover:bg-primary/10 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <Target className="size-8 shrink-0 text-primary" aria-hidden />
          <div>
            <div className="font-semibold">Ziele einrichten</div>
            <div className="text-sm text-muted-foreground">
              Berechne deinen Kalorienbedarf und deine Makroziele in einer Minute.
            </div>
          </div>
        </Link>
      )}
      {!summary || !entries || !exercises || !settings ? (
        <div className="grid gap-4">
          <Skeleton className="h-56 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
        </div>
      ) : (
        <>
          <CalorieCard summary={summary} exerciseCredited={settings.addExerciseCalories} />
          {Array.from({ length: MEAL_COUNT }, (_, m) => (
            <MealCard
              key={m}
              date={date}
              meal={m}
              name={settings.mealNames[m] ?? `Mahlzeit ${m + 1}`}
              entries={entries.filter((e) => e.meal === m)}
              totals={summary.perMeal[m] ?? {}}
              showMicros={false}
            />
          ))}
          <ExerciseCard date={date} exercises={exercises} credited={settings.addExerciseCalories} />
          <NutrientCard summary={summary} />
          <NoteCard key={date} date={date} />
        </>
      )}
    </Page>
  );
}
