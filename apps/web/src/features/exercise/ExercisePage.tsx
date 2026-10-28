import {
  DEFAULT_WEIGHT_KG,
  metFor,
  netExerciseKcal,
  round,
  uuidv7,
  type ExerciseEntry,
  type ExerciseTemplate,
  type Intensity,
} from '@ft/shared';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronDown, Dumbbell, Save, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { NameDialog } from '@/components/NameDialog';
import { Page, Section } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { logTrainings, saveExercise, saveExerciseTemplate, type TrainingToLog } from '@/db/entries';
import { deleteRecord, restoreRecord } from '@/db/write';
import { useCurrentWeight, useSettings, useTrainingHistory } from '@/hooks/data';
import { useSubmitting } from '@/hooks/useSubmitting';
import { fmt0, fmtDayLong } from '@/lib/format';
import { cn } from '@/lib/utils';
import { describe, useTypeOptions, type TypeOption } from './training';
import { ChipRow, TrainingChip } from './TrainingChips';
import { SportPicker, TrainingFields, TrainingKcal } from './TrainingFields';

/**
 * Training log (feature #9): one or several trainings of a day at once (strength training and
 * stretching from the same visit), MET-based kcal. The page collects the chosen trainings under
 * "Ausgewählt" (each with its own duration, intensity and note; the last one added is open),
 * offers the sports this person logs and the saved trainings as badges ("Zuletzt & häufig", a tap
 * selects or deselects), and the full sport list below. Editing an entry is a single open card.
 */
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

/** One training to log, as the page holds it. */
interface Row {
  key: string;
  typeKey: string;
  minutes: number | null;
  intensity: Intensity;
  note: string;
  /** The saved training it was taken from (its badge shows as selected). */
  templateId: string | null;
}

