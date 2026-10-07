import { fmt0 } from '@/lib/format';

/**
 * Ring showing how much of the day's budget is used. Over budget, the overflow is drawn in the
 * "over" color on top of a full ring. Respects reduced motion (no transition).
 */
export function CalorieRing({ eaten, budget, size = 148 }: { eaten: number; budget: number; size?: number }) {
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const ratio = budget > 0 ? eaten / budget : 0;
  const used = Math.min(ratio, 1);
  const over = ratio > 1 ? Math.min(ratio - 1, 1) : 0;
  const remaining = Math.round(budget - eaten);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--muted)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${used * c} ${c}`}
          className="transition-[stroke-dasharray] duration-500 motion-reduce:transition-none"
        />
        {over > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--over)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${over * c} ${c}`}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className={`tabular text-3xl font-bold tracking-tight ${remaining < 0 ? 'text-over' : ''}`}>
          {fmt0(Math.abs(remaining))}
        </span>
        <span className="text-xs text-muted-foreground">{remaining < 0 ? 'kcal zu viel' : 'kcal übrig'}</span>
      </div>
    </div>
  );
}
