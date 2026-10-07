import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import './index.css';
import { registerServiceWorker, requestPersistentStorage } from './app/pwa';
import { router } from './app/router';
import { SessionProvider } from './app/session';

registerServiceWorker();
void requestPersistentStorage();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessionProvider>
      <RouterProvider router={router} />
      <Toaster
        position="top-center"
        richColors
        closeButton
        toastOptions={{ className: 'mt-[var(--safe-top)]' }}
      />
    </SessionProvider>
  </StrictMode>,
);
