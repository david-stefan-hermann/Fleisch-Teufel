# Auftrag: Bestandsaufnahme "Was muss an Fleisch-Teufel noch besser werden?"

### Worum es geht

Fleisch-Teufel ist ein Ernährungs-Tracker als Offline-PWA, den eine Person täglich auf dem iPhone benutzt
(installierte PWA, Server im Heimnetz hinter einem Reverse Proxy, wenige Konten). Die App ist in vielen
Feedback-Runden schnell gewachsen. Ein vollständiges Code-Review gab es am 2026-10-24
(`docs/plans/2026-10-code-review.md`), seitdem kamen rund 65 Commits ohne Review dazu.

Deine Aufgabe: finde die Stellen, an denen die App noch verbessert werden muss, prüfe jede einzelne und trage
sie in einem Dokument zusammen. Der Nutzer entscheidet danach anhand deiner Liste, was umgesetzt wird. Darum
zählt, dass jeder Punkt stimmt und für sich verständlich ist, mehr als die Anzahl der Punkte. Ein falscher
oder vager Punkt kostet den Nutzer Zeit und Vertrauen in die ganze Liste.

Du änderst keinen Quellcode. Du darfst und sollst die App starten, Tests, Lint, Typecheck, Build und E2E
laufen lassen und eigene Wegwerf-Skripte im Scratchpad schreiben, um Vermutungen zu belegen. Die einzige
Datei, die du im Repo anlegst, ist `docs/plans/2026-11-bestandsaufnahme.md`.

Lies zuerst `CLAUDE.md` im Projekt (Konventionen und Nutzerregeln), `docs/sync.md` und
`.claude/skills/offline-sync/SKILL.md`.

### Was "verbesserungswürdig" hier heißt

Gesucht ist alles, was der Nutzer im Alltag spürt oder was ihm später auf die Füße fällt. In dieser Reihenfolge:

- **P1**: Datenverlust, doppelte oder falsche Einträge, falsche Zahlen (kcal, Makros, Ziele, Berichte),
  Sicherheitslücken, unbegrenzte Kosten (Claude API).
- **P2**: sichtbarer Fehler oder Bedienproblem auf dem iPhone, Abweichung von einer Regel aus `CLAUDE.md`.
- **P3**: Robustheit, Betrieb (Backup, Deployment, Wachstum der Daten), Barrierefreiheit, Geschwindigkeit,
  fehlende Tests an riskanten Stellen, veraltete Dokumentation.
- **P4**: Umbauten, die künftige Arbeit leichter machen, und Ideen. Nur aufnehmen, wenn du den konkreten
  Nutzen benennen kannst (welcher Fehler dadurch unwahrscheinlicher wird, welche Arbeit kleiner).

Nicht gesucht:

- Punkte, die bewusst so entschieden sind. Dazu gehören die Nicht-bauen-Liste
  (`docs/plans/2026-10-marktvergleich.md` Abschnitt 5: Streaks, Community, Rezepte, Fastentimer, KI-Coach,
  Wasserzähler, Sprachsteuerung, Dashboard als Startseite), kein Pinch-Zoom, kein endgültiges Löschen und
  Tombstones für immer, kein Hintergrund-Sync auf iOS, "Meal" als deutsches Wort im UI.
- Vorschläge, die erklärende Sätze ins UI bringen (Nutzerregel: keine Erklärtexte, das UI zeigt den Zustand).
- Geschmacksfragen am Code ohne Folge für Verhalten oder Wartung.

Wenn du eine bewusste Entscheidung für falsch hältst, weil sie einen P1-Schaden verursacht, nimm sie auf und
sag das ausdrücklich dazu.

### Was schon bekannt ist (nicht neu entdecken, aber einordnen)

