# Fleisch-Teufel: Gesamt-Review und Umsetzungsplan (Oktober 2026)

**Stand 24.10.2026, Branch `review-fixes`:** Phase 1 bis 3 sind umgesetzt (Commits ab 2d0f218), dazu aus
Phase 4/5: Housekeeping-Job, Passwort-Reset-Skript, `AI_LABEL_MODEL`, Backup-Doku. Offen geblieben (bewusst):
A7 Geräteliste (Sitzungen anzeigen/abmelden), C4 letzter Punkt (`deferred` bei Offline, wenn jemand wartet),
E5 (`MealPage` Key), E7 Index-Keys in den Editoren, F10 Chart-Stufenlinie/TrainingFields-Listbox, H1 bis H9
(Refactorings), die meisten Ideen aus J. Der ursprüngliche Plan folgt unverändert.

---

Stand: 2026-10-23, Commit 58f842f (main, Arbeitsbaum sauber). `pnpm lint`, `pnpm typecheck` und
`pnpm test` (158 API-Tests, Web- und Shared-Suiten) sind grün. `pnpm audit --prod`: eine moderate
Meldung (`uuid` über `exceljs` nur im Import-Tool, nicht im Produkt).

## Kontext

Vollständige Durchsicht des Codes (API, Sync, Shared-Mathematik, alle Web-Features, PWA) auf Fehler,
Sicherheitslücken, Nutzererlebnis und überarbeitungswürdige Stellen. Server, Sync-Engine, Session,
KI-Queue, Datenpfade und Shared-Kern habe ich selbst gelesen; die Web-Features haben drei Agenten
vollständig gelesen, deren Befunde ich an den genannten Stellen im Code nachgeprüft habe (Zeilen
unten sind nachgeprüft; wo ich eine Behauptung nicht selbst prüfen konnte, steht „plausibel“).

Legende: **P1** Datenverlust, doppelte Buchungen, Sicherheit, Geld. **P2** sichtbarer Fehler oder
klares UX-Problem. **P3** Robustheit, Konsistenz, Barrierefreiheit. **P4** Ideen.

---

## 0. Die zehn wichtigsten Punkte

1. Login-Rate-Limit greift nicht gegen Brute-Force (A1).
2. Pull liest Tabellen in getrennten Snapshots, Cursor kann Datensätze überspringen (A2).
3. `patchRecord` liest außerhalb der Transaktion: verlorene Updates bei gleichzeitigem Pull (B1).
4. Unbekannte Tabelle im Pull macht den Sync alter App-Versionen dauerhaft kaputt (B2).
5. „Wiederholen“ einer fehlgeschlagenen Analyse lässt sie aus dem Tagebuch verschwinden, ohne sie
   einzutragen; ein nicht eintragbares Item blockiert die ganze Queue (C1, C2).
6. Timeout zählt als „offline“ und sendet den bezahlten Claude-Call erneut (C3).
7. Doppeltipp trägt Meals, Analysen, Lebensmittel und Portionen doppelt ein (E1, D1).
8. Prognose „Tag abschließen“ rechnet mit falschem Erhaltungsbedarf (F1); erneutes Onboarding
   schreibt altes Gewicht als heutigen Eintrag und verwirft eigene Mikro-Ziele (F2, F3).
9. Tagesnotiz: letzte 0,7 s Tippen gehen beim Seitenwechsel verloren (E3).
10. Export auf dem iPhone als Standalone-PWA praktisch nicht nutzbar (G1).

---

## 1. Reihenfolge der Umsetzung

Jede Phase ist ein eigener Commit-Block mit Tests; Phase 1 zuerst, dann nach Zeit.

- **Phase 1 (P1, Server + Datenkern):** A1, A2, A3, A4, B1, B2, B3, B4, C1, C2, C3, E1, D1.
- **Phase 2 (P1/P2, Fachlogik + Flüsse):** F1, F2, F3, F4, E2, E3, E4, D2, D3, D4, G1.
- **Phase 3 (P2/P3, Konsistenz + UX):** restliche E, F, D, G.
- **Phase 4 (P3, Qualität):** Abschnitt H (Refactorings), Abschnitt I (Tests).
- **Phase 5 (P4):** Abschnitt J nach Wahl.

---

## A. Server (apps/api)

### A1 (P1) Login-Rate-Limit greift erst nach der Passwortprüfung und nie bei richtigem Passwort

`apps/api/src/routes/auth.ts:59-68`: `verifyPassword` läuft vor `loginLimiter.take`, und das Limit
wird nur im Fehlerfall geprüft. Bei falschem Passwort gibt es 429, ein richtiger Treffer wird immer
angenommen: das Limit bremst Brute-Force nicht. Jeder Versuch kostet außerdem volle Argon2-Arbeit
(19 MiB; CPU-DoS). Der Test `rate-limits repeated failed logins` prüft nur die 429-Antwort.
Fix: `RateLimiter.blocked(key)` (prüft ohne zu zählen) vor `verifyPassword` für `ip:` und `user:`;
gesperrt → sofort 429 ohne Hash. Fehlversuch zählen wie bisher.
Test: nach 10 Fehlversuchen ist auch das richtige Passwort 429, nach Ablauf wieder 200.

### A2 (P1) Pull liest jede Tabelle in eigener Transaktion: Cursor kann Änderungen überspringen

`apps/api/src/sync/service.ts:111-128`: `Promise.all` über 11 Tabellen, jede Query mit eigenem
Snapshot. Pusht ein zweites Gerät zwischen Query A (t1) und Query B (t2) eine Gruppe (seq 13 in
`foodEntries`, seq 14 in `meals`), sieht der Pull seq 14, aber nicht 13, setzt den Cursor auf 14,
und seq 13 kommt nie an. Der Advisory-Lock schützt nur Pushes untereinander.
Fix: Pull in `db.transaction(async tx => { await tx.execute(sql\`set transaction isolation level
repeatable read\`); ... })`(ein Snapshot für alle Tabellen).`docs/sync.md` „Keine verlorenen
Sequenzen“ entsprechend ergänzen. Test: schwer deterministisch; mindestens prüfen, dass ein Pull
mitten in einem offenen Push (Transaktion offen halten) entweder alles oder nichts davon liefert.

### A3 (P1) Uhrzeit des Geräts entscheidet LWW ohne Plausibilitätsprüfung

`packages/shared/src/sync.ts:31`, `apps/web/src/db/write.ts:22`: Ein Gerät mit Uhr in der Zukunft
gewinnt dauerhaft gegen spätere Änderungen anderer Geräte; die verlieren still als `stale`.
Fix: (1) Server lehnt `updatedAt > now + 5 min` als `rejected` mit Fehlertext `clock_ahead` ab.
(2) Client schätzt die Abweichung aus dem `Date`-Header der Pull-Antwort (`kv` `sync.clockOffset`)
und `saveRecord` nutzt `nextVersion(prev, Date.now() + offset)`. (3) Bei `clock_ahead` den Datensatz
nicht aus der Outbox werfen, sondern mit korrigiertem `updatedAt` neu versionieren und erneut
senden. Hinweis unter „Daten & Sync“ bei |offset| > 1 min.

### A4 (P2) Registrierung: Race beim ersten Nutzer, Unique-Verletzung als 500

`routes/auth.ts:42-48`: `registrationOpen` und `existing`-Prüfung sind nicht atomar. Fix: Insert mit
`onConflictDoNothing().returning()`; leer → 409. Um Zählen und Insert ein
`pg_advisory_xact_lock(hashtext('register'))`.

### A5 (P2) Fotos werden nie gelöscht (Server und Gerät)

