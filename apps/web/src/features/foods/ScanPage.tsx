import { useNavigate, useSearch } from '@tanstack/react-router';
import { Keyboard, LoaderCircle, PackageSearch } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useDb } from '@/app/session';
import { BarcodeScanner, validGtin, type ScannerError } from '@/components/BarcodeScanner';
import { Page } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { lookupBarcode } from '@/foods/foodService';

const ERRORS: Record<ScannerError, string> = {
  permission:
    'Kein Kamerazugriff. Erlaube die Kamera in den iOS-Einstellungen (Safari → Kamera) oder gib den Code unten ein.',
  'no-camera': 'Keine Kamera gefunden. Gib den Code unten ein.',
  unsupported: 'Dieser Browser unterstützt keinen Kamerazugriff. Gib den Code unten ein.',
  other: 'Die Kamera konnte nicht gestartet werden. Gib den Code unten ein.',
};

type State =
  | { kind: 'scanning' }
  | { kind: 'looking'; code: string }
  | { kind: 'notfound'; code: string }
  | { kind: 'offline'; code: string }
  | { kind: 'error'; code: string };

export function ScanPage() {
  const { date, meal } = useSearch({ from: '/authed/scan' });
  const navigate = useNavigate();
  const db = useDb();
  const [state, setState] = useState<State>({ kind: 'scanning' });
  const [camError, setCamError] = useState<ScannerError | null>(null);
  const [manual, setManual] = useState('');

  const handle = useCallback(
    async (code: string) => {
      setState({ kind: 'looking', code });
      const r = await lookupBarcode(db, code);
      if (r.status === 'found')
        await navigate({
          to: '/food/$foodId',
          params: { foodId: r.food.id },
          search: { date, meal },
          replace: true,
        });
      else if (r.status === 'not_found') setState({ kind: 'notfound', code });
      else if (r.status === 'offline') setState({ kind: 'offline', code });
      else setState({ kind: 'error', code });
    },
    [db, navigate, date, meal],
  );
  const onError = useCallback((e: ScannerError) => setCamError(e), []);

  return (
    <Page title="Barcode scannen" back withTabBar={false}>
      {!camError ? (
        <BarcodeScanner
          onDetected={(c) => void handle(c)}
          onError={onError}
          paused={state.kind !== 'scanning'}
        />
      ) : (
        <p role="alert" className="rounded-xl bg-muted p-4 text-sm">
          {ERRORS[camError]}
        </p>
      )}

      <div className="mt-4 min-h-24" aria-live="polite">
        {state.kind === 'scanning' && !camError && (
          <p className="text-center text-sm text-muted-foreground">Halte den Barcode in den Rahmen.</p>
        )}
        {state.kind === 'looking' && (
          <p className="flex items-center justify-center gap-2 text-sm">
            <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> Suche{' '}
            {state.code}…
          </p>
        )}
        {state.kind === 'notfound' && (
          <div className="grid gap-3 rounded-xl border p-4">
            <p className="flex items-center gap-2 font-medium">
              <PackageSearch className="size-5" aria-hidden /> Produkt {state.code} unbekannt
            </p>
            <p className="text-sm text-muted-foreground">
              Lege es einmal selbst an – danach findest du es beim nächsten Scan sofort.
            </p>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={() =>
                  void navigate({
                    to: '/custom-food/$id',
                    params: { id: 'new' },
                    search: { barcode: state.code, date, meal },
                  })
                }
              >
                Produkt anlegen
              </Button>
              <Button variant="outline" onClick={() => setState({ kind: 'scanning' })}>
                Weiter scannen
              </Button>
            </div>
          </div>
        )}
        {(state.kind === 'offline' || state.kind === 'error') && (
          <div className="grid gap-3 rounded-xl border p-4">
            <p className="text-sm">
              {state.kind === 'offline'
                ? `Offline: ${state.code} ist noch nicht auf dem Gerät. Prüfe die Verbindung (WireGuard) oder lege das Produkt selbst an.`
                : 'Open Food Facts antwortet gerade nicht. Versuche es gleich noch einmal.'}
            </p>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={() => void handle(state.code)}>
                Erneut versuchen
              </Button>
              <Button variant="outline" onClick={() => setState({ kind: 'scanning' })}>
                Weiter scannen
              </Button>
            </div>
          </div>
        )}
      </div>

      <form
        className="mt-2 grid gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          const code = manual.replace(/\D/g, '');
          if (code) void handle(code);
        }}
      >
        <Label htmlFor="manual-code" className="flex items-center gap-2">
          <Keyboard className="size-4" aria-hidden /> Code eingeben
        </Label>
        <div className="flex gap-2">
          <Input
            id="manual-code"
            inputMode="numeric"
            autoComplete="off"
            placeholder="z. B. 4000417025005…"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            aria-invalid={manual.length >= 8 && !validGtin(manual.replace(/\D/g, '')) ? true : undefined}
          />
          <Button type="submit" disabled={manual.replace(/\D/g, '').length < 8}>
            Suchen
          </Button>
        </div>
      </form>
    </Page>
  );
}
