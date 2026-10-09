# Feedback-Runde 6: Implementierungsplan

Projekt: `/projects/Fleisch-Teufel`. Abgelegt als `docs/plans/2026-10-feedback-runde-6.md`, wird mit Block 1 committet.

## Context

Nach Runde 5 hat der User fünf Rückmeldungen gegeben, dazu drei Nachträge:

1. Name auf dem Homebildschirm „Fleisch Teufel“ statt „Fleisch-Teufel“.
2. Analysierte Mahlzeiten, die nicht als Meal gespeichert wurden, zeigen im Tagebuch trotzdem ihr Foto.
3. Ein Tipp auf eine Gruppe im Tagebuch öffnet einen Editor für genau diesen Eintrag (Menge, Gesamtmenge usw.).
   Das gespeicherte Meal bleibt unverändert.
4. Die Zutaten klappen nur noch über das Hütchen (Chevron) auf, nicht mehr über die ganze Zeile.
5. Bilder werden vor dem Speichern immer komprimiert und skaliert, höchstens 1080p.
6. Überschrittenes Eiweiß wird grün statt rot (Nachtrag).
7. Die Foto-Analyse wählt für zubereitete Speisen Instant-Produkte (Nachtrag). Beispiel Köttbullar von IKEA: Für
   Kartoffelpüree und Soße kamen „Kartoffelpüree Pulver“ und „Instant-Bratensoße“. Die Werte des trockenen Pulvers
   (rund 100 g Kohlenhydrate statt realistisch 50) verzerren die Schätzung stark.
8. In der Wochenleiste des Tagebuchs bekommen Tage mit Training zusätzlich zum roten Punkt (Essen eingetragen)
   einen blauen Punkt, und die Trainingsfarbe wird überall blau statt grün (Nachtrag).

### Entscheidungen (User, 2026-10-09)

- **Editor für alle Gruppen:** analysierte und aus gespeicherten Meals eingetragene Gruppen.
- **Editor-Umfang „Mehr“:**
  - Name ändern
  - Menge je Zutat und Gesamtmenge
  - Zutat entfernen
  - Zutat hinzufügen
  - Alles gilt nur für diese Einträge im Tagebuch.
- **Bildgröße:** Die heutigen, kleineren Größen bleiben:
  - Analyse-Fotos ca. 1 MP
  - Meal-Fotos 0,6 MP
  - Etikettfotos 2 MP

  1080p (lange Kante ≤ 1920, kurze ≤ 1080) kommt überall als feste Obergrenze dazu.

## Block 1: App-Name auf dem Homebildschirm

- `apps/web/vite.config.ts:33`: `short_name: 'Fleisch Teufel'`. `name` bleibt „Fleisch-Teufel“ (Marke in Login,
  „Über“, Titel).
- `apps/web/index.html:22`: `apple-mobile-web-app-title` auf „Fleisch Teufel“.
- Hinweis an den User: iOS übernimmt den Namen erst, wenn die App neu zum Homebildschirm hinzugefügt wird. Android
  aktualisiert den Namen mit dem Manifest.

## Block 2: Foto am Eintrag (Datenmodell)

Neues Sync-Feld nach `.claude/skills/offline-sync/SKILL.md` (vorher `docs/sync.md` lesen):

- `packages/shared/src/schemas.ts` `foodEntrySchema`: `photoId: idSchema.nullable().default(null)` mit Kommentar
  (Foto dieser Gruppe, bei allen Einträgen der Gruppe gleich; null für ältere Records).
- `apps/api/src/db/schema.ts` `foodEntries`: `photoId: text()`, Migration
  `pnpm --filter @ft/api db:generate -- --name food-entry-photo` (wie `0003_food-entry-group-name.sql`).
- Dexie: kein Index, also keine neue Version.
- Neue Einträge setzen `photoId: null`: `logFoodEntry` (`db/entries.ts:32`), Quick-Add, alle `saveRecord`-Stellen
  für `foodEntries`; `NewFoodEntry` Omit ergänzen.
- Server: Wie bei `meals.photoId` gibt es kein Löschen von Fotos. Die Foto-Route prüft keine Referenzen, daher ist
  dort nichts zu tun.
