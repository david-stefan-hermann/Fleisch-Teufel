# Bedarfsrechnung auf Evidenz umstellen (Umsetzungsplan)

Stand: 2026-11-15. Alle Entscheidungen sind getroffen, der Plan ist zur Umsetzung durch Opus geschrieben.

## Status (2026-11-15)

Umgesetzt von Opus 5.5, auf Wunsch des Nutzers gepusht und deployt:

- `194175a` Need calculation: four goals, protein without cap, fat floor, deficit cap
- `0768921` Settings: goalKind and macro preset gain (Migration `0019_goal_kind.sql`)
- `b595a09` Onboarding: goal cards, expenditure from own data first
- `32df642` Profile goal, expenditure range, one-time recalculation card
- Abschluss: E2E, `CLAUDE.md`, `README.md`, dieser Statusblock, Plan und Bericht

Geprüft: `pnpm lint`, `pnpm typecheck`, `pnpm test` (shared 136, web 380, api 243), `pnpm e2e` (52).
Screenshots (hell und dunkel) von Zielschritt, Ergebnis, Profil, Verbrauchskarte und der Karte "Neue
Bedarfsrechnung" gemacht. Die Demo-Daten (`seed:demo`) ergeben "Daten nicht schlüssig", die Spanne "± N" der
Verbrauchskarte ist deshalb nur durch Tests belegt. Abweichung vom Plan: `saveOnboarding` rechnet
`weeklyRateKg` selbst aus `goalKind` und Gewicht (das Profil übergibt nur `goalKind`).

Grundlage: `docs/research/2026-11-kalorien-makrobedarf.md` (Bericht mit Quellen, am 2026-11-15 Zitat für
Zitat gegengeprüft, Abschnitt "Quellenprüfung"), Rohnotizen in `docs/research/notizen/`.

## Vor dem Start lesen

- `CLAUDE.md` (Regeln: keine Erklärtexte im UI, keine Gedankenstriche, `useSubmitting`, `saveSettings`).
- `.claude/skills/offline-sync/SKILL.md` und `docs/sync.md` (ein neues Feld und ein neuer Enum-Wert in
  `settings`).
- Code: `packages/shared/src/tdee.ts`, `expenditure.ts`, `forecast.ts` (`linearTrend`), `schemas.ts`;
  `apps/web/src/features/goals/*`, `components/MacroPlanPicker.tsx`, `features/more/ProfilePage.tsx`,
  `features/progress/ExpenditureCard.tsx`, `hooks/useExpenditure.ts`, `features/day/CompleteDayPage.tsx`,
  `features/diary/WeekReviewCard.tsx` (Muster für eine Karte im Tagebuch, die man wegklickt).

## Was sich fachlich ändert

| Baustein                    | Heute                                          | Neu                                                                   |
| --------------------------- | ---------------------------------------------- | --------------------------------------------------------------------- |
| Grundumsatz                 | Mifflin-St Jeor                                | bleibt                                                                |
| Aktivitätsfaktoren          | 1,2 / 1,375 / 1,55 / 1,725 / 1,9               | bleiben, nur der Kommentar nennt den Grund                            |
| Training, Schritte          | netto, getrennt angerechnet                    | bleibt, kein Schritte-Sockel                                          |
| Ziel                        | freies Tempo in kg pro Woche (−1 bis +0,5)     | vier Ziele mit festem Tempo in % des Körpergewichts                   |
| Grenzen                     | Untergrenze 1500 / 1200 kcal                   | zusätzlich Defizit höchstens 25 % des Verbrauchs                      |
| Eiweiß                      | 1,0 bis 2,0 g/kg, Deckel 35 % der Energie      | 2,0 bis 2,2 g/kg Körpergewicht, kein Deckel                           |
| Fett                        | Anteil der Energie                             | Anteil, mindestens 0,5 g/kg Körpergewicht                             |
| Kohlenhydrate               | Rest                                           | bleibt                                                                |
| Verbrauch aus eigenen Daten | 21 Tage, 4 Wiegungen über 10 Tage, Zusatzkarte | 28 Tage, 6 Wiegungen über 14 Tage, mit Spanne, Vorrang vor der Formel |

### Die vier Ziele

