/**
 * Everyday words that the food databases (BLS above all) spell differently. A query word on the
 * left is searched as typed and, slightly lower, as each phrase on the right ("ei" also searches
 * "Hühnerei", "putenbrust" also "Pute Brust"). Keys and phrases are written in plain German; the
 * search folds them like any other text. Keep the list short and only add words that a real query
 * missed: every entry is covered by `search.quality.test.ts`.
 */
export const SYNONYMS: Record<string, readonly string[]> = {
  // Eggs: BLS only knows "Hühnerei".
  ei: ['Hühnerei'],
  eier: ['Hühnerei'],
  // Pasta: BLS says "Teigwaren".
  nudel: ['Teigwaren', 'Eierteigwaren'],
  nudeln: ['Teigwaren', 'Eierteigwaren'],
  pasta: ['Teigwaren', 'Eierteigwaren'],
  spaghetti: ['Teigwaren'],
  penne: ['Teigwaren'],
  fusilli: ['Teigwaren'],
  makkaroni: ['Teigwaren'],
  // Poultry.
  huhn: ['Hähnchen'],
  hühnchen: ['Hähnchen'],
  hendl: ['Hähnchen'],
  chicken: ['Hähnchen'],
  hühnerbrust: ['Hähnchen Brust'],
  hühnchenbrust: ['Hähnchen Brust'],
  hähnchenfleisch: ['Hähnchen Fleisch'],
  truthahn: ['Pute'],
  turkey: ['Pute'],
  putenbrust: ['Pute Brust'],
  putenfleisch: ['Pute Fleisch'],
  // Meat.
  hack: ['Hackfleisch'],
  gehacktes: ['Hackfleisch'],
  rinderhack: ['Rind Hackfleisch'],
  rinderhackfleisch: ['Rind Hackfleisch'],
  schweinefleisch: ['Schwein Fleisch'],
  rindfleisch: ['Rind Fleisch'],
  // Dairy: the everyday product has a longer BLS name.
  käse: ['Gouda', 'Emmentaler'],
  quark: ['Speisequark'],
  frischkäse: ['Frischkäsezubereitung Natur'],
  // Bread.
  brötchen: ['Weizenbrötchen'],
  semmel: ['Weizenbrötchen'],
  semmeln: ['Weizenbrötchen'],
  schrippe: ['Weizenbrötchen'],
  weck: ['Weizenbrötchen'],
  weckle: ['Weizenbrötchen'],
  toast: ['Toastbrot'],
  // Vegetables and the like.
  pilze: ['Champignon'],
  brokkoli: ['Broccoli'],
  kartoffelbrei: ['Kartoffelpüree'],
  stampf: ['Kartoffelpüree'],
  // Fats and drinks.
  öl: ['Olivenöl', 'Rapsöl', 'Sonnenblumenöl'],
  speiseöl: ['Rapsöl', 'Sonnenblumenöl'],
  cola: ['Colagetränk'],
  wasser: ['Trinkwasser'],
  yoghurt: ['Joghurt'],
  yogurt: ['Joghurt'],
};