- `apps/api/test/sync.test.ts`: Round-Trip mit `photoId`.

## Block 3: Foto bei analysierten Mahlzeiten ohne Speichern

- `logItems` (`db/entries.ts:75`) bekommt `opts.photoId` und schreibt es in jeden Eintrag der Gruppe.
- `logAiItems` bekommt `photo: Blob | null`, speichert es mit `storePhoto` und gibt die `photoId` an `logItems`.
  Den Doc-Kommentar „without storing the photo“ anpassen.
- `logAiMeal`: Die Einträge bekommen die `photoId` des Meals (der Eintrag behält sein Foto, auch wenn das Meal später
  ein anderes bekommt).
- `PhotoPage.tsx`: Beim „Meal eintragen“ ohne Speichern das Foto aus `aiImages` übergeben (`imageBlob`, wie bei
  `createAiMeal`).
- `DiaryRows` (`features/diary/MealCard.tsx:157`): `photoId` = `entries[0].photoId` vor dem Foto des Meals.
- `copy`/`logItems` aus Tagebuch-Einträgen (Kopieren eines Tages) übernimmt `photoId` nicht automatisch, weil nur die
  Item-Felder kopiert werden. Das ist in Ordnung, ein kopierter Tag zeigt dann das Meal-Foto oder das Icon.

## Block 4: Zeile öffnet Editor, Hütchen klappt auf

`GroupRow` (`MealCard.tsx:245`) wird geteilt:

- Die Zeile (Foto, Name, kcal) wird ein `Link` auf den neuen Editor.
- „N Zutaten ⌄“ wird ein eigener `button` mit `aria-expanded`/`aria-controls`. Die Trefferfläche wird per Padding und
  negativem Margin auf 44 px vergrößert, ohne dass die Zeile höher wird. Dazu `stopPropagation` und `draggable={false}`.
- Swipe und Long-Press-Drag bleiben auf der ganzen Zeile. `SwipeToDelete` schluckt den Klick nach einem Wischen bereits.
- Gilt auch auf `/diary-meal`, weil beide `DiaryRows` nutzen.
- Name in der Zeile: `groupName` vor dem Namen des Meals, damit eine Umbenennung im Editor sichtbar wird. Bei Gruppen
  aus Meals ist `groupName` sonst null.

## Block 5: Editor für einen Tagebuch-Eintrag (Gruppe)

**Route:** `/diary-group/$groupId?date=` (`app/router.tsx`, lazy). `features/diary/DiaryGroupPage.tsx` lädt die
Einträge über `[date+meal]`/`date` gefiltert nach `groupId` und mountet dann die Form mit `initial` und `key`
(React-Compiler-Muster).

**Device-Entwurf** `apps/web/src/db/groupDraft.ts` (in `kv`, keine `@/`-Imports), nach dem Vorbild von
`db/mealDraft.ts`:

- `GroupDraft { groupId, date, name, items: (MealItem & { entryId?: string })[] }`
- `draftFromEntries`, `readGroupDraft`, `writeGroupDraft`, `clearGroupDraft`, `isDirty`
- `addItemToGroupDraft` für die Lebensmittelsuche
- `saveGroupDraft`: in einer Schleife über `patchRecord`/`saveRecord`/`deleteRecord`
  - Bestehende Einträge bekommen `quantity`/`grams`/`nutrients`/`groupName`.
  - Entfernte Einträge werden gelöscht (Soft-Delete).
  - Neue Einträge bekommen dieselbe `groupId`, `mealId`, `photoId`, `date`, `meal` und `aiAnalysisId`.
    `loggedAt` liegt hinter dem letzten Eintrag.
  - Das Meal (`meals`) wird nie angefasst.

**Oberfläche** (Aufbau wie `MealEditor`, Wiederverwendung):

- Foto read-only (`MealPhoto`)
- Name (`Input`)
- je Zutat `IngredientCard` (`features/meals/IngredientCard.tsx`) mit Slider, Zahlfeld, Entfernen und Nährwerten
- „Zutat hinzufügen“ (Suche mit `into=group:<groupId>`)
- Gesamtmenge-Slider mit derselben `scaleBase`-Logik wie `MealEditor.tsx:82-100`, die als kleine gemeinsame
  Hilfsfunktion herausgezogen wird
