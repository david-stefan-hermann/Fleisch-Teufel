import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import './index.css';
import { registerServiceWorker, requestPersistentStorage } from './app/pwa';
import { router } from './app/router';
import { SessionProvider } from './app/session';

const TOAST_BOTTOM = 'calc(var(--tabbar-h) + var(--safe-bottom) + 12px)';

registerServiceWorker();
void requestPersistentStorage();

// iOS WebKit ignores user-scalable=no and touch-action for pinch; its gesture events still zoom.
for (const type of ['gesturestart', 'gesturechange']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessionProvider>
      <RouterProvider router={router} />
      {/*
        Bottom, above the tab bar: "Rückgängig" is in thumb reach, and nothing light sits under the iOS
        status bar (Safari tints it from fixed elements at the top). Theme follows the system like the app.
      */}
      <Toaster
        position="bottom-center"
        theme="system"
        richColors
        closeButton
        offset={{ bottom: TOAST_BOTTOM }}
        mobileOffset={{ bottom: TOAST_BOTTOM, left: 16, right: 16 }}
      />
    </SessionProvider>
  </StrictMode>,
);
