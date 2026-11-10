# Schritte aus Apple Health als Training

Implementierungsplan für die umsetzende Sitzung (Opus 5.5). Erste Handlung: diese Datei nach
`docs/plans/2026-11-schritte-apple-health.md` kopieren und dort den Statusblock pflegen. **Schritt 0 (Mockup)
wartet auf das „los" des Nutzers, vorher kein App-Code.**

## Status

Geplant am 2026-11-10 (Fable). Mockup v1 bis v3 am 2026-11-10 (Opus 5.5):
`docs/plans/2026-11-schritte-apple-health-mockup.html`, v3 am 2026-11-10 mit „los“ freigegeben. Umsetzung am
2026-11-10 (Opus 5.5), Blöcke 1 bis 6 je ein Commit, nicht gepusht. `pnpm lint`, `pnpm typecheck`, `pnpm test`
grün; E2E „steps from Apple Health“ grün; Sichtprüfung im Produktions-Build (iPhone 13, hell und dunkel).

Abweichungen und Ergänzungen bei der Umsetzung:

- `weightForDay` liegt in `forecast.ts` (neben `weightOn`), nicht in `exercise.ts`; `StepsStatus` in `schemas.ts`.
- Die Verbrauchsschätzung aus eigenen Daten zieht Schritte nur ab, solange sie angerechnet werden (sonst gehören
  sie zur Alltagsbewegung, die die Schätzung schon enthält). Trainings wie bisher immer.
- „Zugang ersetzen“ fragt in einem Dialog nach (der alte Zugang gilt sofort nicht mehr); im Mockup ohne Dialog.
- Löschen auf der Schritte-Seite: Dialog wie im Mockup, danach zusätzlich Rückgängig im Toast.
- Der Papierkorb zeigt den Abschnitt „Schritte“ nur, wenn es gelöschte Schritte gibt (kein leerer Abschnitt
  für alle, die den Import nicht nutzen).
- `share-day.spec.ts` ist nicht erweitert (der Test bräuchte einen Zugang); die Schritte-Zeile im Tagebild prüft
  ein Komponententest. `seed-demo.ts` hat keine Schritte bekommen.
- Das Feld „Eintragen ab“ zeigt „1000“ ohne Tausenderpunkt (Verhalten von `NumberField`).
- ↻ verlängert die 30 s, solange die App unsichtbar ist (der Kurzbefehl läuft), und synchronisiert am Ende
  auch dann einmal, wenn der Server den Abruf nicht gemeldet hat.
- Eine kcal-Änderung, die ein Gerät noch nicht hochgeladen hat, verliert gegen einen neueren Import
  (Last-Write-Wins, im E2E-Test gesehen). In der Praxis selten, weil die App 0,8 s nach einer Änderung hochlädt.

Nach der ersten Einrichtung am iPhone (2026-11-11, Nutzer):

- Typen heißen in der Auswahl „Steps“ und „Strecke (Gehen und Laufen)“; iOS verlangt Einstellungen → Kurzbefehle
  → Erweitert → „Teilen großer Datenmengen erlauben“. Beides steht in der Anleitung.
- Fügt man die zweite Health-Aktion direkt unter die erste, wird daraus „Steps filtern“ (Eingabe = Ergebnis der
  ersten Aktion), und es kommt keine Strecke an. Die Anleitung sagt das jetzt; die Antwort des Imports und
  „Letzte Abrufe“ (Migration `0014`, `api_tokens.recent`) zeigen fehlende oder unpassende Strecken als Hinweis.
- Mit „Gruppieren nach Tag“ und richtiger Strecke kommen plausible Werte an (0,7 bis 0,8 m je Schritt).

Nur am iPhone prüfbar (offen):

- Kurzbefehl nach der Anleitung auf Mehr → Schritte gegen `https://fleisch-teufel.avernus.cloud` bauen; die
  Antwort zeigt `{"ok":true,"days":[…]}`.
- An einem Tag mit Apple Watch: Wert für den Tag gleich der Health-App (Gruppieren nach Tag soll Uhr und iPhone
  nicht doppelt zählen).
