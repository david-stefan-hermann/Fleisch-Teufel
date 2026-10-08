import {
  DEFAULT_WEIGHT_KG,
  metFor,
  netExerciseKcal,
  recentTrainings,
  round,
  type ExerciseEntry,
  type Intensity,
} from '@ft/shared';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, Save, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { NameDialog } from '@/components/NameDialog';
import { Page, Section } from '@/components/Page';
import { SwipeToDelete } from '@/components/SwipeToDelete';
import { Button } from '@/components/ui/button';
import { saveExercise, saveExerciseTemplate } from '@/db/entries';
import { deleteRecord, restoreRecord } from '@/db/write';
import { useCurrentWeight, useSettings } from '@/hooks/data';
import { fmt0, fmtDayLong } from '@/lib/format';
import { cn } from '@/lib/utils';
import { describe, sameSetup, useTypeOptions } from './training';
import { SportPicker, TrainingFields, TrainingKcal } from './TrainingFields';

/** Simple training log (feature #9): type, duration, intensity → MET-based kcal. */
export function ExercisePage() {
  const { date, entryId } = useSearch({ from: '/authed/exercise' });
  const db = useDb();
  const entry = useLiveQuery(
    async () => (entryId ? ((await db.exerciseEntries.get(entryId)) ?? null) : null),
    [db, entryId],
  );
  if (entry === undefined) return null;
  return <ExerciseForm key={entry?.id ?? 'new'} date={date} entry={entry} />;
}

