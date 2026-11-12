/**
 * How "Daten & Sync" names the records the server refused (`sync.rejected`): table, what the record
 * was (name or date from the snapshot) and the reason in German.
 */
import { isISODate } from '@ft/shared';
import { fmtDate } from '@/lib/format';
import type { RejectedRecord } from '@/sync/syncEngine';

export const TABLE_LABELS: Record<string, string> = {
  foodEntries: 'Tagebuch-Einträge',
  weightEntries: 'Gewichtseinträge',
  exerciseEntries: 'Trainings',
  customFoods: 'Eigene Lebensmittel',
  meals: 'Meals',
  goals: 'Ziel-Versionen',
  dayNotes: 'Tagesnotizen',
  foodPortions: 'Eigene Portionen',
  exerciseTypes: 'Eigene Sportarten',
  exerciseTemplates: 'Trainings (gespeichert)',
  settings: 'Einstellungen',
};

/** One record of a table, for the list of refused records. */
const TABLE_ITEM: Record<string, string> = {
  foodEntries: 'Tagebuch-Eintrag',
  weightEntries: 'Gewicht',
  exerciseEntries: 'Training',
  customFoods: 'Eigenes Lebensmittel',
  meals: 'Meal',
  goals: 'Ziel',
  dayNotes: 'Tagesnotiz',
  foodPortions: 'Eigene Portion',
  exerciseTypes: 'Eigene Sportart',
  exerciseTemplates: 'Gespeichertes Training',
  settings: 'Einstellungen',
};

/** "Doppelter Tageseintrag, gehört zu s:2026-11-10", "Ungültige Werte (kcal)". */
export function rejectedReason(error: string): string {
  const id = /^id must be (.+)$/.exec(error)?.[1];
  if (id) return `Doppelter Tageseintrag, gehört zu ${id}`;
  // The server lists the Zod issues as "path: message; path: message".
  const fields = [
    ...new Set(
      error
        .split('; ')
        .map((issue) => (issue.includes(': ') ? issue.slice(0, issue.indexOf(': ')).split('.')[0] : ''))
        .filter(Boolean),
    ),
  ];
  return fields.length ? `Ungültige Werte (${fields.join(', ')})` : 'Ungültige Werte';
}

/** The kind of record and what it was: "Training · Laufen · 10.11.2026". */
export function rejectedTitle(r: RejectedRecord): string {
  const rec = (r.record ?? {}) as Record<string, unknown>;
  const name = [rec.name, rec.typeName].find((v): v is string => typeof v === 'string' && v !== '');
  const date = [rec.date, rec.validFrom].find((v): v is string => typeof v === 'string' && isISODate(v));
  const parts = [TABLE_ITEM[r.table] ?? r.table, name, date && fmtDate(date)].filter(Boolean);
  if (!name && !date && r.id) parts.push(r.id);
  return parts.join(' · ');
}
