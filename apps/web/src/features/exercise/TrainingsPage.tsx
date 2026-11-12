import { DEFAULT_WEIGHT_KG, metFor, trainingItemsOf, trainingKcal, trainingSummary } from '@ft/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Bookmark, Pin, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { Page } from '@/components/Page';
import { SwipeToDelete } from '@/components/SwipeToDelete';
import { Button } from '@/components/ui/button';
import { startNewTraining } from '@/db/trainingDraft';
import { deleteRecord, restoreRecord } from '@/db/write';
import { useCurrentWeight, useToday } from '@/hooks/data';
import { useSubmitting } from '@/hooks/useSubmitting';
import { fmt0 } from '@/lib/format';
import { sortTrainings, useTypeOptions } from './training';

/** Mehr → Trainings (saved trainings): pinned first, then by name; tap edits, swipe deletes (undo, trash). */
export function TrainingsPage() {
  const db = useDb();
  const navigate = useNavigate();
  const { busy, run } = useSubmitting();
  const options = useTypeOptions();
  const weight = useCurrentWeight(useToday()) ?? DEFAULT_WEIGHT_KG;
  const trainings = useLiveQuery(
    async () => sortTrainings(await db.exerciseTemplates.filter((t) => !t.deleted).toArray()),
    [db],
  );
  return (
    <Page title="Trainings" back="/more" withTabBar={false}>
      <Button
        variant="outline"
        className="mb-3 w-full"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const templateId = await startNewTraining(db);
            await navigate({ to: '/trainings/$templateId', params: { templateId } });
          })
        }
      >
        <Plus aria-hidden /> Neues Training
      </Button>
      {trainings?.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">Noch keine Trainings.</p>
      )}
      <ul className="-mx-4 divide-y divide-border/70">
        {trainings?.map((t) => {
          const items = trainingItemsOf(t);
          // With the current weight: what logging it today would count.
          const kcal = items.reduce((sum, i) => {
            const type = options.find((o) => o.key === i.typeKey);
            return type ? sum + trainingKcal(metFor(type, i.intensity), weight, i.minutes) : sum;
          }, 0);
          const Icon = t.pinned === true ? Pin : Bookmark;
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
                    <div className="flex items-center gap-1.5 font-medium">
                      <Icon
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-label={t.pinned === true ? 'angepinnt' : undefined}
                        aria-hidden={t.pinned !== true}
                      />
                      <span className="truncate">{t.name}</span>
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{trainingSummary(items)}</div>
                  </div>
                  <div className="tabular font-semibold">{fmt0(kcal)} kcal</div>
                </Link>
              </SwipeToDelete>
            </li>
          );
        })}
      </ul>
    </Page>
  );
}
