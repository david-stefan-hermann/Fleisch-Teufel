import { Link } from '@tanstack/react-router';
import { Download, EllipsisVertical, LogIn, Share, SquarePlus, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { encode } from 'uqr';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ICON_FILES, useAppearance } from '@/lib/appearance';
import { cn } from '@/lib/utils';
import { useSessionContext } from './session';
import {
  applyUpdate,
  isAndroid,
  isDesktop,
  isIos,
  isStandalone,
  promptInstall,
  useInstallState,
  useUpdateReady,
} from './pwa';

/** Set once the install banner was closed; it never comes back on this device. */
export const INSTALL_DISMISSED_KEY = 'ft.installHintDismissed';
/** The install banner slides in this long after the start (once no other banner is up). */
export const INSTALL_DELAY_MS = 3000;

function Banner({
  children,
  onClose,
  tone = 'default',
  className,
}: {
  children: ReactNode;
  onClose?: () => void;
  tone?: 'default' | 'warn';
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'mx-auto mt-[calc(var(--safe-top)+0.5rem)] flex w-[calc(100%-1rem)] max-w-xl items-center gap-3 rounded-xl border px-3 py-2 text-sm shadow-sm',
        tone === 'warn' ? 'border-warn/40 bg-warn/10' : 'border-border bg-card',
        className,
      )}
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

/** Where the app runs in a browser; null when it already runs installed. */
type Platform = 'ios' | 'android' | 'desktop' | 'other';

function installPlatform(): Platform | null {
  if (isStandalone()) return null;
  if (isIos()) return 'ios';
  if (isAndroid()) return 'android';
  if (isDesktop()) return 'desktop';
  return 'other';
}