**Altes Review.** `docs/plans/2026-10-code-review.md` hat Abschnitte A bis J und einen Statusblock. Der
Statusblock ist veraltet: A7 (Geräteliste) ist längst gebaut, mehrere J-Ideen ebenfalls. Gleiche die dort als
offen genannten Punkte mit dem heutigen Code ab und führe sie in deinem Dokument in einer eigenen Tabelle
(erledigt / noch offen / hinfällig, mit Fundstelle). Nach erster Sichtung noch offen: C4 letzter Punkt
(`deferred` bei Offline, wenn jemand wartet), E5 (`MealPage.tsx:36` `key={meal.updatedAt}`), E7
(`MealEditor.tsx:260` `key={i}`), F10 (`Chart.tsx:121` Stufenlinie), H1 bis H3 und H6 (Refactorings), dazu
die als "plausibel" markierten, nie im Code geprüften Punkte C6, E6, F10.

**Offene iPhone-Prüfungen.** Die Pläne der Runden 10 und 11, der Trainings und der Schritte enthalten Listen
"nur am iPhone prüfbar". Die kannst du nicht abarbeiten. Sammle sie in einem Abschnitt "Vom Nutzer am iPhone
zu prüfen" zu einer einzigen Checkliste, ohne Duplikate.

**Nie reviewt** (alles nach dem 2026-10-24, hier ist die Wahrscheinlichkeit für Funde am höchsten):
Marktfunktionen (Kochfett-Zeile, "Zuletzt hier", Rezeptmodus, Verbrauch aus eigenen Daten, Wochenkarte,
vollständige Tage), Web-Push-Erinnerung, Meals einheitlich (⋯-Menü, Meal aus Gruppe speichern, Meals als
Zutaten), Runde 9 bis 11 (Rädchen, Portionen, Gewichtsband, Tag teilen, Navigation `logFlow`/`diaryScroll`,
Formular "Eingeben", 20-Minuten-Regel), Trainings neu (Pakete, Entwürfe, Zwischenablage), Schritte aus Apple
Health (Token-Import, Server schreibt selbst Sync-Datensätze), Konto löschen, Geräteliste, JSON-Wiederherstellung.

**Vom alten Review nicht abgedeckte Blickwinkel:** Geschwindigkeit und Bundle, Abhängigkeiten, Deployment und
Betrieb, Kosten und Qualität der KI-Aufrufe, systematische Barrierefreiheit, Datenbank-Indizes und
Datenwachstum, wackelnde Tests.

### Spuren aus der Vorerkundung

Das sind Hinweise aus Greps und Überfliegen, keine Befunde. Jede Spur musst du selbst am Code oder im
laufenden System bestätigen oder verwerfen; verworfene Spuren kommen mit einem Satz Begründung in den Anhang,
damit sie niemand erneut verfolgt.

Server und Sicherheit:

- `apps/api/src/routes/util.ts:30`: die Client-IP ist der erste `X-Forwarded-For`-Eintrag, und Port 30300 ist
  direkt veröffentlicht (`deploy/docker-compose.yml:13`). Lassen sich die IP-Limits (Registrierung, Login,
  Schritte-Token) umgehen? Gleiches Muster beim `Secure`-Flag über `X-Forwarded-Proto` (`auth/session.ts:83`).
- `apps/api/src/app.ts:68-83`: der Origin-Check lässt Anfragen ohne Origin-Header durch und vertraut
  `x-forwarded-host`; kein Test prüft `forbidden_origin`.
- Rate-Limits liegen nur im Prozessspeicher (`rate-limit.ts`) und sind nach jedem Neustart leer.
- Schritte-Token überleben einen Passwortwechsel (`schema.ts:345`). Gewollt?
- Die neuen Schreibwege ohne Review: `routes/steps.ts`, `routes/push.ts`, `DELETE /api/auth/account`,
  `apps/web/src/db/backup.ts` (Wiederherstellung).

KI-Kosten:

- `routes/ai.ts:159`, `ai/analyze.ts:81,132-136`: einziger Schutz sind 60 Aufrufe pro Stunde und Nutzer im
  Speicher; bis zu 8 Runden mit 16k Tokens und SDK-Wiederholungen. `ai_analyses.cost_usd` wird geschrieben,
  aber nie gelesen: kein Tages- oder Monatsbudget.
- `ai/analyze.ts:200`: `readLabel` hat kein Zeitbudget, anders als die Analyse (100 s).
- `ai/pricing.ts`: Preise fest im Code. Lade den Skill `claude-api`, bevor du KI-Code beurteilst.

