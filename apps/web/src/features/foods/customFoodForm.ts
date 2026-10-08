import {
  isAutoKcal,
  kcalFromKj,
  kcalFromMacrosEu,
  kjFromKcal,
  N,
  saltFromSodiumMg,
  sodiumMgFromSalt,
  type NutrientMap,
} from '@ft/shared';

/**
 * Nutrient form of a custom food (pure functions, the page holds the state). Ten values: energy in
 * kcal and kJ, the macros with sugar and saturated fat, fiber, salt and sodium. Couplings:
 *
 * - kcal come from the macros (EU formula incl. fiber) until kcal or kJ are typed; clearing them or
 *   "aus Makros berechnen" hands the energy back to the macros.
 * - kJ follow kcal; typed kJ set the kcal instead.
 * - Sodium follows salt; typed sodium sets the salt instead.
 *
 * No mode is stored: on opening, kcal count as automatic when they match the formula
 * (`isAutoKcal`), kJ and sodium when they match their derivation.
 */
export const FORM_CODES = [
  'kcal',
  'kj',
  'protein',
  'carbs',
  'sugar',
  'fat',
  'satFat',
  'fiber',
  'salt',
  'sodium',
] as const;
export type FormCode = (typeof FORM_CODES)[number];

/** Nutrient codes (BLS) of the form fields. */
export const FORM_NUTRIENT: Record<FormCode, string> = {
  kcal: N.kcal,
  kj: N.kj,
  protein: N.protein,
  carbs: N.carbs,
  sugar: N.sugar,
  fat: N.fat,
  satFat: N.satFat,
  fiber: N.fiber,
  salt: N.salt,
  sodium: N.sodium,
};

/** Fields whose change moves the automatic kcal. */
const ENERGY_FIELDS: readonly FormCode[] = ['protein', 'carbs', 'fat', 'fiber'];

export type FormValues = Record<FormCode, number | null>;

export interface NutrientFormState {
  values: FormValues;
  /** kcal are the formula result of the macros. */
  kcalAuto: boolean;
  /** kJ are derived from the kcal (false: typed kJ, the kcal come from them). */
  kjAuto: boolean;
  /** Sodium is derived from the salt (false: typed sodium, the salt comes from it). */
  sodiumAuto: boolean;
}

const KJ_TOLERANCE = 1;
const SODIUM_TOLERANCE_MG = 1;

const emptyValues = (): FormValues => Object.fromEntries(FORM_CODES.map((c) => [c, null])) as FormValues;

/** Values as a nutrient map (only set ones). */
export function formNutrients(values: FormValues): NutrientMap {
  const out: NutrientMap = {};
  for (const c of FORM_CODES) {
    const v = values[c];
    if (v !== null) out[FORM_NUTRIENT[c]] = v;
  }
  return out;
}

const hasEnergyInput = (values: FormValues) => ENERGY_FIELDS.some((c) => values[c] !== null);

/** Recomputes the derived values from the sources the flags name. */
function derive(state: NutrientFormState): NutrientFormState {
  const values = { ...state.values };
  if (state.kcalAuto) values.kcal = hasEnergyInput(values) ? kcalFromMacrosEu(formNutrients(values)) : null;
  if (state.kjAuto) values.kj = values.kcal === null ? null : kjFromKcal(values.kcal);
  if (state.sodiumAuto) values.sodium = values.salt === null ? null : sodiumMgFromSalt(values.salt);
  return { ...state, values };
}

/** Start state: empty with automatic kcal, or the stored food with its modes recognized. */
export function initFromFood(nutrients: NutrientMap | null): NutrientFormState {
  if (!nutrients) return { values: emptyValues(), kcalAuto: true, kjAuto: true, sodiumAuto: true };
  const values = emptyValues();
  for (const c of FORM_CODES) values[c] = nutrients[FORM_NUTRIENT[c]] ?? null;
  return statesFromValues(values);
}

/** Recognizes the modes of a complete set of values (stored food, label result). */
function statesFromValues(values: FormValues): NutrientFormState {
  const map = formNutrients(values);
  const kcalAuto = values.kcal === null ? true : isAutoKcal(map);
  const kjAuto =
    values.kj === null ||
    (values.kcal !== null && Math.abs(values.kj - kjFromKcal(values.kcal)) <= KJ_TOLERANCE);
  const sodiumAuto =
    values.sodium === null ||
    (values.salt !== null && Math.abs(values.sodium - sodiumMgFromSalt(values.salt)) <= SODIUM_TOLERANCE_MG);
  // Only kJ given: they are the source of the kcal.
  if (values.kcal === null && values.kj !== null) {
    return derive({
      values: { ...values, kcal: kcalFromKj(values.kj) },
      kcalAuto: false,
      kjAuto: false,
      sodiumAuto,
    });
  }
  // Only sodium given: the salt comes from it.
  if (values.salt === null && values.sodium !== null) {
    return derive({
      values: { ...values, salt: saltFromSodiumMg(values.sodium) },
      kcalAuto,
      kjAuto,
      sodiumAuto: false,
    });
  }
  return derive({ values, kcalAuto, kjAuto, sodiumAuto });
}

/** One field typed by the user (null: emptied), with all couplings applied. */
export function setField(state: NutrientFormState, code: FormCode, v: number | null): NutrientFormState {
  const values = { ...state.values, [code]: v };
  switch (code) {
    case 'kcal':
      // Typed kcal override the macros; an emptied field hands the energy back to them.
      return derive({ ...state, values, kcalAuto: v === null, kjAuto: true });
    case 'kj':
      if (v === null) return derive({ ...state, values, kcalAuto: true, kjAuto: true });
      return derive({ ...state, values: { ...values, kcal: kcalFromKj(v) }, kcalAuto: false, kjAuto: false });
    case 'salt':
      return derive({ ...state, values, sodiumAuto: true });
    case 'sodium':
      if (v === null) return derive({ ...state, values: { ...values, salt: null }, sodiumAuto: true });
      return derive({ ...state, values: { ...values, salt: saltFromSodiumMg(v) }, sodiumAuto: false });
    default:
      return derive({ ...state, values });
  }
}

/** "aus Makros berechnen": the kcal (and kJ) follow the macros again. */
export function resetKcal(state: NutrientFormState): NutrientFormState {
  return derive({ ...state, kcalAuto: true, kjAuto: true });
}

/**
 * Where the kcal come from, for the line under the field. Typed kJ only count as the source while
 * the kcal still are their conversion (a label may print kcal and kJ that differ slightly).
 */
export function kcalSource(state: NutrientFormState): 'macros' | 'kcal' | 'kj' {
  if (state.kcalAuto) return 'macros';
  const { kcal, kj } = state.values;
  const fromKj = !state.kjAuto && kcal !== null && kj !== null && Math.abs(kcal - kcalFromKj(kj)) <= 0.5;
  return fromKj ? 'kj' : 'kcal';
}

/** All set values × factor (per portion → per 100 g), rounded to 3 decimals like before. */
export function toNutrients(state: NutrientFormState, factor: number): NutrientMap {
  const out: NutrientMap = {};
  for (const [code, v] of Object.entries(formNutrients(state.values))) {
    out[code] = Math.round(v * factor * 1000) / 1000;
  }
  return out;
}

/** Error of the nutrient part, or null. */
export function nutrientError(state: NutrientFormState): string | null {
  return state.values.kcal === null ? 'Kalorien oder Makros angeben.' : null;
}
