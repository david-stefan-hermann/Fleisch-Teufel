import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};
const version = process.env.APP_VERSION || pkg.version;

/** Light icon of the manifest → its dark twin (`scripts/icons.mjs`). */
const DARK_ICONS: Record<string, string> = {
  'pwa-64x64.png': 'pwa-dark-64x64.png',
  'pwa-192x192.png': 'pwa-dark-192x192.png',
  'pwa-512x512.png': 'pwa-dark-512x512.png',
  'maskable-icon-512x512.png': 'maskable-icon-dark-512x512.png',
};

/**
 * `manifest-dark.webmanifest`: the built manifest with the dark icons, everything else the same (above
 * all `id`, `start_url` and `scope`: still one app). The manifest link moves in front of
 * `theme-init.js`, which points it at the dark manifest when the icon is set to dark; the app keeps
 * it so (`src/lib/appearance.ts`). Runs after VitePWA, so the service worker precaches the file.
 */
function darkManifest(): Plugin {
  type Icon = { src: string };
  const dark = (icons: Icon[] | undefined) => icons?.map((i) => ({ ...i, src: DARK_ICONS[i.src] ?? i.src }));
  return {
    name: 'ft-dark-manifest',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const light = bundle['manifest.webmanifest'];
      if (light?.type !== 'asset') return this.error('manifest.webmanifest is missing');
      const m = JSON.parse(String(light.source)) as { icons?: Icon[]; shortcuts?: { icons?: Icon[] }[] };
      m.icons = dark(m.icons);
      m.shortcuts = m.shortcuts?.map((s) => ({ ...s, icons: dark(s.icons) }));
      this.emitFile({ type: 'asset', fileName: 'manifest-dark.webmanifest', source: JSON.stringify(m) });
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const link = /<link rel="manifest"[^>]*>/.exec(html)?.[0];
        if (!link) return html;
        const init = '<script src="/theme-init.js"></script>';
        // Without that tag the link would be dropped and the build would ship without a manifest.
        if (!html.includes(init)) throw new Error('darkManifest: theme-init.js script tag not found');
        return html.replace(link, '').replace(init, `${link}\n    ${init}`);
      },
    },
  };
}

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      injectManifest: {
        // The offline catalog by name, not every JSON (a future data file would land in the precache).
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,woff2,wasm}', 'data/bls-compact.json'],
        // The offline BLS file (~1 MB) and the barcode wasm must be available offline.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      manifest: {
        id: '/',
        name: 'Fleisch-Teufel',
        short_name: 'Fleisch Teufel',
        description: 'Ernährungstagebuch: Kalorien, Makros, Gewicht. Offline-fähig, selbst gehostet.',
        lang: 'de',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#faf8f6',
        theme_color: '#9f1d24',
        categories: ['health', 'food', 'lifestyle'],
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          {
            name: 'Essen eintragen',
            url: '/photo',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }],
          },
          { name: 'Barcode scannen', url: '/scan', icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }] },
        ],
      },
      devOptions: { enabled: false },
    }),
    darkManifest(),
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Dev proxy host for iPhone tests (Nginx Proxy Manager → 10.69.69.230:25591).
    allowedHosts: ['.avernus.cloud', 'truenas.local', 'localhost'],
    proxy: { '/api': 'http://127.0.0.1:3000', '/health': 'http://127.0.0.1:3000' },
  },
  preview: { host: '0.0.0.0', port: 4173, proxy: { '/api': 'http://127.0.0.1:3000' } },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 900 },
});