Sync und Daten:

- `apps/web/src/sync/syncEngine.ts:296-301, 319-326`: vom Server abgelehnte Datensätze verlassen die Outbox,
  unbekannte Änderungen schieben den Cursor weiter. Die zwei Stellen, an denen Daten still vom Gerät
  verschwinden können. Wie sichtbar ist das für den Nutzer, wie wahrscheinlich nach einem App-Update mit
  neuem Schema bei altem Client im Cache?
- Hypothese: ein alter Client, der einen Datensatz ganz neu schreibt, verliert Felder, die er nicht kennt.
- `apps/api/src/maintenance.ts:17-29`: Fotos ohne Verweis werden nach 30 Tagen gelöscht; die Annahme ist,
  dass kein Gerät länger offline bleibt. Kann ein Foto verloren gehen, das ein Gerät noch hochladen will oder
  das nur in einem nicht synchronisierten Entwurf steht?
- Schritte: eine nicht synchronisierte kcal-Änderung verliert gegen einen neueren Import (dokumentiert, LWW).
- Wachstum ohne Aufräumen: `off_misses`, gecachte OFF-Zeilen in `foods` (komplett in den Speicher geladen,
  `foods/catalog.ts:143`), `ai_analyses`, Tombstones.

Betrieb:

- `.github/workflows/docker.yml` veröffentlicht `:latest` ohne auf CI zu warten; Migrationen laufen beim
  Start automatisch, ohne Sicherung davor.
- Backup ist nur eine Empfehlung in der README (ZFS-Snapshot, `pg_dump` von Hand).
- README: `user:reset-password` per `docker exec` kann im Laufzeit-Image nicht funktionieren (kein pnpm/tsx);
  die Abschnitte "bewusst nicht enthalten" und "Fotos werden nicht gespeichert" stimmen nicht mehr.
- `deploy/.env.example` fehlen `AI_ENABLED`, `REGISTER_RATE_LIMIT`, `PORT`, `HOST` und weitere.
- Dockerfile installiert `@node-rs/argon2@2.2.2` fest neben dem Lockfile; `embedded-postgres` ist eine Beta;
  `web-push` steht im Root-`package.json`; kein Renovate/Dependabot.
- Kein Zugriffslog, keine Fehlerübermittlung vom Gerät an den Server (das Fehlerprotokoll bleibt lokal).
- Dev-Proxy: Login über Vite :5173 gibt 403 `forbidden_origin` (siehe unten "App starten").

Web-App:

- Größe: `features/ai/PhotoPage.tsx` 1 390 Zeilen (21 `useState`, kein Unit-Test), `AddFoodPage.tsx` 702,
  `db/entries.ts` 630, `MealCard.tsx` 564, `DiaryGroupPage.tsx` 558, `FoodLogPage.tsx` 529.
- Schreibende Buttons ohne `useSubmitting` (Regel aus `CLAUDE.md`, Doppeltipp): Kandidaten
  `features/day/CompleteDayPage.tsx:159,163`, `features/goals/OnboardingPage.tsx:337`,
  `features/more/TrashPage.tsx:57,82,108,135`, `features/diary/MealCard.tsx:190` (Einfügen), dazu
  `DataPage.tsx`, `ProgressPage.tsx`, `DiaryDnd.tsx`.
- Timer ohne Aufräumen: `CustomFoodPage.tsx:103`, `BarcodeScanner.tsx:142` und `:233`; zwei
  `requestAnimationFrame` ohne `cancelAnimationFrame`.
- `.catch(() => {})` an 17 Stellen (u. a. `syncEngine.ts:175`, `app/session.tsx:66`, `PhotoPage.tsx:991`,
  `lib/reminder.ts:124`, `lib/steps.ts:122`): wird irgendwo ein Fehler verschluckt, den der Nutzer sehen müsste?
- Englischer Rest: `components/ui/sheet.tsx:68` ("Close" für Screenreader). `RouteError` in `router.tsx`
  zeigt die rohe `error.message`.
