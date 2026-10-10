import { COMPACT_NUTRIENTS, completeNutrients, type NutrientMap } from './nutrients.js';
import type { CompactBlsRow, Food, Portion } from './schemas.js';

/**
 * BLS main food groups, keyed by the first letter of the BLS code.
 * BLS 4.0 ships no group table; labels follow the classic BLS systematics, checked against
 * the 4.0 data (e.g. `C131000` Hafer → C Getreide).
 */
export const BLS_GROUPS: Record<string, string> = {
  B: 'Brot & Kleingebäck',
  C: 'Getreide & Getreideprodukte',
  D: 'Backwaren, Kuchen & Kekse',
  E: 'Teigwaren, Eier & Knödel',
  F: 'Obst',
  G: 'Gemüse',
  H: 'Hülsenfrüchte, Nüsse & Samen',
  K: 'Kartoffeln & Pilze',
  M: 'Milch & Milchprodukte',
  N: 'Alkoholfreie Getränke',
  P: 'Alkoholische Getränke',
  Q: 'Fette & Öle',
  R: 'Würzmittel, Saucen & Backzutaten',
  S: 'Süßwaren & Zucker',
  T: 'Fisch & Meeresfrüchte',
  U: 'Fleisch',
  V: 'Geflügel, Wild & Innereien',
  W: 'Wurst & Fleischwaren',
  X: 'Gerichte, Suppen & Salate',
  Y: 'Gerichte & Menüs',
};

export function blsGroup(code: string): string | null {
  return BLS_GROUPS[code.charAt(0)] ?? null;
}

export const foodIds = {
  bls: (code: string) => `bls:${code}`,
  off: (ean: string) => `off:${ean}`,
};

/** Liquids by BLS group: drinks are logged in ml (1 ml ≈ 1 g; BLS values are per 100 g). */
export function blsUnit(code: string): 'g' | 'ml' {
  return code.startsWith('N') || code.startsWith('P') ? 'ml' : 'g';
}

/** Expands a compact BLS row (see `CompactBlsRow`) to a `Food`. */
export function foodFromCompactBls(row: CompactBlsRow, keys: readonly string[] = COMPACT_NUTRIENTS): Food {
  const [code, name, nameEn, ...values] = row;
  const nutrients: NutrientMap = {};
  keys.forEach((k, i) => {
    const v = values[i];
    if (v !== null && v !== undefined) nutrients[k] = v;
  });
  return {
    id: foodIds.bls(code),
    source: 'bls',
    sourceId: code,
    name,
    nameEn: nameEn || null,
    brand: null,
    group: blsGroup(code),
    unit: blsUnit(code),
    nutrients: completeNutrients(nutrients),
    portions: [],
  };
}

export const STANDARD_PORTIONS: readonly Portion[] = [
  { label: '100 g', grams: 100 },
  { label: '1 g', grams: 1 },
];

const TL: Portion = { label: 'Teelöffel (TL)', grams: 5 };
const EL: Portion = { label: 'Esslöffel (EL)', grams: 15 };
const TASSE: Portion = { label: 'Tasse (150 ml)', grams: 150 };
const GLAS: Portion = { label: 'Glas (200 ml)', grams: 200 };
const BECHER: Portion = { label: 'Becher (250 ml)', grams: 250 };
const SCHALE: Portion = { label: 'Schale / Schüssel', grams: 300 };

/** Generic household measures (BLS has no portion data). `householdPortionsFor` picks the fitting ones. */
export const HOUSEHOLD_PORTIONS: readonly Portion[] = [TL, EL, TASSE, GLAS, BECHER, SCHALE];

const SPOONS = [TL, EL];
const DRINK = [TL, EL, TASSE, GLAS, BECHER];

/**
 * Name words that tell which measures fit, checked in this order (first hit wins). Solid foods come
 * first so "Käsekuchen" or "Milchbrötchen" do not count as something spoonable.
 */
