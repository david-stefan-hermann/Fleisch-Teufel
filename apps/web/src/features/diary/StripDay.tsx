import type { StripMark } from '@ft/shared';
import type { WeekMarksPref } from '@/lib/appearance';
import { cn } from '@/lib/utils';

/**
 * One day of the week strip as it is drawn (mockups `2026-11-wochenleiste-tagesurteil-mockup.html` v2 for
 * the shapes, `2026-11-wochenleiste-farben-mockup.html` K5 for the colors): the diary's strip renders
 * its links with it, Mehr → Aussehen its example weeks. `dots` is the look before the verdict: a red
 * dot for food, a blue one for training. The others say whether the day kept its budget: a ring
 * around the number (`ring`, `ringArc`) or the tint of the cell (`field`, `fieldFrame`, `fieldFoot`),
 * green within, three reds over (`overLevel`); training is a blue dot, an outer arc, a frame or a foot.
 */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const share = (part: number, whole: number) => (whole > 0 ? part / whole : 1);

/** Part of the ring filled by what was eaten (within the budget). */
export const ringShare = (eatenKcal: number, budgetKcal: number) =>
  clamp(share(eatenKcal, budgetKcal), 0.04, 1);
/** Excess arc on the selected day. */
export const excessShare = (eatenKcal: number, budgetKcal: number) =>
  clamp(share(eatenKcal - budgetKcal, budgetKcal), 0.07, 1);
/** Training arc of `ringArc`: the day's training kcal against its budget, credited or not. */
export const trainingShare = (trainingKcal: number, budgetKcal: number) =>
  clamp(share(trainingKcal, budgetKcal), 0.08, 1);

const hasVerdict = (variant: WeekMarksPref) => variant !== 'dots';
const isField = (variant: WeekMarksPref) =>
  variant === 'field' || variant === 'fieldFrame' || variant === 'fieldFoot';

/** The verdict the day shows in this look (none in `dots`). */
const verdictOf = (mark: StripMark | undefined, variant: WeekMarksPref) =>
  hasVerdict(variant) ? (mark?.verdict ?? null) : null;

const FIELD_OVER = {
  1: 'bg-strip-over-1',
  2: 'bg-strip-over-2',
  3: 'bg-strip-over-3',
} as const;
const RING_OVER = {
  1: 'stroke-strip-over-ring-1',
  2: 'stroke-strip-over-ring-2',
  3: 'stroke-strip-over-ring-3',
} as const;

/** Classes of the cell itself (link or example): shape, selection, today and the tinted field. */
export function stripDayClass({
  mark,
  selected,
  today,
  variant,
}: {
  mark: StripMark | undefined;
  selected: boolean;
  today: boolean;
  variant: WeekMarksPref;
}): string {
  const verdict = verdictOf(mark, variant);
  const field = isField(variant) && !selected && verdict;
  return cn(
    'relative flex h-14 flex-col items-center justify-center overflow-hidden rounded-xl text-xs',
    selected && 'bg-primary text-primary-foreground',
    !selected && today && 'font-semibold text-primary',
    field && (verdict === 'ok' ? 'bg-strip-ok' : FIELD_OVER[mark!.level ?? 1]),
  );
}

/** Whether the cell carries a tint (hover must not cover it). */
export function stripDayTinted(mark: StripMark | undefined, selected: boolean, variant: WeekMarksPref) {
  return selected || (isField(variant) && !!verdictOf(mark, variant));
}

/** Data attributes of the cell (tests and checks). */
export function stripDayData(mark: StripMark | undefined, variant: WeekMarksPref) {
  const verdict = verdictOf(mark, variant);
  return {
    'data-verdict': verdict ?? undefined,
    'data-level': verdict === 'over' ? (mark!.level ?? undefined) : undefined,
    'data-training': mark?.training ? '' : undefined,
  };
}

/** The text of the day for screen readers (the link's name). */
export function stripDayLabel(dayName: string, mark: StripMark | undefined, variant: WeekMarksPref): string {
  const verdict = verdictOf(mark, variant);
  return [
    dayName,
    mark?.food && 'Essen eingetragen',
    verdict && (verdict === 'ok' ? 'im Ziel' : 'über dem Ziel'),
    mark?.training && 'Training eingetragen',
  ]
    .filter(Boolean)
    .join(', ');
}

