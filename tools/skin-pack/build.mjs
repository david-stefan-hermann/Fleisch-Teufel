/**
 * Builds a figure pack for the assistant button: the pictures named in a manifest, converted to WebP
 * of `--size` px (default 256; pixel art keeps hard edges and stays PNG), and `skin.json`, in one zip
 * that the app takes under Mehr → Aussehen → "Eigene Figur".
 *
 *   node tools/skin-pack/build.mjs <picture folder> <manifest.json> <out.zip> [--size 256]
 *
 * The manifest is a `SkinManifest` whose `images` name the source files of the folder; the pack gets
 * `<key>.webp` (or `.png`) instead. The app checks: at most 3 MB, 40 pictures, 512 px.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import sharp from 'sharp';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const size = Number(flag('--size', '256'));
const [folder, manifestPath, out] = args;
if (!folder || !manifestPath || !out) {
  console.error('usage: build.mjs <picture folder> <manifest.json> <out.zip> [--size 256]');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const files = {};
const images = {};
for (const [key, source] of Object.entries(manifest.images)) {
  const img = sharp(readFileSync(join(folder, source))).resize(size, size, {
    fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 },
    kernel: manifest.pixelArt ? 'nearest' : 'lanczos3',
  });
  const name = `${key}.${manifest.pixelArt ? 'png' : 'webp'}`;
  const data = manifest.pixelArt
    ? await img.png({ compressionLevel: 9 }).toBuffer()
    : await img.webp({ quality: 82, alphaQuality: 90, effort: 6 }).toBuffer();
  files[name] = new Uint8Array(data);
  images[key] = name;
}
const used = new Set([...Object.values(manifest.states), ...(manifest.idle ?? [])]);
for (const key of used) if (!(key in images)) throw new Error(`manifest uses unknown picture "${key}"`);
files['skin.json'] = new TextEncoder().encode(JSON.stringify({ ...manifest, images }, null, 2));
const zip = zipSync(files, { level: 0 });
writeFileSync(out, zip);
console.log(`${out}: ${Object.keys(images).length} pictures, ${(zip.length / 1024).toFixed(0)} KB`);
