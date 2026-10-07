/// <reference lib="webworker" />
/**
 * Service worker (Workbox, injectManifest): precaches the app shell, the offline BLS catalog and
 * the barcode wasm so the app opens and works without a connection. API requests always go to the
 * network (data lives in IndexedDB, not in the HTTP cache). Product images are cached briefly.
 */
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// SPA: every navigation gets index.html (except API and health).
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//, /^\/health/] }),
);

registerRoute(
  ({ url }) => url.origin === 'https://images.openfoodfacts.org',
  new CacheFirst({
    cacheName: 'off-images',
    plugins: [new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 30 * 24 * 60 * 60 })],
  }),
);

self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') void self.skipWaiting();
});
