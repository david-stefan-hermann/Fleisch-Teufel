import {
  DISPLAY_NUTRIENTS,
  energyBreakdown,
  MACRO_KEYS,
  MICRO_DEFAULTS,
  MICRO_NUTRIENTS,
  microStatus,
  N,
  type MacroKey,
  type NutrientInfo,
  type NutrientMap,
  type ResolvedTargets,
} from '@ft/shared';
import catalog from '@ft/shared/nutrients-catalog.json';
import { ChevronDown } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { isOverTarget, MACRO_BG, TargetBar } from '@/components/MacroBars';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { fmt0, fmtGrams, fmtPercent, NO_VALUE } from '@/lib/format';
import { cn } from '@/lib/utils';

const CATALOG = catalog as NutrientInfo[];
const LABEL = new Map(DISPLAY_NUTRIENTS.map((n) => [n.code, n.de]));
const MACRO_CODE: Record<MacroKey, string> = { protein: N.protein, carbs: N.carbs, fat: N.fat };
const TARGET_G: Record<MacroKey, 'proteinG' | 'carbsG' | 'fatG'> = {
  protein: 'proteinG',
  carbs: 'carbsG',
  fat: 'fatG',
};

export interface NutrientBreakdownProps {
  /** Absolute values of what is shown (portion, diary meal, saved meal, day, average day). */
  nutrients: NutrientMap;
  /** Shown left of the kcal number, e.g. "Summe". */
  title?: ReactNode;
  /**
   * Targets of the day (kcal, macro grams, micros). Micros always show "von mind./max."; the day
   * mode measures the macros against them.
   */
  targets: Pick<ResolvedTargets, 'kcal' | 'proteinG' | 'carbsG' | 'fatG' | 'micros'>;
  /**
   * 'item' (default): a food, meal or analysis. Tapping the kcal number switches to the day mode
   * (share of the daily target) and back. 'day': day overview and reports; no switch, the head
   * reads "1.640 / 1.700 kcal" and the macro bars measure against the target.
   */
  variant?: 'item' | 'day';
  /** Adds where each micro target comes from (DGE source or "Eigener Zielwert"). */
  showMicroSources?: boolean;
  defaultMicrosOpen?: boolean;
  /** Controlled state of "Weitere Nährstoffe" (with `onMicrosOpenChange`). */
  microsOpen?: boolean;
  onMicrosOpenChange?: (open: boolean) => void;
  className?: string;
}

/**
 * The one nutrient overview of the app (food page, saved meal, AI review, diary meal page, day
 * overview, reports): energy, the macro energy split as one full bar, the three macros, and the
 * micros with their daily targets behind "Weitere Nährstoffe". Text uses ink tokens; macro colors
 * only appear in dots and bars.
 */
