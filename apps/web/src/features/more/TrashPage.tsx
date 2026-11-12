import type { ExerciseEntry, ExerciseTemplate, Meal, WeightEntry } from '@ft/shared';
import { trainingItemsOf, trainingSummary } from '@ft/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { Dumbbell, Footprints, Scale, Search, Trash2, UtensilsCrossed } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { MealPhoto } from '@/components/MealPhoto';
import { EmptyState, Page, Section } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  purgeRecords,
  trashedMeals,
  trashedSteps,
  trashedTrainings,
  trashedWeights,
  type TrashItem,
} from '@/db/trash';
import type { PurgeableTable } from '@/db/write';
import { restoreRecord } from '@/db/write';
import { useSubmitting } from '@/hooks/useSubmitting';
import { fmt0, fmt2, fmtDate, fmtDateOf, fmtIngredients } from '@/lib/format';
import { matchesTrash } from './trashSearch';

/** Rows shown per section; older tombstones stay in the database (and are purged with the section). */
const LIMIT = 100;

const fmtEntries = (n: number) => `${fmt0(n)}\u00a0${n === 1 ? 'Eintrag' : 'Einträge'}`;

const itemsOf = (table: PurgeableTable, rows: readonly { id: string }[] | undefined): TrashItem[] =>
  (rows ?? []).map(({ id }) => ({ table, id }));

export function TrashPage() {
  const db = useDb();
  const allWeights = useLiveQuery(() => trashedWeights(db), [db]);
  const allMeals = useLiveQuery(() => trashedMeals(db), [db]);
  const allTrainings = useLiveQuery(() => trashedTrainings(db), [db]);
  const allSteps = useLiveQuery(() => trashedSteps(db), [db]);
  const { run, busy } = useSubmitting();
  const [query, setQuery] = useState('');
  /** The rows "Endgültig löschen" asks about (fixed when the dialog opens, kept while it closes). */
  const [purging, setPurging] = useState<TrashItem[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const askPurge = (items: TrashItem[]) => {
    setPurging(items);
    setConfirmOpen(true);
  };

  const weights = allWeights?.filter((w) => matchesTrash(query, [w.date, fmtDate(w.date), fmt2(w.kg)]));
  const steps = allSteps?.filter((e) => matchesTrash(query, [e.date, fmtDate(e.date), fmt0(e.steps ?? 0)]));
  const meals = allMeals?.filter((m) => matchesTrash(query, [m.name]));
  const trainings = allTrainings?.filter((t) =>
    matchesTrash(query, [t.name, trainingSummary(trainingItemsOf(t))]),
  );
  const visible = [
    ...itemsOf('weightEntries', weights),
    ...itemsOf('exerciseEntries', steps),
    ...itemsOf('meals', meals),
    ...itemsOf('exerciseTemplates', trainings),
  ];
  const searching = query.trim() !== '';

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
  async function purge() {
    const n = await purgeRecords(db, purging);
    toast.success(`${fmtEntries(n)} endgültig gelöscht`);
  }

  /** "Alle löschen" in a section's title row, only while it has rows. */
  const purgeSection = (table: PurgeableTable, rows: readonly { id: string }[] | undefined, label: string) =>
    rows && rows.length > 0 ? (
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive hover:text-destructive"
        disabled={busy}
        onClick={() => askPurge(itemsOf(table, rows))}
        aria-label={`${label} alle löschen`}
      >
        Alle löschen
      </Button>
    ) : undefined;

  const empty = (icon: ReactNode, title: string) => (
    <EmptyState icon={searching ? <Search /> : icon} title={searching ? 'Keine Treffer' : title} />
  );

  return (
    <Page
      title="Papierkorb"
      back="/more"
      withTabBar={false}
      actions={
        <Button
          variant="ghost"
          size="icon"
          className="text-destructive hover:text-destructive"
          disabled={busy || visible.length === 0}
          onClick={() => askPurge(visible)}
          aria-label="Papierkorb leeren"
        >
          <Trash2 />
        </Button>
      }
    >
      <div className="relative mb-4">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Papierkorb durchsuchen"
          placeholder="Suchen"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      <Section title="Gewicht" action={purgeSection('weightEntries', weights, 'Gewicht')}>
        {weights?.length === 0 && empty(<Scale />, 'Keine gelöschten Gewichtseinträge')}
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
      {allSteps && allSteps.length > 0 && (
        <Section title="Schritte" action={purgeSection('exerciseEntries', steps, 'Schritte')}>
          {steps?.length === 0 && empty(<Footprints />, 'Keine gelöschten Schritte')}
          {steps && steps.length > 0 && (
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
          )}
        </Section>
      )}

      <Section title="Meals" action={purgeSection('meals', meals, 'Meals')}>
        {meals?.length === 0 && empty(<UtensilsCrossed />, 'Keine gelöschten Meals')}
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

      <Section title="Trainings" action={purgeSection('exerciseTemplates', trainings, 'Trainings')}>
        {trainings?.length === 0 && empty(<Dumbbell />, 'Keine gelöschten Trainings')}
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

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Endgültig löschen?"
        description={
          purging.length === 1
            ? '1 Eintrag wird aus dem Papierkorb entfernt und lässt sich nicht wiederherstellen.'
            : `${fmt0(purging.length)} Einträge werden aus dem Papierkorb entfernt und lassen sich nicht wiederherstellen.`
        }
        confirmLabel="Endgültig löschen"
        destructive
        onConfirm={purge}
      />
    </Page>
  );
}
