import {
  DEFAULT_WEIGHT_KG,
  formatDuration,
  metFor,
  trainingKcal,
  type ExerciseTemplate,
  type TrainingItem,
} from '@ft/shared';
import {
  useBlocker,
  useNavigate,
  useParams,
  useRouter,
  useSearch,
  type ShouldBlockFn,
} from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { ConflictBanner } from '@/components/ConflictBanner';
import { DiscardDialog } from '@/components/DiscardDialog';
import { EmptyState, Page, Section } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  clearTrainingDraft,
  draftFromTraining,
  isTrainingDirty,
  isTrainingDraftStale,
  newTrainingPlaceholder,
  readTrainingDraft,
  saveTrainingDraft,
  writeTrainingDraft,
  type TrainingDraft,
} from '@/db/trainingDraft';
import { deleteRecord, restoreRecord } from '@/db/write';
import { useCurrentWeight, useToday } from '@/hooks/data';
import { useSubmitting } from '@/hooks/useSubmitting';
import { fmt0 } from '@/lib/format';
import { goBackOr } from '@/lib/history';
import { formatInto, rememberIntoStart } from '@/lib/into';
import { describe, useTypeOptions, type TypeOption } from './training';
import { TrainingFields } from './TrainingFields';
import { TrainingLogView } from './TrainingLogView';
import { TrainingRow } from './TrainingRow';

/**
 * A saved training. With a day in the URL (training search, diary) it is logged (`TrainingLogView`);
 * without one (Mehr → Trainings, the pencil of the log view) it is edited, also a new one
 * that has only its draft ("Neues Training").
 */
export function TrainingEditorPage() {
  const { templateId } = useParams({ from: '/authed/trainings/$templateId' });
  const search = useSearch({ from: '/authed/trainings/$templateId' });
  const db = useDb();
  const template = useLiveQuery(
    async () => (await db.exerciseTemplates.get(templateId)) ?? null,
    [db, templateId],
  );
  const isNew = useLiveQuery(
    async () => (await readTrainingDraft(db, templateId))?.isNew === true,
    [db, templateId],
  );
  if (template === undefined || isNew === undefined) return null;
  if (!template && isNew) return <TrainingEditor template={newTrainingPlaceholder(templateId)} />;
  if (!template || template.deleted) {
    return (
      <Page title="Training" back="/trainings" withTabBar={false}>
        <EmptyState title="Training nicht gefunden" />
      </Page>
    );
  }
  if (search.date !== undefined)
    // A new key after an edit (pencil and back, or saved from here) starts again from the saved values.
    return <TrainingLogView key={template.updatedAt} template={template} date={search.date} />;
  return <TrainingEditor template={template} fromLog={search.from === 'log'} />;
}

/** Waits for the draft, drops one that is only old, and mounts the form with it (see `MealEditor`). */
function TrainingEditor({ template, fromLog = false }: { template: ExerciseTemplate; fromLog?: boolean }) {
  const db = useDb();
  const draft = useLiveQuery(() => readTrainingDraft(db, template.id), [db, template.id]);
  const stale = !!draft && !draft.isNew && isTrainingDraftStale(draft, template);
  const conflict = stale && isTrainingDirty(draft, template);
  useEffect(() => {
    if (stale && !conflict) void clearTrainingDraft(db, template.id);
  }, [stale, conflict, db, template.id]);
  if (draft === undefined) return null;
  if (stale && !conflict) return null;
  return (
    <TrainingEditorForm
      key={`${template.id}:${draft ? (draft.baseUpdatedAt ?? 'draft') : template.updatedAt}`}
      template={template}
      initial={draft ?? draftFromTraining(template)}
      fromDraft={!!draft}
      fromLog={fromLog}
      conflict={
        conflict
          ? {
              reload: () => void clearTrainingDraft(db, template.id),
              keep: () => void writeTrainingDraft(db, { ...draft, baseUpdatedAt: template.updatedAt }),
            }
          : null
      }
    />
  );
}

