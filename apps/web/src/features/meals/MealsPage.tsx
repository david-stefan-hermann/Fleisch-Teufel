import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { UtensilsCrossed } from 'lucide-react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { MealPhoto } from '@/components/MealPhoto';
import { EmptyState, Page } from '@/components/Page';
import { SwipeToDelete } from '@/components/SwipeToDelete';
import { deleteRecord, restoreRecord } from '@/db/write';
import { fmt0, fmtIngredients } from '@/lib/format';
import { mealKcal } from './logMeal';

export function MealsPage() {
  const db = useDb();
  const meals = useLiveQuery(() => db.meals.filter((m) => !m.deleted).sortBy('name'), [db]);
  return (
    <Page title="Gespeicherte Meals" back="/more" withTabBar={false}>
      {meals?.length === 0 && (
        <EmptyState icon={<UtensilsCrossed />} title="Noch keine Meals">
          Öffne im Tagebuch eine Mahlzeit und tippe oben auf das Speichern-Icon, um sie als Meal abzulegen.
          Eingetragen wird ein Meal über die Lebensmittelsuche, Reiter „Eigene“.
        </EmptyState>
      )}
      <ul className="-mx-4 divide-y divide-border/70">
        {meals?.map((m) => (
          <li key={m.id}>
            <SwipeToDelete
              label={`${m.name} löschen`}
              contentClassName="bg-background"
              onDelete={async () => {
                await deleteRecord(db, 'meals', m.id);
                toast(`${m.name} gelöscht`, {
                  action: { label: 'Rückgängig', onClick: () => void restoreRecord(db, 'meals', m.id) },
                });
              }}
            >
              <Link
                to="/meals/$mealId"
                params={{ mealId: m.id }}
                className="flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none"
              >
                <MealPhoto photoId={m.photoId} alt="" className="size-12 shrink-0 rounded-lg" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{m.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {fmtIngredients(m.items.length)} · {m.items.map((i) => i.name).join(', ')}
                  </div>
                </div>
                <div className="tabular font-semibold">{fmt0(mealKcal(m))}</div>
              </Link>
            </SwipeToDelete>
          </li>
        ))}
      </ul>
    </Page>
  );
}
