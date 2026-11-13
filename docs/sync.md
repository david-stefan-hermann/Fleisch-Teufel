# Sync-Protokoll

Fleisch-Teufel ist **offline-first**: Jede Änderung landet zuerst in IndexedDB auf dem Gerät und wird
später mit dem Server abgeglichen. Der Abgleich ist ein einfacher **Last-Write-Wins-REST-Sync**. Für
1 bis 3 Nutzer:innen mit wenigen Geräten reicht das und bleibt nachvollziehbar.

## Datensätze

Jeder synchronisierte Datensatz (Tabellen siehe `SYNC_SCHEMAS` in `packages/shared/src/schemas.ts`) hat:

| Feld                    | Bedeutung                                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                    | auf dem Gerät erzeugt (UUID v7) oder **deterministisch** bei „einmal pro Tag“: `w:2026-10-07` (Gewicht), `n:…` (Notiz), `g:…` (Ziel ab Datum), `s:…` (Schritte), `profile` (Einstellungen) |
| `updatedAt`             | Epoch-ms der letzten lokalen Änderung, streng monoton je Datensatz (`nextVersion`)                                                                                                         |
| `deleted`               | Soft-Delete („Grabstein“), damit Löschungen synchronisieren                                                                                                                                |
| `user_id`, `change_seq` | nur serverseitig: Besitzer und Cursor (globale Sequenz `sync_seq`)                                                                                                                         |

**JSON-Sicherung** („Daten & Sync“, `apps/web/src/db/backup.ts`): „Wiederherstellen“ holt nur Fehlendes
zurück. Die Seite synchronisiert vorher (ohne Server kein Einspielen), dann geht jeder Datensatz der
Sicherung über `importRecord` mit seinem alten `updatedAt` in die Outbox, sofern er gegen den Stand des
Geräts gewinnt. Gegen den Server entscheidet dieselbe LWW-Regel: eine Änderung oder Löschung nach der
Sicherung ist neuer und gewinnt, Gelöschtes bleibt gelöscht. Grabsteine der Sicherung werden übersprungen.

Grabsteine werden nie entfernt. Darauf baut der **Papierkorb** (Mehr → Papierkorb, `apps/web/src/db/trash.ts`)
auf: er zeigt gelöschte Gewichtseinträge, Schritte, Meals und gespeicherte Trainings (`exerciseTemplates`), „Wiederherstellen“ ist ein normaler Schreibvorgang
(`restoreRecord`: `deleted: false` mit neuer Version) und erreicht so alle Geräte. „Endgültig löschen“
(„Alle löschen“ je Abschnitt, „Papierkorb leeren“) entfernt den Grabstein nicht, weil das Protokoll kein
Purge kennt: es setzt das synchronisierte Feld `purgedAt` (Epoch-ms, `purgeRecords` in einer Transaktion,
eine neue Version wie jede Änderung) auf `weightEntries`, `meals`, `exerciseTemplates` und `exerciseEntries`
(`PURGEABLE_TABLES` in `apps/web/src/db/write.ts`). Der Papierkorb zeigt nur `deleted && !purgedAt`. Jeder
Schreibvorgang, der einen Datensatz lebendig macht (Wiederherstellen, neues Gewicht am selben Tag), setzt
`purgedAt` auf `null`; wird er später wieder gelöscht, steht er wieder im Papierkorb. LWW entscheidet
zwischen Endgültig-Löschen auf einem und Wiederherstellen auf einem anderen Gerät: die neuere Version gilt
überall. Eine ältere App-Version ohne das Feld zeigt ausgeblendete Datensätze weiter in ihrem Papierkorb;
stellt sie einen wieder her, lebt er (hingenommen). Gewicht hat die deterministische ID `w:<Datum>`: ein
neues Gewicht am selben Tag überschreibt den Grabstein, der Eintrag verschwindet dann aus dem Papierkorb.

