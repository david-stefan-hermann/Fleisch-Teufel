import { EXERCISE_TYPE_MAP, INTENSITY_LABELS_DE, uuidv7, type Intensity } from '@ft/shared';
import { useId, useState, type ReactNode } from 'react';
import { DurationWheel } from '@/components/DurationWheel';
import { useDb } from '@/app/session';
import { NumberField } from '@/components/NumberField';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Badge } from '@/components/ui/badge';
import { saveRecord } from '@/db/write';
import { useSubmitting } from '@/hooks/useSubmitting';
import { fmt0, fmt1, NO_VALUE } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Duration (wheel), intensity, kcal (`kcal`, a slot: the sport page and logging show a field, the
 * editor of a saved training a total) and note of one activity. An own sport has a single MET
 * value: the intensity is locked on "Mittel".
 */
export function TrainingFields({
  name,
  intensity,
  onIntensityChange,
  intensityDisabled,
  minutes,
  onMinutesChange,
  onMinutesLive,
  note,
  onNoteChange,
  kcal,
}: {
  /** The sport, for the accessible name of the wheel. */
  name?: string;
  intensity: Intensity;
  onIntensityChange: (i: Intensity) => void;
  /** Own sports have a single MET value. */
  intensityDisabled?: boolean;
  minutes: number | null;
  /** The final duration (wheel stopped, typed). */
  onMinutesChange: (m: number | null) => void;
  /** The duration while the wheel turns. */
  onMinutesLive?: (m: number) => void;
  note: string;
  onNoteChange: (note: string) => void;
  kcal?: ReactNode;
}) {
  const noteId = useId();
  return (
    <>
      <DurationWheel name={name} value={minutes} onChange={onMinutesLive} onCommit={onMinutesChange} />
      <div className="grid gap-1.5">
        <span className="text-sm font-medium">Intensität</span>
        <ToggleGroup
          type="single"
          variant="outline"
          value={intensityDisabled ? 'moderate' : intensity}
          onValueChange={(v) => v && onIntensityChange(v as Intensity)}
          className="w-full"
          disabled={intensityDisabled}
        >
          {(['light', 'moderate', 'vigorous'] as const).map((i) => (
            <ToggleGroupItem key={i} value={i} className="flex-1">
              {INTENSITY_LABELS_DE[i]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      {kcal}
      <div className="grid gap-1.5">
        <Label htmlFor={noteId}>Notiz (optional)</Label>
        <Textarea
          id={noteId}
          value={note}
          maxLength={2000}
          onChange={(e) => onNoteChange(e.target.value)}
          placeholder="z. B. Bankdrücken 3 × 8 à 60 kg, Kniebeugen 4 × 10…"
          className="min-h-20"
        />
      </div>
    </>
  );
}

/** "Eigene Sportart": name and MET value; mount it with a `key` per `defaultName` to prefill the name. */
export function CustomTypeDialog({
  open,
  onOpenChange,
  onCreated,
  defaultName = '',
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (id: string) => void;
  defaultName?: string;
}) {
  const db = useDb();
  const [name, setName] = useState(defaultName);
  const [met, setMet] = useState<number | null>(6);
  const { run, busy } = useSubmitting();
  const valid = name.trim().length > 0 && met !== null && met >= 1 && met <= 25;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Eigene Sportart</DialogTitle>
          <DialogDescription>
            MET = Vielfaches des Ruheumsatzes. Orientierung: Gehen 3,5 · Radfahren 7 · Joggen 10. Werte
            findest du im Compendium of Physical Activities ({EXERCISE_TYPE_MAP.size} Arten sind schon
            enthalten).
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="grid gap-1.5">
            <Label htmlFor="ct-name">Name</Label>
            <Input
              id="ct-name"
              autoComplete="off"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z. B. Stand-up-Paddling…"
            />
          </div>
          <NumberField
            label="MET-Wert"
            value={met}
            onValueChange={setMet}
            error={met !== null && (met < 1 || met > 25) ? 'Zwischen 1 und 25.' : null}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button
            disabled={!valid || busy}
            onClick={() =>
              void run(async () => {
                const id = uuidv7();
                await saveRecord(db, 'exerciseTypes', { id, name: name.trim(), met: met! });
                onCreated(id);
                setName('');
                onOpenChange(false);
              })
            }
          >
            Anlegen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Highest kcal of one training (the schema's limit). */
export const MAX_TRAINING_KCAL = 20_000;

/** Whether typed kcal can be logged: none typed (computed), or a whole number in the range. */
export const validOwnKcal = (own: number | null) =>
  own === null || (Number.isFinite(own) && own >= 0 && own <= MAX_TRAINING_KCAL);

/**
 * The kcal of a training: a field that shows the computed value (with the formula below) until a
 * number is typed (a watch's value). A typed value stays when the duration changes; the field is
 * marked then and the link "Berechneten Wert verwenden (N kcal)" takes the computed one again. `own`
 * is NaN while the field is empty. Without `onOwnChange` (the editor of a saved training) the value is
 * only shown. `marks` are short states next to the label ("Standardgewicht", "nicht angerechnet").
 */
export function TrainingKcal({
  label = 'Verbrauch',
  computed,
  own = null,
  onOwnChange,
  met,
  weightKg,
  minutes,
  marks = [],
  tone = 'exercise',
}: {
  label?: string;
  computed: number;
  own?: number | null;
  onOwnChange?: (own: number | null) => void;
  met: number | null;
  weightKg: number;
  minutes: number | null;
  marks?: string[];
  /** Blue for trainings, green for the steps from Apple Health. */
  tone?: 'exercise' | 'steps';
}) {
  const id = useId();
  const typed = own !== null;
  const color = tone === 'steps' ? 'text-steps' : 'text-exercise';
  return (
    <div className="grid gap-2 rounded-xl border border-border/70 bg-card p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <Label htmlFor={onOwnChange ? id : undefined} className="text-sm font-normal">
            {label}
          </Label>
          {marks.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {marks.map((m) => (
                <Badge key={m} variant="secondary" className="px-1.5 py-0 text-[11px] font-normal">
                  {m}
                </Badge>
              ))}
            </div>
          )}
        </div>
        {onOwnChange ? (
          <NumberField
            id={id}
            className="w-36 shrink-0"
            inputClassName={cn(
              'text-lg font-bold',
              color,
              typed &&
                (tone === 'steps'
                  ? 'border-steps ring-[3px] ring-steps/25'
                  : 'border-exercise ring-[3px] ring-exercise/25'),
            )}
            value={typed ? own : computed}
            unit="kcal"
            integer
            onValueChange={(v) => {
              if (v === null) return onOwnChange(Number.NaN);
              onOwnChange(Math.round(v) === computed && !typed ? null : Math.round(v));
            }}
            error={validOwnKcal(own) ? null : `0 bis ${fmt0(MAX_TRAINING_KCAL)} kcal.`}
          />
        ) : (
          <span className={cn('tabular shrink-0 text-2xl font-bold', color)}>{fmt0(computed)} kcal</span>
        )}
      </div>
      {typed ? (
        <button
          type="button"
          className="justify-self-start text-left text-xs text-primary underline underline-offset-2"
          onClick={() => onOwnChange?.(null)}
        >
          Berechneten Wert verwenden ({fmt0(computed)} kcal)
        </button>
      ) : (
        <p className="text-xs text-muted-foreground">
          (MET {met ? fmt1(met) : NO_VALUE} − 1) × {fmt1(weightKg)} kg ×{' '}
          {minutes ? fmt1(minutes / 60) : NO_VALUE} h
        </p>
      )}
    </div>
  );
}