`routes/photos.ts`, `db/photos.ts`: Jedes hochgeladene Foto bleibt für immer (Postgres `bytea`,
IndexedDB `photos`), auch wenn Meal und Einträge gelöscht sind.
Fix: Aufräumjob im Server beim Start und täglich (`setInterval(...).unref()`): Fotos eines Nutzers
löschen, die älter als 30 Tage sind und in keinem `meals.photo_id`, `food_entries.photo_id` oder
`photo_ids` vorkommen (Grabsteine zählen mit, damit der Papierkorb funktioniert). Auf dem Gerät
dasselbe nach dem Pull in `SyncEngine` (`photos` mit `uploaded: 1` ohne Referenz).

### A6 (P2) Ein dauerhaft fehlschlagender Foto-Upload blockiert den gesamten Sync

`apps/web/src/db/photos.ts:76-86`, `sync/syncEngine.ts:190-196`: `uploadPendingPhotos` läuft vor
jedem Push; ein 5xx oder 429 (Limit 300 Fotos/h, `routes/photos.ts:28`) wirft und beendet den Lauf,
bevor ein Datensatz hochgeht. Nach einer langen Offline-Phase mit vielen Analysen: 300 Fotos ok, das 301. gibt 429, eine Stunde kein Datensatz-Upload. Fotos mit 400/413/415 werden als `uploaded: 1`
markiert, erreichen den Server nie, und niemand erfährt es.
Fix: fehlgeschlagene Fotos in diesem Lauf überspringen, Push trotzdem ausführen, am Ende den ersten
Fehler als Status melden. Endgültig abgelehnte Fotos als `uploaded: 2` („abgelehnt“) markieren und
unter „Daten & Sync“ zählen.

### A7 (P3) Sitzungen laufen nie ab, keine Geräteliste

`auth/session.ts:65-71`: Sliding Expiry 400 Tage ohne absolutes Maximum; abgelaufene Zeilen bleiben.
Fix: absolutes Maximum 2 Jahre ab `createdAt`; täglich `delete from sessions where expires_at <
now()`. Konto-Seite: Liste der Sitzungen (`userAgent`, `lastSeenAt`, „dieses Gerät“) mit „Abmelden“
je Zeile (`DELETE /api/auth/sessions/:id`).

### A8 (P2) Abmelden offline lässt die Server-Sitzung gültig

`app/session.tsx:91-95`: Schlägt `logout()` fehl, bleibt das httpOnly-Cookie gültig (bis 400 Tage).
Fix: `kv` `auth.pendingLogout = <token-hash unbekannt>` geht nicht (Token ist httpOnly); stattdessen
beim nächsten Start mit `ft.user` leer, aber Cookie vorhanden (`/api/auth/me` liefert 200) sofort
`logout()` senden, bevor irgendetwas anderes passiert.

### A9 (P3) Kleinere Server-Punkte

- `routes/ai.ts:141` zählt das Limit vor der Formularprüfung, `:295` danach: beide nach der Prüfung.
- `routes/ai.ts:156`: Bildtyp aus `file.type`; `sniffImage` (photos.ts) auch hier nutzen.
- `routes/ai.ts:226-250` `/choices`: `foodId` nicht geprüft; nur ids akzeptieren, die `catalog.get`
  oder `customFoods` des Nutzers kennen.
- `routes/foods.ts:17`: lokale Suche ohne `q.slice(0, 100)`.
- `off/client.ts:77-101`: Fallback auf `search.pl` sendet zwei Requests bei einem Limiter-Take.
- `ai/analyze.ts:76`: 120 s Timeout pro Request, bis 8 Runden, `maxRetries: 2` → eine Analyse kann
  deutlich länger als die 120 s des Clients dauern. Server: Gesamtbudget 100 s über alle Runden
  (`AbortSignal.timeout` an den Runner, danach `AiOutputError('timeout')` → 504 `ai_timeout`).
- `ai/pricing.ts`: unbekanntes Modell fällt still auf Opus-Preise zurück → `log.warn`.
- `app.ts:78-87` `/health` ohne Login nur `{ ok }`; Version und BLS-Anzahl nur unter `/api/info`.
- Kein Weg, ein Passwort ohne DB-Zugriff zurückzusetzen: `apps/api/scripts/reset-password.ts`
  (`pnpm --filter @ft/api user:reset-password <email>`; setzt Hash, löscht Sitzungen) + README-Satz.
- `deploy/docker-compose.yml`: kein Backup. `pg_dump`-Sidecar (täglich, 7 Tage rotierend) nach
  `/mnt/tank/applications/fleisch-teufel/backup` dokumentieren.

---

## B. Sync, Datenkern, Sitzung (apps/web/src/db, sync, app)

### B1 (P1) `patchRecord` liest außerhalb der Schreibtransaktion: verlorene Updates

`db/write.ts:39-41`: `prev` wird vor `saveRecord` gelesen; dazwischen kann der Pull eine neuere
Version schreiben, die dann mit `{...prevAlt, ...patch}` und höherem `updatedAt` überschrieben wird.
Beispiel: Laptop benennt Meal um, Handy ändert gleichzeitig die Zutaten → Umbenennung verloren, auf
allen Geräten. Zwei `patchRecord` auf dieselbe id (Löschen + Bearbeiten aus zwei Toasts) ebenso.
Fix: `saveRecord` bekommt optional einen Updater `(prev) => next`; `patchRecord` ruft ihn innerhalb
der einen `rw`-Transaktion auf. Test in `write.test.ts`: zwei verschachtelte Patches, Pull dazwischen.

### B2 (P1) Unbekannte Tabelle im Pull macht den Sync dauerhaft kaputt

`sync/syncEngine.ts:242-248`: `this.db.syncTable(t)` wirft `InvalidTableError` für eine Tabelle,
die der Server kennt, die App-Version aber nicht (Update-Banner wartet noch). Der Cursor rückt nie
vor, jeder Sync scheitert, und weil es kein `HttpError` ist, steht „Offline“ da.
Fix: Änderungen unbekannter Tabellen überspringen (Cursor trotzdem setzen) und zählen; Hinweis
„App-Update nötig“ im Sync-Status. Pull-Antwort zusätzlich mit `SYNC_SCHEMAS[table].safeParse`
prüfen und Fehlschläge in `sync.rejected`-ähnlicher Liste zeigen statt zu schreiben.

### B3 (P2) Mehrere Datensätze in n einzelnen Transaktionen

`db/entries.ts:95-124` (`logItems`), `MealCard.tsx:199` (Gruppe löschen), `mealDraft.ts:84-100`:
Schließt iOS die App mittendrin, bleibt eine halbe Gruppe; eine Zod-Ablehnung bei Zutat 4 lässt
1 bis 3 stehen. Fix: `db.transaction('rw', [foodEntries, meals, photos, outbox], ...)` um die
Schleifen (`storePhotoBytes` existiert dafür, Bytes vorher lesen).

### B4 (P2) Sync-Status „offline“ für jeden Nicht-HTTP-Fehler

`sync/syncEngine.ts:167-176`: Dexie-Fehler (Quota, Version, Constraint) und JSON-Fehler erscheinen
als „Offline“. Fix: nur `TypeError`/`AbortError` aus `fetch` als offline; sonst `status: 'error'`
mit `e.message`, sichtbar unter „Daten & Sync“. Dazu: scheitert ein Lauf, während `again` gesetzt
war, wird kein neuer geplant (`:167-175`) → in `finally` bei `again` `schedule(5_000)`.

### B5 (P2) Abmelden und Gerätedaten

`AccountPage.tsx:103-130`, `session.tsx:89-105`: Der Pending-Warntext („… wenn du die Gerätedaten
löschst“) erscheint auch beim reinen Abmelden. Fix: Text nur beim Wipe; bei „Löschen und abmelden“
mit `pending > 0` zuerst `sync.sync()` versuchen und das Ergebnis im Dialog zeigen. Beim Login mit
einem anderen Konto: Hinweis „N nicht synchronisierte Änderungen von <alte E-Mail> bleiben auf dem
Gerät“ und Angebot, verwaiste `ft-user-*`-Datenbanken (`Dexie.getDatabaseNames`) zu löschen.

