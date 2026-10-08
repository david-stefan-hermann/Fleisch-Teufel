import {
  energyBreakdown,
  MACRO_KEYS,
  MICRO_NUTRIENTS,
  type MacroKey,
  type ResolvedTargets,
} from '@ft/shared';
import catalog from '@ft/shared/nutrients-catalog.json';
import { MACRO_BG } from '@/components/MacroBars';
import { DisclosureTrigger, EnergySplitBar, MacroShareBar, MicroRow } from '@/components/NutrientBreakdown';
import { NumberField } from '@/components/NumberField';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import {
  FORM_CODES,
  FORM_NUTRIENT,
  formNutrients,
  kcalSource,
  type FormCode,
  type NutrientFormState,
} from '@/features/foods/customFoodForm';
import { fmt0, fmtPercent } from '@/lib/format';
import { cn } from '@/lib/utils';

const MACRO_LABEL: Record<MacroKey, string> = { protein: 'Protein', carbs: 'Kohlenhydrate', fat: 'Fett' };
const MICRO_CODE: Record<(typeof MICRO_NUTRIENTS)[number], FormCode> = {
  FIBT: 'fiber',
  SUGAR: 'sugar',
  FASAT: 'satFat',
  NACL: 'salt',
};
/** "Alle 10 Nährstoffe" in catalog order with the catalog's names and units. */
const ALL = (catalog as { code: string; de: string; unit: string }[])
  .map((c) => ({ ...c, form: FORM_CODES.find((f) => FORM_NUTRIENT[f] === c.code) }))
  .filter((c): c is typeof c & { form: FormCode } => c.form !== undefined);

/** Shown precision of computed values (kcal "289", kJ "1208", sodium "80 mg"). */
const DERIVED_DECIMALS: Partial<Record<FormCode, 0 | 1 | 2>> = { kcal: 0, kj: 0, sodium: 0 };

/**
 * The nutrient overview of a custom food with fields instead of numbers: same layout as
 * `NutrientBreakdown` (kcal head, energy split, macros, "Weitere Nährstoffe" with
 * "Alle 10 Nährstoffe"). The page holds the state (`customFoodForm.ts`); bars and percents follow
 * every keystroke. Computed values are grey until typed over.
 */