| `goalKind`      | Name im UI       | Zweite Zeile                | Tempo pro Woche | Vorlage        | Eiweiß   | Fett |
| --------------- | ---------------- | --------------------------- | --------------- | -------------- | -------- | ---- |
| `lose`          | Abnehmen         |                             | −0,5 %          | `cut`          | 2,2 g/kg | 25 % |
| `maintain`      | Gewicht halten   |                             | 0               | `high_protein` | 2,0 g/kg | 30 % |
| `gain_beginner` | Muskeln aufbauen | Unter 2 Jahre Krafttraining | +0,25 %         | `gain`         | 2,0 g/kg | 25 % |
| `gain_advanced` | Muskeln aufbauen | Ab 2 Jahren Krafttraining   | +0,1 %          | `gain`         | 2,0 g/kg | 25 % |

- Eiweiß und Fettboden rechnen immer mit dem aktuellen Körpergewicht. Kein Bezugsgewicht, kein BMI-Deckel
  (Entscheidung des Nutzers, dritte Runde).
- Keine Tempo-Stufen. Wer abweichen will, ändert die Kalorien und Gramm von Hand im Ergebnis oder im
  Ziel-Editor.
- Jedes Ziel rechnet für Muskelaufbau oder Muskelerhalt, deshalb ist `balanced` (1,0 g/kg) für kein Ziel die
  Vorauswahl, bleibt aber wählbar.

Begründung der Zahlen (für die Kommentare an den Konstanten, Autor und Jahr wie heute bei Mifflin):

- Eiweiß: 1,6 g/kg ist die gut belegte Untergrenze, bis 2,2 reichen Konfidenzintervall und Empfehlung von
  Morton 2018; Iraki 2019 und Stokes 2018 nennen 1,6 bis 2,2. Im Defizit steigt der Bedarf (Helms 2014,
  ISSN: 2,3 bis 3,1 g/kg fettfreie Masse).
- Tempo: −0,5 % ist das untere Ende von 0,5 bis 1,0 % (Helms 2014, Garthe 2011). +0,25 % ist Irakis unteres
  Ende für Anfänger. +0,1 % und die Grenze von 2 Jahren sind Konvention (ACSM 2009, MacroFactor), keine
  gemessene Schwelle.
- Aktivitätsfaktoren: Die PAL-Werte von DGE und FAO (ab 1,4) beschreiben den wahren Verbrauch. Ein Ziel in
  der App wird aber gegen selbst erfasste Kalorien gehalten, und die liegen im Mittel zu niedrig (Subar 2003:
  12 bis 20 % im 24-Stunden-Protokoll). Die Daten des Nutzers (39 Tage, Verbrauch rund 2150 kcal bei
  Grundumsatz 1793) passen zu 1,2, nicht zu 1,4. Das ist eine eigene Ableitung, keine Aussage einer Quelle;
  der Kommentar sagt das so.
- Fettboden 0,5 g/kg: untere Grenze aus Iraki 2019 und Helms 2014 (0,5 bis 1,5 g/kg).
- Defizitgrenze 25 %: eigene Vorsichtsgrenze aus den Übersichten zu Muskelverlust bei großen Defiziten
  (Murphy 2021: ab etwa 500 kcal Defizit leidet der Zuwachs), keine genormte Zahl.

### Kontrollrechnung (als Test übernehmen)

Mann, 80 kg, 178 cm, Verbrauch 2150 kcal:

| Ziel            | kcal | Eiweiß | Fett | Kohlenhydrate | `weeklyRateKg` |
| --------------- | ---- | ------ | ---- | ------------- | -------------- |
| `lose`          | 1710 | 176 g  | 48 g | 145 g         | −0,4           |
| `maintain`      | 2150 | 160 g  | 72 g | 216 g         | 0              |
| `gain_beginner` | 2370 | 160 g  | 66 g | 284 g         | 0,2            |
| `gain_advanced` | 2240 | 160 g  | 62 g | 260 g         | 0,08           |

## Datenmodell

1. `settings.goalKind`: `z.enum(GOAL_KINDS).nullable().default(null)` in `settingsSchema`. `null` heißt:
   vor dem Update eingerichtet oder nie eingerichtet.
