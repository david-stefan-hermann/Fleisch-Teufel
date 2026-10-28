# Feedback-Runde 9: Portionen, Trainings zusammen eintragen, Gewichtsband

Ablage im Repo bei Umsetzung: `docs/plans/2026-10-feedback-runde-9.md` (Kopie dieser Datei, kommt mit Block 1 in den Commit).

## Status (2026-10-28)

Plan geschrieben (Fable). Noch nichts umgesetzt. Block 4 (Trainingsseite) wartet auf das Mockup-OK des Nutzers
(Schritt 0), die Blöcke 1 bis 3 brauchen kein Mockup.

## Context

Feedback des Nutzers vom 2026-10-28, drei Themen:

1. **Portionen.** Was „Portion“ bei einem Lebensmittel bedeutet und welche Einheit vorgeschlagen wird, ist
   unklar. Und: 2 × „Portion (50 g)“, dann auf Gramm gewechselt, ergibt „irgendwas komplett Absurdes“ statt
   100 g. Vorbild MyFitnessPal: jedes Lebensmittel hat definierte Portionsgrößen (Serving sizes) mit Gramm.
2. **Training eintragen.** Bedienung und Aussehen gefallen nicht. Es soll möglich sein, zwei Trainings auf einmal
   einzutragen (Krafttraining und Dehnen). Häufige und zuletzt gemachte Trainings sollen unten als Badges zum
   Antippen stehen, wie die Vorschläge bei den Lebensmitteln.
3. **Gewichtsband.** Standard 0,05-kg-Raster (80 / 80,05 / 80,10), in den persönlichen Einstellungen auf 0,01
   umstellbar. Sichtbarer Bereich standardmäßig ±0,5 kg, ebenfalls einstellbar (bis etwa ±2 kg, „ein paar
   vernünftige Auswahlmöglichkeiten“).

### Befund zu Thema 1 (Fable, 2026-10-28, mit Wegwerf-Test belegt)

Die Rechnung stimmt: `convertAmount` (`lib/amounts.ts`) hält die Gramm, 2 × 50 g werden 100 g, das Feld zeigt
„100“. Falsch wird es **danach**: Beim Einheitenwechsel tauscht das Mengenrad (`components/Wheel.tsx`) seine Zeilen
(20 halbe Portionen gegen 200 Gramm-Zeilen) und bekommt einen neuen `index`. Jedes Scroll-Ereignis, das der
Browser **nach** diesem Tausch an der alten Scrollposition oder während des programmatischen Scrollens auslöst
(iOS: Nach-Einrasten von `scroll-snap` nach einer DOM-Änderung, animiertes `scrollTop`), wertet das Rad als
Drehung von Hand (`onScroll`: `rowAt(el) !== index` → `turned = true` → `onSettle`). Im Test: nach dem Wechsel auf
Gramm genügt ein Scroll-Ereignis auf der alten Zeile 3, und der Eintrag wird auf **20 g** festgeschrieben; dazu
setzt der Folge-Effekt (`index` geändert) `scrollTop` wieder um, das Rad springt hin und her. Darum „teilweise“
und „absurd“: es hängt davon ab, ob und wann Safari nachscrollt.

Die Logik des Rads muss also zwischen **Drehen von Hand** und **Scrollen von außen** unterscheiden, statt beides
aus der Scrollposition zu raten (Block 1).

### Was andere Apps machen (Recherche 2026-10-28)

