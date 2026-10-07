import { get, N, type DaySummary } from '@ft/shared';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { CalorieRing } from '@/components/CalorieRing';
import { MacroBars } from '@/components/MacroBars';
import { NutrientBreakdown } from '@/components/NutrientBreakdown';
import { fmt0 } from '@/lib/format';
import { cn } from '@/lib/utils';

export function CalorieCard({
  summary,
  exerciseCredited,
}: {
  summary: DaySummary;
  exerciseCredited: boolean;
}) {
  const eaten = get(summary.food, N.kcal);
  const t = summary.targets;
  const [open, setOpenState] = useState(readOpen);
  const [sources, setSources] = useState(false);
  const setOpen = (o: boolean) => {
    setOpenState(o);
    writeOpen(o);
  };
  return (
    <section
      className="mb-4 cursor-pointer rounded-2xl border border-border/70 bg-card p-4 shadow-[0_1px_2px_rgb(0_0_0/0.04)]"
      aria-label="Kalorien heute"
      // Tapping anywhere on the overview toggles the details; the button below is the accessible control.
      onClick={(e) => {
        if ((e.target as Element).closest('a, button, input, select, textarea')) return;
        if (window.getSelection()?.toString()) return;
        setOpen(!open);
      }}
    >
      <div className="flex items-center gap-4">
        <CalorieRing eaten={eaten} budget={summary.budgetKcal} />
        <dl className="tabular grid min-w-0 flex-1 gap-2 text-sm">
          <Row label="Ziel" value={fmt0(t.kcal)} />
          <Row label="Essen" value={`− ${fmt0(eaten)}`} />
          <Row
            label={exerciseCredited ? 'Training' : 'Training (nicht angerechnet)'}
            value={`+ ${fmt0(exerciseCredited ? summary.exerciseKcal : 0)}`}
            muted={!exerciseCredited}
          />
          <div className="border-t border-border pt-2">
            <Row label="Übrig" value={fmt0(summary.remainingKcal)} strong over={summary.remainingKcal < 0} />
          </div>
        </dl>
      </div>
      {/* Closed: the three target bars. Open: the nutrient overview replaces them. */}
      {!open && (
        <MacroBars
          className="mt-4"
          macros={[
            { key: 'protein', label: 'Protein', value: get(summary.food, N.protein), target: t.proteinG },
            { key: 'carbs', label: 'Kohlenhydrate', value: get(summary.food, N.carbs), target: t.carbsG },
            { key: 'fat', label: 'Fett', value: get(summary.food, N.fat), target: t.fatG },
          ]}
        />
      )}
      {open && (
        <div id="day-details" className="mt-4 cursor-auto border-t border-border/70 pt-3.5">
          <NutrientBreakdown
            variant="day"
            nutrients={summary.food}
            targets={t}
            showMicroSources={sources}
            defaultMicrosOpen
          />
          <button
            type="button"
            onClick={() => setSources(!sources)}
            className="mt-1 min-h-8 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {sources ? 'Quellen ausblenden' : 'Woher kommen die Zielwerte?'}
          </button>
        </div>
      )}
      <button
        type="button"
        aria-expanded={open}
        aria-controls="day-details"
        onClick={() => setOpen(!open)}
        className="-mb-2 mt-2 flex h-9 w-full items-center justify-center gap-1 rounded-lg text-xs font-medium text-muted-foreground hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        {open ? 'Weniger' : 'Nährstoffe'}
        <ChevronDown
          className={cn('size-4 transition-transform motion-reduce:transition-none', open && 'rotate-180')}
          aria-hidden
        />
      </button>
    </section>
  );
}

const OPEN_KEY = 'ft.diary.detailsOpen';

/** Per-device preference; storage may be unavailable (private mode), then it stays closed. */
function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

function writeOpen(open: boolean) {
  try {
    localStorage.setItem(OPEN_KEY, open ? '1' : '0');
  } catch {
    // ignore
  }
}

function Row({
  label,
  value,
  strong,
  muted,
  over,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
  over?: boolean;
}) {
  return (
    <div className={`flex items-baseline justify-between gap-2 ${muted ? 'text-muted-foreground' : ''}`}>
      <dt className={strong ? 'font-semibold' : 'text-muted-foreground'}>{label}</dt>
      <dd className={`${strong ? 'text-lg font-bold' : 'font-medium'} ${over ? 'text-over' : ''}`}>
        {value}
      </dd>
    </div>
  );
}
