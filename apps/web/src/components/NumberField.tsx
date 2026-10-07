import { useId, useState, type ComponentProps } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fmt2, parseDecimal } from '@/lib/format';
import { cn } from '@/lib/utils';

interface NumberFieldProps extends Omit<ComponentProps<typeof Input>, 'value' | 'onChange' | 'type'> {
  label?: string;
  value: number | null;
  onValueChange: (v: number | null) => void;
  unit?: string;
  hint?: string;
  error?: string | null;
  integer?: boolean;
}

const display = (v: number | null) => (v === null || Number.isNaN(v) ? '' : fmt2(v).replace(/\./g, ''));

/** Decimal input that accepts "1,5" and "1.5" (iOS shows the decimal keypad). */
export function NumberField({
  label,
  value,
  onValueChange,
  unit,
  hint,
  error,
  integer,
  className,
  id,
  ...rest
}: NumberFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const [text, setText] = useState(() => display(value));
  // Follow external changes (e.g. +/- buttons, presets) unless the text already means that number.
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    const parsed = parseDecimal(text);
    const same = value === null ? Number.isNaN(parsed) : parsed === value;
    if (!same) setText(display(value));
  }
  return (
    <div className={cn('grid content-start gap-1.5', className)}>
      {label && <Label htmlFor={inputId}>{label}</Label>}
      <div className="relative">
        <Input
          id={inputId}
          inputMode={integer ? 'numeric' : 'decimal'}
          autoComplete="off"
          enterKeyHint="done"
          value={text}
          aria-invalid={error ? true : undefined}
          aria-describedby={hint || error ? `${inputId}-hint` : undefined}
          onChange={(e) => {
            setText(e.target.value);
            const n = parseDecimal(e.target.value);
            onValueChange(Number.isNaN(n) ? null : integer ? Math.round(n) : n);
          }}
          onFocus={(e) => e.currentTarget.select()}
          className={cn('tabular', unit && 'pr-14')}
          {...rest}
        />
        {unit && (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
            {unit}
          </span>
        )}
      </div>
      {(error || hint) && (
        <p
          id={`${inputId}-hint`}
          className={cn('text-xs', error ? 'text-destructive' : 'text-muted-foreground')}
          aria-live="polite"
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
}