function readDismissed(): boolean {
  try {
    return localStorage.getItem(INSTALL_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function AppIcon({ size }: { size: number }) {
  const { iconMode } = useAppearance();
  return (
    <img
      src={ICON_FILES[iconMode].touch}
      width={size}
      height={size}
      alt=""
      className="shrink-0 rounded-[22%] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)]"
    />
  );
}

/**
 * Banners at the top of the app. Only one shows at a time, by priority: session expired, then a
 * new version, then the install banner. Banners push the content down, they never cover it.
 *
 * The install banner ("get the app", like the store banners of many sites) slides in
 * `INSTALL_DELAY_MS` after the start, only in the browser and only while no other banner is up.
 * Its button depends on the device: iPhone shows the three Safari steps (Safari cannot install
 * from a script), Android opens Chrome's install dialog (or the menu steps without one), a
 * computer shows a QR code of the app for the phone. Closing it hides it for good.
 */
export function AppBanners() {
  const { needsReauth } = useSessionContext();
  const updateReady = useUpdateReady();
  const { canPrompt, installed } = useInstallState();
  const [platform] = useState(installPlatform);
  const [dismissed, setDismissed] = useState(readDismissed);
  const [dialog, setDialog] = useState<'ios' | 'android' | 'qr' | null>(null);
  const eligible = !dismissed && !installed && platform !== null && (platform !== 'other' || canPrompt);
  const otherBanner = needsReauth || updateReady;
  // The delay runs only while nothing else is shown; once due, the banner waits for its turn.
  const [due, setDue] = useState(false);
  useEffect(() => {
    if (!eligible || otherBanner || due) return;
    const timer = setTimeout(() => setDue(true), INSTALL_DELAY_MS);
    return () => clearTimeout(timer);
  }, [eligible, otherBanner, due]);

  function dismiss() {
    try {
      localStorage.setItem(INSTALL_DISMISSED_KEY, '1');
    } catch {
      // Private mode: hidden until the app is closed.
    }
    setDismissed(true);
  }

  async function install() {
    if (platform === 'ios') return setDialog('ios');
    if (platform === 'desktop') return setDialog('qr');
    if (canPrompt) {
      // Installed: `appinstalled` hides the banner. Dismissed: Chrome may offer it again later.
      await promptInstall();
      return;
    }
    setDialog('android');
  }

  let banner: ReactNode = null;
  if (needsReauth) {
    banner = (
      <Banner key="reauth" tone="warn">
        <div className="flex items-center justify-between gap-2">
          <span>Deine Sitzung ist abgelaufen. Deine Daten bleiben auf dem Gerät.</span>
          <Button size="sm" asChild>
            <Link to="/login">
              <LogIn aria-hidden /> Anmelden
            </Link>
          </Button>
        </div>
      </Banner>
    );
  } else if (updateReady) {
    banner = (
      <Banner key="update">
        <div className="flex items-center justify-between gap-2">
          <span>Eine neue Version ist da.</span>
          <Button size="sm" onClick={applyUpdate}>
            <Download aria-hidden /> Aktualisieren
          </Button>
        </div>
      </Banner>
    );
  } else if (eligible && due) {
    banner = (
      <Banner
        key="install"
        onClose={dismiss}
        className="py-2 pr-1.5 pl-2 animate-in duration-300 fade-in slide-in-from-top-8 motion-reduce:animate-none"
      >
        <div className="flex items-center gap-2.5">
          <AppIcon size={40} />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate font-semibold">Fleisch-Teufel</div>
            <div className="text-xs text-muted-foreground">
              {platform === 'desktop' ? 'Als App aufs Handy holen, kostenlos' : 'Kostenlos, ohne App Store'}
            </div>
          </div>
          <Button size="sm" className="shrink-0" onClick={() => void install()}>
            {platform === 'desktop' ? 'Aufs Handy' : 'Installieren'}
          </Button>
        </div>
      </Banner>
    );
  }

  return (
    <>
      {banner && <div className="relative z-50">{banner}</div>}
      <InstallDialog kind={dialog} onClose={() => setDialog(null)} />
    </>
  );
}

const inlineIcon = 'mx-0.5 inline size-4 align-[-0.15em]';

/** Steps for the iPhone (Safari) and for Android without Chrome's dialog, or the QR code for a computer. */
function InstallDialog({ kind, onClose }: { kind: 'ios' | 'android' | 'qr' | null; onClose: () => void }) {
  const content =
    kind === 'ios'
      ? {
          title: 'Zum Home-Bildschirm hinzufügen',
          description:
            'Dann startet Fleisch-Teufel wie eine App, im Vollbild und mit dauerhaft gespeicherten Daten.',
          body: (
            <ol className="grid list-decimal gap-2 pl-5 text-sm">
              <li>
                In Safari auf <Share className={inlineIcon} aria-hidden /> <b>Teilen</b> tippen.
              </li>
              <li>
                <b>„Zum Home-Bildschirm“</b> <SquarePlus className={inlineIcon} aria-hidden /> wählen.
              </li>
              <li>
                Oben rechts <b>„Hinzufügen“</b> tippen.
              </li>
            </ol>
          ),
        }
      : kind === 'android'
        ? {
            title: 'App installieren',
            description:
              'Dann startet Fleisch-Teufel wie eine App, im Vollbild und mit dauerhaft gespeicherten Daten.',
            body: (
              <ol className="grid list-decimal gap-2 pl-5 text-sm">
                <li>
                  In Chrome oben rechts auf <EllipsisVertical className={inlineIcon} aria-hidden />{' '}
                  <b>Menü</b> tippen.
                </li>
                <li>
                  <b>„App installieren“</b> oder <b>„Zum Startbildschirm hinzufügen“</b> wählen.
                </li>
              </ol>
            ),
          }
        : {
            title: 'Fleisch-Teufel aufs Handy holen',
            description: 'Code mit der Handykamera scannen, dann im Browser installieren.',
            body: (
              <div className="grid gap-3">
                <QrCode text={appUrl()} className="size-48 justify-self-center" />
                <p className="text-center text-xs break-all text-muted-foreground select-all">{appUrl()}</p>
                <ul className="grid gap-1.5 text-sm">
                  <li>
                    <b>iPhone:</b> in Safari öffnen, Teilen, „Zum Home-Bildschirm“.
                  </li>
                  <li>
                    <b>Android:</b> in Chrome öffnen, „Installieren“ antippen.
                  </li>
                </ul>
              </div>
            ),
          };
  return (
    <Dialog open={kind !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader className="flex-row items-center gap-3 text-left">
          <AppIcon size={56} />
          <div className="grid gap-1">
            <DialogTitle>{content.title}</DialogTitle>
            <DialogDescription>{content.description}</DialogDescription>
          </div>
        </DialogHeader>
        <DialogBody>{content.body}</DialogBody>
        <DialogFooter>
          <Button variant={kind === 'qr' ? 'outline' : 'default'} onClick={onClose}>
            {kind === 'qr' ? 'Schließen' : 'Verstanden'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const appUrl = () => `${window.location.origin}/`;

/** QR code drawn as one SVG path, dark on white whatever the theme (cameras need the contrast). */
export function QrCode({ text, className }: { text: string; className?: string }) {
  const { data, size } = encode(text, { ecc: 'M', border: 2 });
  let d = '';
  data.forEach((row, y) =>
    row.forEach((on, x) => {
      if (on) d += `M${x} ${y}h1v1h-1z`;
    }),
  );
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={`QR-Code: ${text}`}
      className={cn('rounded-lg bg-white', className)}
    >
      <path d={d} fill="#111" />
    </svg>
  );
}
