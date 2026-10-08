import { EXERCISE_TYPE_MAP, INTENSITY_LABELS_DE, normalize, uuidv7, type Intensity } from '@ft/shared';
import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
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
import { saveRecord } from '@/db/write';
import { fmt0, fmt1, NO_VALUE } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { TypeOption } from './training';

/** Sport search and list with "Eigene Sportart" (logging a training and the saved training editor). */
export function SportPicker({
  options,
  typeKey,
  onSelect,
  filter,
  onFilterChange,
  onCustomCreated,
}: {
  options: TypeOption[];
  typeKey: string | null;
  onSelect: (key: string) => void;
  filter: string;
  onFilterChange: (filter: string) => void;
  /** A new own sport was created (and should be selected). */
  onCustomCreated: (id: string) => void;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const shown = filter ? options.filter((o) => normalize(o.name).includes(normalize(filter))) : options;
  return (
    <div className="grid gap-3 px-4 pb-4">
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          aria-label="Sportart suchen"
          placeholder="Sportart suchen…"
          autoComplete="off"
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          className="pl-9"
        />
      </div>
      <ul
        className="max-h-72 overflow-y-auto overscroll-contain rounded-xl border"
        role="listbox"
        aria-label="Sportarten"
      >
        {shown.map((o) => (
          <li key={o.key} role="option" aria-selected={typeKey === o.key}>
            <button
              type="button"
              onClick={() => onSelect(o.key)}
              className={cn(
                'flex min-h-11 w-full items-center justify-between px-3 text-left text-sm transition-colors focus-visible:bg-accent focus-visible:outline-none',
                typeKey === o.key ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
              )}
            >
              <span>
                {o.name}
                {o.custom && <span className="ml-1 text-xs opacity-70">(eigene)</span>}
              </span>
              <span className="tabular text-xs opacity-70">MET {fmt1(o.met.moderate)}</span>
            </button>
          </li>
        ))}
      </ul>
      <Button variant="outline" size="sm" onClick={() => setCustomOpen(true)}>
        <Plus aria-hidden /> Eigene Sportart
      </Button>
      <CustomTypeDialog open={customOpen} onOpenChange={setCustomOpen} onCreated={onCustomCreated} />
    </div>
  );
}

/** Intensity, duration with presets and note of a training. */
export function TrainingFields({
  intensity,
  onIntensityChange,
  intensityDisabled,
  minutes,
  onMinutesChange,
  note,
  onNoteChange,
}: {
  intensity: Intensity;
  onIntensityChange: (i: Intensity) => void;
  /** Own sports have a single MET value. */
  intensityDisabled?: boolean;
  minutes: number | null;
  onMinutesChange: (m: number | null) => void;
  note: string;
  onNoteChange: (note: string) => void;
}) {
  return (
    <>
      <div className="grid gap-1.5">
        <span className="text-sm font-medium">Intensität</span>
        <ToggleGroup
          type="single"
          variant="outline"
          value={intensity}
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
      <NumberField label="Dauer" unit="Min." value={minutes} onValueChange={onMinutesChange} integer />
      <div className="flex flex-wrap gap-2">
        {[15, 30, 45, 60, 90].map((m) => (
          <Button
            key={m}
            size="sm"
            variant={minutes === m ? 'default' : 'secondary'}
            onClick={() => onMinutesChange(m)}
          >
            {m} Min.
          </Button>
        ))}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="ex-note">Notiz (optional)</Label>
        <Textarea
          id="ex-note"
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

function CustomTypeDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const db = useDb();
  const [name, setName] = useState('');
  const [met, setMet] = useState<number | null>(6);
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
            disabled={!valid}
            onClick={async () => {
              const id = uuidv7();
              await saveRecord(db, 'exerciseTypes', { id, name: name.trim(), met: met! });
              onCreated(id);
              setName('');
              onOpenChange(false);
            }}
          >
            Anlegen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Calories of a training with the formula behind them. */
export function TrainingKcal({
  label,
  kcal,
  met,
  weightKg,
  minutes,
  note,
}: {
  label: string;
  kcal: number;
  met: number | null;
  weightKg: number;
  minutes: number | null;
  /** Extra remark after the formula (standard weight, not credited, …). */
  note?: string;
}) {
  return (
    <div className="rounded-xl bg-muted p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm">{label}</span>
        <span className="tabular shrink-0 text-2xl font-bold text-exercise">{fmt0(kcal)} kcal</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        (MET {met ? fmt1(met) : NO_VALUE} − 1) × {fmt1(weightKg)} kg ×{' '}
        {minutes ? fmt1(minutes / 60) : NO_VALUE} h{note}
      </p>
    </div>
  );
}
