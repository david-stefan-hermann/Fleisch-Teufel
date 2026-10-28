import { describe, expect, it } from 'vitest';
import { defaultPortion, piecePortionsFor, portionsFor, servingLabel } from '../src/index.js';

const bls = (sourceId: string, name: string, unit: 'g' | 'ml' = 'g') =>
  piecePortionsFor({ unit, name, source: 'bls', sourceId }).map((p) => p.label);

describe('piece portions of BLS foods', () => {
  it('fruit and vegetables count in pieces, processed forms do not', () => {
    expect(bls('F503100', 'Apfel roh')).toEqual(['Stück (150 g)']);
    expect(bls('F503100', 'Apfel geschält, roh')).toEqual(['Stück (150 g)']);
    expect(bls('F503200', 'Apfel getrocknet')).toEqual([]);
    expect(bls('F503300', 'Apfelsaft')).toEqual([]);
    expect(bls('F504000', 'Granatapfel roh')).toEqual([]);
    expect(bls('F110000', 'Banane roh')).toEqual(['Stück (120 g)']);
    expect(bls('F110100', 'Bananenchips frittiert, gesüßt')).toEqual([]);
    expect(bls('F210000', 'Erdbeere roh')).toEqual(['Stück (12 g)', 'Handvoll (80 g)']);
    expect(bls('F200000', 'Avocado roh')).toEqual(['Stück (200 g)', 'Hälfte (100 g)']);
    expect(bls('G100000', 'Tomate roh')).toEqual(['Stück (80 g)']);
    expect(bls('G100100', 'Tomate geschält, Konserve')).toEqual([]);
    expect(bls('G200000', 'Gurke roh')).toEqual(['Stück (400 g)', 'Scheibe (5 g)']);
    expect(bls('G200100', 'Gurke gesäuert (Gewürzgurke) abgetropft')).toEqual([]);
    expect(bls('G300000', 'Gemüsepaprika rot, roh')).toEqual(['Stück (150 g)']);
    expect(bls('G400000', 'Knoblauch roh')).toEqual(['Zehe (3 g)']);
    expect(bls('G400100', 'Knoblauch Pulver')).toEqual([]);
    expect(bls('K100000', 'Kartoffel geschält, roh')).toEqual(['Stück (80 g)']);
    expect(bls('K100100', 'Kartoffelpüree Instantpulver')).toEqual([]);
    expect(bls('K200000', 'Champignon roh')).toEqual(['Stück (15 g)']);
  });

  it('eggs, bread, cheese and cold cuts', () => {
    expect(bls('E100000', 'Hühnerei roh')).toEqual(['Stück (60 g)']);
    expect(bls('E100100', 'Hühnerei Eigelb, roh')).toEqual(['Stück (18 g)']);
    expect(bls('E100200', 'Hühnerei Pulver')).toEqual([]);
    expect(bls('B100000', 'Roggenvollkornbrot')).toEqual(['Scheibe (45 g)']);
    expect(bls('B100100', 'Weizenbrot/Weißbrot')).toEqual(['Scheibe (30 g)']);
    expect(bls('B300000', 'Weizentoastbrot/Buttertoastbrot')).toEqual(['Scheibe (25 g)']);
    expect(bls('B400000', 'Roggenvollkornknäckebrot')).toEqual(['Scheibe (10 g)']);
    expect(bls('B500000', 'Weizenbrötchen')).toEqual(['Stück (55 g)']);
    expect(bls('D100000', 'Croissant (Hefeblätterteig/Plunderteig)')).toEqual(['Stück (60 g)']);
    expect(bls('D200000', 'Butterkekse/Butterplätzchen (Mürbeteig)')).toEqual(['Stück (10 g)']);
    expect(bls('M100000', 'Schnittkäse mind. 45 % Fett i. Tr.')).toEqual(['Scheibe (25 g)']);
    expect(bls('M200000', 'Frischkäse aus Ziegenmilch, Natur, mind. 45 % Fett i. Tr.')).toEqual([]);
    expect(bls('M300000', 'Hüttenkäse')).toEqual([]);
    expect(bls('D300000', 'Käsekuchen')).toEqual([]);
    expect(bls('M400000', 'Mozzarella')).toEqual(['Kugel (125 g)']);
    expect(bls('W100000', 'Wiener Würstchen')).toEqual(['Stück (50 g)']);
    expect(bls('W200000', 'Bauernbratwurst/Westfälinger')).toEqual(['Stück (100 g)']);
    expect(bls('W300000', 'Geflügelsalami mit Pflanzenfett')).toEqual(['Scheibe (20 g)']);
    expect(bls('W400000', 'Delikatess Leberwurst/Feine Leberwurst/Gutsleberwurst')).toEqual([]);
    expect(bls('U100000', 'Schwein Rohschinken, mager, Rohpökelware, geräuchert')).toEqual([
      'Scheibe (20 g)',
    ]);
  });

  it('meat, fish, sweets, nuts and dishes', () => {
    expect(bls('U200000', 'Schwein Schnitzel (Nuss) roh')).toEqual(['Stück (150 g)']);
    expect(bls('U300000', 'Rind Filetsteak roh')).toEqual(['Stück (200 g)']);
    expect(bls('V100000', 'Hähnchenbrust ohne Haut, roh')).toEqual(['Stück (150 g)']);
    expect(bls('T100000', 'Fischstäbchen (Alaska-Seelachs) paniert, tiefgefroren')).toEqual(['Stück (30 g)']);
    expect(bls('T200000', 'Lachs roh')).toEqual(['Stück (150 g)']);
    expect(bls('T200100', 'Lachs geräuchert (Räucherlachs)')).toEqual([]);
    expect(bls('S100000', 'Vollmilchschokolade')).toEqual(['Stück (6 g)', 'Tafel (100 g)']);
    expect(bls('S100100', 'Schokoladeneis')).toEqual(['Kugel (50 g)']);
    expect(bls('S200000', 'Müsli-Riegel')).toEqual(['Riegel (40 g)']);
    expect(bls('S300000', 'Fruchtgummi (Gummibonbon)')).toEqual(['Stück (2,5 g)', 'Handvoll (30 g)']);
    expect(bls('H100000', 'Haselnuss')).toEqual(['Handvoll (30 g)']);
    expect(bls('H100100', 'Erdnussbutter/Erdnusscreme')).toEqual([]);
    expect(bls('H100200', 'Mandeldrink ungesüßt', 'ml')).toEqual([]);
    expect(bls('X100000', 'Pizza Margherita (mit Tomatensauce, Mozzarella)')).toEqual([
      'Ganze Pizza (350 g)',
      'Viertel (90 g)',
    ]);
    expect(bls('X100100', 'Hefeteig für Pizza/Pizzateig, roh')).toEqual([]);
    expect(bls('Y100000', 'Spaghetti Bolognese')).toEqual(['Portion (350 g)']);
    expect(bls('Y100100', 'Kartoffelsuppe mit Würstchen')).toEqual([]);
    expect(bls('X200000', 'Zwiebeln gebraten')).toEqual([]);
    expect(bls('C133000', 'Hafer Flocken')).toEqual([]);
  });

  it('only for BLS foods', () => {
    expect(piecePortionsFor({ unit: 'g', name: 'Banane', source: 'off', sourceId: '4000' })).toEqual([]);
    expect(piecePortionsFor({ unit: 'g', name: 'Banane roh' })).toEqual([]);
  });

  it('the piece is the default portion, before grams and household measures', () => {
    const banana = portionsFor({
      unit: 'g',
      name: 'Banane roh',
      source: 'bls',
      sourceId: 'F110000',
      portions: [],
    });
    expect(banana.map((p) => p.label)).toEqual(['Stück (120 g)', '100 g', '1 g']);
    expect(defaultPortion(banana)?.label).toBe('Stück (120 g)');
    const oats = portionsFor({
      unit: 'g',
      name: 'Hafer Flocken',
      source: 'bls',
      sourceId: 'C133000',
      portions: [],
    });
    expect(oats.map((p) => p.label)).toEqual(['100 g', '1 g', 'Esslöffel (EL)', 'Schale / Schüssel']);
    expect(defaultPortion(oats)).toBeNull();
    // Own portions first, a package is never the default.
    const bar = portionsFor({ unit: 'g', portions: [{ label: 'Packung (1 kg)', grams: 1000 }] }, [
      { label: 'Meine Scheibe', grams: 30 },
    ]);
    expect(defaultPortion(bar)?.label).toBe('Meine Scheibe');
    expect(
      defaultPortion(portionsFor({ unit: 'g', portions: [{ label: 'Packung (1 kg)', grams: 1000 }] })),
    ).toBeNull();
  });
});

