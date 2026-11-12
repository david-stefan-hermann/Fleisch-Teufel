# Verbesserungen November 2026: Bestandsaufnahme und Ideen (Implementierungsplan für Opus 5.5)

Statusblock hier pflegen (Kopie aus `~/.claude/plans`, von Fable am 2026-11-12 abgelegt).
Quellen: `docs/plans/2026-11-bestandsaufnahme.md` (Befunde mit Fundstellen, Stand bdbba3a) und die Ideen des Nutzers
aus der Sammelsitzung vom 2026-11-09 bis 2026-11-11. Kein Mockup-Schritt (Entscheidung des Nutzers).

## Status

Geplant am 2026-11-12 (Fable). Umsetzung läuft (Opus 5.5).

| Block | Stand    | Commit  |
| ----- | -------- | ------- |
| 0     | erledigt | 72a29f0 |
| 1     | erledigt | 2759a17 |
| 2     | erledigt | da72de6 |
| 3     | erledigt |         |
| 4     | offen    |         |
| 5     | offen    |         |
| 6     | offen    |         |
| 7     | offen    |         |
| 8     | offen    |         |
| 9     | offen    |         |
| 10    | offen    |         |
| 11    | offen    |         |
| 12    | offen    |         |
| 13    | offen    |         |

**Abweichungen:** (hier eintragen, nie still entscheiden)

- Block 1, U9: `QuickAddPage` (`/quick-add?entryId=`) zeigt für einen unbekannten oder gelöschten Eintrag ebenfalls
  `NotFoundPage` (vorher Weiterleitung zum Formular bzw. Bearbeiten und Wiederbeleben des gelöschten Eintrags, wie U8).
  Ohne `entryId` bleibt die Weiterleitung nach `/photo?form=1`.
- Block 1, U9: `NotFoundPage` zeigt den Offline-Text („Nicht auf diesem Gerät, online erneut öffnen“) nach dem
  Sync-Zustand (`status === 'offline'`); auf der Food-Seite entscheidet die Server-Antwort (`findFood` in
  `foods/foodService.ts`: 404 = nicht gefunden, kein Server = offline, eigenes Lebensmittel nicht auf dem Gerät =
  Sync-Zustand). Auch „Sportart nicht gefunden“ auf der Sport-Seite nutzt jetzt `NotFoundPage`.
- Block 1, U4: zusätzlich zu `pending` leeren schreibt `saveDayNote` denselben Text nicht noch einmal (kein
  Sync-Datensatz für eine unveränderte Notiz).
- Block 1: Nach dem Löschen auf Seiten mit Live-Abfrage (Food-, Sport-, Schnelleintrag- und Lebensmittel-Editor)
  kann vor dem Zurückspringen kurz „nicht gefunden“ aufblitzen (wie schon bisher auf der Sport-Seite). Am iPhone prüfen.
- Block 2, Z3: die gemeinsamen Funktionen heißen `budgetAverage` und `weightTrend` (statt `weekTargetAverage` und
  `weekWeightTrend`) und liegen in `reports.ts`, weil der Bericht sie auch für Monat und 90 Tage nutzt. `PeriodStats`
  hat statt `avgTargetKcal` und `weightChange` jetzt `avgBudgetKcal` und `weightTrendKg`. Im Bericht heißt die
  Kachel „Gewicht“ jetzt „Trend“ (Unterzeile weiter das letzte Gewicht), auf der Wochenkarte ebenso.
- Block 2, Z2: der Satz unter den Berichtszahlen sagt statt „N Tage mit nur einer Mahlzeit zählen nicht mit“ jetzt
  „N Tage nur zum Teil erfasst, zählen nicht mit“ (der laufende Tag mit zwei Mahlzeiten gehört jetzt auch dazu).
- Block 2, Z1: die Karte „Bedarf aus deinen Daten“ sagt „kcal am Tag, mit Training“, solange Training nicht
  angerechnet wird (sonst wie bisher „ohne Training“). Auf „Tag abschließen“ zeigt „Training“ bei 0 kein „−0“ mehr.
- Block 2, Z5: der Grenzhinweis bleibt der bestehende Text „Höchstens 9.999 g.“ (wie beim Eintippen, eine Grenze, kein
  Bedienungssatz). Der Editor merkt sich die zu große Menge samt neuer Einheit (`pending`), bis eine passende Menge
  kommt; dadurch bleibt auch eine zu groß getippte Zahl im Feld stehen, statt auf der Food-Seite zu verschwinden.
- Block 2, Z8: geschnitten wird nach ganzen Zeichen (Grapheme per `Intl.Segmenter`, sonst Codepoints), gezählt in
  Codepoints: ein Familien-Emoji bleibt ganz oder fällt weg, der Titel bleibt höchstens 60 Codepoints lang.
- Block 2, F10: es gibt keine Quelle `estimate`; KI-Einträge (`ai`) heißen „KI-Analyse“, ohne `foodId` (geschätztes
  Lebensmittel) „KI-Schätzung“.
- Block 2, U11: der Zustand „Daten nicht schlüssig“ zeigt darunter die Zahl der vollständigen Tage und Wiegungen.
- Block 3: Schema, Fehlerklasse und Migration nach der Ausarbeitung, nicht nach der Kurzfassung: `status` ist
  `'ok' | 'failed'` (Zeitüberschreitung steht in `error = 'ai_timeout'`), die Klasse heißt `AiCallError` (mit `cause`,
  `usage`, `model`, `rounds`), die Migration `0015_ai-analyses-status-request`. Fehler, die nicht vom Claude-Aufruf
  kommen (Programmfehler, Datenbank), werden mit `error = 'internal'` protokolliert und bleiben 500.
- Block 3, K1: Antworten aus dem Speicher (gleiche `requestId`) kosten nichts und laufen deshalb auch bei
  aufgebrauchtem Budget. Budget und Stundenlimit werden geprüft, nachdem eine laufende Analyse mit demselben
  Schlüssel gefunden wurde (sonst würde der zweite Aufruf das Stundenlimit zählen). Die Budgetmeldung nennt auch
  beim Etikett „Foto-Analyse“.
- Block 3, K3: `analysisId` wird vor dem Speichern erzeugt (`randomUUID`), damit die gespeicherte Antwort sie und die
  `est:`-Kennungen schon enthält. Der Server nimmt als `requestId` 1 bis 64 Zeichen aus Buchstaben, Ziffern, `_`
  und `-`, sonst wird sie ignoriert (Analyse wie bisher).
- Block 3, K4: `maxRetries` bleibt 2. Das `AbortSignal` des Gesamtbudgets (100 s) beendet auch die Wiederholungen
  des SDK, die Summe bleibt so unter den 120 s des Geräts.
- Block 3, K5: Cache-Lesepreise je Modell (Opus 5.5 0,20 $, Fable 5.1 0,25 $, sonst 0,1 × Eingabe); für
  `claude-haiku-5-5` (0,10 $ / 0,50 $) ist der Cache-Lesepreis als 0,1 × angenommen (im `claude-api`-Skill nicht
  genannt). Haiku 5.5 bekommt Denken und `effort`, aber keine Server-Ausweichmodelle (gibt es dort nicht); nur
  Haiku 4.5 läuft ganz ohne. Ein Modell wird nur noch exakt oder als datierter Snapshot (`-JJJJMMTT`) erkannt.
- Block 3, U14: `too_many_images` sagt „Höchstens 5 Fotos je Analyse.“ auch beim Etikett (die App schickt dort nie
  mehr als 3). Neu sind außerdem `no_result` („Die Analyse hat kein verwertbares Ergebnis geliefert. Versuche es
  erneut.“), `unsupported_image_type` („Dieses Bildformat wird nicht unterstützt.“) und `push_disabled`
  („Erinnerungen sind auf dem Server nicht eingerichtet.“). Bei `ai_budget` bricht der Lauf der Warteschlange ab: der
  Eintrag wird `failed` mit dem Grund (kein automatisches Wiederholen), die übrigen bleiben wartend und gehen beim
  nächsten Lauf (App sichtbar, online) los; ist das Budget dann noch aufgebraucht, wird je Lauf einer davon
  `failed`.

**Am iPhone zu prüfen:** siehe Abschnitt 4 der Bestandsaufnahme, ergänzt am Ende dieses Plans.

## Kontext