/** The content of a day cell: weekday, number, ring, dots, frame and foot. All of it is a picture. */
export function StripDay({
  weekday,
  day,
  mark,
  selected,
  variant,
}: {
  weekday: string;
  day: number;
  mark: StripMark | undefined;
  selected: boolean;
  variant: WeekMarksPref;
}) {
  const verdict = verdictOf(mark, variant);
  const ringed = variant === 'ring' || variant === 'ringArc';
  const food = !!mark?.food;
  const training = !!mark?.training;
  // Without a verdict (no goal) the red dot still says that food was logged.
  const foodDot = food && (variant === 'dots' || variant === 'field' || !verdict);
  const trainingDot = training && (variant === 'dots' || variant === 'ring' || variant === 'field');
  return (
    <>
      <span aria-hidden className={cn('opacity-80', selected && 'opacity-100', ringed && 'leading-[15px]')}>
        {weekday}
      </span>
      {ringed ? (
        <DayRing day={day} mark={mark} selected={selected} arc={variant === 'ringArc'} verdict={verdict} />
      ) : (
        <span
          aria-hidden
          className={cn(
            'tabular text-base font-semibold',
            variant === 'field' && verdict === 'over' && !selected && 'text-strip-over-num',
          )}
        >
          {day}
        </span>
      )}
      <span aria-hidden className="mt-0.5 flex h-1 gap-[3px]">
        {foodDot && (
          <span
            data-dot="food"
            className={cn('size-1 rounded-full', selected ? 'bg-primary-foreground' : 'bg-primary')}
          />
        )}
        {trainingDot && <span data-dot="training" className="size-1 rounded-full bg-exercise" />}
      </span>
      {variant === 'fieldFrame' && training && (
        <span
          aria-hidden
          data-mark="frame"
          className={cn(
            'pointer-events-none absolute rounded-[inherit] border-2',
            selected
              ? 'inset-[2px] rounded-[calc(var(--radius-xl)-2px)] border-primary-foreground'
              : 'inset-0 border-exercise',
          )}
        />
      )}
      {variant === 'fieldFoot' && training && (
        <span
          aria-hidden
          data-mark="foot"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[5px] bg-exercise"
        />
      )}
    </>
  );
}

/** The number inside its ring (`ring`: 30 px, `ringArc`: 32 px with the training arc outside). */
function DayRing({
  day,
  mark,
  selected,
  arc,
  verdict,
}: {
  day: number;
  mark: StripMark | undefined;
  selected: boolean;
  arc: boolean;
  verdict: 'ok' | 'over' | null;
}) {
  const size = arc ? 32 : 30;
  const c = size / 2;
  const r = arc ? 11.25 : 13;
  const C = 2 * Math.PI * r;
  const at = { cx: c, cy: c, r };
  const fill = verdict && mark ? (verdict === 'over' ? 1 : ringShare(mark.eatenKcal, mark.budgetKcal)) : 0;
  const excess = verdict === 'over' && selected && mark ? excessShare(mark.eatenKcal, mark.budgetKcal) : 0;
  const outer = 2 * Math.PI * 15;
  const trainingLen = arc && mark?.training ? trainingShare(mark.trainingKcal, mark.budgetKcal) * outer : 0;
  return (
    <span aria-hidden className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 size-full fill-none">
        <g transform={`rotate(-90 ${c} ${c})`}>
          {verdict && (
            <>
              <circle
                {...at}
                data-mark="ring"
                strokeWidth={2.5}
                className={
                  selected
                    ? 'stroke-[color-mix(in_oklch,var(--primary-foreground)_30%,transparent)]'
                    : 'stroke-strip-track'
                }
              />
              <circle
                {...at}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeDasharray={`${fill * C} ${C}`}
                className={
                  selected
                    ? 'stroke-primary-foreground'
                    : verdict === 'ok'
                      ? 'stroke-good'
                      : RING_OVER[mark?.level ?? 1]
                }
              />
              {excess > 0 && (
                <circle
                  {...at}
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeDasharray={`${excess * C} ${C}`}
                  className="stroke-strip-excess-selected"
                />
              )}
            </>
          )}
          {trainingLen > 0 && (
            // Ends at 12 o'clock, so it grows counterclockwise from there.
            <circle
              cx={c}
              cy={c}
              r={15}
              data-mark="arc"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeDasharray={`${trainingLen} ${outer}`}
              strokeDashoffset={trainingLen - outer}
              className={selected ? 'stroke-primary-foreground' : 'stroke-exercise'}
            />
          )}
        </g>
      </svg>
      <span className={cn('tabular relative leading-none font-semibold', arc ? 'text-[13px]' : 'text-sm')}>
        {day}
      </span>
    </span>
  );
}