### B6 (P3) Sitzung, PWA, Router

- `session.tsx:55-57`: `/api/info` nur einmal beim Start; nach Login/Logout neu laden.
- `session.tsx:79-86`: Seiteneffekte im `setSession`-Updater (`db.close`, `open`); StrictMode ruft
  Updater doppelt → zweite `UserDb`/`SyncEngine` im Dev. Außerhalb berechnen.
- `pwa.ts:28-32`: `applyUpdate` hängt je Klick einen `controlling`-Listener an. Einmal registrieren.
  `pwa.ts:34-41`: `useUpdateReady` kann ein `waiting` zwischen Render und Effekt verpassen →
  `useSyncExternalStore`. Gleiches für `SyncIndicator.useSyncState`.
- `router.tsx:264-269`: kein `defaultErrorComponent`; ein fehlgeschlagener Chunk-Load nach einem
  Update (zweites Fenster) zeigt die rohe TanStack-Fehlerseite. Komponente mit „Neu laden“.
- `router.tsx:230-233`: `/day/$date/complete` ohne Validierung → `fmtDayLong('abc')` wirft
  `RangeError` (Absturz der Seite). `isISODate` prüfen, sonst `Navigate to="/"`.
- `sw.ts:14`: Precache-Glob `**/*.json` nimmt jede künftige JSON-Datei; explizit listen.
- `AppBanners.tsx`: Update-Banner nicht zeigen, solange eine Analyse läuft oder ein Editor-Draft
  offen ist (Router-State-Flag).

---

## C. KI-Fotoanalyse (features/ai, db/aiDraft, api/ai)

### C1 (P1) „Wiederholen“ im Tagebuch lässt die Analyse verschwinden, ohne sie einzutragen

`features/ai/queue.ts:321-324` setzt nur `status: 'pending'`. `logDeferred` (`:155`) trägt nur
`deferred`-Items ein, `usePendingAnalyses` (`hooks/data.ts:121`) zeigt nur `!result`. Ablauf: erste
Analyse scheitert, während die Person auf `/photo` wartet (kein `deferred`); später „Wiederholen“ im
Tagebuch; Erfolg → Zeile verschwindet, nichts eingetragen, Ergebnis nur unter „Analysen“.
Fix: `retryQueueItem` setzt `deferred: true`, wenn `!item.result` (niemand wartet mehr auf der Seite).
Test in `meals-photos.test.ts`.

### C2 (P1) Ein nicht eintragbares Item blockiert die ganze Queue

`queue.ts:154-179`: `logDeferred` läuft vor jeder Verarbeitung ohne try/catch; wirft `logAiItems`
(Quota, Zod), bleibt das Item `done + deferred`, jeder Lauf scheitert an derselben Stelle, neue Fotos
werden nie analysiert, Fehler sind unbehandelte Rejections. Zudem sind `logAiItems` und
`discardQueueItem` (`:169-171`) nicht atomar: App-Kill dazwischen → beim nächsten Start doppelt
eingetragen.
Fix: try/catch je Item (→ `failed` mit Text, weiter mit dem nächsten); Einträge schreiben und
Queue-Item löschen in einer Transaktion (`aiQueue`, `aiPhotos`, `foodEntries`, `photos`, `outbox`;
Bytes vorher lesen).

### C3 (P1) Timeout zählt als „offline“ und wiederholt den bezahlten Call

`lib/api.ts:29-33`, `queue.ts:225-233`: `AbortSignal.timeout` → `OfflineError` → `pending` +
`deferred`, `break`; der nächste Trigger sendet alle Fotos erneut. Der Server rechnet trotzdem ab.
Fix: `api()` wirft `TimeoutError`, wenn `timeout.aborted`; die Queue setzt dann `failed` mit
„Zeitüberschreitung“ und „Wiederholen“. Dazu Server-Budget (A9). `PhotoPage.tsx:208-209` zeigt bei
jedem Fehler aus `processQueue` „Fotos konnten nicht gespeichert werden“, obwohl sie gespeichert sind,
und lässt die Vorschau stehen (zweites „Analysieren“ = zweites Item) → Fehler der Analyse von Fehlern
des Speicherns trennen, Vorschau nach dem Speichern immer verlassen.

### C4 (P2) Navigation nach `await`, wenn die Person schon weg ist

- `PhotoPage.tsx:192-205`: nach `waiting.current = null` noch ein `await db.aiQueue.get(id)`, dann
  `setActiveId`/`navigate` ohne `gone.current`-Prüfung; der Unmount-Cleanup ruft `leaveAnalysis`
  nicht mehr → Item bleibt `done`, nicht `deferred`, wird nie eingetragen und ist im Tagebuch
  unsichtbar. Fix: `waiting.current` erst nach der Entscheidung löschen; nach dem `get` bei
  `gone.current` → `leaveAnalysis`.
- `DiaryGroupPage.tsx:238-272`: `commit(next.draft)` nach `await analyzePhotos` ohne Mounted-Check;
  Zurück während ↻ → 20 s später wird der kv-Draft ersetzt und ein Toast erscheint im Tagebuch. Fix:
  `alive`-Ref oder Verlassen während `busy` blockieren.
- `ScanPage.tsx:52-60`: `apply` navigiert nach bis zu 10 s Lookup mit `replace: true`, auch wenn die
  Seite verlassen wurde. Fix: AbortController im Cleanup.
- `queue.ts:228-231`: `OfflineError` setzt `deferred: true` auch dann, wenn die Person gerade auf der
  Seite wartet; ein Retry im selben Lauf trägt ohne Review ein. Fix: `deferred` nur setzen, wenn kein
  `waiting` für dieses Item registriert ist (Flag am Item `waitedFor: true` beim Enqueue von der
  Seite, von `leaveAnalysis` auf false).

### C5 (P2) Destruktive Aktionen im Foto-Fluss ohne Rückgängig

`PhotoPage.tsx:612-619` „Verwerfen“ einer Analyse (bezahltes Ergebnis + Fotos sofort weg) und `:830`
X am Foto. Fix: `takeQueueItem` + Undo-Toast wie im Tagebuch; Foto-Entfernen mit Undo (Bytes bis zum
Toast-Ende halten).

### C6 (P3) Kleinere Punkte

- `db/aiDraft.ts:23` rundet `grams` auf ganze Gramm → Gewürze unter 0,5 g werden 0 und still
  verworfen (`r.grams > 0`). Auf 0,1 g runden oder `Math.max(1, …)`. `aiDraft.ts:155` `scaleDraft`
  erlaubt 0 g (Meal-Editor klemmt auf 1 g, `IngredientCard.tsx:32,46`): vereinheitlichen.
- `db/entries.ts:141-157` `aiMealItems`: `quantity` auf Hundertstel gerundet, `grams` exakt; der
  Gruppen-Editor rechnet später `quantity × portionGrams` → 23 g werden 22,5 g. `grams` konsistent
  aus `quantity × portionGrams` setzen.
- `FoodLogPage.tsx:253` + `aiDraft.ts:92-107`: Lebensmittel in ein Review „hinzufügen“ verliert die
  gewählte Portion (`portion: null`) und meldet „hinzugefügt“, auch wenn das Item weg ist. Portion
  durchreichen, boolean zurückgeben.
- `PhotoCaptureSheet.tsx:84-89`, `queue.ts:291-294`: `room` aus Render-State, Auslöser nicht gesperrt
  → zwei schnelle Auslösungen überschreiten `MAX_ANALYSIS_PHOTOS`; `addQueuePhotos` kappt nicht →
  nächster ↻ scheitert am Server. Kappen in `addQueuePhotos`, Auslöser während `capturing` sperren.