function TrainingEditorForm({
  template,
  initial,
  fromDraft,
  fromLog,
  conflict,
}: {
  template: ExerciseTemplate;
  initial: TrainingDraft;
  fromDraft: boolean;
  fromLog: boolean;
  conflict: { reload: () => void; keep: () => void } | null;
}) {
  const db = useDb();
  const navigate = useNavigate();
  const router = useRouter();
  const today = useToday();
  const options = useTypeOptions();
  const weight = useCurrentWeight(today) ?? DEFAULT_WEIGHT_KG;
  const nameId = useId();
  const [draft, setDraft] = useState(initial);
  // Back from "Aktivität hinzufügen" the new activity is open, else the first.
  const [open, setOpen] = useState<number | null>(fromDraft ? initial.items.length - 1 : 0);
  /** Write-through: local state for smooth typing, the `kv` draft for surviving navigation. */
  const commit = (next: TrainingDraft) => {
    setDraft(next);
    void writeTrainingDraft(db, next);
  };
  const updateItem = (i: number, patch: Partial<TrainingItem>, persist = true) => {
    const next = { ...draft, items: draft.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) };
    if (persist) commit(next);
    else setDraft(next);
  };

  const isNew = draft.isNew === true;
  const dirty = isNew
    ? draft.name.trim().length > 0 || draft.items.length > 0 || draft.pinned
    : isTrainingDirty(draft, template);
  const canSave = dirty && draft.name.trim().length > 0 && draft.items.length > 0;
  const into = formatInto({ kind: 'training', templateId: template.id });
  // Set right before leaving after a save or delete: the template prop still shows the old state then.
  const leaving = useRef(false);
  const shouldBlockFn = useCallback<ShouldBlockFn>(
    ({ next }) => {
      // The way through the training search keeps the draft, so it does not count as leaving.
      const toSearch =
        (next.pathname === '/exercise' || next.pathname.startsWith('/sport/')) &&
        (next.search as { into?: string }).into === into;
      // A new training left without any input leaves nothing behind.
      if (isNew && !dirty && !toSearch && !leaving.current) void clearTrainingDraft(db, template.id);
      return !leaving.current && dirty && !toSearch;
    },
    [dirty, into, isNew, db, template.id],
  );
  const blocker = useBlocker({ shouldBlockFn, withResolver: true, enableBeforeUnload: false });

  const typeOf = (key: string): TypeOption | undefined => options.find((o) => o.key === key);
  const kcalOf = (item: TrainingItem) => {
    const type = typeOf(item.typeKey);
    return type ? trainingKcal(metFor(type, item.intensity), weight, item.minutes) : 0;
  };
  const totalKcal = draft.items.reduce((s, i) => s + kcalOf(i), 0);
  const totalMinutes = draft.items.reduce((s, i) => s + i.minutes, 0);
  const name = draft.name.trim() || template.name || 'Neues Training';

  async function save(): Promise<boolean> {
    if (!canSave) return false;
    if (!(await saveTrainingDraft(db, draft))) {
      toast.error('Das Training gibt es nicht mehr.');
      return false;
    }
    toast.success(`„${name}“ gespeichert`);
    return true;
  }

  /** Saving closes the editor: back to the page that opened it ("Training eintragen" or the list). */
  const { busy: saving, run } = useSubmitting();
  async function saveAndClose() {
    if (!(await save())) return;
    leaving.current = true;
    goBackOr(router.history, 1, () => void navigate({ to: '/trainings', ignoreBlocker: true }));
  }

  async function remove() {
    await deleteRecord(db, 'exerciseTemplates', template.id);
    await clearTrainingDraft(db, template.id);
    toast(`„${template.name}“ gelöscht`, {
      action: {
        label: 'Rückgängig',
        onClick: () => void restoreRecord(db, 'exerciseTemplates', template.id),
      },
    });
    leaving.current = true;
    // From "Training eintragen" back past that page (it would show a deleted training).
    goBackOr(router.history, fromLog ? 2 : 1, () => void navigate({ to: '/trainings', ignoreBlocker: true }));
  }

  function addActivity() {
    rememberIntoStart(router.history);
    void navigate({ to: '/exercise', search: { date: today, into } });
  }

  return (
    <Page
      title={name}
      back="/trainings"
      withTabBar={false}
      actions={
        !isNew && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Training löschen"
            disabled={saving}
            onClick={() => void run(remove)}
          >
            <Trash2 className="text-destructive" aria-hidden />
          </Button>
        )
      }
      footer={
        <Button size="lg" disabled={!canSave || saving} onClick={() => void run(saveAndClose)}>
          Speichern
        </Button>
      }
    >
      {conflict && <ConflictBanner onReload={conflict.reload} onKeep={conflict.keep} />}
      <Section>
        <div className="grid gap-1.5 p-4">
          <Label htmlFor={nameId}>Name</Label>
          <Input
            id={nameId}
            autoComplete="off"
            maxLength={80}
            value={draft.name}
            placeholder={isNew ? 'z. B. Gym-Besuch' : undefined}
            onChange={(e) => commit({ ...draft, name: e.target.value })}
          />
        </div>
      </Section>
      <Section
        title={
          <span className="flex items-baseline gap-2">
            Aktivitäten
            {totalMinutes > 0 && (
              <span className="tabular text-sm font-normal text-muted-foreground">
                {formatDuration(totalMinutes)}
              </span>
            )}
          </span>
        }
      >
        <ul className="divide-y divide-border/70">
          {draft.items.map((item, i) => {
            const type = typeOf(item.typeKey);
            return (
              <li key={i}>
                <TrainingRow
                  title={type?.name ?? item.typeName}
                  detail={describe(null, item.minutes, item.intensity, item.note?.trim() || null)}
                  kcal={kcalOf(item)}
                  open={open === i}
                  onToggle={() => setOpen(open === i ? null : i)}
                  removeDisabled={draft.items.length === 1}
                  onRemove={() => {
                    commit({ ...draft, items: draft.items.filter((_, j) => j !== i) });
                    setOpen(null);
                  }}
                >
                  <TrainingFields
                    name={type?.name ?? item.typeName}
                    intensity={item.intensity}
                    onIntensityChange={(intensity) => updateItem(i, { intensity })}
                    intensityDisabled={type?.custom}
                    minutes={item.minutes}
                    onMinutesLive={(minutes) => updateItem(i, { minutes }, false)}
                    onMinutesChange={(minutes) => minutes && updateItem(i, { minutes })}
                    note={item.note ?? ''}
                    onNoteChange={(note) => updateItem(i, { note })}
                  />
                </TrainingRow>
              </li>
            );
          })}
        </ul>
        <div className="px-4 pt-1 pb-4">
          <Button variant="outline" size="sm" className="w-full" onClick={addActivity}>
            <Plus aria-hidden /> Aktivität hinzufügen
          </Button>
        </div>
      </Section>
      <Section>
        <label className="flex min-h-14 items-center justify-between gap-3 px-4">
          <span className="font-medium">Anpinnen</span>
          <Switch checked={draft.pinned} onCheckedChange={(pinned) => commit({ ...draft, pinned })} />
        </label>
      </Section>
      {!isNew && draft.items.length > 0 && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl bg-muted p-4">
          <span className="text-sm">Verbrauch beim aktuellen Gewicht</span>
          <span className="tabular shrink-0 text-2xl font-bold text-exercise">{fmt0(totalKcal)} kcal</span>
        </div>
      )}
      <DiscardDialog
        open={blocker.status === 'blocked'}
        name={name}
        onKeepEditing={() => blocker.reset?.()}
        onDiscard={async () => {
          await clearTrainingDraft(db, template.id);
          blocker.proceed?.();
        }}
        onSave={async () => {
          if (await save()) {
            leaving.current = true;
            blocker.proceed?.();
          } else blocker.reset?.();
        }}
      />
    </Page>
  );
}
