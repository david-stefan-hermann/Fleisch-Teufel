import type { Meal, WeightEntry } from '@ft/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { Scale, UtensilsCrossed } from 'lucide-react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { MealPhoto } from '@/components/MealPhoto';
import { EmptyState, Page, Section } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { trashedMeals, trashedWeights } from '@/db/trash';
import { restoreRecord } from '@/db/write';
import { fmt1, fmtDate, fmtDateOf, fmtIngredients } from '@/lib/format';

/** Rows shown per section; older tombstones stay in the database. */
const LIMIT = 100;

export function TrashPage() {
  const db = useDb();
  const weights = useLiveQuery(() => trashedWeights(db), [db]);
  const meals = useLiveQuery(() => trashedMeals(db), [db]);

  async function restoreWeight(w: WeightEntry) {
    await restoreRecord(db, 'weightEntries', w.id);
    toast.success(`Gewicht vom ${fmtDate(w.date)} wiederhergestellt`);
  }
  async function restoreMeal(m: Meal) {
    await restoreRecord(db, 'meals', m.id);
    toast.success(`„${m.name}“ wiederhergestellt`);
  }

  return (
    <Page title="Papierkorb" back="/more" withTabBar={false}>
      <p className="mb-4 px-1 text-sm text-muted-foreground text-pretty">
        Gelöschte Gewichtseinträge und Meals bleiben hier und lassen sich auf allen Geräten wiederherstellen.
      </p>

      <Section title="Gewicht">
        <p className="px-4 pb-2 text-xs text-muted-foreground text-pretty">
          Ein Eintrag pro Tag: ein neues Gewicht am selben Tag ersetzt den gelöschten.
        </p>
        {weights?.length === 0 && <EmptyState icon={<Scale />} title="Keine gelöschten Gewichtseinträge" />}
        {weights && weights.length > 0 && (
          <ul className="divide-y divide-border/70 pb-1">
            {weights.slice(0, LIMIT).map((w) => (
              <li key={w.id} className="flex min-h-14 items-center gap-3 px-4 py-2">
                <div className="tabular min-w-0 flex-1">
                  <div className="font-medium">
                    {fmtDate(w.date)} · {fmt1(w.kg)}&nbsp;kg
                  </div>
                  <div className="text-xs text-muted-foreground">gelöscht am {fmtDateOf(w.updatedAt)}</div>
                </div>
                <Button
                  variant="outline"
                  onClick={() => void restoreWeight(w)}
                  aria-label={`Gewicht vom ${fmtDate(w.date)} wiederherstellen`}
                >
                  Wiederherstellen
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Meals">
        {meals?.length === 0 && <EmptyState icon={<UtensilsCrossed />} title="Keine gelöschten Meals" />}
        {meals && meals.length > 0 && (
          <ul className="divide-y divide-border/70 pb-1">
            {meals.slice(0, LIMIT).map((m) => (
              <li key={m.id} className="flex min-h-16 items-center gap-3 px-4 py-2">
                <MealPhoto photoId={m.photoId} alt="" className="size-12 shrink-0 rounded-lg" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{m.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {fmtIngredients(m.items.length)} · gelöscht am {fmtDateOf(m.updatedAt)}
                  </div>
                </div>
                <Button
                  variant="outline"
                  onClick={() => void restoreMeal(m)}
                  aria-label={`${m.name} wiederherstellen`}
                >
                  Wiederherstellen
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Page>
  );
}
