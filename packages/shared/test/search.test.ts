import { describe, expect, it } from 'vitest';
import {
  indexItem,
  normalize,
  queryTerms,
  queryWords,
  search,
  searchKey,
  suggestQuery,
} from '../src/search.js';

const foods = [
  { id: '1', name: 'Hühnerei roh' },
  { id: '2', name: 'Hühnerei gekocht' },
  { id: '3', name: 'Eierteigwaren Tortelloni (Ricotta-Spinat-Füllung) getrocknet, gekocht' },
  { id: '4', name: 'Käse Gouda mind. 45 % Fett i. Tr.' },
  { id: '5', name: 'Vollmilch 3,5 % Fett, pasteurisiert' },
  { id: '6', name: 'Apfel roh' },
  { id: '7', name: 'Apfelkuchen (Rührteig)' },
  { id: '8', name: 'Kuchen mit Apfel und Streuseln' },
  { id: '9', name: 'Banana chips', nameEn: 'Banana chips', brand: 'Seeberger' },
  { id: '10', name: 'Hafer Flocken' },
  { id: '11', name: 'Haferflocken-Nussplätzchen' },
  { id: '12', name: 'Haferflocken gesüßt, mit Milch 3,5 % Fett und Fruchtmischung' },
].map(indexItem);

describe('search', () => {
  it('normalizes umlauts and punctuation', () => {
    expect(normalize('Käse (Gouda), 45 %')).toBe('kaese gouda 45');
    expect(normalize('Grüße')).toBe('gruesse');
    // Accents the table does not list are dropped instead of becoming spaces.
    expect(normalize('Crème brûlée')).toBe('creme brulee');
    expect(normalize('Smørrebrød à la Noël')).toBe('smorrebrod a la noel');
  });

  it('finds umlaut words typed with ae/oe/ue', () => {
    expect(search(foods, 'kaese')[0]!.item.id).toBe('4');
    expect(search(foods, 'hühnerei')[0]!.item.id).toBe('1');
  });

  it('ranks raw/generic items above prepared ones', () => {
    const ids = search(foods, 'Hühnerei').map((h) => h.item.id);
    expect(ids.slice(0, 2)).toEqual(['1', '2']);
  });

  it('ranks names starting with the term above names containing it', () => {
    const ids = search(foods, 'apfel').map((h) => h.item.id);
    expect(ids[0]).toBe('6');
    expect(ids.indexOf('7')).toBeLessThan(ids.indexOf('8'));
  });

  it('matches compound words and brands', () => {
    expect(search(foods, 'milch').map((h) => h.item.id)).toContain('5');
    expect(search(foods, 'seeberger')[0]!.item.id).toBe('9');
  });

  it('matches compounds written apart and together', () => {
    expect(search(foods, 'haferflocken')[0]!.item.id).toBe('10');
    expect(search(foods, 'hafer flocken')[0]!.item.id).toBe('10');
    expect(search(foods, 'haferflocken').map((h) => h.item.id)).toEqual(expect.arrayContaining(['11', '12']));
  });

  it('requires all tokens and ignores stop words', () => {
    expect(search(foods, 'apfel mit streuseln').map((h) => h.item.id)).toEqual(['8']);
    expect(search(foods, 'apfel banane')).toEqual([]);
    expect(search(foods, '   ')).toEqual([]);
  });
});

