# Meals einheitlich: speichern, kopieren und vorschlagen überall gleich

Ablage im Repo bei Umsetzung: `docs/plans/2026-10-meals-einheitlich.md` (Kopie dieser Datei, kommt mit Block 1 in den Commit).

## Context

Der Nutzer hat am 2026-10-25 die Meal-Funktionen auf Einheitlichkeit geprüft. Heute sind Speichern, Kopieren und
Vorschlagen an verschiedenen Stellen unterschiedlich möglich:

| Was                                                    | Heute                                                                                   | Lücke                                                                         |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Gruppe (Foto-Analyse, Meal) als Meal speichern         | nur über Zwischenablage-Menü (`ClipboardMenu`) oder in der KI-Prüfung vor dem Eintragen | im Gruppen-Editor (`/diary-group`, Tipp auf die Zeile) gibt es kein Speichern |
| Tagesmahlzeit (Mittagessen) als Meal speichern         | Speichern-Symbol auf `/diary-meal` (`saveMealFromEntries`)                              | im Tagebuch nicht sichtbar; Foto nur, wenn der erste Eintrag eines hat        |
| Tagesmahlzeit kopieren                                 | nur „Wie gestern“-Chip bei leerer Mahlzeit                                              | keine Zwischenablage für eine ganze Mahlzeit                                  |
| „Zuletzt hier“-Vorschläge                              | nur bei leerer Mahlzeit (`MealCard`)                                                    | sollen dauerhaft sichtbar sein                                                |
| Gespeichertes Meal in Meal/Gruppe/KI-Prüfung aufnehmen | Suche blendet Meals im `into`-Modus aus (`withMeals = !into`, `AddFoodPage.tsx`)        | geht nicht                                                                    |
| Neues Meal anlegen                                     | nur aus dem Tagebuch, der Zwischenablage oder der KI-Prüfung                            | kein „Neues Meal“ auf `/meals`                                                |

Ziel: Jede Stelle, die eine Mahlzeit oder Gruppe zeigt, bietet dieselben Aktionen mit denselben Wörtern; ein Meal
in einem Meal wird immer in seine Einzelteile aufgelöst (das Datenmodell kennt nur Lebensmittel als Zutaten, das bleibt so).

### Entschieden (mit dem Nutzer, 2026-10-25)

- Direkt Implementierungsplan, kein Mockup.
- Kartenkopf jeder Tagesmahlzeit im Tagebuch: **[Einfügen] [⋯] [+]**. Das „+“ bleibt ganz rechts, das ⋯-Menü
  steht davor, das Einfügen-Symbol (nur wenn etwas kopiert ist) ganz links. Gleiches Menü im Kopf von `/diary-meal`.
- Gruppen-Editor: Speichern-Symbol; stammt die Gruppe aus einem gespeicherten Meal, bietet der Dialog **„Als neues
  Meal“ oder „Meal aktualisieren“**.
- Vorschläge **unter den Einträgen, ohne Doppeltes**: was heute schon in dieser Mahlzeit steht, fällt raus; „Wie
  gestern“ als Chip nur bei leerer Mahlzeit (im ⋯-Menü immer).
- Mit dabei: **gespeichertes Meal als Zutaten hinzufügen** und **„Neues Meal“ von Grund auf**.
- Nachtrag: Hinweis der Analyse wird ein mitwachsendes, mehrzeiliges Feld (Block 9).
- Nicht dabei: Kopieren-Symbol ohne Wischen, ganzen Tag kopieren.

### Annahmen (im Plan festgelegt, bei Widerspruch melden statt still zu entscheiden)

- ⋯-Menü-Einträge: „Kopieren“, „Als Meal speichern“, „Wie gestern eintragen“, Trenner, „Alle Einträge löschen“
  (mit Rückgängig-Toast wie jedes Löschen). Leere Mahlzeit: Kopieren, Speichern, Löschen deaktiviert; „Wie gestern
  eintragen“ nur, wenn gestern etwas in dieser Mahlzeit steht. Laufende Analysen (`PendingAnalysisRow`) werden weder
  kopiert noch gespeichert noch gelöscht.
