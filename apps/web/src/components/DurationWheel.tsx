import { durationWheelValues, formatDuration, MAX_MINUTES } from '@ft/shared';
import { useId, useState } from 'react';
import { NumberField } from '@/components/NumberField';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Wheel } from '@/components/Wheel';
import { nearestIndex } from '@/lib/amounts';
import { fmt0 } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * The duration of a training: one picker wheel (every 5 minutes up to 2 hours, then every 15 up to
 * 6 hours, "1 Std. 15 Min." from an hour on). "Genau eingeben" next to the label opens a minute
 * field below the wheel (the button shows that it is on; a second tap closes the field, the value
 * stays). A duration off the raster (typed 47, a stored entry of 47 minutes) gets its own row on the
 * wheel and keeps it while the wheel turns, like the amount wheel of `AmountEditor`.
 *
 * `onChange` reports the duration while the wheel turns, `onCommit` the final one (wheel stopped,
 * typed); null while the field holds no valid duration.
 */
export function DurationWheel({
  value,
  onChange,
  onCommit,
  label = 'Dauer',
  name,
  className,
}: {
  value: number | null;
  onChange?: (minutes: number) => void;
  onCommit: (minutes: number | null) => void;
  label?: string;
  /** What is timed, for the wheel's accessible name ("Dauer Radfahren"). */
  name?: string;
  className?: string;
}) {
  const id = useId();
  const [exact, setExact] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The duration off the raster with a place on the wheel: follows every value that does not come
  // from the wheel itself and stays while the wheel turns (removing its row would shift the rows).
  const [extra, setExtra] = useState<number | null>(value);
  const [seen, setSeen] = useState(value);
  const [own, setOwn] = useState<number | null | undefined>(undefined);
  if (value !== seen) {
    setSeen(value);
    if (value !== own) setExtra(value);
  }
  const values = durationWheelValues(extra);

  const fromWheel = (i: number, final: boolean) => {
    const m = values[i];
    if (m === undefined) return;
    setOwn(m);
    setError(null);
    if (final) onCommit(m);
    else onChange?.(m);
  };

  return (
    <div className={cn('grid grid-cols-[minmax(0,1fr)] gap-2', className)}>
      <div className="flex min-h-9 items-center justify-between gap-2">
        <Label htmlFor={exact ? `${id}-m` : undefined}>{label}</Label>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          aria-pressed={exact}
          className={cn('-mr-1', exact && 'bg-foreground text-background hover:bg-foreground/90')}
          onClick={() => setExact((o) => !o)}
        >
          Genau eingeben
        </Button>
      </div>
      <div className="relative">
        <div className="pointer-events-none absolute inset-x-0 top-11 h-11 rounded-lg bg-muted" aria-hidden />
        <Wheel
          label={name ? `${label} ${name}` : label}
          items={values.map(formatDuration)}
          index={nearestIndex(values, value)}
          valueNow={value ?? 0}
          onChange={(i) => fromWheel(i, false)}
          onSettle={(i) => fromWheel(i, true)}
          className="text-xl"
        />
      </div>
      {exact && (
        <NumberField
          id={`${id}-m`}
          aria-label={`${label} in Minuten`}
          value={value}
          unit="Min."
          integer
          autoFocus
          onValueChange={(m) => {
            if (m === null || !(m >= 1)) {
              setError('Bitte eine Dauer ab 1 Minute eingeben.');
              return onCommit(null);
            }
            if (m > MAX_MINUTES) {
              setError(`Höchstens ${fmt0(MAX_MINUTES)} Minuten.`);
              return onCommit(null);
            }
            setError(null);
            onCommit(Math.round(m));
          }}
          error={error}
        />
      )}
    </div>
  );
}
