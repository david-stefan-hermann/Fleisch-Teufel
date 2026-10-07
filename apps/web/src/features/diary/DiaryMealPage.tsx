import { sumNutrients, targetsForDate } from '@ft/shared';
import { useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, UtensilsCrossed } from 'lucide-react';
import { useDb } from '@/app/session';
import { useAddSheet } from '@/components/AddSheet';
import { NutrientBreakdown } from '@/components/NutrientBreakdown';
import { EmptyState, Page, Section } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useGoals, useSettings, useToday } from '@/hooks/data';
import { fmtRelativeDay } from '@/lib/format';
import { DiaryRows } from './MealCard';

/**
 * One diary meal (Frühstück, Mittagessen, ...) of a day, opened from its card header: the nutrient
 * overview of the meal against the day's targets, then its entries (swipe to delete, tap to edit).
 */
export function DiaryMealPage() {
  const { date, meal } = useSearch({ from: '/authed/diary-meal' });
  const db = useDb();
  const today = useToday();
  const settings = useSettings();
  const goals = useGoals();
  const addSheet = useAddSheet();
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
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Zu ${name} hinzufügen`}
          onClick={() => addSheet.open({ date, meal })}
        >
          <Plus className="text-primary" aria-hidden />
        </Button>
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
                <Button variant="outline" className="mt-2" onClick={() => addSheet.open({ date, meal })}>
                  <Plus aria-hidden /> Lebensmittel hinzufügen
                </Button>
              </EmptyState>
            ) : (
              <DiaryRows entries={entries} date={date} meal={meal} />
            )}
          </Section>
        </>
      )}
    </Page>
  );
}