- Speichern im Gruppen-Editor schreibt **das, was der Editor zeigt** (Entwurf), übernimmt damit auch die offenen
  Änderungen in die Tagebuch-Einträge und **verknüpft die Gruppe mit dem Meal** (`mealId`, eigener Name wird `null`,
  wenn er dem Meal-Namen gleicht; `aiAnalysisId` und Fotos bleiben). Danach schließt der Editor wie bei „Änderungen
  übernehmen“. Grund: Eintrag und Meal stimmen danach überein, und „Zuletzt hier“ zählt die Gruppe als dieses Meal
  (gleiches Verhalten wie `logAiMeal` in der KI-Prüfung).
- „Meal aktualisieren“ ersetzt Name und Zutaten des Meals (gelöschtes Meal kommt zurück, wie in `logAiMeal`), behält
  sein Foto (hat es keins: erstes Foto der Gruppe) und `cookedGrams`. Hinweis im Dialog: „Bereits eingetragene Tage
  bleiben, wie sie sind.“ Standardauswahl ist „Als neues Meal“.
- Ein gespeichertes Meal aus einer Tagesmahlzeit oder Zwischenablage nimmt alle Zutaten einzeln auf (Gruppen
  aufgelöst, Mengen wie eingetragen) und als Foto das **erste Foto irgendeiner Gruppe** der Mahlzeit.
- Zwischenablage mit einer ganzen Mahlzeit (`kind: 'meal'`): Einfügen behält die Struktur (Gruppen bleiben Gruppen mit
  `mealId`/`groupName`/`aiAnalysisId`/`photoIds`, Einzeleinträge bleiben einzeln), wie „Wie gestern“.
- Meal als Zutaten (`into`-Modus): Tipp auf ein Meal öffnet `MealLogView` im Hinzufügen-Modus (Menge 0,5× bis 2×,
  „Gegessen (gekocht)“, Zutaten wegwischen), Fußleiste „N Zutaten hinzufügen“, keine Mahlzeit-Auswahl. Das Meal, das
  gerade bearbeitet wird, steht nicht in der Liste (kein Meal in sich selbst).
- Vorschläge laufen künftig für alle Mahlzeiten des Tages: **eine** Live-Abfrage pro Tag statt einer pro Karte.
- Vorschläge auch auf `/diary-meal` unter den Einträgen (gleiche Komponente).

## Umsetzung

### Block 1: Gemeinsame Bausteine für Mahlzeiten (`db/entries.ts`, `db/suggestions.ts`)

Heute bauen `copyMealFromDay` (suggestions.ts), `pasteClipboard` und `logSuggestion` je eigene Gruppenfelder aus
`groupDiaryEntries`. Vereinheitlichen:

```ts
/** One row of a diary meal as something that can be logged again: a plain entry or a group. */
export interface DiaryPart {
  kind: 'entry' | 'group';
  items: MealItem[];
  mealId: string | null;
  groupName: string | null;
  aiAnalysisId: string | null;
  photoIds: string[];
}
export function diaryParts(entries: readonly FoodEntry[]): DiaryPart[]   // via groupDiaryEntries, sortiert nach loggedAt
export async function logParts(db, parts, target): Promise<string[]>    // eine Transaktion, je Part logItems
export function partsItems(parts): MealItem[]                           // flach, für Speichern/kcal
export function firstPhotoId(entries | parts): string | null            // erstes Foto irgendeiner Gruppe
```

- `logParts`: Gruppe ohne `mealId` und ohne `groupName` bekommt `'Meal'` (heutige Regel aus `copyMealFromDay`),
  Einzel-Part ruft `logItems` ohne Gruppenoptionen. Transaktion über `[foodEntries, outbox]` (wie heute).
- `copyMealFromDay` wird zu `logParts(db, diaryParts(entries), to)`. `logSuggestion` und `pasteClipboard` nutzen
  dieselbe Part-Logik (Gruppe → `logItems` mit Gruppenfeldern), keine dritte Kopie der Fallback-Regel.
- `saveMealFromEntries` nimmt `firstPhotoId(entries)` statt nur des ersten Eintrags (Fix: Mittagessen mit Brot vor
  der Foto-Gruppe bekam kein Foto).
- Neu `removeMealEntries` ist nicht nötig: `removeEntriesWithUndo` (`MealCard.tsx`) nimmt die Liste schon in einer
  Transaktion.

Tests `apps/web/test/write.test.ts` / `suggestions.test.ts`: `diaryParts` (Einzel + Meal-Gruppe + KI-Gruppe),
`logParts` neue Ids und `groupId`s, Struktur erhalten; „Wie gestern“ verhält sich unverändert (bestehende Tests grün);
`saveMealFromEntries` mit Foto in der zweiten Zeile.

