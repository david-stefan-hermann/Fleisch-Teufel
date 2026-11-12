# Bestandsaufnahme: Was an Fleisch-Teufel noch besser werden muss (November 2026)

Stand: 2026-11-11, Commit bdbba3a (main, gleich origin/main). Auftrag: `docs/plans/2026-11-bestandsaufnahme-auftrag.md`.

**Status:** Alle Befunde sind in `docs/plans/2026-11-verbesserungen.md` (Blöcke 0 bis 13) eingeplant und am
2026-11-12 umgesetzt; Stand, Commits und Abweichungen stehen dort im Statusblock. Dieses Dokument bleibt der Befund
zum Stand bdbba3a (Zeilenangaben veraltet).

Geprüft in sieben Blickwinkeln (Daten und Sync, Zahlen, Server und KI, Web-Code gegen die Regeln aus `CLAUDE.md`,
Abläufe live im Browser, Betrieb, Tests und altes Review). Jeder Befund unten ist an der genannten Stelle im Code
nachgelesen; „nachgestellt“ heißt, ein Wegwerf-Skript, ein curl oder ein Playwright-Lauf hat den Fehler gezeigt.
Skripte und Screenshots liegen im Scratchpad der Sitzung (nicht im Repo), die Pfade stehen beim Befund relativ zu
diesem Ordner (`scratchpad/…`).

Stand der Werkzeuge: `pnpm typecheck`, `pnpm test` (118 shared, 315 web, 199 API, 5 bls-import) und `pnpm build` grün.
`pnpm lint` scheitert nur an Prettier für die unversionierte Auftragsdatei. `pnpm e2e` lief nicht vollständig;
der Wackler wurde gezielt 44-mal wiederholt (T1).

---

## 1. Kurzfassung

Die wichtigsten Punkte:

1. **K1** Die Claude-Kosten haben keine Obergrenze über die Stunde hinaus: 60 Analysen pro Stunde und Konto, Zähler
   im Speicher, kein Tages- oder Monatsbudget, `cost_usd` wird nie gelesen.
2. **Z1** Der Zielvorschlag aus dem eigenen Verbrauch ist zu niedrig, wenn Training nicht angerechnet wird (Beispiel:
   0,86 statt 0,5 kg pro Woche Abnahme).
3. **Z2** Der laufende Tag zählt nach zwei Mahlzeiten als „vollständig“ und drückt mittags Wochenschnitt,
   Verbrauchsschätzung und Zielvorschlag.
4. **U1** Ein Doppeltipp auf das Einfügen-Symbol trägt die kopierte Zeile zweimal ein.
5. **D3** Eine JSON-Wiederherstellung auf einem veralteten Gerät überschreibt neuere Serverdaten und holt Gelöschtes
   zurück.
6. **D2** Vom Server abgelehnte Datensätze bleiben unsichtbar auf dem Gerät und zählen dort weiter (nachgestellt:
   doppelte Schritte-kcal durch ein altes App-Update).
7. **D1** Nach dem Zurückspielen eines Datenbank-Backups (so wie die README es empfiehlt) laufen die Geräte still
   auseinander.
8. **B1** Das Docker-Image `:latest` wird auch bei roter CI und vor dem Smoke-Test veröffentlicht (dreimal belegt).
9. **U4** Die Tagesnotiz schreibt Text zurück, den man gerade wieder gelöscht hat.
10. **U2** Nach „Ziele speichern“ im Onboarding führt Zurück wieder ins fertige Formular.

**Empfehlung:** Zuerst die kleinen P1-Punkte in einem Block: K1 (Budget, Höhe entscheiden), U1, Z1 und Z2 (je unter
einer Stunde, Z1 und Z2 brauchen je eine kurze Entscheidung). Danach B1, weil jeder weitere Push sonst ungetestet
ausgerollt werden kann, und D3 (vor dem Wiederherstellen synchronisieren). D1 und D2 brauchen etwas Konzept und
können in einen eigenen Sync-Block mit D5 und D6.

---

## 2. Befunde

Kennungen: **D** Daten und Sync, **Z** Zahlen, **K** KI, **S** Server und Sicherheit, **U** Oberfläche, **B** Betrieb,
**T** Tests. Aufwand: klein unter einer Stunde, mittel ein halber Tag, groß mehr.

### P1

#### K1 KI-Kosten ohne Tages- oder Monatsbudget

- **Stufe P1, Bereich KI.** Der Auftrag nennt unbegrenzte Kosten ausdrücklich als P1. Auslösen kann es nur ein
  angemeldetes Konto oder ein Fehler im Client (eine Schleife, eine wiederholende Queue).
- **Fundstellen:** `apps/api/src/routes/ai.ts:159` (`new RateLimiter(60, 60 * 60_000)`, Analyse und Etikett teilen sich
  das Limit), `apps/api/src/rate-limit.ts:5` (Map im Prozessspeicher), `apps/api/src/ai/analyze.ts:57`
  (`MAX_ANALYSIS_ROUNDS = 8`), `:81` (`maxRetries: 2`), `:135` (`max_tokens: 16000`); `cost_usd` wird in
  `routes/ai.ts:229` und `:362` geschrieben und serverseitig nirgends gelesen.
- **Was passiert:** Ein Konto kann rund um die Uhr 60 Analysen pro Stunde auslösen; jeder Neustart (jedes Update)
  leert den Zähler. Bei geschätzt 0,2 bis 0,5 $ pro Analyse (bis 8 Runden, durch das 100-s-Budget gedeckelt) sind das
  12 bis 30 $ pro Stunde und mehrere hundert Dollar am Tag, ohne Warnung und ohne Abbruch.
- **Beleg:** im Code gelesen. Der Dollarbetrag ist geschätzt (keine echten Aufrufe erlaubt).
- **Lösung:** Vor jedem Aufruf die Summe von `cost_usd` des Tages oder Monats aus `ai_analyses` lesen (Index
  `(user_id, created_at)` gibt es) und über der Grenze mit 429 ablehnen; zusätzlich ein Ausgabenlimit in der
  Anthropic Console. Zusammen mit K2 umsetzen, sonst fehlen im Budget gerade die teuersten Fälle.
- **Aufwand:** klein. **Entscheidung:** ja, die Budgethöhe (siehe Fragen).

#### Z1 Zielvorschlag aus dem eigenen Verbrauch zu niedrig, wenn Training nicht angerechnet wird

- **Stufe P1, Bereich Zahlen.** Falsches Ziel: die Person nimmt deutlich schneller ab als gewählt.
- **Fundstellen:** `packages/shared/src/expenditure.ts:77-79` (Trainings werden immer abgezogen, Schritte nur, solange
  sie angerechnet werden), `expenditure.ts:99-106` (`targetFromExpenditure`), `apps/web/src/hooks/useExpenditure.ts:53`
  (übergibt nur `creditSteps`), `apps/web/src/features/day/CompleteDayPage.tsx:43-53` (Prognose mit derselben Basis).
- **Was passiert:** 21 Tage je 2 800 kcal gegessen, täglich 400 kcal Training, Gewicht gleich, Tempo −0,5 kg/Woche,
  Training nicht angerechnet. Die Schätzung „ohne Training“ ist 2 400 kcal, der Vorschlag 1 850 kcal. Weil das Training
  nicht ins Budget geht, bleibt es bei 1 850: das echte Defizit ist 950 kcal am Tag, also 0,86 statt 0,50 kg pro Woche.
  Für Schritte ist genau dieser Fall schon gelöst; für Trainings fehlt die gleiche Regel. Die 5-Wochen-Prognose auf
  „Tag abschließen“ rechnet an Trainingstagen aus demselben Grund falsch.
- **Beleg:** nachgestellt, `scratchpad/numbers/check.ts` Abschnitt 2 (Ausgabe in `check.out`).
- **Lösung:** Bei `addExerciseCalories === false` Trainings wie nicht angerechnete Schritte behandeln (nicht abziehen),
  Prognose auf dieselbe Basis.
- **Aufwand:** klein. **Entscheidung:** ja, kurz bestätigen (siehe Fragen).

#### Z2 Der laufende Tag zählt schon nach zwei Mahlzeiten als „vollständig“

- **Stufe P1, Bereich Zahlen.** Falsche Durchschnitte und eine verzerrte Verbrauchsschätzung, jeden Tag zwischen
  Mittag und Abend.
- **Fundstellen:** `packages/shared/src/reports.ts:95-97` (`isCompleteDay` kennt kein „heute“),
  `apps/web/src/hooks/useExpenditure.ts:51` (Fenster endet bei `date`, auf `/progress` heute),
  `apps/web/src/features/reports/ReportsPage.tsx` (Zeilen bis einschließlich heute), `features/reports/chartData.ts:58`
  (der heutige Balken wird farbig statt grau).
- **Was passiert:** 20 Tage je 2 500 kcal, heute um 12:30 Frühstück und Mittag mit 1 200 kcal. Heute gilt als
  vollständig: der Wochenbericht zeigt Ø 2 314 statt 2 500 kcal und „7/7 vollständig“, die Verbrauchsschätzung sinkt
  von 2 500 auf 2 440 kcal (bei nur 14 Tagen Daten um etwa 90 kcal), der Zielvorschlag mit. Am Abend stimmt es wieder.
- **Beleg:** nachgestellt, `scratchpad/numbers/check.ts` Abschnitt 3.
- **Lösung:** Heute nur als vollständig zählen, wenn er abgeschlossen ist; die Schätzung am Vortag enden lassen.
- **Aufwand:** klein. **Entscheidung:** ja (siehe Fragen).

#### U1 Doppeltipp auf „Einfügen“ trägt zweimal ein

- **Stufe P1, Bereich Oberfläche.** Doppelte Einträge.
- **Fundstellen:** `apps/web/src/features/diary/MealCard.tsx:190` (`PasteButton`: `onClick={() => void pasteWithToast(…)}`
  ohne `useSubmitting` und ohne `disabled`), genutzt im Tagebuch und auf `/diary-meal` (`DiaryMealPage.tsx:64`).
- **Was passiert:** Eine Zeile per Wischen kopieren, auf das Einfügen-Symbol einer Mahlzeit doppelt tippen: die Zeile
  steht zweimal da (`logParts` vergibt jedes Mal neue IDs, die Zwischenablage bleibt nach dem Einfügen bestehen). Ein
  Fehler beim Einfügen (Quota, Zod) wird außerdem nicht als Toast gezeigt. Das Einfügen in der Trainingskarte
  (`ExerciseCard.tsx:96-103`) ist richtig gesperrt.
- **Beleg:** nachgestellt zweimal: Vitest `scratchpad/ui/static/paste.test.tsx` (2 Einträge nach Doppelklick) und
  Playwright `scratchpad/ui/dbl.mjs` mit Screenshot `scratchpad/ui/shots/dbl-paste.png`.
- **Lösung:** `PasteButton` über `run()` von `useSubmitting` mit `disabled={busy}`, wie in der Trainingskarte.
- **Aufwand:** klein. **Entscheidung:** nein.

