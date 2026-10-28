import type { Food, Portion } from './schemas.js';

/**
 * Portions with a meaning: "Stück (120 g)", "Scheibe (45 g)", "Riegel (45 g)". The BLS ships no
 * portion data, so a curated table gives basic foods the piece or slice people count in (typical
 * German sizes: BZfE and DGE reference portions, trade sizes); Open Food Facts serving sizes get a
 * label from their own text ("1 Riegel (45g)" → "Riegel (45 g)") instead of "Portion (…)".
 * Every label carries the grams, so the unit wheel and the search rows show them as they are.
 */

const piece = (label: string, grams: number): Portion => ({ label: `${label} (${fmtG(grams)} g)`, grams });

/** "6", "6,5", "2,5": whole grams without decimals, else one decimal with a comma. */
function fmtG(grams: number): string {
  return Number.isInteger(grams) ? String(grams) : String(Math.round(grams * 10) / 10).replace('.', ',');
}

/**
 * Forms of a food that are not counted in pieces: dried, powdered, juiced, canned or processed.
 * Checked before the rules, except for rules that say `processed: true`.
 */
const PROCESSED =
  /getrocknet|pulver|saft\b|nektar|konserve|chips|mehl|stärke|konzentrat|püree|mus\b|mark\b|kompott|creme|drink|milch\b|öl\b|essig|sirup|extrakt|aroma/;

interface PieceRule {
  /** Tested against the lower-cased name (BLS names start with the food: "Apfel roh"). */
  words: RegExp;
  /** BLS main groups (first letter of the code) the rule applies to; any when empty. */
  groups: string;
  portions: readonly Portion[];
  /** The rule describes a processed form itself (a bar, a biscuit): `PROCESSED` does not block it. */
  processed?: boolean;
}

const rule = (words: RegExp, groups: string, portions: Portion[], processed = false): PieceRule => ({
  words,
  groups,
  portions,
  processed,
});

