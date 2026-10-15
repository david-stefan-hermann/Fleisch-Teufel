/**
 * Food search used identically on the device (offline BLS + own and cached foods + meals) and on
 * the server (OFF results, AI matching).
 *
 * Matching follows the usual search-engine rules (every query word must match, word order does not
 * matter, an exact word beats a word start beats a word end beats the inside of a word) and adds
 * what German food names need:
 * - umlauts fold both ways ("kase", "kaese" and "käse" are the same word);
 * - light stemming ("kartoffeln" finds "Kartoffel", "tomaten" finds "Tomate");
 * - compounds carry their head at the end: "brot" finds "Vollkornbrot" as bread, while "Brotfrucht"
 *   only starts with it; in hyphenated names ("Käse-Grießnockerl") the last part is the head;
 * - a typo of one letter (from 5 letters on, two from 9 on) still finds the word, ranked lower;
 * - synonyms for everyday words the databases spell differently (`synonyms.ts`).
 * Ranking then prefers basic foods over dishes, unprepared over prepared, short over long names and
 * pushes dry products ("Instantpulver") down unless the query asks for them.
 */
import { SYNONYMS } from './synonyms.js';

const FOLD: Record<string, string> = {
  ä: 'ae',
  ö: 'oe',
  ü: 'ue',
  ß: 'ss',
  é: 'e',
  è: 'e',
  ê: 'e',
  á: 'a',
  à: 'a',
  â: 'a',
  ó: 'o',
  ô: 'o',
  í: 'i',
  ñ: 'n',
  ç: 'c',
};

/** Lower-case, umlauts folded (ä → ae), everything else non-alphanumeric becomes a space. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[äöüßéèêáàâóôíñç]/g, (c) => FOLD[c] ?? c)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function tokenize(text: string): string[] {
  const n = normalize(text);
  return n ? n.split(' ') : [];
}

/**
 * The form words are compared in: `normalize`, then "ae"/"oe"/"ue" → "a"/"o"/"u", so umlauts typed
 * without the e ("kase") meet the ones typed with it ("kaese", "käse").
 */
export function searchKey(text: string): string {
  return normalize(text).replace(/([aou])e/g, '$1');
}

function keyWords(text: string): string[] {
  const k = searchKey(text);
  return k ? k.split(' ') : [];
}

/** Words that carry no meaning for ranking. */
const STOP = new Set([
  'mit',
  'und',
  'ohne',
  'in',
  'aus',
  'vom',
  'von',
  'der',
  'die',
  'das',
  'im',
  'am',
  'zu',
  'fur',
  'auf',
]);

/** Words of BLS names that only specify a variant; they do not make a name longer for ranking. */
const SPEC = new Set([
  'fett',
  'i',
  'tr',
  'mind',
  'max',
  'hochstens',
  'frisch',
  'pasteurisiert',
  'ultrahocherhitzt',
  'roh',
]);

/** Stop words that do not start the ingredient part of a name ("Hähnchen Brust, ohne Haut"). */
const NOT_INGREDIENTS = new Set(['ohne', 'der', 'die', 'das']);

const ENDINGS = ['en', 'er', 'es', 'e', 'n', 's'];

/** Light German stemming: plural and inflection endings off, words under 5 letters stay. */
export function stem(word: string): string {
  if (word.length < 5) return word;
  for (const e of ENDINGS) {
    if (word.endsWith(e) && word.length - e.length >= 4) return word.slice(0, -e.length);
  }
  return word;
}

export interface Searchable {
  id: string;
  name: string;
  nameEn?: string | null;
  brand?: string | null;
  /** More searchable text, weighted like the English name (ingredient names of a meal). */
  keywords?: string | null;
  source?: string;
  /** BLS code for BLS foods; its first letter is the group (X and Y are dishes). */
  sourceId?: string | null;
  /** How many people scanned the product (Open Food Facts); ranks popular products a bit higher. */
  popularity?: number | null;
}

/** What a search result is: a basic food, a dish (BLS groups X and Y), a branded product, own. */
export type SearchKind = 'base' | 'dish' | 'brand' | 'own';

export function searchKind(item: Searchable): SearchKind {
  if (item.source === 'custom' || item.source === 'meal') return 'own';
  if (item.source === 'off') return 'brand';
  const group = item.sourceId?.charAt(0);
  return item.source === 'bls' && (group === 'X' || group === 'Y') ? 'dish' : 'base';
}

/**
 * How a word of an item counts: `name` a main word of the name; `hyphenHead` the last part of a
 * hyphenated compound ("Brot" in "Russisch-Brot": a head, but not the word itself); `minor` counts
 * less (first parts of hyphenated compounds, ingredients after "mit", English name, brand).
 */