### P2

#### D1 Nach dem Zurückspielen der Server-Datenbank laufen die Geräte still auseinander

- **Stufe P2, Bereich Sync.** Der Schaden ist P1 (Datenverlust, falsche Zahlen), tritt aber nur nach einem Restore auf;
  die README empfiehlt genau diesen Weg (ZFS-Snapshot oder `pg_restore --clean`, `README.md:115-119`).
- **Fundstellen:** `apps/api/src/sync/service.ts:145` (`gt(t.changeSeq, since)`), `:157` (Cursor),
  `apps/web/src/sync/syncEngine.ts:317-318, 342` (Cursor wird gespeichert, nie geprüft).
- **Was passiert:** Die Datenbank wird auf den Stand von gestern gesetzt, `sync_seq` damit auch. Alle Geräte haben
  einen höheren Cursor. Was seit dem Snapshot geschrieben wurde, liegt nur noch auf den Geräten und nicht mehr in der
  Outbox, wird also nie wieder hochgeladen; neue Änderungen bekommen Sequenzen unter den Geräte-Cursorn und werden von
  den anderen Geräten für immer übersprungen. Der Status zeigt „Synchronisiert“; die JSON-Wiederherstellung hilft
  nicht, weil das Gerät alles in gleicher Version hat.
- **Beleg:** nachgestellt, `scratchpad/sync/findings.test.ts` T1 (Ergebnis `bHasX3: false, cHasX2: false, aOutbox: 0,
bStatus: 'idle'`).
- **Lösung:** Eine Datenbank-Epoche (zufällige ID, bei Init oder Restore neu) in jeder Pull-Antwort; ändert sie sich
  oder liegt der Cursor über dem Maximum, setzt das Gerät den Cursor zurück und lädt alle eigenen Datensätze erneut hoch
  (LWW entscheidet). Mindestens den Restore-Abschnitt der README um diesen Schritt ergänzen.
- **Aufwand:** mittel. **Entscheidung:** ja, ob das Neuhochladen automatisch laufen soll.

#### D2 Abgelehnte Datensätze bleiben unsichtbar auf dem Gerät und zählen weiter (doppelte Schritte-kcal)

- **Stufe P2, Bereich Sync.** Falsches Tagesbudget auf einem Gerät, Status „Synchronisiert“, der überzählige Eintrag
  ist nicht sichtbar und nicht löschbar.
- **Fundstellen:** `apps/web/src/db/write.ts:49-50` (prüft nur das Zod-Schema, nicht `requiredId`),
  `apps/api/src/sync/service.ts:85-89` (Server lehnt mit „id must be s:<date>“ ab), `syncEngine.ts:294-301`
  (Outbox-Eintrag weg, nur eine Liste in `kv`), `components/SyncIndicator.tsx:14-27` (abgelehnte zählen im Status nicht),
  `packages/shared/src/diary.ts:151-153` (summiert die kcal aller Schritte-Einträge eines Tages),
  `features/diary/ExerciseCard.tsx:87` (zeigt nur den ersten).
- **Was passiert:** Ein zweites Gerät läuft noch mit der App vor dem 2026-11-10 (Update-Banner nicht angetippt). Sein
  „Wie gestern“ kopiert den Schritte-Eintrag `s:<gestern>` als Training mit neuer UUID; der Server lehnt ihn ab, der
  Datensatz bleibt lokal. Kommt später `s:<heute>` per Import, zählt dieses Gerät beide (567 statt 234 kcal), die Karte
  zeigt einen. Allgemein: jeder abgelehnte Datensatz lebt auf dem Gerät weiter, die anderen sehen ihn nie.
- **Beleg:** nachgestellt, `scratchpad/sync/steps-orphan.test.ts` und `findings.test.ts` T3.
- **Lösung:** `requiredId` schon beim Schreiben prüfen; abgelehnte Datensätze im Sync-Status zeigen und lokal markieren
  oder verwerfen; Schritte je Tag nur über `s:<date>` zählen.
- **Aufwand:** klein bis mittel. **Entscheidung:** nein.

#### D3 JSON-Wiederherstellung überschreibt neuere Serverdaten und holt Gelöschtes zurück

- **Stufe P2, Bereich Sync.** Schaden P1 (zurückgedrehte Änderungen, wiederbelebte Einträge auf allen Geräten), Anlass
  selten.
- **Fundstellen:** `apps/web/src/db/backup.ts:58-64` (Vergleich nur mit dem lokalen `updatedAt`, dann `saveRecord` mit
  frischer Version), `apps/web/src/features/more/DataPage.tsx:38-44` (kein Sync vorher).
- **Was passiert:** Sicherung am Tag X, danach wird ein Eintrag gelöscht und ein Meal geändert. Auf einem Gerät, das
  seit X nicht synchronisiert hat (oder frisch angemeldet ist und noch zieht), wird die Sicherung eingespielt: alles,
  was das Gerät nicht oder älter kennt, bekommt eine neue Version und gewinnt gegen den Server. Der gelöschte Eintrag
  lebt wieder, die Änderung am Meal ist überall weg.
- **Beleg:** nachgestellt, `scratchpad/sync/findings.test.ts` T2 (`restored: 3`, danach `deleted: false`).
- **Lösung:** Vor dem Einspielen synchronisieren und ohne erfolgreichen Abgleich nicht einspielen, oder die
  ursprüngliche `updatedAt` behalten, damit LWW gegen den Server richtig entscheidet.
- **Aufwand:** klein. **Entscheidung:** ja, welche Bedeutung „Wiederherstellen“ haben soll (siehe Fragen).

#### D4 „Gerätedaten löschen“ verspricht „Alle Daten bleiben auf dem Server“, obwohl Fotos und Analysen nur lokal liegen

- **Stufe P2, Bereich Sync.** Datenverlust nach einer bewussten Aktion, aber mit falscher Zusage im Dialog.
- **Fundstellen:** `apps/web/src/features/more/AccountPage.tsx:229-231` (Text, sobald `sync.pending` 0 ist), `:248`
  (letzter Upload nur bei `pending > 0`), `sync/syncEngine.ts:136-138` (`pending` zählt nur die Outbox),
  `app/session.tsx:115` (`db.delete()`).
- **Was passiert:** Ein Foto-Upload ist gescheitert (Datensätze sind trotzdem gepusht, Outbox leer) oder eine Analyse
  wartet offline in `aiQueue`. „Gerätedaten löschen“ zeigt „Alle Daten bleiben auf dem Server“, versucht nichts und
  löscht: das Foto gibt es nirgends mehr (andere Geräte bekommen 404), die wartende Mahlzeit ist weg, ebenso offene
  Meal-, Gruppen- und Trainingsentwürfe.
- **Beleg:** im Code gelesen (Zeilen oben).
- **Lösung:** Nicht hochgeladene Fotos und offene Analysen in die Zählung, die Warnung und den letzten Upload-Versuch
  aufnehmen.
- **Aufwand:** klein. **Entscheidung:** nein.

#### Z3 Wochenkarte und Wochenbericht zeigen unter gleichem Namen verschiedene Zahlen

- **Stufe P2, Bereich Zahlen.** Sichtbarer Widerspruch; die Karte verlinkt genau auf diese Berichtswoche.
- **Fundstellen:** „Ziel Ø“: `packages/shared/src/expenditure.ts:150` (Budget inkl. angerechnetem Training) gegen
  `reports.ts:180` und `ReportsPage.tsx:177` (kcal-Ziel ohne Training), Beschriftung in `WeekReviewCard.tsx:81` und
  `ReportsPage.tsx:177`. „Gewicht“: `expenditure.ts:153` (Steigung der Regressionsgeraden) gegen `reports.ts:201-204`
  (letzte minus erste Wiegung).
- **Was passiert:** Ziel 2 000, zwei Trainings à 500 kcal, Wiegungen 81,0 / 80,0 / 80,6 / 80,5. Karte: „Ziel Ø 2 143“,
  „Gewicht −0,07 kg“. Bericht nach dem Tipp: „Ziel Ø 2 000“, „Gewicht −0,50 kg“.
- **Beleg:** nachgestellt, `scratchpad/numbers/check.ts` Abschnitt 4.
- **Lösung:** Dieselbe Größe an beiden Stellen oder verschiedene Namen („Budget Ø“, „Trend“).
- **Aufwand:** klein. **Entscheidung:** ja, welche Größe gilt.

#### Z4 CSV „Alles“ + „Tageswerte“ endet am Ende des gerade angezeigten Zeitraums

- **Stufe P2, Bereich Zahlen.** Ein Export namens „gesamt“ ist still unvollständig.
- **Fundstellen:** `apps/web/src/features/reports/ReportsPage.tsx:258` (`to={p.to > today ? today : p.to}`), `:306-317`
  (`dailyRows({ from: first, to, … })` mit diesem `to`), `:290` (Dateiname `…_gesamt`).
- **Was passiert:** Im Bericht auf September blättern, „Alles“ und „Tageswerte“ wählen: `fleisch-teufel_tage_gesamt.csv`
  endet am 30.09., Oktober und November fehlen. „Alles“ beginnt außerdem beim ersten Essenseintrag; frühere Gewichte und
  Trainings fehlen in den Tageswerten. Die anderen drei Exporte mit „Alles“ sind vollständig.
- **Beleg:** im Code gelesen.
- **Lösung:** Für „Alles“ bis heute rechnen, Beginn beim frühesten Datensatz aller Tabellen.
- **Aufwand:** klein. **Entscheidung:** nein.

#### U2 Nach „Ziele speichern“ im Onboarding führt Zurück wieder ins Formular

- **Stufe P2, Bereich Oberfläche.** Regel aus `CLAUDE.md`: nach Speichern nie zurück ins fertige Formular.
- **Fundstellen:** `apps/web/src/features/goals/OnboardingPage.tsx:123` (`await navigate({ to: '/' })` ohne `replace`),
  Knopf `:337` ohne `useSubmitting`.
- **Was passiert:** Leeres Konto, Onboarding ausfüllen, „Ziele speichern“: das Tagebuch erscheint, die Wischgeste zurück
  zeigt wieder `/onboarding`. Ein Doppeltipp zeigt zwei Toasts (Daten bleiben einfach, feste IDs).
- **Beleg:** nachgestellt, `scratchpad/ui/onb.mjs` (Ausgabe `back -> /onboarding`).
- **Lösung:** `replace` und `useSubmitting`.
- **Aufwand:** klein. **Entscheidung:** nein.

#### U3 Doppeltipp auf „Anlegen“ einer eigenen Sportart legt sie zweimal an

- **Stufe P2, Bereich Oberfläche.** Kein Tagebucheintrag, aber eine doppelte Zeile unter „Eigene“.
- **Fundstellen:** `apps/web/src/features/exercise/TrainingFields.tsx:145` (`CustomTypeDialog`, `uuidv7()` je Tipp, ohne
  `useSubmitting`).
