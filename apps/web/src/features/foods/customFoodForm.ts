import {
  isAutoKcal,
  kcalFromKj,
  kcalFromMacrosEu,
  kjFromKcal,
  N,
  saltFromSodiumMg,
  LABEL_NUTRIENT_KEYS,
  sodiumMgFromSalt,
  type AiLabelResult,
  type NutrientMap,
  type Portion,
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
function statesFromValues(given: FormValues): NutrientFormState {
  const values = { ...given };
  // Only kJ given: they are the source of the kcal. Only sodium given: the salt comes from it.
  const kjSource = values.kcal === null && values.kj !== null;
  const sodiumSource = values.salt === null && values.sodium !== null;
  if (kjSource) values.kcal = kcalFromKj(values.kj!);
  if (sodiumSource) values.salt = saltFromSodiumMg(values.sodium!);
  const map = formNutrients(values);
  const state: NutrientFormState = {
    values,
    kcalAuto: given.kcal === null && !kjSource ? true : !kjSource && isAutoKcal(map),
    kjAuto:
      !kjSource &&
      (values.kj === null ||
        (values.kcal !== null && Math.abs(values.kj - kjFromKcal(values.kcal)) <= KJ_TOLERANCE)),
    sodiumAuto:
      !sodiumSource &&
      (values.sodium === null ||
        (values.salt !== null &&
          Math.abs(values.sodium - sodiumMgFromSalt(values.salt)) <= SODIUM_TOLERANCE_MG)),
  };
  // Stored values stay exactly as they are (also when they match their derivation); only missing
  // ones are derived. Typing in any field recomputes as usual.
  const derived = derive(state).values;
  for (const c of FORM_CODES) if (values[c] === null) values[c] = derived[c];
  return state;
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

/** The editor fields a label result can fill (besides the nutrient values). */
export interface LabelTarget {
  name: string;
  brand: string;
  barcode: string;
  unit: 'g' | 'ml';
  mode: 'per100' | 'perPortion';
  servingGrams: number | null;
  portions: Portion[];
  nutrients: NutrientFormState;
}

/**
 * Fills the editor from a label reading. It overwrites what is there: name, brand and barcode when
 * the label shows them (a code read locally from the photos wins over the model's), the unit, all
 * ten values (unreadable ones become empty) and, for values per serving, the basis and serving
 * size. A serving printed next to per-100 values becomes a portion ("1 Riegel", 45 g). The kcal
 * mode follows from the values like for a stored food. Returns the changed fields for the highlight.
 */
export function applyLabel(
  current: LabelTarget,
  label: AiLabelResult,
  localBarcode: string | null,
): { next: LabelTarget; changed: string[] } {
  const map: NutrientMap = {};
  for (const k of LABEL_NUTRIENT_KEYS) {
    const v = label.nutrients[k];
    if (v !== null) map[FORM_NUTRIENT[k]] = v;
  }
  const perPortion = label.basis === 'perPortion';
  const barcode = localBarcode ?? label.barcode;
  const portionLabel = label.servingLabel?.trim() || 'Portion';
  const addPortion =
    !perPortion &&
    label.servingGrams !== null &&
    !current.portions.some((p) => p.grams === label.servingGrams || p.label === portionLabel);
  const next: LabelTarget = {
    name: label.name ?? current.name,
    brand: label.brand ?? current.brand,
    barcode: barcode ?? current.barcode,
    unit: label.unit,
    mode: label.basis,
    servingGrams: perPortion ? (label.servingGrams ?? current.servingGrams) : current.servingGrams,
    portions: addPortion
      ? [...current.portions, { label: portionLabel, grams: label.servingGrams! }]
      : current.portions,
    nutrients: initFromFood(map),
  };
  const changed: string[] = [
    ...(label.name !== null ? ['name'] : []),
    ...(label.brand !== null ? ['brand'] : []),
    ...(barcode !== null ? ['barcode'] : []),
    ...(label.unit !== current.unit ? ['unit'] : []),
    ...(label.basis !== current.mode ? ['mode'] : []),
    ...(perPortion && label.servingGrams !== null ? ['servingGrams'] : []),
    ...(addPortion ? ['portions'] : []),
    ...LABEL_NUTRIENT_KEYS.filter((k) => label.nutrients[k] !== null),
  ];
  return { next, changed };
}