Nicht synchronisiert werden Entwürfe auf dem Gerät: der Meal-Editor schreibt ungespeicherte Änderungen nach
`kv` (`mealDraft:<id>`, ein neues Foto als Bytes unter `mealDraftPhoto:<id>`, `apps/web/src/db/mealDraft.ts`).
Erst „Speichern“ macht daraus einen normalen Schreibvorgang auf `meals` (und legt das Foto in `photos` an, das
dann hochgeladen wird). Ein verworfener Entwurf hinterlässt so weder Outbox-Einträge noch verwaiste Fotos.
Genauso der Gruppen-Editor im Tagebuch: `groupDraft:<id>`, neue Fotos als Bytes unter `groupDraftPhotos:<id>`;
erst „Änderungen übernehmen“ legt sie in `photos` an und hängt sie an alle Einträge der Gruppe.
Ebenfalls nur auf dem Gerät liegt die Zwischenablage des Tagebuchs (`kv`-Schlüssel `clipboard`,
`apps/web/src/db/clipboard.ts`): eine Momentaufnahme der kopierten Zeile. Erst das Einfügen schreibt normale
`foodEntries`; eine eingefügte Gruppe verweist auf dieselben Foto-Ids wie das Original (Fotos sind unveränderlich).

Der KI-Assistent hat zwei Tabellen nur auf dem Gerät (Dexie v6): `assistantTurns` (jede Äußerung, eine
wartende Aufnahme als Bytes, was der Server plante und was das Gerät damit tat, samt Rückgängig-Schritten) und
`assistantSkins` (Kopien der hochgeladenen Figuren). Synchronisiert wird nur, was ein Turn schreibt: das Gerät
führt die Operationen mit den normalen Schreibfunktionen aus (`applyOps`, eine Transaktion über die
synchronisierten Tabellen, die Outbox und den Turn), „Rückgängig“ läuft über `deleteRecord`/`restoreRecord`/
`patchRecord`. Der Server schreibt für den Assistenten nie in synchronisierte Tabellen; sein Protokoll
(`assistant_turns`, `assistant_audio`, `assistant_skins`) ist nur auf dem Server.

Neue Felder kommen immer mit Standardwert (`null`), damit noch nicht aktualisierte Geräte weiter
hochladen können, z. B. `foodEntries.groupId` (Einträge, die zusammen aus einem gespeicherten Meal
eingetragen wurden; das Tagebuch zeigt sie als eine Zeile), `foodEntries.groupName` (Name einer Gruppe
ohne gespeichertes Meal, z. B. eine Foto-Analyse, die ohne Speichern mit „Meal eintragen“ eingetragen wurde; bei Meal-Gruppen bleibt es `null`,
der Name kommt vom Meal), `foodEntries.photoId` (Foto der Gruppe, an jedem Eintrag der Gruppe gleich: das
analysierte Foto oder das Meal-Foto beim Eintragen; die Tagebuchzeile zeigt es vor dem aktuellen Foto des Meals),
`foodEntries.photoIds` (alle Fotos der Gruppe in Reihenfolge, z. B. Teller, Dessert und Nährwerttabelle einer
Analyse; `photoId` ist immer das erste, ältere Datensätze haben nur `photoId`), `foodEntries.note` (der volle
Text eines Schnelleintrags, „Was hast du gegessen?“; `name` ist sein gekürzter Anfang, `quickEntryTitle`; bei
allen anderen Einträgen `null`), `exerciseEntries.note`, `exerciseEntries.templateId` (das gespeicherte
Training, aus dem der Eintrag stammt; das Tagebuch zeigt dessen aktuellen Namen, auch wenn es umbenannt oder
gelöscht wurde; `null` bei einem Training, das über die Sportart eingetragen wurde),
`exerciseEntries.groupId` (die Aktivitäten eines gespeicherten Trainings, die zusammen eingetragen wurden; das
Tagebuch zeigt sie als eine aufklappbare Zeile), `exerciseTemplates.extraItems` (Aktivitäten 2 bis n eines
gespeicherten Trainings; die flachen Felder `typeKey`/`typeName`/`minutes`/`intensity`/`note` sind Aktivität 1,
gelesen wird nur über `trainingItemsOf`; nichts ist doppelt, eine ältere App-Version bearbeitet weiter gültig
Aktivität 1 und sieht ein Paket als Training mit seiner ersten Aktivität), `exerciseTemplates.pinned`
(angepinnt, `null` = nicht) und
`meals.cookedGrams` (Rezeptmodus: Gewicht des ganzen Meals nach dem Kochen; `null` heißt, die Zutaten zählen
wie sie sind) und `purgedAt` auf `weightEntries`, `meals`, `exerciseTemplates`, `exerciseEntries` (aus dem Papierkorb
endgültig gelöscht, siehe oben; `null` = wird im Papierkorb gezeigt, solange `deleted`).

