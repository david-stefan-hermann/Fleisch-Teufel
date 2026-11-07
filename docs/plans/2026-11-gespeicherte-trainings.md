# Trainings neu gedacht: Suche, Sportart-Seite, Pakete, eigene kcal, Kopieren, Anpinnen

Implementierungsplan für die umsetzende Sitzung. Statusblock hier pflegen. Das Mockup ist entschieden
(`docs/plans/2026-11-trainings-neu-mockup.html`, v3); Code erst nach dem „los" des Nutzers.

## Status

Geplant am 2026-11-06, Mockup v3 am 2026-11-06 abgenommen, **umgesetzt am 2026-11-06** (Opus), nicht gepusht.

| Block   | Commit        | Inhalt                                                                                                                                                                                     |
| ------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1       | `210853d`     | `trainingKcal`, `formatDuration`, `durationWheelValues`, `MAX_MINUTES`, `toLog`, Bearbeiten behält den Tag, Notiz-`useId`                                                                  |
| 2       | `5870c7c`     | `extraItems`, `pinned`, `groupId`, Migration `0012_training-packages`, `trainingItemsOf`, `isAutoTrainingKcal`, `groupTrainingEntries`, `trainingSummary`, `saveTraining`/`updateTraining` |
| 3       | `a8b33ab`     | Vorschläge: gespeicherte Werte, einmal je Eintragen, angepinnte zuerst, `stats`                                                                                                            |
| 4       | `ea81dbc`     | `DurationWheel`, `TrainingRow`, `TrainingFields` mit Rädchen                                                                                                                               |
| 5 bis 8 | `5e257cc`     | Suche, Sportart-Seite, „Training eintragen“, `SaveTrainingDialog`, Editor mit Entwurf und `into=training:`, Liste, Paketzeile im Tagebuch und im Tagesbild, eigene kcal                    |
| 9       | `08efc38`     | Trainings kopieren und einfügen, „Wie gestern“                                                                                                                                             |
| 10      | (siehe unten) | Erklärtexte in der ganzen App                                                                                                                                                              |
| 11      | (siehe unten) | Doku: `CLAUDE.md`, `README.md`, `docs/sync.md` (mit Block 2), dieser Statusblock                                                                                                           |

**Abweichungen**

- Blöcke 5 bis 8 sind ein Commit: Editor, Eintragen-Ansicht, Sportart-Seite und kcal-Feld hängen an denselben
  Routen und Komponenten, Zwischenstände hätten nicht kompiliert.
- „Neues Training“ legt wie „Neues Meal“ einen Entwurf unter einer neuen Id an (`startNewTraining`), statt der Route
  `/trainings/new`: das Ziel der Suche braucht eine Id (`into=training:<id>`).
- `isAutoKcal` heißt `isAutoTrainingKcal` (der Name ist für Lebensmittel vergeben). `copiesOf` und `trainingParts`
  liegen in `db/clipboard.ts` (nicht in `training.ts`), damit sie ohne `@/` testbar sind.
- Der Plan sagte „Dauer bis 6 Std.“ für das Raster; `trainingSummary` nutzt wie geplant `formatDuration`, im
  Tagebuch steht deshalb „2 Aktivitäten · 1 Std. 15 Min.“ (das Mockup zeigte „75 Min.“).
- Kein Toast nach „Hinzufügen“ (Sportart zum gespeicherten Training) und nach dem Speichern auf der Sportart-Seite:
  er lag über dem Fußleisten-Knopf, und der Zustand ist sichtbar (neue Aktivität im Editor, Chip „Gespeichert als“).
- Eine Aktivität einer gelöschten eigenen Sportart fehlt in „Training eintragen“ (Toast beim Öffnen); im Editor
  bleibt sie mit ihrem gespeicherten Namen stehen und lässt sich entfernen.
- Neue Annahme: eine Sportart-Zeile zählt in „N× eingetragen“ nur Einträge ohne (lebendes) gespeichertes Training,
  wie die Vorschläge; `last` (Startwerte, „Zuletzt …“) zählt alle.

**Prüfung**: `pnpm lint`, `pnpm typecheck`, `pnpm test` (Shared 112, Web 306, API 182) und `pnpm e2e`
(chromium-iphone, 42 Tests) grün. Sichtprüfung im Produktions-Build über die API (iPhone 13, hell und dunkel) neben
dem Mockup v3: Suche (Häufig, Eigene, mit Ziel), Sportart-Seite mit Rädchen, „Genau eingeben“ und eigenen kcal,
Editor mit zwei Aktivitäten und Anpinnen, Liste, Paketzeile im Tagebuch, „Training eintragen“ mit „geändert“ und
Speichern-Dialog.

**Nur am iPhone prüfbar**: Rädchen der Dauer (Finger liegt auf, Snap, getippte Zeile bleibt beim Weiterdrehen),
„Genau eingeben“ und das kcal-Feld über der Tastatur, Wischen nach rechts (kopieren) und links auf Trainingszeilen
und auf dem Kopf einer Aktivität in „Training eintragen“ (das offene Rädchen darunter darf nicht wischen).

**Block 10, behaltene Texte**: „Halte den Barcode in den Rahmen.“ (Kameraführung); `SaveMealDialog` und der
Speichern-Dialog der KI-Prüfung (Folge der Aktion); Fortschritt der `ExpenditureCard`; iOS-Schritte unter Aussehen
und die Installationsbanner (vom System erzwungen); `DataPage` (Grenzen des Systems); Hinweise der Erinnerung, nur
wenn sie zutreffen (Browser, iOS nicht installiert, Mitteilungen blockiert, VAPID fehlt, offline); „Du kannst
zurück ins Tagebuch gehen …“ während einer Analyse und „Der Text steht als Titel …“ ohne KI (Folge der Aktion);
Datenzeilen (Eiweiß pro kg, „Zutaten roh X g“, DGE-Quelle). Zusätzlich entfernt: „Skaliert alle Zutaten“ auch im
Meal-Editor und in der KI-Prüfung. Neu als Zustand: Marke „Kopie von Open Food Facts“, „Gewicht fehlt“ im
Makro-Plan, „bisher X kg“ im Gewichtsdialog, „N Fotos noch nicht analysiert“. Offen (nicht im Plan, Entscheidung des
Nutzers): „Versuche ein Foto von schräg oben …“ bei „Kein Essen erkannt“ und der Satz im Abschnitt „Tagebuch“ unter
Aussehen. Der E2E-Test „a double tap on „Meal eintragen“ logs the analysis once“ schlug in einem vollen Lauf einmal
fehl und lief danach grün (Wackler, nicht untersucht).

Das ältere Mockup `2026-11-gespeicherte-trainings-mockup.html` ist überholt (nicht eingecheckt, kann weg).

## Context

Der Nutzer: „Gespeicherte Workouts sind aktuell noch sehr schlecht umgesetzt." Die Code-Durchsicht (2026-11-06,
Stand `b933d7a`) bestätigt das. Ein gespeichertes Training ist heute praktisch nur ein Namensschild:

| Was                            | Heute                                                                                         | Problem                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Werte beim Wiedereintragen     | Vorschlag `t:<id>` trägt die Werte des letzten Eintrags ein (`db/trainingSuggestions.ts:112`) | Der Editor wirkt nicht; das Badge mit den gespeicherten Werten ist weg     |
| Hinweis im Editor              | „Änderungen gelten für künftige Einträge. Bereits eingetragene … bleiben" (`:179`)            | Falsch in beide Richtungen (Name ändert alte Einträge, Werte gelten nicht) |
| Auswahl auf `/exercise`        | Eine Zeile pro Sportart (`rowOfType`, `ExercisePage.tsx:106`)                                 | Zwei gespeicherte Trainings einer Sportart schließen sich aus              |
| „Als Training speichern"       | Legt immer ein neues an (`ExercisePage.tsx:446`)                                              | Kein Aktualisieren, Duplikate mit gleichem Namen                           |
| Editor schließen               | `navigate('/trainings')` als Push (`TrainingEditorPage.tsx:101`, `:113`)                      | Zurück führt wieder in den Editor oder auf „nicht gefunden"                |
| „Alle gespeicherten Trainings" | Link in die Verwaltungsliste (`ExercisePage.tsx:391`)                                         | Sackgasse, Auswahl geht verloren                                           |
| Leertext                       | „…über das Speichern-Icon oben rechts" (`TrainingsPage.tsx:24`)                               | Das Icon gibt es nicht mehr                                                |
| Eigene Sportart im Editor      | Intensität bleibt stehen (`TrainingEditorPage.tsx:154`)                                       | Gesperrter Umschalter zeigt den alten Wert                                 |
| Modell                         | Eine Sportart pro gespeichertem Training                                                      | Die Seite trägt mehrere ein, speichern geht nur einzeln                    |
| Anlegen                        | Nur über die Eintragen-Seite                                                                  | Kein „Neues Training" auf `/trainings`                                     |

