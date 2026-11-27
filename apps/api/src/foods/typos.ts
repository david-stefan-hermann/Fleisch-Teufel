/**
 * The words of the own product catalog, for queries with a typo: PostgreSQL finds products by the
 * letters typed (`like`), so a mistyped word needs the spellings it may stand for before it can be
 * asked. They are picked with the rule of the ranking (`typoBudget`, `typoDistance` in `@ft/shared`,
 * here with the doubled letters taken out once for all words:
 * swapped letters count once, which trigram similarity gets wrong for short words like "mikla").
 */
import { editDistance, squeeze, TYPO_START_MIN, typoBudget } from '@ft/shared';

/** Corrections asked per mistyped word. */
const MAX_CORRECTIONS = 8;
/** Mistyped words remembered (the same word comes again with every letter typed after it). */
const CACHE_SIZE = 500;

/** Optimal string alignment distance of `a` to every start of `b`: `row[n]` for its first n letters. */
function startDistances(a: string, b: string): number[] {
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        v = Math.min(v, prev2[j - 2]! + 1);
      cur.push(v);
    }
    prev2 = prev;
    prev = cur;
  }
  return prev;
}

export class CatalogWords {
  private readonly cache = new Map<string, string[]>();
  /** Sorted, so words with the same start follow each other. */
  private readonly sorted: string[];
  /** `squeeze` of each sorted word. */
  private readonly squeezed: string[];

  /** `words`: every word of name and brand (folded, `searchKey`) with the number of its products. */
  constructor(private readonly words: ReadonlyMap<string, number>) {
    this.sorted = [...words.keys()].sort();
    this.squeezed = this.sorted.map(squeeze);
  }

  get size(): number {
    return this.sorted.length;
  }

  /**
   * What a mistyped word may stand for, each by the number of its products: whole words ("milsni" →
   * "milsani"), and for a word still being typed (`typing`, the last of a query) also starts of
   * longer words ("schokla" → "schokola"). Empty for words too short for a typo.
   */
  corrections(t: string, typing = false): string[] {
    const k = typoBudget(t);
    if (k === 0) return [];
    const starts = typing && t.length >= TYPO_START_MIN;
    const cacheKey = starts ? `${t} ` : t;
    const known = this.cache.get(cacheKey);
    if (known) return known;
    const found = new Map<string, number>();
    const size = t.length;
    let head = '';
    let headStart: string | null = null;
    const single = squeeze(t);
    for (const [i, w] of this.sorted.entries()) {
      if (w === t) continue;
      const gap = Math.abs(w.length - size);
      if ((gap <= k && editDistance(t, w, k) <= k) || (gap <= 2 && this.squeezed[i] === single)) {
        found.set(w, (found.get(w) ?? 0) + this.words.get(w)! + 1e9);
        continue;
      }
      if (!starts || w.length <= size + 1) continue;
      // The start of a longer word, as `typoScore` of the ranking accepts it; one check per start.
      if (!w.startsWith(head) || head === '') {
        head = w.slice(0, size + 1);
        const row = startDistances(t, head);
        const len = [size, size + 1, size - 1].find((n) => n >= 4 && row[n]! <= k);
        headStart = len === undefined ? null : head.slice(0, len);
        if (headStart === t) headStart = null;
      }
      if (headStart) found.set(headStart, (found.get(headStart) ?? 0) + this.words.get(w)!);
    }
    const picked: string[] = [];
    // Whole words first (the 1e9), then by the number of products.
    for (const [c] of [...found].sort((a, b) => b[1] - a[1])) {
      if (picked.length >= MAX_CORRECTIONS) break;
      // "schokolade" already finds "schokoladen".
      if (!picked.some((p) => c.includes(p))) picked.push(c);
    }
    this.cache.set(cacheKey, picked);
    if (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
    return picked;
  }
}