- `NutrientBreakdown` „Summe“ gegen die Ziele des Eintragstags
- Hinweis bei Gruppen aus einem Meal: „Ändert nur diesen Eintrag. Das gespeicherte Meal bleibt, wie es ist.“
- Header: Papierkorb löscht die ganze Gruppe mit Undo-Toast (`removeEntriesWithUndo`) und geht dann zurück.
- Footer: „Änderungen übernehmen“ (Wording-Regel); danach mit `goBackOr` zurück.
- Verlassen mit Änderungen: `useBlocker` und `DiscardDialog`, Ausnahme für den Weg in die Suche (wie im
  `MealEditor`).
- Mindestens eine Zutat bleibt. Eine Gruppe mit einer Zutat erscheint im Tagebuch als normaler Eintrag (heutiges
  Verhalten von `groupDiaryEntries`).

**Suche mit Ziel:** In `src/lib/into.ts` kommt `group:<groupId>` dazu, neben `meal:` und `ai:`. Betroffen sind
`/add`, `/food/$foodId`, `/scan` und `/custom-food/$id`: Sie hängen über `addItemToGroupDraft` an und kehren mit
`returnFromInto` zurück. Alle Stellen, die `meal:` auswerten, bekommen den dritten Fall.

## Block 6: Bilder einheitlich begrenzen

`features/ai/image.ts`:

- Die Größenberechnung wird zur reinen Funktion `fitSize(w, h, maxPixels)` und ist damit testbar.
- Zusätzlich zur Pixelzahl gilt die Obergrenze 1080p: lange Kante ≤ 1920 und kurze Kante ≤ 1080.
  Der kleinere Faktor gewinnt.
- Benannte Voreinstellungen ersetzen die verstreuten Zahlen:

  | Voreinstellung | Pixel | Qualität | Verwendung |
  | --- | --- | --- | --- |
  | `IMAGE_PRESETS.analysis` | 1 MP | 0,82 | `PhotoPage` |
  | `IMAGE_PRESETS.mealPhoto` | 0,6 MP | 0,8 | `MealEditor` |
  | `IMAGE_PRESETS.label` | 2 MP | 0,85 | `LabelCaptureSheet`; dort greift die 1080p-Grenze, also ca. 1440×1080 |

- Prüfen, dass jeder `storePhoto`-Aufruf ein so komprimiertes Bild bekommt:
  - `createAiMeal` und neu `logAiItems` bekommen das Bild aus `aiImages` (komprimiert).
  - `saveMealDraft` bekommt das Bild aus `MealEditor.pick` (komprimiert).
  - Kommentar an `storePhoto` schärfen.
- Bereits gespeicherte Fotos sind schon ≤ 1 MP und werden nicht nachbearbeitet.

## Block 7: Überschrittenes Eiweiß wird grün (Nachtrag User, 2026-10-09)

- **Heute:** Überschreitungen sind rot. `TargetBar` in `components/MacroBars.tsx` färbt den Balken bis zum doppelten
  Ziel `--over`, darüber dunkelrot `--over-2`; der Text ist `text-over`. Alle Nährwerte laufen über
  `NutrientBreakdown`.
- **Neu:** Beim Eiweiß wird der überschrittene Teil grün, Balken und Zahl.
  - Neues Token `--over-good` (Utilities `bg-over-good`, `text-over-good`): hell `oklch(0.53 0.13 155)`, dunkel unter
    `:root.dark` `oklch(0.6 0.13 155)` (User: im Dunkeln dunkler). Als Text mindestens 4,5:1, gegen `--protein` mit dem dataviz-Paletten-Checker
    geprüft (hell und dunkel). Mockup: Abschnitt 5 in `docs/plans/2026-10-feedback-runde-6-mockup.html`.
  - `TargetBar` bekommt eine Prop wie `overTone: 'bad' | 'good'`. `NutrientBreakdown` setzt `good` für `N.protein`.
  - Kalorien, Fett, Kohlenhydrate und Mikros mit Höchstwert bleiben rot.