2. `apps/api/src/db/schema.ts`: Spalte `goalKind` (Text mit Enum, nullable), dann
   `pnpm --filter @ft/api db:generate --name goal_kind`, SQL committen.
3. `MACRO_PRESET_IDS` bekommt `gain` (vor `cut` einsortiert). Das weitet ein Enum: eine ältere App-Version
   kann einen Datensatz mit `gain` nicht lesen, überspringt ihn und merkt sich `sync.needsUpdate`; nach dem
   Update holt sie ihn nach. Das ist der vorgesehene Weg (Skill, "Pulled changes an older app cannot parse"),
   keine weitere Vorkehrung. Server und App kommen aus demselben Image, der Server kennt `gain` also immer
   zuerst.
4. `weeklyRateKg` bleibt, Grenzen unverändert (−1,5 bis 1). Es wird beim Einrichten aus Ziel und Gewicht
   berechnet (auf 0,01 kg gerundet) und bleibt der Wert, den ältere Versionen lesen.
5. `apps/web/src/db/settings.ts` (`DEFAULT_SETTINGS`): `goalKind: null`. `apps/api/scripts/seed-demo.ts`:
   `goalKind: 'lose'`, `weeklyRateKg` passend zum Demo-Gewicht.
6. Kein Dexie-Versionssprung (kein neuer Index).

## Schritt 1: `packages/shared`

### `tdee.ts`

- `GOAL_KINDS = ['lose', 'maintain', 'gain_beginner', 'gain_advanced'] as const`, `type GoalKind`.
- `GOALS: Record<GoalKind, { ratePct: number; preset: MacroPreset['id'] }>` mit den Werten der Tabelle,
  `GOAL_LABELS_DE: Record<GoalKind, { title: string; hint: string | null }>` (Zweite Zeile wie oben).
- `weeklyRateForGoal(kind, weightKg)`: `ratePct / 100 × weightKg`, auf 0,01 gerundet.
- `goalKindOf(settings)`: der gespeicherte Wert, sonst aus dem Vorzeichen von `weeklyRateKg`
  (negativ `lose`, 0 `maintain`, positiv `gain_beginner`).
- `currentWeeklyRate(settings, weightKg)`: mit `goalKind` und Gewicht `weeklyRateForGoal`, sonst das
  gespeicherte `weeklyRateKg`. So folgt das Tempo dem Gewicht, ohne dass etwas neu gespeichert wird.
- `WEEKLY_RATES` entfällt.
- Eine gemeinsame Funktion für das Kalorienziel, die `calorieGoal` und `targetFromExpenditure` beide nutzen:
  `kcalTarget(expenditureKcal, weeklyRateKg, { sex, bmi })` gibt `{ kcal, clamped }` zurück mit
  `clamped: 'deficit' | 'minimum' | null`. Reihenfolge: roh = Verbrauch + Tagesdifferenz; Defizit höchstens
  `MAX_DEFICIT_SHARE` = 0,25 des Verbrauchs (ab BMI 30: 0,30; ohne BMI 0,25); danach die Untergrenze
  `MIN_KCAL`; auf 10 gerundet. Greifen beide, gilt `minimum`.
- `calorieGoal(p, activity, weeklyRateKg, opts?: { expenditureKcal?: number | null })`: mit
  `expenditureKcal` ist das der Verbrauch statt Grundumsatz × Faktor. Das Ergebnis bekommt
  `source: 'data' | 'formula'`, `clamped` wird vom Boolean zum Wert oben. `tdee` im Ergebnis ist der
  verwendete Verbrauch.
- `defaultMacros`:
  - Deckel `kcal × 0,35` entfernen. Eiweiß = `proteinPerKg × weightKg`.
  - `FAT_FLOOR_PER_KG = 0.5`: Fett = das Größere aus Anteil und Boden (auch im Zweig `carbsPct`, dort ist
    Fett der Rest und der Boden greift nur selten).
  - Kohlenhydrate sind der Rest, mindestens 0. Die Rückgabe bleibt `MacroGrams` ohne neue Felder (sie wird
    in `GoalsPage` in ein `DayTarget` gespreizt).
  - Standard `proteinPerKg` 2,0 statt 1,8, Kommentar anpassen.
