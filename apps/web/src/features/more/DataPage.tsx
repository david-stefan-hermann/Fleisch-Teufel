import { SYNC_TABLES } from '@ft/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { Download, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useSession } from '@/app/session';
import { requestPersistentStorage } from '@/app/pwa';
import { Page, Section } from '@/components/Page';
import { syncLabel, useSyncState } from '@/components/SyncIndicator';
import { Button } from '@/components/ui/button';
import { countRejectedPhotos } from '@/db/photos';
import { downloadText } from '@/features/reports/export';
import { fmtAgo, fmt0, fmt1 } from '@/lib/format';

export function DataPage() {
  const { db, sync } = useSession();
  const state = useSyncState();
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const counts = useLiveQuery(async () => {
    const out: Record<string, number> = {};
    for (const t of SYNC_TABLES)
      out[t] = await db
        .syncTable(t)
        .filter((r) => !r.deleted)
        .count();
    return out;
  }, [db]);
  const rejectedPhotos = useLiveQuery(() => countRejectedPhotos(db), [db]);
  const rejected = useLiveQuery(
    async () =>
      ((await db.kv.get('sync.rejected'))?.value as
        { table: string; id: string | null; error: string }[] | undefined) ?? [],
    [db],
  );

  useEffect(() => {
    void navigator.storage?.persisted?.().then(setPersisted);
    void navigator.storage?.estimate?.().then((e) => setUsage({ usage: e.usage ?? 0, quota: e.quota ?? 0 }));
  }, []);

  const labels: Record<string, string> = {
    foodEntries: 'Tagebuch-Einträge',
    weightEntries: 'Gewichtseinträge',
    exerciseEntries: 'Trainings',
    customFoods: 'Eigene Lebensmittel',
    meals: 'Gespeicherte Meals',
    goals: 'Ziel-Versionen',
    dayNotes: 'Tagesnotizen',
    foodPortions: 'Eigene Portionen',
    exerciseTypes: 'Eigene Sportarten',
    exerciseTemplates: 'Gespeicherte Trainings',
    settings: 'Einstellungen',
  };
  const clockMinutes = Math.round(Math.abs(state.clockOffset) / 60_000);

  return (
    <Page title="Daten & Sync" back="/more" withTabBar={false}>
      <Section title="Synchronisation">
        <div className="grid gap-3 px-4 pb-4 text-sm">
          <p>{syncLabel(state)}</p>
          {state.lastSyncAt && (
            <p className="text-muted-foreground">
              Letzter erfolgreicher Abgleich {fmtAgo(state.lastSyncAt)}.
            </p>
          )}
          <p className="text-muted-foreground">{state.pending} lokale Änderung(en) warten auf Upload.</p>
          {state.needsUpdate && (
            <p className="rounded-lg bg-warn/10 p-3">
              Der Server hat Daten einer neueren App-Version geschickt, die diese Version noch nicht kennt.
              Sie werden nach dem App-Update nachgeladen (Alles neu vom Server laden).
            </p>
          )}
          {clockMinutes >= 1 && (
            <p className="rounded-lg bg-warn/10 p-3">
              Die Uhr dieses Geräts geht etwa {fmt0(clockMinutes)} Minute(n){' '}
              {state.clockOffset < 0 ? 'vor' : 'nach'}. Änderungen werden mit der Serverzeit versehen, damit
              der Abgleich zwischen Geräten stimmt.
            </p>
          )}
          {!!rejectedPhotos && (
            <p className="text-muted-foreground">
              {rejectedPhotos} Foto(s) hat der Server endgültig abgelehnt (zu groß oder kein Bild); sie
              bleiben nur auf diesem Gerät.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() =>
                void sync.sync().then(
                  (r) => toast.success(`Synchronisiert: ${r.pushed} hoch, ${r.pulled} runter`),
                  () => toast.error('Server nicht erreichbar'),
                )
              }
            >
              <RefreshCw aria-hidden /> Jetzt synchronisieren
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                void sync.resetAndPull().then(
                  (n) => toast.success(`${n} Datensätze neu geladen`),
                  () => toast.error('Server nicht erreichbar'),
                )
              }
            >
              Alles neu vom Server laden
            </Button>
          </div>
          {rejected && rejected.length > 0 && (
            <details className="rounded-lg bg-warn/10 p-3">
              <summary>{rejected.length} Datensätze wurden vom Server abgelehnt</summary>
              <ul className="mt-2 grid gap-1 text-xs">
                {rejected.map((r, i) => (
                  <li key={i}>
                    {r.table} {r.id}: {r.error}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </Section>
      <Section title="Auf diesem Gerät">
        <dl className="tabular grid grid-cols-2 gap-x-4 gap-y-1 px-4 pb-4 text-sm">
          {counts &&
            Object.entries(counts).map(([t, n]) => (
              <div key={t} className="contents">
                <dt className="text-muted-foreground">{labels[t] ?? t}</dt>
                <dd className="text-right">{n}</dd>
              </div>
            ))}
          {usage && (
            <>
              <dt className="mt-2 text-muted-foreground">Speicher belegt</dt>
              <dd className="mt-2 text-right">{fmt1(usage.usage / 1024 / 1024)} MB</dd>
            </>
          )}
          <dt className="text-muted-foreground">Dauerhafter Speicher</dt>
          <dd className="text-right">{persisted === null ? 'unbekannt' : persisted ? 'ja' : 'nein'}</dd>
        </dl>
        {persisted === false && (
          <div className="px-4 pb-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void requestPersistentStorage().then((p) => setPersisted(p ?? null))}
            >
              Dauerhaften Speicher anfordern
            </Button>
            <p className="mt-1 text-xs text-muted-foreground">
              Auf dem iPhone ist der Speicher dauerhaft, wenn die App vom Home-Bildschirm gestartet wird.
            </p>
          </div>
        )}
      </Section>
      <Section title="Sicherung">
        <div className="grid gap-2 px-4 pb-4">
          <p className="text-sm text-muted-foreground">
            Alle deine Daten als JSON, zusätzlich zur Synchronisation mit dem Server. CSV-Exporte findest du
            unter Berichte.
          </p>
          <Button
            variant="outline"
            onClick={async () => {
              const dump: Record<string, unknown> = {
                app: 'fleisch-teufel',
                exportedAt: new Date().toISOString(),
                version: __APP_VERSION__,
              };
              for (const t of SYNC_TABLES) dump[t] = await db.syncTable(t).toArray();
              downloadText(
                `fleisch-teufel_backup_${new Date().toISOString().slice(0, 10)}.json`,
                JSON.stringify(dump, null, 1),
                'application/json',
              );
            }}
          >
            <Download aria-hidden /> JSON-Sicherung herunterladen
          </Button>
        </div>
      </Section>
    </Page>
  );
}