/** First match wins; the more specific form (Knäckebrot before Brot, Eigelb before Ei) comes first. */
const PIECE_RULES: readonly PieceRule[] = [
  // Fruit (F)
  rule(/^apfel\b/, 'F', [piece('Stück', 150)]),
  rule(/^banane\b/, 'F', [piece('Stück', 120)]),
  rule(/^birne\b/, 'F', [piece('Stück', 160)]),
  rule(/^orange\b/, 'F', [piece('Stück', 150)]),
  rule(/^(pfirsich|nektarine)\b/, 'F', [piece('Stück', 130)]),
  rule(/^(mandarine|clementine)\b/, 'F', [piece('Stück', 60)]),
  rule(/^kiwi\b/, 'F', [piece('Stück', 75)]),
  rule(/^pflaume\b/, 'F', [piece('Stück', 40)]),
  rule(/^aprikose\b/, 'F', [piece('Stück', 45)]),
  rule(/^erdbeere\b/, 'F', [piece('Stück', 12), piece('Handvoll', 80)]),
  rule(/^(himbeere|heidelbeere|brombeere|johannisbeere|weintraube|süßkirsche|sauerkirsche)\b/, 'F', [
    piece('Handvoll', 80),
  ]),
  rule(/^avocado\b/, 'F', [piece('Stück', 200), piece('Hälfte', 100)]),
  // Vegetables (G), potatoes and mushrooms (K)
  rule(/^tomate\b/, 'G', [piece('Stück', 80)]),
  rule(/^gurke\b(?!.*(gesäuert|gewürz))/, 'G', [piece('Stück', 400), piece('Scheibe', 5)]),
  rule(/^(gemüsepaprika|paprika)\b/, 'G', [piece('Stück', 150)]),
  rule(/^(karotte|möhre)\b/, 'G', [piece('Stück', 80)]),
  rule(/^(speisezwiebel|zwiebel)\b/, 'G', [piece('Stück', 70)]),
  rule(/^knoblauch\b/, 'G', [piece('Zehe', 3)]),
  rule(/^zucchini\b/, 'G', [piece('Stück', 200)]),
  rule(/^aubergine\b/, 'G', [piece('Stück', 250)]),
  rule(/^kohlrabi\b/, 'G', [piece('Stück', 250)]),
  rule(/^kartoffel\b/, 'K', [piece('Stück', 80)]),
  rule(/^champignon\b/, 'K', [piece('Stück', 15)]),
  // Eggs (E)
  rule(/^hühnerei eigelb\b/, 'E', [piece('Stück', 18)]),
  rule(/^hühnerei eiklar\b/, 'E', [piece('Stück', 35)]),
  rule(/^hühnerei\b/, 'E', [piece('Stück', 60)]),
  // Bread and pastries (B, D)
  rule(/knäckebrot/, 'B', [piece('Scheibe', 10)]),
  rule(/toastbrot|toasties/, 'BD', [piece('Scheibe', 25)]),
  rule(/weißbrot|baguette|ciabatta/, 'B', [piece('Scheibe', 30)]),
  rule(/brot\b/, 'B', [piece('Scheibe', 45)]),
  rule(/brötchen|semmel/, 'B', [piece('Stück', 55)]),
  rule(/laugenbrezel|^brezel\b/, 'BDX', [piece('Stück', 80)]),
  rule(/croissant/, 'D', [piece('Stück', 60)]),
  rule(/keks|plätzchen|cookie/, 'D', [piece('Stück', 10)], true),
  rule(/waffel\b/, 'D', [piece('Stück', 25)], true),
  rule(/muffin/, 'D', [piece('Stück', 90)], true),
  // Cheese (M)
  rule(/mozzarella/, 'M', [piece('Kugel', 125)]),
  rule(/^(?!.*(frisch|hütten|schmelz|quark|streich|zubereitung|sahne|kuchen|creme)).*käse/, 'M', [
    piece('Scheibe', 25),
  ]),
  // Sausage and cold cuts (W, H for vegetarian ones), ham (U)
  rule(/(wiener|frankfurter|bockwurst|würstchen)/, 'WH', [piece('Stück', 50)]),
  rule(/bratwurst/, 'WH', [piece('Stück', 100)]),
  rule(/frikadelle|bulette|fleischpflanzerl/, 'WXY', [piece('Stück', 100)]),
  rule(
    /^(?!.*(streich|leberwurst|teewurst|mett|brät|dauerwurst)).*(salami|schinken|lyoner|mortadella|aufschnitt|wurst\b|fleischkäse|leberkäse)/,
    'WHU',
    [piece('Scheibe', 20)],
  ),
  // Meat and poultry (U, V), fish (T)
  rule(/schnitzel/, 'UVH', [piece('Stück', 150)]),
  rule(/steak/, 'UV', [piece('Stück', 200)]),
  rule(/(hähnchen|hühner|puten)brust/, 'V', [piece('Stück', 150)]),
  rule(/fischstäbchen/, 'TY', [piece('Stück', 30)]),
  rule(
    /^(?!.*(geräuchert|gesalzen|rogen)).*(^(lachs|forelle|kabeljau|zander|dorade|seelachs|köhler|thunfisch|rotbarsch|scholle)\b|filet)/,
    'T',
    [piece('Stück', 150)],
  ),
  // Sweets (S), nuts (H)
  rule(/riegel/, 'SF', [piece('Riegel', 40)], true),
  rule(/eis\b/, 'S', [piece('Kugel', 50)], true),
  rule(/^(?!.*(getränk|pudding|kakao)).*schokolade\b/, 'S', [piece('Stück', 6), piece('Tafel', 100)], true),
  rule(/fruchtgummi|gummibärchen|weingummi/, 'S', [piece('Stück', 2.5), piece('Handvoll', 30)], true),
  rule(
    /^(erdnuss|haselnuss|cashewkern|paranuss|walnuss|mandel|pistazie|macadamia|pekannuss)\b(?!.*(butter|mus|creme|drink|mehl|öl|milch))/,
    'H',
    [piece('Handvoll', 30)],
  ),
  // Dishes (X, Y)
  rule(/pizzabaguette/, 'XY', [piece('Stück', 150)]),
  rule(/^(?!.*teig).*pizza/, 'XY', [piece('Ganze Pizza', 350), piece('Viertel', 90)]),
  rule(/^(?!.*(suppe|eintopf|brühe|salat|dessert|kompott|sauce|soße))/, 'Y', [piece('Portion', 350)]),
];