`exerciseEntries.steps` und `exerciseEntries.distanceM` (Schritte und Geh-/Laufstrecke in Metern eines
Schritte-Eintrags, sonst `null`), `settings.stepsMinimum` (ab wie vielen Schritten ein Tag einen Eintrag bekommt,
`null` = 1 000) und `settings.addStepsCalories` (Schritte aufs Ziel anrechnen, `null` = ja).

**Der Server schreibt selbst**: Der Schritte-Import (`POST /api/steps/import`, iOS-Kurzbefehl mit eigenem Zugang)
legt je Tag einen Trainingseintrag mit der festen ID `s:<Datum>` an und aktualisiert ihn. Er schreibt über
dasselbe `push` wie ein Gerät, in einer Transaktion unter der Sperre des Nutzers und mit
`nextVersion(gespeichert, jetzt)`, damit er auch gegen eine Version gewinnt, die ein vorgehendes Gerät
gestempelt hat. Ein Grabstein bleibt liegen (gelöscht bleibt gelöscht), getippte kcal und die Notiz bleiben,
unveränderte Tage werden nicht geschrieben (kein neuer `change_seq`). Ein Gerät, das seine Änderung an diesem
Eintrag noch nicht hochgeladen hat, verliert sie gegen einen neueren Import (Last-Write-Wins).

Deterministische IDs sorgen dafür, dass zwei Geräte, die offline am selben Tag ein Gewicht eintragen,
nicht zwei Einträge erzeugen, sondern auf **einen** Datensatz konvergieren.

## Ablauf

```
Gerät                                     Server
─────                                     ──────
saveRecord(): put + Outbox-Eintrag
  (eine Dexie-Transaktion)

push:  POST /api/sync/push  ───────────►  validieren (Zod), pro Nutzer Advisory-Lock,
       ≤ 500 Datensätze                   LWW gegen gespeicherte Version,
                                          Gewinner upserten mit change_seq = nextval()
       ◄─────── { applied, stale, rejected }
Outbox-Einträge löschen, deren Datensatz
sich während des Requests nicht geändert hat

pull:  GET /api/sync/pull?since=<cursor> ► Änderungen mit change_seq > cursor
       ◄─────── { changes, cursor, hasMore }  (über alle Tabellen, nach Sequenz sortiert)
LWW anwenden, Cursor speichern, bis hasMore = false
```

- **Konfliktregel** (`incomingWins` in `packages/shared/src/sync.ts`, identisch auf Server und Gerät):
  neueres `updatedAt` gewinnt; bei Gleichstand entscheidet ein stabiler Inhalts-Fingerabdruck, damit
  alle Geräte dasselbe Ergebnis wählen.
- **Cursor statt Gerätezeit:** Der Pull-Cursor ist die serverseitige Sequenz; falsch gehende Uhren auf
  Geräten können keine Änderungen „verstecken“.
- **Keine verlorenen Sequenzen:** Ein Advisory-Lock pro Nutzer serialisiert Pushes, so werden
  Sequenzwerte in Commit-Reihenfolge sichtbar; ein Pull kann keine später committete, kleinere
  Sequenz überspringen. Der Pull liest alle Tabellen in **einer** Repeatable-Read-Transaktion
  (ein Snapshot): ein Push, der zwischen zwei Tabellen-Abfragen committet, kann so nicht nur mit
  seiner höheren Sequenz sichtbar werden.
