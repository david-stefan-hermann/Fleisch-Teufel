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

/**
 * Generic household measures offered for every food (BLS has no portion data).
 * Food-specific portions (OFF serving size, user-defined) are shown first.
 */
export const STANDARD_PORTIONS: readonly Portion[] = [
  { label: '100 g', grams: 100 },
  { label: '1 g', grams: 1 },
];

export const HOUSEHOLD_PORTIONS: readonly Portion[] = [
  { label: 'Teelöffel (TL)', grams: 5 },
  { label: 'Esslöffel (EL)', grams: 15 },
  { label: 'Tasse (150 ml)', grams: 150 },
  { label: 'Glas (200 ml)', grams: 200 },
  { label: 'Becher (250 ml)', grams: 250 },
  { label: 'Schale / Schüssel', grams: 300 },
];

/** Portions to offer for a food, de-duplicated by label, most specific first. */
export function portionsFor(
  food: Pick<Food, 'portions' | 'unit'>,
  userPortions: readonly Portion[] = [],
): Portion[] {
  const base: Portion[] =
    food.unit === 'ml'
      ? [
          { label: '100 ml', grams: 100 },
          { label: '1 ml', grams: 1 },
        ]
      : [...STANDARD_PORTIONS];
  const all = [...userPortions, ...food.portions, ...base, ...HOUSEHOLD_PORTIONS];
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
