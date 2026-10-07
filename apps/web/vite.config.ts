import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};
const version = process.env.APP_VERSION || pkg.version;

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
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,woff2,wasm,json}'],
        // The offline BLS file (~1 MB) and the barcode wasm must be available offline.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      manifest: {
        id: '/',
        name: 'Fleisch-Teufel',
        short_name: 'Fleisch-Teufel',
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
            name: 'Lebensmittel hinzufügen',
            url: '/add',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }],
          },
          { name: 'Barcode scannen', url: '/scan', icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }] },
        ],
      },
      devOptions: { enabled: false },
    }),
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
