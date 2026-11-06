import { kcalFromMacros } from '@ft/shared';
import { HintCount, HintField } from '@/components/HintField';
import { NumberField } from '@/components/NumberField';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { QuickEntryValues } from '@/db/entries';
import { fmt0 } from '@/lib/format';

/** The quick entry form as typed: a text, optional values, the diary meal. */
export interface QuickEntryState {
  text: string;
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  meal: number;
}

export const emptyQuickEntry = (meal: number): QuickEntryState => ({
  text: '',
  kcal: null,
  protein: null,
  carbs: null,
  fat: null,
  meal,
});

/** Something was written into the text field. */
export const quickEntryHasText = (s: QuickEntryState) => s.text.trim().length > 0;
/** The values can be logged as they are: calories given and plausible. */
export const quickEntryValid = (s: QuickEntryState) => s.kcal !== null && s.kcal >= 0 && s.kcal < 20_000;
/** Any value typed (they go to the AI as a clue even when the calories are missing). */
export const quickEntryHasValues = (s: QuickEntryState) =>
  [s.kcal, s.protein, s.carbs, s.fat].some((v) => v !== null && v > 0);

/** The state as what gets written; only for a valid form. */
export const quickEntryValues = (s: QuickEntryState): QuickEntryValues => ({
  meal: s.meal,
  text: s.text,
  kcal: s.kcal ?? 0,
  proteinG: s.protein,
  carbsG: s.carbs,
  fatG: s.fat,
});

/**
 * Fields of "Eingeben" (food page) and of editing a quick entry: "Was hast du gegessen?", calories
 * and macros (all optional as fields: the page decides what its buttons need), and the diary meal.
 * Values alone are logged as they are, a text alone is analysed, both can do either.
 */
export function QuickEntryFields({
  value,
  onChange,
  mealNames,
  disabled,
  autoFocus,
  hint,
}: {
  value: QuickEntryState;
  onChange: (next: QuickEntryState) => void;
  mealNames: readonly string[];
  disabled?: boolean;
  autoFocus?: boolean;
  /** Line under the text field (what the buttons will do with it). */
  hint?: string;
}) {
  const set = (patch: Partial<QuickEntryState>) => onChange({ ...value, ...patch });
  const macroKcal = kcalFromMacros({
    proteinG: value.protein ?? 0,
    carbsG: value.carbs ?? 0,
    fatG: value.fat ?? 0,
  });
  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="qe-text">Was hast du gegessen?</Label>
        <HintField
          id="qe-text"
          value={value.text}
          disabled={disabled}
          autoFocus={autoFocus}
          onChange={(e) => set({ text: e.target.value })}
          placeholder="z. B. „Döner mit allem, kleine Pommes“"
          aria-describedby="qe-text-hint"
        />
        <p id="qe-text-hint" className="text-xs text-muted-foreground text-pretty">
          <HintCount length={value.text.length} />
          {hint}
        </p>
      </div>
      <NumberField
        label="Kalorien"
        unit="kcal"
        value={value.kcal}
        disabled={disabled}
        onValueChange={(kcal) => set({ kcal })}
        integer
      />
      <div className="grid grid-cols-3 gap-3">
        <NumberField
          label="Protein"
          unit="g"
          value={value.protein}
          disabled={disabled}
          onValueChange={(protein) => set({ protein })}
        />
        <NumberField
          label="Kohlenh."
          unit="g"
          value={value.carbs}
          disabled={disabled}
          onValueChange={(carbs) => set({ carbs })}
        />
        <NumberField
          label="Fett"
          unit="g"
          value={value.fat}
          disabled={disabled}
          onValueChange={(fat) => set({ fat })}
        />
      </div>
      {macroKcal > 0 && (
        <p className="text-xs text-muted-foreground">
          Makros ergeben ≈ {fmt0(macroKcal)} kcal.{' '}
          {value.kcal === null && !disabled && (
            <button
              type="button"
              className="text-primary underline"
              onClick={() => set({ kcal: Math.round(macroKcal) })}
            >
              Übernehmen
            </button>
          )}
        </p>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="qe-meal">Mahlzeit</Label>
        <Select
          value={String(value.meal)}
          onValueChange={(v) => set({ meal: Number(v) })}
          disabled={disabled}
        >
          <SelectTrigger id="qe-meal" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {mealNames.map((n, i) => (
              <SelectItem key={i} value={String(i)}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