- **Wo:** überall, wo Eiweiß gegen ein Ziel steht:
  - Tagesübersicht
  - Nährwerte je Mahlzeit und Zutat
  - Berichte
  - Makro-Leisten auf der Kalorienkarte
- **Offene Fragen (Vorschlag als Standard):**
  1. Über dem doppelten Ziel bleibt das Eiweiß grün, ohne zweite Stufe.
  2. Nur Eiweiß wird grün; andere Mindestziele wie Ballaststoffe bleiben wie heute.
- **Test:** Komponententest (`apps/web/test/components.test.tsx`): Eiweiß über dem Ziel trägt die grüne Klasse, Fett
  die rote.

## Block 8: Foto-Analyse wählt keine Trockenprodukte (Nachtrag User, 2026-10-09)

- **Ursache:** Das Modell nennt nur Namen, Suchbegriffe und Gramm. Die Nährwerte kommen aus `matchItem`
  (`apps/api/src/ai/match.ts`), und dort gewinnt bei „Kartoffelpüree“ oder „Bratensoße“ offenbar ein Eintrag für das
  trockene Pulver bzw. das Instant-Produkt. Dessen Werte pro 100 g gelten für das Pulver, nicht für die verzehrfertige
  Speise. Die Gramm des Modells beziehen sich aber auf die fertige Speise.
- **Zuerst prüfen:** die BLS- und OFF-Kandidaten für „Kartoffelpüree“, „Kartoffelbrei“, „Bratensoße“,
  „Rahmsoße“ und „Soße“ über die echte lokale Suche ausgeben. Dabei ermitteln, welche Wörter die BLS für Trocken- und
  Fertigprodukte verwendet (z. B. „Pulver“, „Trockenprodukt“, „Instant“, „Konzentrat“, „ungekocht“, „verzehrfertig“,
  „zubereitet“). Abweichungen vom Plan melden.
- **Matching** (`match.ts`):
  - Kandidaten, deren normalisierter Name ein Trockenwort enthält, bekommen einen deutlichen Abzug, außer der Name
    oder ein Suchbegriff des Items enthält das Wort selbst (z. B. „Proteinpulver“, „Kakaopulver“). Die Wortliste
    steht als benannte Konstante mit Kommentar im Modul.
  - Kandidaten mit „zubereitet“ oder „verzehrfertig“ bekommen einen kleinen Bonus, wenn das Item nicht verpackt ist.
  - Die Gewichte so wählen, dass ein zubereiteter BLS-Eintrag vor dem Pulver landet, das Pulver aber als Alternative
    in der Kandidatenliste bleibt.
- **Prompt** (`prompt.ts`, vorher den `claude-api`-Skill laden):
  - Suchbegriffe beschreiben die Speise so, wie sie gegessen wird, also zubereitet bzw. verzehrfertig, nie das
    Trocken- oder Instant-Produkt. Beispiele: `["Kartoffelpüree zubereitet", "Kartoffelpüree", "Kartoffelbrei"]`,
    `["Bratensoße", "Soße hell", "Soße"]`.
  - Die Gramm beziehen sich immer auf die fertige Speise auf dem Teller.
- **Test** (`apps/api/test`, neben den bestehenden `matchItem`-Tests, sonst neue Datei): Mit einer Fake-Suche, die
  Pulver und zubereiteten Brei mit ähnlichem Score liefert, gewinnt der zubereitete Brei. „Proteinpulver“ findet
  weiterhin das Pulver. Zusätzlich gegen die echte BLS-Suche: „Kartoffelpüree“ liefert als ersten Kandidaten keinen
  Trockeneintrag.
- Bereits eingetragene Analysen bleiben unverändert.

## Block 9: Blauer Punkt für Trainingstage, Trainingsfarbe blau (Nachtrag User, 2026-10-09)

Mockup: `docs/plans/2026-10-feedback-runde-6-mockup.html` (v3, entschieden).

- **Heute:** `WeekStrip` (`features/diary/WeekStrip.tsx`) zeigt unter dem Datum einen Punkt (`bg-primary`, auf dem
  gewählten Tag `bg-primary-foreground`), wenn `useLoggedDates` (`hooks/data.ts`) für den Tag Essenseinträge findet.
  Die Trainingsfarbe `--exercise` ist grün (`oklch(0.62 0.13 165)`, ein Wert für hell und dunkel) und färbt die kcal
  in der Trainingskarte (`ExerciseCard.tsx`) und `TrainingKcal` (`TrainingFields.tsx`).