type Role = 'name' | 'hyphenHead' | 'minor';

interface IndexedWord {
  w: string;
  s: string;
  /** Position among the name words (position bonus); -1 outside the name. */
  pos: number;
  role: Role;
}

export interface IndexedItem<T extends Searchable> {
  item: T;
  /** Normalized primary name (`normalize`). */
  norm: string;
  /** Folded primary name (`searchKey`). */
  key: string;
  words: IndexedWord[];
  /** Name words without spaces, for compounds written apart ("Hafer Flocken" ↔ "haferflocken"). */
  joined: string;
  /** Name words that count for the length penalty. */
  length: number;
  kind: SearchKind;
  /** Score adjustments that do not depend on the query. */
  bonus: number;
  /** The name is a dry or concentrated product; the dry word, or null. */
  dry: string | null;
}

/** Raw state words in BLS names; plain/raw items should rank above prepared variants. */
const PREPARED =
  /\b(gebraten|gekocht|gedunstet|gedampft|gebacken|geschmort|gegrillt|frittiert|konserve|tiefgefroren|zubereitet)\b/;
/** Words of foods sold dry or concentrated, not as eaten ("Kartoffelpüree Instantpulver"). */
const DRY = ['pulver', 'instant', 'trockenprodukt', 'konzentrat', 'granulat'];
/** A dry product that says it is prepared ("… aus Instantpulver, zubereitet mit Wasser"). */
const DRY_PREPARED = /zubereitet|eingeweicht|getrank/;

function staticBonus(item: Searchable, key: string, kind: SearchKind, length: number): number {
  let b = -Math.min(8, length);
  if (!PREPARED.test(key)) b += 4;
  if (/\broh\b/.test(key)) b += 3;
  // BLS innards (V5, V6) after the meat: "Hähnchen" means the meat, not the heart.
  if (item.source === 'bls' && /^V[56]/.test(item.sourceId ?? '')) b -= 6;
  if (kind === 'brand') b += 3 + Math.min(8, Math.log10((item.popularity ?? 0) + 1) * 3);
  return b;
}

export function indexItem<T extends Searchable>(item: T): IndexedItem<T> {
  const norm = normalize(item.name);
  const key = searchKey(item.name);
  const words: IndexedWord[] = [];
  let pos = 0;
  let ingredients = false;
  // Chunks split at anything but letters, digits and hyphens; hyphens join compounds.
  for (const chunk of item.name.split(/[^\p{L}\p{N}-]+/u)) {
    const parts = chunk.split('-').flatMap(keyWords);
    if (parts.length === 0) continue;
    if (parts.length === 1 && STOP.has(parts[0]!)) {
      if (!NOT_INGREDIENTS.has(parts[0]!)) ingredients = true;
      pos++;
      continue;
    }
    const start = pos;
    parts.forEach((w, i) => {
      const role = ingredients || i < parts.length - 1 ? 'minor' : parts.length > 1 ? 'hyphenHead' : 'name';
      words.push({ w, s: stem(w), pos: ingredients ? -1 : pos, role });
      pos++;
    });
    if (parts.length > 1) {
      const whole = parts.join('');
      words.push({
        w: whole,
        s: stem(whole),
        pos: ingredients ? -1 : start,
        role: ingredients ? 'minor' : 'name',
      });
    }
  }
  for (const w of [item.nameEn, item.brand, item.keywords].flatMap((t) => keyWords(t ?? ''))) {
    words.push({ w, s: stem(w), pos: -1, role: 'minor' });
  }
  const plain = key.split(' ').filter(Boolean);
  const length = plain.filter((w) => !STOP.has(w) && !SPEC.has(w) && !/^\d+$/.test(w)).length;
  const kind = searchKind(item);
  return {
    item,
    norm,
    key,
    words,
    joined: plain.join(''),
    length,
    kind,
    bonus: staticBonus(item, key, kind, length),
    dry: DRY_PREPARED.test(key) ? null : (DRY.find((d) => key.includes(d)) ?? null),
  };
}

/** Points of one query word against one word (0: no match). */
function matchWord(t: string, ts: string, w: string, ws: string): number {
  if (w === t) return 30;
  if (ts.length >= 3 && ws === ts) return 29;
  const pre = w.startsWith(t) ? t.length : ts.length >= 3 && w.startsWith(ts) ? ts.length : 0;
  if (pre > 0) {
    // While typing every word start counts; a whole word at the start of a compound only names
    // what it is made of ("Brotfrucht", "Bananenquark").
    return t.length <= 3 || w.length - pre <= 2 ? 20 : 14;
  }
  // The head of a compound: "Vollkornbrot" is bread.
  if (t.length >= 3 && w.length - t.length >= 3 && (w.endsWith(t) || (ts.length >= 3 && ws.endsWith(ts)))) {
    return 24;
  }
  if (t.length >= 4 && w.includes(t)) return 8;
  return 0;
}

