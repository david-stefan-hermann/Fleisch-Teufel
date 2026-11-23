# Bedienelemente: eine Sprache

Stand 2026-11-23, geplant auf 387f360. Maßgeblich ist das Mockup `2026-11-bedienelemente-mockup.html` (v2, vom
Nutzer am 2026-11-23 angenommen mit einer Änderung: Fuß- und Aufklappzeilen bekommen nie eine andere
Hintergrundfarbe).

## Worum es geht

Alles Antippbare, das kein Button ist, wurde bisher an Ort und Stelle gestaltet. Ergebnis: drei Stärken der
Hervorhebung, vier Formen, zehn eigene Aufklapper, fünf Textlinks. Der Nutzer will eine Designsprache. Dieser
Plan führt vier Bausteine ein, stellt jede Stelle darauf um und verhindert mit einer Lint-Regel, dass wieder
Eigenbauten entstehen. Kein Verhalten ändert sich, nur Aussehen und Maße.

## Die Regeln

| Bauart                   | Wo                                                           | Aussehen                                                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Eintragszeile            | Zeilen einer Liste, die auf eine Seite führen oder eintragen | randlos, `min-h-14`, `px-4 py-2`, `gap-3`; Zeiger `bg-accent/60`, Tastaturfokus `bg-accent`                                                                                                     |
| Fuß- und Aufklappzeile   | unten an einer Karte oder mitten im Inhalt geht es weiter    | `min-h-11`, Text `text-sm font-medium text-muted-foreground`, Pfeil 16 px ganz rechts, nie ein Hintergrund; Zeiger `text-foreground`, Tastaturfokus Ring; Trennlinie darüber `border-border/70` |
| Abschnitt zum Aufklappen | die Kartenüberschrift ist der Schalter                       | Kopf wie `Section` (`min-h-12`, `text-base font-semibold`), Pfeil 16 px grau rechts, ganze Kopfzeile tippbar, kein Hintergrund                                                                  |
| Ziel im Text             | ein Wort oder Wert in einer Kopfzeile                        | `h-8`, `rounded-lg`, `px-2`, `-mx-2`; Zeiger `bg-accent/60`, offen `bg-accent`, Tastaturfokus Ring; Tippfläche 44 px über `after:absolute after:-inset-y-1.5 after:inset-x-0`                   |
| Textlink                 | Text, der etwas tut                                          | `text-sm font-medium underline underline-offset-2`, rot (`text-primary`) oder grau (`text-muted-foreground hover:text-foreground`); mitten im Satz erbt er die Größe                            |

Pfeile: immer `size-4`, `text-muted-foreground`, `shrink-0`, ganz rechts. Rechts = Seite, unten = aufklappen
(dreht sich offen um 180°, `motion-reduce:transition-none`). Einzige Ausnahme: `size-3.5` in der 12-px-Unterzeile
einer Gruppe („4 Zutaten“, „3 Aktivitäten · 75 Min.“), die bleibt wie sie ist.

Hervorhebung: außerhalb von `components/ui` gibt es nur noch `bg-accent/60` unter dem Zeiger und `bg-accent` für
offen und Tastaturfokus, und nur an Eintragszeilen und Zielen im Text.

Bleibt, weil schon je eine Bauart: Buttons, Chips (`MealSuggestions`, `TrainingChip`), die gestrichelten
„hinzufügen“-Flächen, Auswahlkarten (Ziele, Aktivität, `MacroPlanPicker`), Wochenleiste, `AddSheet`-Kacheln,
`PhotoStrip` „+“, der kcal-Schalter in `NutrientBreakdown` (ein Umschalter mit eigenem Dauerhintergrund).
Einzige Angleichung dort: die drei gestrichelten Flächen bekommen dieselbe Klasse (`border-input`, `font-medium`
fehlen heute in `MealCard.tsx:258` und `ExerciseCard.tsx:178`).

## Die Bausteine

Neue Datei `apps/web/src/components/tappable.tsx` (Namen englisch, wie der übrige Code):

1. `rowClass`: Konstante für die Eintragszeile (`flex min-h-14 items-center gap-3 px-4 py-2 transition-colors
hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none`), dazu `rowWithLinkClass` für Zeilen mit
   gestrecktem Link (`has-[a:focus-visible]:bg-accent` statt `focus-visible:`). Eine Konstante statt einer
   Komponente, weil die Zeilen `Link`, `button`, `div` und dnd-Hüllen sind.