- `PhotoPage.tsx:389`, `LabelCaptureSheet.tsx:94`: `PhotoCaptureSheet` ohne `preset` hält bis zu
  fünf Originale im Speicher (iOS-Tab-Kill). Preset `analysis` bzw. `label` übergeben, wie `:846`.
- `PhotoPage.tsx:526`: Kamera-Fallback-Input setzt `value` nicht zurück (Galerie-Input `:509` schon).
- `PhotoPage.tsx:597-600`: zweite Zeile einer `QueueRow` (Zeit · Hinweis) nicht gekürzt → 500 Zeichen
  Hinweis umbrechen über viele Zeilen. `truncate`.
- `PhotoPage.tsx:161, 204, 757`, `FoodLogPage.tsx:297`: Navigation zu `/` nach dem Eintragen ist ein
  Push; Zurück landet wieder auf Kamera oder gefüllter Food-Seite (lädt zum Doppel-Eintragen ein).
  `replace: true` oder `goBackOr`.
- `PhotoPage.tsx:921-922`: `onValueCommit={() => commit(draft)}` liest den Draft vom vorigen Render;
  bei Tastatur-Bedienung des Sliders fehlt der letzte Schritt im Draft (plausibel, Radix-Quelle nicht
  geprüft). Fix wie E6: Wert aus dem Commit-Argument berechnen.

---

## D. Lebensmittel, Suche, Scan (features/foods, foods/, shared/search)

### D1 (P1) Keine Sperre gegen Doppel-Absenden

- `FoodLogPage.tsx:271-298/323` „eintragen“: zwei Tagebucheinträge.
- `CustomFoodPage.tsx:129-158/166` „Anlegen“: zwei eigene Lebensmittel (je `uuidv7()`).
- `FoodLogPage.tsx:483-490` `NewPortionDialog`: zwei Portionen.
- `QuickAddPage.tsx:52-89`, `AddFoodPage.tsx:174-198` `quickRelog` („+“ bei Kürzlich): doppelt, und
  ohne Rückgängig (sonst hat jede Aktion im Tagebuch eins).
  Fix: ein Hook `useSubmitting()` (Ref + State), Button `disabled` während des Speicherns; `quickRelog`
  gibt die id zurück und der Toast bekommt „Rückgängig“ (`deleteRecord`).

### D2 (P1) Bearbeiten eines Eintrags ohne Lebensmittel schreibt die Eintrags-id als `foodId`

`FoodLogPage.tsx:93-111`: Fallback-Food mit `id: entry.foodId ?? entry.id`, `source: 'custom'`.
Erreichbar über KI-Schätzungen (`foodId: null`) und Gruppen-Zutaten (`/entry/$entryId`). „Änderungen
übernehmen“ schreibt `foodId: <uuid des Eintrags>`; der Eintrag taucht in „Kürzlich“ auf, führt zu
„Lebensmittel nicht verfügbar“, der Stift öffnet ein leeres „Eigenes Lebensmittel“, „Eigene Portion“
legt eine `foodPortions`-Zeile mit falscher `foodId` an.
Fix: `foodId` aus `entry.foodId` (kann null sein) übernehmen; Stift und „Eigene Portion“ ausblenden,
wenn kein echtes Lebensmittel geladen ist.

### D3 (P1) Menge über dem Maximum: Feld zeigt 12.000, eingetragen werden 1.200

`components/AmountEditor.tsx:159-162`: Feld committet je Tastendruck; bei `q > max` nur Fehlertext,
kein Commit. Tippfolge 1, 12, 120, 1200 committed, 12000 abgelehnt; Button bleibt aktiv (`valid = q >
0`) und trägt 1.200 g ein. Gilt für Food-Seite, Review-Zeilen, Zutatenkarten.
Fix: bei Überschreitung `onCommit({ portion, quantity: null })` (Button wird inaktiv), Fehlertext wie
bisher.

### D4 (P2) Food-Seite startet bei OFF-Produkten ohne Portionsangabe mit der ganzen Packung

`FoodLogPage.tsx:185` nimmt `portions[0]`; `portionsFor` (`shared/foods.ts:154`) stellt
`food.portions` (hier nur „Packung (500 g)“) vor die Basiseinheiten. Die Suchzeile zeigt „kcal/100 g“
(`rowAmount` überspringt „Packung“), die Seite öffnet mit 2.480 kcal. Fix: dieselbe Regel wie
`rowAmount` (kein „Packung“), sonst 100 g.

### D5 (P2) Speichern scheitert still bei Werten außerhalb der Schemas

`CustomFoodPage.tsx:212, 365`, `FoodLogPage.tsx:469`, `QuickAddPage.tsx:128`, `ProfilePage.tsx:123`,
`GoalsPage.tsx:98-107`, `OnboardingPage.tsx:139-158`, `TrainingFields.tsx:261-289`, `NoteCard.tsx:27`:
`saveRecord` wirft `ZodError` (Name > 200, Portionslabel > 80, > 30 Portionen, Größe 300 cm, Protein
2.500 g, Sportname 81 Zeichen, Notiz > 5.000); niemand fängt, kein Toast, Button „tut nichts“.
Fix: `maxLength`/`min`/`max` an den Feldern passend zu den Schemas; eine Hilfsfunktion
`saveOrToast(fn)` (try/catch → `toast.error(errorMessage)`), in allen `save()` verwendet.

### D6 (P2) Kleinere Punkte

- `foods/foodService.ts:250` `getFood`: `loadBls()` kann offline vor dem Precache werfen; `.then()`
  ohne Rejection-Handler → Skeleton für immer. `loadBls().catch(() => null)`.
- `foodService.ts:107-113` `ownIndexes`-Signatur nur `id:name:brand` → nach Nährwertänderung eines
  eigenen Lebensmittels zeigt die Suche alte kcal/Portionen. `updatedAt` in die Signatur.
- `foodService.ts:269-274` `lookupBarcode`: UPC-A/EAN-13-Varianten nur für den OFF-Cache, nicht für
  `customFoods` → eigenes Produkt mit 12-stelligem Code wird beim Scan (13-stellig) nicht gefunden
  und zum Neuanlegen angeboten. Varianten auch für eigene Lebensmittel; beim Speichern auf 13 Stellen
  normalisieren.
- `AddFoodPage.tsx:86`: Suchtext nur im State; nach Öffnen eines Treffers und Zurück ist das Feld
  leer. Debounced `q` mit `replace: true` in die URL schreiben (wie `setTab`).
- `AddFoodPage.tsx:98-101, 153-156`: `useLiveQuery` behält den alten Wert, bis die neue Query
  antwortet → kurz alte lokale Zeilen mit neuen Online-Treffern gemischt, „Nichts gefunden“ blitzt.
  `{ q, rows }` zurückgeben und bei `q !== query` ignorieren.
- `CustomFoodPage.tsx`: kein `useBlocker`/`DiscardDialog` (anders als Meal- und Trainingseditor);
  nach einem Etikettenfoto (bezahlter Call) verliert iOS-Swipe-Back alles. Zudem lädt `:39-41`
  gelöschte Datensätze ohne Hinweis; Speichern belebt sie still wieder. Blocker ergänzen, gelöscht =
  nicht gefunden (oder „Gelöscht“ mit Wiederherstellen).
- `ScanPage.tsx:186-188`: manuelle Eingabe verlangt ≥ 8 Ziffern, Editor erlaubt 6 bis 14.
- `CustomFoodPage.tsx:134, 348`: Portionsmengen roh („37.5 g“) statt `fmtGrams`.
- `lib/api.ts:24-27`: ohne `AbortSignal.any` (Safari < 17.4) ersetzt das Caller-Signal den Timeout →
  `searchOff`/`readLabel` ohne Timeout. Beide Signale manuell verknüpfen. `:34` `res.text()`-Fehler
  (Verbindung bricht im Body ab) wird „Unerwarteter Fehler“ statt offline.
