import { DEFAULT_WEIGHT_KG, metFor, netExerciseKcal, today } from '@ft/shared';
import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Dumbbell } from 'lucide-react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { EmptyState, Page } from '@/components/Page';
import { SwipeToDelete } from '@/components/SwipeToDelete';
import { deleteRecord, restoreRecord } from '@/db/write';
import { useCurrentWeight } from '@/hooks/data';
import { fmt0 } from '@/lib/format';
import { describe, useTypeOptions } from './training';

/** Mehr → Gespeicherte Trainings: alphabetical, tap edits, swipe deletes (with undo, then trash). */
export function TrainingsPage() {
  const db = useDb();
  const options = useTypeOptions();
  const weight = useCurrentWeight(today()) ?? DEFAULT_WEIGHT_KG;
  const trainings = useLiveQuery(() => db.exerciseTemplates.filter((t) => !t.deleted).sortBy('name'), [db]);
  return (
    <Page title="Gespeicherte Trainings" back="/more" withTabBar={false}>
      {trainings?.length === 0 && (
        <EmptyState icon={<Dumbbell />} title="Noch keine gespeicherten Trainings">
          Beim Eintragen eines Trainings speicherst du es über das Speichern-Icon oben rechts.
        </EmptyState>
      )}
      <ul className="-mx-4 divide-y divide-border/70">
        {trainings?.map((t) => {
          const type = options.find((o) => o.key === t.typeKey);
          // With the current weight: what logging it today would count.
          const kcal = type ? netExerciseKcal(metFor(type, t.intensity), weight, t.minutes) : null;
          return (
            <li key={t.id}>
              <SwipeToDelete
                label={`${t.name} löschen`}
                contentClassName="bg-background"
                onDelete={async () => {
                  await deleteRecord(db, 'exerciseTemplates', t.id);
                  toast(`„${t.name}“ gelöscht`, {
                    action: {
                      label: 'Rückgängig',
                      onClick: () => void restoreRecord(db, 'exerciseTemplates', t.id),
                    },
                  });
                }}
              >
                <Link
                  to="/trainings/$templateId"
                  params={{ templateId: t.id }}
                  className="flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{t.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {describe(t.typeName, t.minutes, t.intensity, t.note)}
                    </div>
                  </div>
                  {kcal !== null && <div className="tabular font-semibold">{fmt0(kcal)} kcal</div>}
                </Link>
              </SwipeToDelete>
            </li>
          );
        })}
      </ul>
    </Page>
  );
}
