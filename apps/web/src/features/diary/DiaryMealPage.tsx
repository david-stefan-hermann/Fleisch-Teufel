import { sumNutrients, targetsForDate } from '@ft/shared';
import { Link, useNavigate, useRouter, useSearch } from '@tanstack/react-router';
import { Plus, UtensilsCrossed } from 'lucide-react';
import { useState } from 'react';
import { useDb } from '@/app/session';
import { NotFoundPage } from '@/components/NotFoundPage';
import { NutrientBreakdown } from '@/components/NutrientBreakdown';
import { EmptyState, Page, Section } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { foodClipboard } from '@/db/clipboard';
import type { DiaryDayMeal } from '@/db/diaryMeals';
import {
  useClipboard,
  useDayMeals,
  useDaySuggestions,
  useGoals,
  useMealChoice,
  useToday,
} from '@/hooks/data';
import { fmtRelativeDay } from '@/lib/format';
import { goBackOr } from '@/lib/history';
import { useRememberLogStart } from '@/lib/logFlow';
import { DiaryRows, PasteButton } from './MealCard';
import { DiaryMealMenu } from './DiaryMealMenu';
import { MealSuggestions } from './MealSuggestions';
import { warmUpCamera } from '@/components/cameraWarmup';

/**
 * One diary meal (Frühstück, Mittagessen, ...) of a day, opened from its card header: the nutrient
 * overview of the meal against the day's targets, then its entries (swipe to delete, tap to edit) and
 * "Zuletzt hier". Header like the diary card: the paste icon (when something is copied) logs the
 * clipboard into this meal, ⋯ (`DiaryMealMenu`) copies, saves or deletes it, "+" opens the food page.
 * A meal whose last entry goes while the page is open stays here, empty: undo brings it back.
 */
export function DiaryMealPage() {
  const { date, meal: slot, dm } = useSearch({ from: '/authed/diary-meal' });
  const meals = useDayMeals(date);
  const choice = useMealChoice(date, slot, dm);
  const [kept, setKept] = useState<DiaryDayMeal | null>(null);
  const found = choice && meals?.find((m) => m.id === choice.current.id);
  if (found && found !== kept) setKept(found);

  if (!meals || !choice) return <MealPageLoading />;
  const emptied = kept && kept.date === date && (!dm || kept.id === dm);
  const meal = found ?? (emptied ? { ...kept, entries: [], pending: [] } : null);
  if (!meal) return <NotFoundPage title="Mahlzeit" what="Mahlzeit nicht gefunden" />;
  return <MealPageContent meal={meal} />;
}

function MealPageLoading() {
  return (
    <Page title="Mahlzeit" back="/" withTabBar={false}>
      <div className="grid gap-4">
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-28 rounded-2xl" />
      </div>
    </Page>
  );
}

function MealPageContent({ meal }: { meal: DiaryDayMeal }) {
  const { id, date, name, slot, entries } = meal;
  const db = useDb();
  const router = useRouter();
  const navigate = useNavigate();
  const today = useToday();
  const goals = useGoals();
  const clipboard = foodClipboard(useClipboard());
  const suggestions = useDaySuggestions(date);
  const rememberStart = useRememberLogStart();
  /** Not the diary: logging from here ends on the diary as a new page (no way back into the forms). */
  const startLogging = () => {
    warmUpCamera();
    rememberStart(date);
  };
  const totals = sumNutrients(entries.map((e) => e.nutrients));
  const target = { date, meal: slot, dm: id };
  /** The meal is gone: never stay on its page. */
  const leave = () =>
    goBackOr(router.history, 1, () => void navigate({ to: '/', search: { date }, replace: true }));

  return (
    <Page
      title={
        <>
          {name}{' '}
          <span className="text-sm font-normal text-muted-foreground">{fmtRelativeDay(date, today)}</span>
        </>
      }
      back="/"
      withTabBar={false}
      actions={
        <>
          {clipboard && (
            <PasteButton db={db} clipboard={clipboard} target={target} mealName={name} iconClassName="" />
          )}
          <DiaryMealMenu
            target={target}
            mealName={name}
            entries={entries}
            yesterday={suggestions?.get(id)?.yesterday ?? null}
            iconClassName=""
            onDeleted={leave}
          />
          <Button variant="ghost" size="icon" asChild>
            <Link
              to="/photo"
              preload="intent"
              onClick={startLogging}
              search={target}
              aria-label={`Essen zu ${name} eintragen`}
            >
              <Plus className="text-primary" aria-hidden />
            </Link>
          </Button>
        </>
      }
    >
      {!goals ? (
        <div className="grid gap-4">
          <Skeleton className="h-64 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
        </div>
      ) : (
        <>
          <Section>
            <NutrientBreakdown
              className="p-4 pb-3"
              title="Summe"
              nutrients={totals}
              targets={targetsForDate(goals, date)}
            />
          </Section>
          <Section title="Einträge">
            {entries.length === 0 ? (
              <EmptyState icon={<UtensilsCrossed />} title="Noch nichts eingetragen">
                <Button variant="outline" className="mt-2" asChild>
                  <Link to="/photo" preload="intent" onClick={startLogging} search={target}>
                    <Plus aria-hidden /> Essen eintragen
                  </Link>
                </Button>
              </EmptyState>
            ) : (
              <DiaryRows entries={entries} date={date} meal={slot} mealId={id} />
            )}
            <MealSuggestions
              target={target}
              mealName={name}
              data={suggestions?.get(id)}
              empty={entries.length === 0}
            />
          </Section>
        </>
      )}
    </Page>
  );
}