/**
 * The pieces and slices a BLS food is counted in ("Stück (120 g)" for a banana, "Scheibe (45 g)"
 * for bread), or none: for products of other sources (they carry their own portions), for
 * processed forms (dried apple, apple juice) and for foods without a rule. The first matching rule
 * decides, so the more specific form comes first in the table.
 */
export function piecePortionsFor(
  food: Pick<Food, 'unit'> & Partial<Pick<Food, 'name' | 'source' | 'sourceId'>>,
): readonly Portion[] {
  if (food.source !== 'bls' || !food.name) return [];
  const name = food.name.toLowerCase();
  const group = food.sourceId?.charAt(0) ?? '';
  const processed = PROCESSED.test(name);
  for (const r of PIECE_RULES) {
    if (r.groups && !r.groups.includes(group)) continue;
    if (processed && !r.processed) continue;
    if (r.words.test(name)) return r.portions;
  }
  return [];
}

const EN_WORDS: Record<string, string> = {
  slice: 'Scheibe',
  slices: 'Scheiben',
  piece: 'Stück',
  pieces: 'Stück',
  bar: 'Riegel',
  bars: 'Riegel',
  cup: 'Tasse',
  bottle: 'Flasche',
  can: 'Dose',
  glass: 'Glas',
  serving: 'Portion',
  portion: 'Portion',
  pack: 'Packung',
  package: 'Packung',
  unit: 'Stück',
  cookie: 'Keks',
  cookies: 'Kekse',
  scoop: 'Messlöffel',
  tablespoon: 'Esslöffel',
  teaspoon: 'Teelöffel',
};

/**
 * Label of an Open Food Facts serving from its free text and weight: "1 Riegel (45g)" → "Riegel
 * (45 g)", "2 slices (50 g)" → "2 Scheiben (50 g)", "30 g" → "Portion (30 g)", nothing →
 * "Portion (30 g)". The weight always comes from `grams` (what the product data says), the text
 * only names the piece.
 */
export function servingLabel(text: string | null | undefined, grams: number, unit: 'g' | 'ml'): string {
  const amount = `${fmtG(grams)} ${unit}`;
  // Strip the measures ("45g", "(6,5 g)", "250 ml", "1.5 oz") and punctuation, keep words and counts.
  const words = (text ?? '')
    .replace(/\(?\s*\d+(?:[.,]\d+)?\s*(kg|g|gr|gramm|ml|cl|l|oz|fl\.? ?oz)\b\.?\s*\)?/gi, ' ')
    .replace(/[()[\],;:/]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const count = words.length && /^\d+(?:[.,]\d+)?$/.test(words[0]!) ? words.shift()! : null;
  const named = words.filter((w) => !/^\d/.test(w)).slice(0, 3);
  if (named.length === 0) return `Portion (${amount})`;
  const label = named.map((w) => EN_WORDS[w.toLowerCase()] ?? w).join(' ');
  const capitalised = label.charAt(0).toUpperCase() + label.slice(1);
  const n = count ? Number.parseFloat(count.replace(',', '.')) : 1;
  return `${n > 1 ? `${count} ` : ''}${capitalised} (${amount})`.slice(0, 80);
}

/** A whole package is no serving (2.480 kcal for a cheese says nothing). */
export const isPackagePortion = (p: Pick<Portion, 'label'>) => /^packung\b/i.test(p.label);

/** The base units ("100 g", "1 ml") of `portionsFor`. */
const isBaseUnit = (p: Pick<Portion, 'label'>) => /^(100|1)\s?(g|ml)$/.test(p.label);

/**
 * The portion a food is suggested in, from the ordered list of `portionsFor`: the person's own, the
 * product's serving or the piece it is counted in, never a package, never a household measure and
 * never the base unit (that is the caller's "100 g" fallback). Null when there is none.
 */
export function defaultPortion(portions: readonly Portion[]): Portion | null {
  for (const p of portions) {
    if (isBaseUnit(p)) return null;
    if (!isPackagePortion(p) && p.grams > 0) return p;
  }
  return null;
}