- `lib/format.ts:28` `parseDecimal('1.000')` = 1 (deutscher Tausenderpunkt) → `^\d{1,3}(\.\d{3})+$` als
  Gruppierung lesen. `NumberField.tsx:74` mit `integer` ersetzt „137,5“ beim Tippen durch 138.
- `lib/amounts.ts:92-95` `convertAmount` rundet auf Hundertstel Portion: 50 g → „Tasse (150 ml)“ =
  0,33 = 49,5 g; die Gramm bleiben nicht exakt. Rest als `extra`-Gramm halten oder 3 Dezimalen.
- `shared/search.ts:19-41` `FOLD` ohne û, ë, ï, ò, ì, ã, å, ø, œ: „Crème brûlée“ → „creme br lee“.
  NFD + Combining Marks entfernen vor der Tabelle.

---

## E. Tagebuch und Meals (features/diary, features/meals)

### E1 (P1) „Meal eintragen“ doppelt ausführbar, Fehler unbehandelt

- `PhotoPage.tsx:740-773` `log()`: kein Guard; zweiter Tipp während `loadQueueImages`/`logAiItems`
  → zweite Gruppe ohne Fotos (der erste Lauf hat sie per `discardQueueItem` gelöscht), `aiChoices`
  doppelt. Kein try/catch (Quota in `storePhoto` → nichts passiert, keine Meldung).
- `MealLogView.tsx:70-79, 99`: kein Busy-State → zweite Gruppe.
- `DiaryGroupPage.tsx:205-209, 309`: `busy` deckt nur ↻; zweites „Änderungen übernehmen“ speichert
  die neuen Fotos doppelt (`readGroupDraftPhotos` läuft vor der Transaktion), ab 10 Foto-ids wirft Zod.
  Fix: `useSubmitting()` aus D1 überall; try/catch mit `toast.error`.

### E2 (P1) Editor-Zustand folgt synchronisierten Änderungen nicht

`MealEditor.tsx:73, 93`, `DiaryGroupPage.tsx:125-166`, `db/groupDraft.ts:243-255`: `initial` wird
einmal in State kopiert. Meal auf dem Laptop umbenannt → `isDirty` vergleicht alten State mit neuem
Prop: „Speichern“ aktiv, DiscardDialog beim Verlassen, Speichern schreibt den alten Namen zurück.
Gruppe: Zutat auf Gerät B gelöscht, Editor auf A offen → beim Speichern fällt sie in den Zweig „im
Editor hinzugefügt“ und wird mit neuer id wiederbelebt. Alte kv-Drafts (iOS-Kill vor Tagen) kommen
ebenso ohne Hinweis zurück und überschreiben neuere Änderungen.
Fix: Basis-`updatedAt` der zugrunde liegenden Datensätze im Draft speichern (`baseUpdatedAt` je
Eintrag bzw. am Meal). Ändert sich der Datensatz: unberührter Draft → neu seeden; geänderter Draft →
Hinweis „Auf einem anderen Gerät geändert“ mit „Neu laden“/„Meine Änderungen behalten“; gelöschte
Einträge nie wiederbeleben (nur Items mit `entryId`, deren Eintrag `deleted` ist, überspringen).

### E3 (P1) Tagesnotiz: letzte 0,7 s gehen beim Seitenwechsel verloren; zu lange Notiz scheitert still

`NoteCard.tsx:23-35`: Cleanup löscht den Timer (`key={date}` remountet bei jedem Tageswechsel, auch
Tab-Wechsel, App wegwischen). `:40-49`: Textarea ohne `maxLength`, Schema 5.000.
Fix: im Cleanup bei `dirty.current` sofort speichern (`flush`), zusätzlich bei `visibilitychange →
hidden`; `maxLength={5000}`; try/catch. `:18-20` setState im Effekt (Compiler-Regel): Text in einem
Form-Component mit `key={note?.updatedAt}` initialisieren.

### E4 (P2) `saveMealDraft`: Foto vor der Leer-Prüfung gespeichert, gelöschtes Meal ignoriert

`db/mealDraft.ts:85-93`: ein leerer Draft mit Foto hinterlässt ein verwaistes `photos`-Row (wird
hochgeladen); `meal.deleted` wird nicht geprüft → Erfolgsmeldung, Meal bleibt im Papierkorb.
Fix: erst prüfen, dann alles in einer Transaktion mit `storePhotoBytes`; `deleted` → false.

### E5 (P2) `MealPage.tsx:28` `key={meal.updatedAt}` setzt den Eintrage-Dialog bei jedem Pull zurück

Zwei ausgeschlossene Zutaten, 1,5×, „Abendessen“ gewählt → ein Pull (anderes Gerät) remountet
`MealLogView`, alle drei Wahlen still weg. Fix: Key nur beim Rückweg aus dem Editor (Search-Param
`edited=<ts>`), nicht am `updatedAt`.

### E6 (P2) Slider-Commit mit altem Draft

`MealEditor.tsx:217`, `DiaryGroupPage.tsx:421`: `onValueCommit={() => void writeMealDraft(db, draft)}`
liest `draft` vom vorigen Render. Bei Tastatur (Pfeile, Home/End) ruft Radix Change und Commit im
selben Handler → kv-Draft hält den vorletzten Wert, der nach der Zutatensuche zurückkommt (plausibel,
Agent hat Radix 1.5 geprüft). Fix: `onValueCommit={([v]) => write({...draft, items:
scaleItems(scaleBase, v)})}`.

### E7 (P2) Konsistenz im Tagebuch

- `MealCard.tsx:38`: Portionsanzahl mit `fmt1` („1,3 × EL“), Editor und Speicherung mit zwei
  Dezimalen („1,25“). `fmt2`.
- `MealCard.tsx:33`: „Schnell hinzugefügt“ → „Schnell eingetragen“ (Wortregel).
- `DiaryMealPage.tsx:129` „Als Meal speichern“ ohne Foto (`saveMealFromEntries` → `photoId: null`),
  `ClipboardMenu.tsx:69` mit Foto. Beide `photoIdsOf(first)[0]` übergeben.
- `MealEditor.tsx:176` `key={i}`, `DiaryGroupPage.tsx:372` Index-Keys nach ↻: Entfernen von Zutat 1
  verschiebt AmountEditor-State (`error`, `extra`) und Disclosure auf die nächste Karte. Stabile
  lokale Keys (`uuidv7()` beim Eintritt in den Draft).
- `PendingAnalysisRow.tsx:62`: Tipp auf eine wartende/fehlgeschlagene Analyse öffnet die Kamera (ohne
  `warmUpCamera`) statt das Item. Ziel: `/photo?review=<id>` bzw. die „Analysen“-Liste.
  `:34` „Gespeichert, wird analysiert sobald du online bist“ → Komma vor „sobald“, und der Text zeigt
  auch online bei `pending`.
- `DiaryGroupPage` (`:323`): gespeicherte Fotos lassen sich nicht entfernen (X nur bei „Neu“). X für
  alle, mit Undo.
- `ClipboardMenu.tsx:56` „Zwischenablage leeren“ ohne Rückgängig (klein, aber einzige Ausnahme).
- `MealsPage.tsx:15` `sortBy('name')` sortiert nach Code Unit („Ä…“ nach „Z“). `localeCompare(…, 'de')`.
  Keine Möglichkeit, auf `/meals` ein Meal anzulegen („+“ fehlt).
