import { describe, expect, it } from 'vitest';
import { indexItem, normalize, search } from '../src/search.js';

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