### Block 2: Zwischenablage für eine ganze Mahlzeit (`db/clipboard.ts`, `ClipboardMenu.tsx`, `MealCard.tsx`)

- `Clipboard.kind` erweitert um `'meal'`; neues optionales Feld `parts?: DiaryPart[]` (nur bei `meal`). `items` bleibt
  die flache Liste (dann funktionieren `clipboardKcal` und „Als Meal speichern“ unverändert). Alte gespeicherte
  Zwischenablagen (`entry`/`group`) bleiben gültig.
- `copyMealToClipboard(db, name, entries)`: `parts = diaryParts(entries)`, `items = partsItems(parts)`,
  `photoIds = firstPhotoId` als einziges Element (für das Meal-Foto beim Speichern), Gruppenfelder `null`.
- `pasteClipboard`: `kind === 'meal'` → `logParts(db, clip.parts ?? [], target)`.
- `ClipboardMenu`: „Als Meal speichern“ auch für `meal`; Detailzeile „N Einträge“ (`fmt0`) statt Zutaten.
  Beschreibung im Speichern-Dialog: „Alle N Zutaten werden einzeln als wiederverwendbares Meal gespeichert.“
- Toast beim Kopieren gleich wie bei Zeilen (`copyWithToast`-Text), Name = Mahlzeitname („Mittagessen“).

Tests: Mittagessen mit Einzel + Gruppe kopieren → in Abendessen eines anderen Tages einfügen: zwei Zeilen, Gruppe mit
gleicher `mealId`/Fotos, neue `groupId`; als Meal speichern → ein Meal mit allen Zutaten flach und Foto; altes
`group`-Clipboard aus `kv` wird weiter eingefügt.

### Block 3: ⋯-Menü der Tagesmahlzeit (`features/diary/DiaryMealMenu.tsx` neu, `MealCard.tsx`, `DiaryMealPage.tsx`)

- Neue Komponente `DiaryMealMenu({ date, meal, mealName, entries, iconClassName })` mit `DropdownMenu`
  (Vorlage: `ClipboardMenu`), Trigger `MoreHorizontal`, `aria-label="Aktionen für {mealName}"`. Einträge:
  - „Kopieren“ (`Copy`) → `copyMealToClipboard`, Toast.
  - „Als Meal speichern“ (`Save`) → `NameDialog` (Text und `defaultName` `${mealName} ${fmtDate(date)}` aus
    `DiaryMealPage` hierher verschieben) → `saveMealFromEntries`.
  - „Wie gestern eintragen“ (`History`) → `copyMealFromDay` mit Rückgängig (Logik aus `MealSuggestions` als
    exportierte Funktion teilen, nicht kopieren); nur wenn gestern etwas da ist (Wert aus Block 4 `yesterdayKcal`).
  - Trenner, „Alle Einträge löschen“ (`Trash2`, `variant="destructive"`) → `removeEntriesWithUndo(db, entries,
"{mealName} geleert")`.
  - Alle Aktionen über `useSubmitting()`.
- `MealCard`: `action` = `[PasteButton] [DiaryMealMenu] [+]`. Kopfzeile bleibt eine Zeile (drei 40-px-Icons passen auf
  375 px; in `ios-layout.spec.ts` prüfen).
- `DiaryMealPage`: das bisherige Speichern-Symbol entfällt, stattdessen dasselbe Menü; Reihenfolge `[Einfügen] [⋯] [+]`.
  Doku-Kommentare beider Dateien anpassen.
- Leeres Meal-Liste-Text in `MealsPage` anpassen: „Im Tagebuch über ⋯ einer Mahlzeit oder das Speichern-Symbol eines
  Eintrags, oder oben mit „Neues Meal“.“

Tests `components.test.tsx` (falls dort Diary-Komponenten gerendert werden, sonst E2E): Menü deaktiviert bei leerer
Mahlzeit, Löschen mit Rückgängig stellt alle wieder her.

### Block 4: Vorschläge dauerhaft (`db/suggestions.ts`, `hooks/data.ts`, `MealSuggestions.tsx`, `MealCard.tsx`)