describe('search rules', () => {
  const items = [
    { id: 'quark', name: 'Speisequark Magerstufe' },
    { id: 'plunder', name: 'Quark-Plunder' },
    { id: 'bread', name: 'Roggenbrot mit Quark' },
    { id: 'kase', name: 'Käse' },
    { id: 'potato', name: 'Kartoffel roh' },
    { id: 'dish', name: 'Kartoffeln gekocht, mit Quark', source: 'bls', sourceId: 'Y771350' },
    { id: 'powder', name: 'Kartoffelpüree Instantpulver', source: 'bls', sourceId: 'K213000' },
    { id: 'mash', name: 'Kartoffelpüree mit Milch', source: 'bls', sourceId: 'X634012' },
    { id: 'joghurt', name: 'Joghurt mild' },
    { id: 'off', name: 'Skyr Natur', brand: 'Arla', source: 'off', popularity: 5000 },
    { id: 'meal', name: 'Sonntagsfrühstück', keywords: 'Brötchen Butter Marmelade', source: 'meal' },
  ].map(indexItem);
  const ids = (q: string) => search(items, q).map((h) => h.item.id);

  it('folds umlauts typed without the e', () => {
    expect(searchKey('Käse')).toBe('kase');
    expect(ids('kase')[0]).toBe('kase');
    expect(ids('kaese')[0]).toBe('kase');
  });

  it('ranks the head of a compound above a hyphen part and an ingredient', () => {
    expect(ids('quark')).toEqual(['quark', 'plunder', 'bread', 'dish']);
  });

  it('finds the singular for a plural', () => {
    expect(ids('kartoffeln')[0]).toBe('potato');
  });

  it('pushes dry products down unless asked for', () => {
    expect(ids('kartoffelpüree')).toEqual(['mash', 'powder']);
    expect(ids('kartoffelpüree pulver')).toEqual(['powder']);
  });

  it('finds typos, marked as fuzzy', () => {
    const [hit] = search(items, 'jogurt');
    expect(hit).toMatchObject({ item: { id: 'joghurt' }, fuzzy: true });
    expect(search(items, 'joghurt')[0]!.fuzzy).toBeUndefined();
  });

  it('searches brands and meal ingredients with less weight', () => {
    expect(ids('arla')).toEqual(['off']);
    expect(ids('butter')).toEqual(['meal']);
  });

  it('forgives typos in a brand', () => {
    const products = [
      { id: 'milsani', name: 'Skyr Natur', brand: 'Milsani', source: 'off' },
      { id: 'milka', name: 'Alpenmilch', brand: 'Milka', source: 'off' },
      { id: 'gg', name: 'Skyr', brand: 'GUT&GÜNSTIG', source: 'off' },
    ].map(indexItem);
    const found = (q: string, opts?: { allTypos?: boolean }) =>
      search(products, q, 50, undefined, opts).map((h) => (h.fuzzy ? `${h.item.id}~` : h.item.id));
    expect(found('milsni skyr')).toEqual(['milsani~']);
    expect(found('mikla')).toEqual(['milka~']);
    expect(found('skyr gut und günstg')).toEqual(['gg~']);
    // Four letters: a whole word one typo away, never the start of a longer one; doubled letters.
    expect(found('mlka')).toEqual(['milka~']);
    expect(found('mils')).toEqual(['milsani']);
    expect(found('mlis')).toEqual([]);
    expect(found('millka')).toEqual(['milka~']);
    expect(found('millsanni')).toEqual(['milsani~']);
    expect(suggestQuery([products], 'mlka')).toBeNull();
    expect(suggestQuery([products], 'milsni skyr')).toBe('Milsani skyr');
    // A word that matches something properly is no typo, unless the list was picked for the query.
    const more = [...products, indexItem({ id: 'junk', name: 'Milsni', source: 'off' })];
    expect(search(more, 'milsni').map((h) => h.item.id)).toEqual(['junk']);
    expect(search(more, 'milsni', 50, undefined, { allTypos: true }).map((h) => h.item.id)).toEqual([
      'junk',
      'milsani',
    ]);
  });

  it('reads "&", "und", "u", "and" and "n" as the same', () => {
    const products = [
      { id: 'gg', name: 'Gouda jung', brand: 'Gut & Günstig', source: 'off' },
      { id: 'fish', name: 'Fish & Chips', source: 'off' },
      { id: 'mac', name: "Mac 'n' Cheese", source: 'off' },
    ].map(indexItem);
    const found = (q: string) => search(products, q).map((h) => h.item.id);
    for (const q of ['gut & günstig', 'gut und günstig', 'gut u günstig', 'gut u. günstig', 'gut günstig'])
      expect(found(q), q).toEqual(['gg']);
    for (const q of ['fish and chips', 'fish & chips', 'fish n chips', 'fish und chips'])
      expect(found(q), q).toEqual(['fish']);
    expect(found('mac and cheese')).toEqual(['mac']);
    expect(found('mac & cheese')).toEqual(['mac']);
  });
});

describe('queryTerms', () => {
  it('keeps the words that count, as typed', () => {
    expect(queryTerms('Skyr - Gut und Günstig')).toEqual(['skyr', 'gut', 'günstig']);
    expect(queryTerms('gut & günstig skyr')).toEqual(['gut', 'günstig', 'skyr']);
    expect(queryWords('Skyr Gut&Günstig')).toEqual(['skyr', 'gut', 'gunstig']);
    expect(queryTerms(' & ')).toEqual([]);
  });

  it('drops a last word that is only the start of a stop word', () => {
    expect(queryTerms('skyr gut u')).toEqual(['skyr', 'gut']);
    expect(queryTerms('skyr gut un')).toEqual(['skyr', 'gut']);
    // Alone it is the whole query, and in the middle it is a word.
    expect(queryTerms('a')).toEqual(['a']);
    expect(queryTerms('a skyr')).toEqual(['a', 'skyr']);
    expect(queryTerms('gut u günstig')).toEqual(['gut', 'günstig']);
    expect(queryTerms('fish and chips')).toEqual(['fish', 'chips']);
  });
});
