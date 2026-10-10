import { addDays, MEAL_COUNT } from '@ft/shared';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Target } from 'lucide-react';
import { Page } from '@/components/Page';
import { SyncIndicator } from '@/components/SyncIndicator';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useDayEntries,
  useDayExercises,
  useDaySummary,
  useGoals,
  usePendingAnalyses,
  useSettings,
  useToday,
} from '@/hooks/data';
import { fmtRelativeDay } from '@/lib/format';
import { CalorieCard } from './CalorieCard';
import { DiaryDnd } from './DiaryDnd';
import { ExerciseCard } from './ExerciseCard';
import { MealCard } from './MealCard';
import { NoteCard } from './NoteCard';
import { WeekStrip } from './WeekStrip';

export function DiaryPage() {
  const today = useToday();
  const search = useSearch({ from: '/authed/' });
  const date = search.date ?? today;
  const summary = useDaySummary(date);
  const entries = useDayEntries(date);
  const exercises = useDayExercises(date);
  const pending = usePendingAnalyses(date);
  const settings = useSettings();
  const goals = useGoals();
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
          {/*
            The transparent date input lies on top of the label: a tap hits the input itself, which is
            the only way iOS Safari opens its picker (showPicker() on a hidden input does nothing there).
          */}
          <label className="relative min-w-0 cursor-pointer rounded-md px-1 hover:bg-accent focus-within:ring-[3px] focus-within:ring-ring/50">
            <span className="block truncate">{fmtRelativeDay(date, today)}</span>
            <input
              type="date"
              aria-label="Datum wählen"
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              value={date}
              onClick={(e) => {
                try {
                  e.currentTarget.showPicker?.();
                } catch {
                  // Not allowed in this browser/context: the native tap behaviour still applies.
                }
              }}
              onChange={(e) => e.target.value && go(e.target.value)}
            />
          </label>
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
      actions={<SyncIndicator />}
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
          {/* Long press on an entry, then drop it on another meal to move it there. */}
          <DiaryDnd mealNames={settings.mealNames}>
            {Array.from({ length: MEAL_COUNT }, (_, m) => (
              <MealCard
                key={m}
                date={date}
                meal={m}
                name={settings.mealNames[m] ?? `Mahlzeit ${m + 1}`}
                entries={entries.filter((e) => e.meal === m)}
                totals={summary.perMeal[m] ?? {}}
                pending={pending?.filter((p) => p.meal === m)}
              />
            ))}
          </DiaryDnd>
          <ExerciseCard date={date} exercises={exercises} credited={settings.addExerciseCalories} />
          <NoteCard key={date} date={date} />
        </>
      )}
    </Page>
  );
}