- `MealPage.tsx:18`, `MealEditor.tsx:46`, `MealsPage.tsx:18`: `null` statt Skeleton beim Laden.
- `CalorieCard.tsx:29` `aria-label="Kalorien heute"` auch für andere Tage.
- `WeekStrip.tsx:20, 67`: Wochenpfeile normalisieren `today → undefined` nicht (zwei URLs für
  denselben Tag, Scroll-Restoration unterschiedlich).
- `Page.tsx:39-40`: Zurück ohne History fällt auf `/` (heute) statt auf den `date` der Gruppe.
  `Page.tsx:219` nutzt `window.history.length > 1` → Deep Link in einem Tab mit alter History führt
  aus der App; `goBackOr` (`lib/history.ts`) nutzen.
- `db/groupDraft.ts:208-212`: Name zurück auf den Meal-Namen gesetzt bleibt `groupName` gesetzt
  (folgt Umbenennungen nicht mehr); Bedingung `!first.groupName` streichen (CLAUDE.md-Regel).
- `MealCard.tsx:413, 415`: `aria-label` auf `<svg>` ohne `role="img"`.

---

## F. Ziele, Berichte, Mehr, Training (features/goals, reports, more, exercise, day)

### F1 (P1) Prognose rechnet mit falschem Erhaltungsbedarf

`CompleteDayPage.tsx:32`: `maintenance = targets.kcal − dailyDelta(weeklyRateKg)`. Falsch, sobald das
Ziel geklemmt wurde (`MIN_KCAL`), von Hand geändert, nach Wochentagen gesetzt oder `weeklyRateKg`
später im Profil geändert wurde. Beispiel: Frau, TDEE 1.500, Tempo −1 → Ziel 1.200 (geklemmt),
„Erhaltung“ 2.300, bei 1.200 kcal Prognose −5,0 kg statt −1,4 kg.
Fix: `tdee` (und `bmr`) beim Berechnen am Goal speichern (`goals.tdee` nullable, Migration) oder hier
`calorieGoal(profile)` aus Settings + aktuellem Gewicht neu rechnen; Subtraktion nur als Fallback bei
unvollständigem Profil, dann mit Hinweis.

### F2 (P1) Erneutes Onboarding schreibt ein altes Gewicht als heutigen Eintrag

`OnboardingPage.tsx:39` füllt mit `weightOn(weights, today)` (letztes Gewicht, ggf. Wochen alt);
`saveOnboarding.ts:26` schreibt es immer als `w:<heute>`. Verfälscht Trend, 7-Tage-Schnitt,
Bericht. Fix: Gewicht nur schreiben, wenn es sich vom gespeicherten unterscheidet oder heute noch
keines eingetragen ist.

### F3 (P1) Erneutes Onboarding verwirft eigene Mikro-Ziele

`saveOnboarding.ts:27-32`: nur ein Goal von _heute_ wird gelesen (`micros: existing?.micros ?? {}`).
Ballaststoffe 40 g vom 1.10., Rechner am 23.10. neu → still 30 g. Fix: `goalForDate(goals, today)`
wie `GoalsPage.tsx:79`.

### F4 (P2) Settings-Schreibpfade inkonsistent und verlustanfällig

- `GoalsPage.tsx:99`: `patchRecord('settings')` gibt bei fehlendem Datensatz `undefined` zurück
  (Nutzer ohne Onboarding) → Makro-Plan geht verloren. `saveRecord` mit `DEFAULT_SETTINGS`-Basis wie
  `MorePage.tsx:98-100`.
- `ProfilePage.tsx:123`, `MealNamesPage.tsx:48-52`: speichern die komplette, beim Mount kopierte
  Settings-Kopie → ein Pull dazwischen (Mahlzeitnamen vom Handy) wird mit höherem `updatedAt`
  überschrieben. `patchRecord` nur mit den Feldern des Formulars (nach B1-Fix atomar).
- `GoalsPage.tsx:98-107, 219-222`: Plan wird gespeichert, auch wenn „Makros übernehmen“ nicht
  gedrückt wurde → nächstes Mal „Low Carb“ markiert, Gramm alt. Nur gespeichern, wenn angewendet,
  oder beim Wählen anwenden (wie Onboarding).
- Eine Funktion `saveSettings(db, patch)` für alle vier Seiten.

### F5 (P2) Berichte ignorieren „Trainingskalorien anrechnen“

`shared/reports.ts:119` (`<= targetKcal + exerciseKcal`), `chartData.ts:64` („Ziel inkl. Training“).
Tagebuch und Tagesabschluss respektieren die Einstellung. Fix: `creditExercise` in `dailyRows`/
`periodStats` und `buildChart`. Dazu: „N im Ziel“ zählt jeden Tag unter dem Budget (600 kcal = „im
Ziel“) → Band ±10 % oder Umbenennung „unter dem Ziel“; „Ziel Ø 0“ bei leerem Zeitraum
(`ReportsPage.tsx:166`) → `NO_VALUE`.

### F6 (P2) Zucker-Ziel vergleicht freie Zucker mit Gesamtzucker

`shared/goals.ts:21` („freie Zucker < 10 %“) gegen `N.sugar` (BLS Gesamtzucker inkl. Laktose,
Fruchtzucker). 500 ml Milch + zwei Äpfel = „über max.“ ohne zugesetzten Zucker. Fix: als
„Zucker gesamt“ ohne „max.“-Urteil zeigen oder Referenz anpassen (z. B. 90 g/Tag Orientierung) und
Quelle im Infotext korrigieren; About-Text ebenso.

### F7 (P2) About-Seite macht falsche Datenschutz-Aussagen

`AboutPage.tsx:80-81`: „Fotos werden nicht gespeichert. Nährwerte stammen immer aus BLS bzw. Open
Food Facts.“ Fotos liegen auf Gerät und eigenem Server; Nährwerte kommen auch aus eigenen
Lebensmitteln und KI-Schätzungen. Fix: genau beschreiben (Fotos auf Gerät und deinem Server, nicht
bei Anthropic gespeichert; Schätzung als letzte Stufe, markiert).

### F8 (P2) Gewicht nur per Wischen löschbar

`ProgressPage.tsx:185-213`: `WeightDialog` hat kein „Löschen“; `SwipeToDelete` verlangt laut eigenem
Kontrakt eine Löschmöglichkeit im Detail (Tastatur, Screenreader, Unkundige). Fix: „Löschen“ im
Dialog mit demselben Undo-Toast. Dazu `:179` nur 60 Einträge gelistet (ältere nicht editierbar) →
„Mehr laden“.

### F9 (P2) Onboarding-Details

- `OnboardingPage.tsx:132` `Math.abs((target − weight) / rate)`: Richtung ignoriert → „Ziel in 40
  Wochen“ bei 80 → 70 kg mit +0,25. Nur zeigen, wenn Vorzeichen passen, sonst Hinweis.
- `:248` Warnung „> 1 % des Körpergewichts“ nur bei `rate <= -1`, unabhängig vom Gewicht (60 kg:
  −0,75 ist schon 1,25 %). `|rate| / weight > 0.01`.
- `:97-107`: „Weiter“ inaktiv ohne Erklärung (Größe 110, Alter 13). Feldfehler wie `WeightDialog`.
- Zurück von Schritt 3 auf 2 und wieder vor verwirft handgeänderte kcal/Makros.
- `sex: null` ist im Schema erlaubt; Onboarding erzwingt eine Wahl, `ProfilePage` erlaubt leer →
  `calorieGoal` mit `MIN_KCAL[null]` = NaN. In `calorieGoal` auf Mittelwert (−78, MIN 1.350) zurück-
  fallen und im UI „keine Angabe“ anbieten; GoalsPage/CompleteDay prüfen.

### F10 (P3) Weitere Punkte