- `macrosExceedKcal(kcal, weightKg, plan)`: wahr, wenn Eiweiß plus Fett (nach Boden) mehr als `kcal`
  ergeben. Für das Badge im Makro-Block.
- `MACRO_PRESETS` (Reihenfolge so, `hint` nennt nur Werte, keine Wirkung):

  | ID             | Name                | Hinweiszeile                         | Eiweiß | Fett | KH  |
  | -------------- | ------------------- | ------------------------------------ | ------ | ---- | --- |
  | `high_protein` | Proteinreich        | 2,0 g Eiweiß/kg · 30 % Fett          | 2,0    | 30   |     |
  | `cut`          | Diät / Muskelerhalt | 2,2 g Eiweiß/kg · 25 % Fett          | 2,2    | 25   |     |
  | `gain`         | Muskelaufbau        | 2,0 g Eiweiß/kg · 25 % Fett          | 2,0    | 25   |     |
  | `low_carb`     | Low Carb            | 2,0 g Eiweiß/kg · 20 % Kohlenhydrate | 2,0    |      | 20  |
  | `balanced`     | Ausgewogen          | 1,0 g Eiweiß/kg · 30 % Fett          | 1,0    | 30   |     |

- `DEFAULT_MACRO_PLAN`: `high_protein` mit 2,0. Ein gespeicherter Plan behält seine Zahlen (er trägt
  `proteinPerKg` selbst), nur neue Auswahl nimmt die neuen Werte.
- Kommentar an `ACTIVITY_FACTORS` wie oben begründet. `ACTIVITY_LABELS_DE` bleibt.

### `expenditure.ts` und `forecast.ts`

- `EXPENDITURE_WINDOW_DAYS = 28`, `EXPENDITURE_MIN_WEIGH_INS = 6`, `EXPENDITURE_MIN_WEIGH_SPAN_DAYS = 14`,
  `EXPENDITURE_MIN_DAYS` bleibt 14. Kommentar: unter etwa 28 Tagen ist die Unsicherheit größer als 300 kcal
  (Bericht, Abschnitt zum Verbrauch aus eigenen Daten).
- `linearTrend` liefert zusätzlich den Standardfehler der Steigung (`slopeSePerDay`, 0 bei zwei Punkten;
  bestehende Aufrufer bleiben unberührt).
- `ExpenditureEstimate`: neues Feld `uncertaintyKcal` = Wurzel aus
  (`slopeSePerDay × 7700`)² + (Standardabweichung der Tageszufuhr / √Tage)², auf 10 gerundet. `confidence`
  entfällt.
- `targetFromExpenditure(expenditureKcal, weeklyRateKg, { sex, bmi })` ruft `kcalTarget` und gibt weiter
  nur die Zahl zurück. Aufrufer anpassen.
- `index.ts`: neue Exporte prüfen.

### Tests (`packages/shared/test`)

- `tdee.test.ts`, `macro-presets.test.ts`: die beiden Fälle "caps protein at 35 %" ersetzen durch "kein
  Deckel", Fettboden (60 kg, 1200 kcal, 25 %: 33 g Anteil gegen 30 g Boden; 100 kg, 1500 kcal: Boden 50 g
  greift), `macrosExceedKcal`, Vorlagenwerte.
- Neu: die Kontrollrechnung oben für alle vier Ziele, `weeklyRateForGoal`, `goalKindOf`, `kcalTarget` mit
  beiden Grenzen (Defizit 25 %, ab BMI 30 30 %, Untergrenze, beide zugleich).
- `expenditure.test.ts`: neue Mindestwerte, `uncertaintyKcal` (glatter Trend klein, streuender Trend
  groß), `confidence` raus.
- `tdee-profile.test.ts`: `calorieGoal` mit `expenditureKcal`.

Commit: `Need calculation: four goals, protein without cap, fat floor, deficit cap`.

## Schritt 2: Sync und API

- Schema und Migration wie unter "Datenmodell".
- `apps/api/test/sync.test.ts`: Round-Trip der Einstellungen mit `goalKind` und `macroPlan.preset: 'gain'`;
  ein Datensatz ohne `goalKind` (ältere App) wird angenommen und kommt mit `null` zurück.
