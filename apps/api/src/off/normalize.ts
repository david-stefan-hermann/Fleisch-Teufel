/**
 * Open Food Facts product → `Food` (per 100 g/ml, BLS nutrient codes).
 * OFF data © Open Food Facts contributors, Open Database License (ODbL).
 */
import {
  completeNutrients,
  foodIds,
  N,
  parseServingGrams,
  round,
  type Food,
  type NutrientMap,
  type Portion,
} from '@ft/shared';

export interface OffProduct {
  code?: string;
  product_name?: string;
  product_name_de?: string;
  generic_name_de?: string;
  brands?: string | string[];
  quantity?: string;
  serving_size?: string;
  serving_quantity?: number | string;
  product_quantity?: number | string;
  product_quantity_unit?: string;
  nutrition_data_per?: string;
  image_front_small_url?: string;
  nutriments?: Record<string, unknown>;
}

/** OFF nutriment key → [BLS code, factor from OFF's per-100g unit to the BLS unit]. */
const MAP: Record<string, [string, number]> = {
  'energy-kcal': [N.kcal, 1],
  'energy-kj': [N.kj, 1],
  proteins: [N.protein, 1],
  fat: [N.fat, 1],
  carbohydrates: [N.carbs, 1],
  fiber: [N.fiber, 1],
  sugars: [N.sugar, 1],
  'saturated-fat': [N.satFat, 1],
  salt: [N.salt, 1],
  sodium: [N.sodium, 1000], // OFF: g/100 g, BLS: mg/100 g
  alcohol: [N.alcohol, 0.789], // OFF: % vol → g/100 ml (ethanol density 0.789 g/ml)
  cholesterol: ['CHORL', 1000],
  'vitamin-c': ['VITC', 1000],
  calcium: ['CA', 1000],
  iron: ['FE', 1000],
  potassium: ['K', 1000],
  magnesium: ['MG', 1000],
  'monounsaturated-fat': ['FAMS', 1],
  'polyunsaturated-fat': ['FAPU', 1],
};

function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number.parseFloat(v.replace(',', '.')) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function offNutrients(nutriments: Record<string, unknown> | undefined): NutrientMap {
  const out: NutrientMap = {};
  if (!nutriments) return out;
  for (const [offKey, [code, factor]] of Object.entries(MAP)) {
    const v = num(nutriments[`${offKey}_100g`]);
    if (v !== undefined) out[code] = round(v * factor, 4);
  }
  // Older products only carry `energy_100g` in kJ.
  if (out[N.kcal] === undefined && out[N.kj] === undefined) {
    const e = num(nutriments.energy_100g);
    if (e !== undefined) out[N.kj] = e;
  }
  return completeNutrients(out);
}

function brandOf(p: OffProduct): string | null {
  const b = Array.isArray(p.brands) ? p.brands[0] : p.brands?.split(',')[0];
  return b?.trim() || null;
}

export function normalizeOffProduct(p: OffProduct): Food | null {
  const code = p.code?.trim();
  if (!code || !/^\d{6,14}$/.test(code)) return null;
  const name = (p.product_name_de || p.product_name || p.generic_name_de || '').trim();
  const nutrients = offNutrients(p.nutriments);
  if (!name || nutrients[N.kcal] === undefined) return null;

  const unit: 'g' | 'ml' =
    /ml|cl|\bl\b/i.test(p.product_quantity_unit ?? '') || /\d\s*(ml|cl|l)\b/i.test(p.quantity ?? '')
      ? 'ml'
      : 'g';
  const portions: Portion[] = [];
  const serving = num(p.serving_quantity) ?? parseServingGrams(p.serving_size);
  if (serving && serving > 0 && serving < 5000) {
    const label = p.serving_size?.trim()
      ? `Portion (${p.serving_size.trim()})`
      : `Portion (${round(serving, 1)} ${unit})`;
    portions.push({ label: label.slice(0, 80), grams: round(serving, 2) });
  }
  const pkg = num(p.product_quantity) ?? parseServingGrams(p.quantity);
  if (pkg && pkg > 0 && pkg < 20_000 && pkg !== serving) {
    portions.push({
      label: `Packung (${p.quantity?.trim() || `${round(pkg, 0)} ${unit}`})`.slice(0, 80),
      grams: round(pkg, 2),
    });
  }

  return {
    id: foodIds.off(code),
    source: 'off',
    sourceId: code,
    name: name.slice(0, 200),
    nameEn: null,
    brand: brandOf(p)?.slice(0, 200) ?? null,
    group: null,
    unit,
    nutrients,
    portions,
    imageUrl: p.image_front_small_url ?? null,
  };
}

/** Normalizes an EAN-8/UPC-A/EAN-13 so "0" padded codes find the same product. */
export function normalizeBarcode(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 6 || digits.length > 14) return null;
  // UPC-A (12) is EAN-13 with a leading zero; OFF stores the 13-digit form.
  return digits.length === 12 ? `0${digits}` : digits;
}