Die Bestandsaufnahme vom 2026-11-11 hat 33 Befunde (P1 bis P4) plus offene Punkte des alten Reviews und eine Liste
verbliebener Erklärsätze ergeben. Dazu kamen in der Sammelsitzung acht Ideen des Nutzers (Barcode-Zwischenschritt,
fünf Etikettenfotos, Trainings-Tag kopieren, Trainings sortieren, Papierkorb mit Suche und Leeren, „Trainings" statt
„Gespeicherte Trainings", Schritte-Symbol im Kartenkopf statt ↻ an der Zeile). Dieser Plan fasst beides in Blöcke,
die je einen Commit ergeben. Ziel: korrekte Zahlen, keine doppelten Einträge, keine stillen Datenverluste im Sync,
gedeckelte KI-Kosten, ein Deploy, das nur getesteten Code ausrollt, und die neuen Bedienideen.

## Entscheidungen (mit dem Nutzer geklärt, nicht neu verhandeln)

| Punkt               | Entscheidung                                                                                                                                                                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K1                  | KI-Budget je Konto: **5 $ pro Tag und 50 $ pro Monat**, aus `cost_usd` in `ai_analyses`; darüber 429 `ai_budget` mit deutscher Meldung. K2 gehört dazu (auch fehlgeschlagene Aufrufe zählen).                                                             |
| Z1                  | Bei „Training nicht anrechnen" gilt Training für die Verbrauchsschätzung als Teil des Grundbedarfs (wie bei den Schritten): nicht abziehen. Prognose auf dieselbe Basis. (Annahme, Nutzer hat nicht widersprochen.)                                       |
| Z2                  | Der laufende Tag zählt **nur mit „Tag abschließen"** als vollständig. Er bleibt sichtbar (grauer Balken, Zeile im Bericht), zählt aber in Durchschnitte, Wochenkarte und Verbrauchsschätzung erst nach dem Abschließen.                                   |
| Z3                  | Wochenkarte und Wochenbericht zeigen dieselben Größen mit denselben Namen: **„Budget Ø"** (kcal-Ziel plus angerechnetes Training) und **„Trend"** (Steigung der Regressionsgeraden über die Woche, `kg`).                                                 |
| D1                  | Erkennt ein Gerät einen Server-Restore (Epoche gewechselt oder Cursor über dem Maximum), lädt es **automatisch** alle eigenen Datensätze neu hoch (LWW entscheidet), ohne Dialog; ein `recordError`-Eintrag.                                              |
| D3                  | „Wiederherstellen" holt **nur Fehlendes** zurück: vorher synchronisieren (ohne Erfolg kein Einspielen), eingespielte Datensätze behalten ihre `updatedAt`, Gelöschtes bleibt gelöscht.                                                                    |
| B2                  | Auf dem NAS läuft ein täglicher rekursiver ZFS-Snapshot von `tank/applications` (0:00, 2 Wochen Aufbewahrung; am 2026-11-11 per Zariel geprüft). Kein pg_dump nötig; README beschreibt Snapshot-Restore plus Epoche und den Rückweg über `:sha-<commit>`. |
| S1                  | Nginx Proxy Manager läuft nicht auf dem NAS selbst (TrueNAS-App gestoppt, Proxy in einer VM), Port 30300 bleibt auf allen Adressen. Fix nur im Server: letzter `X-Forwarded-For`-Eintrag zählt.                                                           |
| S6                  | Schritte-Token und Push-Abos überleben einen Passwortwechsel (bleibt so, wie im Schema kommentiert). Kein Block.                                                                                                                                          |
| B6/B7               | **Dependabot wöchentlich gebündelt** (npm und GitHub Actions, Majors getrennt). Das Gerätefehlerprotokoll geht **nicht** an den Server. Server protokolliert abgelehnte Sync-Datensätze und fehlgeschlagene Logins als `warn`.                            |
| U6                  | Abgehakt am 2026-11-12: alle Vorschläge angenommen, auch „Halte den Barcode in den Rahmen.“ fällt weg.                                                                                                                                                    |
| Umfang              | Alles: P1 bis P4, offene Altpunkte (E5, E7, F10), H1 (PhotoPage aufteilen) als eigener Block; H2 bis H6 nur, wo ein Block die Datei ohnehin anfasst.                                                                                                      |
| Barcode             | Kein Direktsprung mehr zum Anlegen bei „nicht gefunden": Zwischenschritt mit Code, „Weiter scannen", „Etikett fotografieren", „Selbst anlegen". Zwei gleiche Lesungen bleiben (gibt es schon).                                                            |
| Etikett             | `MAX_LABEL_PHOTOS` 3 → **5**, eine Konstante in `@ft/shared`.                                                                                                                                                                                             |
| Trainings sortieren | Reihenfolge per Drag innerhalb der Trainingskarte, Schlüssel bleibt `loggedAt` (umschreiben, kein neues Feld). Essen bekommt in dieser Runde keine Sortierung innerhalb der Mahlzeit (es gab sie auch nie).                                               |
| Papierkorb leeren   | Ausblenden per synchronisiertem Feld `purgedAt` (Grabsteine bleiben für den Sync), nicht physisch löschen.                                                                                                                                                |
| Schritte-Symbol     | Fußabdruck-Symbol links vom „+" im Kopf der Trainingskarte startet den Kurzbefehl; ↻ an der Schritte-Zeile entfällt. Auf der Schritte-Seite und unter Mehr → Schritte bleibt der Abruf.                                                                   |
| MET − 1             | Bleibt wie es ist (F10, bewusst). Kein Block.                                                                                                                                                                                                             |

## Blöcke

Reihenfolge ist Pflicht, wo ein Block auf dem vorigen aufbaut (3 vor 12, 5 vor 6, 7 vor 8). Jeder Block: ein Commit,
davor `pnpm lint`, `pnpm typecheck`, `pnpm test`, am Ende `pnpm e2e` (chromium). Zeilenangaben stammen aus der
Bestandsaufnahme (Stand bdbba3a) und sind vor dem Ändern zu prüfen.

### Block 0: Plan ins Repo

- Diesen Plan (`docs/plans/2026-11-verbesserungen.md`, liegt schon da) zusammen mit den noch unversionierten
  `docs/plans/2026-11-bestandsaufnahme.md` und `docs/plans/2026-11-bestandsaufnahme-auftrag.md` mit `pnpm format`
  glätten und committen. Die unversionierte `docs/plans/2026-11-gespeicherte-trainings-mockup.html` laut Trainingsplan
  („kann weg") löschen, nicht committen.

### Block 1: Doppeltipp, Navigation, kaputte Zustände (U1, U2, U3, U4, U7, U8, U9, U13, T2-Teil)

- **U1** `features/diary/MealCard.tsx` `PasteButton`: `useSubmitting()`, `run(() => pasteWithToast(...))`,
  `disabled={busy}`; dieselbe Komponente auf `/diary-meal` (`DiaryMealPage.tsx`). Fehler werden dadurch Toasts.
- **U2** `features/goals/OnboardingPage.tsx`: `navigate({ to: '/', replace: true })`, Knopf über `useSubmitting`.
- **U3** `features/exercise/TrainingFields.tsx` `CustomTypeDialog`: `useSubmitting` um „Anlegen".
- **U4** `features/diary/NoteCard.tsx`: fällt `local` auf den Datensatz zurück (`local === saved`), auch
  `pending.current` leeren; `flush` schreibt nur bei Abweichung vom gespeicherten Text. Test: der Fall aus der
  Bestandsaufnahme („Gut", „ geschlafen" tippen und innerhalb von 0,7 s löschen, dann verlassen → „Gut").
- **U7** `features/more/AccountPage.tsx` Konto-löschen-Dialog: Passwortfeld in `DialogBody`;
  `components/ui/dialog.tsx` Schließen-X mit 40 px Tippfläche (Icon bleibt 16 px).
- **U8** `features/foods/FoodLogPage.tsx`: ein Eintrag mit `deleted` gilt als nicht gefunden (Muster
  `SportPage.tsx:63`).
- **U9** einheitlicher Zustand „nicht gefunden" (Seite mit Titel, Zurück, Text „Eintrag nicht gefunden" bzw. „Lebensmittel
  nicht gefunden"; offline „Nicht auf diesem Gerät, online erneut öffnen"): `SportPage.tsx` (vor der `!date`-Prüfung),
  `FoodLogPage.tsx` (nicht „Server nicht erreichbar", wenn der Server 404 sagt), `CustomFoodPage.tsx` (unbekannte ID →
  nicht gefunden statt leeres Formular; gelöschtes eigenes Lebensmittel → nicht gefunden, kein Wiederbeleben).
  Eine kleine gemeinsame Komponente `components/NotFoundPage.tsx` (Page + Text + Zurück-Knopf) statt dreier Kopien.
- **U13** `run()` von `useSubmitting` an allen genannten Stellen: `CompleteDayPage.tsx` (beide Knöpfe),
  `CustomFoodPage.tsx` (Löschen), `QuickAddPage.tsx`, `FoodLogPage.tsx:389`, `TrashPage.tsx` (alle vier
  „Wiederherstellen", wird in Block 7 ohnehin umgebaut, dort mit erledigen), `ProgressPage.tsx:382`,
  `ProfilePage.tsx:168`, `MealNamesPage.tsx:47`, `DiaryDnd.tsx:72` (Drop-Handler: ein Flag statt Hook, kein zweiter
  Move, solange einer läuft).
- **T2** Unit-Test für `hooks/useSubmitting.ts` (`apps/web/test/useSubmitting.test.tsx`): zweiter `run` während des
  ersten wird ignoriert, `busy` während des Laufs, Fehler wird Toast (Toast mocken), nach dem Lauf wieder frei.

### Block 2: Zahlen (Z1 bis Z8, U11, E7-Format-Rest)

- **Z1** `packages/shared/src/expenditure.ts:77-79`: Trainings nur abziehen, wenn `addExerciseCalories` (neuer Parameter
  neben `creditSteps`, Aufrufer `hooks/useExpenditure.ts:53` und `features/day/CompleteDayPage.tsx:43-53` übergeben die
  Einstellung). Tests in `packages/shared/test/expenditure.test.ts`: der Fall aus der Bestandsaufnahme (2 800 kcal, 400
  kcal Training, Gewicht gleich, Training nicht angerechnet → Schätzung 2 800, Vorschlag 2 250).
- **Z2** `packages/shared/src/reports.ts` `isCompleteDay(day, { today })`: ist `day.date === today`, zählt nur
  `completedAt`. Aufrufer: `dailyRows`/`PeriodStats` (`ReportsPage.tsx`), `weekSummary` (`WeekReviewCard`),
  `estimateExpenditure` (`useExpenditure.ts:51`, Fenster bleibt bis heute, heute zählt nur abgeschlossen),
  `chartData.ts:58` (heute grau, solange nicht abgeschlossen), CSV-Spalte „Vollständig". Test mit dem Fall der
  Bestandsaufnahme (20 Tage 2 500, heute 1 200 um 12:30 → Ø 2 500, 6/7).
- **Z3** `expenditure.ts:150-153` und `reports.ts:180, 201-204`: eine Funktion `weekTargetAverage` (Budget inkl.
  angerechnetem Training) und `weekWeightTrend` (Regression, aus `expenditure.ts`) in shared, beide Stellen rufen sie;
  Beschriftung „Budget Ø" und „Trend" in `WeekReviewCard.tsx:81` und `ReportsPage.tsx:177`. Test: der Fall der
  Bestandsaufnahme ergibt an beiden Stellen 2 143 und −0,07.
- **Z4** `ReportsPage.tsx:258, 306-317`: für „Alles" `to = today` und `from` = frühestes Datum über Essen, Gewichte,
  Trainings und Notizen (eine Funktion `earliestDate(db)` in `db/`), Dateiname bleibt `…_gesamt`.
- **Z5** `lib/amounts.ts:96-99` `convertAmount`: übersteigt das Ergebnis `MAX_AMOUNT`, den Wechsel nicht clampen, sondern
  das Feld im Fehlerzustand zeigen (`aria-invalid`, Rand `border-destructive`) und den Commit verweigern, bis der Wert
  passt; Hinweis als Zustand, kein Satz. Test in `apps/web/test/amounts.test.ts`.
- **Z6** `packages/shared/src/recipes.ts:47`: Faktor ungerundet, nur die Anzeige rundet. Test 4 000 g / 6 000 kcal, 30 g →
  45 kcal.
- **Z7** `lib/format.ts` `fmt0/fmt1/fmt2`: `Object.is(v, -0)` oder gerundet 0 → `0` (kein „-0"). Test.
- **Z8** `packages/shared/src/diary.ts:61` `quickEntryTitle`: nach Codepoints schneiden (`Array.from` oder
  `Intl.Segmenter` mit Graphemen, wenn verfügbar, sonst Codepoints). Test mit Emoji am Schnitt.
- **U11** `features/progress/ExpenditureCard.tsx:116-120`: dritter Zustand „Daten nicht schlüssig" (Trend oder Ergebnis
  unplausibel) getrennt von „zu wenig Daten"; `estimateExpenditure` liefert dafür einen Grund
  (`{ value: null, reason: 'tooFew' | 'implausible' }`) statt nur `null`.
- **F10 Export**: `features/reports/export.ts:148,152` Spalte Quelle übersetzen (`bls` → „BLS", `off` → „Open Food
  Facts", `custom` → „Eigenes", `quick` → „Schnelleingabe", `estimate` → „KI-Schätzung").

### Block 3: KI-Kosten und -Fehler (K1 bis K5, K-Teil von U14)

Vor dem Ändern den Skill `claude-api` laden.

- **K2 zuerst** (`apps/api/src/ai/analyze.ts`): `usage` über alle Runden sammeln; jeder geworfene Fehler (Zeitbudget,
  `stop_reason` ≠ `end_turn`, Ablehnung, SDK-Fehler nach dem ersten Request) trägt die bisherige `usage` und
  `cost_usd` (eigene Fehlerklasse `AnalysisError { usage, costUsd, code }`). `routes/ai.ts`: auch im Fehlerweg eine
  Zeile in `ai_analyses` schreiben. Neue nullable Spalte `status` (`'ok' | 'failed' | 'timeout'`), Migration per
  `pnpm --filter @ft/api db:generate --name ai-analyses-status`.
- **K5** `analyze.ts:112` Cache-Lesepreis je Modell aus `pricing.ts` (Opus 5.5: 0,05 × Eingabe), `pricing.ts`:
  `claude-haiku-5-5` ergänzen, Modellerkennung nicht mehr per Präfix.
- **K1** `routes/ai.ts`: vor jedem Claude-Aufruf (Analyse und Etikett, nach der Bildprüfung und nach der
  K3-Wiedergabe, vor `limiter.take`) `budgetExceeded(db, userId, limits)` (neu `ai/budget.ts`, eine Abfrage über
  `(user_id, created_at)`, **rollende Fenster** 24 h und 30 Tage, keine Zeitzonenfragen); über `AI_BUDGET_DAY_USD`
  (Standard 5) oder `AI_BUDGET_MONTH_USD` (Standard 50; 0 = diese Grenze aus) → 429 `{ error: 'ai_budget', scope: 'day'
| 'month' }` (kein `retryAfterMs`). `env.ts`, `deploy/.env.example`, README ergänzen. Der stündliche `RateLimiter`
  bleibt als zweite Bremse. Zusätzlich dem Nutzer in der Doku raten, in der Anthropic Console ein Ausgabenlimit zu
  setzen (ein Satz in der README, kein UI).
- **K3** Idempotenz: der Queue-Eintrag bekommt `requestId: uuidv7()` (**nicht** `localId`: die ist ein Dexie-Autoincrement
  je Gerät, zwei Geräte eines Kontos hätten beide die 1). Vergeben bei `enqueuePhotos`/`enqueueDescription`, neu bei
  `reanalyze`, behalten bei „Wiederholen", nachgetragen für ältere Einträge in `runQueue`. Der Server speichert
  `request_id` und die vollständige Antwort (`response`, inkl. Kandidaten; `result` enthält sie nicht) und gibt bei
  einem zweiten Aufruf mit derselben ID die gespeicherte Antwort ohne Claude-Aufruf zurück; parallele Aufrufe mit
  derselben ID warten auf dasselbe Promise (`inflight`-Map im Prozess).
- **K4** Etikett-Route: dasselbe Gesamtbudget als `AbortSignal.timeout` wie die Analyse (unter 120 s), `maxRetries` so,
  dass die Summe unter dem Client-Timeout bleibt.
- **U14 (Codes)** `apps/web/src/lib/api.ts` `errorMessage`: deutsche Texte für `ai_budget` („KI-Budget für heute
  aufgebraucht" / „für diesen Monat"), `ai_timeout` (wie `TimeoutError`: „Die Analyse hat zu lange gedauert. Sie wurde
  eventuell schon berechnet; versuche es später noch einmal."), `too_many_images`, `unsupported_image_type`,
  `push_disabled`. Die Queue behandelt `ai_budget` wie `failed` mit sichtbarem Grund, nicht wie offline (kein
  automatisches Wiederholen).
- Tests: `apps/api/test/ai.test.ts` (Budget 429 nach Überschreiten, Fehlerzeile mit `status`, gleiche `requestId` →
  kein zweiter Modellaufruf, Etikett-Timeout), `apps/web/test` für `errorMessage`.
- Konkrete Datenformen und Funktionsnamen: siehe Abschnitt „Ausarbeitung Block 3" unten.

### Block 4: Server und Sicherheit (S1 bis S5, S7, S8, B5)

- **S1** `routes/util.ts:32-33` `clientIp`: letzter Eintrag von `X-Forwarded-For` (ein vertrauter Proxy davor), ohne
  Header die Socket-Adresse. Test in `apps/api/test/auth.test.ts`: Registrierungslimit lässt sich mit gefälschtem
  erstem Eintrag nicht umgehen.
- **S2** `routes/auth.ts:37, 70-73`: Kontosperre nur zusammen mit der IP (`user:<email>:<ip>`), die reine
  Kontosperre wird eine Verlangsamung (ab 10 Fehlversuchen 2 s Wartezeit vor der Antwort, auch bei richtigem
  Passwort), nie 429 für das richtige Passwort. Test: 10 falsche, dann richtiges Passwort → 200.
- **S3** `push.ts`: nur bei 404/410 sofort löschen, sonst Fehler zählen und erst nach 7 Tagen in Folge löschen;
  `sendNotification` mit 20 s Timeout; Merker „läuft" gegen überlappende Intervalle; `lastSentOn` erst bei Erfolg.
- **S4** `maintenance.ts`: OFF-Zeilen ohne Verweis (kein `food_entries`/`meals.items`/eigene Lebensmittel mit dieser
  `sourceId`, kein `ai_food_choices`) und älter als 90 Tage löschen; `catalog.ts` lädt danach neu (oder entfernt sie
  aus dem Index). Test in `apps/api/test/maintenance.test.ts`.
- **S5** `routes/auth.ts:102-109, 161-167`: `loginLimiter` mit Schlüssel `user:<id>` beim Passwortwechsel und beim
  Konto löschen.
- **S7** `routes/steps.ts:125-130, 188-193`, `steps/import.ts:88-92`: unplausible Tage einzeln als Warnung in der
  Antwort (`warnings: [{ date, reason }]`), die übrigen Tage werden gespeichert, Antwort 200; `now` nur innerhalb
  ±1 Tag der Serverzeit, sonst Serverzeit. Die Seite „Schritte" zeigt die Warnungen unter „Letzte Abrufe" (gibt es
  schon für fehlende Strecke, erweitern).
- **S8** `routes/push.ts:15`: Endpunkt nur mit Host aus einer Liste bekannter Push-Dienste (`*.push.apple.com`,
  `fcm.googleapis.com`, `*.notify.windows.com`, `updates.push.services.mozilla.com`, `*.push.services.mozilla.com`),
  sonst 400 `push_endpoint`.
- **B5** zod auf ≥ 4.6.6 in allen drei Paketen (`pnpm up zod`), `pnpm audit` danach ohne Laufzeittreffer.
- **B6** `sync/service.ts`: abgelehnte Datensätze (`id must be …`, Schema) und fehlgeschlagene Logins mit `log.warn`
  (Nutzer-ID, Tabelle, ID, Grund; keine Inhalte).

### Block 5: Sync-Sicherheit (D2, D3, D4, D6, D7)

- **D2** `apps/web/src/db/write.ts:49-50`: `requiredId` (shared `schemas.ts:620`) schon beim Schreiben prüfen,
  Verstoß wirft `id must be <expected>` (Toast über `useSubmitting`). Abgelehnte Datensätze: der Sync **löscht sie
  lokal hart** (kein Grabstein, sonst würde er erneut gesendet), hebt eine Momentaufnahme in der `kv`-Liste
  `sync.rejected` auf und zieht danach einmal alles neu (`fullPull`-Merker, Cursor 0), damit die gültige
  Serverversion eines kaputt editierten Datensatzes zurückkommt. `SyncIndicator.tsx:14-27`: Beschriftung „N Datensätze
  vom Server abgelehnt" und Warn-Icon, solange die Liste nicht leer ist; `DataPage.tsx:134-148` zeigt je Eintrag
  Tabelle (deutsch), Name oder Datum aus der Momentaufnahme und den Grund auf Deutsch („Doppelter Tageseintrag, gehört
  zu s:2026-11-10", „Ungültige Werte (kcal)"), „Liste leeren" bleibt. `packages/shared/src/diary.ts:147-154`: Schritte
  je Tag nur über die feste ID `dayId.steps(date)` zählen; neu `stepsEntryOf(entries, date)` in shared `exercise.ts`,
  genutzt in `ExerciseCard.tsx:87`, `StepsRow`/`StepsPage` und CSV. Genaue Form: „Ausarbeitung Block 5".
- **D3** `db/backup.ts:58-64`, `features/more/DataPage.tsx:38-44`: vor dem Einspielen `sync.sync()`; scheitert er,
  Toast „Wiederherstellen braucht eine Verbindung zum Server" und Abbruch. Neu `importRecord(db, table, record)` in
  `write.ts`: validiert (Zod + `requiredId`), behält `updatedAt` der Sicherung, `incomingWins(prev, record)` entscheidet,
  Outbox-Eintrag mit genau diesem `updatedAt`; `backup.ts` nutzt es statt `saveRecord`. Gelöschte Datensätze der
  Sicherung werden nicht wiederbelebt. Test „a restored backup never undoes newer server changes or deletions" in
  `apps/api/test/device-sync.test.ts` (dort leben die Engine-Tests: echte `SyncEngine` gegen die Test-API).
- **D4** `features/more/AccountPage.tsx:229-248`, `sync/syncEngine.ts:136-138`: `pending` zählt Outbox plus nicht
  hochgeladene Fotos (`photos` mit `uploaded === 0`, `db/photos.ts`) plus `aiQueue`-Einträge ohne Ergebnis plus offene Entwürfe
  (`kv`-Schlüssel `mealDraft:`, `groupDraft:`, `trainingDraft:`). Der Dialog nennt, was verloren geht („2 Fotos, 1
  Analyse, 1 Entwurf"), Text „Alle Daten bleiben auf dem Server" nur, wenn wirklich nichts offen ist; der letzte
  Upload-Versuch läuft auch bei Fotos.
- **D6** `syncEngine.ts:84-92, 124-134, 347`: `SyncEngineOptions.appVersion` (aus `session.tsx`, `__APP_VERSION__`);
  `pull()` schreibt bei `unknown > 0` `kv sync.needsUpdate = { version: appVersion }`, `start()` liest ihn und setzt
  den Zustand; weicht die gespeicherte Version von `appVersion` ab (App wurde aktualisiert), setzt `start()` den
  `fullPull`-Merker (derselbe wie bei D2), und nach einem vollen Pull mit `unknown === 0` wird der Schlüssel
  gelöscht. `DataPage.tsx:91-96` zeigt den Zustand weiter. Test in `device-sync.test.ts` neben Zeile 205.
- **D7** `CustomFoodPage.tsx:158-167`, `CompleteDayPage.tsx:65-70`, `GoalsPage.tsx:102-107`, `db/notes.ts:9,66,84`:
  `patchRecord` oder Spread des gelesenen Datensatzes statt Neuaufbau; Regel in
  `.claude/skills/offline-sync/SKILL.md` („Beim Speichern nie einen Datensatz aus Formularfeldern neu aufbauen").

### Block 6: Sync-Epoche nach Server-Restore (D1)

- Serverseitig eine Epoche (`app_meta` Schlüssel `sync_epoch`, die Tabelle gibt es schon) und ein Cursor-Schutz
  (Cursor des Geräts über dem Stand von `sync_seq` → der Server rotiert die Epoche selbst und antwortet `reset`);
  clientseitig Cursor zurück, alle eigenen Datensätze in die Outbox, Fotos erneut hochladen, Pull. Konkrete Form in
  „Ausarbeitung Block 6". README-Abschnitt „Restore": Snapshot zurückspielen, Container starten, Epoche von Hand
  rotieren (ein SQL-Befehl per `docker exec`, Rückfall für einen Restore auf einen so jungen Stand, dass noch kein
  Cursor darüber liegt), Geräte laden beim nächsten Sync automatisch neu hoch.
- `docs/sync.md` um Epoche und Verhalten erweitern.

### Block 7: Papierkorb und „Trainings" (Ideen Papierkorb, Umbenennung)

- Synchronisiertes Feld `purgedAt: number | null` auf `weightEntries`, `meals`, `exerciseTemplates`, `exerciseEntries`
  (Schritte liegen dort): shared Schema (`.nullable().default(null)`), API-Spalten, eine Migration
  (`--name purged-at`), Dexie unverändert (nicht indiziert), Round-Trip-Test in `apps/api/test/sync.test.ts`.
- `db/trash.ts`: Abfragen filtern `deleted && !purgedAt`; neu `purgeRecords(db, table, ids)` (patchRecord `purgedAt:
now` in einer Transaktion), `purgeAll(db)` und `purgeTable(db, table)`; `restoreRecord` setzt beides zurück.
- `features/more/TrashPage.tsx`: Suchfeld oben (ein `Input`, filtert alle Abschnitte: Gewicht nach Datum und Wert,
  Schritte nach Datum, Meals nach Name, Trainings nach Name und `trainingSummary`; `searchKey` aus shared für die
  Faltung); Header-Icon Papierkorb-leeren (`Trash2`, `text-destructive`) → Bestätigungsdialog „Papierkorb leeren? N
  Einträge werden dauerhaft ausgeblendet." mit „Leeren"; je Abschnitt rechts im Abschnittskopf „Alle löschen"
  (Text-Button `text-destructive`, nur wenn der Abschnitt Zeilen hat) mit demselben Dialog für die Kategorie. Kein
  Rückgängig (Dialog ist die Sicherung). Alle Knöpfe über `useSubmitting`. Abschnitt „Gespeicherte Trainings" →
  „Trainings", Leerzustand „Keine gelöschten Trainings".
- Umbenennung überall: `MorePage.tsx:87` „Trainings" (Zeile neben „Meals"; `MorePage.tsx:86` „Gespeicherte Meals" →
  „Meals", damit beide gleich sind), `TrainingsPage.tsx:29` Titel „Trainings", `:44` „Noch keine Trainings.",
  `TrainingSearchPage.tsx:186` Caption „Trainings", `DataPage.tsx:75` `exerciseTemplates: 'Trainings (gespeichert)'`
  (`exerciseEntries` heißt dort schon „Trainings", `:68`, bleibt) und `:70` `meals: 'Meals'`, `MealsPage.tsx:28` Titel
  „Meals". E2E `diary-training.spec.ts:181` („Noch keine Trainings.") und `food-search.spec.ts:120,125` anpassen.
  Toast `PhotoPage.tsx:995` fällt in Block 10 ohnehin weg.

### Block 8: Trainingskarte: Menü, Tag kopieren, Reihenfolge, Schritte-Symbol (Ideen)

- **⋯-Menü** im Kopf der Trainingskarte (`features/diary/ExerciseCard.tsx:121-149`), neue Komponente
  `features/diary/TrainingCardMenu.tsx` nach dem Muster `DiaryMealMenu.tsx`: „Kopieren" (alle Trainings des Tages ohne
  Schritte als eine Zwischenablage: `copyTrainingToClipboard(db, 'Training <Datum>', trainings)`), „Wie gestern
  eintragen" (nur wenn gestern Trainings hat; derselbe Weg wie der Chip), Trennlinie, „Alle Trainings löschen"
  (destruktiv, `removeTrainingsWithUndo` über alle Nicht-Schritte-Einträge, mit Rückgängig). Reihenfolge der Icons:
  [Schritte-Symbol] [Einfügen, wenn Zwischenablage] [⋯] [+], wie bei den Mahlzeiten. `ClipboardMenu.tsx:90-99`:
  Beschreibung „N Trainings", wenn die Teile mehrere Gruppen oder Einzelne umfassen, sonst „N Aktivitäten".
- **Reihenfolge**: `@dnd-kit/sortable` hinzufügen; die Liste der Trainingszeilen (Pakete und Einzelne) wird eine
  `SortableContext` mit eigenem `DndContext` (Sensoren und `DRAG_ACTIVATION` aus `DiaryDnd.tsx` wiederverwenden,
  `restrictToVerticalAxis`), die Schritte-Zeile bleibt außerhalb und immer oben. `SwipeToDelete` während des Drags
  `disabled`. Drop → `reorderTrainings(db, date, orderedKeys)` in `db/entries.ts`: schreibt `loggedAt` aller
  Nicht-Schritte-Einträge des Tages in einer Transaktion neu (Basis `Date.now()` minus n, aufsteigend in der neuen
  Reihenfolge; Pakete behalten ihre innere Ordnung und wandern zusammen; nur Einträge, deren Position sich ändert,
  werden gepatcht). `groupTrainingEntries` sortiert nach `loggedAt`, also folgt alles (Karte, Teilen-Bild, CSV).
  `trainingSuggestions.ts:116` nutzt `loggedAt` nur innerhalb eines Tages als Tie-Break: unkritisch, im Kommentar
  festhalten. Die Mechanik so bauen (`SortableRows` mit `onReorder(keys)`), dass sie später in `DiaryRows` passt;
  Essen bleibt in dieser Runde unverändert.
- **Schritte-Symbol**: `features/steps/StepsRefreshButton.tsx` bekommt eine Variante `icon="footprints"` (Lucide
  `Footprints`, `size-5`, `text-steps`, während des Laufs `animate-spin` nicht sinnvoll für Fußabdrücke → `animate-pulse`
  plus `disabled`); im Kopf der Trainingskarte vor dem Einfügen-Symbol, nur wenn `useStepsRefreshAvailable()`.
  `StepsRow.tsx`: Slot `refresh` entfernen (auch aus `StepsRowBody`, `DayShareImage` übergibt ihn ohnehin nicht).
  `StepsPage.tsx:142` behält den ↻ (Lucide `RefreshCw`), `StepsSettingsPage` „Jetzt abrufen" bleibt.
  `lib/steps.ts` `runStepsShortcut` gibt `'received' | 'timeout' | 'unavailable'` zurück (U14-Teil); bei `timeout`
  ein Toast „Keine neuen Schritte empfangen" (Zustand, kein Erklärsatz), der Kartenkopf zeigt nichts weiter.
  Schritte-Plan: Entscheidung F1 ist damit überholt (Symbol im Kopf statt Chip); im Statusblock dort notieren.
- Tests: `apps/web/test` für `reorderTrainings` (Paket wandert zusammen, nur geänderte Zeilen gepatcht) und
  `copiesOf` mit einem Tag aus zwei Paketen und einem Einzelnen; E2E `diary-training.spec.ts`: Menü „Kopieren" und
  Einfügen am Folgetag ergibt dieselben Zeilen; Schritte-Symbol erscheint nur mit `steps.status.configured` und iOS
  (im Test per Mock des User-Agents, wie die bestehenden Schritte-Specs es tun).

### Block 9: Barcode-Zwischenschritt und fünf Etikettenfotos (Ideen)

- `features/foods/ScanPage.tsx:65-86` `apply`: bei `not_found` **immer** `setState({ kind: 'notfound', code })`, kein
  Toast, kein Direktsprung; das `notfound`-Panel (`:129-164`) bleibt wie es ist (Code, „Etikett fotografieren",
  „Selbst anlegen", „Weiter scannen" bei KI an; „Produkt anlegen", „Weiter scannen" ohne). Die Kamera läuft dabei weiter,
  „Weiter scannen" hebt die Pause auf (gibt es). `TimeoutError` eigener Zustand `timeout` mit Text „Open Food Facts hat
  nicht rechtzeitig geantwortet." und denselben Knöpfen wie `error`; `offline`-Panel bekommt zusätzlich „Selbst anlegen".
  `useAiStatus` wird in `apply` nicht mehr gebraucht (nur im Panel). E2E `food-search.spec.ts` (Barcode-Tests) anpassen:
  nach 404 steht das Panel, erst der Tipp öffnet den Editor.
- `MAX_LABEL_PHOTOS = 5` als eine Konstante in `packages/shared/src/schemas.ts` neben `MAX_ANALYSIS_PHOTOS`;
  `components/LabelCaptureSheet.tsx:11-12, 29, 96, 101`, `apps/api/src/routes/ai.ts:50, 316, 322, 339`,
  `apps/api/src/ai/label.ts:2, 50-53` importieren sie; Test `apps/api/test/ai.test.ts:560` (6 Bilder → `too_many_images`,
  5 ok), E2E `food-search.spec.ts:349` Text „bis zu 5 Fotos".

### Block 10: Erklärsätze (U6, Nutzer hakt ab)

Vor diesem Block hakt der Nutzer die Liste ab (im Repo-Plan, Spalte „weg?"). Vorschlag je Satz:

| Nr  | Stelle                                        | Satz                                                        | Vorschlag                                                                         | weg? |
| --- | --------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------- | ---- |
| 1   | `BarcodeScanSheet.tsx:26`                     | „Du kannst den Code im Feld eintippen."                     | streichen (das Feld steht da)                                                     | [x]  |
| 2   | `PhotoPage.tsx:995`                           | Toast „Unter „Gespeicherte Meals“ kannst du es jederzeit …" | Toast nur „Als „Name“ gespeichert"                                                | [x]  |
| 3   | `DiaryGroupPage.tsx:330`                      | Toast „Prüfe die Zutaten und tippe auf …"                   | Toast nur „Analyse fertig"                                                        | [x]  |
| 4   | `ExpenditureCard.tsx:67`                      | „Unter „Ziele“ kannst du alles nachjustieren."              | streichen; der Knopf „Ziel übernehmen" reicht                                     | [x]  |
| 5   | `ScanPage.tsx` (`apply`)                      | Toast „… Fotografiere das Etikett."                         | entfällt mit Block 9                                                              | [x]  |
| 6   | `CompleteDayPage.tsx:101-102`                 | „Eine grobe Schätzung ist besser als eine Lücke …"          | streichen                                                                         | [x]  |
| 7   | `GoalsPage.tsx:129`                           | „z. B. mehr Kalorien an Trainings- oder Wochenendtagen"     | streichen (Beschriftung „Tagesziele" reicht)                                      | [x]  |
| 8   | `PhotoPage` „Kein Essen erkannt"              | „Versuche ein Foto von schräg oben …"                       | streichen; Zustand „Kein Essen erkannt" + Knöpfe „Neues Foto", „Hinweis ergänzen" | [x]  |
| 9   | Aussehen → Tagebuch                           | Satz unter dem Makro-Schalter                               | streichen (die Vorschau der Zeile zeigt es)                                       | [x]  |
| 10  | `BarcodeScanSheet.tsx:43`, `ScanPage.tsx:121` | „Halte den Barcode in den Rahmen."                          | streichen (Nutzer 2026-11-12)                                                     | [x]  |

Abgehakte Zeilen umsetzen; E2E-Texte, die darauf prüfen, mit anpassen.

### Block 11: Oberfläche klein (U5, U10, U12, U15, E5, E7, F10-Rest, B9-Teile)

- **U5** `NutrientBreakdown.tsx:152`: `whitespace-nowrap` weg, Zeile darf umbrechen (oder kcal auf eigener Zeile unter
  375 px); `GoalsPage.tsx:177`: Einheit außerhalb des Feldes (Suffix neben dem `NumberField`, Felder `min-w-0`);
  `DiaryPage.tsx:77`: Datum kurz („Do., 15. Okt."), wenn der Platz fehlt (CSS `@container` oder ab `max-width: 390px`).
  Prüfung mit Playwright bei 375 px (bestehende `ios-layout.spec.ts` um Berichte und Ziele ergänzen).
- **U10** `Chart.tsx:216`: `sr-only`-Tabelle in einen Container mit `overflow-hidden` und `max-w-full`.
- **U12** `CalorieCard.tsx:95-110` (`dl` korrekt: `div` → `dt/dd`-Paare direkt), `AddFoodPage.tsx:293` und
  `TrainingSearchPage.tsx:245` (Reiter ohne Panels: `role="tablist"` entfernen und als Toggle-Gruppe mit
  `aria-pressed` auszeichnen, oder ein Panel-Element mit `id` ergänzen), `SportPage.tsx:235, 222`,
  `TrainingLogView.tsx:197` (Kontrast ≥ 4,5:1: `text-muted-foreground` auf dem Primärknopf → `text-primary-foreground/90`
  prüfen, „N× eingetragen" eine Stufe dunkler), `MealPhoto.tsx:159` (`role="img"` mit `aria-label` des Namens oder
  `aria-hidden`). Danach axe erneut (im E2E-Smoke eine Prüfung mit `@axe-core/playwright` auf dem Tagebuch, nur
  `critical`/`serious` als Fehler).
- **U15**: Editor eigenes Lebensmittel: Speichern nur bei Änderung aktiv (Vergleich mit `initial` wie im Meal-Editor);
  Gewichtsdiagramm mit einer Wiegung: y-Bereich ±2 kg um den Wert; offline-Hinweis „Etikett fotografieren · Nur online"
  nur bei KI an; Fotoseite bei KI aus: „KI-Analyse auf dem Server ausgeschaltet" statt „(ANTHROPIC_API_KEY fehlt)";
  Gruppen-Editor: gespeicherte Fotos entfernbar (X am `PhotoStrip`, entfernt die ID aus dem Draft, `saveGroupDraft`
  schreibt `photoIds` ohne sie; das Foto selbst bleibt bis zur Server-Aufräumung).
- **E5** `MealPage.tsx:36`: `key={meal.updatedAt}` nur, wenn der Nutzer den Dialog nicht angefasst hat (Muster
  `ConflictBanner`: unberührt → neu laden, berührt → Banner).
- **E7** `MealEditor.tsx:260`: stabile Keys (Zutaten bekommen beim Laden des Drafts eine `key`, neue `new-<uuid>`);
  `PendingAnalysisRow.tsx:36,65`: Text „wird analysiert, sobald du online bist" nur offline, online „wird analysiert";
  `MealPage.tsx:23`, `MealEditor.tsx:70-71`: Skeleton statt `null`.
- **F10** `Chart.tsx:121`, `chartData.ts:52,70`: Zielstufenlinie als `stepped({ align: 0 })` mit einem Punkt mehr am
  Ende, sodass jeder Tag sein Segment hat; `GoalsPage.tsx:96,258`, `ProfilePage.tsx:183`, `MealNamesPage.tsx:52`:
  Speichern als `Page footer`, `useBlocker` + `DiscardDialog` wie der Meal-Editor.
- **B9** `vite.config.ts:51-57` Shortcut auf `/photo`; `components/ui/sheet.tsx` löschen; `deploy/.env.example` um
  `AI_ENABLED`, `REGISTER_RATE_LIMIT` (und die neuen Budget-Variablen aus Block 3); `seed-demo.ts` legt Schritte an,
  `share-day.spec.ts` kennt sie.

### Block 12: PhotoPage aufteilen, Eintragen atomar, Routenfehler (H1, H6, D5, U14-Rest)

- Aufteilung von `features/ai/PhotoPage.tsx` (1 390 Zeilen) in Schritt-Komponenten und Hooks, Typen `Shot`/`CapturedShot`
  einmal; Navigation (`waiting`/`gone`, `form`/`review`-Schritte, `leaveAnalysis`) unverändert. **D5**: „Meal eintragen"
  (`logAiMeal`/`logAiItems`, `rememberFood`, `discardQueueItem`) in einer Dexie-Transaktion wie `logDeferred`
  (`queue.ts:184-201`). **U14**: `app/router.tsx:343-363` `RouteError` ruft `recordError` und zeigt „Die Seite konnte
  nicht geladen werden" mit „Neu laden" statt der englischen Meldung. **T1**: E2E `meals-goals.spec.ts:665` beide
  Klicks in einem `evaluate`.
- Konkrete Dateiaufteilung und die Tests, die grün bleiben müssen: „Ausarbeitung Block 12".

### Block 13: Betrieb und Doku (B1, B2, B3, B4, B7, T1-Rest, CLAUDE.md)

- **B1** `.github/workflows/docker.yml`: Job hängt per `needs` an den CI-Jobs (ein Workflow) oder `workflow_run` nach
  grünem `ci.yml`; erst `:sha-<commit>` pushen, Smoke-Test gegen dieses Tag, erst danach `:latest` taggen
  (`docker buildx imagetools create -t …:latest …:sha-<commit>`). README `:96-98` entsprechend.
- **B2** README „Restore": ZFS-Snapshot von `tank/applications` (täglich, 2 Wochen) als Sicherung benennen; Schritte:
  Container stoppen, Snapshot zurückrollen, Container starten, Epoche rotieren (Block 6), Geräte laden automatisch
  nach; Rückweg bei fehlgeschlagener Migration: `image: …:sha-<vorheriger Commit>` in Dockge.
- **B3** `apps/api/build.mjs`: zweiten Einstieg `scripts/reset-password.ts` → `dist/reset-password.js` bauen; README
  `docker exec fleisch-teufel node dist/reset-password.js <mail>`. Test: der Build erzeugt die Datei.
- **B4** README korrigieren: Fotos liegen auf dem eigenen Server, 30 Tage nach dem letzten Verweis gelöscht;
  Erinnerung und Health-Sync sind enthalten; „Eingeben"/„Suchen"; Gewichtsraster einstellbar; `/health` nur `{ ok }`.
- **B7** `.github/dependabot.yml`: npm (Root, Gruppen „minor-patch" wöchentlich montags, Majors einzeln) und
  `github-actions` wöchentlich; `web-push` aus dem Root-`package.json`, Dockerfile-argon2-Version aus dem Lockfile
  ableiten (Kommentar, oder `pnpm deploy`).
- **Doku**: `CLAUDE.md` (Papierkorb mit Leeren und Suche, `purgedAt`, Trainingskarte mit Menü und Sortierung,
  Schritte-Symbol im Kopf, Barcode-Zwischenschritt, 5 Etikettenfotos, „Trainings" als Name, KI-Budget, Epoche,
  Ablehnungen unter Daten & Sync, `NotFoundPage`), `docs/sync.md` (Epoche, `purgedAt`, Restore-Semantik, abgelehnte
  Datensätze), Skill `offline-sync` (D7-Regel, `purgedAt`), Statusblöcke der Pläne Schritte (F1 überholt) und
  Bestandsaufnahme (Verweis auf diesen Plan), Memory-Zeile der Feedback-Runden.

## Ausarbeitung der schweren Blöcke

Gegen HEAD bdbba3a geprüft. `web` = `apps/web/src`, `api` = `apps/api/src`, `shared` = `packages/shared/src`.

### Ausarbeitung Block 3 (KI)

**Schema** `api/db/schema.ts` `aiAnalyses`, neue Spalten:

```ts
status: text({ enum: ['ok', 'failed'] }).notNull().default('ok'),
/** Error code of a failed call (ai_timeout, refused, upstream_error, no_result, upstream_rate_limited). */
error: text(),
/** Idempotency key of the device's queue item (meal analysis only). */
requestId: text(),
/** The complete answer sent to the device (items with candidates); null for labels, failed calls and older rows. */
response: jsonb().$type<AiAnalysisResult>(),
```

Partieller Unique-Index `(user_id, request_id) where status = 'ok' and request_id is not null` (ein Fehlschlag darf
die Wiederholung nicht blockieren). Migration `pnpm --filter @ft/api db:generate --name ai-analyses-status-request`.

**Budget** `api/ai/budget.ts`:

```ts
export const DAY_MS = 86_400_000,
  MONTH_MS = 30 * DAY_MS;
export type BudgetScope = 'day' | 'month';
export async function budgetExceeded(
  db,
  userId,
  limits: { dayUsd: number; monthUsd: number },
  now = Date.now(),
): Promise<BudgetScope | null>;
// select coalesce(sum(cost_usd) filter (where created_at >= $day), 0) as day, coalesce(sum(cost_usd), 0) as month
//   from ai_analyses where user_id = $u and created_at >= $month
```

`env.ts`: `AI_BUDGET_DAY_USD: z.coerce.number().min(0).default(5)`, `AI_BUDGET_MONTH_USD: … default(50)`. Beide Routen:
`if (over) { log.warn('ai budget exceeded', …); return c.json({ error: 'ai_budget', scope: over }, 429); }`.

**Kosten erfassen** `api/ai/analyze.ts`:

```ts
export interface AiUsage { inputTokens: number; outputTokens: number; costUsd: number }
export class AiCallError extends Error {
  constructor(public readonly cause: unknown, public readonly usage: AiUsage, public readonly model: string | null, public readonly rounds: number) { … }
}
```

`analyze()` fängt alles ab der ersten Runde und wirft `AiCallError(e, usage, model, rounds)` (die Umwandlung
`signal.aborted → AiOutputError('timeout')` bleibt davor). `readLabel(input, signal?)` reicht `signal` an
`messages.parse` weiter (K4) und wirft `AiCallError(e, { 0, 0, 0 }, null, 1)`. `routes/ai.ts`: `aiError` wird
`classifyAiError(e): { status; code; category? } | null` auf `e.cause`; beide `catch`-Zweige schreiben eine Zeile
`{ status: 'failed', error: info.code, requestId, ...usage, result: { photos, failed: info.code } }` und antworten
wie bisher. `/label`: `analyzer.readLabel({ images, text }, AbortSignal.timeout(ANALYSIS_BUDGET_MS))`.

**Idempotenz** Client `web/db/dexie.ts` `AiQueueItem.requestId?: string`; `queue.ts` vergibt und sendet es
(`form.set('requestId', …)`). Server `/analyze`:

```ts
if (requestId) {
  const [prev] = await db
    .select({ response })
    .from(aiAnalyses)
    .where(and(eq(userId), eq(requestId), eq(status, 'ok')));
  if (prev?.response) return c.json(prev.response); // keine Kosten
  const running = inflight.get(`${user.id}:${requestId}`); // Map<string, Promise<AiAnalysisResult>> in der Route
  if (running) return c.json(await running);
}
```

Erfolgs-Insert mit `requestId, response: result`; `analysisId` einer Wiedergabe ist die ursprüngliche (so bleiben
`est:<analysisId>:<i>` und `/choices` gültig). Unique-Verletzung `23505` beim Insert (Neustart zwischen zwei
parallelen Aufrufen) → Zeile lesen und deren `response` liefern.

**Client-Texte** `web/lib/api.ts` `errorMessage`: `ai_budget` (scope `month`: „Das Monatsbudget für die
Foto-Analyse ist aufgebraucht.", sonst „Das Tagesbudget für die Foto-Analyse ist aufgebraucht. Morgen geht es
weiter."), `ai_timeout` („Die Analyse hat zu lange gedauert und wurde abgebrochen."), `too_many_images`
(`Höchstens ${MAX_ANALYSIS_PHOTOS} Fotos je Analyse.`), `unsupported_image_type`, `push_disabled`, `no_result`.
`queue.ts`: bei `ai_budget` den Eintrag `failed` mit dieser Meldung setzen und die Schleife abbrechen.

**Tests** `apps/api/test/ai.test.ts` (Fake-Analyzer ab Zeile 62): Budget-Describe mit `AI_BUDGET_DAY_USD: '0.04'`
(erste Analyse 200, zweite 429 `scope: 'day'`, Fake nicht erneut gerufen), Monat analog, Etikett ebenso, `0` schaltet
aus; Fake wirft `AiCallError(AiOutputError('timeout'), { 2000, 10, 0.02 }, …)` → 504, Zeile `failed`/`ai_timeout`/
`cost_usd 0.02`, zählt fürs Budget; `AiRefusalError` ebenso; `requestId 'r1'` zweimal → gleiche `analysisId`, Fake
einmal; fehlgeschlagener Erstaufruf mit `r1` wird erneut analysiert; anderer Nutzer mit `r1` frisch; ohne `requestId`
wie heute; `readLabel` erhält ein `AbortSignal`. `apps/web/test`: neue Codes in `errorMessage`.

### Ausarbeitung Block 5 (abgelehnte Datensätze, D2)

`web/db/write.ts` nach `SYNC_SCHEMAS[table].parse(record)`:

```ts
const expected = requiredId(table, record as Record<string, unknown>);
if (expected !== null && record.id !== expected) throw new Error(`id must be ${expected}`);
```

`web/sync/syncEngine.ts` Push-Transaktion (ersetzt Zeilen 296-302):

```ts
const rejected = result.rejected.filter((r) => r.error !== CLOCK_AHEAD);
for (const r of rejected) {
  if (!r.id || !Object.hasOwn(SYNC_SCHEMAS, r.table)) continue;
  const t = this.db.syncTable(r.table as SyncTable);
  const snapshot = await t.get(r.id);
  await t.delete(r.id);
  entries.push({ table: r.table, id: r.id, error: r.error, at: Date.now(), record: snapshot ?? null });
}
if (entries.length) {
  /* kv sync.rejected = [...prev, ...entries].slice(-50); this.set({ rejected }); this.fullPull = true; */
}
```

`private fullPull = false`; am Anfang der `pull()`-Schleife: `if (this.fullPull) { this.fullPull = false; await
this.db.kv.delete(CURSOR_KEY); }`. Listenform: `{ table, id, error, at, record: AnySyncRecord | null }`.
`api/sync/service.ts` nach der Validierung: `log.warn('sync push: rejected records', { user, count, rejected:
slice(0, 10) })` (`api/log.ts` importieren). `shared/diary.ts:147-154`:

```ts
const stepsId = dayId.steps(date);
const counted = exercises.filter((e) => !isStepsEntry(e) || e.id === stepsId);
```

**Tests**: `apps/web/test/write.test.ts` (Schritte mit Zufalls-ID und Gewicht mit falscher ID werden vor der Outbox
abgewiesen); `apps/api/test/device-sync.test.ts` („drops a record the server rejected, keeps it in the list and
reloads from the server": ungültigen Datensatz direkt per `a.db.exerciseEntries.put` + `outbox.put` einschleusen,
sync → lokal weg, `kv sync.rejected[0].record.id` stimmt, `rejected === 1`, Cursor war 0, gültiger Eintrag da);
`packages/shared/test` („counts steps once, only s:<date>"); `apps/web/test/sync-indicator.test.tsx`.

### Ausarbeitung Block 6 (Epoche, D1)

`shared/schemas.ts` `PullResult`: `epoch?: string` (optional nur wegen älterer Server während des Updates) und
`reset?: true`. `api/sync/service.ts`:

- `syncEpoch(db)`: `app_meta` Schlüssel `sync_epoch`, bei Fehlen `crypto.randomUUID()` per `onConflictDoNothing`
  einfügen und erneut lesen (keine Datenmigration).
- `rotateEpoch(db, seen)`: `update app_meta set value = $new where key = 'sync_epoch' and value = $seen`; 0 Zeilen
  (parallel rotiert) → aktuellen Wert zurückgeben. `log.warn('sync epoch rotated: cursor beyond sequence', …)`.
- `pull`: in der bestehenden Read-only-Transaktion zusätzlich
  `select case when is_called then last_value else last_value - 1 end as last from sync_seq` und die Epoche lesen.
  Danach: `if (since > Number(last))` → rotieren und `{ changes: [], cursor: 0, hasMore: false, serverTime, epoch,
reset: true }`; sonst `epoch` in die normale Antwort. (`sync_seq` ist global über alle Nutzer, also immer ≥ jedem
  je vergebenen Cursor; frische DB: `last = 0`.)

`web/sync/syncEngine.ts`: `EPOCH_KEY = 'sync.epoch'`; `SyncEngineOptions.onReset?: (info: { epoch; records; reason:
'reset' | 'epoch' }) => void`; `resetForEpoch(epoch, reason)` in **einer** Dexie-Transaktion über `[outbox, kv,
photos, ...alle Sync-Tabellen]`: `kv.delete(CURSOR_KEY)`, `kv.put(EPOCH_KEY)`, je Tabelle `outbox.bulkPut(rows.map(r
=> ({ key: \`${t}:${r.id}\`, table: t, id: r.id, updatedAt: r.updatedAt })))`(Grabsteine eingeschlossen),`photos.where('uploaded').equals(1).modify({ uploaded: 0 })`(abgelehnte`2`bleiben), danach`onReset`, `this.again
= true`. In `pull()` direkt nach der Antwort:

```ts
const stored = (await this.db.kv.get(EPOCH_KEY))?.value as string | undefined;
if (page.reset || (page.epoch && stored && page.epoch !== stored)) {
  await this.resetForEpoch(page.epoch ?? stored!, page.reset ? 'reset' : 'epoch');
  return applied; // sync() ist do { push; pull } while (again): erst alles hoch (LWW), dann Pull ab 0
}
if (page.epoch && !stored) await this.db.kv.put({ key: EPOCH_KEY, value: page.epoch });
```

`web/app/session.tsx:44`: `new SyncEngine(db, { onUnauthorized, onReset: (i) => recordError(new Error(\`Server-Datenbank
zurückgesetzt (${i.reason}): ${i.records} Datensätze werden erneut hochgeladen\`), 'sync') })`(die Engine bleibt
frei von`@/`-Importen, darum der Callback). README-Befehl:
`docker exec fleisch-teufel-db psql -U <user> -d <db> -c "UPDATE app_meta SET value = gen_random_uuid()::text WHERE key = 'sync_epoch'"`.

**Tests** `apps/api/test/sync.test.ts`: jede Pull-Antwort trägt die Epoche (über Nutzer gleich); `since` über dem
Stand → `{ reset: true, cursor: 0, epoch ≠ E1 }`, danach `since=0` liefert die Daten mit neuer Epoche.
`device-sync.test.ts`: „re-uploads everything after the server database was rolled back" (A schreibt 3 Einträge +
1 Foto, B synct; Restore simulieren: Zeilen löschen und `setval('sync_seq', <vorher>)`; A.sync → `onReset` mit
`reset`, Server hat alles wieder; B.sync → ebenfalls Reset, gleicher Stand) und „resets when the epoch changed although
the cursor is still valid" (`kv sync.epoch = 'old'` → `onReset` mit `epoch`, Outbox gefüllt, Daten unverändert).

Risiken: ein fehlerhafter Client mit absurdem Cursor rotiert die Epoche für alle Geräte des Kontos (Kosten: ein
Voll-Upload je Gerät, LWW macht es harmlos); Fotos werden einmal erneut hochgeladen (einige MB).

### Ausarbeitung Block 7 (Papierkorb)

`shared/schemas.ts` in `weightEntrySchema`, `mealSchema`, `exerciseTemplateSchema`, `exerciseEntrySchema`:

```ts
/** Removed from the trash for good on some device (epoch ms); the tombstone stays for the sync. Null = shown in the trash. */
purgedAt: z.number().int().nonnegative().nullable().default(null),
```

`api/db/schema.ts`: `purgedAt: bigint({ mode: 'number' })` auf den vier Tabellen, `db:generate --name trash-purge`.
Alle `saveRecord`-Aufrufer der vier Tabellen bekommen `purgedAt: null` (Typecheck listet sie: `entries.ts`
`logTrainings`/`saveExercise`/`saveTraining`/`updateTraining`/`createAiMeal`/`logAiMeal`/`saveMealFromItems`,
`mealDraft.ts`, `trainingDraft.ts`, Gewichtsseite, `saveOnboarding.ts`, `api/steps/import.ts` falls es den ganzen
Datensatz baut). `write.ts`: `PURGEABLE_TABLES`, `restoreRecord` setzt `deleted: false, purgedAt: null`. `trash.ts`:
Filter `deleted && !purgedAt`, `purgeRecords(db, items)` (eine Transaktion, überspringt inzwischen wiederhergestellte
oder schon ausgeblendete Zeilen, gibt die Zahl zurück), `purgeTrash(db)`.

LWW: Purge auf A (T1), Wiederherstellen auf B offline (T2): T2 > T1 → lebt überall, T1 > T2 → überall aus dem
Papierkorb. Eine ältere App-Version ohne das Feld zeigt ausgeblendete Zeilen weiter in ihrem Papierkorb (Zod streift
das Feld); stellt sie eine wieder her, lebt sie. Hinnehmbar.

**UI** `TrashPage.tsx`: Suchfeld (`Input type="search"`, `aria-label="Papierkorb durchsuchen"`, Platzhalter „Suchen",
16 px) über den Abschnitten; Treffer über `matchesTrash(q, texts)` in neuem `features/more/trashSearch.ts` (shared
`normalize` auf beiden Seiten): Gewicht `[date, fmtDate(date), fmt2(kg)]`, Schritte `[date, fmtDate(date),
fmt0(steps)]`, Meal `[name]`, Training `[name, trainingSummary(trainingItemsOf(t))]`; mit Suchtext lautet der
Leerzustand „Keine Treffer". Header `actions`: `Button ghost icon` `Trash2`, `aria-label="Papierkorb leeren"`,
`disabled` bei 0 sichtbaren Zeilen. Je Abschnitt `action`: `Button ghost sm text-destructive` „Alle löschen" (nur mit
Zeilen). Beide wirken auf die **sichtbaren** (gefilterten) Zeilen. Dialog (neu `components/ConfirmDialog.tsx`,
Muster „Neu analysieren?" `PhotoPage.tsx:1227-1240` und `DiscardDialog`; Props `open, onOpenChange, title,
description, confirmLabel, destructive, onConfirm`): Titel „Endgültig löschen?", Text `${n} Einträge werden aus dem
Papierkorb entfernt und lassen sich nicht wiederherstellen.`, Knopf „Endgültig löschen". Erfolgstoast `${n} Einträge
endgültig gelöscht`, kein Rückgängig.

**Tests** `write.test.ts` (Purge blendet aus, Version steigt, Outbox hat den Schlüssel, Restore setzt `purgedAt`
zurück; Purge überspringt inzwischen Wiederhergestelltes), `apps/api/test/sync.test.ts:69-275` (Fixtures der vier
Tabellen bekommen `purgedAt: null`; Fall „syncs a purge like an edit"), `trash-search.test.ts` (`matchesTrash`).

### Ausarbeitung Block 8 (Trainingskarte)

`web/db/entries.ts`:

```ts
/** Key of a training card row: the entry id, or `group:<groupId>` for a package. */
export const trainingRowKey = (row) => (row.kind === 'entry' ? row.entry.id : `group:${row.groupId}`);
/**
 * New order of the day's training rows (steps excluded). Renumbers `loggedAt` of every live non-steps entry from
 * the smallest existing value upwards, a package's activities together in their inner order; rows missing from
 * `orderedKeys` keep their relative place at the end. Only entries whose `loggedAt` changes are written.
 * Returns the previous key order (undo).
 */
export async function reorderTrainings(
  db: UserDb,
  date: ISODate,
  orderedKeys: readonly string[],
): Promise<string[]>;
```

Eine Transaktion `[exerciseEntries, outbox]`, `groupTrainingEntries(live)` liefert die Zeilen, `base = min(loggedAt)`,
`patchRecord` nur bei Änderung. Andere Geräte sortieren beim Pull neu (`useDayExercises` sortiert nach `loggedAt`).

Neu `features/diary/TrainingSortable.tsx`: `TrainingSortable({ date, keys, children })` mit eigenem `DndContext`
(Maus + Touch, `DRAG_ACTIVATION` aus `DiaryDnd.tsx`, `restrictToVerticalAxis` + `restrictToParentElement`,
`closestCenter`, `SortableContext` mit `verticalListSortingStrategy`, deutsche `announcements` wie
`DiaryDnd.tsx:79-95`), stellt denselben `DragState`-Kontext bereit (`DragStateProvider` aus `DiaryDnd.tsx:49`
exportieren), damit `SwipeToDelete` im Drag `disabled` ist; `onDragEnd`: `arrayMove`, `reorderTrainings`, Toast
„Reihenfolge geändert" mit „Rückgängig" (vorherige Keys). `SortableRow({ id })`: `useSortable`, nur `listeners`
(keine `attributes`, wie `DraggableRow`), Transform von Hand (`translate3d(0, y, 0)`, keine Abhängigkeit auf
`@dnd-kit/utilities`), `isDragging && 'relative z-10 bg-card shadow-lg opacity-90'`, kein `DragOverlay`. Die `<ul>`
bekommt `relative` (Offset-Parent für `restrictToParentElement`). `pnpm --filter @ft/web add @dnd-kit/sortable`.
`ExerciseCard.tsx`: Zeilen-`<ul>` (180-215) in `TrainingSortable`, jedes `<li>` in `SortableRow`, Schritte-`<ul>`
bleibt außerhalb und zuerst; `logCopies` wird `logCopiesWithUndo(db, date, parts, weightKg, message)` (Modulfunktion,
`run()` bleibt beim Aufrufer).

Neu `features/diary/TrainingCardMenu.tsx` (Props `{ date, trainings, yesterdayParts, weightKg }`, eigener
`useSubmitting`): „Kopieren" (`copyTrainingToClipboard(db, \`Training ${fmtDate(date)}\`, trainings)`, Toast `„…“
kopiert`), „Wie gestern eintragen" (nur mit `yesterdayParts`; `ExerciseCard` berechnet sie künftig immer, nicht nur bei
leerem Tag), Trennlinie, „Alle Trainings löschen" (`removeTrainingsWithUndo(db, trainings, 'Alle Trainings')`).
`ClipboardMenu.tsx:89-99`→`trainingClipboardDetail`: Zahl der Zeilen = verschiedene `group`-Marken plus Einzelne;
`> 1` → „N Trainings", sonst wie heute.

Schritte-Symbol: siehe Block 8 oben (Fußabdruck, `animate-pulse`, nur mit `useStepsRefreshAvailable()`).

**Tests** `write.test.ts` (Reorder: Paket wandert zusammen, unveränderte Einträge behalten `updatedAt`, Undo stellt
die alte Reihenfolge her; gelöschte Keys ignoriert, fehlende angehängt), `trainingClipboard.test.ts` (Tag mit zwei
Paketen und einem Einzelnen → zwei neue Gruppen und ein Einzelner; Detail „3 Trainings"), `components.test.tsx`
(`TrainingCardMenu`), E2E `diary-training.spec.ts` („⋯ Kopieren", am Folgetag einfügen). Drag selbst nur per
Unit-Test (Touch-Drag in Playwright ist wackelig, der Mahlzeiten-Drag ist auch nicht E2E-getestet).

### Ausarbeitung Block 12 (PhotoPage)

Heute: `PhotoPage` (173-517, 10 `useState`, Refs `waiting`/`gone`), `PhotoPreview` (524-617), `CameraCapture`
(628-777), `QueueRow` (784-853), `ResultEditor` (867-1253, 9 `useState`), `ReviewRow` (1260-1390); `Shot` (124-127)
doppelt `CapturedShot` aus `components/PhotoCaptureSheet.tsx:18-21`. Kein Unit-Test importiert `PhotoPage`.

| Datei                         | Inhalt                                                                                                                                                                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `features/ai/types.ts`        | `CapturedShot` (hierher; `PhotoCaptureSheet.tsx` und weitere Importeure umstellen, `grep CapturedShot`), `HINT_CHIPS`, `addLabel`, `CONFIDENCE`, `BUSY`                                                                                                                                           |
| `features/ai/usePhotoFlow.ts` | Hook: `shots`/`nextShot`, `analyzing`, `adding`, `entry`, Refs `waiting`/`gone`, Unmount-Effekt (236-244), `follow` (310-352), `analyze`, `describeMeal`, `logEntry`, `leaveToDiary`; Vertrag im Doc-Kommentar: „nach einem await nur navigieren, wenn `waiting.current === id && !gone.current`" |
| `features/ai/PhotoPage.tsx`   | Routenkomponente: Search-Params, Meal-Picker, `openReview/openForm/closeForm/closeReview` (mit `replace` für Formular → Review), Schrittweiche, Footer, `aiStatus`-Effekt + `processQueue`; `key={\`${active.localId}:${busy ? 'busy' : 'idle'}\`}` (360) bleibt                                  |
| `features/ai/CameraStep.tsx`  | `CameraCapture` unverändert                                                                                                                                                                                                                                                                       |
| `features/ai/PreviewStep.tsx` | `PhotoPreview` unverändert                                                                                                                                                                                                                                                                        |
| `features/ai/QueueList.tsx`   | „Offene Analysen" + `QueueRow` + `readQueueOpen/writeQueueOpen` (`QUEUE_OPEN_KEY` bleibt `'ft:photo:queueOpen'`, E2E prüft ihn)                                                                                                                                                                   |
| `features/ai/ReviewStep.tsx`  | `ResultEditor` + `ReviewRow`                                                                                                                                                                                                                                                                      |

URL-Form, Verlauf, Toasts, Fokus-IDs (`pending:<id>`) und Aria-Namen ändern sich nicht; die E2E-Specs sind der Vertrag.

**D5** neu in `features/ai/queue.ts` neben `logDeferred`:

```ts
/** "Meal eintragen" of a review: entries (and the saved meal), photos and the removal of the queue item in one
 *  transaction. Null when the item is gone (logged already): the caller shows nothing twice. */
export async function logReview(
  db,
  args: { item: AiQueueItem; name: string; items: AiItem[]; meal: number; savedMealId: string | null },
): Promise<string[] | null>;
```

Liest zuerst `readPhotoBytes(await loadQueueImages(db, item))` (kein IndexedDB-Promise in der Transaktion), dann eine
Transaktion über `[foodEntries, meals, outbox, photos, aiQueue, aiPhotos, aiImages]`: `aiQueue.get(localId)` fehlt →
`null`; `logAiMeal`/`logAiItems` → `discardQueueItem` → IDs. Dafür nimmt `entries.ts` `logAiMeal(..., photos:
PhotoBytes[])` Bytes entgegen (Aufrufer lesen vorher, wie `logAiItems` es intern schon tut), `logAiItems` wird in den
transaktionalen Kern (`logAiItemsRows`) und den bisherigen Wrapper geteilt; `write.test.ts:361-471` passt die
Aufrufe an. `logDeferred` kann `logReview` mit `savedMealId: null` nutzen. `ReviewStep.log()`: `const ids = await
logReview(...)`; `null` → nur `returnToDiary`; sonst `rememberFood`, `aiChoices`, Toasts, `returnToDiary` wie heute.

**U14** `router.tsx:343` `RouteError`: `useEffect(() => { recordError(error, 'route'); }, [error])` (Effekt, nicht
Render), Text „Die Seite konnte nicht geladen werden" mit „Neu laden".

**Grün bleiben müssen**: E2E `meals-goals.spec.ts` (Zeilen 17, 368, 546 ff., 614), `meals-unified.spec.ts` (17,
229-238), `diary-training.spec.ts` (271-448), `share-day.spec.ts:24`; Unit `write.test.ts` (361, 445, 511, 559, 602).
Neu: „logReview logs once: a second call returns null and writes nothing".

## Wichtige Dateien

- Sync: `apps/api/src/sync/service.ts`, `apps/web/src/sync/syncEngine.ts`, `apps/web/src/db/write.ts`,
  `apps/web/src/db/backup.ts`, `apps/web/src/db/dexie.ts`, `.claude/skills/offline-sync/SKILL.md`, `docs/sync.md`
- KI: `apps/api/src/routes/ai.ts`, `apps/api/src/ai/analyze.ts`, `apps/api/src/ai/pricing.ts`,
  `apps/web/src/features/ai/queue.ts`, `apps/web/src/lib/api.ts`
- Zahlen: `packages/shared/src/expenditure.ts`, `reports.ts`, `recipes.ts`, `diary.ts`, `apps/web/src/lib/format.ts`
- Tagebuch: `features/diary/ExerciseCard.tsx`, `MealCard.tsx`, `DiaryMealMenu.tsx`, `DiaryDnd.tsx`,
  `apps/web/src/db/clipboard.ts`, `entries.ts`, `features/steps/*`, `lib/steps.ts`
- Papierkorb: `apps/web/src/db/trash.ts`, `features/more/TrashPage.tsx`
- Scan: `features/foods/ScanPage.tsx`, `components/LabelCaptureSheet.tsx`
- Betrieb: `.github/workflows/docker.yml`, `README.md`, `deploy/.env.example`, `apps/api/build.mjs`

## Verifikation

- Je Block: `pnpm lint`, `pnpm typecheck` (sequenziell), `pnpm test`; am Ende `pnpm e2e` (chromium; WebKit nur
  `ios-layout.spec.ts`).
- Zahlen (Block 2): die Fälle aus der Bestandsaufnahme als Unit-Tests (Z1 bis Z3, Z5 bis Z8), nicht als Skripte.
- Sync (Blöcke 5 und 6): Engine-Tests gegen die Test-API (embedded PostgreSQL) mit zwei Geräten: Restore-Szenario (T1
  der Bestandsaufnahme), JSON-Restore gegen neueren Server (T2), abgelehnter Datensatz (T3).
- KI (Block 3): API-Tests mit gemocktem Anthropic-Client (Budget, Fehlerzeile, Idempotenz, Timeout).
- Live im Browser (`pnpm --filter @ft/web build`, dann `WEB_DIST=… pnpm --filter @ft/api dev`, Login über die API,
  nicht über Vite): Barcode-Panel, Papierkorb leeren, Trainingsmenü, Sortieren per Maus, Schritte-Symbol (iOS-UA).
- Am iPhone (Nutzer): Liste in Abschnitt 4 der Bestandsaufnahme plus: Schritte-Symbol im Kartenkopf startet den
  Kurzbefehl und pulsiert bis zum Wert; Trainings sortieren per langem Druck; Barcode halb verdeckt → Panel statt
  Editor; Papierkorb leeren auf zwei Geräten (verschwindet auf beiden).

## Ablauf für Opus 5.5

1. Lesen: `CLAUDE.md`, diesen Plan, `docs/plans/2026-11-bestandsaufnahme.md` Abschnitt 2 (die Fundstellen zu jedem
   Punkt), `.claude/skills/offline-sync/SKILL.md` und `docs/sync.md` vor Block 5 bis 7, Skill `claude-api` vor Block 3.
2. Block 0, dann die Blöcke in der Reihenfolge 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13; Block 10 erst, wenn der Nutzer
   die Liste abgehakt hat (bei Unklarheit Block 10 ans Ende, nicht raten).
3. Ein Commit je Block (Nachricht englisch, Attributionszeile laut Session), davor lint, typecheck, test grün; E2E
   nach Block 9 und am Ende.
4. Abweichungen und neue Annahmen in den Statusblock des Repo-Plans schreiben und am Ende melden, nicht still
   entscheiden. Keine Erklärsätze im UI, keine Gedankenstriche.
5. Nicht pushen, bis der Nutzer es sagt. Migrationen (Block 3, 7) laufen beim nächsten Deploy.
