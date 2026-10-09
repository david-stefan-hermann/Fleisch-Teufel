# Sync-Protokoll

Fleisch-Teufel ist **offline-first**: Jede Änderung landet zuerst in IndexedDB auf dem Gerät und wird
später mit dem Server abgeglichen. Der Abgleich ist ein einfacher **Last-Write-Wins-REST-Sync**. Für
1 bis 3 Nutzer:innen mit wenigen Geräten reicht das und bleibt nachvollziehbar.

## Datensätze

Jeder synchronisierte Datensatz (Tabellen siehe `SYNC_SCHEMAS` in `packages/shared/src/schemas.ts`) hat:

| Feld                    | Bedeutung                                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                    | auf dem Gerät erzeugt (UUID v7) oder **deterministisch** bei „einmal pro Tag“: `w:2026-10-07` (Gewicht), `n:…` (Notiz), `g:…` (Ziel ab Datum), `profile` (Einstellungen) |
| `updatedAt`             | Epoch-ms der letzten lokalen Änderung, streng monoton je Datensatz (`nextVersion`)                                                                                       |
| `deleted`               | Soft-Delete („Grabstein“), damit Löschungen synchronisieren                                                                                                              |
| `user_id`, `change_seq` | nur serverseitig: Besitzer und Cursor (globale Sequenz `sync_seq`)                                                                                                       |

Grabsteine werden nie entfernt. Darauf baut der **Papierkorb** (Mehr → Papierkorb, `apps/web/src/db/trash.ts`)
auf: er zeigt gelöschte Gewichtseinträge, Meals und gespeicherte Trainings (`exerciseTemplates`), „Wiederherstellen“ ist ein normaler Schreibvorgang
(`restoreRecord`: `deleted: false` mit neuer Version) und erreicht so alle Geräte. Endgültiges Löschen gibt
es bewusst nicht, weil das Protokoll kein Purge kennt. Gewicht hat die deterministische ID `w:<Datum>`: ein
neues Gewicht am selben Tag überschreibt den Grabstein, der Eintrag verschwindet dann aus dem Papierkorb.

Nicht synchronisiert werden Entwürfe auf dem Gerät: der Meal-Editor schreibt ungespeicherte Änderungen nach
`kv` (`mealDraft:<id>`, ein neues Foto als Bytes unter `mealDraftPhoto:<id>`, `apps/web/src/db/mealDraft.ts`).
Erst „Speichern“ macht daraus einen normalen Schreibvorgang auf `meals` (und legt das Foto in `photos` an, das
dann hochgeladen wird). Ein verworfener Entwurf hinterlässt so weder Outbox-Einträge noch verwaiste Fotos.

Neue Felder kommen immer mit Standardwert (`null`), damit noch nicht aktualisierte Geräte weiter
hochladen können, z. B. `foodEntries.groupId` (Einträge, die zusammen aus einem gespeicherten Meal
eingetragen wurden; das Tagebuch zeigt sie als eine Zeile), `foodEntries.groupName` (Name einer Gruppe
ohne gespeichertes Meal, z. B. eine Foto-Analyse, die ohne Speichern mit „Meal eintragen“ eingetragen wurde; bei Meal-Gruppen bleibt es `null`,
der Name kommt vom Meal), `foodEntries.photoId` (Foto der Gruppe, an jedem Eintrag der Gruppe gleich: das
analysierte Foto oder das Meal-Foto beim Eintragen; die Tagebuchzeile zeigt es vor dem aktuellen Foto des Meals)
und `exerciseEntries.note`.

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
  Sequenz überspringen.
- **Paging:** Jede Tabelle liefert ihre ersten `limit + 1` Zeilen; nach dem Zusammenführen sind die
  ersten `limit` Änderungen garantiert lückenlos.
- **Abgelehnte Datensätze** (Validierung) werden aus der Outbox entfernt und unter „Daten & Sync“
  angezeigt; „veraltete“ (Server hat Neueres) kommen mit dem nächsten Pull.

## Auslöser

App-Start, App wird sichtbar **oder unsichtbar** (iOS: beim Wegwischen wird sofort hochgeladen),
`online`-Event, 0,8 s nach lokalen Änderungen, alle 5 Minuten im Vordergrund und manuell. iOS kennt
kein Background Sync, deshalb gibt es keinen Service-Worker-Sync.

## Fotos

Meal-Fotos laufen nicht über den Datensatz-Sync, sondern über `PUT/GET /api/photos/:id` (Tabelle
`photos`, nur für den Besitzer). Ein Meal verweist per `photoId` darauf. Fotos sind unveränderlich (ein
neues Foto bekommt eine neue ID), deshalb gibt es keine Konflikte und der Abruf ist dauerhaft cachebar.
Auf dem Gerät liegen sie in der Dexie-Tabelle `photos` (`uploaded` 0/1, Bild als `bytes`/`type`, ältere
Datensätze noch als `blob`); die `SyncEngine` lädt offene
Fotos **vor** dem Push hoch, damit ein Meal nie vor seinem Foto auf einem anderen Gerät ankommt. Andere
Geräte laden ein Foto beim ersten Anzeigen und behalten es lokal.

## Was nicht synchronisiert

- BLS-Katalog (kommt als statische Datei mit der App, ist für alle gleich)
- Zwischenspeicher von Open-Food-Facts-Produkten (`foodCache`): „Kürzlich“/„Häufig“ werden aus dem
  Tagebuch abgeleitet und sind deshalb trotzdem auf allen Geräten gleich
- Warteschlange der KI-Fotoanalyse (Fotos bleiben auf dem Gerät, bis sie analysiert sind)

## Tests

- `packages/shared/test/sync.test.ts`: LWW-Regel, Gleichstand, Grabsteine
- `apps/api/test/sync.test.ts`: Server: Round-Trip aller Tabellen, Nutzer-Isolation, LWW, Paging über
  Tabellen, ungültige Datensätze, deterministische IDs
- `apps/api/test/device-sync.test.ts`: **Ende-zu-Ende**: zwei Dexie-„Geräte“ mit der echten
  `SyncEngine` gegen die echte API und PostgreSQL (Konflikte, Löschungen, Offline-Phase, 401)
- `apps/web/e2e/smoke.spec.ts`: Browser: Offline-Neuladen über den Service Worker, Offline-Eintrag,
  Sync, zweites Gerät
