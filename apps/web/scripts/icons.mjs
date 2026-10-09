/**
 * Renders the app icons from the logo sources in docs/logo (see its README) into public/.
 * Run with `pnpm --filter @ft/web icons` after changing the logo.
 *
 * Light is the default everywhere a file cannot follow the theme (web app manifest, favicon.ico,
 * the light apple-touch-icon); the dark files are picked by the app (`src/lib/appearance.ts`).
 */
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// sharp and sharp-ico come with the PWA assets generator.
const require = createRequire(createRequire(import.meta.url).resolve('@vite-pwa/assets-generator'));
const sharp = require('sharp');
const { encode } = require('sharp-ico');

const src = (f) => fileURLToPath(new URL(`../../../docs/logo/${f}`, import.meta.url));
const out = (f) => fileURLToPath(new URL(`../public/${f}`, import.meta.url));

const png = (file, size) =>
  sharp(readFileSync(src(file)), { density: Math.ceil((72 * size) / 512) * 2 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();

const jobs = [
  // Rounded tiles: in-app logo and favicons.
  ['logo-light.svg', 'logo.svg'],
  ['logo-dark.svg', 'logo-dark.svg'],
  ['logo-light.svg', 'favicon.svg'],
  ['logo-dark.svg', 'favicon-dark.svg'],
];
for (const [from, to] of jobs) copyFileSync(src(from), out(to));

const pngs = [
  // Full-bleed squares: the OS rounds the corners.
  ['logo-light-square.svg', 64, 'pwa-64x64.png'],
  ['logo-light-square.svg', 192, 'pwa-192x192.png'],
  ['logo-light-square.svg', 512, 'pwa-512x512.png'],
  ['logo-light-square.svg', 180, 'apple-touch-icon-180x180.png'],
  ['logo-dark-square.svg', 180, 'apple-touch-icon-dark-180x180.png'],
  ['logo-maskable.svg', 512, 'maskable-icon-512x512.png'],
];
for (const [from, size, to] of pngs) writeFileSync(out(to), await png(from, size));

writeFileSync(out('favicon.ico'), encode([await png('logo-light.svg', 48)]));
console.log(`icons: ${jobs.length} svg, ${pngs.length} png, favicon.ico`);