function ExerciseForm({ date, entry }: { date: string; entry: ExerciseEntry | null }) {
  const db = useDb();
  const navigate = useNavigate();
  const settings = useSettings();
  const weight = useCurrentWeight(date);
  const templates = useLiveQuery(() => db.exerciseTemplates.filter((t) => !t.deleted).sortBy('name'), [db]);
  // Also the sports already logged today: a second run of the day is a tap away.
  const history = useTrainingHistory(date, true);
  const options = useTypeOptions();

  const [rows, setRows] = useState<Row[]>(() =>
    entry
      ? [
          {
            key: entry.id,
            typeKey: entry.typeKey,
            minutes: entry.minutes,
            intensity: entry.intensity,
            note: entry.note ?? '',
            templateId: null,
          },
        ]
      : [],
  );
  const [openKey, setOpenKey] = useState<string | null>(entry?.id ?? null);
  const [filter, setFilter] = useState('');
  const [saveKey, setSaveKey] = useState<string | null>(null);

  const usedWeight = entry?.weightKg ?? weight ?? DEFAULT_WEIGHT_KG;
  const typeOf = (typeKey: string): TypeOption | null => options.find((o) => o.key === typeKey) ?? null;
  const metOf = (row: Row) => {
    const type = typeOf(row.typeKey);
    return type ? metFor(type, row.intensity) : null;
  };
  const kcalOf = (row: Row) => {
    const met = metOf(row);
    return met && row.minutes ? round(netExerciseKcal(met, usedWeight, row.minutes), 0) : 0;
  };
  const total = rows.reduce((sum, r) => sum + kcalOf(r), 0);
  const valid = rows.length > 0 && rows.every((r) => typeOf(r.typeKey) && r.minutes);
  const rowOfType = (typeKey: string) => rows.find((r) => r.typeKey === typeKey);

  const update = (key: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: string) => {
    setRows((rs) => rs.filter((r) => r.key !== key));
    if (openKey === key) setOpenKey(null);
  };
  const add = (values: Omit<Row, 'key'>) => {
    const key = uuidv7();
    setRows((rs) => [...rs, { key, ...values }]);
    setOpenKey(key);
  };

  /** Sport list and suggestions: adds the sport with its last values, or takes it out again. */
  function toggleSport(typeKey: string) {
    const type = typeOf(typeKey);
    if (!type) return;
    if (entry) {
      update(entry.id, { typeKey, ...(type.custom ? { intensity: 'moderate' as const } : {}) });
      return;
    }
    const have = rowOfType(typeKey);
    if (have) return remove(have.key);
    const last = history?.last.get(typeKey);
    add({
      typeKey,
      minutes: last?.minutes ?? 30,
      intensity: type.custom ? 'moderate' : (last?.intensity ?? 'moderate'),
      note: last?.note ?? '',
      templateId: null,
    });
  }
  /** Saved training: selects it with its values (replacing a row of the same sport), or deselects it. */
  function toggleTemplate(t: ExerciseTemplate) {
    const have = rowOfType(t.typeKey);
    if (have?.templateId === t.id) return remove(have.key);
    if (!typeOf(t.typeKey)) return toast.error('Diese Sportart gibt es nicht mehr.');
    const values = { minutes: t.minutes, intensity: t.intensity, note: t.note ?? '', templateId: t.id };
    if (have) {
      update(have.key, values);
      setOpenKey(have.key);
      return;
    }
    add({ typeKey: t.typeKey, ...values });
  }

  const { busy: saving, run } = useSubmitting();
  async function save() {
    if (!valid) return;
    const toLog: TrainingToLog[] = rows.map((r) => {
      const type = typeOf(r.typeKey)!;
      return {
        typeKey: type.key,
        name: type.name,
        minutes: r.minutes!,
        intensity: r.intensity,
        met: metOf(r)!,
        weightKg: usedWeight,
        kcal: kcalOf(r),
        note: r.note.trim() || null,
      };
    });
    if (entry) {
      await saveExercise(db, { ...toLog[0]!, date }, entry);
      toast.success(`${toLog[0]!.name}: ${fmt0(toLog[0]!.kcal)} kcal`);
    } else {
      await logTrainings(db, date, toLog);
      toast.success(
        toLog.length === 1
          ? `${toLog[0]!.name}: ${fmt0(toLog[0]!.kcal)} kcal`
          : `${fmt0(toLog.length)} Trainings: ${fmt0(total)} kcal`,
      );
    }
    await navigate({ to: '/', search: { date } });
  }

  const saveRow = saveKey ? rows.find((r) => r.key === saveKey) : undefined;
  const saveType = saveRow ? typeOf(saveRow.typeKey) : null;
  const suggestions = (history?.suggestions ?? []).filter((s) => typeOf(s.typeKey));
  const shownTemplates = (templates ?? []).slice(0, 6);
  const weightNote =
    [
      weight === undefined && !entry ? ' · Standardgewicht. Trage dein Gewicht ein für genauere Werte.' : '',
      settings?.addExerciseCalories === false
        ? ' · Wird laut Einstellung nicht aufs Tagesziel angerechnet.'
        : '',
    ].join('') || undefined;

  return (
    <Page
      title={entry ? 'Training bearbeiten' : 'Training eintragen'}
      back
      withTabBar={false}
      footer={
        <Button size="lg" disabled={!valid || saving} onClick={() => void run(save)}>
          {entry
            ? 'Änderungen übernehmen'
            : rows.length > 1
              ? `${fmt0(rows.length)} Trainings eintragen`
              : 'Training eintragen'}
          {total > 0 && <span className="tabular font-normal opacity-80"> · {fmt0(total)} kcal</span>}
        </Button>
      }
      actions={
        entry ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Training löschen"
            onClick={async () => {
              await deleteEntry(db, entry);
              await navigate({ to: '/', search: { date } });
            }}
          >
            <Trash2 className="text-destructive" aria-hidden />
          </Button>
        ) : undefined
      }
    >
      <p className="mb-3 text-sm text-muted-foreground">{fmtDayLong(date)}</p>

      <Section title={entry ? undefined : 'Ausgewählt'}>
        {rows.length === 0 ? (
          <p className="mx-4 mb-4 flex h-11 items-center justify-center gap-2 rounded-xl border border-dashed text-sm text-muted-foreground">
            <Dumbbell className="size-4" aria-hidden /> Wähle unten eine Sportart oder einen Vorschlag.
          </p>
        ) : (
          <ul className="divide-y divide-border/70">
            {rows.map((r) => {
              const type = typeOf(r.typeKey);
              const open = openKey === r.key || !!entry;
              const name = type?.name ?? 'Sportart';
              return (
                <li key={r.key}>
                  <div className="flex items-center">
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setOpenKey(open && !entry ? null : r.key)}
                      className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-4 py-2 text-left focus-visible:bg-accent focus-visible:outline-none"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {r.minutes
                            ? describe(null, r.minutes, r.intensity, r.note.trim() || null)
                            : 'Dauer fehlt'}
                        </div>
                      </div>
                      <span className="tabular font-semibold text-exercise">+{fmt0(kcalOf(r))}</span>
                      {!entry && (
                        <ChevronDown
                          className={cn(
                            'size-4 text-muted-foreground transition-transform',
                            open && 'rotate-180',
                          )}
                          aria-hidden
                        />
                      )}
                    </button>
                    {!entry && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="mr-2"
                        aria-label={`${name} entfernen`}
                        onClick={() => remove(r.key)}
                      >
                        <X aria-hidden />
                      </Button>
                    )}
                  </div>
                  {open && (
                    <div className="grid gap-4 px-4 pt-1 pb-4">
                      <TrainingFields
                        intensity={r.intensity}
                        onIntensityChange={(intensity) => update(r.key, { intensity })}
                        intensityDisabled={type?.custom}
                        minutes={r.minutes}
                        onMinutesChange={(minutes) => update(r.key, { minutes })}
                        note={r.note}
                        onNoteChange={(note) => update(r.key, { note })}
                      />
                      <TrainingKcal
                        label="Verbrauch (zusätzlich zum Grundumsatz)"
                        kcal={kcalOf(r)}
                        met={metOf(r)}
                        weightKg={usedWeight}
                        minutes={r.minutes}
                        note={weightNote}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        className="justify-self-start"
                        disabled={!type || !r.minutes}
                        onClick={() => setSaveKey(r.key)}
                      >
                        <Save aria-hidden /> Als Training speichern
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {!entry && (suggestions.length > 0 || shownTemplates.length > 0) && (
        <Section>
          <div className="px-4 py-3">
            <ChipRow
              caption="Zuletzt & häufig"
              label="Zuletzt und häufig eingetragene und gespeicherte Trainings"
            >
              {suggestions.map((s) => {
                const detail = describe(null, s.minutes, s.intensity, null);
                return (
                  <li key={`s:${s.typeKey}`} className="shrink-0">
                    <TrainingChip
                      title={s.name}
                      detail={detail}
                      pressed={!!rowOfType(s.typeKey)}
                      ariaLabel={`${s.name}, ${detail}`}
                      onClick={() => toggleSport(s.typeKey)}
                    />
                  </li>
                );
              })}
              {shownTemplates.map((t) => {
                const detail = describe(t.typeName, t.minutes, t.intensity, null);
                return (
                  <li key={`t:${t.id}`} className="shrink-0">
                    <TrainingChip
                      title={t.name}
                      detail={detail}
                      saved
                      pressed={rowOfType(t.typeKey)?.templateId === t.id}
                      ariaLabel={`${t.name}, ${detail}`}
                      onClick={() => toggleTemplate(t)}
                    />
                  </li>
                );
              })}
            </ChipRow>
            {(templates?.length ?? 0) > shownTemplates.length && (
              <Link to="/trainings" className="mt-2 inline-block text-xs text-primary underline">
                Alle gespeicherten Trainings
              </Link>
            )}
          </div>
        </Section>
      )}

      <Section title="Sportart">
        <SportPicker
          options={options}
          typeKey={entry ? (rows[0]?.typeKey ?? null) : null}
          selectedKeys={entry ? undefined : new Set(rows.map((r) => r.typeKey))}
          onSelect={toggleSport}
          filter={filter}
          onFilterChange={setFilter}
          onCustomCreated={(id) => toggleSport(id)}
          templates={
            entry
              ? undefined
              : (templates ?? []).map((t) => ({
                  id: t.id,
                  name: t.name,
                  typeName: t.typeName,
                  selected: rowOfType(t.typeKey)?.templateId === t.id,
                }))
          }
          onTemplate={(id) => {
            const t = templates?.find((x) => x.id === id);
            if (t) toggleTemplate(t);
          }}
        />
      </Section>
      <p className="mb-4 text-xs text-muted-foreground">
        MET-Werte: Compendium of Physical Activities (Ainsworth 2011/Herrmann 2024), gerundet.{' '}
        <Link to="/about" className="underline">
          Quellen
        </Link>
      </p>

      <NameDialog
        open={!!saveRow}
        onOpenChange={(o) => !o && setSaveKey(null)}
        title="Als Training speichern"
        description="Sportart, Dauer, Intensität und Notiz stehen danach unter „Zuletzt & häufig“ und unter Mehr → Gespeicherte Trainings."
        confirmLabel="Training speichern"
        maxLength={80}
        placeholder="z. B. Oberkörper-Tag…"
        defaultName={
          saveType
            ? saveRow?.note.trim()
              ? `${saveType.name}: ${saveRow.note.trim().split('\n')[0]!.slice(0, 40)}`
              : saveType.name
            : ''
        }
        onConfirm={async (name) => {
          if (!saveRow || !saveType || !saveRow.minutes) return;
          const id = await saveExerciseTemplate(db, {
            typeKey: saveType.key,
            typeName: saveType.name,
            minutes: saveRow.minutes,
            intensity: saveRow.intensity,
            note: saveRow.note.trim() || null,
            name,
          });
          update(saveRow.key, { templateId: id });
          toast.success(`„${name}“ gespeichert`);
        }}
      />
    </Page>
  );
}

async function deleteEntry(db: ReturnType<typeof useDb>, entry: ExerciseEntry) {
  await deleteRecord(db, 'exerciseEntries', entry.id);
  toast(`${entry.name} gelöscht`, {
    action: { label: 'Rückgängig', onClick: () => void restoreRecord(db, 'exerciseEntries', entry.id) },
  });
}