const NAME_RULES: readonly (readonly [RegExp, readonly Portion[]])[] = [
  [/frischkäse|hüttenkäse/, SPOONS],
  [/brot|brötchen|toast|kuchen|keks|riegel|käse|wurst|schinken|schokolade|bonbon|chips|pizza/, []],
  [/suppe|eintopf|brühe|bouillon/, [EL, TASSE, SCHALE]],
  [/saft|schorle|limonade|cola|wasser\b|tee\b|kaffee|smoothie|drink|getränk|bier\b|\bwein/, DRINK],
  [/joghurt|quark|skyr|pudding|kefir|sahne|schmand|crème|creme/, [TL, EL, BECHER]],
  [/milch\b|molke/, [EL, TASSE, GLAS, BECHER]],
  [/öl\b|essig|sirup|honig\b|zucker\b|konfitüre|marmelade|gelee|senf|ketchup|mayonnaise/, SPOONS],
  [
    /sauce|soße|dressing|pesto|mus\b|butter|margarine|schmalz|aufstrich|gewürz|salz\b|pulver|kakao|mehl/,
    SPOONS,
  ],
  [
    /müsli|flocken|flakes|granola|porridge|reis\b|grieß|couscous|bulgur|quinoa|linsen|bohnen|erbsen/,
    [EL, SCHALE],
  ],
  [/nüsse|nuss\b|mandeln|kerne|samen|rosinen/, [EL]],
  [/salat|ragout|gulasch|curry|auflauf|risotto|chili|kompott/, [EL, SCHALE]],
];

/** Measures by BLS main group (first letter of the code), unless a name word says otherwise. */
const GROUP_RULES: Record<string, readonly Portion[]> = {
  N: DRINK,
  P: DRINK,
  Q: SPOONS,
  R: SPOONS,
  C: [EL, SCHALE],
  H: [EL, SCHALE],
  X: [EL, SCHALE],
  Y: [EL, SCHALE],
};

/**
 * Household measures that make sense for a food: no cup for toast, no bowl for oil. Decided by the
 * name words, then the BLS group, then the unit (anything in ml is a drink). A food that matches
 * nothing gets none; grams, its own portions and user portions are always there (`portionsFor`).
 */
export function householdPortionsFor(
  food: Pick<Food, 'unit'> & Partial<Pick<Food, 'name' | 'source' | 'sourceId'>>,
): readonly Portion[] {
  const name = food.name?.toLowerCase() ?? '';
  const byName = name ? NAME_RULES.find(([words]) => words.test(name)) : undefined;
  // A drink stays a drink ("Kakaogetränk" in ml is not a powder).
  if (food.unit === 'ml') return byName && byName[1].includes(TASSE) ? byName[1] : DRINK;
  if (byName) return byName[1];
  const group = food.source === 'bls' ? GROUP_RULES[food.sourceId?.charAt(0) ?? ''] : undefined;
  return group ?? [];
}

/**
 * Portions to offer for a food, de-duplicated by label, most specific first: user portions, the
 * food's own (OFF serving size), the base units, then the fitting household measures.
 */
export function portionsFor(
  food: Pick<Food, 'portions' | 'unit'> & Partial<Pick<Food, 'name' | 'source' | 'sourceId'>>,
  userPortions: readonly Portion[] = [],
): Portion[] {
  const base: Portion[] =
    food.unit === 'ml'
      ? [
          { label: '100 ml', grams: 100 },
          { label: '1 ml', grams: 1 },
        ]
      : [...STANDARD_PORTIONS];
  const all = [...userPortions, ...food.portions, ...base, ...householdPortionsFor(food)];
  const seen = new Set<string>();
  return all.filter((p) => {
    const key = p.label.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Parses free-form serving sizes such as "30 g", "1 Riegel (45g)", "250ml", "2 Scheiben (50 g)".
 * Returns grams (ml treated as g) or null.
 */
export function parseServingGrams(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = /(\d+(?:[.,]\d+)?)\s*(kg|g|gr|gramm|ml|cl|l)\b/i.exec(text);
  if (!m) return null;
  const value = Number.parseFloat(m[1]!.replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = m[2]!.toLowerCase();
  const factor = unit === 'kg' || unit === 'l' ? 1000 : unit === 'cl' ? 10 : 1;
  return value * factor;
}
