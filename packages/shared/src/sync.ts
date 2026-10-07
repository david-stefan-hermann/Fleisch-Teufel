/**
 * Last-write-wins rules, shared by server (push) and client (pull) so both sides agree.
 *
 * A record version is identified by `updatedAt` (epoch ms set by the writing device).
 * Ties are broken deterministically by comparing a stable fingerprint of the content, so two
 * devices that wrote different data in the same millisecond still converge to the same value.
 */

export interface Versioned {
  id: string;
  updatedAt: number;
}

/** Stable JSON (sorted keys) used as tie-breaker. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

/**
 * True when `incoming` should replace `current`.
 * - newer `updatedAt` wins
 * - same `updatedAt`: the lexicographically greater fingerprint wins (identical content → no-op)
 */
export function incomingWins<T extends Versioned>(current: T | undefined | null, incoming: T): boolean {
  if (!current) return true;
  if (incoming.updatedAt !== current.updatedAt) return incoming.updatedAt > current.updatedAt;
  return stableStringify(incoming) > stableStringify(current);
}

/** Next `updatedAt` for a local edit: wall clock, but strictly greater than the previous version. */
export function nextVersion(previous: number | undefined, now: number = Date.now()): number {
  return previous !== undefined && previous >= now ? previous + 1 : now;
}