- **Trainingsfarbe blau:** `--exercise` hell `oklch(0.5 0.12 230)`, dunkel neu unter `:root.dark`
  `oklch(0.67 0.12 230)`. Als Text auf Karte und `bg-muted` mindestens 5:1, gegen den roten Essenspunkt mit dem
  dataviz-Paletten-Checker geprüft (hell und dunkel). Bewusst heller und türkiser als Protein (`--protein`, Farbton
  250); beide stehen nie im selben Diagramm. Kein eigenes Punkt-Token, der Punkt nutzt `bg-exercise`.
- **Daten:** neuer Hook `useTrainedDates(from, to)` neben `useLoggedDates`, über den Index `exerciseEntries.date`
  (kein neuer Index), gelöschte Einträge ausgefiltert.
- **Darstellung:**
  - Unter dem Datum eine Punktreihe mit fester Höhe, damit die Kacheln nicht springen.
  - Rot (Essen) immer links, blau (Training) immer rechts, mit kleinem Abstand. Ein Tag nur mit Training zeigt nur
    den blauen Punkt.
  - Gewählter Tag: Essenspunkt `bg-primary-foreground`, blauer Punkt bleibt `bg-exercise` **ohne Ring**
    (Entscheidung User, Mockup Variante B).
- **Barrierefreiheit:** Die Punkte bleiben `aria-hidden`. Das `aria-label` des Tages bekommt die Zustände angehängt,
  z. B. „Donnerstag, 9. Oktober, Essen eingetragen, Training eingetragen“.
- **Test:** Komponententest (`apps/web/test/components.test.tsx` oder eigener Test mit `fake-indexeddb`): Ein Tag mit
  Training zeigt den blauen Punkt und das Label „Training eingetragen“, ein Tag ohne nicht. Ein gelöschtes Training
  zählt nicht.

## Block 10: Doku

`CLAUDE.md` ergänzen:

- `photoId` an Einträgen
- Gruppen-Editor `/diary-group`, `db/groupDraft.ts`, `into=group:`
- Chevron klappt auf, Zeile öffnet
- `IMAGE_PRESETS` mit 1080p-Grenze
- Eiweiß-Überschreitung grün (`--over-good`) bei den Balken für Überschreitungen
- AI-Matching: Trocken- und Instant-Produkte werden abgewertet, die Suchbegriffe beschreiben die verzehrfertige
  Speise
- Wochenleiste: roter Punkt für Essen, blauer für Training; Trainingsfarbe `--exercise` ist blau

Planablage in `docs/plans`. Ein Commit pro Block wie in Runde 5; Push nur nach Rückfrage.

## Verification

- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm e2e`
- Neue Tests:
  - `fitSize` (z. B. 4032×3024 bei 2 MP wird 1440×1080, bei 1 MP 1155×866)
  - `saveGroupDraft` (`apps/web/test/write.test.ts`): Patch, Löschen, Hinzufügen; das Meal bleibt unverändert
  - Sync-Round-Trip mit `photoId`
  - `matchItem`: zubereiteter Brei vor Pulver, „Proteinpulver“ bleibt Pulver
  - Wochenleiste: blauer Punkt und Label an Trainingstagen
  - E2E in `diary-training.spec.ts` oder `meals-goals.spec.ts`: Tipp auf die Gruppenzeile öffnet den Editor, das
    Hütchen klappt auf, „Änderungen übernehmen“ ändert die kcal im Tagebuch, das gespeicherte Meal bleibt gleich
- Manuell im Produktions-Build über die API (`WEB_DIST=… pnpm --filter @ft/api dev`), Port 25565 vom PC aus:
  - Foto analysieren und ohne Speichern eintragen: Das Foto erscheint in der Tagebuchzeile.
  - Zeile antippen, Menge ändern, Zutat hinzufügen, übernehmen.
  - Die Größe des gespeicherten Fotos in IndexedDB prüfen.
