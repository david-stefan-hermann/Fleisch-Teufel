/**
 * Reading a food label from 1 to 3 photos (front, nutrition table, barcode). Unlike the meal
 * analysis, the nutrients here come from the model: it copies what is printed, never estimates,
 * and the person checks the filled form before saving.
 */
import { LABEL_NUTRIENT_KEYS, type LabelNutrientKey } from '@ft/shared';
import { z } from 'zod';

// One schema per field (a shared instance would become a $ref in the JSON schema sent to Claude).
const value = () => z.number().nullable();

export const labelSchema = z.object({
  name: z.string().nullable(),
  brand: z.string().nullable(),
  barcode: z.string().nullable(),
  unit: z.enum(['g', 'ml']),
  basis: z.enum(['per100', 'perPortion']),
  servingGrams: z.number().nullable(),
  servingLabel: z.string().nullable(),
  nutrients: z.object(
    Object.fromEntries(LABEL_NUTRIENT_KEYS.map((k) => [k, value()])) as Record<
      LabelNutrientKey,
      ReturnType<typeof value>
    >,
  ),
  notes: z.string().nullable(),
});
export type LabelReading = z.infer<typeof labelSchema>;

export const LABEL_SYSTEM_PROMPT = `Du liest Etiketten verpackter Lebensmittel für eine deutsche Kalorienzähler-App ab. Du bekommst 1 bis 3 Fotos derselben Packung (z. B. Vorderseite, Nährwerttabelle, Barcode) und optional eine Notiz der Person. Aus deinen Angaben füllt die App das Formular „Eigenes Lebensmittel“; die Person prüft es vor dem Speichern.

Grundregel: Schreibe nur ab, was aufgedruckt und lesbar ist. Schätze nichts, rechne nichts um, ergänze nichts aus Erfahrung. Was fehlt oder nicht sicher lesbar ist, bleibt null und kommt kurz in notes.

Felder:
- name: Produktname wie auf der Packung, kurz und ohne Marke (z. B. "Proteinriegel Schoko", "Haferdrink Barista"). null, wenn nicht lesbar.
- brand: Marke bzw. Hersteller, oder null.
- barcode: die Ziffern unter dem Strichcode (EAN/GTIN, 8, 12, 13 oder 14 Ziffern), nur Ziffern. null, wenn nicht alle Ziffern sicher lesbar sind. Nie raten.
- unit: "ml", wenn die Nährwerte pro 100 ml angegeben sind (Getränke, flüssige Produkte), sonst "g".
- basis: "per100", wenn die Tabelle eine Spalte pro 100 g bzw. 100 ml hat (immer bevorzugen). Nur wenn es keine solche Spalte gibt: "perPortion".
- servingGrams: Portionsgröße in g bzw. ml, wenn aufgedruckt (z. B. "1 Riegel = 45 g" → 45). Bei basis "perPortion" ist sie nötig; fehlt sie dann, null und Hinweis in notes.
- servingLabel: Bezeichnung der Portion wie aufgedruckt (z. B. "1 Riegel", "1 Glas (250 ml)"), oder null.
- nutrients: die Werte aus der Spalte, die basis nennt, als Zahl mit Punkt als Dezimaltrenner (aus "13,8 g" wird 13.8).
  - kcal und kj: Brennwert, beide abschreiben, wenn beide dastehen.
  - protein: Eiweiß; carbs: Kohlenhydrate; sugar: davon Zucker; fat: Fett; satFat: davon gesättigte Fettsäuren; fiber: Ballaststoffe; salt: Salz in g.
  - sodium: Natrium in mg, nur wenn Natrium selbst aufgedruckt ist (aus "0,16 g" wird 160). Nicht aus Salz berechnen.
  - Angaben wie "< 0,5 g" oder "Spuren" als 0.
- notes: ein bis zwei kurze Sätze auf Deutsch, was fehlte oder unsicher war (z. B. "Ballaststoffe nicht angegeben.", "Nur Werte pro Riegel aufgedruckt."). null, wenn alles klar war.
- Ist kein Etikett mit Nährwerten zu sehen, alle Werte null lassen und in notes sagen, was auf den Fotos zu sehen ist.`;

export function labelUserPrompt(text: string | null, photos: number): string {
  const note = text?.trim();
  const ask =
    photos === 1 ? 'Lies das Etikett auf dem Foto ab.' : `Lies das Etikett auf den ${photos} Fotos ab.`;
  return note ? `Notiz der Person: """${note.slice(0, 1000)}"""\n\n${ask}` : ask;
}

/** Drops values a label cannot have (negative, not finite) instead of passing them on. */
export function sanitizeReading(r: LabelReading): LabelReading {
  const ok = (v: number | null) => (v !== null && Number.isFinite(v) && v >= 0 ? v : null);
  const trimmed = (s: string | null) => s?.trim() || null;
  return {
    ...r,
    name: trimmed(r.name),
    brand: trimmed(r.brand),
    servingLabel: trimmed(r.servingLabel),
    notes: trimmed(r.notes),
    servingGrams:
      r.servingGrams !== null && r.servingGrams > 0 && Number.isFinite(r.servingGrams)
        ? r.servingGrams
        : null,
    nutrients: Object.fromEntries(
      LABEL_NUTRIENT_KEYS.map((k) => [k, ok(r.nutrients[k])]),
    ) as LabelReading['nutrients'],
  };
}

/** Whether a reading carries anything to fill in (a name or at least one value). */
export function readingHasContent(r: LabelReading): boolean {
  return r.name !== null || LABEL_NUTRIENT_KEYS.some((k) => r.nutrients[k] !== null);
}