- `apps/web/test/write.test.ts`: `saveOnboarding` schreibt `goalKind`; `saveSettings` mit anderen Feldern
  lässt es stehen.

Commit: `Settings: goalKind and macro preset gain`.

## Schritt 3: Einrichten (`OnboardingPage.tsx`, `saveOnboarding.ts`)

Schritte bleiben Profil, Aktivität, Ziel, Ergebnis.

- **Ziel:** statt der Tempo-Knöpfe vier Karten im Stil der Aktivitätskarten (`role="radio"`): Titel und
  zweite Zeile aus `GOAL_LABELS_DE`, rechts der berechnete Wert, zum Beispiel "−0,4 kg pro Woche · −440 kcal"
  (bei `maintain` "±0"). Startwert: `goalKindOf(settings)` bei bekanntem Profil, sonst `lose`.
  - Keine Sperre und kein Badge bei Untergewicht: alle vier Ziele sind immer wählbar (Entscheidung des
    Nutzers).
  - Zielgewicht bleibt optional. Die Dauer steht als Wert daneben: "frühestens in N Wochen" (nur wenn das Ziel
    in Richtung des Zielgewichts läuft). Die Sätze "Dieses Tempo führt vom Zielgewicht weg" und "Mehr als 1 %
    ..." entfallen; läuft das Ziel vom Zielgewicht weg, steht statt der Dauer `NO_VALUE`.
  - Das Tippen auf ein Zielgewicht wählt kein Ziel mehr automatisch um.
- **Vorlage:** Ein Tipp auf ein Ziel setzt die Vorlage des Ziels (`planFromPreset(GOALS[kind].preset)`).
  Beim Öffnen mit bekanntem Profil bleibt ein gespeicherter Plan `custom` oder `low_carb` erhalten, sonst
  gilt die Vorlage des Ziels.
