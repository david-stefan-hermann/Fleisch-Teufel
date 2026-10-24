import { BellRing } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Page, Section } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useSubmitting } from '@/hooks/useSubmitting';
import { errorMessage } from '@/lib/api';
import {
  DEFAULT_REMIND_AT,
  disableReminder,
  enableReminder,
  readReminder,
  reminderApi,
  reminderBlocker,
  ReminderError,
  type ReminderSettings,
} from '@/lib/reminder';

/**
 * Mehr → Erinnerung: one optional notification a day at a chosen time, only when nothing was logged
 * yet that day, per device. Forgetting is the most common reason diaries stay empty; this is the
 * whole feature, nothing else nudges.
 */
export function ReminderPage() {
  const blocker = reminderBlocker();
  const [server, setServer] = useState<boolean | 'offline' | null>(null);
  // Unsupported browsers have nothing to read; everywhere else the state comes from the browser and server.
  const [current, setCurrent] = useState<ReminderSettings | null | undefined>(() =>
    blocker === 'unsupported' ? null : undefined,
  );
  const [time, setTime] = useState(DEFAULT_REMIND_AT);
  const { busy, run } = useSubmitting();

  useEffect(() => {
    let alive = true;
    reminderApi.config().then(
      (c) => alive && setServer(c.enabled),
      () => alive && setServer('offline'),
    );
    if (blocker !== 'unsupported')
      readReminder().then(
        (r) => {
          if (!alive) return;
          setCurrent(r);
          if (r) setTime(r.remindAt);
        },
        () => alive && setCurrent(null),
      );
    return () => {
      alive = false;
    };
  }, [blocker]);

  const on = !!current;
  const canUse = blocker === null && server === true;

  async function turnOn(at: string) {
    try {
      setCurrent(await enableReminder(at));
      toast.success(`Erinnerung täglich um ${at} Uhr`);
    } catch (e) {
      if (e instanceof ReminderError) {
        if (e.reason === 'permission')
          toast.error(
            'Mitteilungen wurden nicht erlaubt. Erlaube sie in den Einstellungen des Geräts für diese App.',
          );
        else if (e.reason === 'server_disabled')
          toast.error('Der Server kann keine Mitteilungen senden (VAPID-Schlüssel fehlen).');
        else toast.error('Der Service Worker läuft noch nicht. Lade die App einmal neu.');
      } else toast.error(errorMessage(e));
    }
  }

  async function turnOff() {
    await disableReminder();
    setCurrent(null);
    toast('Erinnerung aus');
  }

  return (
    <Page title="Erinnerung" back="/more" withTabBar={false}>
      <Section>
        <div className="flex min-h-14 items-center gap-3 px-4 py-3">
          <BellRing className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          <label htmlFor="reminder-on" className="min-w-0 flex-1">
            <div className="font-medium">Täglich erinnern</div>
            <div className="text-xs text-muted-foreground">
              Nur wenn an dem Tag noch nichts eingetragen ist. Eine Mitteilung, keine Serien.
            </div>
          </label>
          <Switch
            id="reminder-on"
            checked={on}
            disabled={busy || !canUse || current === undefined}
            onCheckedChange={(v) => void run(() => (v ? turnOn(time) : turnOff()))}
          />
        </div>
        <div className="grid gap-1.5 px-4 pb-4">
          <Label htmlFor="reminder-time">Uhrzeit</Label>
          <div className="flex gap-2">
            <Input
              id="reminder-time"
              type="time"
              step={300}
              value={time}
              disabled={busy || !canUse}
              onChange={(e) => e.target.value && setTime(e.target.value)}
              className="w-40"
            />
            {on && current && time !== current.remindAt && (
              <Button variant="outline" disabled={busy} onClick={() => void run(() => turnOn(time))}>
                Übernehmen
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground text-pretty">
            {blocker === 'unsupported'
              ? 'Dieser Browser unterstützt keine Mitteilungen für Web-Apps.'
              : blocker === 'ios_not_installed'
                ? 'Auf dem iPhone gibt es Mitteilungen nur für die installierte App: Teilen → „Zum Home-Bildschirm“, dann hier einschalten.'
                : blocker === 'denied'
                  ? 'Mitteilungen sind für diese App blockiert. Erlaube sie in den Einstellungen des Geräts.'
                  : server === false
                    ? 'Der Server hat keine Schlüssel für Mitteilungen (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY in der .env).'
                    : server === 'offline'
                      ? 'Nur online einzurichten.'
                      : 'Gilt für dieses Gerät und folgt seiner Zeitzone. Abmelden schaltet die Erinnerung aus.'}
          </p>
        </div>
      </Section>
    </Page>
  );
}