- **Uhrzeit des Geräts:** Der Server lehnt `updatedAt` mehr als 5 Minuten in der Zukunft als
  `clock_ahead` ab (sonst gewänne eine falsch gehende Uhr jeden Konflikt). Das Gerät misst aus
  `serverTime` in jeder Push- und Pull-Antwort seinen Versatz (`UserDb.clockOffset`, `kv`
  `sync.clockOffset`), stempelt neue Versionen mit `Date.now() + Versatz` und versieht abgelehnte
  Datensätze mit der Serverzeit, bevor es sie erneut sendet. Unter „Daten & Sync“ steht ein Hinweis
  ab einer Minute Abweichung.
- **Unbekannte Tabellen und Formen:** Änderungen, die eine ältere App-Version nicht kennt (neue
  Tabelle, Datensatz fällt durch das Schema), überspringt der Pull; der Cursor rückt trotzdem vor,
  der Sync-Status zeigt „App-Update nötig“. Der Merker liegt mit der App-Version in `kv`
  (`sync.needsUpdate`) und überlebt einen Neustart. Startet eine andere App-Version (Update), beginnt
  der nächste Pull bei Cursor 0 und holt das Übersprungene nach; passt dabei alles, verschwindet der
  Merker. „Alles neu vom Server laden“ macht dasselbe von Hand.
- **Paging:** Jede Tabelle liefert ihre ersten `limit + 1` Zeilen; nach dem Zusammenführen sind die
  ersten `limit` Änderungen garantiert lückenlos.
- **Abgelehnte Datensätze:** Das Gerät prüft beim Schreiben dasselbe wie der Server (Zod-Schema und
  feste ID der Tagesdatensätze, `requiredId`), eine Ablehnung bleibt so die Ausnahme (z. B. ein Datensatz
  einer älteren App-Version). Lehnt der Server einen Datensatz ab, löscht das Gerät ihn **hart** (kein
  Grabstein, der würde wieder gesendet; sonst zählte er nur auf diesem Gerät, etwa eine zweite
  Schritte-Zeile), legt eine Momentaufnahme in die Liste `kv` `sync.rejected` (die letzten 50: Tabelle,
  ID, Grund, Datensatz) und zieht danach einmal alles ab Cursor 0, damit die gültige Serverversion eines
  kaputt bearbeiteten Datensatzes zurückkommt. Die Wolke zeigt „N Datensätze vom Server abgelehnt“ mit
  Warnsymbol, bis die Liste unter „Daten & Sync“ geleert wird; der Server protokolliert Ablehnungen als
  `warn`. Schritte zählen je Tag nur unter `s:<Datum>` (`stepsEntryOf`, `isStraySteps`).
- **Epoche (Server-Restore):** Jede Pull-Antwort nennt die Epoche der Server-Datenbank (`epoch`, eine
  zufällige ID in `app_meta`, Schlüssel `sync_epoch`, beim ersten Pull angelegt). Wird die Datenbank auf ein
  Backup zurückgesetzt, fehlt dort, was die Geräte danach geschrieben haben, und `sync_seq` steht wieder
  tiefer als die Cursor der Geräte. Liegt der Cursor eines Pulls über dem höchsten je vergebenen Wert von
  `sync_seq` (global über alle Konten), rotiert der Server die Epoche selbst (nur wenn sie noch die gelesene
  ist, so bleibt es bei einer Rotation je Restore) und antwortet `{ changes: [], cursor: 0, reset: true }`.
  Ist das Backup so jung, dass kein Cursor darüber liegt, wird die Epoche von Hand rotiert (README,
  „Restore“). Das Gerät merkt sich die Epoche (`kv` `sync.epoch`); bei `reset` oder einer anderen Epoche
  legt es in **einer** Transaktion alle eigenen Datensätze (Grabsteine eingeschlossen) in die Outbox,
  setzt hochgeladene Fotos auf „wartend“ (endgültig abgelehnte bleiben abgelehnt), vergisst den Cursor und
  speichert die neue Epoche. Danach läuft der Sync weiter: erst alles hoch (LWW entscheidet, gleiche
  Versionen sind „stale“), dann ein Pull ab 0. Ohne Dialog; die App schreibt einen Eintrag ins
  Fehlerprotokoll (`onReset` in `app/session.tsx`). Kosten: ein voller Upload je Gerät und Konto, auch
  wenn ein kaputter Client mit einem absurden Cursor die Rotation auslöst.
