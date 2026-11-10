import { DEFAULT_STEPS_MINIMUM } from '@ft/shared';
import { ChevronDown, Copy, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { isIos } from '@/app/pwa';
import { useSession } from '@/app/session';
import { NumberField } from '@/components/NumberField';
import { Page, Section } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { saveSettings } from '@/db/settings';
import { useSettings, useToday } from '@/hooks/data';
import { useSubmitting } from '@/hooks/useSubmitting';
import { fmtDateOf } from '@/lib/format';
import {
  fmtReceived,
  refreshStepsStatus,
  runStepsShortcut,
  stepsApi,
  stepsImportUrl,
  STEPS_SHORTCUT_NAME,
  useStepsRunning,
  useStepsStatus,
} from '@/lib/steps';
import { cn } from '@/lib/utils';

/**
 * Mehr → Schritte: the personal access for the iOS shortcut that sends steps from Apple Health,
 * the minimum from which a day gets an entry, and the shortcut's actions as numbered steps (they are
 * set up by hand once, like the iOS install). The token is shown right after it was made, never again.
 */
export function StepsSettingsPage() {
  const { db, sync } = useSession();
  const status = useStepsStatus();
  const today = useToday();
  const running = useStepsRunning();
  const [token, setToken] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'replace' | 'delete' | null>(null);
  const [guideOpen, setGuideOpen] = useState<boolean | null>(null);
  const { busy, run } = useSubmitting();
  const ios = isIos();

  useEffect(() => {
    void refreshStepsStatus(db);
  }, [db]);

  const configured = !!status?.configured;
  // The guide is open until the access exists (and while its token is on screen), then closed.
  const open = guideOpen ?? (!configured || token !== null);

  async function create() {
    const { token: t } = await stepsApi.createToken();
    setToken(t);
    setConfirm(null);
    await refreshStepsStatus(db);
  }

  async function remove() {
    await stepsApi.deleteToken();
    setToken(null);
    setConfirm(null);
    await refreshStepsStatus(db);
    toast('Zugang gelöscht');
  }

  return (
    <Page title="Schritte" back withTabBar={false}>
      <Section title="Apple Health">
        {status === undefined ? null : token ? (
          <div className="grid gap-3 px-4 pb-4">
            <Secret label="Zugang" value={token} />
            <p className="-mt-1.5 text-xs text-muted-foreground">Nur jetzt sichtbar.</p>
            <Secret label="Adresse" value={stepsImportUrl()} />
          </div>
        ) : configured ? (
          <>
            <dl className="divide-y divide-border/70 text-sm">
              <div className="flex min-h-12 items-center justify-between gap-3 px-4">
                <dt>Zuletzt empfangen</dt>
                <dd className="tabular text-muted-foreground">
                  {status!.lastUsedAt ? fmtReceived(status!.lastUsedAt, today) : 'noch nie'}
                </dd>
              </div>
              {status!.createdAt && (
                <div className="flex min-h-12 items-center justify-between gap-3 px-4">
                  <dt>Eingerichtet</dt>
                  <dd className="tabular text-muted-foreground">{fmtDateOf(status!.createdAt)}</dd>
                </div>
              )}
            </dl>
            <div className="grid gap-2 px-4 pt-2 pb-4">
              {ios && (
                <Button disabled={running} onClick={() => void runStepsShortcut(db, () => sync.sync())}>
                  <RefreshCw className={cn(running && 'animate-spin')} aria-hidden />
                  Jetzt abrufen
                </Button>
              )}
              <Button variant="outline" disabled={busy} onClick={() => setConfirm('replace')}>
                Zugang ersetzen
              </Button>
              <Button
                variant="outline"
                className="text-destructive"
                disabled={busy}
                onClick={() => setConfirm('delete')}
              >
                Zugang löschen
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex min-h-12 items-center justify-between gap-3 px-4 text-sm">
              <span>Zugang</span>
              <span className="text-muted-foreground">nicht eingerichtet</span>
            </div>
            <div className="px-4 pt-1 pb-4">
              <Button className="w-full" disabled={busy} onClick={() => void run(create)}>
                Zugang erstellen
              </Button>
            </div>
          </>
        )}
      </Section>

      <Collapsible open={open} onOpenChange={setGuideOpen}>
        <Section
          title="Kurzbefehl"
          action={
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={open ? 'Anleitung zuklappen' : 'Anleitung aufklappen'}
              >
                <ChevronDown
                  className={cn('transition-transform motion-reduce:transition-none', open && 'rotate-180')}
                  aria-hidden
                />
              </Button>
            </CollapsibleTrigger>
          }
        >
          <CollapsibleContent>
            <ShortcutGuide />
          </CollapsibleContent>
        </Section>
      </Collapsible>

      <MinimumSection />

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm === 'delete' ? 'Zugang löschen?' : 'Zugang ersetzen?'}</DialogTitle>
            <DialogDescription>
              {confirm === 'delete'
                ? 'Der Kurzbefehl kann dann keine Schritte mehr senden. Eingetragene Schritte bleiben.'
                : 'Der bisherige Zugang hört sofort auf zu gelten; der Kurzbefehl braucht den neuen.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Abbrechen
            </Button>
            <Button
              variant={confirm === 'delete' ? 'destructive' : 'default'}
              disabled={busy}
              onClick={() => void run(confirm === 'delete' ? remove : create)}
            >
              {confirm === 'delete' ? 'Löschen' : 'Ersetzen'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}

/** A value to copy into the shortcut (token, address). */
function Secret({ label, value }: { label: string; value: string }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} kopiert`);
    } catch {
      toast.error('Kopieren nicht möglich');
    }
  }
  return (
    <div className="grid gap-1.5">
      <div className="text-sm font-medium">{label}</div>
      <div className="flex items-center gap-2 rounded-xl border border-input bg-background py-2 pr-2 pl-3">
        <code className="min-w-0 flex-1 font-mono text-[0.8125rem] leading-snug break-all select-all">
          {value}
        </code>
        <Button variant="secondary" size="sm" onClick={() => void copy()} aria-label={`${label} kopieren`}>
          <Copy aria-hidden />
          Kopieren
        </Button>
      </div>
    </div>
  );
}

const K = ({ children }: { children: string }) => (
  <code className="rounded bg-muted px-1 py-px font-mono text-xs text-foreground">{children}</code>
);

/** The shortcut's actions and the automation: steps iOS makes everyone do by hand. */
function ShortcutGuide() {
  // No grid on the items: a grid list item loses its number.
  const item = 'pl-1 [&>span]:block';
  const sub = 'mt-0.5 text-xs text-muted-foreground';
  return (
    <ol className="list-decimal space-y-2.5 pr-4 pb-4 pl-9 text-sm marker:text-muted-foreground">
      <li className={item}>
        <span className="font-medium">Einstellungen → Kurzbefehle → Erweitert</span>
        <span className={sub}>Teilen großer Datenmengen erlauben</span>
      </li>
      <li className={item}>
        <span className="font-medium">Health-Messungen suchen</span>
        <span className={sub}>
          Steps · Startdatum in den letzten 7 Tagen · Einheit Anzahl · Gruppieren nach Tag
        </span>
      </li>
      <li className={item}>
        <span className="font-medium">Health-Messungen suchen</span>
        <span className={sub}>
          Strecke (Gehen und Laufen) · Startdatum in den letzten 7 Tagen · Einheit km · Gruppieren nach Tag
        </span>
      </li>
      <li className={item}>
        <span className="font-medium">Inhalte von URL abrufen</span>
        <span className={cn(sub, 'leading-relaxed')}>
          Adresse · Methode POST · Header <K>Authorization</K>: <K>Bearer</K>, Leerzeichen, Zugang ·
          Anfragetext JSON, Felder vom Typ Text: <K>stepDates</K> und <K>stepValues</K> (Startdatum und Wert
          aus 2), <K>distanceDates</K> und <K>distanceValues</K> (aus 3), <K>now</K> (Aktuelles Datum) · jedes
          Datum: Datumsformat Eigenes <K>yyyy-MM-dd</K>
        </span>
      </li>
      <li className={item}>
        <span className="font-medium">Name</span>
        <span className={sub}>{STEPS_SHORTCUT_NAME}</span>
      </li>
      <li className={item}>
        <span className="font-medium">Automation → + → Tageszeit</span>
        <span className={sub}>
          Zeiten wählen (z. B. 12:00, 18:00, 22:00) · Sofort ausführen · {STEPS_SHORTCUT_NAME}
        </span>
      </li>
    </ol>
  );
}

/** "Eintragen ab": a day gets a steps entry from this many steps on (saved when the field is left). */
function MinimumSection() {
  const settings = useSettings();
  const { db } = useSession();
  if (!settings) return null;
  return (
    <MinimumField
      key={settings.stepsMinimum ?? 'default'}
      initial={settings.stepsMinimum}
      save={(v) => saveSettings(db, { stepsMinimum: v })}
    />
  );
}

function MinimumField({
  initial,
  save,
}: {
  initial: number | null;
  save: (v: number | null) => Promise<unknown>;
}) {
  const [value, setValue] = useState<number | null>(initial ?? DEFAULT_STEPS_MINIMUM);
  const valid = value !== null && value >= 0 && value <= 100_000;
  return (
    <Section title="Eintragen ab">
      <div className="px-4 pb-4">
        <NumberField
          aria-label="Eintragen ab"
          value={value}
          unit="Schritte"
          integer
          onValueChange={setValue}
          error={valid ? null : '0 bis 100.000 Schritte.'}
          onBlur={() => {
            if (!valid) return;
            const next = Math.round(value) === DEFAULT_STEPS_MINIMUM ? null : Math.round(value);
            if (next !== initial) void save(next);
          }}
        />
      </div>
    </Section>
  );
}