- `mealSuggestions` → `daySuggestions(db, date, limit = 4): Promise<Map<number, { suggestions; yesterdayKcal }>>`:
  liest die 60 Tage **einmal**, gruppiert nach `meal`, und liest die Einträge von `date` mit. Die Schlüssel-Logik
  (`food:<id>`, `meal:<id>`, `group:<name>`) als `suggestionKey(row)` herausziehen; Schlüssel, die am `date` in dieser
  Mahlzeit schon stehen, fallen raus, **bevor** auf `limit` gekürzt wird (sonst bleiben weniger als 4 übrig).
  `mealSuggestions(db, date, meal)` bleibt als dünner Wrapper für die Tests.
- Hook `useDaySuggestions(date)` ersetzt `useMealSuggestions`; einmal in `DiaryPage` und `DiaryMealPage`, Ergebnis per
  Prop an `MealCard` → `MealSuggestions` (Muster wie `clipboard`).
- `MealSuggestions` bekommt `data` und `empty` als Props: „Wie gestern“-Chip nur bei `empty`; mit Einträgen steht die
  Reihe unter den Zeilen (und unter `PendingAnalysisRow`s) mit `border-t border-border/70 pt-3`, gleiche Chips.
  Überschrift bleibt „Zuletzt hier“. Doku-Kommentar („Nothing shows while the meal has entries“) ersetzen.
- `MealCard`: `MealSuggestions` aus dem Leer-Zweig in beide Zweige; leerer Zweig unverändert (gestrichelter Button,
  dann Chips).
- Nach einem Tipp verschwindet der Chip (steht jetzt in der Mahlzeit), „Rückgängig“ bringt ihn zurück: kein
  Extra-Code, folgt aus der Live-Abfrage.

Tests `suggestions.test.ts`: Vorschlag eines heute schon eingetragenen Lebensmittels/Meals fällt raus und der
fünftbeste rückt nach; `daySuggestions` liefert dieselben Ergebnisse wie bisher pro Mahlzeit; `yesterdayKcal` pro
Mahlzeit.

### Block 5: Gruppe als Meal speichern (`db/groupDraft.ts`, `DiaryGroupPage.tsx`, `components/SaveMealDialog.tsx` neu)

- `saveGroupDraft(db, draft, opts?: { asMeal?: { mode: 'new' | 'update'; name: string } })`, alles in **einer**
  Transaktion (zusätzlich `db.meals`):
  1. Fotos speichern wie heute (`photos`), danach `groupPhoto = photos.photoIds?.[0] ?? meal?.photoId ?? null`.
  2. `new`: `saveRecord('meals', { id: uuidv7(), name, items: draft.items.map(mealItem), photoId: groupPhoto,
cookedGrams: null })`. `update`: Meal der Gruppe (`first.mealId`) wiederherstellen falls gelöscht, `patchRecord`
     mit `name`, `items`, `photoId: meal.photoId ?? groupPhoto`.
  3. Die Einträge (behaltene und neue) bekommen `mealId` des Meals; `groupNameValue` wird gegen den **neuen**
     Meal-Namen gerechnet (gleich → `null`). Bei `asMeal` gilt jede behaltene Zeile als geändert, wenn sich `mealId`
     ändert.
     Rückgabe bleibt `boolean`; zusätzlich die Meal-Id (z. B. `{ ok, mealId }` oder eigene Funktion
     `saveGroupAsMeal`, die `saveGroupDraft`s Kern teilt; keine zweite Kopie der Eintragslogik).
- `SaveMealDialog` (neu, auf `NameDialog` aufbauend oder dessen Formular erweitert): Name-Feld; nur mit `existing`
  (`{ name }` des Meals) zusätzlich zwei Optionen als `RadioGroup` (shadcn, ggf. per CLI hinzufügen; Import auf
  `@/lib/utils` prüfen): „Als neues Meal speichern“ / „„{name}“ aktualisieren“. Beim Umschalten auf aktualisieren
  füllt sich der Name mit dem Meal-Namen. Beschreibung: Zutatenzahl, bei `dirty` „Übernimmt auch deine Änderungen an
  diesem Eintrag.“, bei update „Bereits eingetragene Tage bleiben, wie sie sind.“ Bestätigen „Meal speichern“.
- `DiaryGroupPage`: Header-Symbol `Save` („Als Meal speichern“) zwischen ↻ und Löschen, deaktiviert während
  `busy || saving`. Nach Erfolg: Toast „„{name}“ gespeichert“, `leaving.current = true`, `goBackOr` wie
  `saveAndClose`. `existing` nur, wenn `first.mealId` und `data.meal` vorhanden.
