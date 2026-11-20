/** A vertical band the assistant button must not overlap (a `[data-ai-avoid]` area in its column). */
export interface Zone {
  top: number;
  bottom: number;
}

/**
 * Where the top edge of the button goes: the free spot in [min, max] nearest to `want` (clamped),
 * the lower one on a tie. A zone blocks every top edge in (top − size − gap, bottom + gap). Null when
 * no spot is free.
 */
export function placeButton({
  want,
  size,
  min,
  max,
  zones,
  gap,
}: {
  want: number;
  size: number;
  min: number;
  max: number;
  zones: readonly Zone[];
  gap: number;
}): number | null {
  if (max < min) return null;
  const blocked = zones.map((z) => [z.top - size - gap, z.bottom + gap] as const);
  const free = (y: number) => y >= min && y <= max && blocked.every(([lo, hi]) => y <= lo || y >= hi);
  const target = Math.min(max, Math.max(min, want));
  if (free(target)) return target;
  let best: number | null = null;
  for (const y of [min, max, ...blocked.flat()]) {
    if (!free(y)) continue;
    const d = Math.abs(y - target);
    const bd = best === null ? Infinity : Math.abs(best - target);
    if (d < bd || (d === bd && y > best!)) best = y;
  }
  return best;
}
