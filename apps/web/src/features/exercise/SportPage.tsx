import {
  DEFAULT_WEIGHT_KG,
  EXERCISE_TYPE_MAP,
  isAutoTrainingKcal,
  isStepsEntry,
  metFor,
  trainingKcal,
  type ExerciseEntry,
  type Intensity,
  type ISODate,
} from '@ft/shared';
import { Navigate, useNavigate, useParams, useRouter, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { BookmarkCheck, BookmarkPlus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { DayNote } from '@/components/DayNote';
import { NameDialog } from '@/components/NameDialog';
import { NotFoundPage } from '@/components/NotFoundPage';
import { Page, Section } from '@/components/Page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { logTrainings, saveExercise, saveTraining } from '@/db/entries';
import { addActivityToTraining } from '@/db/trainingDraft';
import type { TrainingHistory } from '@/db/trainingSuggestions';
import { deleteRecord, restoreRecord } from '@/db/write';
import { useCurrentWeight, useSettings, useTrainingHistory } from '@/hooks/data';
import { useSubmitting } from '@/hooks/useSubmitting';
import { fmt0 } from '@/lib/format';
import { goBackOr } from '@/lib/history';
import { openTarget, returnFromInto, trainingTarget } from '@/lib/into';
import { useReturnToDiary } from '@/lib/logFlow';
import {
  DEFAULT_SPORT_VALUES,
  describe,
  describeValues,
  toLog,
  trainingTitle,
  useTrainingNames,
  type TypeOption,
} from './training';
import { TrainingFields, TrainingKcal, validOwnKcal } from './TrainingFields';

/**
 * The page of a sport, like the food page: `/sport/$typeKey?date` logs one training of it (duration
 * wheel, intensity, kcal, note; "Eintragen"), with `into=training:<id>` it adds the activity to a
 * saved training ("Hinzufügen"), and `/exercise-entry/$entryId` edits a logged training ("Änderungen
 * übernehmen", trash). The header's save icon makes a saved training of one activity.
 */
export function SportPage() {
  const params = useParams({ strict: false }) as { typeKey?: string; entryId?: string };
  const search = useSearch({ strict: false }) as { date?: string; into?: string };
  const db = useDb();
  const entry = useLiveQuery(
    async () => (params.entryId ? ((await db.exerciseEntries.get(params.entryId)) ?? null) : null),
    [db, params.entryId],
  );
  // Own sports read here (not `useTypeOptions`): the page must not say "not found" before they loaded.
  const customTypes = useLiveQuery(() => db.exerciseTypes.filter((t) => !t.deleted).toArray(), [db]);
  const date = entry?.date ?? search.date;
  const history = useTrainingHistory(date ?? '2000-01-01', true);
  if (entry === undefined || customTypes === undefined) return null;
  // Before the date check: an unknown entry has no date and would leave the page blank.
  if (params.entryId && (!entry || entry.deleted))
    return <NotFoundPage title="Training" what="Eintrag nicht gefunden" />;
  if (history === undefined || !date) return null;
  // The day's steps have their own page.
  if (entry && isStepsEntry(entry))
    return <Navigate to="/steps/$date" params={{ date: entry.date }} replace />;
  const typeKey = entry?.typeKey ?? params.typeKey;
  // An entry whose own sport was deleted keeps its name and MET.
  const builtIn = typeKey ? EXERCISE_TYPE_MAP.get(typeKey) : undefined;
  const own = customTypes.find((t) => t.id === typeKey);
  const type: TypeOption | null =
    (builtIn && { key: builtIn.key, name: builtIn.name, met: builtIn.met, custom: false }) ??
    (own && { key: own.id, name: own.name, met: { moderate: own.met }, custom: true }) ??
    (entry ? { key: entry.typeKey, name: entry.name, met: { moderate: entry.met }, custom: true } : null);
  if (!type) return <NotFoundPage title="Sportart" what="Sportart nicht gefunden" />;
  return (
    <SportForm
      key={`${type.key}:${entry?.id ?? 'new'}`}
      type={type}
      entry={entry}
      date={date}
      into={entry ? null : trainingTarget(search.into)}
      history={history}
    />
  );
}

function SportForm({
  type,
  entry,
  date,
  into,
  history,
}: {
  type: TypeOption;
  entry: ExerciseEntry | null;
  date: ISODate;
  into: string | null;
  history: TrainingHistory;
}) {
  const db = useDb();
  const navigate = useNavigate();
  const router = useRouter();
  const returnToDiary = useReturnToDiary();
  const settings = useSettings();
  const names = useTrainingNames();
  const currentWeight = useCurrentWeight(date);
  const last = entry ? null : (history.last.get(type.key) ?? null);
  const stats = entry ? null : history.stats.get(type.key);
  const start = entry ?? last ?? DEFAULT_SPORT_VALUES;
  const [minutes, setMinutes] = useState<number | null>(start.minutes);
  const [intensity, setIntensity] = useState<Intensity>(type.custom ? 'moderate' : start.intensity);
  const [note, setNote] = useState(start.note ?? '');
  const [own, setOwn] = useState<number | null>(entry && !isAutoTrainingKcal(entry) ? entry.kcal : null);
  // A saved training made from this page ("Als Training speichern"): the entry is logged from it.
  const [saved, setSaved] = useState<{ id: string; name: string } | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);

  const weightKg = entry?.weightKg ?? currentWeight ?? DEFAULT_WEIGHT_KG;
  const met = metFor(type, intensity);
  const computed = minutes ? trainingKcal(met, weightKg, minutes) : 0;
  const kcal = own ?? computed;
  const valid = !!minutes && validOwnKcal(own);
  const marks = [
    !entry && currentWeight === undefined && 'Standardgewicht',
    !into && settings?.addExerciseCalories === false && 'nicht angerechnet',
  ].filter((m): m is string => !!m);

  const row = () => {
    const r = toLog(type, { minutes: minutes!, intensity, note, templateId: saved?.id }, weightKg);
    return own === null ? r : { ...r, kcal: Math.round(own) };
  };

  const { busy, run } = useSubmitting();
  async function submit() {
    if (!valid) return;
    if (into) {
      const ok = await addActivityToTraining(db, into, {
        typeKey: type.key,
        typeName: type.name,
        minutes: minutes!,
        intensity,
        note: note.trim() || null,
      });
      if (!ok) return void toast.error('Das Training gibt es nicht mehr.');
      returnFromInto(router.history, () =>
        openTarget(navigate, { kind: 'training', templateId: into }, date, 0),
      );
      return;
    }
    if (entry) {
      const { templateId: _t, ...changes } = row();
      await saveExercise(db, { ...changes, date: entry.date }, entry);
      toast.success(`${trainingTitle(entry, names).title}: ${fmt0(kcal)} kcal`);
      return leave();
    }
    const ids = await logTrainings(db, date, [row()]);
    toast.success(`${saved?.name ?? type.name}: ${fmt0(kcal)} kcal`);
    await returnToDiary({ date, focus: { rows: ids } });
  }

  /** Leaves the page of an entry that was changed or deleted: the page before, never this one again. */
  const leave = () =>
    goBackOr(router.history, 1, () => void navigate({ to: '/', search: { date }, replace: true }));

  async function remove() {
    if (!entry) return;
    const title = trainingTitle(entry, names).title;
    await deleteRecord(db, 'exerciseEntries', entry.id);
    toast(`${title} gelöscht`, {
      action: { label: 'Rückgängig', onClick: () => void restoreRecord(db, 'exerciseEntries', entry.id) },
    });
    leave();
  }

  // A part of a logged saved training stays a part: no saving it on its own.
  const canSave = !into && !entry?.groupId;
  return (
    <Page
      title={type.name}
      back
      withTabBar={false}
      actions={
        <>
          {canSave && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={saved ? `Gespeichert als „${saved.name}“` : 'Als Training speichern'}
              disabled={!minutes || !!saved}
              onClick={() => setSaveOpen(true)}
            >
              {saved ? <BookmarkCheck aria-hidden /> : <BookmarkPlus aria-hidden />}
            </Button>
          )}
          {entry && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Training löschen"
              disabled={busy}
              onClick={() => void run(remove)}
            >
              <Trash2 className="text-destructive" aria-hidden />
            </Button>
          )}
        </>
      }
      footer={
        <Button size="lg" disabled={!valid || busy} onClick={() => void run(submit)}>
          {into ? 'Hinzufügen' : entry ? 'Änderungen übernehmen' : 'Eintragen'}
          {!into && !entry && <span className="tabular font-normal opacity-80"> · {fmt0(kcal)} kcal</span>}
        </Button>
      }
    >
      {!into && <DayNote date={date} />}
      {(last || saved) && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {last && <span>Zuletzt {describeValues(last)}</span>}
          {stats && stats.count > 0 && (
            <Badge
              variant="secondary"
              className="bg-exercise/15 px-1.5 py-0 text-[11px] font-normal text-exercise"
            >
              {fmt0(stats.count)}× eingetragen
            </Badge>
          )}
          {saved && (
            <Badge variant="secondary" className="px-1.5 py-0 text-[11px] font-normal">
              Gespeichert als „{saved.name}“
            </Badge>
          )}
        </div>
      )}
      <Section>
        <div className="grid gap-4 p-4">
          <TrainingFields
            name={type.name}
            intensity={intensity}
            onIntensityChange={setIntensity}
            intensityDisabled={type.custom}
            minutes={minutes}
            onMinutesLive={setMinutes}
            onMinutesChange={setMinutes}
            note={note}
            onNoteChange={setNote}
            kcal={
              !into && (
                <TrainingKcal
                  computed={computed}
                  own={own}
                  onOwnChange={setOwn}
                  met={met}
                  weightKg={weightKg}
                  minutes={minutes}
                  marks={marks}
                />
              )
            }
          />
        </div>
      </Section>
      <NameDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        title="Als Training speichern"
        description={minutes ? describe(type.name, minutes, intensity, null) : type.name}
        confirmLabel="Speichern"
        maxLength={80}
        placeholder="z. B. Feierabendrunde…"
        defaultName={type.name}
        onConfirm={async (name) => {
          if (!minutes) return;
          const id = await saveTraining(db, {
            name,
            items: [
              { typeKey: type.key, typeName: type.name, minutes, intensity, note: note.trim() || null },
            ],
          });
          // The page says it with the chip "Gespeichert als …" (a toast would cover "Eintragen").
          setSaved({ id, name });
        }}
      />
    </Page>
  );
}
