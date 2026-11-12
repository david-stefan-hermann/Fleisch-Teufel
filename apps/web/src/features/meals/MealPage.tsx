import { useParams, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { useDb } from '@/app/session';
import { EmptyState, Page } from '@/components/Page';
import { PageSkeleton } from '@/components/PageSkeleton';
import { newMealPlaceholder, readMealDraft } from '@/db/mealDraft';
import { parseFoodInto } from '@/lib/into';
import { MealEditor } from './MealEditor';
import { MealLogView } from './MealLogView';

/**
 * A saved meal. With day and meal in the URL (food search, tab "Eigene") it is logged
 * (`MealLogView`), with `into` as well its ingredients are added to that target instead; without them
 * (Mehr → Meals) it is edited (`MealEditor`), also a new meal that has only its draft.
 */
export function MealPage() {
  const { mealId } = useParams({ from: '/authed/meals/$mealId' });
  const search = useSearch({ from: '/authed/meals/$mealId' });
  const db = useDb();
  const meal = useLiveQuery(async () => (await db.meals.get(mealId)) ?? null, [db, mealId]);
  // "Neues Meal": no record yet, only the editor's draft.
  const isNew = useLiveQuery(async () => (await readMealDraft(db, mealId))?.isNew === true, [db, mealId]);

  if (meal === undefined || isNew === undefined) return <PageSkeleton title="Meal" />;
  if (!meal && isNew) return <MealEditor meal={newMealPlaceholder(mealId)} />;
  if (!meal || meal.deleted) {
    return (
      <Page title="Meal" back withTabBar={false}>
        <EmptyState title="Meal nicht gefunden" />
      </Page>
    );
  }
  if (search.date !== undefined && search.meal !== undefined)
    // A change of the meal (sync) is taken over while nothing was changed here, else the view asks.
    return (
      <MealLogView
        key={meal.id}
        meal={meal}
        date={search.date}
        mealIndex={search.meal}
        into={parseFoodInto(search.into)}
      />
    );
  return <MealEditor meal={meal} fromLog={search.from === 'log'} />;
}