Ziel (Neukonzept, als gäbe es noch keine Trainings in der App): **Trainings laufen wie Essen.** Eine Sportart ist
ein Lebensmittel (eigene Seite mit Rädchen, „Eintragen"), ein gespeichertes Training ist ein Meal (Name, eine oder
mehrere Aktivitäten, ein Tipp trägt alles mit den gespeicherten Werten ein), die Suche ist dieselbe Seite wie
`/add` mit den Reitern „Häufig · Kürzlich · Eigene", und die Trainingskarte im Tagebuch benimmt sich wie eine
Mahlzeit (Vorschläge, Wischen, Kopieren, „Wie gestern"). Die heutige Sammelseite `/exercise` mit „Ausgewählt"
entfällt.

### Was andere Apps machen (Recherche 2026-11-06)

- **MyFitnessPal**: Liste „History" nach zuletzt/häufig mit merkbarer Sortierung; „Workout Routines" sind benannte
  Pakete aus mehreren Übungen; Einträge sind Schnappschüsse (alte kcal bleiben nach Gewichtsänderung,
  [Quelle](https://support.myfitnesspal.com/hc/en-us/articles/360032272372)). Kritik: ein eingetragenes Paket steht im
  Tagebuch nur als „routine" ohne Teile; kein Schnelleintrag für kcal
  ([Quelle](https://community.myfitnesspal.com/en/discussion/comment/47886878)).
- **Cronometer**: kcal pro Eintrag überschreibbar, Eintrag und Tag kopierbar
  ([Quelle](https://support.cronometer.com/hc/en-us/articles/360018029912)). Kritik: „Zuletzt" hält nur 4, eigene
  Übungen haben feste kcal, die nicht mit der Dauer rechnen
  ([Quelle](https://forums.cronometer.com/discussion/6107/make-adding-exercises-as-easy-as-adding-foods)).
- **Hevy / Strong**: Vorlage mit eigenen Werten, „letztes Mal" getrennt daneben. Strong fragt nach einem geänderten
  Training abgestuft („Update Values Only" / „Keep Original"), abschaltbar
  ([Quelle](https://help.strongapp.io/article/177-update-template)); Hevy fragt nur bei Strukturänderungen.
- **Lifesum / Samsung Health**: Favoriten oben, Eintragen per Wisch oder einem Tipp.
- **Nutzerwünsche** (MFP-, Cronometer-, Fitbit-Foren, Bevel-Board; Reddit war nicht erreichbar): 1. ein Tipp zum
  Wiedereintragen aus einer verlässlichen Liste, 2. von gestern kopieren, 3. kcal rechnen mit der Dauer mit, 4. eigene kcal (Uhr), 5. Pakete, deren Teile im Tagebuch sichtbar bleiben, 6. alte Einträge ändern sich nie still, 7. Anpinnen statt Ordner. Nicht gewollt: erzwungene Rückfragen, mehr Taps, Duplikate, Sätze/Wiederholungen.

Lehre: Vorlage und „letztes Mal" trennen (gespeichertes Training = gespeicherte Werte, Sportart-Vorschlag =
letzte Werte), Einträge sind Schnappschüsse, Aktualisieren ist ein Angebot und keine Frage.

### Entschieden (mit dem Nutzer, 2026-11-06)

- **Paket**: Ein gespeichertes Training hat einen Namen und eine oder mehrere Aktivitäten (Sportart, Dauer,
  Intensität, Notiz je Aktivität). Ein Tipp trägt alles ein; im Tagebuch eine Zeile mit dem Namen, aufklappbar.
- **Gespeicherte Werte**: Ein gespeichertes Training trägt immer ein, was gespeichert ist. Abweichen beim Eintragen
  ändert nur diesen Eintrag; Speichern bietet „aktualisieren" oder „als neues speichern" (wie `SaveMealDialog`).
  Keine erzwungene Frage.
- **Zusätzlich**: eigene kcal pro Eintrag, Trainings kopieren („Wie gestern", Wischen nach rechts), Anpinnen.
- **Neukonzept statt Umbau** (Mockup v1 bis v3, 2026-11-06): kein Sammelkorb, eine Sportart nach der anderen wie
  beim Essen; wer regelmäßig mehrere Dinge zusammen macht, speichert sie als Training.
- **Suche** wie die Lebensmittelsuche: ein Feld, Reiter „Häufig · Kürzlich · Eigene" mit derselben Mechanik
  (`AddFoodPage.tsx:101-109`, `:214-226`), gespeicherte Trainings und Sportarten in einer Liste; ein Tipp auf eine
  Zeile öffnet die Seite (kein „+" am Zeilenende). Unter „Häufig" hängt die ganze Sportliste A bis Z an.
- **Dauer** ist ein Rädchen (`Wheel`), Raster 5 Minuten bis 2 Stunden, dann 15 Minuten bis 6 Stunden, ab einer
  Stunde „1 Std. 15 Min."; kein zweites Feld. „Genau eingeben" neben dem Label (Vorbild „Eigene Portion") öffnet
  ein Minutenfeld unter dem Rädchen; der Knopf zeigt seinen Zustand (gefüllt, ohne Haken), ein zweiter Tipp
  schließt das Feld; der getippte Wert ist eine eigene Zeile auf dem Rädchen (wie `extra` im `AmountEditor`).
- **„Kürzlich"** nach letztem Eintrag, **„Häufig"** nach Häufigkeit und Wochentag (wie die Tagebuch-Vorschläge).
- **Die Teile heißen „Aktivitäten"**; Fußleiste „Eintragen · N kcal" ohne Zählung.
- **Keine Erklärtexte in der Oberfläche.** Die Bedienung ergibt sich aus dem UI (Zustand zeigen: Marke „geändert"
  an der Zeile, gesperrter Knopf, Link mit dem berechneten Wert). Information zum Eintrag bleibt (Formel,
  „Zuletzt …", „N× eingetragen"). Das gilt auch für die bestehenden Texte in der App (Block 10).

### Annahmen (im Plan festgelegt, bei Widerspruch melden statt still zu entscheiden)

- **Sportart-Vorschläge behalten „Werte vom letzten Mal"** (Runde 9). Nur gespeicherte Trainings wechseln auf ihre
  gespeicherten Werte; die Regel aus Runde 11 („Vorschlag trägt die Werte vom letzten Mal ein") gilt für sie nicht mehr.
- **Kein Gruppen-Editor für Trainings.** Die Teile eines eingetragenen Pakets sind einzelne Einträge; ein Tipp auf
  einen Teil öffnet die Sportart-Seite im Bearbeiten-Modus. Die Paketzeile selbst klappt auf und zu.
- **Speichern ist ein Kopfzeilen-Icon** (Hausregel) auf der Sportart-Seite (macht aus dem Eintrag ein gespeichertes
  Training mit einer Aktivität, `NameDialog`) und auf „Training eintragen" (aktiv, sobald etwas abweicht;
  `SaveTrainingDialog` mit „aktualisieren" / „als neues speichern", Vorauswahl „aktualisieren").
- **Eigene kcal gehören zum Eintrag, nicht zum gespeicherten Training.** Ein getippter Wert bleibt stehen, auch wenn
  sich danach die Dauer ändert; der Link „Berechneten Wert verwenden (N kcal)" setzt zurück. Gemeint sind aktive
  kcal (ohne Grundumsatz). Gespeicherte Trainings rechnen immer.
- **Kein neues Feld für „getippt"**: ein Eintrag gilt als berechnet, wenn `kcal` zur Formel aus seinen eigenen
  `met`, `weightKg`, `minutes` passt (Vorbild `isAutoKcal` im Lebensmittel-Editor).
- **Anpinnen ist ein Schalter im Editor** (ohne Satz darunter), gespeichert mit „Speichern". Angepinnte stehen in
  den Chips (Tagebuch) und in der Suche vorn.
- **„Wie gestern" ist ein Chip der leeren Trainingskarte** (wie bei leeren Mahlzeiten); die Karte bekommt kein
  ⋯-Menü.
- **Kopierte Trainings rechnen kcal neu** mit dem Gewicht des Zieltags; getippte kcal bleiben.
- **Ein Teil eines eingetragenen Pakets behält die Verbindung**, auch wenn seine Sportart geändert wird. Ein
  einzelner Eintrag verliert sie beim Sportartwechsel wie heute.
- **Die Suche mit Ziel** (`into=training:<id>`, „Aktivität hinzufügen" im Editor) listet nur Sportarten, keine
  gespeicherten Trainings; die Sportart-Seite zeigt dann „Hinzufügen" statt „Eintragen" und kehrt mit
  `returnFromInto` in den Editor zurück (Vorbild `into=meal:`).
- **Standardwerte einer Sportart** ohne Verlauf: 30 Min., mittel (eigene Sportart: ihr einziger MET-Wert,
  Intensität gesperrt). Mit Verlauf: die Werte vom letzten Mal; die Seite sagt „Zuletzt 45 Min. · Mittel" und
  „N× eingetragen".
- **Eine eigene Sportart** entsteht wie heute im `CustomTypeDialog`: aus der Suche („Eigene Sportart „lauf" anlegen"
  als letzte Zeile der Treffer, Name vorbelegt; Knopf „Eigene Sportart" unter „Eigene") und danach öffnet sich
  ihre Seite.
- **Ältere App-Versionen** (noch nicht aktualisierte PWA) sehen ein Paket als Training mit seiner ersten Aktivität
  und tragen nur diese ein. Das ist nicht behebbar und wird hingenommen (ein Nutzer, die PWA aktualisiert sich).
- Nicht dabei: Sätze/Wiederholungen, Trainingspläne, Ordner, Fitness-Import, kcal-Schnelleintrag ohne Sportart
  (eigene Sportart plus eigene kcal deckt ihn ab), Prozent-Anrechnung, feste kcal im gespeicherten Training,
  mehrere Sportarten ohne Speichern auf einmal.

### Im Code geprüft (2026-11-06)

- Meals als Vorbild: `MealsPage.tsx` („Neues Meal", Tipp bearbeitet), `MealEditor.tsx:134-201` (`leaving`-Ref,
  `useBlocker`, `goBackOr`), `SaveMealDialog.tsx` (Radio „neu / aktualisieren" nur mit `existing`),
  `db/suggestions.ts`, `shared/diary.ts:174` (`groupDiaryEntries`), `MealCard.tsx` (`GroupRow`, „N Zutaten ⌄").
- Sync-Regeln: neue Felder nullable mit Standard `null` (`.claude/skills/offline-sync/SKILL.md`); `saveRecord`
  prüft mit `SYNC_SCHEMAS[table].parse` (`db/write.ts:50`); der Server speichert `parsed.data`
  (`apps/api/src/sync/service.ts:53`); letzte Migration `0011_exercise-entry-template.sql`.
- Leser von Trainings: `ExerciseCard.tsx`, `DayShareImage.tsx:77`, `shareDay.tsx:46`, `export.ts:134`,
  `ReportsPage.tsx:294`, `shared/diary.ts:106` (`summarizeDay`, nur `kcal`), `shared/reports.ts:36`, `TrashPage.tsx:97`.
- Tests heute: `apps/web/e2e/diary-training.spec.ts:44-199`, `apps/web/test/trainingSuggestions.test.ts`,
  `apps/web/test/write.test.ts:114/720/737/758`, `apps/api/test/sync.test.ts:169-288`.

- Gegenprüfung des Entwurfs (Plan-Agent, 2026-11-06): ein gespiegeltes `items`-Feld würde auseinanderlaufen, sobald
  eine ältere App-Version ein Training bearbeitet (`TrainingEditorPage.tsx:90-97` schreibt nur die alten Felder,
  `patchRecord` behält unbekannte Felder). Deshalb `extraItems` (siehe Block 2). `saveExercise` schreibt die
  `date` aus der URL statt `entry.date` (`ExercisePage.tsx:193`). `TrainingFields.tsx:178` hat die feste
  `id="ex-note"` (doppelt bei zwei offenen Zeilen). `PasteButton` zeigt sich bei jeder gefüllten Zwischenablage
  (`MealCard.tsx:107`, `DiaryMealPage.tsx:62`).
- Vorbilder für das Neukonzept (geprüft 2026-11-06): `AddFoodPage.tsx` (Reiter-Mechanik `:87-109`, `:214-226`,
  `TABS` `:45`, Zeilen `SearchResultRow`/`FoodRow`/`MealList`/`RecentList` `:543-713`, `into` `:84-115`,
  `addRecentToTarget` `:491`); `FoodLogPage.tsx` (eine Seite für `/food/$foodId` und `/entry/$entryId`, `DayNote`,
  `AmountEditor`, `useReturnToDiary`, `goBackOr`, `returnFromInto`/`openTarget`, `foodLogDraft`); `MealLogView.tsx:54-135`
  (`excluded`, `exclude` mit Toast und Rückgängig, `log` mit `returnToDiary({ focus })`, `add(into)`, Stift mit
  `from=log`); `MealEditor.tsx:133-205` (`into = meal:<id>`, Blocker lässt den Weg zur Suche durch `:139`,
  `addIngredient` mit `rememberIntoStart`, `saveAndClose` mit `goBackOr`); `db/mealDraft.ts` (`startNewMeal`,
  `isNew`, nur `saveMealDraft` schreibt den Datensatz); `AmountEditor.tsx:73-80` (`extra`: ein Wert neben dem Raster
  bekommt seine eigene Zeile, `wheelValues` in `lib/amounts.ts:36`); `Wheel.tsx:42` (`items: string[]`, `index`,
  `onChange`, `onSettle`, `label`, `valueNow`); `lib/into.ts` (`Into`, `parseInto`, `formatInto`, `rememberIntoStart`,
  `returnFromInto`, `openTarget`); `AddSheet.tsx:143-148` (Kachel navigiert nach `/exercise` mit `date`);
  `ExerciseCard.tsx:41-89` (Links nach `/exercise`, `entryId`); Routen `router.tsx:193-252` (`/trainings`,
  `/trainings/$templateId` ohne Suchparameter, `/meals/$mealId` mit `date`/`meal`/`from`/`into`, `/exercise` mit
  `date`/`entryId`).

## Datenmodell (Überblick)

```ts
// packages/shared/src/schemas.ts
trainingItemSchema = { typeKey, typeName, minutes, intensity, note: nullable }; // eine Aktivität
exerciseTemplateSchema += {
  extraItems: z.array(trainingItemSchema).max(19).nullable().default(null), // Aktivitäten 2..n
  pinned: z.boolean().nullable().default(null),
};
exerciseEntrySchema += { groupId: idSchema.nullable().default(null) };
```

- Die bisherigen Felder `typeKey/typeName/minutes/intensity/note` des gespeicherten Trainings **sind Aktivität 1**;
  `extraItems` hält die weiteren. Nichts ist doppelt, ältere App-Versionen bearbeiten weiter gültig Aktivität 1.
  Gelesen wird nur über `trainingItemsOf(t)` (shared): `[alte Felder, ...(t.extraItems ?? [])]`.
- Einträge, die in einem Rutsch aus einem gespeicherten Training entstehen, teilen eine `groupId` (neu je Eintragen,
  wie `foodEntries.groupId`) und tragen alle dessen `templateId`. Bestehende Daten brauchen keine Migration: alte
  Trainings haben eine Aktivität, alte Einträge ohne `groupId` bleiben einzelne Zeilen mit dem Trainingsnamen.
- Lesen immer mit `=== true` / `?? null` (lokal vor dem Update geschriebene Datensätze haben die Schlüssel nicht).
- Server: drei nullable Spalten (`extra_items jsonb`, `pinned boolean`, `group_id text`), **eine** Migration
  (`--name training-packages`, wird `0012`), kein `.notNull()`, kein `.refine` über mehrere Felder, keine neue
  Dexie-Version (kein neuer Index). Das Neukonzept braucht darüber hinaus nichts im Schema: Dauer-Rädchen, eigene
  kcal und die Suche sind reine Oberfläche; Editor-Entwürfe liegen wie beim Meal in `kv`.

## Routen und Seiten (Überblick)

| Route                                                    | Seite                                                                             | Vorbild                                    |
| -------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------ |
| `/exercise?date&q&tab&scope[&into]`                      | Suche „Training eintragen" (`TrainingSearchPage.tsx`, ersetzt `ExercisePage.tsx`) | `/add` (`AddFoodPage`)                     |
| `/sport/$typeKey?date[&into]`                            | Sportart-Seite, neuer Eintrag oder „Hinzufügen" (`SportPage.tsx`)                 | `/food/$foodId` (`FoodLogPage`)            |
| `/exercise-entry/$entryId`                               | Sportart-Seite im Bearbeiten-Modus („Änderungen übernehmen", Papierkorb)          | `/entry/$entryId`                          |
| `/trainings/$templateId?date`                            | „Training eintragen" eines gespeicherten Trainings (`TrainingLogView.tsx`)        | `/meals/$mealId?date&meal` (`MealLogView`) |
| `/trainings/$templateId` (ohne `date`), `/trainings/new` | Editor (`TrainingEditorPage.tsx`, `from=log` wie beim Meal)                       | `MealEditor`                               |
| `/trainings`                                             | Liste mit „Neues Training"                                                        | `/meals`                                   |

Einstiege: „+" und gestrichelter Hinweis der Trainingskarte, Kachel „Training eintragen" (`AddSheet.tsx:148`, Tag
der 20-Minuten-Regel) führen in die Suche; die Chips der Trainingskarte tragen direkt ein. `useRememberLogStart`
auf allen Einstiegen, `useReturnToDiary` nach dem Eintragen (wie beim Essen).

## Umsetzung

Zeilennummern sind der Stand von `b933d7a` und dienen nur zum Finden.

### Schritt 0: Mockup (erledigt)

`docs/plans/2026-11-trainings-neu-mockup.html` v3 ist die Referenz für jeden Bildschirm (A Tagebuch, B Suche,
C Sportart-Seite, D Training eintragen, E Editor, F Liste und Tab-Bar). Bei Zweifeln im Code gilt das Mockup; wo
es schweigt, die Lebensmittel-Entsprechung.

### Block 1: Aufräumen ohne Schema (`packages/shared/src/exercise.ts`, `features/exercise/*`, `db/entries.ts`)

- Shared: `trainingKcal(met, weightKg, minutes)` = `round(netExerciseKcal(...), 0)` ersetzt die vier Kopien
  (`ExercisePage.tsx:100`, `TrainingSuggestions.tsx:40`, `TrainingEditorPage.tsx:72`, `TrainingsPage.tsx:31`).
- Shared: `formatDuration(min)`: „45 Min.", „1 Std.", „1 Std. 15 Min." (Rädchen, Zeilen, Chips);
  `durationWheelValues(extra: number | null)`: 5 bis 120 in Fünfern, 135 bis 360 in Fünfzehnern, plus `extra` an
  seiner Stelle, wenn er nicht im Raster liegt (Vorbild `wheelValues`, `lib/amounts.ts:36`); `MAX_MINUTES` = 1 440.
- `features/exercise/training.ts`: `toLog(type, values, weightKg): TrainingToLog` (ein Ort für `name`, `met`, `kcal`).
- `TrainingToLog` und die Eingabe von `saveExerciseTemplate` lassen neue Schlüssel optional und füllen `null` in
  der Funktion (Muster `NewFoodEntry`, `db/entries.ts:28-58`), damit Fixtures nicht bei jedem Feld brechen.
- Bearbeiten speichert `entry.date`, nicht die `date` der URL (`ExercisePage.tsx:193`).
- `TrainingFields`: Notiz-`id` über `useId()` statt `ex-note`.
- Tests: `packages/shared/test` für `trainingKcal`, `formatDuration`, `durationWheelValues` (Rasterwechsel bei
  120, `extra` 47 zwischen 45 und 50, `extra` im Raster nicht doppelt); `apps/web/test/write.test.ts` „creates and
  updates exercises": Datum bleibt beim Bearbeiten.

### Block 2: Schema, Server, gemeinsame Helfer (vorher `offline-sync`-Skill und `docs/sync.md` lesen)

- `packages/shared/src/schemas.ts`: Felder aus „Datenmodell"; Typ `TrainingItem`.
- Shared (`exercise.ts` oder `diary.ts` neben `groupDiaryEntries`):
  - `trainingItemsOf(t): TrainingItem[]`.
  - `isAutoKcal(entry)`: `Math.abs(entry.kcal - trainingKcal(entry.met, entry.weightKg, entry.minutes)) <= 1`.
  - `groupTrainingEntries(entries)`: Zeilen in Reihenfolge von `loggedAt`; `{ kind: 'group', groupId, templateId,
entries }`, wenn mindestens zwei lebende Einträge eine `groupId` teilen, sonst `{ kind: 'entry', entry }`.
    Titel werden im Web aufgelöst (`trainingTitle`), nicht hier.
  - `trainingSummary(items)`: „Krafttraining · Dehnen · 75 Min." für Listen, Papierkorb, Chips, Suchzeilen
    (Sportnamen bis zum ersten „ / ", Dauer mit `formatDuration`).
- `apps/api/src/db/schema.ts`: `exerciseTemplates.extraItems: jsonb().$type<TrainingItem[]>()`, `pinned: boolean()`,
  `exerciseEntries.groupId: text()`; `pnpm --filter @ft/api db:generate -- --name training-packages`, SQL committen.
- `apps/api/scripts/seed-demo.ts:164-179`: kcal mit `trainingKcal` und dem gerundeten Gewicht, sonst gelten
  Demo-Einträge als „eigener Wert".
- `db/entries.ts`:
  - `saveTraining(db, { name, items, pinned? }): Promise<string>` ersetzt `saveExerciseTemplate` (Aktivität 1 in
    die alten Felder, Rest in `extraItems`, leer = `null`).
  - `updateTraining(db, id, patch): Promise<boolean>` (`patchRecord`; `false`, wenn weg oder gelöscht).
  - `logTrainings(db, date, rows)`: `TrainingToLog` bekommt `group?: string`; Zeilen mit demselben Wert teilen
    eine frische `groupId`. `saveExercise` fasst `groupId` beim Bearbeiten nicht an.
- `docs/sync.md`: neue Felder in den Absatz „Neue Felder kommen immer mit Standardwert", dazu der Satz zu
  `extraItems` (alte Felder = Aktivität 1) und zu älteren App-Versionen.
- Tests: `packages/shared/test/diary-groups-trainings.test.ts` (Standardwerte für alte Datensätze, `trainingItemsOf`
  nach einer Bearbeitung der alten Felder, Gruppen ab zwei, Rest einer Gruppe als einzelne Zeile, dasselbe Training
  zweimal am Tag = zwei Gruppen, `isAutoKcal`); `apps/api/test/sync.test.ts:169-288` (Round-Trip mit den neuen
  Feldern, „older app versions" mit einem Training alter Form); `write.test.ts` (`saveTraining`, `logTrainings`
  mit Gruppen-Ids, Fixtures).

### Block 3: Verlauf und Vorschläge (`db/trainingSuggestions.ts`, `features/exercise/TrainingSuggestions.tsx`, `hooks/data.ts`)

- `TrainingSuggestion` wird `{ key, title, templateId, pinned, items: TrainingValues[], count, score, lastDate }`.
  Sportart: ein Element mit den Werten des letzten Eintrags (wie heute, ohne getippte kcal). Gespeichertes Training
  (`t:<id>`): `items` = `trainingItemsOf` des **aktuellen** Datensatzes, gezählt einmal je `groupId ?? id`.
- `TrainingHistory` bekommt zusätzlich `stats: Map<key, { count, lastDate }>` über **alle** Sportarten und
  gespeicherten Trainings des Fensters (für „N× eingetragen" und den Reiter „Kürzlich" in der Suche sowie die Zeile
  „Zuletzt …" der Sportart-Seite); `last` je Sportart bleibt.
- Reihenfolge: angepinnte gespeicherte Trainings zuerst (auch nie eingetragene, alphabetisch), dann nach Punkten;
  im Tagebuch ohne das, was an dem Tag schon eingetragen ist (Schlüssel je Gruppe), danach auf `limit` kürzen.
- Einträge eines gelöschten gespeicherten Trainings zählen wie heute für ihre Sportart; `last` je Sportart bleibt
  und zählt auch Teile von Paketen.
- Eine Aktivität, deren Sportart es nicht mehr gibt, wird beim Eintragen ausgelassen (Toast „… gibt es nicht
  mehr"); bleibt keine übrig, entfällt der Vorschlag.
- `TrainingSuggestions` (Tagebuch): ein Tipp trägt alle Aktivitäten als eine Gruppe ein (`logTrainings`, kcal mit
  dem Gewicht des Tages), „Rückgängig" löscht alle neuen Ids. Chip: Titel, darunter `trainingSummary` (Mockup A).
- Tests: `apps/web/test/trainingSuggestions.test.ts` Fälle `:29` und `:86` umschreiben (gespeicherte Werte statt
  letzter Eintrag, einmal je Gruppe, angepinnt vorn, heute eingetragenes Paket fällt raus, alter Einzeleintrag mit
  `templateId`, gelöschtes Training zählt zur Sportart, `stats` je Schlüssel).

### Block 4: Dauer-Rädchen und Zeilenbausteine (`components/DurationWheel.tsx`, `features/exercise/TrainingRow.tsx`, `TrainingFields.tsx`)

- `DurationWheel` (Mockup C1) auf `Wheel`: `items` = `durationWheelValues(extra).map(formatDuration)`, volle Breite,
  `valueNow` in Minuten; `onChange` live, `onCommit` beim Stopp (wie `AmountEditor`). Kopfzeile: Label „Dauer",
  rechts ein Umschaltknopf „Genau eingeben" (`aria-pressed`, `Toggle`/`Button` mit `variant="secondary"`, an =
  gefüllt mit `bg-foreground text-background`, kein Haken). An: darunter ein `NumberField` in Minuten (ganze Zahl,
  1 bis `MAX_MINUTES`); der getippte Wert wird `extra` und bekommt seine Zeile, bis das Rädchen weitergedreht wird
  (dann bleibt `extra` wie im `AmountEditor` erhalten, Mockup: „bis es weitergedreht wird" meint nur, dass der Wert
  dann nicht mehr gewählt ist). Ein zweiter Tipp schließt das Feld; der Wert bleibt. Beim Öffnen mit einem Wert
  außerhalb des Rasters (Eintrag mit 47 Min.) ist das Feld zu, die Zeile 47 da. Keine Presets mehr, kein Satz.
- `TrainingFields` verliert das Zahlenfeld mit Presets (`:160-200`) und nutzt `DurationWheel`; Intensität und Notiz
  bleiben. `TrainingKcal` (`:257`) wird in Block 8 zum Feld; bis dahin wie heute (Formelzeile bleibt, sie ist
  Information, kein Erklärtext).
- `TrainingRow` (aus `ExercisePage.tsx:262-345` herausgezogen): eine Aktivität als Zeile (Name, `formatDuration` ·
  Intensität · Notiz, „+N" kcal, Pfeil auf/zu, optional X), aufgeklappt die Felder. Verwendet von
  „Training eintragen" (Block 6) und dem Editor (Block 5). Eigene Sportart: Intensität gesperrt auf „mittel".
- Tests: `components.test.tsx`: `DurationWheel` zeigt „1 Std. 15 Min.", Umschalter an/aus mit `aria-pressed`,
  getippte 47 wird eine Zeile, Wert über `MAX_MINUTES` wird abgewiesen.

### Block 5: Liste und Editor (`TrainingsPage.tsx`, `TrainingEditorPage.tsx`, `db/trainingDraft.ts` neu, `lib/into.ts`, `TrashPage.tsx`, `router.tsx`)

- `/trainings` (Mockup F1): Knopf „Neues Training" (wie `MealsPage.tsx:29-41`) nach `/trainings/new`; angepinnte
  zuerst (Pin-Icon), dann alphabetisch; Zeile: Name, `trainingSummary`, Summe kcal beim aktuellen Gewicht; Wischen
  löscht in den Papierkorb. Leerzustand ohne Anleitung: nur der Knopf und eine Zeile „Noch keine gespeicherten
  Trainings." (`TrainingsPage.tsx:24` entfällt).
- Editor-Entwurf `db/trainingDraft.ts` nach dem Muster `db/mealDraft.ts` (`kv`): `{ templateId, name, items,
pinned, isNew?, baseUpdatedAt }`; `startNewTraining(db)` legt einen Entwurf mit `isNew` an (kein Datensatz);
  `saveTrainingDraft` ist die einzige Stelle, die `saveTraining`/`updateTraining` ruft; `addActivityToTraining(db,
id, item)` hängt an den Entwurf an (für die Suche mit Ziel); ein unberührter `isNew`-Entwurf wird beim Verlassen
  verworfen; `ConflictBanner` wie beim Meal, wenn `baseUpdatedAt` nicht mehr stimmt.
- `lib/into.ts`: neue Art `{ kind: 'training', templateId }` (`training:<id>`), `openTarget` → `/trainings/$id`.
  Die Suche (Block 6) und die Sportart-Seite (Block 6) verstehen sie; die Lebensmittelsuche ignoriert sie nicht
  stillschweigend, sondern der Router lässt `into=training:` nur auf `/exercise` und `/sport/$typeKey` zu.
- Editor (Mockup E): `templateId === 'new'` rendert das Formular ohne Datensatz (Vorbild `CustomFoodPage.tsx:48`,
  `MealEditor` `isNew`). Name; Abschnitt „Aktivitäten" mit `TrainingRow` je Aktivität (X je Karte, die letzte
  bleibt: X gesperrt, kein Satz), Knopf „Aktivität hinzufügen" → `rememberIntoStart`, Navigation nach `/exercise`
  mit `into=training:<id>` (ohne Datum, Vorbild `MealEditor.tsx:203-206`); der Blocker lässt diesen Weg durch
  (`:139`). Schalter „Anpinnen" ohne Text darunter. Kasten „Verbrauch beim aktuellen Gewicht" (nur bestehend).
  Kein Hinweistext am Ende (`TrainingEditorPage.tsx:179` entfällt); Kopfzeile: Papierkorb (bestehend). „Speichern"
  ist aus, bis Name und mindestens eine Aktivität da sind und sich etwas geändert hat.
- Schließen wie `MealEditor.tsx:186-201`: `leaving`-Ref, `goBackOr(router.history, from === 'log' ? 2 : 1, →
/trainings)` nach Speichern und Löschen, `useBlocker` + `DiscardDialog` bleiben.
- `TrashPage.tsx:107`: `trainingSummary` statt `describe` der ersten Aktivität.
- Routen: `/trainings/$templateId` bekommt `validateSearch` `{ date?, from?: 'log' }` (mit `date` → Block 6);
  `/trainings/new` fällt unter dieselbe Route (`templateId === 'new'`).
- Tests: `apps/web/test/write.test.ts` (`trainingDraft`: neu, anhängen, speichern aktualisiert nur die
  Entwurfsfelder, unberührter neuer Entwurf verschwindet); E2E Test 2 in `apps/web/e2e/diary-training.spec.ts:141-197`
  umschreiben (Neues Training mit zwei Aktivitäten über die Suche, Speichern führt zurück und „Zurück" nicht wieder
  in den Editor, Anpinnen, Papierkorb).

### Block 6: Suche, Sportart-Seite, „Training eintragen" (`TrainingSearchPage.tsx` neu statt `ExercisePage.tsx`, `SportPage.tsx` neu, `TrainingLogView.tsx` neu, `SaveTrainingDialog.tsx` neu, `AddSheet.tsx`, `router.tsx`)

**Suche `/exercise` (Mockup B)**, Datei `TrainingSearchPage.tsx`, `ExercisePage.tsx` wird gelöscht:

- Suchparameter `date` (Pflicht, wie heute), `q`, `tab` (`frequent` Standard, `recent`, `mine`), `scope`, `into`;
  dieselbe Mechanik wie `AddFoodPage.tsx:87-109` und `:214-226` (ab zwei Zeichen alles, kein Reiter aktiv; Tipp auf
  einen Reiter filtert und zeigt das x; Tipp auf den aktiven hebt auf; `onClick` statt `onValueChange`).
- Eine Liste aus zwei Zeilenarten (Mockup B1): gespeichertes Training (Lesezeichen oder Pin, Name,
  `trainingSummary`, kcal beim heutigen Gewicht, „N× eingetragen") und Sportart (Name, Werte vom letzten Mal oder
  „30 Min. · Mittel", kcal, „N× eingetragen" falls > 0). „Häufig": nach `score` aus `trainingHistory` (angepinnte
  zuerst), darunter Abschnitt „Alle Sportarten" A bis Z (ohne die schon gezeigten). „Kürzlich": nach `lastDate`,
  nur was im Fenster vorkommt. „Eigene": Abschnitt „Gespeicherte Trainings" mit Knopf „Neues Training", Abschnitt
  „Eigene Sportarten" mit Knopf „Eigene Sportart" (`CustomTypeDialog`). Text: gespeicherte Trainings nach Name und
  Sportnamen (`matchesTraining`), Sportarten nach Name (`normalize`), am Ende immer die Zeile „Eigene Sportart „q"
  anlegen" (Dialog mit vorbelegtem Namen, danach `/sport/$key`). Keine Leertexte mit Anleitung: leere Reiter zeigen
  nur „Noch nichts eingetragen." bzw. nichts (B3 ohne Eigene: nur die Knöpfe).
- Tipp auf ein gespeichertes Training → `/trainings/$id?date`; Tipp auf eine Sportart → `/sport/$key?date`
  (beide `push`; mit `into` nur Sportarten, Titel „Zu „Name" hinzufügen", `into` wird durchgereicht).
- `SportPicker` (`TrainingFields.tsx:30-125`) entfällt zugunsten der Suche; `CustomTypeDialog` bleibt.
- `AddSheet.tsx:148` und `ExerciseCard` bleiben auf `/exercise` (jetzt die Suche).

**Sportart-Seite `/sport/$typeKey` und `/exercise-entry/$entryId` (Mockup C)**, Datei `SportPage.tsx`, Vorbild
`FoodLogPage.tsx`:

- Kopfzeile: Titel = Sportname; rechts Speichern-Icon „Als Training speichern" (`BookmarkPlus`), im
  Bearbeiten-Modus zusätzlich Papierkorb. `DayNote` mit Datum. Zeile „Zuletzt 45 Min. · Mittel" und Marke
  „12× eingetragen" aus `trainingHistory` (nur neu, nur mit Verlauf).
- Felder: `DurationWheel`, Intensität (`ToggleGroup`, gesperrt bei eigener Sportart), kcal-Kasten (`TrainingKcal`,
  Block 8 macht ihn zum Feld), Notiz. Startwerte: Bearbeiten → der Eintrag (Dauer außerhalb des Rasters als eigene
  Zeile); neu → `last` der Sportart, sonst 30 Min. mittel.
- Fußleiste: „Eintragen · N kcal" (`logTrainings` mit einer Zeile, `useReturnToDiary` mit `focus`), mit `into`
  „Hinzufügen" (`addActivityToTraining`, dann `returnFromInto`), beim Bearbeiten „Änderungen übernehmen"
  (`saveExercise`, `entry.date`, `goBackOr`). `useSubmitting` überall.
- Speichern-Icon: `NameDialog` („Als Training speichern", Beschreibung „Radfahren, 45 Min. · Mittel"), dann
  `saveTraining` mit einer Aktivität; die Seite zeigt den Chip „Gespeichert als „Name"" (wie der „Gespeichert"-Chip
  der KI-Prüfung) und bleibt offen zum Eintragen. Beim Bearbeiten eines Teils eines Pakets (`groupId`) kein
  Speichern-Icon.
- Sportartwechsel gibt es auf der Seite nicht mehr (die Sportart ist die Seite); ein Eintrag mit anderer Sportart
  wird gelöscht und neu eingetragen. Damit entfällt die Regel „Sportartwechsel löst `templateId`"; ein Teil eines
  Pakets behält `groupId`/`templateId` einfach.
- Der Lösch-Toast nennt den Titel wie heute (`deleteEntry`, `ExercisePage.tsx:464`).

**„Training eintragen" `/trainings/$templateId?date` (Mockup D)**, Datei `TrainingLogView.tsx`, Vorbild
`MealLogView.tsx:54-135`, eingehängt in `TrainingEditorPage` wie `MealPage.tsx` (mit `date` die Ansicht, sonst der
Editor; Ansicht mit `key={template.updatedAt}`):

- Kopfzeile: Name, Speichern-Icon (aus, solange nichts abweicht), Stift → Editor mit `from=log`. `DayNote`, Zeile
  „Zuletzt am Dienstag" und Marke „N× eingetragen".
- Abschnitt „Aktivitäten" mit `TrainingRow` je Aktivität (gespeicherte Werte, eine Zeile offen); jede Zeile hält
  ihren Zustand (Dauer, Intensität, Notiz, eigene kcal ab Block 8). Weicht eine Zeile von den gespeicherten Werten
  ab, trägt sie die Marke „geändert" (Badge am Namen). Wischen nach links lässt eine Aktivität heute weg (Toast mit
  Rückgängig, mindestens eine bleibt, Muster `exclude` `MealLogView.tsx:95-113`); kein Satz, der das erklärt.
- Fußleiste „Eintragen · N kcal": `logTrainings` mit `group` für alle verbliebenen Zeilen, `templateId` je Zeile,
  kcal mit dem Gewicht des Tages; `returnToDiary({ focus: { rows } })`.
- Speichern-Icon → `SaveTrainingDialog` (Muster `SaveMealDialog.tsx`): Radio „„Name" aktualisieren" (Vorauswahl) /
  „Als neues Training speichern" (dann Namensfeld); Beschreibung beim Aktualisieren „Die Aktivitäten, wie sie hier
  stehen, ersetzen die von „Name". Bereits eingetragene Trainings bleiben, wie sie sind." (Folge einer Aktion, kein
  Erklärtext); `updateTraining` bzw. `saveTraining`; danach zeigt die Ansicht die gespeicherten Werte ohne „geändert".
- Eine Aktivität, deren Sportart es nicht mehr gibt, fehlt in der Ansicht mit Toast beim Öffnen.

**Routen (`router.tsx`)**: `/exercise` mit `date`, `q`, `tab`, `scope`, `into`; neu `/sport/$typeKey` mit `date`,
`into`; neu `/exercise-entry/$entryId`; `/trainings/$templateId` siehe Block 5. Alte Links auf
`/exercise?entryId=` gibt es nach dem Umbau nicht mehr (`ExerciseCard`, `DayShareImage` prüfen).

- Tests: E2E Test 1 (`diary-training.spec.ts:44-138`) umschreiben: Suche, Sportart-Seite mit Rädchen und „Genau
  eingeben" (47 Min.), Eintragen führt ins Tagebuch; gespeichertes Training öffnen, Aktivität ändern, „geändert",
  „aktualisieren"; zwei gespeicherte Trainings derselben Sportart; Reiter „Eigene"; Suche findet nach Name und
  Sportart; „Eigene Sportart „x" anlegen". `components.test.tsx`: `SaveTrainingDialog` (Radio nur mit
  `existing`), Suchzeilen (Lesezeichen/Pin, „N× eingetragen").

### Block 7: Tagebuch und Tagesbild (`ExerciseCard.tsx`, `DayShareImage.tsx`, `training.ts`)

- `ExerciseCard` rendert `groupTrainingEntries` (Mockup A): Paketzeile (Titel = aktueller Name des gespeicherten
  Trainings, sonst die Sportarten verbunden; darunter „N Aktivitäten · 75 Min." als Knopf zum Aufklappen; kcal-Summe),
  `li` mit `data-rows` (`diaryScroll.ts:66`). Teile: `ExerciseRowBody` mit der Sportart als Titel, Link nach
  `/exercise-entry/$id`, eigenes Wischen zum Löschen. Einzelne Zeilen linken ebenfalls nach `/exercise-entry/$id`;
  „+" und gestrichelter Hinweis nach `/exercise?date` (Suche). `TrainingSuggestions` unter den Zeilen (Chips
  „Zuletzt & häufig", angepinnte zuerst).
- Wischen nach links auf der Paketzeile löscht alle Teile in einer Transaktion, „Rückgängig" stellt genau diese
  Ids wieder her (Muster `removeEntriesWithUndo`, `MealCard.tsx:239-251`).
- Die Zeile „Trainingskalorien werden laut Einstellung nicht aufs Ziel angerechnet." (`ExerciseCard.tsx:96`) wird
  zu einer kurzen Zustandsmarke im Kartenkopf („nicht angerechnet" neben der kcal-Summe) statt eines Satzes.
- `DayShareImage.tsx:80`: Paketzeile geschlossen aus demselben Baustein (`TrainingGroupRowBody`).
- CSV (`export.ts:134`) und Berichte bleiben (Summen je Eintrag; Spalte „Training" steht bei jedem Teil).
- Tests: `apps/web/test/components.test.tsx:1716ff` (Tagesbild mit Paket), `apps/web/test/lib.test.ts:413`
  (`trainingTitle`, Gruppentitel), E2E: Paketzeile auf/zu, Teil bearbeiten, Paket löschen und zurückholen.

### Block 8: Eigene kcal (`TrainingFields.tsx` `TrainingKcal`, `TrainingRow.tsx`, `SportPage.tsx`, `TrainingLogView.tsx`)

- `TrainingKcal` wird ein Feld (`NumberField`, ganze Zahl, 0 bis 20.000, Mockup C2): zeigt den berechneten Wert,
  bis getippt wird; getippt bleibt er stehen (auch bei geänderter Dauer), das Feld ist farblich markiert
  (`border-exercise`, Ring) und darunter steht nur der Link „Berechneten Wert verwenden (N kcal)". Berechnet: die
  Formelzeile wie heute. Kein weiterer Satz.
- Zeile hält `kcalOwn: number | null`; `toLog` schreibt ihn als `kcal`. Bearbeiten erkennt ihn mit `isAutoKcal`.
- Nur auf der Sportart-Seite (neu und bearbeiten) und in „Training eintragen", nicht im Editor gespeicherter
  Trainings.
- Tests: `isAutoKcal`-Grenzen, Bearbeiten behält einen getippten Wert, Zurücksetzen; E2E: Wert tippen, Tagebuch
  zeigt ihn, Summe der Karte stimmt.

### Block 9: Kopieren (`db/clipboard.ts`, `ClipboardMenu.tsx`, `ExerciseCard.tsx`, `DiaryPage.tsx`, `MealCard.tsx`)

- `db/clipboard.ts`: `TrainingClipboard { kind: 'training', name, parts, copiedAt }` (Teil: Sportart, Dauer,
  Intensität, `met`, Notiz, `kcal`, `auto`, `templateId`, Gruppenmarke) unter demselben `kv`-Schlüssel;
  `readClipboard`/`useClipboard` liefern die Vereinigung, `Clipboard` bleibt der Essens-Typ.
  `copyTrainingToClipboard(db, name, entries)`.
- Eingrenzen an drei Stellen, der Compiler erzwingt es: `DiaryPage.tsx:157`, `DiaryMealPage.tsx:62` (Mahlzeiten
  bekommen nur Essens-Clips), Zweig in `ClipboardMenu` (Name, kcal, „Zwischenablage leeren", kein „Als Meal speichern").
- `ExerciseCard`: Wischen nach rechts (`SwipeToDelete onCopy`) kopiert Zeile oder Paket, Toast „„Name" kopiert."
  (ohne Anleitung, wo einzufügen ist: das Einfügen-Symbol erscheint im Kartenkopf vor dem „+", solange ein Training
  kopiert ist, Mockup A2). Den Toast in `MealCard.tsx:219` angleichen (nur „kopiert").
- `features/exercise/training.ts`: `copiesOf(parts, weightKg): TrainingToLog[]` (berechnete kcal neu mit dem
  gespeicherten `met` und dem Gewicht des Zieltags, getippte bleiben, Gruppen bekommen neue Ids) für Einfügen und
  „Wie gestern". Gebaut in der Komponente (Gewicht kommt aus `useCurrentWeight`), geschrieben mit `logTrainings`.
- „Wie gestern · N Trainings · N kcal": erster Chip der leeren Karte, wenn der Vortag Trainings hat (Mockup A3);
  ein Tipp trägt sie mit derselben Struktur ein, Toast mit „Rückgängig".
- Tests: neu `apps/web/test/trainingClipboard.test.ts` (kcal neu, getippt bleibt, neue `groupId`, Essens-Einfügen
  ignoriert den Clip), `ClipboardMenu`-Fall in `components.test.tsx`, E2E: kopieren, an anderem Tag einfügen, „Wie gestern".

### Block 10: Erklärtexte in der ganzen App

Regel des Nutzers (2026-11-06): keine Sätze, die die Bedienung erklären; die Oberfläche zeigt den Zustand. Bleiben
dürfen Folgen einer Aktion in Dialogen, Grenzen, die man sonst nirgends sieht, und Schrittfolgen, die das System
erzwingt (iOS-Installation). Durchsicht 2026-11-06 (Zeilen von `b933d7a`):

| Entfernen (ersatzlos oder durch Zustand)                                                                                                                                 | Behalten (Grund)                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `DiaryGroupPage.tsx:470` „Ändert nur diesen Eintrag …", `:481` „Skaliert alle Zutaten"                                                                                   | `DiaryGroupPage.tsx:426` nur den Teil „bis zu N Fotos" (Grenze)                                  |
| `AddFoodPage.tsx:373`, `:518`, `:458`, `:635`, `:670` (Leer- und Reitertexte mit Anleitung; Leerzustand nur noch ein kurzer Satz ohne „Tippe …")                         |                                                                                                  |
| `CustomFoodsPage.tsx:28`, `CustomFoodPage.tsx:226`, `:351`, `:371`, `FoodLogPage.tsx:496`                                                                                | `ScanPage.tsx:121`, `BarcodeScanSheet.tsx:43` „Halte den Barcode in den Rahmen." (Kameraführung) |
| `ScanPage.tsx:135`                                                                                                                                                       |                                                                                                  |
| `MealsPage.tsx:44` (Leerzustand → „Noch keine Meals."), `MealEditor.tsx:276`, `:277`, `:327/328`                                                                         | `SaveMealDialog.tsx:85/86` (Folge der Aktion)                                                    |
| `TrainingsPage.tsx:24`, `TrainingEditorPage.tsx:179`, `ExercisePage.tsx:264`, `:222` (entfallen ohnehin mit Block 5/6; „Standardgewicht" wird eine Marke am kcal-Kasten) |                                                                                                  |
| `ProgressPage.tsx:327` („rastet auf X kg ein" → der Schritt steht im Profil), `:310`, `:123`                                                                             | `ExpenditureCard.tsx:118` (Fortschritt bis zur Berechnung, Zustand)                              |
| `GoalsPage.tsx:242` (Feldhinweis `:253` reicht), `:286`, `OnboardingPage.tsx:221`, `:320`, `MacroPlanPicker.tsx:103` (→ Feld gesperrt mit Marke „Gewicht fehlt")         |                                                                                                  |
| `MorePage.tsx:91` (→ Zeilentitel „Training aufs Ziel anrechnen" trägt es), `ProfilePage.tsx:164`, `:189`, `AppearancePage.tsx:60`, `:124`                                | `AppearancePage.tsx:129-135` (iOS-Schritte), `AppBanners.tsx:220-243` (Installation)             |
| `ReminderPage.tsx:91`, `:130`, `MorePage.tsx:110`, `TrashPage.tsx:39`, `:45`                                                                                             | `DataPage.tsx:179`, `:221` (Grenzen des Systems)                                                 |
| `PhotoPage.tsx:514-516`, `:607`, `:450`, `:1096/1097/1139`, `:1235`                                                                                                      |                                                                                                  |

Jede Entfernung einzeln prüfen: zeigt das UI den Zustand schon? Wenn nicht, den Zustand sichtbar machen (Marke,
gesperrter Knopf, Titel), nicht den Satz behalten. Ein Commit für diesen Block; die Liste der behaltenen Texte mit
Grund in den Statusblock.

### Block 11: Doku

`CLAUDE.md` (Absätze „Saved trainings" und „Training entry" neu: Suche, Sportart-Seite, Training eintragen, Editor
mit `into=training:`, Dauer-Rädchen, Wording „Aktivität", Regel „keine Erklärtexte"), `docs/sync.md`, `README.md`
falls betroffen, Statusblock in `docs/plans/2026-11-gespeicherte-trainings.md`, Memory-Zeile der Feedback-Runden.

## Wichtige Dateien

- `packages/shared/src/schemas.ts`, `exercise.ts`, `diary.ts`
- `apps/api/src/db/schema.ts`, `apps/api/drizzle/0012_*.sql`, `apps/api/scripts/seed-demo.ts`
- `apps/web/src/db/entries.ts`, `trainingSuggestions.ts`, `clipboard.ts`, `trainingDraft.ts` (neu)
- `apps/web/src/components/DurationWheel.tsx` (neu), `Wheel.tsx`, `AmountEditor.tsx` (Vorbild)
- `apps/web/src/features/exercise/*` (neu: `TrainingSearchPage.tsx`, `SportPage.tsx`, `TrainingLogView.tsx`,
  `TrainingRow.tsx`, `SaveTrainingDialog.tsx`; weg: `ExercisePage.tsx`, `SportPicker`)
- `apps/web/src/features/diary/ExerciseCard.tsx`, `ClipboardMenu.tsx`, `DiaryPage.tsx`, `share/DayShareImage.tsx`
- `apps/web/src/features/more/TrashPage.tsx`, `apps/web/src/components/AddSheet.tsx`, `apps/web/src/app/router.tsx`,
  `apps/web/src/lib/into.ts`
- Wiederverwenden: `AddFoodPage.tsx` (Reiter-Mechanik), `FoodLogPage.tsx`, `MealLogView.tsx`, `MealEditor.tsx`,
  `db/mealDraft.ts`, `SaveMealDialog.tsx` (Muster), `NameDialog`, `DiscardDialog`, `ConflictBanner`, `SwipeToDelete`
  (`onCopy`), `goBackOr` (`lib/history.ts`), `useReturnToDiary` (`lib/logFlow.ts`), `useSubmitting`, `matchesTraining`.

## Verifikation

- Je Block: `pnpm lint`, `pnpm typecheck` (nacheinander), `pnpm test`. `pnpm e2e` nach den Blöcken 5, 6, 7 und 9.
- Sichtprüfung nach Block 9: Produktions-Build über die API (`WEB_DIST=…`), eigenes Playwright-Skript im
  iPhone-Format, hell und dunkel (Login nicht über Vite :5173, siehe Memory „Dev-Proxy-Login"), neben dem Mockup
  v3: Suche mit allen Reitern, Sportart-Seite mit Rädchen und „Genau eingeben", Training anlegen über die Suche,
  anpinnen, eintragen, abweichen und aktualisieren, eigene kcal, Paketzeile im Tagebuch, kopieren und einfügen,
  „Wie gestern", Tagesbild teilen, Papierkorb.
- Alt-Daten: mit `seed:demo` vor dem Umbau angelegte Trainings und Einträge zeigen sich unverändert (eine
  Aktivität, einzelne Zeilen, kein „eigener Wert").
- Nur am iPhone prüfbar (Liste in den Statusblock): Rädchen-Verhalten der Dauer (Finger liegt auf, Snap),
  „Genau eingeben" über der Tastatur, Wischen nach rechts auf Trainingszeilen, Tastatur über dem kcal-Feld.
- Deploy: die Migration `0012` läuft beim nächsten Start des Images; nicht pushen, bevor der Nutzer es sagt.

## Ablauf für die umsetzende Sitzung

1. `CLAUDE.md`, diesen Plan (vor allem „Entschieden" und „Annahmen") und das Mockup v3 lesen (im Browser oder
   per Playwright-Screenshot, Vorlage im Mockup-Kopf).
2. Blöcke 1 bis 11 in dieser Reihenfolge, ein Commit je Block (englische Nachricht, Attribution), jeder Block grün.
   Vor Block 2 den `offline-sync`-Skill lesen. Block 10 darf der Nutzer streichen oder verschieben; vorher fragen,
   ob er in diesem Zug gewünscht ist.
3. Keine Halbgeviert- oder Geviertstriche. Wording: eintragen (Tagebuch), speichern (wiederverwenden), nie
   „Vorlage", „Aktivität" für die Teile. Keine Erklärtexte im UI.
4. Abweichungen und neue Annahmen im Statusblock melden statt still zu entscheiden. Nicht pushen, bis der Nutzer
   es sagt.
