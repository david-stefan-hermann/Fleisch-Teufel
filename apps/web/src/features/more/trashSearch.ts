import { searchKey } from '@ft/shared';

/**
 * Search of the trash: every word of the query must appear in the row's texts, folded like the food
 * search (`searchKey`: case, umlauts, punctuation), so "kase" finds "Käse" and "12.11" a weight of that day.
 * An empty query matches every row.
 */
export function matchesTrash(query: string, texts: readonly string[]): boolean {
  const words = searchKey(query).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const haystack = texts.map(searchKey).join(' | ');
  return words.every((w) => haystack.includes(w));
}
