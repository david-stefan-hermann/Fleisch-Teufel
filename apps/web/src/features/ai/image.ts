/**
 * Every photo is downscaled and re-encoded as JPEG before it is stored or sent: enough detail for its
 * job, small enough for mobile data, IndexedDB and the API's image limits. EXIF orientation is applied.
 *
 * Two limits apply, the stricter one wins: the pixel budget of the preset and 1080p (long edge at
 * most 1920 px, short edge at most 1080 px). Images are never upscaled.
 */

/** Long and short edge of 1080p, the upper bound for every stored or sent photo. */
export const MAX_LONG_EDGE = 1920;
export const MAX_SHORT_EDGE = 1080;

export interface ImagePreset {
  /** Pixel budget (width × height). */
  maxPixels: number;
  /** JPEG quality, 0 to 1. */
  quality: number;
}

export const IMAGE_PRESETS = {
  /** Plate photo for the AI analysis (also kept as the meal or diary photo). */
  analysis: { maxPixels: 1_000_000, quality: 0.82 },
  /** Photo picked for a saved meal in the meal editor (only shown, small is enough). */
  mealPhoto: { maxPixels: 600_000, quality: 0.8 },
  /**
   * Food label for the AI reading: small print in the nutrition table needs more pixels; with the
   * 1080p bound a 4:3 photo ends at 1440 × 1080.
   */
  label: { maxPixels: 2_000_000, quality: 0.85 },
} satisfies Record<string, ImagePreset>;

/** Target size of a `w` × `h` image within `maxPixels` and 1080p, keeping the aspect ratio. */
export function fitSize(w: number, h: number, maxPixels: number): { width: number; height: number } {
  const long = Math.max(w, h);
  const short = Math.min(w, h);
  const scale = Math.min(1, Math.sqrt(maxPixels / (w * h)), MAX_LONG_EDGE / long, MAX_SHORT_EDGE / short);
  const fit = (v: number, cap: number) => Math.max(1, Math.min(cap, Math.round(v * scale)));
  const landscape = w >= h;
  return {
    width: fit(w, landscape ? MAX_LONG_EDGE : MAX_SHORT_EDGE),
    height: fit(h, landscape ? MAX_SHORT_EDGE : MAX_LONG_EDGE),
  };
}

export async function compressImage(file: Blob, preset: ImagePreset = IMAGE_PRESETS.analysis): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const { width, height } = fitSize(bitmap.width, bitmap.height, preset.maxPixels);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', preset.quality),
  );
}