- Bundle: Hauptchunk 657 KB, keine `manualChunks`, 10 Routen nicht lazy (darunter `/add`), Source Maps
  werden ausgeliefert, Warnschwelle auf 900 angehoben; vorab gecacht werden auch `bls-compact.json` (940 KB)
  und das zxing-WASM (1,1 MB).
- Kein automatischer Barrierefreiheitstest (kein axe); 39 rohe `<button>` nicht einzeln geprüft.
- Ohne Unit-Tests: `features/auth`, `day`, `progress`, `more`, `steps` (Seiten, `lib/steps.ts`), `goals`
  (außer `saveOnboarding`), `exercise` (fast alles), `hooks/*`, `app/session.tsx`, `lib/reminder.ts`,
  `lib/errorLog.ts`. WebKit-E2E läuft nur für `ios-layout.spec.ts`.
- Bekannter Wackler: E2E "a double tap on 'Meal eintragen' logs the analysis once" fiel einmal durch, nie
  untersucht. Finde heraus, ob das ein echter Fehler (doppelter Eintrag) oder ein Testproblem ist.
- Kleinigkeiten aus den Plänen: "Eintragen ab" zeigt "1000" ohne Tausenderpunkt, `seed-demo.ts` ohne
  Schritte, `share-day.spec.ts` ohne Schritte, unversionierte Datei
  `docs/plans/2026-11-gespeicherte-trainings-mockup.html` ("kann weg"), zwei verbliebene Erklärsätze
  (`2026-11-gespeicherte-trainings.md:55-57`, Entscheidung des Nutzers).

Die Liste ist ein Startpunkt und nicht der Umfang. Die wertvollsten Funde sind erfahrungsgemäß die, die auf
keiner Grep-Liste stehen: falsche Zahlen in der Fachlogik und Abläufe, die über zwei Geräte oder über eine
Unterbrechung (App geschlossen, offline, Update dazwischen) hinweg kaputtgehen.

### Vorgehen

Arbeite in Blickwinkeln und nicht Datei für Datei. Für die breiten Durchgänge lohnt es sich, Unteragenten
parallel loszuschicken (einer je Blickwinkel, mit diesem Auftrag als Hintergrund); deren Meldungen sind
Behauptungen, die du selbst an der genannten Stelle nachliest, bevor sie in die Liste kommen.

1. **Daten und Sync**: jeder Schreibweg auf synchronisierte Tabellen, Entwürfe (`mealDraft`, `groupDraft`,
   `trainingDraft`, `aiQueue`), Konflikte zwischen zwei Geräten, Server-Schreiber (Schritte), Papierkorb,
   Wiederherstellung aus JSON, Schemawechsel mit altem Client.
2. **Zahlen**: `packages/shared` (TDEE, Budget mit Training und Schritten, Verbrauchsschätzung, vollständige
   Tage, Berichte, Rezeptmodus, Portionen und Einheitenwechsel, `trainingKcal`). Rechne Beispiele von Hand
   nach und vergleiche, was Tagebuch, Tagesübersicht, Bericht, CSV und geteiltes Bild für denselben Tag zeigen.
3. **Server**: Authentifizierung, Limits, Eingabeprüfung, KI-Kosten, Hintergrundjobs, Indizes.
4. **Abläufe im UI**: gehe alle 35 Routen aus `apps/web/src/app/router.tsx` mit ihren Suchparametern
   (`date`, `meal`, `into`, `review`, `form`, `label`, `copy`, `scope`) im laufenden System durch, im
   iPhone-Format, hell und dunkel, mit Demodaten und mit leerem Konto. Achte auf Regeln aus `CLAUDE.md`:
   Wortwahl (eintragen / speichern / hinzufügen / Änderungen übernehmen), Zurück-Verhalten, keine
   Erklärtexte, Eingaben mit 16 px, `useSubmitting`, Dialoge über der Tastatur. Prüfe leere Zustände,
   Ladezustände, Fehlerzustände, offline.
5. **Barrierefreiheit und Geschwindigkeit**: Rollen und Beschriftungen, Kontrast in beiden Themen,
   Ladezeit und Bundle, lange Listen (viele Einträge, 60 Tage Verlauf).