- `GoalsPage.tsx:81-84, 103`: Wochentag-Toggle aus → stille Übernahme der Montagswerte für alle Tage.
- Ziele, Profil, Mahlzeiten, Onboarding: Speichern inline statt `Page footer`, kein `useBlocker`
  (Toast „Speichern nicht vergessen“ ist das Symptom). Auf das Editor-Muster bringen.
- `TrainingEditorPage.tsx:87-100`: bleibt nach „Speichern“ offen (Meal- und Food-Editor schließen).
- `ExercisePage.tsx:45, 75`: Tag vor dem ersten Gewicht → 75 kg statt des nächsten bekannten Gewichts.
- `TrainingFields.tsx:136-143`: `role="listbox"` um `<button>` (verschachtelt interaktiv, keine
  Pfeiltasten). Eigene Sportarten speichern eine Intensität, obwohl MET fest ist.
- `shared/exercise.ts:309-311`: netto = (MET − 1); der PAL-Faktor zählt Aktivität in diesen Stunden
  schon mit (~0,55 MET·h/h doppelt bei „Aktiv“). Im Infotext dokumentieren oder (MET − PAL) abziehen.
- `ProgressPage.tsx:116, 129`: „Trend / Woche“ und 30-Tage-Änderung ohne „kg“; `:126` „Bis zum Ziel
  −5 kg“ bei Zunehmen; `:167` „Gewicht der letzten gesamten Tage“ bei „Alle“; `:57-60, 86` Trend aus
  zwei Messungen an Nachbartagen (±7 kg/Woche) → Mindestspanne. `:251` Dialog springt zurück, wenn ein
  Pull `last` ändert.
- `ReportsPage.tsx:180`, `chartData.ts:89`: Gewicht mit `fmt1` statt `fmt2` (Konvention).
- `Chart.tsx:121` Zielstufenlinie `align: 1` bei x = Mittag → um einen halben Balken versetzt, letzter
  Tag ohne Segment (plausibel, nicht gerendert). Segment je Tag von x−12 h bis x+12 h.
- `export.ts:95-100`: `intensity` roh (`moderate`), keine `note`-Spalte, `Quelle` roh; Zeitraum „alle“
  beginnt beim ersten Essenseintrag, frühere Nur-Gewicht-Tage fehlen. `DataPage.tsx:151` Dateiname
  mit UTC-Datum → `today()`.
- `DataPage.tsx:40-51`: `labels` ohne `exerciseTemplates` → roher Schlüssel sichtbar. Abgelehnte
  Datensätze nicht löschbar → „Liste leeren“.
- `CompleteDayPage.tsx:85` „wie heute“ auch für vergangene Tage; `:79-82` Abnehmen immer grün.
- `MacroBars.tsx:124-125`: `aria-valuenow > aria-valuemax` bei `role="meter"`.
- `TabBar.tsx`: Fokus nur als Farbwechsel, kein Ring. `aria-label="Hinzufügen"` und `AddSheet`-Titel
  „Hinzufügen“ → „Eintragen“ (Wortregel).
- `LoginPage.tsx:78`: Platzhalter „du@example.com…“ mit Ellipse, wirkt wie Teil der Adresse.
- `theme-init.js`: setzt nur die Klasse; `theme-color`-Metas folgen bis JS-Start dem System (kurz
  helle Statusleiste bei erzwungenem Dark). Meta im Init-Skript mitsetzen.
- `index.html:22` `apple-mobile-web-app-title` „Fleisch Teufel“ ohne Bindestrich.

---

## G. Oberfläche, Zugänglichkeit, Wortwahl (übergreifend)

### G1 (P2) Export auf dem iPhone als Standalone-PWA

`features/reports/export.ts:13-23` `downloadText` (`a.download` + Blob-URL): in der vom
Home-Bildschirm gestarteten App öffnet iOS die Datei im selben Fenster ohne Zurück oder tut nichts.
Fix: `navigator.canShare?.({ files })` → `navigator.share({ files, title })` (Share-Sheet: „In
Dateien sichern“, AirDrop, Mail); sonst wie bisher. Button „Teilen“ statt „Herunterladen“ auf iOS.

### G2 (P3) Kontrast der Hinweisfarben

`index.css:58` `--warn: oklch(0.7 0.15 65)` ohne Dark-Variante; als Text (`MacroPlanPicker.tsx:96`,
`OnboardingPage.tsx:273/300`, `GoalsPage.tsx:190`, `SyncIndicator.tsx:50`) auf Weiß etwa 2,5:1.
`--good` (0.6) als Text (`NoteCard.tsx:54`, `PhotoPage.tsx:792`) etwa 3,3:1. Fix: `--warn-text`
(≈0.55) und `--good-text` (≈0.5) plus Dark-Werte, mit dem dataviz-Palette-Checker prüfen (Muster
`--over-good`).

### G3 (P3) Englische Screenreader-Texte

`components/ui/dialog.tsx:65` „Close“ (sr-only) und `:100` Button „Close“ → „Schließen“.

### G4 (P3) Wortwahl gegen CLAUDE.md

- `vite.config.ts:52` Manifest-Shortcut „Lebensmittel hinzufügen“ → „Essen eintragen“.
- `PhotoPage.tsx:1083` „wird nicht gespeichert“ → „wird nicht eingetragen“.
- `QuickAddPage.tsx:87` Toast nach Bearbeiten „X kcal eingetragen“ → „Änderungen übernommen“;
  Primäraktion in `Page footer`.
- `PhotoPage.tsx:105` „Übernehmen (2 Fotos)“ beim Hinzufügen → „Hinzufügen (2 Fotos)“.
- `PhotoPage.tsx:606` „Erneut versuchen“ vs. Tagebuch „Wiederholen“; `ScanPage.tsx:125,139` „Produkt
  anlegen“ vs. „Selbst anlegen“: je ein Begriff.
- `ProgressPage.tsx:323, 327` Gewicht „Speichern“/„gespeichert“ → „Eintragen“/„eingetragen“.

### G5 (P3) Wheel-Barrierefreiheit

`Wheel.tsx:110-113`: `slider` ohne `aria-valuemin/max`; `listbox` ohne `aria-activedescendant` und
fokussierbare Optionen.

---

## H. Code-Qualität (Refactorings, nach den Fixes)

1. **`PhotoPage.tsx` (1.113 Zeilen) aufteilen:** `PhotoPage`, `PhotoPreview`, `CameraCapture`,
   `QueueRow`, `ResultEditor`, `ReviewRow` je eine Datei unter `features/ai/`; Draft-, Preview-,
   Commit- und Scale-Logik in `useReviewDraft`.
2. **Editor-Logik vereinheitlichen:** `MealEditor` und `DiaryGroupPage` sind Fast-Kopien (commit,
   scale/scaleBase/rescale, leaving-Ref, shouldBlockFn, DiscardDialog): `useDraftEditor`-Hook und
   `ScaleSection`-Komponente; E2, E6, Index-Keys werden dadurch einmal gelöst.
3. **Kamera-Steuerung:** `CameraCapture` und `PhotoCaptureSheet` duplizieren Auslöser, Galerie,
   Torch, `camReady`, `shoot()` → `CameraControls`.
4. **Skalierung:** `SCALE_MIN/MAX` doppelt (`PhotoPage.tsx:630`, `IngredientCard.tsx:35`),
   `scaleDraft` vs. `scaleItems` mit unterschiedlicher Untergrenze → eine Funktion in `lib/amounts.ts`.
5. **Item-Feld-Picker:** `mealItem` (`mealDraft.ts:39`), `entriesToMealItems` (`entries.ts:248`) und
   das Inline-Destructuring in `logItems` → eins. `addItemToMeal` ist ein reiner Durchreicher,
   `logMeal.ts` ein Re-Export; `mealKcal` liest `ENERCC` direkt statt `get(…, N.kcal)`.