- Hinweistext unter „Zutat hinzufügen“ („Ändert nur diesen Eintrag…“) bleibt.
- Später: `ClipboardMenu` und `DiaryMealMenu` nutzen `SaveMealDialog` ohne `existing` (ein Dialog für alle drei
  Stellen; `NameDialog` bleibt für Trainings und KI-Prüfung).

Tests `write.test.ts` (Block „group draft“): KI-Gruppe ohne Meal → neues Meal mit Entwurfszutaten und Foto, Einträge
haben `mealId`, `groupName: null`, `aiAnalysisId` und Fotos unverändert, offene Mengenänderung ist in Einträgen und
Meal; Gruppe aus Meal → `update` ändert Meal-Name/Zutaten, behält Meal-Foto und `cookedGrams`; gelöschtes Meal kommt
zurück; neue Entwurfsfotos landen in Einträgen und (bei neuem Meal) als Meal-Foto.

### Block 6: Gespeichertes Meal als Zutaten hinzufügen (`AddFoodPage.tsx`, Router, `MealPage.tsx`, `MealLogView.tsx`)

- `AddFoodPage`: Meals auch im `into`-Modus in Suche und Reiter „Eigene“ (`withMeals` entfällt bzw. `true`), außer dem
  Ziel-Meal selbst (`into.kind === 'meal'` → `m.id !== into.mealId`). `SearchResultRow` gibt `into` an den Link weiter.
- Router `/meals/$mealId`: `into: intoParam(s.into)` im Validator. `MealPage`: mit `into` (und `date`) → `MealLogView`
  im Hinzufügen-Modus.
- `MealLogView` Prop `into?: Into`: Titel bleibt Meal-Name, kein Bleistift, keine Mahlzeit-Auswahl, Fußleiste
  „{N} Zutaten hinzufügen“. Hinzufügen der behaltenen, skalierten Zutaten (gleiche Rundung wie `logItems`):
  - `meal`: neues `addItemsToMealDraft(db, mealId, items)` (eine Transaktion; `addItemToMealDraft` ruft es mit einem
    Item).
  - `group`: neues `addItemsToGroupDraft` analog.
  - `ai`: je Item `getFood` (bei `foodId`), sonst Schnappschuss-Food aus `per100` mit `estimated: true` (wird wie eine
    Schätzung ohne `foodId` eingetragen); `addFoodsToDraft` (mehrere `userRow`s in einem `updateDraft`).
    Danach Toast „„{Meal}“: N Zutaten hinzugefügt“ und `returnFromInto` mit denselben Fallbacks wie `FoodLogPage.addToTarget`
    (Fallback-Navigation in eine gemeinsame Funktion in `lib/into.ts` ziehen statt zu kopieren).
- `addRecentToTarget` bleibt (nur Lebensmittel).

Tests: `addItemsToMealDraft`/`addItemsToGroupDraft` hängen alle an, gelöschtes Ziel → false; Suche im `into=meal:X`
zeigt Meal Y, nicht X (`foods.test.ts`, falls `filterOwn` dort getestet ist).

### Block 7: Neues Meal von Grund auf (`MealsPage.tsx`, `MealPage.tsx`, `MealEditor.tsx`, `db/mealDraft.ts`)

- `MealDraft.isNew?: true`. `startNewMeal(db): Promise<string>` schreibt einen leeren Entwurf (`name: ''`, `items: []`,
  `photo: 'keep'`, `cookedGrams: null`, `isNew: true`) unter neuer `uuidv7()` und gibt die Id zurück.
- `MealsPage`: Button „Neues Meal“ (`Plus`, `variant="outline"`, volle Breite über der Liste wie „Eigenes Lebensmittel
  anlegen“ in der Suche) → `startNewMeal` → `/meals/$id`.
- `MealPage`: kein Record, aber Entwurf mit `isNew` → `MealEditor` mit Platzhalter-Meal (`name: 'Neues Meal'`,
  `items: []`, `updatedAt: 0`); sonst wie heute „Meal nicht gefunden“.
- `MealEditor` mit neuem Meal: Titel „Neues Meal“ bis ein Name getippt ist, kein Löschen-Symbol, leere Liste zeigt nur
  „Zutat hinzufügen“ (`addItemToMealDraft` muss ohne Record mit `isNew`-Entwurf arbeiten), „Speichern“ erst mit Name
  und mindestens einer Zutat (Schema `min(1)`), `dirty` ab der ersten Eingabe. Verlassen ohne Eingabe löscht den
  Entwurf still; mit Eingabe `DiscardDialog` wie heute.
