import { get, N, type DaySummary } from '@ft/shared';
import { CalorieRing } from '@/components/CalorieRing';
import { MacroBars } from '@/components/MacroBars';
import { fmt0 } from '@/lib/format';

export function CalorieCard({
  summary,
  exerciseCredited,
}: {
  summary: DaySummary;
  exerciseCredited: boolean;
}) {
  const eaten = get(summary.food, N.kcal);
  const t = summary.targets;
  return (
    <section
      className="mb-4 rounded-2xl border border-border/70 bg-card p-4 shadow-[0_1px_2px_rgb(0_0_0/0.04)]"
      aria-label="Kalorien heute"
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
      <MacroBars
        className="mt-4"
        macros={[
          { key: 'protein', label: 'Protein', value: get(summary.food, N.protein), target: t.proteinG },
          { key: 'carbs', label: 'Kohlenhydrate', value: get(summary.food, N.carbs), target: t.carbsG },
          { key: 'fat', label: 'Fett', value: get(summary.food, N.fat), target: t.fatG },
        ]}
      />
    </section>
  );
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
