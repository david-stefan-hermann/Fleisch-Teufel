/**
 * Ranking quality on the real BLS 4.0 data: for everyday queries the food a person means must be
 * among the first three results. Each line came from a query that used to fail (round 9 search
 * review); add one whenever a real query ranks badly. Lives in the API tests because they have the
 * BLS file and Node; the search itself is the shared one the device uses.
 */
import { indexItem, search, searchKey, suggestQuery, SYNONYMS } from '@ft/shared';
import { describe, expect, it } from 'vitest';
import { blsToFood, loadBls } from '../src/foods/catalog.js';

/** The device searches the same names (compact file); ids here carry the "bls:" prefix. */
const index = loadBls().foods.map(blsToFood).map(indexItem);

/** Query → BLS codes (or code prefixes) of which one must be in the top three. */
const GOLD: [string, string[]][] = [
  // Basic foods.
  ['banane', ['F503100']],
  ['bananen', ['F503100']],
  ['apfel', ['F110100']],
  ['äpfel', ['F110100']],
  ['apfel roh', ['F110100']],
  ['tomate', ['G561100']],
  ['gurke', ['G520100']],
  ['spinat', ['G211100']],
  ['avocado', ['F502100']],
  ['lachs', ['T410100']],
  ['thunfisch', ['T121100']],
  ['tofu', ['H861000']],
  ['reis', ['C352000', 'C351000']],
  ['haferflocken', ['C133000']],
  ['zucker', ['S111000']],
  ['schokolade', ['S500000']],
  ['kaffee', ['N410100']],
  ['orangensaft', ['F603600']],
  ['erdnussbutter', ['H880200']],
  ['skyr', ['M710100']],
  ['olivenöl', ['Q120000']],
  ['butter', ['Q611000']],
  ['müsli', ['C512000']],
  ['gouda', ['M402']],
  ['mozzarella', ['M032100', 'M0A1000']],
  ['vollmilch 3,5', ['M111300']],
  ['milch', ['M111', 'M113', 'M114']],
  // Compound heads: "brot" is bread, not "Brotfrucht"; "öl" is oil, not "Quark-Öl-Teig".
  ['brot', ['B1', 'B2', 'B3', 'B7']],
  ['vollkornbrot', ['B101000']],
  ['salat', ['G105100', 'G103100', 'G107100']],
  ['paprika', ['G54']],
  ['zwiebel', ['G']],
  ['öl', ['Q120000', 'Q180000', 'Q320000']],
  // Basic foods before dishes and ingredient mentions ("Quark (Magerstufe) mit Konfitüre").
  ['käse', ['M402', 'M304']],
  ['quark', ['M713']],
  ['magerquark', ['M713100']],
  ['frischkäse', ['M710', 'M820']],
  ['joghurt', ['M141300', 'M1E3300', 'M141']],
  ['linsen', ['H725100', 'H730000']],
  ['erdbeeren', ['F301100']],
  ['karotten', ['G620100']],
  ['champignons', ['K701100']],
  ['hackfleisch', ['U010100', 'U020100', 'U030100']],
  ['rind hack', ['U010100']],
  // Plurals.
  ['kartoffel', ['K110100', 'K120100']],
  ['kartoffeln', ['K110100', 'K120100']],
  ['tomaten', ['G561100']],
  // Synonyms.
  ['ei', ['E111100']],
  ['eier', ['E111100']],
  ['hühnerei', ['E111100']],
  ['nudeln', ['E401000', 'E432000']],
  ['spaghetti', ['E401000', 'E432000']],
  ['hähnchen', ['V416100', 'V4A6100', 'V413000']],
  ['hühnchen', ['V416100', 'V4A6100', 'V413000']],
  ['hühnerbrust', ['V416100', 'V4A6100']],
  ['hähnchen brust', ['V416100', 'V4A6100']],
  ['putenbrust', ['V486100']],
  ['brötchen', ['B511000']],
  ['semmel', ['B511000']],
  ['cola', ['N330000', 'N340000']],
  ['wasser', ['N110000']],
  ['pilze', ['K701100']],
  ['brokkoli', ['G312100']],
  ['broccoli', ['G312100']],
  ['möhre', ['G620100']],
  // Umlauts without the e and typos.
  ['kase', ['M402', 'M304']],
  ['jogurt', ['M141']],
  ['hänchen', ['V416100', 'V4A6100', 'V413000']],
  // Dishes are found when asked for.
  ['kartoffelpüree', ['X634012', 'X639012']],
  ['rührei', ['Y720143']],
  ['spiegelei', ['Y710142']],
  ['pommes', ['X654042', 'K130200']],
  ['pizza', ['X912033']],
];

describe('search quality on BLS 4.0', () => {
  it.each(GOLD)('%s', (query, expected) => {
    const top = search(index, query, 3).map((h) => h.item.sourceId!);
    expect(
      top.some((id) => expected.some((e) => id.startsWith(e))),
      `${query}: ${top.join(', ')}`,
    ).toBe(true);
  });

  it('covers every synonym with a query that finds something', () => {
    for (const key of Object.keys(SYNONYMS)) {
      expect(search(index, key, 1), key).toHaveLength(1);
    }
  });

  it('keys the synonyms the way queries are folded', () => {
    for (const key of Object.keys(SYNONYMS)) expect(searchKey(key)).toMatch(/^[a-z]+$/);
  });

  it('suggests corrections for typos only', () => {
    expect(suggestQuery([index], 'jogurt')).toBe('Joghurt');
    expect(suggestQuery([index], 'mozarella')).toBe('Mozzarella');
    expect(suggestQuery([index], 'schokolde')).toBe('Schokolade');
    expect(suggestQuery([index], 'banane')).toBeNull();
    expect(suggestQuery([index], 'ei')).toBeNull();
  });

  it('stays fast enough for every keystroke', () => {
    const start = performance.now();
    for (const [q] of GOLD) search(index, q, 40);
    expect((performance.now() - start) / GOLD.length).toBeLessThan(40);
  });
});