/** Optimal string alignment distance (Damerau-Levenshtein without repeated edits), capped at max + 1. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        v = Math.min(v, prev2[j - 2]! + 1);
      cur.push(v);
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length]!;
}

/** Allowed typos for a query word: one from 5 letters, two from 9. */
function typoBudget(t: string): number {
  return t.length >= 9 ? 2 : t.length >= 5 ? 1 : 0;
}

/** Points of a query word that is a typo of this word: whole word 12, start of a longer word 8. */
function typoScore(t: string, w: string, k: number): number {
  if (editDistance(t, w, k) <= k) return 12;
  if (w.length <= t.length) return 0;
  for (const len of [t.length, t.length + 1, t.length - 1]) {
    if (len >= 4 && len < w.length && editDistance(t, w.slice(0, len), k) <= k) return 8;
  }
  return 0;
}

/** Distinct name words of an index with their stem and the spelling of their first occurrence. */
type Vocabulary = Map<string, { s: string; display: string }>;
const vocabularies = new WeakMap<readonly IndexedItem<Searchable>[], Vocabulary>();

function vocabulary(index: readonly IndexedItem<Searchable>[]): Vocabulary {
  let v = vocabularies.get(index);
  if (!v) {
    v = new Map();
    for (const e of index) {
      let display: string[] | null = null;
      for (const w of e.words) {
        if (w.pos < 0 || v.has(w.w)) continue;
        display ??= e.item.name.split(/[^\p{L}\p{N}]+/u);
        v.set(w.w, { s: w.s, display: display.find((d) => searchKey(d) === w.w) ?? w.w });
      }
    }
    vocabularies.set(index, v);
  }
  return v;
}

/** A query word matches some word of the index properly (not only inside a word). */
function hasMatch(vocab: Vocabulary, t: string): boolean {
  const ts = stem(t);
  for (const [w, { s }] of vocab) if (matchWord(t, ts, w, s) >= 14) return true;
  return false;
}

/** The index words a query word may be a typo of, with their points; null when it matches properly. */
function typosOf(vocab: Vocabulary, t: string): Map<string, number> | null {
  const k = typoBudget(t);
  if (k === 0 || hasMatch(vocab, t)) return null;
  const typos = new Map<string, number>();
  for (const w of vocab.keys()) {
    const s = typoScore(t, w, k);
    if (s > 0) typos.set(w, s);
  }
  return typos.size > 0 ? typos : null;
}

const SYNONYM_KEYS = new Map(
  Object.entries(SYNONYMS).map(([k, v]) => [searchKey(k), v.map((p) => keyWords(p))] as const),
);

interface QueryWord {
  t: string;
  ts: string;
  typos: Map<string, number> | null;
}

interface QueryVariant {
  words: QueryWord[];
  key: string;
  joined: string;
  /** Synonym variant: its score counts a little less. */
  factor: number;
}

interface PreparedQuery {
  variants: QueryVariant[];
  /** Number of words the person typed (without stop words). */
  size: number;
  key: string;
}

function prepareQuery(index: readonly IndexedItem<Searchable>[], query: string): PreparedQuery | null {
  const tokens = keyWords(query).filter((t) => !STOP.has(t));
  if (tokens.length === 0) return null;
  const vocab = vocabulary(index);
  const typoCache = new Map<string, Map<string, number> | null>();
  const word = (t: string): QueryWord => {
    if (!typoCache.has(t)) typoCache.set(t, typosOf(vocab, t));
    return { t, ts: stem(t), typos: typoCache.get(t)! };
  };
  const variant = (ts: string[], factor: number): QueryVariant => ({
    words: ts.map(word),
    key: ts.join(' '),
    joined: ts.join(''),
    factor,
  });
  const variants = [variant(tokens, 1)];
  tokens.forEach((t, i) => {
    for (const phrase of SYNONYM_KEYS.get(t) ?? []) {
      if (variants.length < 8)
        variants.push(variant([...tokens.slice(0, i), ...phrase, ...tokens.slice(i + 1)], 0.95));
    }
  });
  return { variants, size: tokens.length, key: tokens.join(' ') };
}

export interface ScoreDetail {
  score: number;
  /** At least one query word matched only as a typo. */
  fuzzy: boolean;
}

const NO_MATCH: ScoreDetail = { score: 0, fuzzy: false };

