import type { ExerciseEntry, ISODate } from '@ft/shared';
import { INTENSITY_LABELS_DE } from '@ft/shared';
import { Link } from '@tanstack/react-router';
import { Dumbbell, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { Section } from '@/components/Page';
import { SwipeToDelete } from '@/components/SwipeToDelete';
import { Button } from '@/components/ui/button';
import { deleteRecord, restoreRecord } from '@/db/write';
import { fmt0 } from '@/lib/format';

export function ExerciseCard({
  date,
  exercises,
  credited,
}: {
  date: ISODate;
  exercises: ExerciseEntry[];
  credited: boolean;
}) {
  const db = useDb();
  const total = exercises.reduce((s, e) => s + e.kcal, 0);
  return (
    <Section
      title={
        <span className="flex items-baseline gap-2">
          Training
          {total > 0 && (
            <span className="tabular text-sm font-normal text-muted-foreground">{fmt0(total)} kcal</span>
          )}
        </span>
      }
      action={
        <Button variant="ghost" size="icon" asChild>
          <Link to="/exercise" search={{ date }} aria-label="Training hinzufügen">
            <Plus className="size-5 text-primary" aria-hidden />
          </Link>
        </Button>
      }
    >
      {exercises.length === 0 ? (
        <Link
          to="/exercise"
          search={{ date }}
          className="mx-4 mb-4 flex h-11 items-center justify-center gap-2 rounded-xl border border-dashed text-sm text-muted-foreground transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <Dumbbell className="size-4" aria-hidden /> Training eintragen
        </Link>
      ) : (
        <ul className="divide-y divide-border/70 pb-1">
          {exercises.map((e) => (
            <li key={e.id}>
              <SwipeToDelete
                label={`${e.name} löschen`}
                onDelete={async () => {
                  await deleteRecord(db, 'exerciseEntries', e.id);
                  toast(`${e.name} gelöscht`, {
                    action: {
                      label: 'Rückgängig',
                      onClick: () => void restoreRecord(db, 'exerciseEntries', e.id),
                    },
                  });
                }}
              >
                <Link
                  to="/exercise"
                  search={{ date, entryId: e.id }}
                  draggable={false}
                  className="flex min-h-14 items-center gap-3 px-4 py-2 transition-colors select-none hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{e.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {[`${fmt0(e.minutes)} Min.`, INTENSITY_LABELS_DE[e.intensity], e.note]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                  <div className="tabular font-semibold text-exercise">+{fmt0(e.kcal)}</div>
                </Link>
              </SwipeToDelete>
            </li>
          ))}
          {!credited && (
            <li className="px-4 py-2 text-xs text-muted-foreground">
              Trainingskalorien werden laut Einstellung nicht aufs Ziel angerechnet.
            </li>
          )}
        </ul>
      )}
    </Section>
  );
}