function ExerciseForm({ date, entry }: { date: string; entry: ExerciseEntry | null }) {
  const db = useDb();
  const navigate = useNavigate();
  const settings = useSettings();
  const weight = useCurrentWeight(date);
  const templates = useLiveQuery(() => db.exerciseTemplates.filter((t) => !t.deleted).sortBy('name'), [db]);
  const recent = useLiveQuery(
    async () =>
      recentTrainings(
        await db.exerciseEntries
          .orderBy('date')
          .reverse()
          .filter((e) => !e.deleted)
          .limit(100)
          .toArray(),
      ),
    [db],
  );

  const options = useTypeOptions();
  const [typeKey, setTypeKey] = useState<string | null>(entry?.typeKey ?? null);
  const [intensity, setIntensity] = useState<Intensity>(entry?.intensity ?? 'moderate');
  const [minutes, setMinutes] = useState<number | null>(entry?.minutes ?? 30);
  const [note, setNote] = useState(entry?.note ?? '');
  const [filter, setFilter] = useState('');
  const [saveOpen, setSaveOpen] = useState(false);

  const type = options.find((o) => o.key === typeKey) ?? null;
  const usedWeight = entry?.weightKg ?? weight ?? DEFAULT_WEIGHT_KG;
  const met = type ? metFor(type, intensity) : null;
  const kcal = met && minutes ? round(netExerciseKcal(met, usedWeight, minutes), 0) : 0;
  const setup = { typeKey, minutes, intensity, note: note.trim() || null };

  /** Fills the form from a saved or an earlier training. */
  function apply(t: { typeKey: string; minutes: number; intensity: Intensity; note: string | null }) {
    if (!options.some((o) => o.key === t.typeKey)) {
      toast.error('Diese Sportart gibt es nicht mehr.');
      return;
    }
    setTypeKey(t.typeKey);
    setIntensity(t.intensity);
    setMinutes(t.minutes);
    setNote(t.note ?? '');
    setFilter('');
  }

  async function save() {
    if (!type || !met || !minutes) return;
    const data = {
      date,
      typeKey: type.key,
      name: type.name,
      minutes,
      intensity,
      met,
      weightKg: usedWeight,
      kcal,
      note: setup.note,
    };
    await saveExercise(db, data, entry ?? null);
    toast.success(`${type.name}: ${fmt0(kcal)} kcal`);
    await navigate({ to: '/', search: { date } });
  }

  return (
    <Page
      title={entry ? 'Training bearbeiten' : 'Training eintragen'}
      back
      withTabBar={false}
      footer={
        <Button size="lg" disabled={!type || !minutes} onClick={() => void save()}>
          {entry ? 'Änderungen übernehmen' : 'Training eintragen'}
        </Button>
      }
      actions={
        <>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Als Training speichern"
            disabled={!type || !minutes}
            onClick={() => setSaveOpen(true)}
          >
            <Save aria-hidden />
          </Button>
          {entry && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Training löschen"
              onClick={async () => {
                await deleteRecord(db, 'exerciseEntries', entry.id);
                toast(`${entry.name} gelöscht`, {
                  action: {
                    label: 'Rückgängig',
                    onClick: () => void restoreRecord(db, 'exerciseEntries', entry.id),
                  },
                });
                await navigate({ to: '/', search: { date } });
              }}
            >
              <Trash2 className="text-destructive" aria-hidden />
            </Button>
          )}
        </>
      }
    >
      <p className="mb-3 text-sm text-muted-foreground">{fmtDayLong(date)}</p>
      {!entry && ((templates?.length ?? 0) > 0 || (recent?.length ?? 0) > 0) && (
        <Section title="Schnellauswahl">
          <div className="grid gap-3 pb-3">
            {templates && templates.length > 0 && (
              <QuickList
                title="Gespeichert"
                action={
                  <Link
                    to="/trainings"
                    className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                  >
                    Verwalten
                  </Link>
                }
              >
                {templates.map((t) => (
                  <li key={t.id}>
                    <SwipeToDelete
                      label={`${t.name} löschen`}
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
                      <QuickItem
                        title={t.name}
                        subtitle={describe(t.typeName, t.minutes, t.intensity, t.note)}
                        selected={sameSetup(setup, t)}
                        onSelect={() => apply(t)}
                      />
                    </SwipeToDelete>
                  </li>
                ))}
              </QuickList>
            )}
            {recent && recent.length > 0 && (
              <QuickList title="Zuletzt">
                {recent.map((r) => (
                  <li key={r.id}>
                    <QuickItem
                      title={r.name}
                      subtitle={describe(null, r.minutes, r.intensity, r.note, r.date)}
                      selected={sameSetup(setup, r)}
                      onSelect={() => apply(r)}
                    />
                  </li>
                ))}
              </QuickList>
            )}
          </div>
        </Section>
      )}
      <Section title="Sportart">
        <SportPicker
          options={options}
          typeKey={typeKey}
          onSelect={setTypeKey}
          filter={filter}
          onFilterChange={setFilter}
          onCustomCreated={(id) => {
            setTypeKey(id);
            setIntensity('moderate');
          }}
        />
      </Section>

      <Section>
        <div className="grid gap-4 p-4">
          <TrainingFields
            intensity={intensity}
            onIntensityChange={setIntensity}
            intensityDisabled={type?.custom}
            minutes={minutes}
            onMinutesChange={setMinutes}
            note={note}
            onNoteChange={setNote}
          />
          <TrainingKcal
            label="Verbrauch (zusätzlich zum Grundumsatz)"
            kcal={kcal}
            met={met}
            weightKg={usedWeight}
            minutes={minutes}
            note={
              [
                weight === undefined && !entry
                  ? ' · Standardgewicht. Trage dein Gewicht ein für genauere Werte.'
                  : '',
                settings?.addExerciseCalories === false
                  ? ' · Wird laut Einstellung nicht aufs Tagesziel angerechnet.'
                  : '',
              ].join('') || undefined
            }
          />
          <p className="text-xs text-muted-foreground">
            MET-Werte: Compendium of Physical Activities (Ainsworth 2011/Herrmann 2024), gerundet.{' '}
            <Link to="/about" className="underline">
              Quellen
            </Link>
          </p>
        </div>
      </Section>
      <NameDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        title="Als Training speichern"
        description="Sportart, Dauer, Intensität und Notiz stehen danach in der Schnellauswahl und unter Mehr → Gespeicherte Trainings."
        confirmLabel="Training speichern"
        maxLength={80}
        placeholder="z. B. Oberkörper-Tag…"
        defaultName={
          type ? (setup.note ? `${type.name}: ${setup.note.split('\n')[0]!.slice(0, 40)}` : type.name) : ''
        }
        onConfirm={async (name) => {
          if (!type || !minutes) return;
          await saveExerciseTemplate(db, {
            typeKey: type.key,
            typeName: type.name,
            minutes,
            intensity,
            note: setup.note,
            name,
          });
          toast.success(`„${name}“ gespeichert`);
        }}
      />
    </Page>
  );
}

function QuickList({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 px-4 pb-1">
        <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
        {action}
      </div>
      <ul className="divide-y divide-border/70 border-y border-border/70">{children}</ul>
    </div>
  );
}

function QuickItem({
  title,
  subtitle,
  selected,
  onSelect,
}: {
  title: string;
  subtitle: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left transition-colors select-none focus-visible:bg-accent focus-visible:outline-none',
        selected ? 'bg-primary/10' : 'hover:bg-accent/60',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
      </div>
      {selected && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
    </button>
  );
}
