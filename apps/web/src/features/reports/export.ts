/** CSV export built on the device from IndexedDB (feature #11). */
import {
  get,
  N,
  toCsv,
  type CsvDialect,
  type DailyRow,
  type ExerciseEntry,
  type FoodEntry,
  type WeightEntry,
} from '@ft/shared';

export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function entriesCsv(entries: FoodEntry[], mealNames: string[], dialect: CsvDialect): string {
  const sorted = [...entries].sort(
    (a, b) => a.date.localeCompare(b.date) || a.meal - b.meal || a.loggedAt - b.loggedAt,
  );
  return toCsv(
    sorted,
    [
      { header: 'Datum', value: (e) => e.date },
      { header: 'Mahlzeit', value: (e) => mealNames[e.meal] ?? e.meal },
      { header: 'Lebensmittel', value: (e) => e.name },
      { header: 'Marke', value: (e) => e.brand },
      { header: 'Quelle', value: (e) => e.source },
      { header: 'Menge (g)', value: (e) => e.grams },
      { header: 'Portion', value: (e) => e.portionLabel },
      { header: 'Anzahl', value: (e) => e.quantity },
      { header: 'kcal', value: (e) => get(e.nutrients, N.kcal) },
      { header: 'Protein (g)', value: (e) => get(e.nutrients, N.protein) },
      { header: 'Kohlenhydrate (g)', value: (e) => get(e.nutrients, N.carbs) },
      { header: 'Fett (g)', value: (e) => get(e.nutrients, N.fat) },
      { header: 'Ballaststoffe (g)', value: (e) => e.nutrients[N.fiber] },
      { header: 'Zucker (g)', value: (e) => e.nutrients[N.sugar] },
      { header: 'Ges. Fettsäuren (g)', value: (e) => e.nutrients[N.satFat] },
      { header: 'Salz (g)', value: (e) => e.nutrients[N.salt] },
    ],
    dialect,
  );
}

export function dailyCsv(rows: DailyRow[], dialect: CsvDialect): string {
  return toCsv(
    rows,
    [
      { header: 'Datum', value: (r) => r.date },
      { header: 'Erfasst', value: (r) => (r.logged ? 'ja' : 'nein') },
      { header: 'kcal', value: (r) => (r.logged ? get(r.nutrients, N.kcal) : null) },
      { header: 'Ziel kcal', value: (r) => r.targetKcal },
      { header: 'Training kcal', value: (r) => r.exerciseKcal },
      { header: 'Protein (g)', value: (r) => (r.logged ? get(r.nutrients, N.protein) : null) },
      { header: 'Ziel Protein (g)', value: (r) => r.targetProteinG },
      { header: 'Kohlenhydrate (g)', value: (r) => (r.logged ? get(r.nutrients, N.carbs) : null) },
      { header: 'Ziel KH (g)', value: (r) => r.targetCarbsG },
      { header: 'Fett (g)', value: (r) => (r.logged ? get(r.nutrients, N.fat) : null) },
      { header: 'Ziel Fett (g)', value: (r) => r.targetFatG },
      { header: 'Ballaststoffe (g)', value: (r) => (r.logged ? get(r.nutrients, N.fiber) : null) },
      { header: 'Zucker (g)', value: (r) => (r.logged ? get(r.nutrients, N.sugar) : null) },
      { header: 'Ges. Fettsäuren (g)', value: (r) => (r.logged ? get(r.nutrients, N.satFat) : null) },
      { header: 'Salz (g)', value: (r) => (r.logged ? get(r.nutrients, N.salt) : null) },
      { header: 'Gewicht (kg)', value: (r) => r.weightKg },
    ],
    dialect,
  );
}

export function weightsCsv(weights: WeightEntry[], dialect: CsvDialect): string {
  return toCsv(
    [...weights].sort((a, b) => a.date.localeCompare(b.date)),
    [
      { header: 'Datum', value: (w) => w.date },
      { header: 'Gewicht (kg)', value: (w) => w.kg },
    ],
    dialect,
  );
}

export function exerciseCsv(list: ExerciseEntry[], dialect: CsvDialect): string {
  return toCsv(
    [...list].sort((a, b) => a.date.localeCompare(b.date) || a.loggedAt - b.loggedAt),
    [
      { header: 'Datum', value: (e) => e.date },
      { header: 'Sportart', value: (e) => e.name },
      { header: 'Minuten', value: (e) => e.minutes },
      { header: 'Intensität', value: (e) => e.intensity },
      { header: 'MET', value: (e) => e.met },
      { header: 'Gewicht (kg)', value: (e) => e.weightKg },
      { header: 'kcal', value: (e) => e.kcal },
    ],
    dialect,
  );
}