- **MyFitnessPal**: Jedes Lebensmittel hat eine Liste Portionsgrößen („Serving sizes“: „1 cup (240 ml)“,
  „100 g“, bei Nutzereinträgen oft nur eine) plus Zahl der Portionen. Wechselt man die Portionsgröße, bleibt
  die **Zahl** stehen (2 × Tasse werden 2 × 1 g); die Community behilft sich mit der 1-g-Portion als
  Multiplikator und wünscht sich eine Umrechnung ([Quelle](https://community.myfitnesspal.com/en/discussion/comment/42884498),
  [Quelle](https://community.myfitnesspal.com/en/discussion/comment/47141938)). Unser Verhalten (Gramm bleiben)
  ist das, was MFP fehlt, und bleibt.
- **Yazio / Lifesum**: Einheiten pro Lebensmittel mit Gramm dahinter („1 Stück (mittel) 120 g“, „1 Scheibe 25 g“),
  Standardwahl ist das Stück, nicht 100 g. Lifesum nutzt wie wir den BLS als eine Quelle
  ([Quelle](https://help.lifesum.com/de/article/lifesums-lebensmitteldatenbank-sj8xds)).
- **Hevy** (Trainings): aus der Suche mehrere Übungen auf einmal aufnehmen; bereits gemachte Übungen füllen
  Dauer und Werte vom letzten Mal vor ([Quelle](https://www.hevyapp.com/features/exercise-programming-options/)).

Lehre: Portionen brauchen einen **Namen mit Bedeutung** („Stück“, „Scheibe“, „Riegel“) und immer die Gramm
daneben; die Umrechnung beim Einheitenwechsel bleibt, muss aber verlässlich sein.

### Entschieden (mit dem Nutzer, 2026-10-28)

- Gramm bleiben beim Einheitenwechsel gleich (2 × 50 g → 100 g).
- Mehrere Trainings in einem Rutsch eintragen; Vorschläge (zuletzt / häufig) als Badges zum Antippen.
- Gewichtsband: Standard 0,05 kg, Einstellung 0,01 möglich; Bereich ±0,5 kg Standard, einstellbar.

### Annahmen (im Plan festgelegt, bei Widerspruch melden statt still zu entscheiden)

- **Mockup nur für die Trainingsseite** (Schritt 0, Block 4). Bugfix, Portionsdaten und Gewichtsband brauchen keins.
- Portionsgrößen bleiben das heutige Modell `Portion { label, grams }`; neu ist eine kuratierte **Stück-/Scheiben-
  Tabelle für BLS-Lebensmittel** (Block 2), keine neue Tabelle in der Datenbank, keine Sync-Änderung.
- Die Standard-Einheit beim Öffnen eines Lebensmittels: zuletzt verwendete Menge, sonst eigene Portion, sonst
  Stück/Scheibe/Riegel aus Tabelle oder OFF, sonst Gramm (100). Haushaltsmaße (EL, Tasse) sind nie Standard.
- Die Einstellungen für das Gewichtsband liegen in den **synchronisierten Einstellungen** (`settings`), nicht
  pro Gerät: der Nutzer wiegt sich am Handy, aber „persönliche Einstellungen“ sollen überall gelten. Zwei Felder,
  beide nullable mit Standard, Bedienung auf der Profil-Seite unter „Gewichtseingabe“.
- Auswahl Raster: 0,05 kg (Standard), 0,01 kg, 0,1 kg. Auswahl Bereich: ±0,5 kg (Standard), ±1 kg, ±2 kg, ±5 kg.
- Mehrere Trainings werden als **mehrere `exerciseEntries`** gespeichert (eine Transaktion), das Datenmodell
  ändert sich nicht. Bearbeiten eines bestehenden Eintrags bleibt ein einzelnes Formular.
- Trainingsvorschläge zählen nach **Sportart** (`typeKey`) mit der zuletzt verwendeten Dauer, Intensität und Notiz,
  60 Tage zurück, bewertet wie die Lebensmittelvorschläge (häufig und kürzlich, gleicher Wochentag etwas höher).
  Sie stehen an zwei Orten: im Tagebuch unter der Trainingskarte (ein Tipp trägt ein, mit Rückgängig) und auf der
  Seite „Training eintragen“ (ein Tipp nimmt es in die Auswahl).
- Nicht dabei: Supersätze, Sätze/Wiederholungen, Trainingspläne, Fitness-Import.

## Umsetzung

### Block 1: Mengenrad unterscheidet Drehen von Scrollen (`components/Wheel.tsx`, `AmountEditor.tsx`)

Ursache siehe Befund. Regel: **nur Eingaben des Nutzers drehen das Rad**; alles andere ist Scrollen von außen und
wird weder gemeldet noch gespeichert.

- `Wheel`: `turned` wird nicht mehr aus `rowAt(el) !== index` abgeleitet, sondern aus Eingabe-Ereignissen auf dem
  Element gesetzt: `pointerdown`/`touchstart` (Finger oder Maus auf dem Rad), `wheel` (Trackpad), Tastatur
  (bleibt `jump`). Ein Scroll-Ereignis ohne vorherige Eingabe seit dem letzten Stopp wird ignoriert (`onChange`
  nicht gerufen, kein Timer).
- Programmatisches Scrollen (neuer `index` oder geänderte `items`) in `useLayoutEffect` statt `useEffect`, damit
  die Position vor dem ersten Paint steht (kein Nach-Einrasten durch `scroll-snap`); dazu ein `pending`-Ref mit
  der Zielposition: Scroll-Ereignisse, solange `pending` gesetzt ist und `scrollTop` noch nicht dem Ziel entspricht,
  werden ignoriert; beim Erreichen wird `pending` gelöscht. Erreicht ein Browser das Ziel nie exakt (gerundet),
  löscht ein Timeout (300 ms) `pending` ebenfalls.
- Berührt der Nutzer das Rad, während `pending` gesetzt ist, gewinnt der Nutzer (`pending` löschen, `turned`
  setzen).
- `AmountEditor`: das Mengenrad bekommt `key={kind}`: beim Wechsel zwischen Gramm und Portion wird es neu
  aufgebaut statt 200 Zeilen gegen 20 zu tauschen (die alte Scrollposition existiert dann nicht mehr). Das
  Einheitenrad braucht das nicht (gleiche Liste).
- `onScroll` weiter mit `SETTLE_MS`, aber `setStopped` nur, wenn `turned` wirklich von einer Eingabe kam.

Tests:

- `apps/web/test/components.test.tsx` („ingredient amount wheel“): neuer Fall **„2 × Portion (50 g) → Gramm
  bleibt 100 g, auch wenn danach ein fremdes Scroll-Ereignis kommt“**: Portion auf 2 drehen (Tastatur), Einheit
  „Gramm“ wählen, dann `scrollTop = 3 * 44` setzen und `scroll` feuern, Timer vorlaufen: Feld bleibt „100“, kein
  weiterer `onCommit`. Spiegelbild Gramm → Portion (300 g → 6 Portionen). Gegenprobe: `pointerdown` + `scroll` +
  Timer **wird** gemeldet (Drehen von Hand funktioniert weiter).
- `Wheel`-Test direkt: `items`-Wechsel mit altem `scrollTop` ruft `onSettle` nicht.
- E2E `meals-goals.spec.ts` (Chromium) und, soweit im Container vorhanden, `ios-layout.spec.ts` (WebKit): Lebensmittel
  mit Portion öffnen, 2 Portionen, Einheit Gramm, Feld „100“, eintragen, Tagebuch zeigt 100 g.

### Block 2: Portionen mit Bedeutung (`packages/shared/src/portions.ts` neu, `foods.ts`, OFF-Normalisierung, Suche)

**2a. Stück-Tabelle für BLS.** Neue Datei `packages/shared/src/portions.ts` mit `PIECE_RULES`: Regeln aus
Namenswörtern (erster Treffer gewinnt, wie `NAME_RULES`) und BLS-Gruppenbuchstabe → eine oder zwei Portionen mit
Gramm. Grundlage: typische deutsche Portionsgrößen (BZfE/DGE-Richtwerte, Handelsgrößen); jede Zeile mit Gramm im
Label-Format **„Stück (120 g)“** (Gramm im Label wie bei OFF, damit `unitText` und `rowAmount` nichts anhängen).
Startliste (Opus ergänzt nach Durchsicht der BLS-Namen, Tests pinnen die wichtigsten):

| Wörter (Name)                                                | Portion(en)                                        |
| ------------------------------------------------------------ | -------------------------------------------------- |
| apfel, birne, orange, pfirsich, nektarine                    | Stück (150 g)                                      |
| banane                                                       | Stück (120 g)                                      |
| mandarine, clementine, kiwi, pflaume, aprikose               | Stück (60 g) bzw. kiwi 75, pflaume 40, aprikose 45 |
| erdbeere, traube, kirsche, himbeere, heidelbeere             | Handvoll (80 g) für Beeren; erdbeere Stück (12 g)  |
| ei (ganzes Ei, Hühnerei, „ei roh“, „ei gekocht“)             | Stück (60 g)                                       |
| brot, vollkornbrot, graubrot, mischbrot                      | Scheibe (45 g)                                     |
| toast                                                        | Scheibe (25 g)                                     |
| knäckebrot                                                   | Scheibe (10 g)                                     |
| brötchen, semmel                                             | Stück (55 g)                                       |
| brezel, laugen                                               | Stück (80 g)                                       |
| croissant                                                    | Stück (60 g)                                       |
| käse (Schnitt-/Hartkäse, nicht Frisch-/Hüttenkäse)           | Scheibe (25 g)                                     |
| wurst, aufschnitt, schinken, salami, mortadella              | Scheibe (20 g)                                     |
| wiener, würstchen, bockwurst                                 | Stück (50 g)                                       |
| bratwurst                                                    | Stück (100 g)                                      |
| schnitzel, steak, hähnchenbrust, putenbrust, filet (Fleisch) | Stück (150 g)                                      |
| fischstäbchen                                                | Stück (30 g)                                       |
| lachs, forelle, fischfilet (Gruppe T mit „filet“)            | Stück (150 g)                                      |
| tomate                                                       | Stück (80 g)                                       |
| gurke (Salatgurke)                                           | Stück (400 g), Scheibe (5 g)                       |
| paprika                                                      | Stück (150 g)                                      |
| karotte, möhre                                               | Stück (80 g)                                       |
| zwiebel                                                      | Stück (70 g)                                       |
| knoblauch                                                    | Zehe (3 g)                                         |
| avocado                                                      | Stück (200 g), Hälfte (100 g)                      |
| kartoffel (roh/gekocht, nicht Produkte)                      | Stück (80 g)                                       |
| champignon, pilz                                             | Stück (15 g)                                       |
| schokolade (Tafel)                                           | Stück (6 g), Tafel (100 g)                         |
| riegel, müsliriegel                                          | Riegel (30 g)                                      |
| keks, plätzchen, butterkeks                                  | Stück (10 g)                                       |
| gummibärchen, fruchtgummi                                    | Stück (2,5 g), Handvoll (30 g)                     |
| nuss, nüsse, mandel, cashew, erdnuss, walnuss                | Handvoll (30 g)                                    |
| pizza                                                        | Stück (350 g), Viertel (90 g)                      |
| suppe, eintopf                                               | Teller (300 ml)                                    |
| Gruppe X/Y ohne Treffer                                      | Portion (350 g)                                    |

Reihenfolge in `portionsFor`: **eigene Portionen, Portionen des Lebensmittels (OFF/eigene), Stück-Tabelle, Basis,
Haushaltsmaße**. Damit wird das Stück der Standardvorschlag (siehe Annahme), Haushaltsmaße bleiben wählbar.
`householdPortionsFor` bleibt; `pieceAndSlicePortionsFor(food)` daneben, beide ohne Doppelte (Label-Vergleich).
Die Tabelle gilt nur für BLS (OFF-Produkte haben ihre Serving-Size, eigene Lebensmittel ihre Portionen).

**2b. OFF-Portionen sprechend.** `apps/api/src/off/normalize.ts`: hat `serving_size` ein Wort (z. B.
„1 Riegel (45g)“, „2 Scheiben (50 g)“, „1 slice“), wird daraus das Label: Zahl und Einheit gestrichen, erstes Wort
großgeschrieben, Gramm dahinter: „Riegel (45 g)“, „2 Scheiben (50 g)“. Nur eine Zahl („30 g“) bleibt „Portion
(30 g)“. Bekannte englische Wörter werden übersetzt (`slice` → Scheibe, `piece` → Stück, `bar` → Riegel, `cup`
→ Tasse, `bottle` → Flasche, `can` → Dose, `serving`/`portion` → Portion), unbekannte bleiben. Bestehende
gecachte OFF-Produkte bekommen das neue Label beim nächsten Auffrischen (`OFF_FRESH_MS`); ein Eintrag behält sein
altes Label (`editorPortions` bietet die aktuelle Portion immer an).

**2c. Standard-Einheit beim Öffnen** (`FoodLogPage.tsx` `FoodLogForm`, `foodService.ts` `rowAmount`): die
Reihenfolge aus `portionsFor` gilt (erste Portion, die nicht „Packung“ ist); durch 2a ist das für Banane „Stück
(120 g)“, für Haferflocken weiterhin 100 g (keine Stückregel, Haushaltsmaße nie Standard). Suchzeilen zeigen
„Stück (120 g) · 110 kcal“ (heutiges Format aus `rowAmount`; die Gramm stehen schon im Label).

**2d. Wortwahl im Einheitenrad** (`AmountEditor.unitText`): Basis „Gramm“/„Milliliter“, sonst das Label; hat ein
Label keine Gramm im Text, werden sie angehängt (heute schon). Neu: ein Label „Portion“ ohne Gramm aus einem
älteren Schnelleintrag bleibt „Portion“.

Tests: `packages/shared/test/foods-csv.test.ts` (oder neu `portions.test.ts`): Banane → Stück 120 vor 100 g;
Toast → Scheibe 25, keine Tasse; Käsekuchen → kein Scheibe-Käse (Reihenfolge der Regeln); Hüttenkäse → Löffel, kein
Scheibe; Gruppe X ohne Treffer → Portion 350; OFF `normalizeOffProduct` mit „1 Riegel (45g)“ → „Riegel (45 g)“,
„2 slices (50 g)“ → „2 Scheiben (50 g)“, „30 g“ → „Portion (30 g)“. `apps/web/test/foods.test.ts`: `rowAmount` mit
Stück-Portion. `apps/api/test/search-quality.test.ts` bleibt grün (Suche unverändert).

### Block 3: Gewichtsband mit Raster und Bereich (`TapeMeasure.tsx`, `ProgressPage.tsx`, Einstellungen)

**Einstellungen.** `settingsSchema` (`packages/shared/src/schemas.ts`): `weightStepKg: z.union([z.literal(0.01),
z.literal(0.05), z.literal(0.1)]).nullable().default(null)` und `weightRangeKg: z.union([0.5, 1, 2, 5] als Literale)
.nullable().default(null)`; `null` heißt Standard (0,05 und 0,5). Konstanten `WEIGHT_STEPS`, `WEIGHT_RANGES`,
`DEFAULT_WEIGHT_STEP`, `DEFAULT_WEIGHT_RANGE` in shared. `DEFAULT_SETTINGS` (`db/settings.ts`) beide `null`.
API: `apps/api/src/db/schema.ts` zwei nullable Spalten (`real`), `pnpm --filter @ft/api db:generate -- --name
weight-tape-settings`, SQL committen. Dexie: kein Index, keine neue Version. `apps/api/test/sync.test.ts`:
Rundreise mit beiden Feldern (und ohne, alte Geräte). Vorher `.claude/skills/offline-sync/SKILL.md` lesen.

**Band.** `TapeMeasure`:

- `step` und `visibleRange` bleiben Props; `WeightDialog` (`ProgressPage.tsx`) liest sie aus `useSettings()`
  (Standardwerte bei `null`), das Band selbst bleibt ohne Datenzugriff. Während des Ziehens wird
  auf das Raster gerundet **bevor** gemeldet wird (heute `round2`, dadurch stehen beim Ziehen 80,03 im Display):
  `emit(snap(...))`. Das Display zeigt bei 0,05 und 0,01 zwei Dezimalstellen (`fmtFixed(v, 2)`), bei 0,1 eine.
- Striche: kleine Striche im Abstand `markStep`, der kleinste aus [step, 0,05, 0,1, 0,5, 1] mit **mindestens 7 px**
  (bei 0,01 und ±0,5 kg auf 340 px sind das 0,05 kg; das Raster bleibt 0,01, das Einrasten merkt man am Wert, nicht
  an einem Strich). Mittlere Striche bei 0,5 kg, große mit Zahl bei 1 kg. Ist weniger als 1,5 kg sichtbar
  (±0,5), bekommen auch die 0,5-Striche eine Zahl („80,5“), sonst steht oft nur eine Zahl im Band.
- Tastatur: Pfeile ±step, Bild auf/ab ±1 kg, Home/End wie heute. `aria-valuetext` mit der passenden Stellenzahl.
- Hinweis unter dem Band: „Ziehen oder wischen, rastet auf 0,05 kg ein“ folgt der Einstellung (`fmtFixed(step, 2)`).

**Profil-Seite** (`features/more/ProfilePage.tsx`): neue Section „Gewichtseingabe“ mit zwei Selects: „Raster“
(0,01 kg / 0,05 kg / 0,1 kg) und „Sichtbarer Bereich“ (±0,5 kg / ±1 kg / ±2 kg / ±5 kg); gespeichert mit dem
„Speichern“-Button der Seite (beide Felder in das `saveSettings`-Patch aufnehmen). Hilfetext in einer Zeile:
„Gilt für das Band bei „Gewicht eintragen“; der genaue Wert nimmt immer zwei Stellen.“

Tests: `components.test.tsx` TapeMeasure: `step=0.01`, `visibleRange=0.5`: Pfeil rechts → +0,01, Striche alle
0,05 (data-mark zählen), Zahl an 0,5; Ziehen meldet nur Rasterwerte (`pointermove` um 11 px bei 340 px/±0,5 →
80,05, nicht 80,03). Shared: Schema akzeptiert `null`, 0.05, lehnt 0,02 ab. E2E `smoke.spec.ts` oder neu in
`diary-training.spec.ts`: Profil → Raster 0,01 → Gewicht eintragen → Hinweis „0,01 kg“.

### Block 4: Trainingsseite neu, mehrere Trainings, Vorschläge (`features/exercise/*`, `db/entries.ts`, `db/trainingSuggestions.ts` neu, `ExerciseCard.tsx`)

**Schritt 0 (vor dem Code): Mockup.** `docs/plans/2026-10-feedback-runde-9-mockup.html`, eine Datei, Handy-Rahmen,
hell und dunkel, Stil der bisherigen Mockups (`...-runde-8-mockup.html` als Vorlage, Tokens der App). Zeigt: (A)
Seite „Training eintragen“ leer, (B) mit zwei gewählten Trainings (eines aufgeklappt), (C) Tagebuch-Trainingskarte
mit Vorschlags-Badges. Dann auf das „los“ des Nutzers warten. Gewünschte Änderungen ins Mockup, erst danach Code.

**Seite „Training eintragen“ (neu, ohne `entryId`)**, von oben nach unten:

1. Datumzeile wie heute.
2. **„Ausgewählt“**: Liste der Trainings, die eingetragen werden (`TrainingRow`): Name, darunter „60 Min. · Mittel
   · Notiz“, rechts „+480“ in `text-exercise` und ein X (entfernen). Tipp auf die Zeile klappt die Felder auf
   (`TrainingFields` wie heute: Intensität, Dauer mit Presets, Notiz, `TrainingKcal`); nur eine Zeile ist offen,
   die zuletzt hinzugefügte öffnet sich. In der aufgeklappten Zeile ein Textlink „Als Training speichern“
   (`NameDialog`, wie heute das Kopfzeilen-Symbol; das Symbol in der Kopfzeile entfällt). Leer: ein gestrichelter
   Hinweis „Wähle unten eine Sportart oder einen Vorschlag.“
3. **Badges „Zuletzt & häufig“** (`Badge`-Chips, umbrechend, `variant="secondary"`, gewählte mit Haken und
   `bg-exercise/15`): Vorschläge aus `trainingSuggestions` (bis 6) und danach die gespeicherten Trainings
   (bis 6, Name). Tipp nimmt das Training mit seiner Dauer, Intensität und Notiz in „Ausgewählt“ auf; erneuter
   Tipp entfernt es wieder. Mehr gespeicherte Trainings: Link „Alle gespeicherten Trainings“ nach `/trainings`.
   Die heutige Suche über Schnellauswahl (`quickQuery`) entfällt; die Sportsuche darunter findet auch die
   gespeicherten Trainings (Name) und zeigt sie oben in der Liste.
4. **Sportart** (`SportPicker` wie heute, Suche + Liste, „Eigene Sportart“): Tipp auf eine Sportart fügt eine Zeile
   hinzu (Dauer und Intensität vom letzten Eintrag dieser Sportart, sonst 30 Min. mittel) und klappt sie auf. Eine
   Sportart, die schon in „Ausgewählt“ steht, ist markiert; erneuter Tipp entfernt die Zeile (gleiche Logik wie die
   Badges, `toggleTraining`).
5. Fußleiste: „Training eintragen“ bei einer Zeile, „2 Trainings eintragen“ bei mehreren, dahinter „· 480 kcal“;
   deaktiviert ohne Zeile oder mit einer Zeile ohne Dauer. `useSubmitting`.

Speichern: `logTrainings(db, rows, date)` in `db/entries.ts`: eine Dexie-Transaktion über `[exerciseEntries,
outbox]`, je Zeile `saveExercise`-Daten mit `loggedAt` aufsteigend (Date.now() + Index, damit die Reihenfolge
bleibt). Toast „2 Trainings: 480 kcal“ (eine Zeile: wie heute „Krafttraining: 320 kcal“). Danach ins Tagebuch.

**Bearbeiten** (`entryId`): unverändert ein Formular (Sportart, Felder), Titel „Training bearbeiten“, Löschen.
Zur Vereinfachung rendert die Seite dafür eine einzelne `TrainingRow` mit `expanded`, ohne Badges und ohne X.

**Vorschläge** `db/trainingSuggestions.ts`: `trainingSuggestions(db, date)` liest `exerciseEntries` der letzten
`SUGGESTION_DAYS` (60) Tage bis `date`, gruppiert nach `typeKey`, Gewicht wie `mealSuggestions` (`weight(diffDays,
sameWeekday)`), merkt sich die **zuletzt** verwendete Dauer, Intensität und Notiz je Sportart (Vorbild Hevy: Werte
vom letzten Mal); Sportarten, die an diesem Tag schon eingetragen sind, fallen raus (wie bei den Vorschlägen im
Tagebuch), dann auf 6 kürzen. `useTrainingSuggestions(date)` (`useLiveQuery`). `recentTrainings` (shared) bleibt
für die Suche verfügbar oder entfällt, falls nach Block 4 ungenutzt (dann auch der Test).

**Tagebuch** (`ExerciseCard.tsx`): unter den Einträgen (und unter dem leeren Hinweis) eine Chip-Reihe
`TrainingSuggestions` wie `MealSuggestions`: „Krafttraining · 60 Min.“, ein Tipp trägt ein (`logTrainings` mit
einer Zeile, Gewicht des Tages über `useCurrentWeight`, MET aus `metFor`), Toast mit Rückgängig (Rückgängig löscht den eben
angelegten Eintrag wieder, `deleteRecord`). Keine Chips, solange es keine Trainings gibt (keine leere Überschrift).

Wording: „Training eintragen“ / „N Trainings eintragen“, „Als Training speichern“ (speichern = wiederverwenden),
„Zuletzt & häufig“ für die Badges, „Ausgewählt“ für die Liste, nie „Vorlage“.

Tests: `apps/web/test/write.test.ts`: `logTrainings` schreibt zwei Einträge in einer Transaktion mit steigender
`loggedAt`, beide im Outbox. `suggestions.test.ts` oder neu `trainingSuggestions.test.ts`: Häufigkeit schlägt
Alter, gleicher Wochentag höher, zuletzt verwendete Dauer, heute Eingetragenes fällt raus, höchstens 6. E2E
`diary-training.spec.ts`: Test „training with note, quick selection …“ umschreiben: zwei Sportarten wählen, eine
anpassen, Fußleiste „2 Trainings eintragen“, Tagebuch zeigt zwei Zeilen und die Summe; Badge im Tagebuch trägt mit
einem Tipp ein, Rückgängig entfernt es; Bearbeiten eines Eintrags bleibt ein Formular.

### Block 5: Doku

- `CLAUDE.md`: Absatz „Weight entry“ (Raster und Bereich aus `settings`, Striche-Regel), Absatz „Units offered for
  a food“ um die Stück-Tabelle und die OFF-Labels, Absatz zum `Wheel` (nur Eingaben drehen, `key={kind}`), neuer
  Absatz Trainings (mehrere auf einmal, `logTrainings`, `trainingSuggestions`, Badges im Tagebuch und auf der
  Seite). Kurz, im Stil der bestehenden Absätze.
- Diese Datei: Statusblock mit Abweichungen.

## Ablauf für Opus 5.5

Lesereihenfolge: dieser Plan, `CLAUDE.md`, `.claude/skills/offline-sync/SKILL.md` (Block 3), dann je Block die
genannten Dateien. Vor Block 4 das Mockup (Schritt 0) bauen und auf das OK warten; die Blöcke 1 bis 3 können vorher
laufen und committet werden.

Je Block ein Commit (Commit-Text englisch, Attribution laut Session-Hinweis); vor jedem Commit `pnpm lint`,
`pnpm typecheck` (nacheinander, nicht parallel), `pnpm test`; nach Block 1 und 4 zusätzlich `pnpm e2e` (Chromium;
WebKit nur, wenn `playwright install webkit` im Container vorhanden ist, sonst im Statusblock vermerken).
Abweichungen vom Plan im Statusblock dieser Datei festhalten und dem Nutzer nennen, nicht still entscheiden.
Keine em- oder en-Striche in UI-Texten, Kommentaren und Doku. Nach dem letzten Block: Status hier aktualisieren,
nicht pushen, bis der Nutzer es sagt.