- Datumsformat `yyyy-MM-dd` greift für alle drei Datumsfelder (sonst nimmt der Server auch „03/11/2026, 02:41“).
- Automation läuft ohne Nachfrage (bei gesperrtem iPhone liest Health nichts).
- ↻ aus der installierten PWA öffnet den Kurzbefehl, nach der Rückkehr dreht es, bis der Wert da ist. Öffnet
  `shortcuts://` aus der PWA nicht, ↻ ausblenden und nur „Jetzt abrufen“ in Safari lassen.

Entscheidungen nach v1 (Nutzer, 2026-11-10), gehen den Abschnitten unten vor:

- E1 (kein blauer Punkt für Schritte-Tage) und F1 (↻ nur an Zeile und Seite).
- Eigener Schalter „Schritte aufs Ziel anrechnen“ unter Mehr, unter „Training aufs Ziel anrechnen“:
  `settings.addStepsCalories` (boolean, `null` = an; Standard an, vom Nutzer bestätigt). Angerechnetes Training eines Tages = Trainings ohne
  Schritte, wenn `addExerciseCalories`, plus Schritte, wenn `addStepsCalories` (eine Funktion in shared für
  `kcalBudget`, Tagebuch, Prognose, Berichte). Ist nur der Schritte-Schalter aus, steht „nicht angerechnet“ an
  der Schritte-Zeile (Unterzeile), nicht am Kartenkopf.
- Farbe der Schritte: eigenes Grün (`--steps`, Fuß-Symbol und kcal der Zeile; hell `oklch(0.52 0.13 155)`,
  dunkel `oklch(0.74 0.13 155)`), Trainings bleiben blau. Entschieden.
- Strecke in km (Einheit der Aktion „km“, Anzeige „6,1 km“).
- Kein iCloud-Link (Nutzer, nach v2): Mehr → Schritte zeigt Zugang und Adresse zum Kopieren und darunter die
  Anleitung als nummerierte Liste (Aktionen des Kurzbefehls mit Gruppieren nach Tag, Einheit Anzahl bzw. km,
  Datumsformat `yyyy-MM-dd`, Name, Automation „Tageszeit“), offen bis eingerichtet, dann zugeklappt.
- Apple Watch wird manchmal getragen: „Gruppieren nach Tag“ soll die Tagessumme wie die Health-App bilden
  (keine Doppelzählung). Unbestätigt, gehört in die Liste „Nur am iPhone prüfbar“ (Tag mit Uhr gegen die
  Health-App).
- iPhone-Probe: ungruppiert viele Messungen je Tag, Datum im Format des Geräts („03/11/2026, 02:41“, keine
  Zeitzone). Der Kurzbefehl gruppiert nach Tag und formatiert die Daten als `yyyy-MM-dd` (auch `now`). Der
  Parser nimmt `yyyy-MM-dd…` (die ersten zehn Zeichen) und zur Sicherheit `dd/MM/yyyy[, HH:mm]` und
  `dd.MM.yyyy[, HH:mm]`; ohne Zeitzone gilt das Datum, wie es da steht. Mit `now` als reinem Tag gilt „heute“ =
  dieser Tag.

## Context

Der Nutzer möchte die Schritte aus Apple Health im Tagebuch haben, als Training mit kcal. Eine PWA darf
HealthKit nicht lesen. Der Weg: ein iOS-Kurzbefehl liest Schritte und Geh-/Laufstrecke aus Health und schickt
sie mit einem persönlichen Zugang an die API. Der Server macht daraus **einen Trainingseintrag pro Tag**, den
alle Geräte über den normalen Sync bekommen.

Vom Nutzer entschieden:

- Kurzbefehl (kein nativer Wrapper, kein Health-Export).
- Der Abruf darf beliebig oft laufen, ohne dass etwas doppelt oder kaputt geht.
- Schritte werden als Training eingetragen (zählen wie jedes Training, Einstellung „anrechnen" gilt).
- kcal rechnet die App selbst (Health hat keine kcal für Schritte, „Aktivitätsenergie" würde Trainings doppelt zählen).
- Ein Eintrag entsteht erst ab einer Grenze, die in den Einstellungen wählbar ist.
- Am Schritte-Eintrag gibt es einen Knopf, der den Abruf selbst anstößt.

Von mir festgelegt (im Mockup zeigen, der Nutzer kann dort widersprechen):

- Schritte-Tage bekommen **keinen** blauen Punkt im Wochenstreifen (sonst hätte ihn jeder Tag).
- Schritte tauchen nicht in „Zuletzt & häufig", „Kürzlich", „Wie gestern" und der Zwischenablage auf.
- Ein gelöschter Schritte-Eintrag bleibt gelöscht, auch beim nächsten Abruf. Zurück kommt er über den
  Papierkorb (`/settings/trash`), danach aktualisiert ihn der nächste Abruf wieder.
- Der Zugang gilt nur für den Schritte-Import (kein Vollzugriff aufs Konto) und überlebt einen Passwortwechsel.

## Datenmodell

`exerciseEntries` bekommt zwei Felder, `.nullable().default(null)`: `steps` (int, 0 bis 200 000) und
`distanceM` (0 bis 300 000). Ein Schritte-Eintrag:

| Feld                | Wert                                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `id`                | `s:<date>` (`dayId.steps`, in `requiredId` erzwungen, wenn `typeKey === 'steps'`)                                     |
| `typeKey` / `name`  | `'steps'` / `'Schritte'` (nicht in `EXERCISE_TYPES`, also nicht in der Suche)                                         |
| `minutes`           | Strecke bei 4,8 km/h: `round(distanceM / 80)`, begrenzt auf 1 bis 1440. Ohne brauchbare Strecke: `round(steps / 100)` |
| `met` / `intensity` | 3,5 / `'moderate'`                                                                                                    |
| `weightKg`          | Gewicht des Tages (`weightOn`, sonst frühestes Gewicht, sonst `DEFAULT_WEIGHT_KG`)                                    |
| `kcal`              | `trainingKcal(3.5, weightKg, minutes)`, also netto wie jedes Training (rund 0,52 kcal je kg und km)                   |

Damit erkennt das vorhandene `isAutoTrainingKcal` getippte kcal ohne neues Flag. Die Strecke gilt als
brauchbar, wenn `distanceM / steps` zwischen 0,3 und 1,5 m liegt.

Neu in `settings` (synchronisiert): `stepsMinimum` (int 0 bis 100 000, `null` = 1 000).

Neue Servertabelle `api_tokens` (nicht synchronisiert): `id` (sha256 des Tokens), `userId` (FK, cascade),
`kind` (`'steps'`), `createdAt`, `lastUsedAt`. Ein Zugang je Nutzer und Art, Ersetzen löscht den alten.

Eine Migration `0013` (`pnpm --filter @ft/api db:generate --name steps`). Kein Dexie-Versionssprung (keine neuen
Indizes). Alte App-Versionen behalten unbekannte Felder beim Speichern (geprüft: `write.ts`, `saveExercise`,
`saveSettings` spreizen den alten Datensatz); nur `restoreBackup` einer alten Version würde sie leeren.

## API

Neue Datei `apps/api/src/routes/steps.ts`, eingehängt in `app.ts` vor dem Catch-all.

- `GET /api/steps/status` (Sitzung): `{ configured, createdAt, lastUsedAt }`.
- `POST /api/steps/token` (Sitzung): legt den Zugang an oder ersetzt ihn, gibt das Token **einmal** zurück
  (Erzeugung wie `createSession` in `auth/session.ts`, `sha256` dort exportieren).
- `DELETE /api/steps/token` (Sitzung).
- `POST /api/steps/import` (eigene Middleware `requireApiToken`, sucht nur in `api_tokens`; ein Sitzungs-Token
  wird hier abgelehnt, ein API-Token auf allen anderen Routen ebenso). `RateLimiter` (`rate-limit.ts`) je Token
  und je IP bei falschem Token, Muster `routes/auth.ts`. Die Origin-Prüfung in `app.ts` greift nur mit
  `Origin`-Header, der Kurzbefehl schickt keinen.

**Körper des Imports** (tolerant, weil Kurzbefehle Listen als Text liefern):

```json
{
  "stepDates": "…",
  "stepValues": "…",
  "distanceDates": "…",
  "distanceValues": "…",
  "now": "2026-11-10T14:02:11+01:00"
}
```

Jede Liste ist ein Array oder ein Text mit einer Zeile je Messung (höchstens 20 000 Zeilen). Werte: führende
Zahl, Komma als Dezimalzeichen, Einheit am Ende (`km`, `m`, `mi`; ohne Einheit km). Daten: ISO 8601 mit Offset,
der Tag sind die ersten zehn Zeichen (Ortszeit des iPhones). Ungleich lange Listen geben 400 mit Klartext.

**Regeln** (alles in einer Transaktion unter der Nutzersperre):

1. Je Tag summieren. Nur Tage in `[heute − 6, heute]` zählen, `heute` aus `now` (der älteste Tag eines
   7-Tage-Fensters ist angeschnitten und würde einen richtigen Wert verkleinern). Ohne `now`: ältesten Tag weglassen.
2. Kein Eintrag vorhanden und Summe unter `stepsMinimum`: nichts. Vorhandene Einträge werden immer aktualisiert.
3. Tombstone vorhanden: nichts.
4. Lebender Eintrag: `steps`, `distanceM`, `minutes` neu. kcal und `weightKg` nur, wenn der Eintrag
   `isAutoTrainingKcal` ist (getippte kcal bleiben). Notiz bleibt.
5. Ändert sich nichts, wird nichts geschrieben (kein neuer `changeSeq`).
6. Geschrieben wird über das vorhandene `push()` (`sync/service.ts`) mit
   `updatedAt = nextVersion(existing?.updatedAt, now)` (ein Gerät darf bis 5 Minuten vorgehen, schlichtes
   `Date.now()` käme als `stale` zurück). `stale` oder `rejected` nicht leer ist ein Fehler (500, Log).
7. `lastUsedAt` setzen. Antwort `{ ok: true, days: [{ date, steps, written }] }`.

Dafür in `sync/service.ts`: erster Parameter von `push` auf `Pick<Db, 'transaction'>` weiten und `lockUser(tx,
userId)` exportieren. Der Import öffnet `db.transaction`, sperrt, liest die sieben Einträge, die Einstellungen
und die Gewichte, rechnet und ruft `push(tx, …)` (Savepoint, die Sperre ist wiedereintrittsfähig).

## Kurzbefehl (baut der Nutzer einmal, Name fest „Fleisch-Teufel Schritte")

0. Einmalig: Einstellungen → Kurzbefehle → Erweitert → „Teilen großer Datenmengen erlauben" (Nutzer, 2026-11-10).
1. Health-Messungen suchen: Typ „Steps" (so heißt er in der Auswahl), Startdatum „in den letzten 7 Tagen".
2. Health-Messungen suchen: Typ „Strecke (Gehen und Laufen)", gleiches Fenster.
3. Inhalte von URL abrufen: `POST https://<host>/api/steps/import`, Header `Authorization: Bearer <Token>`,
   JSON mit Startdatum (ISO 8601) und Wert beider Ergebnisse und „Aktuelles Datum" (ISO 8601).

Automation „Tageszeit" (mehrere Zeiten möglich), „Sofort ausführen". Die App startet ihn mit
`shortcuts://run-shortcut?name=Fleisch-Teufel%20Schritte`.

## Schritt 0: Mockup und iPhone-Probe (vor jedem Code)

**0a Mockup** `docs/plans/2026-11-schritte-apple-health-mockup.html`: von Grund auf konzipiert (nicht das
heutige Layout umbauen), Telefonrahmen, hell und dunkel, Versionsvermerk „Neu gegenüber vX", Kasten
„Entschieden" und Kasten „Offen". Token und Bausteine der App verwenden (`--exercise` blau, Zeilenhöhen,
`Section`, `Badge`). Keine Erklärtexte im UI (Regel vom 2026-11-06), Zustände zeigen.

| Abschnitt             | Inhalt                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A Tagebuch            | Trainingskarte mit Schritte-Zeile: Titel „8.432 Schritte", darunter „6,1 km", rechts „+310", Knopf ↻. Zustände: mit weiteren Trainings (Schritte stehen zuerst), nur Schritte (Chips „Zuletzt & häufig" bleiben, „Wie gestern" bleibt möglich), ↻ läuft, getippte kcal (Marke wie beim Training), „nicht angerechnet", Tag unter der Grenze (keine Zeile). Wischen links löscht mit Rückgängig, kein Wischen rechts.                                        |
| B Schritte-Seite      | `/steps/$date`: Schritte und Strecke als Daten, kcal-Feld wie `TrainingKcal` (eigener Wert markiert, „Berechneten Wert verwenden (N kcal)"), „Zuletzt empfangen …", ↻, Papierkorb, Fuß „Änderungen übernehmen". Keine Dauer, keine Intensität, kein Speichern-Icon.                                                                                                                                                                                         |
| C Mehr → Schritte     | Drei Zustände: nicht eingerichtet („Zugang erstellen"), Token einmal sichtbar mit „Kopieren" und der Adresse, eingerichtet („Zuletzt empfangen: heute, 14:02", „Jetzt abrufen", „Zugang ersetzen", „Zugang löschen" mit Dialog zur Folge). Feld „Eintragen ab" (Schritte, `NumberField`). Die Aktionen des Kurzbefehls als nummerierte Liste (vom System erzwungene Schritte, wie die iOS-Installation). Auf Geräten ohne iOS fehlen ↻ und „Jetzt abrufen". |
| D Papierkorb          | Gelöschte Schritte-Einträge als Zeilen („Schritte · Mo., 9. Nov. · 8.432"), Wiederherstellen.                                                                                                                                                                                                                                                                                                                                                               |
| E Varianten           | E1 kein blauer Punkt für reine Schritte-Tage (Empfehlung) gegen E2 mit Punkt. F1 ↻ nur an der Zeile und auf der Seite (Empfehlung) gegen F2 zusätzlich ein Chip „Schritte abrufen" an Tagen ohne Zeile.                                                                                                                                                                                                                                                     |
| G Tagesbild, Berichte | Schritte-Zeile im geteilten Tagesbild. Berichte: kcal zählen mit, die „Trainingszeit" ohne Schritte.                                                                                                                                                                                                                                                                                                                                                        |

**0b iPhone-Probe** (der Nutzer, Anleitung steht im Mockup unter „Kurzbefehl"): Aktion 1 allein bauen, Ergebnis
ansehen und melden: (1) Stimmt die Tagessumme mit der Health-App überein, oder ist sie doppelt (iPhone plus
Watch)? Bei doppelt bekommt Aktion 1 einen Filter auf die Quelle oder „Gruppieren nach Tag", und die Anleitung
nennt ihn. (2) Wie sehen Datum und Wert im Text aus? Der Parser muss beide Formen in einem Test abdecken.

Der Nutzer gibt das Mockup mit „los" frei. Danach die Blöcke ohne Rückfragen.

## Blöcke (ein Commit je Block; `pnpm lint`, `pnpm typecheck`, `pnpm test` je Block)

**1 Shared und Schema.** `packages/shared/src/schemas.ts` (`steps`, `distanceM`, `stepsMinimum`, `dayId.steps`,
`requiredId`), `exercise.ts`: `STEPS_TYPE_KEY`, `STEPS_MET`, `DEFAULT_STEPS_MINIMUM`, `isStepsEntry(e)` (auf
`typeKey`), `stepsValues({ steps, distanceM, weightKg })` → `{ minutes, kcal, distanceM }`, `weightForDay(points,
date)` (die Rückfallkette aus `apps/web/src/hooks/data.ts:93` hierher ziehen, Web nutzt sie dann). API-Schema
`apps/api/src/db/schema.ts` (Spalten, `api_tokens`), Migration `0013`. `TrainingToLog` (`apps/web/src/db/
entries.ts:158`): die neuen Felder ins `Omit`, `saveExercise`/`logTrainings` füllen `null`.
`DEFAULT_SETTINGS.stepsMinimum = null`. Tests: `packages/shared/test/exercise.test.ts`,
`apps/api/test/sync.test.ts` (Round-Trip, falsche Id für `typeKey: 'steps'` wird abgelehnt).

**2 API.** Abschnitt „API" oben. Parser und Tagesbildung als reine Funktionen in `apps/api/src/steps/parse.ts`
und `steps/import.ts` (ohne Hono, direkt testbar). Tests `apps/api/test/steps.test.ts` (Muster `push.test.ts`):
Zugang anlegen, ersetzen, löschen; Sitzungs-Token am Import und API-Token an `/api/sync/pull` abgelehnt; ohne
`Origin`; zweiter gleicher Import lässt `change_seq` stehen; Grenze; Fenster und Offset; Text- und
Array-Listen, Komma, Einheiten; getippte kcal bleiben; neues Gewicht rechnet neu; Tombstone bleibt; gespeichertes
`updatedAt` vor der Serveruhr. `apps/api/test/device-sync.test.ts`: Import, Gerät zieht, Gerät tippt kcal,
nächster Import lässt sie stehen.

**3 Web, Schritte heraushalten.** Überall `isStepsEntry`:
`hooks/data.ts:146` (`useTrainedDates`), `db/trainingSuggestions.ts:97` (ein Filter deckt Vorschläge, `last`,
`stats`), `db/clipboard.ts:101,139` (`trainingParts`, `copiesOf`), `ExerciseCard.tsx:76` („Wie gestern"),
`packages/shared/src/reports.ts:75` (`exerciseMinutes` ohne Schritte), `SportPage.tsx` nach `:62` (ein
Schritte-Eintrag auf `/exercise-entry/$id` leitet auf die Schritte-Seite um). kcal-Summen bleiben mit Schritten
(`diary.ts:123`, `reports.ts:71`, `expenditure.ts:74`, Kopf der Karte). Tests:
`apps/web/test/trainingSuggestions.test.ts`, `trainingClipboard.test.ts`, `week-strip.test.tsx`,
`packages/shared/test/goals-diary.test.ts`.

**4 Web, Zeile und Seite.** `ExerciseCard.tsx`: Schritte vor `groupTrainingEntries` abtrennen, eigene Zeile
`StepsRow` mit `StepsRowBody` (auch im Tagesbild, `share/DayShareImage.tsx:78`), ohne `onCopy`. Leerer Zustand
und Chips richten sich nach den Trainings ohne Schritte. Neue Route `/steps/$date` in `app/router.tsx`, Seite
`features/exercise/StepsPage.tsx` (lädt, dann Formular mit `initial` und `key`; kcal über `patchRecord`,
Löschen mit `goBackOr`, `useSubmitting`). CSV `features/reports/export.ts:134`: Spalten „Schritte" und
„Distanz (m)" am Ende. Papierkorb `db/trash.ts` und `/settings/trash`: gelöschte Schritte-Einträge,
`restoreRecord`.

**5 Web, Einrichtung und ↻.** `features/more/StepsSettingsPage.tsx` (Route `/settings/steps`, Zeile in
`MorePage.tsx` bei „Erinnerung"), API-Hülle `lib/steps.ts` (Muster `lib/reminder.ts`): Status, Zugang erstellen
(Token nur im Zustand der Seite, nie gespeichert), ersetzen, löschen, „Eintragen ab" über `saveSettings(db, {
stepsMinimum })`. ↻ (`lib/steps.ts` `runStepsShortcut`): merkt die Zeit des Tipps, öffnet den
`shortcuts://`-Link; sobald die App wieder sichtbar ist, fragt sie `GET /api/steps/status` alle 2 s bis höchstens
30 s, bis `lastUsedAt` nach dem Tipp liegt, dann einmal `useSession().sync.sync()`. Solange dreht ↻ (kein
`setState` im Effekt, Zustand in einem kleinen Store wie beim `SyncIndicator`). ↻ nur auf iOS und nur mit
eingerichtetem Zugang (Status in `kv` gemerkt, damit die Zeile offline nicht springt).

**6 Doku und E2E.** `CLAUDE.md` (Abschnitt Schritte), `README.md`, `docs/sync.md` (Server schreibt
synchronisierte Datensätze, `s:<date>`), Statusblock mit Abweichungen und iPhone-Liste. E2E
`apps/web/e2e/diary-training.spec.ts`: Import per Request mit Token, Zeile erscheint nach Sync, kcal tippen,
zweiter Import lässt sie stehen; `share-day.spec.ts` mit Schritte-Zeile. Optional `seed-demo.ts`: `s:<date>`.

## Bekannte Grenzen (in den Statusblock übernehmen)

- Das Aktivitätslevel im Profil enthält Alltagsbewegung. Wer Schritte anrechnet, stellt es auf „sitzend",
  sonst zählt Gehen doppelt. Die App ändert das nicht selbst und sagt es nicht an.
- Schritte eines getrennt eingetragenen Laufs stecken auch in der Tagessumme von Health.
- Health ist bei gesperrtem iPhone nicht lesbar: die Automation braucht eine Zeit, zu der das Gerät entsperrt ist.
- Nach ↻ kehrt iOS nicht von selbst in die App zurück.

## Nicht im Umfang

Schritte-Ziel, Schritte-Diagramm, andere Health-Werte (Gewicht, Workouts), Android/Health Connect, ein
fertiger iCloud-Link zum Kurzbefehl (kann der Nutzer nach dem Bauen selbst teilen).

## Verifikation

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm e2e` grün.
- Von Hand gegen `pnpm dev`: Zugang auf der Seite erstellen, Import mit `curl` (Text-Listen wie vom iPhone,
  zweimal hintereinander, dann mit höheren Werten), Tagebuch auf zwei Browserprofilen prüfen (ein Eintrag je
  Tag, kcal, getippte kcal bleiben, gelöscht bleibt gelöscht, Papierkorb holt zurück).
- Sichtprüfung im Produktions-Build neben dem Mockup (iPhone 13, hell und dunkel, Skript und Proxy wie in der
  Memory „Dev-Proxy-Login").
- **Nur am iPhone prüfbar** (Liste für den Nutzer): Kurzbefehl gegen die echte Adresse, Summe gleich der
  Health-App, Automation ohne Nachfrage, `shortcuts://` aus der installierten PWA (öffnet es nicht, ↻
  ausblenden und nur „Jetzt abrufen" in Safari belassen: als Abweichung melden), ↻ dreht bis der Wert da ist.

## Ablauf für Opus 5.5

1. Lesen: dieser Plan, `CLAUDE.md`, `.claude/skills/offline-sync/SKILL.md`, `docs/sync.md`,
   `docs/plans/2026-11-trainings-neu-mockup.html` (Stil der Mockups), `ExerciseCard.tsx`, `sync/service.ts`.
2. Plan nach `docs/plans/` kopieren. Schritt 0a bauen, dem Nutzer die Datei nennen (SMB) und auf „los" warten.
   Änderungswünsche als neue Mockup-Version, Entscheidungen in den Kasten „Entschieden" und in diesen Plan.
3. Blöcke 1 bis 6 in dieser Reihenfolge, ein Commit je Block, Prüfungen je Block. Nicht pushen.
4. Abweichungen nicht still entscheiden: in den Statusblock schreiben und am Ende berichten.
5. Texte: Deutsch im UI, Englisch in Code und Commits, keine Gedankenstriche, „eintragen"/„speichern" nach
   der Wortwahl in `CLAUDE.md`.
