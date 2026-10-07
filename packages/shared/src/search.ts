/**
 * Food search used identically on the device (offline BLS + cached foods) and on the server
 * (AI matching). Matching is token-prefix based and tolerant of umlaut spellings
 * ("Kaese" finds "Käse"), word order and punctuation.
 */

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
  'fuer',
  'auf',
]);

export interface Searchable {
  id: string;
  name: string;
  nameEn?: string | null;
  brand?: string | null;
}

export interface IndexedItem<T extends Searchable> {
  item: T;
  /** Normalized primary name. */
  norm: string;
  words: string[];
  /** Words of name + English name + brand. */
  allWords: string[];
  /** Name without spaces, for compounds written apart ("Hafer Flocken" ↔ "haferflocken"). */
  joined: string;
}

export function indexItem<T extends Searchable>(item: T): IndexedItem<T> {
  const norm = normalize(item.name);
  const words = norm ? norm.split(' ') : [];
  const extra = [...tokenize(item.nameEn ?? ''), ...tokenize(item.brand ?? '')];
  return { item, norm, words, allWords: [...words, ...extra], joined: words.join('') };
}

/** Raw state words in BLS names; plain/raw items should rank above prepared variants. */
const PREPARED =
  /\b(gebraten|gekocht|geduenstet|gedaempft|gebacken|geschmort|gegrillt|frittiert|konserve|tiefgefroren|zubereitet)\b/;

/**
 * Scores an item for the query tokens; 0 means no match. Every non-stop-word query token must
 * prefix-match a word (compound words: a token of ≥ 4 chars may also match inside a word,
 * e.g. "milch" in "vollmilch").
 */
export function scoreItem<T extends Searchable>(
  entry: IndexedItem<T>,
  queryTokens: readonly string[],
  queryNorm: string,
): number {
  const tokens = queryTokens.filter((t) => !STOP.has(t));
  if (tokens.length === 0) return 0;
  let score = 0;
  for (const [i, t] of tokens.entries()) {
    let best = 0;
    for (const [wi, w] of entry.allWords.entries()) {
      const inName = wi < entry.words.length;
      let s = 0;
      if (w === t) s = 30;
      else if (w.startsWith(t)) s = 20;
      else if (t.length >= 4 && w.includes(t)) s = 8;
      if (s === 0) continue;
      if (!inName) s *= 0.6;
      // Earlier words in the name matter more ("Apfel roh" vs "Kuchen mit Apfel").
      if (inName) s += Math.max(0, 6 - wi * 2);
      best = Math.max(best, s);
    }
    // Compound split across words: "haferflocken" in "hafer flocken …".
    if (best === 0 && t.length >= 5 && entry.joined.includes(t)) best = entry.joined.startsWith(t) ? 22 : 12;
    if (best === 0) return 0;
    score += i === 0 ? best * 1.5 : best;
  }
  const queryJoined = queryNorm.replace(/ /g, '');
  if (entry.norm === queryNorm || entry.joined === queryJoined) score += 60;
  else if (entry.norm.startsWith(queryNorm) || entry.joined.startsWith(queryJoined)) score += 25;
  // Shorter names are more generic ("Banane roh" before "Bananen-Milchshake mit Eis").
  score -= Math.min(20, entry.words.length * 1.5);
  if (!PREPARED.test(entry.norm)) score += 4;
  if (/\broh\b/.test(entry.norm)) score += 3;
  return score;
}

export function search<T extends Searchable>(
  index: readonly IndexedItem<T>[],
  query: string,
  limit = 50,
  boost?: (item: T) => number,
): { item: T; score: number }[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  const qn = tokens.join(' ');
  const hits: { item: T; score: number }[] = [];
  for (const e of index) {
    const s = scoreItem(e, tokens, qn);
    if (s > 0) hits.push({ item: e.item, score: s + (boost?.(e.item) ?? 0) });
  }
  hits.sort((a, b) => b.score - a.score || a.item.name.length - b.item.name.length);
  return hits.slice(0, limit);
}