- **Was passiert:** Zwei schnelle Tipps auf „Anlegen“ erzeugen zwei gleichnamige Sportarten.
- **Beleg:** im Code gelesen.
- **Lösung:** `useSubmitting` wie an den anderen Knöpfen.
- **Aufwand:** klein. **Entscheidung:** nein.

#### U4 Tagesnotiz schreibt gerade wieder gelöschten Text

- **Stufe P2, Bereich Oberfläche.** Text, den die Person zurückgenommen hat, landet in der synchronisierten Notiz.
- **Fundstellen:** `apps/web/src/features/diary/NoteCard.tsx:38-39` (`local === saved` setzt `local` auf `null`),
  `:42-46` (Effekt bricht ab, Timer weg, `pending.current` bleibt), `:50-57` und `:124-134` (`flush` beim Verlassen
  oder Ausblenden schreibt `pending`).
- **Was passiert:** Notiz „Gut“, die Person tippt „ geschlafen“ und löscht es innerhalb von 0,7 s wieder. Beim
  Verlassen des Tages oder beim Wechsel in den Hintergrund wird „Gut geschlafen“ gespeichert.
- **Beleg:** nachgestellt, `scratchpad/ui/static/notecard.test.tsx` (erwartet „Gut“, erhalten „Gut geschlafen“).
- **Lösung:** Beim Zurückfallen auf den Datensatz auch `pending` leeren, oder `flush` nur bei Abweichung schreiben.
- **Aufwand:** klein. **Entscheidung:** nein.

#### U5 Abgeschnittene Zahlen bei 375 px Breite (iPhone mini und SE)

