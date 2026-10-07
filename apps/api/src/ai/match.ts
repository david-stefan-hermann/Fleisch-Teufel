/**
 * Maps AI-recognized items to database foods. Each search term is looked up locally
 * (BLS + cached OFF); earlier (more specific) terms weigh more, and the preparation word
 * boosts candidates that contain it ("gebraten" → "… gebraten ohne Fett"). BLS is preferred
 * for unpackaged foods because its values are analytical; packaged items prefer OFF.
 */
import { normalize, type AiCandidate, type AiItem, type Food } from '@ft/shared';

export type LocalSearch = (query: string, limit: number) => { food: Food; score: number }[];

export function matchItem(item: AiItem, searchLocal: LocalSearch, maxCandidates = 5): AiCandidate[] {
  const terms = [...new Set([...item.searchTerms, item.name].map((t) => t.trim()).filter(Boolean))].slice(
    0,
    6,
  );
  const prep = item.preparation ? normalize(item.preparation) : null;
  const best = new Map<string, AiCandidate>();
  terms.forEach((term, i) => {
    const weight = 1 - i * 0.12;
    for (const { food, score } of searchLocal(term, 15)) {
      let s = score * weight;
      const norm = normalize(food.name);
      if (prep && norm.includes(prep)) s += 12;
      if (food.source === 'bls' && !item.packaged) s += 6;
      if (food.source === 'off' && item.packaged) s += 6;
      const prev = best.get(food.id);
      if (!prev || prev.score < s) best.set(food.id, { food, score: Math.round(s * 10) / 10 });
    }
  });
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, maxCandidates);
}
