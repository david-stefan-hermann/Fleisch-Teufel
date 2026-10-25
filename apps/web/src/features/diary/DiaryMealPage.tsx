import { sumNutrients, targetsForDate } from '@ft/shared';
import { Link, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, UtensilsCrossed } from 'lucide-react';
import { useDb } from '@/app/session';
import { NutrientBreakdown } from '@/components/NutrientBreakdown';
import { EmptyState, Page, Section } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useClipboard, useDaySuggestions, useGoals, useSettings, useToday } from '@/hooks/data';
import { fmtRelativeDay } from '@/lib/format';
import { DiaryRows, PasteButton } from './MealCard';
import { DiaryMealMenu } from './DiaryMealMenu';
import { MealSuggestions } from './MealSuggestions';
import { warmUpCamera } from '@/components/cameraWarmup';

/**
 * One diary meal (Frühstück, Mittagessen, ...) of a day, opened from its card header: the nutrient
 * overview of the meal against the day's targets, then its entries (swipe to delete, tap to edit) and
 * "Zuletzt hier". Header like the diary card: the paste icon (when something is copied) logs the
 * clipboard into this meal, ⋯ (`DiaryMealMenu`) copies, saves or empties it, "+" opens the food page.
 */
export function DiaryMealPage() {
  const { date, meal } = useSearch({ from: '/authed/diary-meal' });
  const db = useDb();
  const today = useToday();
  const settings = useSettings();
  const goals = useGoals();
  const clipboard = useClipboard();
  const suggestions = useDaySuggestions(date);
  const entries = useLiveQuery(
    () =>
      db.foodEntries
        .where('[date+meal]')
        .equals([date, meal])
        .filter((e) => !e.deleted)
        .sortBy('loggedAt'),
    [db, date, meal],
  );
  const name = settings?.mealNames[meal] ?? `Mahlzeit ${meal + 1}`;
  const totals = sumNutrients((entries ?? []).map((e) => e.nutrients));

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
            <PasteButton
              db={db}
              clipboard={clipboard}
              date={date}
              meal={meal}
              mealName={name}
              iconClassName=""
            />
          )}
          <DiaryMealMenu
            date={date}
            meal={meal}
            mealName={name}
            entries={entries ?? []}
            yesterdayKcal={suggestions?.get(meal)?.yesterdayKcal ?? 0}
            iconClassName=""
          />
          <Button variant="ghost" size="icon" asChild>
            <Link
              to="/photo"
              preload="intent"
              onClick={warmUpCamera}
              search={{ date, meal }}
              aria-label={`Essen zu ${name} eintragen`}
            >
              <Plus className="text-primary" aria-hidden />
            </Link>
          </Button>
        </>
      }
    >
      {!entries || !goals ? (
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
                  <Link to="/photo" preload="intent" onClick={warmUpCamera} search={{ date, meal }}>
                    <Plus aria-hidden /> Essen eintragen
                  </Link>
                </Button>
              </EmptyState>
            ) : (
              <DiaryRows entries={entries} date={date} meal={meal} />
            )}
            <MealSuggestions
              date={date}
              meal={meal}
              mealName={name}
              data={suggestions?.get(meal)}
              empty={entries.length === 0}
            />
          </Section>
        </>
      )}
    </Page>
  );
}
