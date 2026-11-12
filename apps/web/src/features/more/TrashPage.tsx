import type { ExerciseEntry, ExerciseTemplate, Meal, WeightEntry } from '@ft/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { Dumbbell, Scale, UtensilsCrossed } from 'lucide-react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { MealPhoto } from '@/components/MealPhoto';
import { EmptyState, Page, Section } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { trashedMeals, trashedSteps, trashedTrainings, trashedWeights } from '@/db/trash';
import { restoreRecord } from '@/db/write';
import { useSubmitting } from '@/hooks/useSubmitting';
import { trainingItemsOf, trainingSummary } from '@ft/shared';
import { fmt0, fmt2, fmtDate, fmtDateOf, fmtIngredients } from '@/lib/format';

/** Rows shown per section; older tombstones stay in the database. */
const LIMIT = 100;

export function TrashPage() {
  const db = useDb();
  const weights = useLiveQuery(() => trashedWeights(db), [db]);
  const meals = useLiveQuery(() => trashedMeals(db), [db]);
  const trainings = useLiveQuery(() => trashedTrainings(db), [db]);
  const steps = useLiveQuery(() => trashedSteps(db), [db]);
  const { run, busy } = useSubmitting();

  async function restoreWeight(w: WeightEntry) {
    await restoreRecord(db, 'weightEntries', w.id);
    toast.success(`Gewicht vom ${fmtDate(w.date)} wiederhergestellt`);
  }
  async function restoreSteps(e: ExerciseEntry) {
    await restoreRecord(db, 'exerciseEntries', e.id);
    toast.success(`Schritte vom ${fmtDate(e.date)} wiederhergestellt`);
  }
  async function restoreMeal(m: Meal) {
    await restoreRecord(db, 'meals', m.id);
    toast.success(`„${m.name}“ wiederhergestellt`);
  }
  async function restoreTraining(t: ExerciseTemplate) {
    await restoreRecord(db, 'exerciseTemplates', t.id);
    toast.success(`„${t.name}“ wiederhergestellt`);
  }

  return (
    <Page title="Papierkorb" back="/more" withTabBar={false}>
      <Section title="Gewicht">
        {weights?.length === 0 && <EmptyState icon={<Scale />} title="Keine gelöschten Gewichtseinträge" />}
        {weights && weights.length > 0 && (
          <ul className="divide-y divide-border/70 pb-1">
            {weights.slice(0, LIMIT).map((w) => (
              <li key={w.id} className="flex min-h-14 items-center gap-3 px-4 py-2">
                <div className="tabular min-w-0 flex-1">
                  <div className="font-medium">
                    {fmtDate(w.date)} · {fmt2(w.kg)}&nbsp;kg
                  </div>
                  <div className="text-xs text-muted-foreground">gelöscht am {fmtDateOf(w.updatedAt)}</div>
                </div>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void run(() => restoreWeight(w))}
                  aria-label={`Gewicht vom ${fmtDate(w.date)} wiederherstellen`}
                >
                  Wiederherstellen
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Only for people who use the steps import: no empty section for everybody else. */}
      {steps && steps.length > 0 && (
        <Section title="Schritte">
          <ul className="divide-y divide-border/70 pb-1">
            {steps.slice(0, LIMIT).map((e) => (
              <li key={e.id} className="flex min-h-14 items-center gap-3 px-4 py-2">
                <div className="tabular min-w-0 flex-1">
                  <div className="font-medium">
                    {fmtDate(e.date)} · {fmt0(e.steps ?? 0)}&nbsp;Schritte
                  </div>
                  <div className="text-xs text-muted-foreground">gelöscht am {fmtDateOf(e.updatedAt)}</div>
                </div>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void run(() => restoreSteps(e))}
                  aria-label={`Schritte vom ${fmtDate(e.date)} wiederherstellen`}
                >
                  Wiederherstellen
                </Button>
              </li>
            ))}
          </ul>
        </Section>
      )}

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
                  disabled={busy}
                  onClick={() => void run(() => restoreMeal(m))}
                  aria-label={`${m.name} wiederherstellen`}
                >
                  Wiederherstellen
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Gespeicherte Trainings">
        {trainings?.length === 0 && (
          <EmptyState icon={<Dumbbell />} title="Keine gelöschten gespeicherten Trainings" />
        )}
        {trainings && trainings.length > 0 && (
          <ul className="divide-y divide-border/70 pb-1">
            {trainings.slice(0, LIMIT).map((t) => (
              <li key={t.id} className="flex min-h-16 items-center gap-3 px-4 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{t.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {trainingSummary(trainingItemsOf(t))} · gelöscht am {fmtDateOf(t.updatedAt)}
                  </div>
                </div>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void run(() => restoreTraining(t))}
                  aria-label={`${t.name} wiederherstellen`}
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