export function NutrientBreakdown({
  nutrients,
  title,
  targets,
  variant = 'item',
  showMicroSources = false,
  defaultMicrosOpen = false,
  microsOpen,
  onMicrosOpenChange,
  className,
}: NutrientBreakdownProps) {
  const id = useId();
  const [dayModeOn, setDayMode] = useState(false);
  const dayMode = variant === 'item' && dayModeOn;
  /** Macro bars measure against the daily target (day mode, or the day itself). */
  const relative = variant === 'day' || dayMode;
  const b = energyBreakdown(nutrients);
  const catalogRows = CATALOG.filter((c) => nutrients[c.code] !== undefined);

  const kcalText = (
    <>
      {/* Flex items drop their leading spaces (kept for the text content); `gap-1` spaces them. */}
      <span>{fmt0(b.kcal)}</span>
      {relative && <span className="text-lg font-medium text-muted-foreground"> / {fmt0(targets.kcal)}</span>}
      <span className="text-[0.8125rem] font-normal text-muted-foreground"> kcal</span>
    </>
  );

  return (
    <div className={cn('tabular', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">{title}</span>
        <div className="text-right">
          {variant === 'item' ? (
            <button
              type="button"
              aria-pressed={dayMode}
              aria-describedby={dayMode ? `${id}-mode` : undefined}
              aria-label={`${fmt0(b.kcal)} kcal, Anteil am Tagesziel anzeigen`}
              onClick={() => setDayMode(!dayMode)}
              className="-mx-1.5 -my-0.5 inline-flex items-baseline gap-1 rounded-lg bg-foreground/[0.06] px-1.5 py-0.5 text-[1.75rem] leading-tight font-bold hover:bg-foreground/10 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              {kcalText}
            </button>
          ) : (
            <span className="inline-flex items-baseline gap-1 text-[1.75rem] leading-tight font-bold">
              {kcalText}
            </span>
          )}
          {dayMode && (
            <div id={`${id}-mode`} className="mt-0.5 text-xs text-muted-foreground">
              Anteil am Tagesziel
            </div>
          )}
        </div>
      </div>

      <EnergySplitBar breakdown={b} />

      <ul className="grid gap-3">
        {MACRO_KEYS.map((k) => {
          const m = b.macros[k];
          const label = LABEL.get(MACRO_CODE[k])!;
          const target = targets[TARGET_G[k]];
          const over = relative && isOverTarget(m.grams, target);
          const grams = (
            <span className={cn('font-semibold', over ? 'text-over' : 'text-foreground')}>
              {fmtGrams(m.grams)}
            </span>
          );
          const parts = dayMode
            ? [`/ ${fmtGrams(target)}`, fmtPercent(target > 0 ? m.grams / target : 0)]
            : relative
              ? [`/ ${fmtGrams(target)}`, fmtPercent(m.percent / 100), `${fmt0(m.kcal)} kcal`]
              : [fmtPercent(m.percent / 100), `${fmt0(m.kcal)} kcal`];
          return (
            <li key={k} data-macro={k}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className={cn('size-2 shrink-0 rounded-full', MACRO_BG[k])} aria-hidden />
                  <span className="truncate">{label}</span>
                </span>
                <span className="text-right whitespace-nowrap text-muted-foreground">
                  {grams}
                  {dayMode || relative ? ' ' : ' · '}
                  {parts.join(' · ')}
                </span>
              </div>
              {relative ? (
                <TargetBar
                  className="mt-1"
                  value={m.grams}
                  target={target}
                  color={MACRO_BG[k]}
                  label={label}
                  valueText={`${fmtGrams(m.grams)} von ${fmtGrams(target)}`}
                />
              ) : (
                <div
                  className="relative mt-1 h-1.5 overflow-hidden rounded-full bg-muted"
                  role="meter"
                  aria-label={label}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={m.percent}
                  aria-valuetext={`${fmtPercent(m.percent / 100)} der Energie, ${fmt0(m.kcal)} kcal`}
                >
                  <div
                    className={cn('h-full rounded-full', MACRO_BG[k])}
                    style={{ width: `${m.share * 100}%` }}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <Collapsible
        open={microsOpen}
        defaultOpen={defaultMicrosOpen}
        onOpenChange={onMicrosOpenChange}
        className="mt-2 border-t border-border/70 pt-1.5"
      >
        <DisclosureTrigger className="min-h-11 text-sm font-semibold">Weitere Nährstoffe</DisclosureTrigger>
        <CollapsibleContent>
          <ul className="grid gap-3 pt-1 pb-1">
            {MICRO_NUTRIENTS.map((code) => (
              <MicroRow
                key={code}
                code={code}
                value={nutrients[code]}
                target={targets.micros[code]}
                showSource={showMicroSources}
              />
            ))}
          </ul>
          {catalogRows.length > DISPLAY_NUTRIENTS.length && (
            <Collapsible className="mt-2">
              <DisclosureTrigger className="min-h-10 text-[0.8125rem]">
                Alle {catalogRows.length} Nährstoffe
              </DisclosureTrigger>
              <CollapsibleContent>
                <dl className="grid text-xs">
                  {catalogRows.map((c) => (
                    <div
                      key={c.code}
                      className="flex justify-between gap-3 border-b border-border/40 py-1.5 last:border-b-0"
                    >
                      <dt className="min-w-0 text-muted-foreground">{c.de}</dt>
                      <dd className="shrink-0">{fmtGrams(nutrients[c.code]!, c.unit)}</dd>
                    </div>
                  ))}
                </dl>
              </CollapsibleContent>
            </Collapsible>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

/** Row trigger of the overview's collapsibles ("Weitere Nährstoffe", the ingredient "Nährwerte"). */
export function DisclosureTrigger({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <CollapsibleTrigger
      className={cn(
        'group -mx-2 flex w-[calc(100%+1rem)] items-center justify-between rounded-lg px-2 text-left text-muted-foreground hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
        className,
      )}
    >
      <span>{children}</span>
      <ChevronDown
        className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none"
        aria-hidden
      />
    </CollapsibleTrigger>
  );
}

/** Full stacked bar of the macro energy split (always 100 % when there are macros). */
export function EnergySplitBar({
  breakdown: b,
  className,
}: {
  breakdown: ReturnType<typeof energyBreakdown>;
  className?: string;
}) {
  const has = MACRO_KEYS.some((k) => b.macros[k].share > 0);
  const label = has
    ? `Energieverteilung: ${MACRO_KEYS.map((k) => `${LABEL.get(MACRO_CODE[k])} ${fmtPercent(b.macros[k].percent / 100)}`).join(', ')}`
    : 'Energieverteilung: keine Makronährstoffe';
  return (
    <div
      role="img"
      aria-label={label}
      className={cn('mt-2.5 mb-3.5 flex h-2 w-full overflow-hidden rounded-full bg-muted', className)}
    >
      {has &&
        MACRO_KEYS.map((k) => (
          <div
            key={k}
            className={cn('h-full', MACRO_BG[k])}
            style={{ width: `${b.macros[k].share * 100}%` }}
          />
        ))}
    </div>
  );
}

function MicroRow({
  code,
  value,
  target,
  showSource,
}: {
  code: (typeof MICRO_NUTRIENTS)[number];
  value: number | undefined;
  target: ResolvedTargets['micros'][(typeof MICRO_NUTRIENTS)[number]];
  showSource: boolean;
}) {
  const label = LABEL.get(code)!;
  const v = value ?? 0;
  const status = value === undefined ? null : microStatus(v, target);
  const pct = value !== undefined && target.grams > 0 ? Math.min(100, (v / target.grams) * 100) : 0;
  const goal = `${target.kind === 'min' ? 'von mind.' : 'von max.'} ${fmtGrams(target.grams)}`;
  const valueText = value === undefined ? 'keine Angabe' : `${fmtGrams(v)} ${goal}`;
  return (
    <li>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="min-w-0">{label}</span>
        <span className="text-right whitespace-nowrap text-muted-foreground">
          <span className={cn('font-semibold', status === 'high' ? 'text-over' : 'text-foreground')}>
            {value === undefined ? NO_VALUE : fmtGrams(v)}
          </span>{' '}
          {goal}
        </span>
      </div>
      {target.kind === 'max' ? (
        // Maximums stack like the macros: grey up to the maximum, then red, then dark red.
        <TargetBar
          className="mt-1"
          value={v}
          target={target.grams}
          color="bg-foreground/40"
          label={label}
          valueText={valueText}
          over={status === 'high'}
        />
      ) : (
        <div
          className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={target.grams}
          aria-valuenow={Math.round(v * 10) / 10}
          aria-valuetext={valueText}
        >
          <div
            className={cn('h-full rounded-full', status === 'ok' ? 'bg-good' : 'bg-foreground/40')}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {showSource && (
        <p className="mt-1 text-xs text-muted-foreground">
          {target.custom ? 'Eigener Zielwert' : MICRO_DEFAULTS[code].source}
        </p>
      )}
    </li>
  );
}