- **Veraltete Datensätze** (Server hat Neueres) verlassen die Outbox und kommen mit dem nächsten Pull.

## Auslöser

App-Start, App wird sichtbar **oder unsichtbar** (iOS: beim Wegwischen wird sofort hochgeladen),
`online`-Event, 0,8 s nach lokalen Änderungen, alle 5 Minuten im Vordergrund und manuell. iOS kennt
kein Background Sync, deshalb gibt es keinen Service-Worker-Sync.

## Fotos

Meal-Fotos laufen nicht über den Datensatz-Sync, sondern über `PUT/GET /api/photos/:id` (Tabelle
`photos`, nur für den Besitzer). Ein Meal verweist per `photoId` darauf, Tagebuch-Gruppen per `photoIds`. Fotos sind unveränderlich (ein
neues Foto bekommt eine neue ID), deshalb gibt es keine Konflikte und der Abruf ist dauerhaft cachebar.
Auf dem Gerät liegen sie in der Dexie-Tabelle `photos` (`uploaded` 0 wartend / 1 hochgeladen / 2 vom
Server endgültig abgelehnt, Bild als `bytes`/`type`, ältere Datensätze noch als `blob`); die `SyncEngine`
lädt offene Fotos **vor** dem Push hoch, damit ein Meal nie vor seinem Foto auf einem anderen Gerät
ankommt. Schlägt ein Upload fehl (Netz, 5xx, 429), werden die übrigen Fotos trotzdem versucht und die
Datensätze trotzdem gepusht; der Fehler erscheint danach im Sync-Status und der Upload wird beim nächsten
Lauf wiederholt. Andere Geräte laden ein Foto beim ersten Anzeigen und behalten es lokal.

## Was nicht synchronisiert

- Abonnements der täglichen Erinnerung (Web Push, Tabelle `push_subscriptions`): je Gerät ein Endpunkt mit
  Uhrzeit und Zeitzone, nur auf dem Server (`apps/api/src/push.ts`); der Server sendet jede Minute, was fällig
  ist, und nur an Konten ohne Eintrag am lokalen Tag

- BLS-Katalog (kommt als statische Datei mit der App, ist für alle gleich)
- Zwischenspeicher von Open-Food-Facts-Produkten (`foodCache`): „Kürzlich“/„Häufig“ werden aus dem
  Tagebuch abgeleitet und sind deshalb trotzdem auf allen Geräten gleich
- Warteschlange der KI-Fotoanalyse (Fotos in `aiPhotos`, mehrere je Analyse, bleiben auf dem Gerät, bis
  die Analyse eingetragen ist; erst dann kommen sie nach `photos`)

## Tests

- `packages/shared/test/sync.test.ts`: LWW-Regel, Gleichstand, Grabsteine
- `apps/api/test/sync.test.ts`: Server: Round-Trip aller Tabellen, Nutzer-Isolation, LWW, Paging über
  Tabellen, ungültige Datensätze, deterministische IDs, Epoche und `reset`
- `apps/api/test/device-sync.test.ts`: **Ende-zu-Ende**: zwei Dexie-„Geräte“ mit der echten
  `SyncEngine` gegen die echte API und PostgreSQL (Konflikte, Löschungen, Offline-Phase, 401, abgelehnte Datensätze,
  App-Update nach übersprungenen Änderungen, JSON-Wiederherstellung gegen neuere Serverdaten, Neu-Hochladen nach einem Server-Restore)
- `apps/web/e2e/smoke.spec.ts`: Browser: Offline-Neuladen über den Service Worker, Offline-Eintrag,
  Sync, zweites Gerät
