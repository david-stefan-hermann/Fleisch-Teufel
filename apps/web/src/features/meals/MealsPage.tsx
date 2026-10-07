import { Link, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { UtensilsCrossed } from 'lucide-react';
import { useDb } from '@/app/session';
import { MealPhoto } from '@/components/MealPhoto';
import { EmptyState, Page } from '@/components/Page';
import { useSettings } from '@/hooks/data';
import { fmt0 } from '@/lib/format';
import { mealKcal } from './logMeal';

export function MealsPage() {
  const { date, meal } = useSearch({ from: '/authed/meals' });
  const db = useDb();
  const settings = useSettings();
  const meals = useLiveQuery(() => db.meals.filter((m) => !m.deleted).sortBy('name'), [db]);
  const picking = date !== undefined && meal !== undefined;
  return (
    <Page
      title={picking ? `Meal zu ${settings?.mealNames[meal] ?? ''}` : 'Gespeicherte Meals'}
      back={picking ? true : '/more'}
      withTabBar={false}
    >
      {meals?.length === 0 && (
        <EmptyState icon={<UtensilsCrossed />} title="Noch keine Meals">
          Im Tagebuch kannst du jede Mahlzeit über ⋮ → „Als Meal speichern“ ablegen und später mit einem Tipp
          wieder eintragen.
        </EmptyState>
      )}
      <ul className="-mx-4 divide-y divide-border/70">
        {meals?.map((m) => (
          <li key={m.id}>
            <Link
              to="/meals/$mealId"
              params={{ mealId: m.id }}
              search={{ date, meal }}
              className="flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none"
            >
              <MealPhoto photoId={m.photoId} alt="" className="size-12 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{m.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {m.items.length} Zutaten · {m.items.map((i) => i.name).join(', ')}
                </div>
              </div>
              <div className="tabular font-semibold">{fmt0(mealKcal(m))}</div>
            </Link>
          </li>
        ))}
      </ul>
    </Page>
  );
}