- **Ergebnis:** `useExpenditure(today)` liefert die Schätzung aus eigenen Daten. Liegt sie vor, geht sie als
  `expenditureKcal` in `calorieGoal`; die mittlere Zahl heißt weiter "Gesamtumsatz" und trägt das Badge
  "aus deinen Daten", die Formelzeile darunter nennt dann beide ("Aus Essen und Gewichtstrend der letzten
  28 Tage · Formel 2150 kcal"). Ohne Schätzung bleibt die heutige Formelzeile.
  - `clamped` als Badge an der Zielzahl: "Defizit begrenzt" oder "Untergrenze". Der heutige Satz dazu
    entfällt.
- **Speichern:** `saveOnboarding` nimmt `goalKind` ins Profil, `weeklyRateKg` =
  `weeklyRateForGoal(kind, weight)`.

`MacroPlanPicker.tsx`:

- Der Absatz zum 35-%-Deckel entfällt ersatzlos.
- Greift `macrosExceedKcal`, trägt der Gramm-Block das Badge "Kalorienziel zu niedrig".
- Regler "Eigene": Eiweiß 0,8 bis 3,0 g/kg (heute 2,5).

Commit: `Onboarding: goal cards, expenditure from own data first`.

## Schritt 4: Profil, Verbrauchskarte, Angebot nach dem Update

- `ProfilePage.tsx`: Das Feld "Tempo/Woche" wird zu "Ziel" (Select mit den vier Zielen, Anfänger und
  Fortgeschritten als "Muskeln aufbauen · unter 2 Jahre" und "Muskeln aufbauen · ab 2 Jahren"). Gespeichert
  werden `goalKind` und das daraus berechnete `weeklyRateKg` (aktuelles Gewicht aus `useWeights`; ohne
  Gewicht bleibt `weeklyRateKg`). Anzeige bei `goalKind: null`: `goalKindOf`, ohne dass das schon als Änderung
  zählt. `profileFields` um `goalKind` ergänzen.
- `ExpenditureCard.tsx`:
  - Zahl mit Spanne: "2150 ± 120 kcal am Tag". Der Halbsatz zu `confidence` entfällt.
  - Vorschlag mit `currentWeeklyRate(settings, weightKg)` und `targetFromExpenditure(..., { sex, bmi })`.
  - Der Text ohne Schätzung nennt die neuen Mindestwerte aus den Konstanten ("in vier Wochen").
- `useExpenditure.ts`: nutzt die Konstanten schon, nur prüfen.
- `CompleteDayPage.tsx`: Ersatzwert ohne Profil mit `currentWeeklyRate`. Sonst unverändert (die Schätzung
  hat dort schon Vorrang).
- **Einmaliges Angebot "Ziel neu berechnen":** neue Karte `features/goals/RecalcGoalCard.tsx` im Tagebuch von
  heute, über den Mahlzeiten, nach dem Muster von `WeekReviewCard` (hat `WeekReviewCard` Vorrang, steht sie
  darunter).
  - Sichtbar, wenn `settings.onboardedAt !== null`, `settings.goalKind === null` und `kv`
    `goalRecalc.dismissed` nicht gesetzt ist.
  - Inhalt: Titel "Neue Bedarfsrechnung", darunter als Werte das heutige Ziel und das neu berechnete für
    `goalKindOf(settings)` ("1500 kcal · 140 g Eiweiß" und "1710 kcal · 176 g Eiweiß", nur wenn Profil und
    Gewicht da sind), Knopf "Ziel neu berechnen" (Link nach `/onboarding`), X.
  - X setzt `goalRecalc.dismissed` (nur dieses Gerät). Abgeschlossenes Einrichten setzt `goalKind`, damit
    verschwindet die Karte auf allen Geräten. Nichts ändert sich von selbst.
  - Kein erklärender Satz.

Commit: `Profile goal, expenditure range, one-time recalculation card`.

## Schritt 5: E2E, Doku, Abschluss

- E2E: alle Specs, die durch das Einrichten klicken (`smoke.spec.ts`, `meals-goals.spec.ts` und die Helfer
  der anderen Specs), auf die Zielkarten umstellen. Neuer Fall in `meals-goals.spec.ts`: Einrichten mit
  "Muskeln aufbauen, ab 2 Jahren" ergibt im Ergebnis die Vorlage "Muskelaufbau" und 2,0 g Eiweiß pro kg.
  Die Karte "Neue Bedarfsrechnung" erscheint bei frischen Konten nicht (sie haben `goalKind`).
- `CLAUDE.md`: ein Absatz "Bedarfsrechnung" (vier Ziele in `GOALS`, `goalKind` und `weeklyRateKg`,
  `kcalTarget` mit beiden Grenzen, Eiweiß ohne Deckel auf Körpergewicht, Fettboden, Schätzung aus eigenen
  Daten vor der Formel, Karte `RecalcGoalCard`, Quellen im Bericht). Den bestehenden Absatz "Expenditure from
  own data" an die neuen Fenster anpassen.
- `README.md`: Zeile "Onboarding" (vier Ziele statt Wochentempo, Vorlagen mit Muskelaufbau).
- Diesen Plan um einen Statusblock mit den Commits ergänzen.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm e2e`. Screenshots von Zielschritt, Ergebnis, Profil,
  Verbrauchskarte und der neuen Karte in hell und dunkel (eigenes Playwright-Skript über den Proxy :5174, der
  Login über Vite :5173 gibt 403).
- Nicht pushen, bis der Nutzer es sagt.

## Was bewusst nicht gebaut wird

- Körperfettanteil als Eingabe, Cunningham-Formel, Bezugsgewicht für Eiweiß.
- Tempo-Stufen je Ziel, eigenes Kohlenhydratziel nach Trainingsumfang.
- Schritte-Sockel, Abzug für Kompensation von Aktivität.
- Eiweiß nach Alter, Diätpausen, Refeeds, dynamisches Gewichtsmodell.
- Automatische Änderung eines bestehenden Ziels.

## Prüfliste für den Nutzer nach der Umsetzung

- Die Karte "Neue Bedarfsrechnung" erscheint einmal im Tagebuch.
- Einrichten mit "Abnehmen" ergibt etwa 1710 kcal und 176 g Eiweiß (bei 80 kg und rund 2150 kcal Verbrauch
  aus den eigenen Daten).
- Wer Training und Schritte nicht anrechnet, bekommt den Verbrauch mit Training; wer sie anrechnet, den
  Verbrauch ohne und dafür mehr Budget an Trainingstagen. Beides führt im Schnitt zum selben Defizit.