2. `FooterRow`: die Fuß- und Aufklappzeile. Props `children`, `icon: 'right' | 'down'`, `className`, `asChild`
   (Radix `Slot`), damit sie `Link`, `button` und `CollapsibleTrigger` sein kann. Der Pfeil nach unten dreht sich
   über `group-data-[state=open]:rotate-180` und `group-aria-expanded:rotate-180`. Kein eigener Seitenabstand:
   direkt in einer `Section` bekommt sie `className="px-4"`, in gepolstertem Inhalt nichts.
   `DisclosureTrigger` (`NutrientBreakdown.tsx`) wird durch `FooterRow` als `CollapsibleTrigger` ersetzt und
   entfällt.
3. `SectionToggle`: Kopf eines aufklappbaren Abschnitts (`CollapsibleTrigger`, Maße des `Section`-Kopfs, `h2`
   innen, Pfeil rechts).
4. `InlineTarget`: Klassenkonstante `inlineTargetClass` plus dünne Komponente mit `asChild`.
5. `TextLink`: Props `tone: 'primary' | 'quiet'` (Standard `primary`), `inline` (erbt die Größe), `asChild`.
   `min-h-11` und Ausrichtung kommen weiter von der Stelle (`className`).

## Jede Stelle

Eintragszeile (`rowClass` / `rowWithLinkClass`, heute schon fast gleich, nur `transition-colors` und `select-none`
schwanken; `select-none` bleibt per `className` an den ziehbaren Zeilen):
`AddFoodPage.tsx` 572, 620, 652, 694 · `CustomFoodsPage.tsx` 33 · `MealCard.tsx` 507, 635 · `ExerciseCard.tsx`
268, 301 · `PendingAnalysisRow.tsx` 55 · `StepsRow.tsx` 51 · `ProgressPage.tsx` 164 (`min-h-12` wird `min-h-14`
nur, wenn die Zeile zweizeilig ist; sonst `className="min-h-12"`) · `MealsPage.tsx` 59 · `TrainingSearchPage.tsx`
150, 373 · `TrainingsPage.tsx` 73 · `MorePage.tsx` 46 · `MealLogView.tsx` 223 (heute `/40` und Ring) ·
`TrainingRow.tsx` 45 (heute ohne Zeiger-Hervorhebung).

Fuß- und Aufklappzeile (`FooterRow`):

| Stelle                                                                     | heute                                      | neu                                                                                       |
| -------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `WeekReviewCard.tsx` 117 „N von 7 Tagen …“                                 | Zeile mit `hover:bg-accent/60`             | `FooterRow icon="right"`, `px-4 border-t`                                                 |
| `CalorieCard.tsx` 61 „Nährstoffe“ / „Weniger“                              | zentrierte Pille, 12 px, `hover:bg-accent` | `FooterRow icon="down"`, Text links, `-mx-4 -mb-4 mt-4 w-[calc(100%+2rem)] px-4 border-t` |
| `ProgressPage.tsx` 273 „Prognose“                                          | `DisclosureTrigger`, 16 px halbfett        | `FooterRow`, Hülle `mt-2 border-t border-border/70 px-4` statt `px-2`                     |
| `ProgressPage.tsx` 304 „Ältere Einträge (N)“                               | schwarz halbfett, Pfeil 20 px, `min-h-12`  | `FooterRow`, `px-4`                                                                       |
| `NutrientsDisclosure.tsx` 38 „Nährwerte“                                   | `DisclosureTrigger`                        | `FooterRow`                                                                               |
| `NutrientBreakdown.tsx` 188, `NutrientEditor.tsx` 175 „Weitere Nährstoffe“ | `DisclosureTrigger`                        | `FooterRow`                                                                               |
| `NutrientBreakdown.tsx` 203, `NutrientEditor.tsx` 193 „Alle N Nährstoffe“  | `DisclosureTrigger`, 13 px, `min-h-10`     | `FooterRow` (14 px, 44 px)                                                                |
| `AddFoodPage.tsx` 452 „Meals (N)“                                          | eigener Trigger, Pfeil 20 px               | `FooterRow`                                                                               |

Die Karte der Tagesübersicht ist als Ganzes tippbar (`cursor-pointer` an der `section`); das bleibt, die Zeile
ist ihr sichtbarer Schalter.

Abschnitt zum Aufklappen (`SectionToggle`): `QueueList.tsx` 44 „Offene Analysen (N)“ (Pfeil 20 px,
`hover:bg-accent/60` fallen weg) · `StepsSettingsPage.tsx` 166 (heute Icon-Button rechts im Kopf; neu ist die ganze
Kopfzeile der Schalter, `aria-label` entfällt, weil der Titel der Name ist).

