import { useId, useState, type ComponentProps } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fmt0, fmt1, fmt2, fmtFixed, parseDecimal } from '@/lib/format';
import { cn } from '@/lib/utils';

interface NumberFieldProps extends Omit<ComponentProps<typeof Input>, 'value' | 'onChange' | 'type'> {
  label?: string;
  value: number | null;
  onValueChange: (v: number | null) => void;
  unit?: string;
  hint?: string;
  error?: string | null;
  integer?: boolean;
  /** Fixed decimals shown while the field is not being edited ("80,00"); typing stays free. */
  decimals?: 1 | 2;
  /** At most this many decimals for values set from outside (e.g. computed kJ "1208"). Default 2. */
  maxDecimals?: 0 | 1 | 2;
  /** Classes of the input itself (`className` styles the wrapper). */
  inputClassName?: string;
  unitClassName?: string;
}

const LOOSE = { 0: fmt0, 1: fmt1, 2: fmt2 } as const;
const display = (v: number | null, decimals?: 1 | 2, maxDecimals: 0 | 1 | 2 = 2) =>
  v === null || Number.isNaN(v)
    ? ''
    : (decimals ? fmtFixed(v, decimals) : LOOSE[maxDecimals](v)).replace(/\./g, '');

/** Decimal input that accepts "1,5" and "1.5" (iOS shows the decimal keypad). */
export function NumberField({
  label,
  value,
  onValueChange,
  unit,
  hint,
  error,
  integer,
  decimals,
  maxDecimals,
  inputClassName,
  unitClassName,
  className,
  id,
  onBlur,
  ...rest
}: NumberFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const [text, setText] = useState(() => display(value, decimals, maxDecimals));
  // Follow external changes (e.g. +/- buttons, presets) unless the text already means that number.
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    const parsed = parseDecimal(text);
    const same = value === null ? Number.isNaN(parsed) : parsed === value;
    if (!same) setText(display(value, decimals, maxDecimals));
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
          onBlur={(e) => {
            // "84,3" becomes "84,30" once the field is left.
            if (decimals && value !== null && parseDecimal(text) === value) setText(display(value, decimals));
            onBlur?.(e);
          }}
          className={cn('tabular', unit && 'pr-14', inputClassName)}
          {...rest}
        />
        {unit && (
          <span
            className={cn(
              'pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground',
              unitClassName,
            )}
          >
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