export function NutrientEditor({
  state,
  onChange,
  onResetKcal,
  targets,
  error,
  defaultMicrosOpen = false,
  highlighted,
  idPrefix = 'nf',
}: {
  state: NutrientFormState;
  onChange: (code: FormCode, value: number | null) => void;
  onResetKcal: () => void;
  targets: Pick<ResolvedTargets, 'micros'>;
  /** Shown instead of the source line under the kcal (e.g. "Kalorien oder Makros angeben."). */
  error?: string | null;
  defaultMicrosOpen?: boolean;
  /** Fields that were just filled from outside (label photo) and flash once. */
  highlighted?: ReadonlySet<FormCode>;
  idPrefix?: string;
}) {
  const { values } = state;
  const b = energyBreakdown(formNutrients(values));
  const source = kcalSource(state);
  const derived: Record<FormCode, boolean> = {
    kcal: source !== 'kcal',
    kj: state.kjAuto,
    sodium: state.sodiumAuto,
    salt: !state.sodiumAuto,
    protein: false,
    carbs: false,
    sugar: false,
    fat: false,
    satFat: false,
    fiber: false,
  };
  const id = (code: FormCode, suffix = '') => `${idPrefix}-${code}${suffix}`;

  const field = (code: FormCode, opts: { suffix?: string; unit?: string; wide?: boolean } = {}) => (
    <NumberField
      id={id(code, opts.suffix)}
      value={values[code]}
      onValueChange={(v) => onChange(code, v)}
      unit={opts.unit ?? 'g'}
      placeholder="0"
      maxDecimals={derived[code] ? (DERIVED_DECIMALS[code] ?? 2) : 2}
      className="shrink-0"
      inputClassName={cn(
        'h-9 rounded-[10px] pl-2 text-right font-semibold',
        opts.wide ? 'w-28 pr-10' : 'w-20 pr-6',
        derived[code] && values[code] !== null && 'text-muted-foreground',
        highlighted?.has(code) && 'field-flash',
      )}
      unitClassName={cn('text-xs', opts.wide ? 'right-2.5' : 'right-2')}
    />
  );

  return (
    <div className="tabular">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id('kcal')} className="font-semibold">
          Kalorien
        </label>
        <span className="flex items-baseline gap-1">
          <NumberField
            id={id('kcal')}
            value={values.kcal}
            onValueChange={(v) => onChange('kcal', v)}
            placeholder="0"
            maxDecimals={derived.kcal ? 0 : 2}
            aria-required
            aria-invalid={error ? true : undefined}
            aria-describedby={id('kcal', '-note')}
            inputClassName={cn(
              'h-12 w-28 rounded-xl bg-foreground/[0.06] px-2 text-right text-[1.75rem] font-bold dark:bg-foreground/[0.06]',
              derived.kcal && values.kcal !== null && 'text-foreground/80',
              highlighted?.has('kcal') && 'field-flash',
            )}
          />
          <span className="text-[0.8125rem] text-muted-foreground">kcal</span>
        </span>
      </div>
      <p
        id={id('kcal', '-note')}
        className={cn('mt-1 text-right text-xs', error ? 'text-destructive' : 'text-muted-foreground')}
        aria-live="polite"
      >
        {error ??
          (source === 'macros' ? (
            'aus den Makros berechnet'
          ) : (
            <>
              {source === 'kj' ? 'aus deinen kJ' : 'eigene Eingabe'} ·{' '}
              <button
                type="button"
                onClick={onResetKcal}
                className="text-primary underline underline-offset-2 hover:no-underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                aus Makros berechnen
              </button>
            </>
          ))}
      </p>

      <EnergySplitBar breakdown={b} />

      <ul className="grid gap-3">
        {MACRO_KEYS.map((k) => {
          const m = b.macros[k];
          return (
            <li key={k} data-macro={k}>
              <div className="flex items-center justify-between gap-2 text-sm">
                <label htmlFor={id(k)} className="flex min-w-0 items-center gap-1.5">
                  <span className={cn('size-2 shrink-0 rounded-full', MACRO_BG[k])} aria-hidden />
                  <span className="truncate">{MACRO_LABEL[k]}</span>
                </label>
                <span className="flex items-center gap-1.5 whitespace-nowrap text-muted-foreground">
                  {field(k)}
                  <span className="min-w-[6.5rem] text-[0.8125rem]">
                    · {fmtPercent(m.percent / 100)} · {fmt0(m.kcal)} kcal
                  </span>
                </span>
              </div>
              <MacroShareBar macro={k} energy={m} />
            </li>
          );
        })}
      </ul>

      <Collapsible defaultOpen={defaultMicrosOpen} className="mt-2 border-t border-border/70 pt-1.5">
        <DisclosureTrigger className="min-h-11 text-sm font-semibold">Weitere Nährstoffe</DisclosureTrigger>
        <CollapsibleContent>
          <ul className="grid gap-3 pt-1 pb-1">
            {MICRO_NUTRIENTS.map((code) => {
              const f = MICRO_CODE[code];
              return (
                <MicroRow
                  key={code}
                  code={code}
                  value={values[f] ?? undefined}
                  target={targets.micros[code]}
                  field={field(f)}
                  fieldId={id(f)}
                />
              );
            })}
          </ul>
          <Collapsible className="mt-2">
            <DisclosureTrigger className="min-h-10 text-[0.8125rem]">Alle 10 Nährstoffe</DisclosureTrigger>
            <CollapsibleContent>
              <dl className="grid text-xs">
                {ALL.map((c) => (
                  <div
                    key={c.code}
                    className="flex items-center justify-between gap-3 border-b border-border/40 py-1.5 last:border-b-0"
                  >
                    <dt className="min-w-0 text-muted-foreground">
                      <label htmlFor={id(c.form, '-all')}>{c.de}</label>
                      {c.form === 'kj' && (
                        <small className="block text-[0.6875rem]">
                          {state.kjAuto
                            ? 'wird aus kcal berechnet'
                            : source === 'kj'
                              ? 'eigene Eingabe, kcal daraus berechnet'
                              : 'eigene Eingabe'}
                        </small>
                      )}
                      {c.form === 'sodium' && (
                        <small className="block text-[0.6875rem]">
                          {state.sodiumAuto
                            ? 'wird aus Salz berechnet'
                            : 'eigene Eingabe, Salz daraus berechnet'}
                        </small>
                      )}
                    </dt>
                    <dd>{field(c.form, { suffix: '-all', unit: c.unit, wide: true })}</dd>
                  </div>
                ))}
              </dl>
            </CollapsibleContent>
          </Collapsible>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
