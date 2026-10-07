import { Link } from '@tanstack/react-router';
import { Download, LogIn, Share, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useSessionContext } from './session';
import { applyUpdate, isIos, isStandalone, useUpdateReady } from './pwa';

const HINT_KEY = 'ft.installHintDismissed';

function Banner({
  children,
  onClose,
  tone = 'default',
}: {
  children: React.ReactNode;
  onClose?: () => void;
  tone?: 'default' | 'warn';
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`mx-auto mt-[calc(var(--safe-top)+0.5rem)] flex w-[calc(100%-1rem)] max-w-xl items-center gap-3 rounded-xl border px-3 py-2 text-sm shadow-sm ${
        tone === 'warn' ? 'border-warn/40 bg-warn/10' : 'border-border bg-card'
      }`}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {onClose && (
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Hinweis schließen">
          <X aria-hidden />
        </Button>
      )}
    </div>
  );
}

export function AppBanners() {
  const { needsReauth } = useSessionContext();
  const updateReady = useUpdateReady();
  const [hintDismissed, setHintDismissed] = useState(() => localStorage.getItem(HINT_KEY) === '1');
  const showInstallHint = !hintDismissed && isIos() && !isStandalone();

  const banners: React.ReactNode[] = [];
  if (updateReady) {
    banners.push(
      <Banner key="update">
        <div className="flex items-center justify-between gap-2">
          <span>Eine neue Version ist da.</span>
          <Button size="sm" onClick={applyUpdate}>
            <Download aria-hidden /> Aktualisieren
          </Button>
        </div>
      </Banner>,
    );
  }
  if (needsReauth) {
    banners.push(
      <Banner key="reauth" tone="warn">
        <div className="flex items-center justify-between gap-2">
          <span>Deine Sitzung ist abgelaufen. Deine Daten bleiben auf dem Gerät.</span>
          <Button size="sm" asChild>
            <Link to="/login">
              <LogIn aria-hidden /> Anmelden
            </Link>
          </Button>
        </div>
      </Banner>,
    );
  }
  if (showInstallHint) {
    banners.push(
      <Banner
        key="install"
        onClose={() => {
          localStorage.setItem(HINT_KEY, '1');
          setHintDismissed(true);
        }}
      >
        Für dauerhafte Offline-Daten: Tippe auf{' '}
        <Share className="inline size-4 align-text-bottom" aria-label="Teilen" /> und dann „Zum
        Home-Bildschirm“. Sonst löscht Safari Daten nach 7 Tagen ohne Nutzung.
      </Banner>,
    );
  }
  if (banners.length === 0) return null;
  return <div className="relative z-50 flex flex-col gap-2">{banners}</div>;
}
