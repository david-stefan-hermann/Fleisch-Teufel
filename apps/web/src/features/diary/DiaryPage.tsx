import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { Share, Target } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Page } from '@/components/Page';
import { SyncIndicator } from '@/components/SyncIndicator';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useClipboard,
  useDaySuggestions,
  useDayExercises,
  useDayMeals,
  useDayNote,
  useDaySummary,
  useGoals,
  useMealChoice,
  useSettings,
  useToday,
} from '@/hooks/data';
import { fmtRelativeDay } from '@/lib/format';
import { clearLogStart } from '@/lib/logFlow';
import { foodClipboard, trainingClipboard } from '@/db/clipboard';
import { NEXT_MEAL_KEY } from '@/db/suggestions';
import { CalorieCard } from './CalorieCard';
import { ClipboardMenu } from './ClipboardMenu';
import { DiaryDnd } from './DiaryDnd';
import { useDiaryScroll } from './diaryScroll';
import { ExerciseCard } from './ExerciseCard';
import { AddMealLink, EmptyMealCard, MealCard } from './MealCard';
import { NoteCard } from './NoteCard';
import { ShareDayDialog } from './share/ShareDayDialog';
import { showsWeekReview, WeekReviewCard } from './WeekReviewCard';
import { RecalcGoalCard } from '@/features/goals/RecalcGoalCard';
import { WeekStrip } from './WeekStrip';

export function DiaryPage() {
  const today = useToday();
  const search = useSearch({ from: '/authed/' });
  const date = search.date ?? today;
  const summary = useDaySummary(date);
  const exercises = useDayExercises(date);
  const meals = useDayMeals(date);
  const next = useMealChoice(date, 0, 'new')?.next;
  const clipboard = useClipboard();
  const suggestions = useDaySuggestions(date);
  const settings = useSettings();
  const goals = useGoals();
  const note = useDayNote(date);
  const [sharing, setSharing] = useState(false);
  const canShare = !!summary && !!meals && !!exercises && !!settings && note !== undefined;
  const navigate = useNavigate();
  // The diary is reached: a logging flow remembered earlier must not trigger anything later.
  useEffect(clearLogStart, []);
  // Position and new rows are set once nothing changes the height of the meal cards any more.
  useDiaryScroll(
    date,
    !!summary && !!exercises && !!settings && !!meals && !!next && suggestions !== undefined,
  );
  const go = (d: string) => void navigate({ to: '/', search: { date: d === today ? undefined : d } });
  const longDate = fmtRelativeDay(date, today);
  const { titleBox, dateText, dateProbe, fitsLong } = useFittingDate(longDate);

  return (
    <Page
      title={
        <span ref={titleBox} className="flex items-center gap-1">
          {/*
            The transparent date input lies on top of the label: a tap hits the input itself, which is
            the only way iOS Safari opens its picker (showPicker() on a hidden input does nothing there).
          */}
          <label className="relative min-w-0 cursor-pointer rounded-md px-1 hover:bg-accent focus-within:ring-[3px] focus-within:ring-ring/50">
            <span ref={dateText} className="block truncate">
              {fitsLong ? longDate : fmtRelativeDay(date, today, true)}
            </span>
            {/* Measures the long date: the short one ("Do., 15. Okt.") shows when it would be cut off. */}
            <span
              ref={dateProbe}
              aria-hidden
              data-text={longDate}
              // Generated content: the probe's text is no text of the page (searches, screen readers).
              className="invisible absolute top-0 left-0 whitespace-nowrap before:content-[attr(data-text)]"
            />
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
        </span>
      }
      actions={
        // Cloud, clipboard (while something is copied), share.
        <>
          <SyncIndicator />
          {clipboard && <ClipboardMenu clipboard={clipboard} />}
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground"
            onClick={() => setSharing(true)}
            disabled={!canShare}
            aria-label="Tag teilen"
          >
            <Share aria-hidden />
          </Button>
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
      {!summary || !exercises || !settings || !meals || !next ? (
        <div className="grid gap-4">
          <Skeleton className="h-56 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
        </div>
      ) : (
        <>
          <CalorieCard summary={summary} exerciseCredited={settings.addExerciseCalories} />
          {/* Monday only: last week in three numbers, hidden with X until the next Monday. */}
          {showsWeekReview(date, today) && <WeekReviewCard today={today} />}
          {/* Set up before the four goals: offer the new calculation once (X hides it). */}
          {date === today && <RecalcGoalCard today={today} />}
          {/* Long press on an entry, then drop it on another meal to move it there. */}
          <DiaryDnd meals={meals}>
            {meals.map((meal) => (
              <MealCard
                key={meal.id}
                meal={meal}
                clipboard={foodClipboard(clipboard)}
                suggestions={suggestions?.get(meal.id)}
              />
            ))}
          </DiaryDnd>
          {meals.length === 0 ? (
            <EmptyMealCard
              date={date}
              next={next}
              clipboard={foodClipboard(clipboard)}
              suggestions={suggestions?.get(NEXT_MEAL_KEY)}
            />
          ) : (
            <AddMealLink date={date} next={next} />
          )}
          <ExerciseCard
            date={date}
            exercises={exercises}
            credited={settings.addExerciseCalories}
            stepsCredited={settings.addStepsCalories !== false}
            clipboard={trainingClipboard(clipboard)}
          />
          <NoteCard key={date} date={date} />
          {note !== undefined && (
            // Not `key={date}`: that is the note card's key, and siblings sharing a key leave stale
            // cards of other days in the page.
            <ShareDayDialog
              key={`share:${date}`}
              open={sharing}
              onOpenChange={setSharing}
              date={date}
              summary={summary}
              exerciseCredited={settings.addExerciseCalories}
              stepsCredited={settings.addStepsCalories !== false}
              meals={meals}
              exercises={exercises}
              note={note?.note ?? ''}
            />
          )}
        </>
      )}
    </Page>
  );
}

/**
 * Whether the long date fits into the header (measured, since the room depends on the screen and the
 * header icons); the diary shows the short date otherwise.
 */
function useFittingDate(longDate: string) {
  const titleBox = useRef<HTMLSpanElement>(null);
  const dateText = useRef<HTMLSpanElement>(null);
  const dateProbe = useRef<HTMLSpanElement>(null);
  const [fitsLong, setFitsLong] = useState(true);
  useEffect(() => {
    const box = titleBox.current;
    const text = dateText.current;
    const probe = dateProbe.current;
    const label = text?.parentElement;
    if (!box || !text || !probe || !label) return;
    const measure = () => {
      const gap = parseFloat(getComputedStyle(box).columnGap) || 0;
      let others = 0;
      for (const child of box.children)
        if (child !== label) others += (child as HTMLElement).offsetWidth + gap;
      const padding = label.offsetWidth - text.offsetWidth;
      setFitsLong(probe.offsetWidth <= box.clientWidth - others - padding);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    // The probe changes size when the web font arrives.
    ro.observe(probe);
    return () => ro.disconnect();
  }, [longDate]);
  return { titleBox, dateText, dateProbe, fitsLong };
}