function scoreVariant<T extends Searchable>(entry: IndexedItem<T>, v: QueryVariant): ScoreDetail {
  let score = 0;
  let fuzzy = false;
  let leads = false;
  for (const [i, { t, ts, typos }] of v.words.entries()) {
    let best = 0;
    let bestPos = -1;
    for (const w of entry.words) {
      let s = matchWord(t, ts, w.w, w.s);
      if (s === 0) continue;
      if (w.role === 'minor') s *= 0.6;
      else {
        if (w.role === 'hyphenHead') s = Math.min(s, 24);
        s += Math.max(0, 4 - w.pos * 2);
      }
      if (s > best) {
        best = s;
        bestPos = w.role === 'minor' ? -1 : w.pos;
      }
    }
    // Compound split across words: "haferflocken" in "hafer flocken …".
    if (best === 0 && t.length >= 5 && entry.joined.includes(t)) best = entry.joined.startsWith(t) ? 22 : 12;
    if (best === 0 && typos) {
      for (const w of entry.words) {
        const s = typos.get(w.w);
        if (s) best = Math.max(best, w.role === 'minor' ? s * 0.6 : s);
      }
      if (best > 0) fuzzy = true;
    }
    if (best === 0) return NO_MATCH;
    if (i === 0) {
      score += best * 1.5;
      // The name starts with the first query word ("Apfel roh" for "apfel", not "Kuchen mit Apfel").
      leads = bestPos === 0 && best >= 29;
    } else score += best;
  }
  if (entry.key === v.key || entry.joined === v.joined) score += 60;
  else if (leads) score += 10;
  return { score, fuzzy };
}

/** Scores an item for a prepared query; 0 means no match. */
function scoreItem<T extends Searchable>(entry: IndexedItem<T>, q: PreparedQuery): ScoreDetail {
  let best = NO_MATCH;
  for (const v of q.variants) {
    const r = scoreVariant(entry, v);
    if (r.score === 0) continue;
    const score = r.score * v.factor;
    if (score > best.score) best = { score, fuzzy: r.fuzzy };
  }
  if (best.score === 0) return NO_MATCH;
  let score = best.score + entry.bonus;
  if (entry.dry && !q.key.includes(entry.dry)) score -= 20;
  if (entry.kind === 'dish') score -= q.size > 1 ? 5 : 15;
  // Every match stays a result, however low its points.
  return { score: Math.max(score, 0.1), fuzzy: best.fuzzy };
}

export interface SearchHit<T> {
  item: T;
  score: number;
  /** Found only through a typo ("jogurt" → "Joghurt"). */
  fuzzy?: boolean;
}

/** BLS codes of a food in its basic state end in 00 ("F503100" Banane roh). */
function basicState(item: Searchable): number {
  return item.source === 'bls' && item.sourceId?.endsWith('00') ? 0 : 1;
}

export function search<T extends Searchable>(
  index: readonly IndexedItem<T>[],
  query: string,
  limit = 50,
  boost?: (item: T) => number,
): SearchHit<T>[] {
  const q = prepareQuery(index, query);
  if (!q) return [];
  const hits: SearchHit<T>[] = [];
  for (const e of index) {
    const { score, fuzzy } = scoreItem(e, q);
    if (score > 0) {
      const hit: SearchHit<T> = { item: e.item, score: score + (boost?.(e.item) ?? 0) };
      if (fuzzy) hit.fuzzy = true;
      hits.push(hit);
    }
  }
  hits.sort(
    (a, b) =>
      b.score - a.score || basicState(a.item) - basicState(b.item) || a.item.name.length - b.item.name.length,
  );
  return hits.slice(0, limit);
}

/**
 * The query with its typos corrected ("jogurt" → "Joghurt"), or null when every word matches
 * something in one of the indexes or there is no correction.
 */
export function suggestQuery(
  indexes: readonly (readonly IndexedItem<Searchable>[])[],
  query: string,
): string | null {
  const vocabs = indexes.map(vocabulary);
  let changed = false;
  const out = keyWords(query).map((t) => {
    const k = typoBudget(t);
    if (k === 0 || STOP.has(t) || SYNONYM_KEYS.has(t) || vocabs.some((v) => hasMatch(v, t))) return t;
    let best: { w: string; display: string; d: number } | null = null;
    for (const vocab of vocabs) {
      for (const [w, { display }] of vocab) {
        if (Math.abs(w.length - t.length) > k) continue;
        const d = editDistance(t, w, k);
        if (d <= k && (!best || d < best.d || (d === best.d && w.length < best.w.length))) {
          best = { w, display, d };
        }
      }
    }
    if (!best) return t;
    changed = true;
    return best.display;
  });
  return changed ? out.join(' ') : null;
}
