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

/** The daily reminder (see `apps/api/src/push.ts`): one notification, tapping it opens the diary. */
self.addEventListener('push', (event) => {
  let data: { title?: string; body?: string; url?: string; tag?: string } = {};
  try {
    data = (event.data?.json() as typeof data) ?? {};
  } catch {
    // Not JSON: the text is the body.
    data = { body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Fleisch-Teufel', {
      body: data.body ?? 'Heute noch nichts eingetragen.',
      icon: '/pwa-192x192.png',
      badge: '/pwa-64x64.png',
      tag: data.tag ?? 'reminder',
      data: { url: data.url ?? '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(
    (event.notification.data as { url?: string } | undefined)?.url ?? '/',
    self.location.origin,
  ).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      const open = clients.find((c) => 'focus' in c);
      if (open) {
        await open.focus();
        if ('navigate' in open) await (open as WindowClient).navigate(url);
        return;
      }
      await self.clients.openWindow(url);
    }),
  );
});
