import { SYNC_TABLES, today } from '@ft/shared';
import { useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Copy, Download, RefreshCw, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useSession } from '@/app/session';
import { requestPersistentStorage } from '@/app/pwa';
import { Page, Section } from '@/components/Page';
import { syncLabel, useSyncState } from '@/components/SyncIndicator';
import { Button } from '@/components/ui/button';
import { createBackup, parseBackup, restoreBackup } from '@/db/backup';
import { countRejectedPhotos } from '@/db/photos';
import { canShareFiles, shareOrDownloadText } from '@/features/reports/export';
import { clearErrorLog, errorLogText, useErrorLog } from '@/lib/errorLog';
import { errorMessage } from '@/lib/api';
import { fmtAgo, fmt0, fmt1, fmtTime, fmtDate } from '@/lib/format';

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
  const errors = useErrorLog();
  const restoreInput = useRef<HTMLInputElement>(null);
  const [restoring, setRestoring] = useState(false);

  async function restore(file: File) {
    setRestoring(true);
    try {
      const backup = parseBackup(await file.text());
      const r = await restoreBackup(db, backup);
      const invalid = Object.values(r.invalid).reduce((a, b) => a + b, 0);
      toast.success(`${r.restored} Datensätze wiederhergestellt`, {
        description: `${r.unchanged} waren schon aktuell${invalid ? `, ${invalid} passten nicht zu dieser App-Version` : ''}. Sie werden mit dem nächsten Abgleich hochgeladen.`,
      });
    } catch (e) {
      toast.error(e instanceof Error && !(e instanceof TypeError) ? e.message : errorMessage(e));
    } finally {
      setRestoring(false);
    }
  }
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
              <Button variant="ghost" size="sm" className="mt-2" onClick={() => void sync.clearRejected()}>
                Liste leeren
              </Button>
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
          <p className="text-sm text-muted-foreground text-pretty">
            Deine Daten gehören dir und sind jederzeit vollständig exportierbar: alles als JSON, zusätzlich
            zur Synchronisation mit dem Server. CSV-Exporte (Einträge, Tageswerte, Gewicht, Training) findest
            du unter Berichte.
          </p>
          <Button
            variant="outline"
            onClick={async () => {
              const dump = await createBackup(db, __APP_VERSION__);
              await shareOrDownloadText(
                `fleisch-teufel_backup_${today()}.json`,
                JSON.stringify(dump, null, 1),
                'application/json',
              );
            }}
          >
            <Download aria-hidden /> JSON-Sicherung {canShareFiles() ? 'teilen' : 'herunterladen'}
          </Button>
          <input
            ref={restoreInput}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void restore(file);
            }}
          />
          <Button variant="ghost" disabled={restoring} onClick={() => restoreInput.current?.click()}>
            <Upload aria-hidden /> Aus JSON-Sicherung wiederherstellen
          </Button>
          <p className="text-xs text-muted-foreground">
            Spielt nur Datensätze ein, die neuer sind als die auf diesem Gerät; nichts wird gelöscht. Fotos
            sind nicht Teil der Sicherung.
          </p>
        </div>
      </Section>
      <Section title="Fehlerprotokoll">
        <div className="grid gap-2 px-4 pb-4 text-sm">
          {errors.length === 0 ? (
            <p className="text-muted-foreground">Keine Fehler aufgezeichnet.</p>
          ) : (
            <>
              <ul className="grid max-h-60 gap-2 overflow-y-auto text-xs">
                {errors.map((e) => (
                  <li key={e.at} className="break-words">
                    <span className="text-muted-foreground">
                      {fmtDate(new Date(e.at).toISOString().slice(0, 10))} {fmtTime(e.at)} · {e.source}
                    </span>
                    <br />
                    {e.message}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void navigator.clipboard?.writeText(errorLogText(errors)).then(
                      () => toast.success('Protokoll kopiert'),
                      () => toast.error('Kopieren nicht möglich'),
                    )
                  }
                >
                  <Copy aria-hidden /> Kopieren
                </Button>
                <Button variant="ghost" size="sm" onClick={clearErrorLog}>
                  Protokoll leeren
                </Button>
              </div>
            </>
          )}
          <p className="text-xs text-muted-foreground">
            Unerwartete Fehler dieser App auf diesem Gerät, für die Fehlersuche. Nichts wird gesendet.
          </p>
        </div>
      </Section>
    </Page>
  );
}