- `saveMealDraft`: fehlt der Record und `draft.isNew` → `saveRecord('meals', …)` statt `false`. „Als Lebensmittel
  speichern“ funktioniert schon auf dem Entwurf.
- `isMealDraftStale`/Konflikt-Logik: bei `isNew` nie stale (`baseUpdatedAt` fehlt).

Tests `write.test.ts`: `startNewMeal` → Zutat über `addItemToMealDraft` → `saveMealDraft` legt Meal an; leerer Entwurf
lässt sich nicht speichern; gelöschtes bestehendes Meal liefert weiter `false`.

### Block 9: Hinweis der Analyse als mehrzeiliges Feld (`features/ai/PhotoPage.tsx`, `DiaryGroupPage.tsx`)

Nachtrag des Nutzers (2026-10-25): Der Hinweis zur Analyse ist heute ein einzeiliges `Input`; längerer Text verschwindet
seitlich und lässt sich nicht lesen. Er wird ein Feld, das mit dem Text wächst.

- Drei Stellen, alle auf `Textarea` (`components/ui/textarea.tsx`, schon genutzt von „Beschreiben statt fotografieren“
  und der Tagesnotiz):
  1. Foto-Vorschau `ai-text` („Hinweis für die Analyse (optional)“),
  2. KI-Prüfung `review-hint` („Hinweis für die Analyse“ / „Beschreibung der Mahlzeit“),
  3. Dialog „Neu analysieren“ im Gruppen-Editor `group-hint`.
- `rows={1}`, `className="min-h-11 resize-none"`: leer so hoch wie ein `Input` (kein Sprung im Layout), wächst
  zeilenweise mit dem Text (`field-sizing-content` der Komponente), höchstens `max-h-40` (etwa 6 Zeilen), dann scrollt
  das Feld. iOS-Safari kennt `field-sizing` erst ab neueren Versionen: Fallback mit einer kleinen Hilfsfunktion
  `autoGrow(el)` (Höhe auf `scrollHeight` beim `onInput` und beim Mount, nur wenn
  `!CSS.supports('field-sizing', 'content')`), in `components/ui/textarea.tsx` als Prop `autoGrow` (eine Stelle,
  nicht dreimal). Kein Effekt mit `setState` (React-Compiler-Regeln): nur DOM-Höhe über einen Ref-Callback.
- Schrift bleibt 16 px auf dem Handy (`text-base`; `md:text-sm` greift erst ab 768 px), sonst zoomt iOS.
- Eingabetaste: im Feld eine neue Zeile, kein Absenden. Der Dialog im Gruppen-Editor verliert sein `onKeyDown`
  (Enter = analysieren); `enterKeyHint` entfällt (Standard „Zeilenumbruch“). Analysiert wird über die Buttons.
- Länge vereinheitlichen: Der Server nimmt 1 000 Zeichen (`routes/ai.ts`, `slice(0, 1000)`), die Beschreibung erlaubt
  1 000, die KI-Prüfung aber nur 500 (`maxLength={500}`): eine übernommene lange Beschreibung lässt sich dort nicht
  mehr bearbeiten. Eine Konstante `MAX_HINT_LENGTH = 1000` in `packages/shared` (neben `MAX_ANALYSIS_PHOTOS`), von
  allen vier Feldern und vom Server genutzt; die Chips („Häufige Hinweise“) kürzen auf dieselbe Grenze.
- Bei mehr als etwa 80 % der Grenze zeigt die Hilfezeile „N von 1 000 Zeichen“ (`fmt0`), damit das Abschneiden nicht
  überrascht.
- Tests: `components.test.tsx` (Textarea mit `autoGrow`: Höhe folgt `scrollHeight`, ohne Prop unverändert); E2E
  `meals-goals.spec.ts` Zeilen um 424, 743, 748, 777 finden die Felder weiter über ihr Label (bleibt gleich); ein Fall
  mit 300 Zeichen in der KI-Prüfung: Feld höher als eine Zeile, Wert vollständig. `ios-layout.spec.ts`: Feld bricht
  nicht aus der Breite.

### Block 8: E2E, Doku

