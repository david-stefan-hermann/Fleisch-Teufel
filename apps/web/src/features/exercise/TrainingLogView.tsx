import {
  DEFAULT_WEIGHT_KG,
  formatDuration,
  metFor,
  trainingItemsOf,
  trainingKcal,
  type ExerciseTemplate,
  type Intensity,
  type ISODate,
  type TrainingItem,
} from '@ft/shared';
import { Link } from '@tanstack/react-router';
import { BookmarkPlus, Pencil } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { DayNote } from '@/components/DayNote';
import { Page, Section } from '@/components/Page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { logTrainings, saveTraining, updateTraining, type TrainingToLog } from '@/db/entries';
import { trainingKey } from '@/db/trainingSuggestions';
import { useCurrentWeight, useSettings, useToday, useTrainingHistory } from '@/hooks/data';
import { useSubmitting } from '@/hooks/useSubmitting';
import { fmt0 } from '@/lib/format';
import { useReturnToDiary } from '@/lib/logFlow';
import { SaveTrainingDialog } from './SaveTrainingDialog';
import {
  describe,
  lastLoggedLabel,
  missingSportsText,
  toLog,
  useLoadedTypeOptions,
  type TypeOption,
} from './training';
import { TrainingFields, TrainingKcal, validOwnKcal } from './TrainingFields';
import { TrainingRow } from './TrainingRow';

/** One activity as this page holds it: the saved values, changed only for this entry. */
interface Row {
  index: number;
  saved: TrainingItem;
  type: TypeOption;
  minutes: number | null;
  intensity: Intensity;
  note: string;
  /** Typed kcal (a watch's value); null = computed. */
  own: number | null;
}

const changed = (r: Row) =>
  r.minutes !== r.saved.minutes ||
  r.intensity !== r.saved.intensity ||
  r.note.trim() !== (r.saved.note ?? '').trim() ||
  r.own !== null;

/**
 * "Training eintragen" of a saved training (`/trainings/$templateId?date`), like "Meal eintragen":
 * the activities with the saved values, one open to change it for this entry only ("geändert" at the
 * row), swipe left leaves one out today. "Eintragen" logs all as one group. The save icon is active
 * once something differs and offers updating the saved training or saving a new one; the pencil
 * opens the editor.
 */
export function TrainingLogView({ template, date }: { template: ExerciseTemplate; date: ISODate }) {
  const options = useLoadedTypeOptions();
  if (!options) return null;
  return <TrainingLogForm template={template} date={date} options={options} />;
}