- **Stufe P2, Bereich Oberfläche.** Sichtbarer Fehler auf kleinen iPhones.
- **Fundstellen:** `apps/web/src/components/NutrientBreakdown.tsx:152` (`whitespace-nowrap`: „… · 138 kca“ in Berichten),
  `apps/web/src/features/goals/GoalsPage.tsx:177` (`grid-cols-3`: Makrofelder zeigen „15(“ statt „150 g“),
  `apps/web/src/features/diary/DiaryPage.tsx:77` (`truncate`: „Donnerstag, 15. Okto…“ schon bei 390 px).
- **Was passiert:** Auf einem 375-px-Gerät sind Makrozeilen in Berichten und die Ziel-Makrofelder abgeschnitten; der
  Tagebuchkopf kürzt lange Daten auch bei 390 px.
- **Beleg:** nachgestellt mit Inter aus dem Build, `scratchpad/ui/ov.mjs`, Bilder `scratchpad/ui/sheets/mini.png` und
  `crops.png`.
- **Lösung:** Umbrechen oder kürzere Form, Einheit außerhalb des Feldes, kürzeres Datum („Do, 15. Okt.“).
- **Aufwand:** klein. **Entscheidung:** nein.

#### U6 Verbliebene Erklärsätze im UI

- **Stufe P2, Bereich Oberfläche.** Abweichung von der Nutzerregel (keine Sätze, die Bedienung erklären). Nicht
  aufgenommen sind die Sätze, die der Nutzer laut `2026-11-gespeicherte-trainings.md:50-53` bewusst behalten hat
  („Du kannst zurück ins Tagebuch gehen …“, „Der Text steht als Titel …“, `DataPage`, Installations- und
  Erinnerungshinweise).
- **Fundstellen:** `components/BarcodeScanSheet.tsx:43` und `features/foods/ScanPage.tsx:121` („Halte den Barcode in den
  Rahmen.“), `components/BarcodeScanSheet.tsx:26` („Du kannst den Code im Feld eintippen.“), `features/ai/PhotoPage.tsx:995`
  (Toast „Unter „Gespeicherte Meals“ kannst du es jederzeit …“), `features/diary/DiaryGroupPage.tsx:330` (Toast „Prüfe die
  Zutaten und tippe auf …“), `features/progress/ExpenditureCard.tsx:67` („Unter „Ziele“ kannst du alles nachjustieren.“),
  Toast „… Fotografiere das Etikett.“ in `ScanPage.tsx` (`apply`), `features/day/CompleteDayPage.tsx:101-102` („Eine
  grobe Schätzung ist besser als eine Lücke …“), `features/goals/GoalsPage.tsx:129` („z. B. mehr Kalorien an
  Trainings- oder Wochenendtagen“); dazu die zwei im Trainingsplan als offen notierten („Versuche ein Foto von schräg
  oben …“, der Satz unter Aussehen → Tagebuch).
- **Beleg:** im Code gelesen, live bestätigt (`scratchpad/ui/words.mjs`).
- **Lösung:** Streichen oder durch einen Zustand ersetzen; der Nutzer hakt die Liste einmal ab.
- **Aufwand:** klein. **Entscheidung:** ja, je Satz.

#### U7 Konto-löschen-Dialog ohne `DialogBody`

- **Stufe P2, Bereich Oberfläche.** Regel aus `CLAUDE.md` (alles zwischen Kopf und Fuß in `DialogBody`, damit die
  Knöpfe über der Tastatur bleiben).
- **Fundstellen:** `apps/web/src/features/more/AccountPage.tsx:201` (Passwortfeld direkt zwischen Header und Footer);
  dazu `components/ui/dialog.tsx:59-66` (Schließen-X 16 px ohne Mindest-Tippfläche).
- **Was passiert:** Mit offener Tastatur kann der Knopf „Konto löschen“ verdeckt sein (am iPhone zu prüfen).
- **Beleg:** im Code gelesen.
- **Lösung:** `DialogBody` einsetzen, dem X eine Tippfläche von 40 px geben.
- **Aufwand:** klein. **Entscheidung:** nein.

#### B1 Docker-Image `:latest` erscheint auch bei roter CI und vor dem Smoke-Test

- **Stufe P2, Bereich Betrieb.** Ungetesteter Code wurde nachweislich als `:latest` veröffentlicht; P1 wird es, sobald
  eine Migration Daten umbaut (siehe B2).
- **Fundstellen:** `.github/workflows/docker.yml:3-6` (eigener Auslöser, keine Abhängigkeit von `ci.yml`), `:43`
  (`push: true` mit `latest`) vor `:49` (Smoke-Test gegen das schon veröffentlichte Image); `README.md:96-98` behauptet
  das Gegenteil.
- **Was passiert:** Ein Push startet CI und Docker parallel; `:latest` liegt in der Registry, bevor Tests oder Smoke-Test
  durch sind. Ein „Update“ in Dockge in dieser Zeit holt ein Image mit roten Tests oder eines, das nicht startet.
- **Beleg:** nachgestellt über die GitHub-API: b665031 und dced9fb (2026-10-24) CI `failure`, Docker `success`;
  9f82643 (2026-11-10) CI `cancelled`, Docker `success`.
- **Lösung:** Image-Job mit `needs` an CI hängen (ein Workflow oder `workflow_run`), zuerst nur `:sha-` pushen und
  `:latest` erst nach dem Smoke-Test setzen.
- **Aufwand:** klein. **Entscheidung:** nein.

### P3

#### D5 „Meal eintragen“ im KI-Ergebnis schreibt Einträge und entfernt die Analyse in getrennten Schritten

- **Stufe P3, Bereich Sync.** Doppelter Eintrag möglich, Zeitfenster klein.
- **Fundstellen:** `apps/web/src/features/ai/PhotoPage.tsx:980-992` (erst `logAiMeal`/`logAiItems`, dann `rememberFood`,
  erst zuletzt `discardQueueItem`), `apps/web/src/db/entries.ts:398-426` (`logAiMeal` ohne gemeinsame Transaktion);
  richtig gelöst in `features/ai/queue.ts:184-201` (`logDeferred`).
- **Was passiert:** Wird die App zwischen dem Schreiben der Einträge und `discardQueueItem` beendet, steht die Analyse
  weiter unter „Offene Analysen“ und kann ein zweites Mal eingetragen werden; bei `logAiMeal` kann ein Meal ohne
  Einträge zurückbleiben.
- **Beleg:** im Code gelesen.
- **Lösung:** Wie `logDeferred`: alles in eine Transaktion mit den Queue-Tabellen.
- **Aufwand:** klein. **Entscheidung:** nein.

#### D6 „App-Update nötig“ geht beim Neustart verloren, übersprungene Änderungen kommen nie automatisch nach

- **Stufe P3, Bereich Sync.** Auslöser heute unwahrscheinlich (neue Felder sind alle nullable), Schaden wären fehlende
  Einträge und ein Überschreiben neuerer Serverstände.
- **Fundstellen:** `apps/web/src/sync/syncEngine.ts:84-92` (`needsUpdate: false` als Start), `:124-134` (`start()`
  lädt den Merker nicht), `:319-326` und `:342` (übersprungen, Cursor rückt vor), `:347` (Merker nur im Speicher),
  `features/more/DataPage.tsx:91-96` (Neuladen nur von Hand).
- **Was passiert:** Ein veraltetes Gerät überspringt Version 2 eines Datensatzes und behält Version 1. Nach dem Update
  ist der Hinweis weg, Version 2 fehlt weiter; ändert die Person den Datensatz dort, überschreibt `patchRecord` mit
  Version 1 plus Änderung die Version 2 auf dem Server.
- **Beleg:** im Code gelesen.
- **Lösung:** Merker in `kv` speichern und nach einem App-Update einmal automatisch `resetAndPull` ausführen.
- **Aufwand:** klein. **Entscheidung:** nein.

#### K2 Kosten fehlgeschlagener und abgebrochener KI-Aufrufe werden nicht erfasst

- **Stufe P3, Bereich KI.** Die Statistik ist genau in den teuersten Fällen zu niedrig; wird P2, sobald K1 ein Budget
  aus `cost_usd` baut.
- **Fundstellen:** `apps/api/src/routes/ai.ts:221-234` (Zeile nur nach Erfolg), `:262-264` (Fehlerweg schreibt nichts),
  `apps/api/src/ai/analyze.ts:174-183` (Abbruch nach 100 s, `stop_reason` nicht `end_turn`, Ablehnung).
- **Was passiert:** Eine Analyse läuft 8 Runden oder bis zum Zeitbudget und endet mit 502/504: alle Runden sind
  bezahlt, `ai_analyses` bekommt keine Zeile.
- **Beleg:** im Code gelesen.
- **Lösung:** Gesammelte `usage` an den Fehler hängen und auch im Fehlerfall eine Zeile schreiben.
- **Aufwand:** klein. **Entscheidung:** nein.

#### K3 Abgerissene Verbindung während der Analyse führt zu einer zweiten bezahlten Analyse

- **Stufe P3, Bereich KI.** Doppelte Kosten, kein doppelter Eintrag.
- **Fundstellen:** `apps/web/src/lib/api.ts:46-48` (jeder `fetch`-Fehler außer Timeout wird `OfflineError`),
  `features/ai/queue.ts:261-267` (zurück auf `pending`/`deferred`, später neu gesendet), `apps/api/src/routes/ai.ts:179-265`
  (kein Schlüssel für die Anfrage, ein Abbruch des Clients stoppt die Analyse nicht).
- **Was passiert:** iOS beendet die Verbindung, während der Server analysiert (App geschlossen, WireGuard getrennt).
  Der Server bezahlt und speichert das Ergebnis, der Client sendet dieselben Fotos beim nächsten Lauf erneut.
- **Beleg:** im Code gelesen.
- **Lösung:** Feste Kennung des Queue-Eintrags mitschicken; der Server liefert bei Wiederholung das gespeicherte Ergebnis.
- **Aufwand:** mittel. **Entscheidung:** nein.

#### K4 Etikett lesen ohne Zeitbudget

- **Stufe P3, Bereich KI.**
- **Fundstellen:** `apps/api/src/ai/analyze.ts:200-219` (`messages.parse` ohne `signal`), `:81` (120 s mal 3 Versuche),
  `apps/api/src/routes/ai.ts:348` (kein `AbortSignal.timeout`, anders als `:219`), `apps/web/src/lib/api.ts:115` (Gerät
  wartet 120 s).
- **Was passiert:** Bei langsamer Antwort meldet das Gerät nach 120 s einen Timeout, der Server zahlt bis zu zwei weitere
  Versuche; tippt die Person erneut, laufen zwei bezahlte Aufrufe parallel.
- **Beleg:** im Code gelesen.
- **Lösung:** Dasselbe Gesamtbudget wie bei der Analyse (unter 120 s) als `signal`.
- **Aufwand:** klein. **Entscheidung:** nein.

#### S1 IP-Limits lassen sich mit eigenem `X-Forwarded-For` umgehen

- **Stufe P3, Bereich Server.** Erreichbar nur aus LAN und VPN, Registrierung zu; Folge wären Registrier-Spam bei offener
  Registrierung und Passwortproben gegen viele Konten.
- **Fundstellen:** `apps/api/src/routes/util.ts:32-33` (erster Eintrag zählt), genutzt in `routes/auth.ts:42, 69` und
  `routes/steps.ts:52`; `deploy/docker-compose.yml:13-14` (Port 30300 auf allen Adressen, in Produktion bestätigt).
- **Was passiert:** NPM hängt die echte Adresse hinten an, der Server nimmt den ersten, vom Client gesetzten Eintrag.
- **Beleg:** nachgestellt, `scratchpad/server/limits.sh` (Registrierung nach 429 mit `x-forwarded-for: 2.2.2.2, 1.1.1.1`
  wieder 201; 12 Logins mit wechselnder IP nie 429).
- **Lösung:** Den letzten Eintrag nehmen (ein vertrauter Proxy); Port 30300 nur für NPM erreichbar machen.
- **Aufwand:** klein. **Entscheidung:** ja, wie Port 30300 gebunden sein soll.

#### S2 Zehn falsche Logins sperren den Besitzer 15 Minuten aus

- **Stufe P3, Bereich Server.**
- **Fundstellen:** `apps/api/src/routes/auth.ts:37` (10 Versuche in 15 min), `:70-73` (Schlüssel `user:<email>` sperrt
  vor der Passwortprüfung, auch das richtige Passwort).
- **Was passiert:** Wer im LAN oder VPN die E-Mail kennt, schickt 10 falsche Passwörter; der Besitzer bekommt danach mit
  dem richtigen Passwort 429, beliebig oft wiederholbar. Die angemeldete PWA ist nicht betroffen, nur neue Anmeldungen.
- **Beleg:** nachgestellt, `scratchpad/server/limits.sh` (`too_many_requests, retryAfterMs: 898617`).
- **Lösung:** Kontosperre nur zusammen mit der IP oder richtiges Passwort nur verlangsamen.
- **Aufwand:** klein. **Entscheidung:** nein.

#### S3 Push-Erinnerung: Abo wird nach fünf Fehlern in fünf Minuten still gelöscht

- **Stufe P3, Bereich Server.** In Produktion heute ohne Wirkung (keine VAPID-Schlüssel, Startlog `push:false`).
- **Fundstellen:** `apps/api/src/push.ts:103` (`MAX_FAILURES = 5`), `:149` (Löschen), `:94-96` (Fehler setzen
  `lastSentOn` nicht, also jede Minute neu), `:172-173` (`setInterval` ohne Schutz gegen Überlappung), `:38`
  (`sendNotification` ohne Timeout).
- **Was passiert:** Fünf Minuten Netz- oder DNS-Ausfall des NAS zur Erinnerungszeit, und die Erinnerung ist für immer
  aus; sichtbar nur auf der Seite „Erinnerung“. Hängt ein Versand länger als 60 s, kann der nächste Lauf ein zweites
  Mal senden (Vermutung).
- **Beleg:** Löschen im Code gelesen; doppelte Zustellung Vermutung.
- **Lösung:** Nur bei 404/410 sofort löschen, sonst Fehler über Tage zählen; Timeout und Merker „läuft“.
- **Aufwand:** klein. **Entscheidung:** nein.

#### S4 OFF-Cache wächst unbegrenzt im Speicher

- **Stufe P3, Bereich Server (Wachstum).**
- **Fundstellen:** `apps/api/src/foods/catalog.ts:143-144` (alle OFF-Zeilen beim Start in den Index), `:216-217` und
  `:228-260` (jede Online-Suche speichert bis zu 50 Treffer dauerhaft), `:165` und `:270` (lineare Suche, auch in jeder
  Tool-Runde der KI).
- **Was passiert:** Jede neue Suchanfrage fügt Produkte hinzu, nichts wird gelöscht; Speicher und Suchzeit wachsen linear.
- **Beleg:** nachgestellt, `scratchpad/server/offmem.ts`: 10 000 Produkte +13 MB und 10,6 ms je Suche, 100 000
  Produkte +126 MB und 35,8 ms. Den Produktivbestand konnte ich nicht zählen.
- **Lösung:** OFF-Zeilen ohne Verweis, älter als etwa 90 Tage, in `maintenance.ts` löschen.
- **Aufwand:** mittel. **Entscheidung:** nein.

#### U8 Gelöschter Eintrag bleibt über den Verlauf bearbeitbar

- **Stufe P3, Bereich Oberfläche.** Regel „nach Löschen nie auf die gelöschte Seite“.
- **Fundstellen:** `apps/web/src/features/foods/FoodLogPage.tsx:87` (prüft nur `entry === null`, nicht `deleted`);
  `SportPage.tsx:63` macht es richtig.
- **Was passiert:** Eintrag öffnen, „Änderungen übernehmen“, erneut öffnen, löschen; Zurück aus dem Tagebuch zeigt das
  volle Formular des gelöschten Eintrags, „Änderungen übernehmen“ meldet Erfolg und schreibt einen Sync-Datensatz.
- **Beleg:** nachgestellt, `scratchpad/ui/flowA.mjs`, `flowA2.mjs`, Screenshot `shots/flowA-back-after-delete.png`.
- **Lösung:** Gelöschte Einträge wie nicht gefundene behandeln.
- **Aufwand:** klein. **Entscheidung:** nein.

#### U9 Ungültige IDs in der URL: weiße Seite, falscher Text, stilles Neu-Anlegen

- **Stufe P3, Bereich Oberfläche.** Realistischer Auslöser: ein Datensatz, der auf diesem Gerät noch nicht angekommen
  oder auf einem anderen gelöscht ist.
- **Fundstellen:** `apps/web/src/features/exercise/SportPage.tsx:62` (`!date` gibt `null` zurück, bevor „nicht gefunden“
  greift: `/exercise-entry/<unbekannt>` bleibt weiß ohne Zurück-Knopf); `features/foods/FoodLogPage.tsx:120-122`
  (`/food/<unbekannt>` sagt auch online „Server nicht erreichbar“); `features/foods/CustomFoodPage.tsx:51, 70`
  (`/custom-food/<unbekannt>` zeigt ein leeres Formular „Anlegen“, ein gelöschtes eigenes Lebensmittel öffnet als
  „bearbeiten“ und wird beim Speichern wiederbelebt).
- **Beleg:** nachgestellt, `scratchpad/ui/crawl.mjs`, Screenshots `shots/demo-light-_exercise_entry_xyz.png`,
  `shots/demo-light-_food_xyz.png`.
- **Lösung:** Einheitlicher Zustand „nicht gefunden“, Online/Offline-Text nach Fehlerart.
- **Aufwand:** klein. **Entscheidung:** nein.

#### U10 Seite `/progress` scrollt bei 375 px seitlich

- **Stufe P3, Bereich Oberfläche.**
- **Fundstellen:** `apps/web/src/components/Chart.tsx:216` (die `sr-only`-Tabelle ragt auf 383 px).
- **Was passiert:** `scrollWidth` 383 bei 375 px Viewport; mit `touch-action: pan-x pan-y` kann die Seite auf dem iPhone
  seitlich wackeln.
- **Beleg:** nachgestellt, `scratchpad/ui/ov.mjs`.
- **Lösung:** Container der Tabelle begrenzen.
- **Aufwand:** klein. **Entscheidung:** nein.

#### U11 „Bedarf aus deinen Daten“ widerspricht sich bei unplausibler Schätzung

- **Stufe P3, Bereich Oberfläche.**
- **Fundstellen:** `apps/web/src/features/progress/ExpenditureCard.tsx:116-120`, `packages/shared/src/expenditure.ts:74, 81`
  (`null` bei unplausiblem Trend oder Ergebnis).
- **Was passiert:** Die Karte nennt die Bedingungen (14 Tage, 4 Wiegungen) und daneben „Bisher: 21 Tage, 16 Wiegungen“,
  zeigt aber keinen Wert.
- **Beleg:** nachgestellt mit Demodaten, `scratchpad/ui/shots/demo-light-_progress.png`.
- **Lösung:** Zustand „Daten nicht schlüssig“ getrennt von „zu wenig Daten“ zeigen.
- **Aufwand:** klein. **Entscheidung:** nein.

#### U12 Barrierefreiheit: echte axe-Treffer

- **Stufe P3, Bereich Oberfläche.**
- **Fundstellen:** `features/diary/CalorieCard.tsx:95-110` (`<div>` in `<dl>`), `features/foods/AddFoodPage.tsx:293` und
  `features/exercise/TrainingSearchPage.tsx:245` (Tabs ohne Panels, `aria-controls` ins Leere, axe „critical“),
  `features/exercise/SportPage.tsx:235` (Kontrast 4,37:1 bei „7× eingetragen“, hell), `SportPage.tsx:222` und
  `TrainingLogView.tsx:197` (4,31:1 bei „· 565 kcal“ im Hauptknopf, dunkel), `components/MealPhoto.tsx:159` (`role="img"`
  mit leerem Namen).
- **Was passiert:** VoiceOver liest die Kalorienkarte und die Suchreiter falsch; zwei Texte liegen knapp unter 4,5:1.
- **Beleg:** nachgestellt, axe-core 4.10.2 hell und dunkel, `scratchpad/ui/crawl-demo-light.json`,
  `crawl-demo-dark.json`.
- **Lösung:** Struktur und Farben an den genannten Stellen anpassen.
- **Aufwand:** klein. **Entscheidung:** nein.

#### U13 Schreibende Knöpfe ohne `useSubmitting`, die doppelt navigieren

- **Stufe P3, Bereich Oberfläche.** Daten bleiben einfach (feste IDs oder idempotente Patches), aber ein Doppeltipp
  löst zwei Toasts und zwei Rücksprünge aus; ob die App dann zwei Schritte zu weit zurückgeht, ist am iPhone zu prüfen.
- **Fundstellen:** `features/day/CompleteDayPage.tsx:159, 163` (zweimal `goBackOr` aus `:73`),
  `features/foods/CustomFoodPage.tsx:198` (Löschen mit `from=food`: zweimal zwei Schritte), `features/foods/QuickAddPage.tsx:82`,
  `features/foods/FoodLogPage.tsx:389`, `features/more/TrashPage.tsx:57, 82, 108, 135`, `features/progress/ProgressPage.tsx:382`,
  `features/more/ProfilePage.tsx:168`, `features/more/MealNamesPage.tsx:47`, `features/diary/DiaryDnd.tsx:72`.
- **Beleg:** im Code gelesen; „Tag abschließen“ und Papierkorb live einfach geblieben (`scratchpad/ui/dbl*.mjs`).
- **Lösung:** Dieselbe Regel überall: `run()` von `useSubmitting`.
- **Aufwand:** klein. **Entscheidung:** nein.

#### U14 Fehlermeldungen: unübersetzte Server-Codes, Renderfehler nicht im Protokoll, Schritte-↻ endet stumm

- **Stufe P3, Bereich Oberfläche.**
- **Fundstellen:** `apps/web/src/lib/api.ts:122-160` (`ai_timeout`, `too_many_images`, `unsupported_image_type`,
  `push_disabled` ohne deutsche Meldung: eine Analyse im Server-Zeitbudget zeigt „Fehler (504). Versuche es erneut.“ und
  lädt zum bezahlten Wiederholen ein); `features/more/DataPage.tsx` (jeder Sync-Fehler, auch 401, als „Server nicht
  erreichbar“; abgelehnte Datensätze roh als `{table} {id}: {error}`); `app/router.tsx:343-363` (`RouteError` ohne
  `recordError`, zeigt die rohe englische Meldung, z. B. „Failed to fetch dynamically imported module“);
  `lib/steps.ts:107-131` (kommt in 30 s kein Import an, hört das Drehen einfach auf).
- **Beleg:** im Code gelesen.
- **Lösung:** Codes in `errorMessage` ergänzen (`ai_timeout` wie `TimeoutError`), `RouteError` protokollieren,
  `runStepsShortcut` ein Ergebnis zurückgeben lassen und als Zustand zeigen.
- **Aufwand:** klein. **Entscheidung:** nein.

#### B2 Migrationen ohne Sicherung, kein beschriebener Rückweg

- **Stufe P3, Bereich Betrieb.** Heute ohne Schaden (Migrationen 0000 bis 0014 nur hinzufügend); zusammen mit B1 der Weg
  zu P1.
- **Fundstellen:** `apps/api/src/server.ts:23`, `apps/api/src/db/client.ts:29-31` (`migrate()` beim Start),
  `README.md:112-120`, `deploy/docker-compose.yml:7` (nur `:latest`).
- **Was passiert:** „Update“ in Dockge migriert sofort. Scheitert eine Migration, rollt sie zurück, der Container
  startet aber endlos neu; wie man auf ein älteres `:sha-`-Image zurückgeht, steht nirgends. Ob auf dem NAS
  Snapshots oder `pg_dump` laufen, ist im Repo nicht erkennbar.
- **Beleg:** im Code gelesen; fehlendes Backup ist Vermutung.
- **Lösung:** Vor dem Migrieren einen Dump schreiben (Job im Compose) oder bestätigen, dass Snapshots laufen; Rückweg
  über `:sha-<commit>` in die README.
- **Aufwand:** klein bis mittel. **Entscheidung:** ja (siehe Fragen).

#### B3 Passwort zurücksetzen geht auf keinem dokumentierten Weg

- **Stufe P3, Bereich Betrieb.**
- **Fundstellen:** `README.md:122-124`, `apps/api/scripts/reset-password.ts:3-5`, `apps/api/build.mjs:11` (baut nur
  `src/server.ts`), `Dockerfile:28-30`, `deploy/docker-compose.yml:19-33` (DB ohne veröffentlichten Port).
- **Was passiert:** `pnpm … user:reset-password` per `docker exec` geht nicht (kein Workspace, kein tsx im Image);
  `node dist/reset-password.js` (Kommentar im Skript) wird nicht gebaut; ein Checkout auf dem NAS erreicht die DB nicht.
  Übrig bleibt `psql` mit einem selbst erzeugten Argon2-Hash.
- **Beleg:** im Code gelesen, Inhalt von `apps/api/dist` nach dem Build gelistet.
- **Lösung:** `reset-password` als zweiten Einstieg mitbauen, README auf `docker exec fleisch-teufel node reset-password.js <mail>`.
- **Aufwand:** klein. **Entscheidung:** nein.

#### B4 README stimmt nicht mehr, darunter eine falsche Datenschutzaussage

- **Stufe P3, Bereich Betrieb (Doku).**
- **Fundstellen:** `README.md:56-58` (Fotos würden „nicht gespeichert“; sie liegen als `bytea` in `photos`,
  `apps/api/src/db/schema.ts:375-384`), `:37-38` (Erinnerungen und Health-Sync „bewusst nicht enthalten“, beide gebaut),
  `:27` („Blitz zur Schnelleingabe, Lupe zur Suche“, heute „Eingeben“ und „Suchen“), `:31` („0,05-kg-Raster“, heute
  einstellbar), `:106` (`/health` liefert nur `{ ok }`), `:96-98` (Smoke-Test, siehe B1).
- **Beleg:** im Code gelesen.
- **Lösung:** Korrigieren; bei den Fotos sagen, dass sie auf dem eigenen Server liegen und 30 Tage nach dem letzten
  Verweis gelöscht werden.
- **Aufwand:** klein. **Entscheidung:** nein.

#### B5 zod mit Sicherheitsmeldung „high“ in der Laufzeit

- **Stufe P3, Bereich Betrieb.** Der Server prüft jede Anfrage mit zod; das Body-Limit von 4 MB begrenzt den Schaden.
- **Fundstellen:** zod 4.6.5 in `@ft/api`, `@ft/shared`, `@ft/web`; behoben ab 4.6.6.
- **Beleg:** `pnpm audit` (21 Treffer, nur dieser betrifft die Laufzeit; der Rest sind Build- und Testwerkzeuge).
- **Lösung:** Patch-Update.
- **Aufwand:** klein. **Entscheidung:** nein.

#### B6 Server protokolliert abgelehnte Sync-Datensätze nicht

- **Stufe P3, Bereich Betrieb.** Die Diagnose-Seite von D2: ohne Log merkt niemand, dass ein Gerät Datensätze verliert.
- **Fundstellen:** `apps/api/src/sync/service.ts:73-87` (rejected, `clock_ahead`, falsche ID nur in der Antwort),
  `apps/web/src/lib/errorLog.ts` (nur localStorage).
- **Beleg:** im Code gelesen (alle `log.`-Aufrufe der API).
- **Lösung:** Ablehnungen und fehlgeschlagene Logins als `warn` protokollieren.
- **Aufwand:** klein. **Entscheidung:** ja, ob auch das Fehlerprotokoll des Geräts an den Server gehen soll.

#### T1 Wackelnder E2E-Test „a double tap on 'Meal eintragen' logs the analysis once“

- **Stufe P3, Bereich Tests.** Testproblem, kein doppelter Eintrag.
- **Fundstellen:** `apps/web/e2e/meals-goals.spec.ts:614` (Test), `:665` (zweiter `dispatchEvent`),
  `apps/web/src/features/ai/PhotoPage.tsx:979-1000` (`log()` entfernt den Queue-Eintrag, `ResultEditor` wird ausgehängt).
- **Was passiert:** Unter Last ist der erste Eintrag fertig, bevor der zweite Klick kommt; der Knopf existiert nicht
  mehr und `dispatchEvent` wartet 60 s. Im Seitenzustand des roten Laufs steht die Analyse genau einmal im Tagebuch.
- **Beleg:** nachgestellt: 20 von 20 grün mit einem Worker, 22 von 24 grün mit vier Workern; beide roten Läufe scheitern
  gleich (`scratchpad/review/run1.log`, `run2.log`, Trace `tr22/`).
- **Lösung:** Beide Klicks im selben Task auslösen (`log.evaluate(b => { b.click(); b.click(); })`). Die echte Restlücke
  daneben ist D5.
- **Aufwand:** klein. **Entscheidung:** nein.

#### T2 Fehlende Tests an Stellen, an denen ein Fehler P1 oder P2 wäre

- **Stufe P3, Bereich Tests.** Per grep in allen Testordnern geprüft.
- **Stellen:**
  - `apps/web/src/hooks/useSubmitting.ts`: einziger Schutz gegen Doppeleinträge an rund 25 Stellen, kein Unit-Test (P1).
  - `apps/web/src/db/backup.ts` gegen einen Server mit neueren Daten (siehe D3; `write.test.ts` prüft nur lokal).
  - `apps/web/src/app/session.tsx` (`signOut` mit `wipeLocal`, Kontowechsel, 401): in Tests nur gemockt (P1).
  - `apps/web/src/features/goals/applyTargetKcal.ts`: schreibt neue Tagesziele, nur `targetFromExpenditure` ist getestet (P1).
  - `features/diary/ExerciseCard.tsx` `removeTrainingsWithUndo` (Paket löschen und zurückholen in einer Transaktion) (P2).
  - `features/foods/foodService.ts` `ownBarcodes`/`shadowedByOwn` (P2).
  - `lib/reminder.ts` im Client (P2).
  - WebKit-E2E läuft nur für `ios-layout.spec.ts`.
- **Beleg:** grep in `apps/web/test`, `apps/web/e2e`, `apps/api/test`, `packages/shared/test`.
- **Lösung:** Mit den Fixes der zugehörigen Befunde je einen Test ergänzen, `useSubmitting` zuerst.
- **Aufwand:** mittel (zusammen). **Entscheidung:** nein.

### P4

#### Z5 Einheitenwechsel klemmt an `MAX_AMOUNT` und verliert Gramm

- `apps/web/src/lib/amounts.ts:96-99` (`convertAmount` → `clampAmount`), Aufruf `components/AmountEditor.tsx:107`.
  3 × „Ganzes Rezept (3 500 g)“ auf Gramm ergibt 9 999 statt 10 500 g; 3 000 g auf „Scheibe (25 g)“ ergibt 99 Scheiben =
  2 475 g. Nachgestellt (`scratchpad/numbers/check.ts` Abschnitt 5). Lösung: Wechsel verweigern oder Fehlerzustand des
  Feldes zeigen. Aufwand klein.

#### Z6 Rezeptmodus rundet den Faktor auf drei Stellen

- `packages/shared/src/recipes.ts:47` (`round(grams / weight, 3)`). Topf 4 000 g / 6 000 kcal, 30 g gegessen: 48 statt
  45 kcal (+6,7 %). Nachgestellt (`check.ts` Abschnitt 6). Lösung: Faktor ungerundet weitergeben. Aufwand klein.

#### Z7 Anzeige „-0“

- `round()` liefert −0, `Intl` druckt „-0“ (ASCII-Minus): `WeekReviewCard.tsx` (Gewicht), `ExpenditureCard.tsx:89-90`,
  `CompleteDayPage.tsx:87` (Training „−0“, das Tagebuch zeigt „+ 0“) und `:133-134`. Nachgestellt (`check.ts` Abschnitt 7).
  Lösung: −0 in `fmt0/fmt1/fmt2` normalisieren. Aufwand klein.

#### Z8 `quickEntryTitle` schneidet Emoji durch

- `packages/shared/src/diary.ts:61` (`slice` nach UTF-16-Einheiten): ein einzelnes Surrogat im Titel, auf dem Server
  U+FFFD. Nachgestellt (`scratchpad/numbers/quick.ts`). Lösung: nach Codepoints schneiden. Aufwand klein.

#### K5 Kostenrechnung: Cache-Lesepreis und Haiku 5.5

- `apps/api/src/ai/analyze.ts:112` rechnet Cache-Lesungen mit dem 0,1-fachen Eingabepreis; laut Preistabelle des
  `claude-api`-Skills ist es bei `claude-opus-5-5` das 0,05-fache (0,20 $/MTok). `apps/api/src/ai/pricing.ts:4-12`
  fehlt `claude-haiku-5-5` (würde zu Opus-Preisen gerechnet), `analyze.ts:84` behandelt jedes `claude-haiku*` wie Haiku
  4.5. Nur Statistik, solange es kein Budget gibt. Lösung: Cache-Preis je Modell, Haiku 5.5 ergänzen. Aufwand klein.

#### S5 Passwortprüfung beim Passwortwechsel und Konto löschen ohne Limit

- `apps/api/src/routes/auth.ts:102-109`, `:161-167`: mit einer gestohlenen Sitzung lässt sich das Passwort beliebig oft
  raten (nachgestellt, `scratchpad/server/pwguess.sh`). Lösung: `loginLimiter` mit `user:<id>`. Aufwand klein.

#### S6 Schritte-Token und Push-Abos überleben einen Passwortwechsel

- `apps/api/src/db/schema.ts:345` (bewusst so kommentiert), `routes/auth.ts:115` (löscht nur `sessions`). Ein
  abgeflossener Token schreibt weiter Schritte (nachgestellt, `scratchpad/server/steps.sh`). Kann so bleiben (der
  Kurzbefehl müsste sonst neu eingerichtet werden). Entscheidung des Nutzers, siehe Fragen.

#### S7 Schritte-Import: ein unplausibler Tag verwirft alle Tage mit „Fehler auf dem Server“

- `apps/api/src/routes/steps.ts:125-130` (jeder abgelehnte Datensatz wirft für alle Tage), `:188-193` (Antwort 500),
  `steps/import.ts:88-92` (`now` vom Telefon ungeprüft). Nachgestellt (`scratchpad/server/steps.sh`): ein Tag mit
  1 000 000 000 Schritten ergibt 500, `now: "2031-05-02"` legt Einträge in der Zukunft an. Lösung: unplausible Tage
  einzeln als Warnung auslassen, `now` nur ±1 Tag um die Serverzeit. Aufwand klein.

#### S8 Push-Endpunkt ist eine beliebige URL

- `apps/api/src/routes/push.ts:15` (`z.url().max(2000)`): ein angemeldetes Konto kann eine interne https-Adresse
  eintragen, der Server schickt täglich einen POST dorthin. Lösung: nur bekannte Push-Dienste zulassen. Aufwand klein.

#### D7 Schreibwege, die einen Datensatz neu aufbauen statt zu patchen

- `features/foods/CustomFoodPage.tsx:158-167`, `features/day/CompleteDayPage.tsx:65-70`, `features/goals/GoalsPage.tsx:102-107`,
  `db/notes.ts:9, 66, 84`. Heute ohne Schaden; bekommt eine dieser Tabellen ein neues Feld, setzt jedes alte Gerät es
  beim Speichern auf `null` (der Server-Upsert setzt alle Spalten, `apps/api/src/sync/service.ts:113-122`). Nutzen:
  künftige Schemaänderungen bleiben sicher. Lösung: `patchRecord` oder Spread des vorhandenen Datensatzes, Regel in den
  Offline-Sync-Skill. Aufwand klein.

#### B7 Abhängigkeiten ohne automatische Pflege

- Kein Dependabot oder Renovate; `package.json:31-33` (`web-push` im Root, dort ungenutzt), `Dockerfile:28` (argon2 fest,
  stimmt heute mit dem Lockfile, driftet beim nächsten Update unbemerkt). Größter Major-Abstand: `@anthropic-ai/sdk`
  0.131 auf 1.8. Nutzen: Sicherheits-Patches wie B5 kommen als PR. Aufwand klein. Entscheidung: ob Bot-PRs erwünscht sind.

#### B8 Bundle: groß, für die installierte PWA aber nicht spürbar

- Hauptchunk 657 KB (202 KB gzip), Precache 3,86 MB. Die installierte PWA startet aus dem Precache, `bls-compact.json`
  lädt erst bei der ersten Suche, das zxing-WASM erst beim Scannen; gemessen: Tagebuch warm 240 ms, Tageswechsel bei
  sechsfach gedrosselter CPU 250 bis 485 ms. `modern-screenshot` und `uqr` lazy zu laden spart etwa 33 KB. Keine
  Umsetzung empfohlen. Beleg: `scratchpad/ops/mapsize.mjs`, `scratchpad/ui/perf*.mjs`.

#### B9 Kleinigkeiten im Betrieb

- `apps/web/vite.config.ts:51-57`: Manifest-Shortcut „Essen eintragen“ zeigt auf `/add` statt `/photo` (nur Android).
- `deploy/.env.example`: es fehlen `AI_ENABLED` und `REGISTER_RATE_LIMIT` (`apps/api/src/env.ts:8-38`).
- `components/ui/sheet.tsx`: nirgends importiert, enthält das englische „Close“; löschen.
- `apps/api/scripts/seed-demo.ts` und `apps/web/e2e/share-day.spec.ts` kennen keine Schritte.
- Unversionierte Datei `docs/plans/2026-11-gespeicherte-trainings-mockup.html` („kann weg“ laut Plan).

#### U15 Kleinigkeiten in der Oberfläche

- Editor eines eigenen Lebensmittels: Speichern ist ohne Änderung aktiv (im Meal-Editor nicht).
- Gewichtsdiagramm mit einer Wiegung: y-Achse 50 bis 150 kg (`scratchpad/ui/sheets/empty.png`).
- Offline steht „Etikett fotografieren · Nur online“, auch wenn die KI auf dem Server aus ist.
- Fotoseite bei KI aus zeigt den technischen Text „(ANTHROPIC_API_KEY fehlt)“.
- Gespeicherte Fotos im Gruppen-Editor lassen sich nicht entfernen, nur neue (`features/diary/DiaryGroupPage.tsx:396-409`).

#### H Refactorings aus dem alten Review

- H1 `PhotoPage.tsx` aufteilen (heute 1 390 Zeilen, 21 `useState`): Nutzen ist, dass D5, U14 und künftige Änderungen an
  der Analyse in kleinen, testbaren Teilen landen. H2 gemeinsamer `useDraftEditor` für Meal- und Gruppen-Editor
  (doppelte Logik für Draft, Blocker, Skalieren), H3 `CameraControls` (Kamera in zwei Komponenten), H6 doppelte Typen
  (`Shot`/`CapturedShot`). Je mittel; nur zusammen mit einer Änderung an diesen Stellen angehen.

---

## 3. Stand des alten Reviews (`2026-10-code-review.md`)

Der Statusblock dort ist veraltet. Stand heute für alle Punkte, die er offen nennt oder als „plausibel“ markiert hat,
dazu eine Stichprobe der P1-Punkte.

| Punkt        | Inhalt                                                                                                                                                                                        | Stand heute        | Fundstelle                                                                                                         | Begründung                                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| A1           | Login-Sperre nach der Passwortprüfung                                                                                                                                                         | erledigt           | `apps/api/src/routes/auth.ts:72-83`                                                                                | `blocked()` vor `verifyPassword`, Test vorhanden; neue Nebenwirkung siehe S2                                                            |
| A2           | Pull in getrennten Snapshots                                                                                                                                                                  | erledigt           | `apps/api/src/sync/service.ts:137-151`                                                                             | eine Transaktion, repeatable read                                                                                                       |
| A3           | Geräteuhr entscheidet LWW                                                                                                                                                                     | erledigt           | `apps/api/src/sync/service.ts:81`, `apps/web/src/db/write.ts:47`                                                   | `clock_ahead`, `clockOffset`                                                                                                            |
| A4           | Registrierung 500 statt 409                                                                                                                                                                   | erledigt           | `apps/api/src/routes/auth.ts:47-60`                                                                                | Advisory-Lock, 409                                                                                                                      |
| A7           | Geräteliste, Höchstdauer der Sitzung                                                                                                                                                          | erledigt           | `apps/api/src/routes/auth.ts:120-150`, `auth/session.ts:14,67`                                                     | 2 Jahre, Liste, Abmelden                                                                                                                |
| B1           | `patchRecord` außerhalb der Transaktion                                                                                                                                                       | erledigt           | `apps/web/src/db/write.ts:20-47`                                                                                   |                                                                                                                                         |
| B2           | Unbekannte Tabelle blockiert Sync                                                                                                                                                             | erledigt           | `apps/web/src/sync/syncEngine.ts:314-347`                                                                          | übersprungen; Folgeproblem D6                                                                                                           |
| B3           | Mehrere Datensätze ohne Transaktion                                                                                                                                                           | erledigt           | `apps/web/src/db/entries.ts:295`, `db/mealDraft.ts:130`                                                            | Ausnahme `logAiMeal`, siehe D5                                                                                                          |
| B4           | Jeder Fehler gilt als offline                                                                                                                                                                 | erledigt           | `apps/web/src/sync/syncEngine.ts:71-77`                                                                            |                                                                                                                                         |
| C1, C2, C3   | Wiederholen, blockierte Queue, Timeout                                                                                                                                                        | erledigt           | `apps/web/src/features/ai/queue.ts:163-200, 269-277, 407-419`                                                      | mit Tests                                                                                                                               |
| C4 (1 bis 3) | Navigation nach Verlassen                                                                                                                                                                     | erledigt           | `PhotoPage.tsx:321-332`, `DiaryGroupPage.tsx:295-319`, `ScanPage.tsx:57-67`                                        | `waiting`/`gone`/`alive`                                                                                                                |
| C4 (4)       | `deferred` bei Offline, wenn jemand wartet                                                                                                                                                    | erledigt           | `apps/web/src/features/ai/queue.ts:261-266`                                                                        | setzt `deferred: true`, die Seite geht ins Tagebuch (so in `CLAUDE.md` beschrieben)                                                     |
| C6           | Gramm 0, Portion verloren, Fotozahl, Preset, Input-Reset, Kürzen, Navigation (plausibel)                                                                                                      | erledigt           | `db/aiDraft.ts:24,103,138,185`, `queue.ts:355-362`, `PhotoPage.tsx:723,833,1189`                                   | alle neun Teilpunkte im Code bestätigt                                                                                                  |
| D1, E1       | Doppel-Absenden                                                                                                                                                                               | erledigt           | `hooks/useSubmitting.ts` und Aufrufer                                                                              | neue Lücken: U1, U3, U13                                                                                                                |
| E5           | `MealPage` setzt den Eintragen-Dialog bei jedem Pull zurück                                                                                                                                   | noch offen (P3)    | `apps/web/src/features/meals/MealPage.tsx:36`                                                                      | `key={meal.updatedAt}`: ein Sync des Meals verwirft ausgelassene Zutaten, Faktor und Mahlzeit                                           |
| E6           | Slider-Commit mit altem Draft (plausibel)                                                                                                                                                     | erledigt           | `MealEditor.tsx:293`, `DiaryGroupPage.tsx:487`                                                                     | Wert kommt aus dem Argument                                                                                                             |
| E7           | Index-Keys im Meal-Editor                                                                                                                                                                     | noch offen (P3)    | `apps/web/src/features/meals/MealEditor.tsx:260`                                                                   | `key={i}`: beim Entfernen wandert der Zustand von `AmountEditor` auf die nächste Karte; Gruppen-Editor nutzt für neue Zeilen `new-${i}` |
| E7           | Wartende Analyse: Text ohne Komma, auch online                                                                                                                                                | noch offen (P4)    | `features/diary/PendingAnalysisRow.tsx:36,65`                                                                      | „wird analysiert sobald du online bist“ erscheint auch online bei `pending`                                                             |
| E7           | Gespeicherte Fotos im Gruppen-Editor nicht entfernbar                                                                                                                                         | noch offen (P4)    | `features/diary/DiaryGroupPage.tsx:396-409`                                                                        | siehe U15                                                                                                                               |
| E7           | `null` statt Skeleton beim Laden                                                                                                                                                              | noch offen (P4)    | `features/meals/MealPage.tsx:23`, `MealEditor.tsx:70-71`                                                           |                                                                                                                                         |
| E7           | übrige Teilpunkte (Format, Wortwahl, Foto, Undo, Sortierung, aria, WeekStrip, Zurück, `groupName`)                                                                                            | erledigt           | `MealCard.tsx:39,44,417`, `ClipboardMenu.tsx:60-62`, `MealsPage.tsx:22`, `Page.tsx:39-41`, `groupDraft.ts:310-315` |                                                                                                                                         |
| F10          | Zielstufenlinie um einen halben Balken versetzt (plausibel)                                                                                                                                   | noch offen (P4)    | `apps/web/src/components/Chart.tsx:121`, `features/reports/chartData.ts:52,70`                                     | `stepped({ align: 1 })` beginnt mitten im Balken, der letzte Tag hat kein Segment; nur gelesen, nicht gerendert                         |
| F10          | Ziele, Profil, Mahlzeiten ohne `Page footer` und Blocker                                                                                                                                      | noch offen (P3)    | `features/goals/GoalsPage.tsx:96,258`, `features/more/ProfilePage.tsx:183`, `features/more/MealNamesPage.tsx:52`   | Speichern inline, kein `useBlocker`: Verlassen verwirft Eingaben ohne Frage                                                             |
| F10          | MET − 1 zählt den PAL-Anteil doppelt                                                                                                                                                          | Entscheidung offen | `packages/shared/src/exercise.ts:319`                                                                              | bewusst `(met - 1)`; bleibt eine Frage, kein Fehler                                                                                     |
| F10          | `role="listbox"` um Buttons                                                                                                                                                                   | hinfällig          |                                                                                                                    | durch `DurationWheel` ersetzt                                                                                                           |
| F10          | Export: Quelle roh                                                                                                                                                                            | noch offen (P4)    | `features/reports/export.ts:148,152`                                                                               | Intensität übersetzt, `source` nicht                                                                                                    |
| F10          | übrige Teilpunkte (Wochentag-Toast, Trainingseditor schließt, Startgewicht, Einheiten, Formate, DataPage, CompleteDay, MacroBars, TabBar, Login, Meta, Titel)                                 | erledigt           | u. a. `GoalsPage.tsx:139`, `TrainingEditorPage.tsx:193`, `forecast.ts:101-107`                                     |                                                                                                                                         |
| H1           | `PhotoPage` aufteilen                                                                                                                                                                         | noch offen         | `features/ai/PhotoPage.tsx`                                                                                        | 1 390 statt damals 1 113 Zeilen                                                                                                         |
| H2           | `useDraftEditor`                                                                                                                                                                              | noch offen         | `MealEditor.tsx`, `DiaryGroupPage.tsx`                                                                             |                                                                                                                                         |
| H3           | `CameraControls`                                                                                                                                                                              | noch offen         | `PhotoCaptureSheet.tsx`, `PhotoPage.tsx`                                                                           |                                                                                                                                         |
| H4           | Skalierung vereinheitlichen                                                                                                                                                                   | teilweise          | `lib/amounts.ts:92-93`, `db/aiDraft.ts:177`                                                                        | Konstanten zentral, `scaleDraft`/`scaleItems` getrennt                                                                                  |
| H5           | Item-Feld-Picker                                                                                                                                                                              | noch offen         | `db/mealDraft.ts:62`, `db/entries.ts:337,487`                                                                      |                                                                                                                                         |
| H6           | Doppelte Typen                                                                                                                                                                                | teilweise          | `PhotoPage.tsx:124`, `PhotoCaptureSheet.tsx:18`                                                                    | `Shot`/`CapturedShot` doppelt                                                                                                           |
| H7           | Toter Zweig in `IngredientCard`                                                                                                                                                               | hinfällig          | `features/meals/IngredientCard.tsx:68`                                                                             | Zweig ist für Schnelleinträge erreichbar                                                                                                |
| H8, H9, H10  | `today()` im Render, Formatter, Aufräumen                                                                                                                                                     | erledigt           | `useToday`, `lib/format.ts:36-63`                                                                                  |                                                                                                                                         |
| J            | JSON-Wiederherstellung, Konto löschen, Geräteliste, Reset-Skript, „Zuletzt hier“, Mahlzeit kopieren, Wochenrückblick, Rezeptmodus, `AI_LABEL_MODEL`, Gewichtstrend, Schritte, Fehlerprotokoll | erledigt           |                                                                                                                    | Reset-Skript im Image nicht nutzbar: B3                                                                                                 |
| J            | KI-Kostenüberblick und Monatsbudget                                                                                                                                                           | noch offen         | `apps/api/src/db/schema.ts:289`                                                                                    | jetzt K1                                                                                                                                |
| J            | nächtliches `pg_dump` in `deploy/`                                                                                                                                                            | noch offen         | `README.md`                                                                                                        | jetzt B2                                                                                                                                |
| J            | `manualChunks`, WebKit für alle Specs                                                                                                                                                         | noch offen         | `apps/web/vite.config.ts`, `playwright.config.ts:31-34`                                                            | B8 rät von `manualChunks` ab                                                                                                            |
| J            | Tagebuch-Suche, Suchverlauf, Lebensmittel zusammenführen, OFF-Bilder offline, Portions-Presets der KI, Hinweis-Chips, Feedback „zu hoch/zu niedrig“, Strava-Import                            | noch offen (Ideen) |                                                                                                                    | nicht neu bewertet                                                                                                                      |
| J            | Wasserzähler                                                                                                                                                                                  | hinfällig          |                                                                                                                    | Nicht-bauen-Liste                                                                                                                       |

---

## 4. Vom Nutzer am iPhone zu prüfen

Gesammelt aus den Plänen der Runden 10 und 11, der Trainings, der Schritte und der Erinnerung, ergänzt um Punkte aus
dieser Bestandsaufnahme. Weggelassen ist, was laut Statusblöcken schon geprüft ist (Kurzbefehl mit „Gruppieren nach Tag“
und Strecke liefert plausible Werte).

**Rädchen**

- [ ] Food-Seite: Mengenrad drehen, Finger kurz liegen lassen, weiterdrehen, langsam loslassen. Erwartet: das Feld zeigt
      die Zeile in der Mitte, auch nach „Eintragen“.
- [ ] Sportart-Seite: dasselbe mit dem Dauer-Rad. Erwartet: rastet auf einer Zeile ein, der Fußleistenknopf nennt genau
      diese Dauer.
- [ ] „Genau eingeben“, 37 Min. tippen, Rad drehen. Erwartet: die Zeile „37 Min.“ bleibt im Rad.
- [ ] Gespeichertes Training eintragen, auf dem Rad einer Aktivität seitlich ziehen. Erwartet: das Rad dreht, die Zeile
      wischt nicht.

**Tastatur und Dialoge**

- [ ] Sportart-Seite: „Genau eingeben“ und das kcal-Feld antippen. Erwartet: Feld und Fußleistenknopf bleiben über der
      Tastatur.
- [ ] Mehr → Konto → Konto löschen, Passwortfeld antippen (nicht absenden). Erwartet: „Konto löschen“ und „Abbrechen“
      bleiben sichtbar (U7).
- [ ] Eingeben-Formular auf der Food-Seite: Autofokus öffnet die Tastatur, das Formular bleibt darüber.
- [ ] Datum im Tagebuchkopf antippen. Erwartet: kein Hineinzoomen.

**Wischen und Doppeltipp**

- [ ] Trainingszeile und Paketzeile nach rechts wischen. Erwartet: Toast „kopiert“, Einfügen-Symbol an der Trainingskarte.
- [ ] Dieselben Zeilen nach links wischen. Erwartet: gelöscht, mit Rückgängig.
- [ ] Gespeichertes Training eintragen: Kopf einer Aktivität nach links wischen. Erwartet: fällt nur für heute weg, die
      letzte bleibt.
- [ ] Food-Seite: „Offene Analysen“ aufklappen, Zeile nach links wischen. Erwartet: verworfen, mit Rückgängig.
- [ ] Doppeltipp auf „Tag abschließen“ und auf das Löschen-Symbol eines eigenen Lebensmittels, das über „Bearbeiten“ von
      der Food-Seite geöffnet wurde. Erwartet: genau ein Schritt zurück (U13).
- [ ] Nach dem Fix von U1: Doppeltipp auf das Einfügen-Symbol. Erwartet: ein Eintrag.

**Navigation und Kamera**

- [ ] Im Tagebuch weit nach unten scrollen, etwas eintragen. Erwartet: zurück an derselben Stelle, die neue Zeile ist
      sichtbar.
- [ ] Danach Wischgeste zurück. Erwartet: das ausgefüllte Formular öffnet sich nicht wieder.
- [ ] Food-Seite, „Suchen“, zurück. Erwartet: die Kamera läuft wieder mit Bild.
- [ ] Nach „Meal eintragen“ im KI-Ergebnis. Erwartet: die Kamera blitzt vor dem Tagebuch nicht kurz auf.
- [ ] Suche „Skyr“. Erwartet: die sichtbaren Zeilen springen nicht, wenn die Open-Food-Facts-Treffer kommen.

**Kleine Bildschirme** (nur falls ein iPhone mini oder SE zur Hand ist)

- [ ] Berichte und Ziele: Makrozahlen vollständig (U5); `/progress` wackelt nicht seitlich (U10).

**Teilen**

- [ ] Tag teilen mit Gruppenfotos im dunklen Thema. Erwartet: Teilen-Blatt, PNG mit Fotos und dunklem Hintergrund; kommt
      „Bild teilen“, öffnet ein Tipp das Teilen-Blatt.
- [ ] CSV unter Berichte und JSON unter „Daten & Sync“ teilen. Erwartet: Teilen-Blatt („In Dateien sichern“), auch bei
      einer großen Sicherung.

**Schritte**

- [ ] Tag mit Apple Watch: Wert in Fleisch-Teufel mit der Health-App vergleichen. Erwartet: gleiche Tagessumme.
- [ ] Im Kurzbefehl alle drei Datumsfelder auf `yyyy-MM-dd`. Erwartet: „Letzte Abrufe“ ohne Warnung.
- [ ] Automation „Tageszeit“ bei entsperrtem iPhone. Erwartet: läuft ohne Nachfrage, neuer Eintrag unter „Letzte Abrufe“.
- [ ] ↻ an der Schritte-Zeile in der installierten PWA. Erwartet: Kurzbefehle öffnet sich, nach der Rückkehr dreht ↻,
      bis der neue Wert da ist. Ohne Kurzbefehl: was zeigt iOS, hört das Drehen auf?

**Erinnerung** (setzt VAPID-Schlüssel im Stack voraus, in Produktion fehlen sie zur Zeit)

- [ ] Mehr → Erinnerung einschalten. Erwartet: die Mitteilungs-Erlaubnis wird gefragt (sie kommt erst nach einer
      Serverantwort, die Nutzergeste könnte verfallen sein).
- [ ] Zeit in 2 Minuten, an dem Tag nichts eintragen. Erwartet: Mitteilung, ein Tipp öffnet das Tagebuch; mit Eintrag
      kommt keine.

**Barrierefreiheit**

- [ ] VoiceOver: gibt es einen Weg, eine Tagebuchzeile zu kopieren oder eine offene Analyse zu verwerfen (beides nur per
      Wischen)?

---

## 5. Fragen an den Nutzer

1. **K1:** Wie hoch soll das KI-Budget sein, und pro Konto und Tag oder pro Monat? (Zum Vergleich: eine Analyse kostet
   geschätzt 0,2 bis 0,5 $.)
2. **Z1:** Soll „Training nicht anrechnen“ für die Verbrauchsschätzung heißen „Training gehört zum Grundbedarf“ (wie
   bei den Schritten)?
3. **Z2:** Soll der laufende Tag in Berichten ganz fehlen, oder nur ohne „Tag abschließen“ nicht als vollständig zählen?
4. **Z3:** Welche Größe gilt für „Ziel Ø“ (mit oder ohne angerechnetes Training) und für „Gewicht“ (Trend oder Differenz)?
5. **D1:** Soll ein Gerät nach einem erkannten Server-Restore seine Daten automatisch neu hochladen, oder nur einen
   Knopf dafür anbieten?
6. **D3:** Soll „Wiederherstellen“ nur fehlende Datensätze zurückbringen (LWW gegen den Server mit der alten Version)
   oder bewusst den Stand der Sicherung erzwingen?
7. **B2:** Läuft auf dem NAS ein täglicher `pg_dump` oder ein ZFS-Snapshot-Task für
   `/mnt/tank/applications/fleisch-teufel`?
8. **S1:** Soll Port 30300 nur noch für NPM erreichbar sein (Bindung an eine Adresse), und läuft NPM auf demselben Host?
9. **S6:** Soll ein Passwortwechsel auch den Schritte-Zugang und die Push-Abos beenden?
10. **B6, B7:** Soll das Fehlerprotokoll des Geräts an den Server gehen? Sind Dependabot-PRs erwünscht?
11. **U6:** Welche der aufgelisteten Erklärsätze sollen weg?

---

## 6. Anhang

### Verworfene Spuren

- **Origin-Check ohne Test, ohne Origin-Header, `x-forwarded-host`:** es gibt einen Test (`apps/api/test/auth.test.ts:71-84`);
  Browser senden bei fremden POST/PUT/DELETE immer Origin, und `x-forwarded-host` kann eine fremde Seite nicht ohne
  CORS-Preflight setzen.
- **`Secure`-Flag über `X-Forwarded-Proto`:** ein Angreifer beeinflusst damit nur sein eigenes Cookie.
- **Rate-Limits nur im Speicher:** für Login und Registrierung bei seltenen Neustarts belanglos; relevant nur für die
  KI-Kosten (K1).
- **Argon2 als DoS:** 40 parallele Logins, `/health` antwortete währenddessen in 0,17 s.
- **Body-Limits:** global 4 MB (5 MB ergibt 413), Fotos 1,5 MB nach Signaturprüfung.
- **Indizes:** jede Abfrage nutzt einen Schlüssel mit `user_id` vorn; Pull über `(user_id, change_seq)`.
- **Wachstum `off_misses`, `ai_analyses`, `sessions`:** kleine Zeilen; Sitzungen räumt `maintenance.ts` auf.
- **Konto löschen auf dem Server:** alle Nutzertabellen hängen mit `onDelete: cascade` an `users`.
- **Prompt-Caching:** wird genutzt; ein weiterer Breakpoint spart unter einem Cent pro Analyse.
- **Hypothese „alter Client verliert unbekannte Felder“:** heute nicht; der Pull speichert Rohdaten, `patchRecord`
  übernimmt den gespeicherten Datensatz. Die Restgefahr steht in D7.
- **Fotos nach 30 Tagen gelöscht (`maintenance.ts:17-29`):** kein Verlustweg gefunden; Entwürfe und Queue halten Bytes
  in `kv`/`aiPhotos`, Upload und Push laufen im selben Sync, Grabsteine zählen als Verweis.
- **Push über 4 MB:** 500 Einträge kommen auf etwa 1,6 MB.
- **Schritte-Import gegen Grabstein oder getippte kcal:** dokumentierte LWW-Entscheidung, Code korrekt.
- **Abmelden ohne Löschen:** Outbox bleibt in der nutzereigenen Datenbank, kein Verlust.
- **Onboarding überschreibt Einstellungen mit alter Kopie:** nein, `base` kommt live aus `useSettings`.
- **Doppeltipp auf Papierkorb „Wiederherstellen“, Onboarding, „Tag abschließen“, „Wie gestern“, Vorschläge,
  Schnelleingabe:** live geprüft, jeweils ein Datensatz (die doppelte Navigation steht in U13).
- **Doppeltipp auf „Analysieren“:** `analyzing` wird vor dem ersten await gesetzt, React rendert zwischen zwei echten
  Klicks.
- **Timer in `CustomFoodPage.tsx:103`, `BarcodeScanner.tsx:142, 233`, rAF in `diaryScroll.ts` und `shareDay.tsx`:**
  aufgeräumt oder begrenzt, Kamera-Tracks werden gestoppt.
- **`.catch(() => {})`:** verschluckt nichts, was der Nutzer sehen müsste, außer `lib/steps.ts:126` (U14).
- **Gedankenstriche in UI-Strings, Eingaben unter 16 px, Wortwahl:** keine Abweichung gefunden (live gemessen).
- **„Eintragen ab“ zeigt „1000“ ohne Tausenderpunkt:** `NumberField` lässt Tausenderpunkte in Eingabefeldern bewusst weg
  (`components/NumberField.tsx:28`), wie in allen Feldern.
- **Zahlen für denselben Tag in Tagebuch, „Tag abschließen“, geteiltem Bild, Bericht und CSV:** alle lesen
  `summarizeDay`/`dailyRows` mit gleicher Filterung und Rundung.
- **Sommerzeit und Datumsgrenzen:** `dateRange`, `addDays`, `diffDays`, `startOfWeek` über 25.10. und 29.03. in vier
  Zeitzonen korrekt (`scratchpad/numbers/dst.ts`).
- **Division durch 0:** in Berichten, Wochenkarte, Schätzung, Rezept, Kalorienring und Energiebalken abgesichert.
- **Schritte in den Trainingsminuten der Berichte:** so im Schritte-Plan beschlossen.
- **Cache-Header, Update-Banner, Dockerfile (Nutzer `node`, Healthcheck):** korrekt.
- **Ausgelieferte Source Maps:** das Repo ist öffentlich, die Maps sind nicht im Precache.
- **`embedded-postgres` Beta:** nur in Dev und Tests.
- **Kein CI mit Tests:** `ci.yml` führt Lint, Typecheck, Tests, Build und E2E aus; das Problem ist nur B1.
- **Geschwindigkeit mit sechs Wochen Daten:** alle 35 Routen laden in 100 bis 250 ms, keine Long Tasks.

### Nicht geprüft

- **Echtes iPhone** (Safari, Kamera, Teilen-Blatt, Kurzbefehle, Push, VoiceOver): kein Gerät; siehe Abschnitt 4.
- **Produktivserver:** nur über Zariel gelesen (Port 30300 auf allen Adressen, keine VAPID-Schlüssel, Standardmodell).
  NPM-Konfiguration und Tabellengrößen ließen sich nicht lesen (Zariel fehlen die NPM-Zugangsdaten, `psql` gehört nicht
  zur Lesestufe); ob Backups laufen, ist offen (Frage 7).
- **Echte Claude-Aufrufe:** verboten; Kosten in K1 sind geschätzt. `/photo?review=` mit echtem Ergebnis im
  Produktions-Build nicht durchgespielt (KI aus, keine Fakes im Build).
- **Open Food Facts online** (`/scan?code=`, Online-Suche): kein Netzzugang nach außen aus dem Testserver.
- **Konto löschen und Passwort ändern im Browser:** nicht ausgelöst, die Serverseite ist per curl und Test geprüft.
- **JSON-Wiederherstellung per Datei-Upload im Browser:** nur als Test gegen die echte Funktion (D3).
- **Vollständiger `pnpm e2e`-Lauf und WebKit:** nicht gelaufen (Speicher des Containers); nur die Wackler-Spec gezielt.
- **`householdPortionsFor`/`piecePortionsFor` Zeile für Zeile gegen BLS-Namen, Suchqualität:** nicht im Umfang.
- **Docker-Image starten:** kein Docker im Container; der Inhalt ist aus `Dockerfile` und `build.mjs` erschlossen.