6. **Betrieb**: Deployment, Backup und Wiederherstellung, Updates der PWA, Logs, Abhängigkeiten
   (`pnpm audit`, `pnpm outdated`), Dokumentation gegen Wirklichkeit.
7. **Tests**: wo fehlt ein Test an einer Stelle, an der ein Fehler P1 oder P2 wäre; welche Tests wackeln.

Belegen: Wo immer es geht, zeig den Fehler, statt ihn zu behaupten: ein Wegwerf-Test im Scratchpad gegen die
echte Funktion, ein `curl` gegen den Dev-Server, ein Playwright-Skript mit Screenshot. Lege Skripte und
Screenshots im Scratchpad ab, nicht im Repo.

**App starten** (in diesem Container, kein Docker): `pnpm dev` (API :3000, Vite :5173, Dev-DB im
Home-Verzeichnis), Demodaten mit `pnpm --filter @ft/api seed:demo`. Der Login über Vite :5173 scheitert mit
403; wie es trotzdem geht (eigenes Playwright-Skript, Proxy :5174), steht in
`/home/dev/.claude/projects/-projects-Fleisch-Teufel/memory/dev-proxy-login.md`. Alternativ den
Produktions-Build über die API ausliefern (`CLAUDE.md`, "Serve the production web build"). `pnpm typecheck`
nur sequenziell. Keine echten Claude-API-Aufrufe in Schleifen: für KI-Abläufe reichen die Fakes der Tests,
höchstens einzelne echte Aufrufe.

Du kannst nicht prüfen: echtes iPhone (Safari-Eigenheiten, Kamera, Teilen-Blatt, Kurzbefehle, Push) und den
Produktivserver. Was nur dort entscheidbar ist, gehört in die iPhone-Checkliste, nicht in die Befunde.

### Ergebnis: `docs/plans/2026-11-bestandsaufnahme.md`

Auf Deutsch, ohne Gedankenstriche (Projektregel), für einen Leser, der deine Arbeit nicht verfolgt hat.

1. **Kurzfassung** (höchstens eine Bildschirmseite): die fünf bis zehn wichtigsten Punkte, je ein Satz, und
   deine Empfehlung, was zuerst angegangen werden sollte.
2. **Befunde**, nach P1 bis P4 sortiert, innerhalb der Stufe nach Bereich. Jeder Befund:
   - Kennung (z. B. `S3`), Titel, Stufe, Bereich
   - Fundstelle(n) als `datei:zeile`
   - Was passiert: ein konkreter Ablauf (Ausgangslage, Schritte, falsches Ergebnis) in zwei bis vier Sätzen
   - Beleg: **nachgestellt** (wie, Skript oder Screenshot im Scratchpad benennen), **im Code gelesen**
     (die Zeilen, aus denen es folgt) oder **Vermutung** (was zur Bestätigung fehlt). Vermutungen nur
     aufnehmen, wenn der mögliche Schaden P1 oder P2 wäre.
   - Richtung der Lösung in ein bis zwei Sätzen, Aufwand (klein: unter einer Stunde, mittel: halber Tag,
     groß: mehr), und ob der Nutzer vorher etwas entscheiden muss
3. **Stand des alten Reviews**: Tabelle der dort offenen Punkte mit heutigem Stand.
4. **Vom Nutzer am iPhone zu prüfen**: eine Checkliste.
5. **Fragen an den Nutzer**: Entscheidungen, ohne die ein Befund nicht umgesetzt werden kann.
6. **Anhang**: verworfene Spuren mit je einem Satz Begründung; was du nicht geprüft hast und warum.

Fasse gleichartige Fundstellen zu einem Befund zusammen (ein Befund "Buttons ohne `useSubmitting`" mit allen
Stellen, nicht sieben Befunde). Schreib keine Lösungen aus und keinen Code; die Umsetzung wird nach der
Auswahl eigens geplant.

Am Ende meldest du im Chat nur: Anzahl der Befunde je Stufe, die drei wichtigsten in je einem Satz, und was
ungeprüft blieb.