Ziel im Text (`InlineTarget`): `MealNameMenu.tsx` 54 (heute `-mx-1.5 -my-0.5 px-1.5 py-0.5`) · `MealCard.tsx` 108
kcal-Link (heute `min-h-11 -mr-2 pr-2 pl-1`); im Titel `items-center gap-5` statt `items-baseline gap-1`, damit
zwischen beiden Kästen 4 px frei bleiben (Mockup) · `DiaryPage.tsx` 71 Datum (`rounded-md px-1 hover:bg-accent`,
Fokus bleibt `focus-within`) · `HeaderMealPicker.tsx` 50 bleibt ein `Button variant="ghost"` (zweizeilig, 44 px),
dort nichts ändern.

Textlink (`TextLink`): `QueueList.tsx` 127 und `PendingAnalysisRow.tsx` 86 „Wiederholen“ · `ScanPage.tsx` 139 ·
`AddFoodPage.tsx` 335, 404 (eigenständig), 362, 440 (im Satz, `inline`) · `ReviewStep.tsx` 586, 599 (`inline`) ·
`CompleteDayPage.tsx` 131, 175 · `GoalsPage.tsx` 246 · `QuickEntryFields.tsx` 125 · `ProfilePage.tsx` 229 ·
`AboutPage.tsx` 31, 45, 54 · `NutrientEditor.tsx` 141 · `TrainingFields.tsx` 249 „Berechneten Wert verwenden“
(12 px wird 14 px) · `CalorieCard.tsx` 50 „Woher kommen die Zielwerte?“ (`tone="quiet"`, 12 px wird 14 px) ·
`NoteCard.tsx` 121 „Alle vergangenen Tage abschließen“ (`tone="quiet"`) · `NoteCard.tsx` 80 bleibt (grüner
Zustand mit Symbol, kein Link im Sinn der Regel).

Zeilennummern gelten für 387f360; vor dem Umbau mit
`grep -rn "hover:bg-\|underline\|Chevron" apps/web/src --include=*.tsx` gegenprüfen und jede Fundstelle
außerhalb von `components/ui` einer Bauart zuordnen. Bleibt eine übrig, die in keine passt: nicht umbauen,
im Statusblock nennen.

## Lint-Regel

`eslint.config.js`, Block für `apps/web/**/*.tsx` ohne `components/ui/**` und `components/tappable.tsx`:
`no-restricted-syntax` auf Zeichenketten und Template-Teile, die `hover:bg-accent` oder
`underline-offset-` enthalten (Selektor `Literal[value=/hover:bg-accent|underline-offset-/]` und dasselbe für
`TemplateElement`), Meldung: „Use rowClass, InlineTarget, FooterRow or TextLink from components/tappable“.
Die Stellen aus „Bleibt“ mit `hover:bg-accent` (Chips, gestrichelte Flächen, Auswahlkarten, Wochenleiste,
`AddSheet`) bekommen ihre Klasse ebenfalls aus `tappable.tsx` (`dashedAddClass`, `choiceHoverClass`), damit
die Regel ohne Ausnahmen auskommt.

## CLAUDE.md

Neuer Punkt unter „Conventions & gotchas“: die fünf Bauarten, die Datei, die Pfeilregel, die Lint-Regel. Den
Satz zu `DisclosureTrigger` im Abschnitt „Forecasts“ anpassen. Im Plan `2026-11-gewichtsprognosen.md` entfällt
der offene Punkt 2 (`text-sm` an „Prognose“), das Mockup v4 dort zeigt die Zeile noch in der alten Bauart:
einen Satz dazu in dessen Statusblock.

## Verifikation

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm e2e` grün. E2E-Specs, die Aufklapper über Rolle und Namen
  finden, bleiben gültig; wo `StepsSettingsPage` über „Anleitung aufklappen“ gesucht wird, auf den Titel umstellen.
- Screenshots hell und dunkel (iPhone-Größe, Demo-Nutzer) von: Tagebuch mit Mahlzeit und Wochenkarte,
  Tagesübersicht zu und offen, `/progress` mit Prognose zu und offen, Meal-Editor mit „Nährwerte“, `/add` mit
  „Meals (N)“, `/photo` mit „Offene Analysen“. Gegen das Mockup halten.
- Jeden umgebauten Schalter einmal mit echtem Touch auslösen (CDP `Input.dispatchTouchEvent`), besonders
  `MealNameMenu` und den kcal-Link (Tippfläche 44 px ohne Überlappung) und die Tagesübersicht (Zeile und Karte
  klappen nicht doppelt).

## Status

Geplant 2026-11-23. Nicht umgesetzt.