- `e2e/meals-goals.spec.ts`:
  1. Foto-Gruppe (vorhandene KI-Fixtures nutzen) im Tagebuch antippen → Speichern-Symbol → neues Meal erscheint unter
     Gespeicherte Meals, Zeile zeigt Meal-Namen; Gruppe aus Meal → „aktualisieren“ ändert das Meal.
  2. Mittagessen mit Einzel + Gruppe: ⋯ → Kopieren → in Abendessen am Vortag einfügen (Struktur gleich), ⋯ → Als Meal
     speichern (alle Zutaten einzeln), ⋯ → Alle Einträge löschen → Rückgängig.
  3. Vorschläge bei gefüllter Mahlzeit sichtbar, eingetragenes fehlt.
  4. Meal-Editor → Zutat hinzufügen → anderes Meal → 0,5× → Zutaten im Editor.
  5. Gespeicherte Meals → Neues Meal → Name + Zutat → Speichern.
- `ios-layout.spec.ts`: Kartenkopf mit drei Symbolen bricht nicht um (iPhone-Breite).
- `CLAUDE.md`: Hinweisfelder der Analyse (`Textarea autoGrow`, `MAX_HINT_LENGTH`); Absätze Zwischenablage (Kind `meal`, ⋯-Menü), Diary group editor (Speichern/aktualisieren, Verknüpfung),
  „Diary meal without entries“ → Vorschläge dauerhaft (`daySuggestions`), Saved meals (Neues Meal, `into` auf
  `/meals/$id`), Food search with a target (Meals im `into`-Modus).
- Memory `feedback-rounds-workflow.md` um einen Satz zu diesem Plan ergänzen.

## Wichtige Dateien

- `apps/web/src/db/entries.ts`, `db/clipboard.ts`, `db/suggestions.ts`, `db/groupDraft.ts`, `db/mealDraft.ts`, `db/aiDraft.ts`
- `apps/web/src/features/diary/MealCard.tsx`, `MealSuggestions.tsx`, `ClipboardMenu.tsx`, `DiaryMealPage.tsx`,
  `DiaryGroupPage.tsx`, neu `DiaryMealMenu.tsx`
- `apps/web/src/features/meals/MealsPage.tsx`, `MealPage.tsx`, `MealEditor.tsx`, `MealLogView.tsx`
- `apps/web/src/features/foods/AddFoodPage.tsx`, `FoodLogPage.tsx` (Fallback-Navigation), `lib/into.ts`, `app/router.tsx`,
  `hooks/data.ts`, neu `components/SaveMealDialog.tsx`
- Keine Schema-, API- oder Sync-Änderung (`Meal`, `FoodEntry` bleiben; Zwischenablage und Entwürfe sind `kv`). Trotzdem
  `.claude/skills/offline-sync/SKILL.md` lesen, weil `db/*` geändert wird; `db/*` bleibt frei von `@/`-Importen.

## Ablauf für Opus 5.5

1. Lesen: dieser Plan, `CLAUDE.md`, `offline-sync`-Skill, `docs/plans/2026-10-tagebuch-zwischenablage.md`, dann die
   Dateien des jeweiligen Blocks.
2. Blöcke in Reihenfolge 1 → 7, dann 9, zuletzt 8 (E2E und Doku decken alles ab), **ein Commit pro Block** (englische Commit-Nachricht). Pro Block `pnpm lint`,
   `pnpm typecheck`, `pnpm test`; nach Block 8 `pnpm e2e`.
3. UI-Texte deutsch, keine Gedanken- oder Halbgeviertstriche; Wortwahl: **eintragen** (Tagebuch), **speichern**
   (Meal), **hinzufügen** (Zutaten).
4. Abweichungen vom Plan (z. B. Kopfzeile passt nicht auf 375 px, RadioGroup fehlt) melden statt still entscheiden.
5. Nicht pushen ohne Auftrag.

## Verifikation

- Unit/Integration: `pnpm test` (neue Fälle in `write.test.ts`, `suggestions.test.ts`, ggf. `components.test.tsx`).
- E2E: `pnpm e2e` (Fälle aus Block 8, Projekt `chromium-iphone`; `ios-layout` mit WebKit).
- Manuell: `pnpm dev`, `pnpm --filter @ft/api seed:demo`, Screenshots per eigenem Playwright-Skript über Proxy :5174
  (Login über Vite :5173 gibt 403): Tagebuch mit gefüllten Mahlzeiten (Vorschläge unten, ⋯-Menü), Gruppen-Editor mit
  Speichern-Dialog in beiden Modi, Meal-Editor „Zutat hinzufügen“ mit Meal, „Neues Meal“, hell und dunkel.
