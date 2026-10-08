import { sumNutrients, targetsForDate } from '@ft/shared';
import { Link, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Save, UtensilsCrossed } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { NameDialog } from '@/components/NameDialog';
import { NutrientBreakdown } from '@/components/NutrientBreakdown';
import { EmptyState, Page, Section } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useGoals, useSettings, useToday } from '@/hooks/data';
import { saveMealFromEntries } from '@/db/entries';
import { fmt0, fmtDate, fmtRelativeDay } from '@/lib/format';
import { DiaryRows } from './MealCard';

/**
 * One diary meal (Frühstück, Mittagessen, ...) of a day, opened from its card header: the nutrient
 * overview of the meal against the day's targets, then its entries (swipe to delete, tap to edit).
 * The save icon stores the entries as a reusable meal, "+" opens the food page for this meal.
 */
export function DiaryMealPage() {
  const { date, meal } = useSearch({ from: '/authed/diary-meal' });
  const db = useDb();
  const today = useToday();
  const settings = useSettings();
  const goals = useGoals();
  const [saveOpen, setSaveOpen] = useState(false);
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
          <Button
            variant="ghost"
            size="icon"
            aria-label="Als Meal speichern"
            disabled={!entries || entries.length === 0}
            onClick={() => setSaveOpen(true)}
          >
            <Save aria-hidden />
          </Button>
          <Button variant="ghost" size="icon" asChild>
            <Link to="/photo" search={{ date, meal }} aria-label={`Essen zu ${name} eintragen`}>
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
                  <Link to="/photo" search={{ date, meal }}>
                    <Plus aria-hidden /> Essen eintragen
                  </Link>
                </Button>
              </EmptyState>
            ) : (
              <DiaryRows entries={entries} date={date} meal={meal} />
            )}
          </Section>
        </>
      )}
      <NameDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        title="Als Meal speichern"
        description={`${(entries?.length ?? 0) === 1 ? '1 Eintrag wird' : `${fmt0(entries?.length ?? 0)} Einträge werden`} als wiederverwendbares Meal gespeichert.`}
        confirmLabel="Meal speichern"
        defaultName={`${name} ${fmtDate(date)}`}
        placeholder="z. B. Mein Mittagessen…"
        onConfirm={async (mealName) => {
          await saveMealFromEntries(db, mealName, entries ?? []);
          toast.success(`„${mealName}“ gespeichert`);
        }}
      />
    </Page>
  );
}