describe('servingLabel (Open Food Facts)', () => {
  it('names the piece from the serving text, the weight from the data', () => {
    expect(servingLabel('1 Riegel (45g)', 45, 'g')).toBe('Riegel (45 g)');
    expect(servingLabel('1 Stück (6,5 g)', 6.5, 'g')).toBe('Stück (6,5 g)');
    expect(servingLabel('2 Scheiben (50 g)', 50, 'g')).toBe('2 Scheiben (50 g)');
    expect(servingLabel('2 slices (50 g)', 50, 'g')).toBe('2 Scheiben (50 g)');
    expect(servingLabel('1 slice', 25, 'g')).toBe('Scheibe (25 g)');
    expect(servingLabel('1 portion (125g)', 125, 'g')).toBe('Portion (125 g)');
    expect(servingLabel('250 ml (1 Glas)', 250, 'ml')).toBe('Glas (250 ml)');
    expect(servingLabel('30 g', 30, 'g')).toBe('Portion (30 g)');
    expect(servingLabel('100ml', 100, 'ml')).toBe('Portion (100 ml)');
    expect(servingLabel('', 30, 'g')).toBe('Portion (30 g)');
    expect(servingLabel(null, 30, 'g')).toBe('Portion (30 g)');
    expect(servingLabel('1 Becher', 150, 'g')).toBe('Becher (150 g)');
    expect(servingLabel('1 bottle (330 ml)', 330, 'ml')).toBe('Flasche (330 ml)');
  });
});
