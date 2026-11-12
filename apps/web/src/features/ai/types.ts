/** Shared types and constants of the food page ("Essen eintragen") and the photo sheets. */

/**
 * A photo taken or picked before it goes anywhere (preview of the food page, `PhotoCaptureSheet`);
 * `id` keeps its identity while photos are added and removed.
 */
export interface CapturedShot {
  id: number;
  blob: Blob;
}

/** Hints people type most; a tap appends one to the hint field. */
export const HINT_CHIPS = [
  'halbe Portion',
  'mit Öl gebraten',
  'ohne Öl',
  'ohne Soße',
  'Restaurantportion',
  'große Portion',
  'Light-Variante',
];

/** Footer label of the sheet that adds photos to an analysis. */
export const addLabel = (n: number) =>
  n === 0 ? 'Hinzufügen' : `Hinzufügen (${n} ${n === 1 ? 'Foto' : 'Fotos'})`;

/** The model's confidence of a review row, as its badge says it. */
export const CONFIDENCE = { low: 'unsicher', medium: 'mittel', high: 'sicher' } as const;

/** Review content while a re-analysis runs: greyed out and not interactive. */
export const BUSY = 'pointer-events-none opacity-45 saturate-50 select-none';
