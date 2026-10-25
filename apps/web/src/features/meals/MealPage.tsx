import { useParams, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { useDb } from '@/app/session';
import { EmptyState, Page } from '@/components/Page';
import { parseInto } from '@/lib/into';
import { MealEditor } from './MealEditor';
import { MealLogView } from './MealLogView';

/**
 * A saved meal. With day and meal in the URL (food search, tab "Eigene") it is logged
 * (`MealLogView`), with `into` as well its ingredients are added to that target instead; without them
 * (Mehr → Gespeicherte Meals) it is edited (`MealEditor`).
 */
export function MealPage() {
  const { mealId } = useParams({ from: '/authed/meals/$mealId' });
  const search = useSearch({ from: '/authed/meals/$mealId' });
  const db = useDb();
  const meal = useLiveQuery(async () => (await db.meals.get(mealId)) ?? null, [db, mealId]);

  if (meal === undefined) return null;
  if (!meal || meal.deleted) {
    return (
      <Page title="Meal" back withTabBar={false}>
        <EmptyState title="Meal nicht gefunden" />
      </Page>
    );
  }
  if (search.date !== undefined && search.meal !== undefined)
    // A new key after an edit ("Meal bearbeiten" and back) starts again with all ingredients.
    return (
      <MealLogView
        key={meal.updatedAt}
        meal={meal}
        date={search.date}
        mealIndex={search.meal}
        into={parseInto(search.into)}
      />
    );
  return <MealEditor meal={meal} fromLog={search.from === 'log'} />;
}
