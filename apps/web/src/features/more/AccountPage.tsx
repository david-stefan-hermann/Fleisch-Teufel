import { credentialsSchema } from '@ft/shared';
import { useNavigate } from '@tanstack/react-router';
import { LogOut } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useSessionContext } from '@/app/session';
import { Page, Section } from '@/components/Page';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSyncState } from '@/components/SyncIndicator';
import { endpoints, errorMessage } from '@/lib/api';
import { fmtDate } from '@/lib/format';

export function AccountPage() {
  const { session, signOut } = useSessionContext();
  const navigate = useNavigate();
  const sync = useSyncState();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<null | 'logout' | 'wipe'>(null);
  if (!session) return null;
  const nextValid = credentialsSchema.shape.password.safeParse(next).success;

  return (
    <Page title="Konto" back="/more" withTabBar={false}>
      <Section>
        <dl className="grid gap-1 p-4 text-sm">
          <dt className="text-muted-foreground">E-Mail</dt>
          <dd className="font-medium break-all">{session.user.email}</dd>
          <dt className="mt-2 text-muted-foreground">Konto seit</dt>
          <dd>{fmtDate(session.user.createdAt.slice(0, 10))}</dd>
        </dl>
      </Section>
      <Section title="Passwort ändern">
        <form
          className="grid gap-3 px-4 pb-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await endpoints.changePassword(current, next);
              toast.success('Passwort geändert – andere Geräte wurden abgemeldet');
              setCurrent('');
              setNext('');
            } catch (err) {
              toast.error(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <input type="email" autoComplete="username" value={session.user.email} readOnly hidden />
          <div className="grid gap-1.5">
            <Label htmlFor="pw-current">Aktuelles Passwort</Label>
            <Input
              id="pw-current"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pw-new">Neues Passwort</Label>
            <Input
              id="pw-new"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Mindestens 8 Zeichen.</p>
          </div>
          <Button type="submit" disabled={busy || !current || !nextValid}>
            {busy ? 'Speichere…' : 'Passwort ändern'}
          </Button>
        </form>
      </Section>
      <Section>
        <div className="grid gap-2 p-4">
          <Button variant="outline" onClick={() => setConfirm('logout')}>
            <LogOut aria-hidden /> Abmelden
          </Button>
          <Button variant="ghost" className="text-destructive" onClick={() => setConfirm('wipe')}>
            Abmelden und Daten von diesem Gerät löschen
          </Button>
        </div>
      </Section>
      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm === 'wipe' ? 'Gerätedaten löschen?' : 'Abmelden?'}</DialogTitle>
            <DialogDescription>
              {sync.pending > 0
                ? `Achtung: ${sync.pending} Änderung(en) sind noch nicht synchronisiert und gehen verloren, wenn du die Gerätedaten löschst.`
                : confirm === 'wipe'
                  ? 'Alle Daten bleiben auf dem Server und kommen nach der nächsten Anmeldung zurück.'
                  : 'Deine Daten bleiben auf diesem Gerät.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Abbrechen
            </Button>
            <Button
              variant={confirm === 'wipe' ? 'destructive' : 'default'}
              onClick={async () => {
                await signOut({ wipeLocal: confirm === 'wipe' });
                await navigate({ to: '/login' });
              }}
            >
              {confirm === 'wipe' ? 'Löschen und abmelden' : 'Abmelden'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
