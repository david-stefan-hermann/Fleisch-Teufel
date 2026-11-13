/**
 * Figure packs: a zip with `skin.json` (`SkinManifest`) and PNG or WebP pictures, at most
 * `MAX_SKIN_BYTES`, `MAX_SKIN_IMAGES` pictures of at most `MAX_SKIN_PX` on each side. Read and checked
 * on the device (the server only stores the zip), kept unpacked in `assistantSkins`.
 */
import {
  MAX_SKIN_BYTES,
  MAX_SKIN_IMAGES,
  MAX_SKIN_PX,
  skinManifestSchema,
  type SkinManifest,
} from '@ft/shared';
import { unzipSync } from 'fflate';

export class SkinPackError extends Error {}

export interface SkinPack {
  manifest: SkinManifest;
  images: Record<string, { bytes: ArrayBuffer; type: string }>;
  /** Width of the rest picture. */
  width: number;
}

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
const u32be = (b: Uint8Array, i: number) =>
  ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
const u24le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
const u16le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8);

/** Type and size of a PNG or WebP picture from its header; null for anything else. */
export function imageInfo(
  b: Uint8Array,
): { type: 'image/png' | 'image/webp'; width: number; height: number } | null {
  if (b.length > 24 && b[0] === 0x89 && ascii(b, 1, 4) === 'PNG' && ascii(b, 12, 16) === 'IHDR')
    return { type: 'image/png', width: u32be(b, 16), height: u32be(b, 20) };
  if (b.length > 30 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') {
    const chunk = ascii(b, 12, 16);
    if (chunk === 'VP8X') return { type: 'image/webp', width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
    if (chunk === 'VP8L') {
      const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
      return { type: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8 ')
      return { type: 'image/webp', width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  return null;
}

/** Unpacks and checks a pack; throws `SkinPackError` with a German message. */
export function readSkinPack(zip: Uint8Array): SkinPack {
  if (zip.length > MAX_SKIN_BYTES) throw new SkinPackError('Die Figur ist größer als 3 MB.');
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zip);
  } catch {
    throw new SkinPackError('Die Datei ist keine lesbare Zip-Datei.');
  }
  // Packs zipped with their folder: names are taken without the folder.
  const byName = new Map(
    Object.entries(files)
      .filter(([name]) => !name.endsWith('/') && !name.includes('__MACOSX'))
      .map(([name, data]) => [name.split('/').pop()!, data]),
  );
  const json = byName.get('skin.json');
  if (!json) throw new SkinPackError('In der Zip-Datei fehlt skin.json.');
  let manifest: SkinManifest;
  try {
    manifest = skinManifestSchema.parse(JSON.parse(new TextDecoder().decode(json)));
  } catch {
    throw new SkinPackError('skin.json passt nicht zum Format einer Figur.');
  }
  const used = [...new Set(Object.values(manifest.images))];
  if (used.length > MAX_SKIN_IMAGES) throw new SkinPackError(`Höchstens ${MAX_SKIN_IMAGES} Bilder je Figur.`);
  const images: SkinPack['images'] = {};
  let width = 0;
  for (const file of used) {
    const data = byName.get(file);
    if (!data) throw new SkinPackError(`Das Bild ${file} fehlt in der Zip-Datei.`);
    const info = imageInfo(data);
    if (!info) throw new SkinPackError(`${file} ist kein PNG- oder WebP-Bild.`);
    if (info.width > MAX_SKIN_PX || info.height > MAX_SKIN_PX)
      throw new SkinPackError(`${file} ist größer als ${MAX_SKIN_PX} × ${MAX_SKIN_PX} Pixel.`);
    images[file] = { bytes: data.slice().buffer, type: info.type };
    if (file === manifest.images[manifest.states.idle!]) width = info.width;
  }
  return { manifest, images, width };
}
