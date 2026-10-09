/**
 * Maps AI-recognized items to database foods. Each search term is looked up locally
 * (BLS + cached OFF); earlier (more specific) terms weigh more, and the preparation word
 * boosts candidates that contain it ("gebraten" → "… gebraten ohne Fett"). BLS is preferred
 * for unpackaged foods because its values are analytical; packaged items prefer OFF.
 *
 * The model's grams are always the food as eaten. A dry or instant product ("Kartoffelpüree
 * Instantpulver", 329 kcal per 100 g) would multiply them with the values of the powder, so such
 * candidates are pushed down unless the item itself is the dry product ("Proteinpulver").
 */
import { normalize, type AiCandidate, type AiItem, type Food } from '@ft/shared';

export type LocalSearch = (query: string, limit: number) => { food: Food; score: number }[];

/**
 * Words of BLS (and OFF) names for foods sold dry or concentrated, not as eaten. "trocken" alone is
 * not in the list: it also names dry wine.
 */
export const DRY_WORDS = ['pulver', 'instant', 'trockenprodukt', 'konzentrat', 'granulat'] as const;
/** Words that mark a dry product as prepared ("Bratensoße aus Instantpulver, zubereitet mit Wasser"). */
export const PREPARED_WORDS = ['zubereitet', 'eingeweicht', 'getraenk'] as const;
/** Score penalty of a dry product for an item eaten prepared; larger than the BLS and prep boosts. */
export const DRY_PENALTY = 30;
/** Small boost of a prepared variant for an unpackaged item (home-made or plated food). */
export const PREPARED_BOOST = 3;

/** The dry words of a normalized food name, or none when the name says it is prepared. */
function dryWords(norm: string): string[] {
  if (PREPARED_WORDS.some((w) => norm.includes(w))) return [];
  return DRY_WORDS.filter((w) => norm.includes(w));
}

export function matchItem(item: AiItem, searchLocal: LocalSearch, maxCandidates = 5): AiCandidate[] {
  const terms = [...new Set([...item.searchTerms, item.name].map((t) => t.trim()).filter(Boolean))].slice(
    0,
    6,
  );
  const prep = item.preparation ? normalize(item.preparation) : null;
  // The item asks for the dry product itself when its own name or terms carry the word.
  const asked = normalize([item.name, ...item.searchTerms].join(' '));
  const best = new Map<string, AiCandidate>();
  terms.forEach((term, i) => {
    const weight = 1 - i * 0.12;
    for (const { food, score } of searchLocal(term, 15)) {
      let s = score * weight;
      const norm = normalize(food.name);
      if (prep && norm.includes(prep)) s += 12;
      if (food.source === 'bls' && !item.packaged) s += 6;
      if (food.source === 'off' && item.packaged) s += 6;
      if (dryWords(norm).some((w) => !asked.includes(w))) s -= DRY_PENALTY;
      else if (!item.packaged && PREPARED_WORDS.some((w) => norm.includes(w))) s += PREPARED_BOOST;
      const prev = best.get(food.id);
      if (!prev || prev.score < s) best.set(food.id, { food, score: Math.round(s * 10) / 10 });
    }
  });
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, maxCandidates);
}
