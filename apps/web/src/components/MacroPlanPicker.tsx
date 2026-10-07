import { KCAL_PER_G, MACRO_PRESETS, macrosForPlan, planFromPreset, round, type MacroPlan } from '@ft/shared';
import { Check } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { fmt0, fmt1 } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Macro templates (protein per kg body weight + fat or carb share) and "Eigene" with sliders.
 * Shows the resulting grams for the given calories and weight; the parent decides what to do with them.
 */
export function MacroPlanPicker({
  plan,
  onChange,
  kcal,
  weightKg,
}: {
  plan: MacroPlan;
  onChange: (plan: MacroPlan) => void;
  kcal: number;
  weightKg: number | null;
}) {
  const m = weightKg ? macrosForPlan(kcal, weightKg, plan) : null;
  const pct = (g: number, perG: number) => (kcal > 0 ? Math.round(((g * perG) / kcal) * 100) : 0);
  const custom = plan.preset === 'custom';
  return (
    <div className="grid gap-3">
      <div className="grid gap-2" role="radiogroup" aria-label="Makro-Verteilung">
        {MACRO_PRESETS.map((p) => (
          <Choice
            key={p.id}
            selected={plan.preset === p.id}
            onSelect={() => onChange(planFromPreset(p.id))}
            title={p.label}
            hint={p.hint}
          />
        ))}
        <Choice
          selected={custom}
          onSelect={() =>
            onChange({
              preset: 'custom',
              proteinPerKg: plan.proteinPerKg,
              fatPct: plan.fatPct ?? 30,
              carbsPct: null,
            })
          }
          title="Eigene"
          hint="Eiweiß pro kg und Fettanteil selbst einstellen"
        />
      </div>
      {custom && (
        <div className="grid gap-4 rounded-xl bg-muted/60 p-3">
          <SliderRow
            label="Eiweiß"
            value={`${fmt1(plan.proteinPerKg)} g/kg`}
            min={0.8}
            max={2.5}
            step={0.1}
            current={plan.proteinPerKg}
            onChange={(v) => onChange({ ...plan, proteinPerKg: round(v, 1) })}
          />
          <SliderRow
            label="Fett"
            value={`${fmt0(plan.fatPct ?? 30)} % der Kalorien`}
            min={20}
            max={40}
            step={1}
            current={plan.fatPct ?? 30}
            onChange={(v) => onChange({ ...plan, fatPct: Math.round(v), carbsPct: null })}
          />
        </div>
      )}
      {m && (
        <dl
          className="tabular grid grid-cols-3 gap-2 rounded-xl border p-3 text-center text-sm"
          aria-live="polite"
        >
          <div>
            <dt className="text-xs text-muted-foreground">Eiweiß</dt>
            <dd className="font-semibold">{fmt0(m.proteinG)} g</dd>
            <dd className="text-xs text-muted-foreground">{pct(m.proteinG, KCAL_PER_G.protein)} %</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Kohlenh.</dt>
            <dd className="font-semibold">{fmt0(m.carbsG)} g</dd>
            <dd className="text-xs text-muted-foreground">{pct(m.carbsG, KCAL_PER_G.carbs)} %</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Fett</dt>
            <dd className="font-semibold">{fmt0(m.fatG)} g</dd>
            <dd className="text-xs text-muted-foreground">{pct(m.fatG, KCAL_PER_G.fat)} %</dd>
          </div>
        </dl>
      )}
      {m && weightKg && m.proteinG < Math.round(plan.proteinPerKg * weightKg) - 1 && (
        <p className="text-xs text-warn">
          Eiweiß ist auf 35 % der Kalorien begrenzt ({fmt0(m.proteinG)} g statt{' '}
          {fmt0(plan.proteinPerKg * weightKg)} g). Mehr ist bei diesem Kalorienziel nicht sinnvoll.
        </p>
      )}
      {!weightKg && (
        <p className="text-xs text-muted-foreground">
          Trage dein Gewicht ein, damit Eiweiß pro kg berechnet werden kann.
        </p>
      )}
    </div>
  );
}

function Choice({
  selected,
  onSelect,
  title,
  hint,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'flex items-center gap-3 rounded-xl border p-3 text-left transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
        selected ? 'border-primary bg-primary/5' : 'hover:bg-accent',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
      {selected && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
    </button>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  current,
  onChange,
}: {
  label: string;
  value: string;
  min: number;
  max: number;
  step: number;
  current: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular text-muted-foreground">{value}</span>
      </div>
      <Slider
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={[current]}
        onValueChange={([v]) => v !== undefined && onChange(v)}
      />
    </div>
  );
}