6. **Doppelte Regexe/Typen:** Einheits-Label-Regex dreimal (`MealCard.tsx:35`, `amounts.ts:56`,
   `IngredientCard.tsx:28`); `HistoryLike` (`into.ts`) = `IndexedHistory` (`history.ts`); `Shot` =
   `CapturedShot`; `ScanPage.ERRORS` ≈ `CAM_ERRORS`; Mahlzeit-`<Select>` dreimal → `MealSelect`.
7. **Toter Code:** `IngredientCard.tsx:99-108` (Zweig ohne `per100` unerreichbar).
8. **Compiler-Regeln:** `today()` im Render (`MealEditor.tsx:109`, `OnboardingPage.tsx:39`,
   `ProfilePage.tsx:35`, `TrainingEditorPage`, `TrainingsPage`, `AddSheet.tsx:64`) → `useToday()`;
   setState im Effekt `NoteCard.tsx:18-20`.
9. **Formatter je Render:** `WeekStrip.tsx:30` `Intl.DateTimeFormat` pro Tag; `fmtRelativeDay`/
   `fmtAgo` bauen `RelativeTimeFormat` je Aufruf → Modulkonstanten.
10. **Aufräumen:** `apps/web/package.json` Abhängigkeit `cn` (Rest des shadcn-CLI-Fehlers, ungenutzt)
    entfernen; `apps/web/*.tmp.mjs` (gitignored Scratch) löschen; `tools/bls-import` `exceljs`
    aktualisieren (Audit).

---

## I. Tests, die fehlen (nach Priorität)

- A1 richtiges Passwort nach Sperre → 429. A2 Pull-Transaktion. A3 `clock_ahead`. A4 409 bei
  gleichzeitiger Registrierung. A5 Aufräumjob löscht nur unreferenzierte Fotos. A6 Push trotz Foto-500.
- B1 `patchRecord` mit Pull dazwischen. B2 Pull mit unbekannter Tabelle. B3 Transaktion bricht
  komplett ab. B4 Dexie-Fehler → `error`, nicht `offline`.
- C1 `retryQueueItem` → `deferred`. C2 `logDeferred` bei Schreibfehler: Item `failed`, Queue läuft.
  C3 zwei Timeouts → `failed`; `api()` Timeout vs. offline.
- D1/E1 Doppel-Submit (zweiter Aufruf während des ersten ist ein No-op). D2 Fallback-Food behält
  `foodId`. D3 Überlauf → `quantity: null`. D4 Standardportion ohne „Packung“. D6 `lookupBarcode`
  Varianten für eigene Lebensmittel.
- E3 NoteCard-Flush beim Unmount. E4 `saveMealDraft` bei gelöschtem Meal. E7 `groupName` null bei
  Meal-Namen.
- F1 Erhaltungsbedarf aus Profil. F2/F3 `saveOnboarding` (kein neues Gewicht, Mikros erhalten).
  F5 `periodStats` mit `creditExercise`. F9 `calorieGoal` mit `sex: null`.
- E2E: Doppeltipp „Meal eintragen“ erzeugt eine Gruppe; Export per Share-Mock auf `webkit-iphone`.

---

## J. Ideen (P4)

**Daten und Sicherheit**

- Wiederherstellung aus der JSON-Sicherung (`DataPage`): Datei wählen, über `saveRecord` einspielen
  (LWW regelt Konflikte), Fotos als Base64 in die Sicherung aufnehmen oder ZIP.
- Konto löschen (`DELETE /api/auth/account` mit Passwort; Cascade löscht alles, dann lokaler Wipe).
- Geräteliste und Sitzungen abmelden (A7). Passwort-Reset-Skript (A9).
- Serverseitiger KI-Kostenüberblick (`ai_analyses` je Monat) unter „Mehr → Über“ mit Monatsbudget
  (Warnung im Review ab 80 %).
- Nächtliches `pg_dump` + wöchentlicher Restore-Test als Dokumentation im `deploy/`-Ordner.

**Tagebuch und Eingabe**

- „Zuletzt gegessen“ als Schnellzeile oben in jeder Mahlzeit (die drei häufigsten Lebensmittel dieser
  Mahlzeit nach Wochentag), ein Tipp trägt die letzte Menge ein (mit Undo).
- Mahlzeit kopieren: ganze Mahlzeit von gestern einfügen (Zwischenablage kennt schon Gruppen).
- Wasser/Getränke-Zähler als eigene Kachel (ml-Ziel, Tipp-Schritte), optional.
- Tagebuch-Suche: „Wann habe ich zuletzt X gegessen?“ (Index `foodEntries.foodId` existiert).
- Wochenrückblick-Karte am Montag: kcal-Schnitt, Protein-Schnitt, Gewichtstrend, bester/schlechtester Tag.

**Suche und Lebensmittel**

- Verlauf der letzten Suchbegriffe (kv, 10 Einträge) über den Tabs.
- Eigene Lebensmittel: Duplizieren („Kopie von …“), Zusammenführen (Doppelte erkennen über Barcode/Name).
- Rezept-Modus für Meals: Gesamtgewicht nach dem Kochen eingeben, pro 100 g rechnen, als eigenes
  Lebensmittel speichern (Meal → Food).
- OFF-Produktbilder offline: beim Loggen das Bild in `foodCache` als Bytes mitnehmen (klein, 64 px).

**KI**

- Review: „Portion halbieren/verdoppeln“ je Zeile und „Rest weg“ (Teller nicht leer gegessen) als
  Faktor-Preset neben dem Slider.
- Hinweis-Vorlagen beim Foto („halbe Portion“, „mit Öl gebraten“, „ohne Soße“) als Chips.
- Nach dem Eintragen: „War die Schätzung zu hoch/zu niedrig?“ (ein Tipp) in `ai_food_choices`-ähnliche
  Tabelle, für spätere Prompt-Kalibrierung; Eval-Skript (`ai-eval.ts`) mit echten Fotos füttern.
- Günstigeres Modell für Etiketten (`AI_LABEL_MODEL`, Sonnet reicht fürs Abschreiben), Opus nur für
  Tellerfotos.

**Training und Gewicht**

- Gewichtstrend als Hauptzahl (Hacker's Diet, `exponentialTrend` existiert) statt letzter Messung.
- Strava/Apple-Health-CSV-Import für Trainings (offline, Datei wählen).
- Schrittzahl als „Alltagsaktivität“ (manuell), fließt in PAL-Hinweis.

**Plattform**

- Fehler-Telemetrie light: unbehandelte Rejections und `status: 'error'` in `kv` loggen, unter „Daten &
  Sync → Fehlerprotokoll“ anzeigen und kopierbar machen (hilft beim iPhone-Debugging).
- Vite-`manualChunks`, damit `uplot`, `zxing-wasm`, `dnd-kit` nur auf ihren Seiten laden; Lighthouse
  auf dem iPhone-Profil prüfen.
- Playwright `webkit-iphone` für alle Specs (nicht nur Layout), mindestens den Smoke.

---

## Verifikation

1. `pnpm lint && pnpm typecheck && pnpm test` (API-Tests mit eingebettetem PostgreSQL).
2. Neue Tests aus Abschnitt I, je Phase.
3. `pnpm e2e` (chromium-iphone), danach `webkit-iphone` für `ios-layout.spec.ts` und den Smoke.
4. Manuell auf dem iPhone (Standalone): Export per Share-Sheet (G1), Update-Banner während einer
   Analyse (B6), Abmelden-Dialoge (B5), Doppeltipp „Meal eintragen“ (E1), Analyse mit
   Flugmodus-Wechsel (C3/C4), Notiz tippen und sofort Tag wechseln (E3).
5. Zwei Geräte (Handy + Browser): Meal umbenennen, während der Editor offen ist (E2); Gruppe
   eintragen, während das andere Gerät pullt (A2, B1).