function TrainingLogForm({
  template,
  date,
  options,
}: {
  template: ExerciseTemplate;
  date: ISODate;
  options: readonly TypeOption[];
}) {
  const db = useDb();
  const returnToDiary = useReturnToDiary();
  const today = useToday();
  const settings = useSettings();
  const currentWeight = useCurrentWeight(date);
  const weightKg = currentWeight ?? DEFAULT_WEIGHT_KG;
  const history = useTrainingHistory(date, true);
  const stats = history?.stats.get(trainingKey(template.id, template.typeKey));
  const items = trainingItemsOf(template);
  const missingText = missingSportsText(
    items.filter((i) => !options.some((o) => o.key === i.typeKey)).map((i) => i.typeName),
  );
  const [rows, setRows] = useState<Row[]>(() =>
    items.flatMap((saved, index): Row[] => {
      const type = options.find((o) => o.key === saved.typeKey);
      return type
        ? [
            {
              index,
              saved,
              type,
              minutes: saved.minutes,
              intensity: type.custom ? 'moderate' : saved.intensity,
              note: saved.note ?? '',
              own: null,
            },
          ]
        : [];
    }),
  );
  // An activity whose sport was deleted is left out; said once when the page opens.
  useEffect(() => {
    if (missingText) toast.error(missingText, { id: 'missing-sports' });
  }, [missingText]);
  const [open, setOpen] = useState<number | null>(0);
  const [saveOpen, setSaveOpen] = useState(false);
  const { busy, run } = useSubmitting();

  const kept = rows;
  const update = (index: number, patch: Partial<Row>) =>
    setRows(kept.map((r) => (r.index === index ? { ...r, ...patch } : r)));
  const computedOf = (r: Row) =>
    r.minutes ? trainingKcal(metFor(r.type, r.intensity), weightKg, r.minutes) : 0;
  const kcalOf = (r: Row) => r.own ?? computedOf(r);
  const total = kept.reduce((s, r) => s + kcalOf(r), 0);
  const totalMinutes = kept.reduce((s, r) => s + (r.minutes ?? 0), 0);
  const valid = kept.length > 0 && kept.every((r) => r.minutes && validOwnKcal(r.own));
  // The structure (left out) or values differ from the saved training.
  const differs = kept.length !== items.length || kept.some(changed);
  const asItems = (): TrainingItem[] =>
    kept.map((r) => ({
      typeKey: r.type.key,
      typeName: r.type.name,
      minutes: r.minutes!,
      intensity: r.intensity,
      note: r.note.trim() || null,
    }));

  function exclude(index: number) {
    if (kept.length <= 1) return;
    const row = kept.find((r) => r.index === index)!;
    setRows(kept.filter((r) => r.index !== index));
    if (open === index) setOpen(null);
    toast(`${row.type.name} entfernt`, {
      action: {
        label: 'Rückgängig',
        onClick: () => setRows((rs) => [...rs, row].sort((a, b) => a.index - b.index)),
      },
    });
  }

  async function log() {
    if (!valid) return;
    const toLogRows: TrainingToLog[] = kept.map((r) => {
      const row = toLog(r.type, { ...r, minutes: r.minutes!, templateId: template.id }, weightKg);
      return { ...row, group: template.id, ...(r.own !== null && { kcal: Math.round(r.own) }) };
    });
    const ids = await logTrainings(db, date, toLogRows);
    toast.success(`„${template.name}“: ${fmt0(total)} kcal`);
    await returnToDiary({ date, focus: { rows: ids } });
  }

  const marks = [
    currentWeight === undefined && 'Standardgewicht',
    settings?.addExerciseCalories === false && 'nicht angerechnet',
  ].filter((m): m is string => !!m);

  return (
    <Page
      title={template.name}
      back
      withTabBar={false}
      actions={
        <>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Als Training speichern"
            disabled={!differs || !valid}
            onClick={() => setSaveOpen(true)}
          >
            <BookmarkPlus aria-hidden />
          </Button>
          <Button variant="ghost" size="icon" asChild>
            <Link
              to="/trainings/$templateId"
              params={{ templateId: template.id }}
              search={{ from: 'log' }}
              aria-label="Training bearbeiten"
            >
              <Pencil aria-hidden />
            </Link>
          </Button>
        </>
      }
      footer={
        <Button size="lg" disabled={!valid || busy} onClick={() => void run(log)}>
          Eintragen
          <span className="tabular font-normal opacity-90"> · {fmt0(total)} kcal</span>
        </Button>
      }
    >
      <DayNote date={date} />
      {stats && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{lastLoggedLabel(stats.lastDate, today)}</span>
          <Badge
            variant="secondary"
            className="bg-exercise/15 px-1.5 py-0 text-[11px] font-normal text-exercise-text"
          >
            {fmt0(stats.count)}× eingetragen
          </Badge>
        </div>
      )}
      <Section
        title={
          <span className="flex items-baseline gap-2">
            Aktivitäten
            <span className="tabular text-sm font-normal text-muted-foreground">
              {formatDuration(totalMinutes)}
            </span>
          </span>
        }
      >
        <ul className="divide-y divide-border/70">
          {kept.map((r) => (
            <li key={r.index}>
              <TrainingRow
                title={r.type.name}
                detail={describe(null, r.minutes ?? 0, r.intensity, r.note.trim() || null)}
                kcal={kcalOf(r)}
                changed={changed(r)}
                open={open === r.index}
                onToggle={() => setOpen(open === r.index ? null : r.index)}
                onSwipe={
                  kept.length > 1
                    ? { label: `${r.type.name} heute weglassen`, onDelete: () => exclude(r.index) }
                    : undefined
                }
              >
                <TrainingFields
                  name={r.type.name}
                  intensity={r.intensity}
                  onIntensityChange={(intensity) => update(r.index, { intensity })}
                  intensityDisabled={r.type.custom}
                  minutes={r.minutes}
                  onMinutesLive={(minutes) => update(r.index, { minutes })}
                  onMinutesChange={(minutes) => update(r.index, { minutes })}
                  note={r.note}
                  onNoteChange={(note) => update(r.index, { note })}
                  kcal={
                    <TrainingKcal
                      computed={computedOf(r)}
                      own={r.own}
                      onOwnChange={(own) => update(r.index, { own })}
                      met={metFor(r.type, r.intensity)}
                      weightKg={weightKg}
                      minutes={r.minutes}
                      marks={marks}
                    />
                  }
                />
              </TrainingRow>
            </li>
          ))}
        </ul>
      </Section>
      <SaveTrainingDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        existing={{ name: template.name }}
        defaultName={template.name}
        onConfirm={async (name, mode) => {
          if (mode === 'update') {
            // The page is mounted with the template's `updatedAt` as key: it starts again from the new values.
            if (!(await updateTraining(db, template.id, { items: asItems() })))
              throw new Error('Das Training gibt es nicht mehr.');
            toast.success(`„${template.name}“ aktualisiert`);
          } else {
            await saveTraining(db, { name, items: asItems() });
            toast.success(`„${name}“ gespeichert`);
          }
        }}
      />
    </Page>
  );
}
