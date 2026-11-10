import {
  dayId,
  isAutoTrainingKcal,
  STEPS_MET,
  trainingKcal,
  type ExerciseEntry,
  type ISODate,
} from '@ft/shared';
import { useNavigate, useParams, useRouter } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { EmptyState, Page, Section } from '@/components/Page';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { deleteRecord, patchRecord, restoreRecord } from '@/db/write';
import { TrainingKcal, validOwnKcal } from '@/features/exercise/TrainingFields';
import { useSettings, useToday } from '@/hooks/data';
import { useSubmitting } from '@/hooks/useSubmitting';
import { fmt0, fmtDayLong, fmtRelativeDay, NO_VALUE } from '@/lib/format';
import { goBackOr } from '@/lib/history';
import { fmtKm } from './StepsRow';

/**
 * A day's steps from Apple Health (`/steps/$date`): steps and distance are data, only the kcal can
 * be changed (typed kcal stay when the next import updates the steps). Trash deletes for good: the
 * next import leaves the day alone, the trash brings it back.
 */
export function StepsPage() {
  const { date } = useParams({ strict: false }) as { date: ISODate };
  const db = useDb();
  const entry = useLiveQuery(
    async () => (await db.exerciseEntries.get(dayId.steps(date))) ?? null,
    [db, date],
  );
  if (entry === undefined) return null;
  if (!entry || entry.deleted)
    return (
      <Page title="Schritte" back withTabBar={false}>
        <EmptyState title="Keine Schritte an diesem Tag" />
      </Page>
    );
  return <StepsForm key={entry.id} entry={entry} />;
}

function StepsForm({ entry }: { entry: ExerciseEntry }) {
  const db = useDb();
  const navigate = useNavigate();
  const router = useRouter();
  const today = useToday();
  const settings = useSettings();
  const [own, setOwn] = useState<number | null>(isAutoTrainingKcal(entry) ? null : entry.kcal);
  const [confirm, setConfirm] = useState(false);
  const { busy, run } = useSubmitting();

  const computed = trainingKcal(STEPS_MET, entry.weightKg, entry.minutes);
  const kcal = own ?? computed;
  const changed = validOwnKcal(own) && Math.round(kcal) !== entry.kcal;
  const relative = fmtRelativeDay(entry.date, today);
  const long = fmtDayLong(entry.date);

  const leave = () =>
    goBackOr(
      router.history,
      1,
      () => void navigate({ to: '/', search: { date: entry.date }, replace: true }),
    );

  async function save() {
    await patchRecord(db, 'exerciseEntries', entry.id, { kcal: Math.round(kcal) });
    toast.success(`Schritte: ${fmt0(kcal)} kcal`);
    leave();
  }

  async function remove() {
    setConfirm(false);
    await deleteRecord(db, 'exerciseEntries', entry.id);
    toast('Schritte gelöscht', {
      action: { label: 'Rückgängig', onClick: () => void restoreRecord(db, 'exerciseEntries', entry.id) },
    });
    leave();
  }

  return (
    <Page
      title="Schritte"
      back
      withTabBar={false}
      actions={
        <Button
          variant="ghost"
          size="icon"
          aria-label="Schritte löschen"
          disabled={busy}
          onClick={() => setConfirm(true)}
        >
          <Trash2 className="text-destructive" aria-hidden />
        </Button>
      }
      footer={
        <Button size="lg" disabled={!changed || busy} onClick={() => void run(save)}>
          Änderungen übernehmen
        </Button>
      }
    >
      <p className="mb-3 text-sm text-muted-foreground">
        {relative === long ? long : `${relative}, ${long}`}
      </p>
      <Section>
        <dl className="grid grid-cols-2 gap-px overflow-hidden bg-border/70">
          <div className="bg-card px-4 py-3.5">
            <dd className="tabular text-2xl leading-tight font-bold">{fmt0(entry.steps ?? 0)}</dd>
            <dt className="text-xs text-muted-foreground">Schritte</dt>
          </div>
          <div className="bg-card px-4 py-3.5">
            <dd className="tabular text-2xl leading-tight font-bold">
              {entry.distanceM !== null ? fmtKm(entry.distanceM) : NO_VALUE}
            </dd>
            <dt className="text-xs text-muted-foreground">
              {fmt0(entry.minutes)} Min. bei {entry.distanceM !== null ? '4,8 km/h' : '100 Schritten/Min.'}
            </dt>
          </div>
        </dl>
      </Section>
      <TrainingKcal
        tone="steps"
        computed={computed}
        own={own}
        onOwnChange={setOwn}
        met={STEPS_MET}
        weightKg={entry.weightKg}
        minutes={entry.minutes}
        marks={settings?.addStepsCalories === false ? ['nicht angerechnet'] : []}
      />
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schritte löschen?</DialogTitle>
            <DialogDescription>
              Der nächste Abruf trägt diesen Tag nicht wieder ein. Zurück über den Papierkorb.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              Abbrechen
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => void run(remove)}>
              Löschen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
