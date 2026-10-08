# Feedback-Runde 4: Implementierungsplan

## Context

Nach Runde 3 (Commit d12dd1e) gab der User sechs Rückmeldungen; die Mockups dazu wurden mit Opus in vier
Versionen abgestimmt (`docs/plans/2026-10-feedback-runde-4-mockup.html`, v4, Abschnitte A bis G). Dieser Plan setzt
alles um, was dort entschieden ist. Die Mockup-Datei und `docs/plans/2026-10-feedback-runde-4-mockups.md` sind die
visuelle Referenz; bei Unklarheiten dort nachsehen (Abschnittskürzel A1, B2 usw. werden unten zitiert).

Entscheidungen des Users (aus den Mockup-Notizen, verbindlich):

- Speichern-UI Variante 1: Speichern-Icon im Kopf öffnet einen Namensdialog; ein Footer-Button „… eintragen“.
  Begriffe überall gleich: **Eintragen** = ins Tagebuch, **Speichern** = wiederverwendbar ablegen.
- „Vorlage“ heißt überall „gespeichertes Training“; gespeicherte Trainings bekommen Liste, Editor und Papierkorb.
- Meal-Editor (Mehr → Gespeicherte Meals) speichert explizit, fragt bei ungespeicherten Änderungen nach, trägt nicht ein.
  Eintragen-Modus (Suche → Eigene) mit Mengen-Slider 0,5× bis 2×, Wischen entfernt eine Zutat nur für diesen Eintrag,
  Link „Meal bearbeiten“.
- „Änderungen übernehmen“ statt „Änderungen speichern“ (Training, Lebensmittel-Eintrag, Schnelleingabe).
- Überschussbalken: dritte Stufe `--over-2`, auch für Mikros mit Höchstwert.
- Maßband statt Slider (0,05-Raster, ±1 kg sichtbar, keine −/+-Buttons, „Genauer Wert“ mit zwei Nachkommastellen).
- Dialoge app-weit oben und tastaturfest.
- Hinzufügen-Menü: „Training eintragen“, „Essen eintragen“ (mitte, rot, Icon Scan-Rahmen + Besteck), „Gewicht eintragen“.
  „+“ an einer Mahlzeit öffnet direkt die Essen-Seite. Essen-Seite mit Lupe zur Suche; Foto-Vorschau mit Hinweis vor
  der Analyse; Barcodes weiter sofort.
- ⋮-Menü an Mahlzeiten weg, `/copy-meal` gelöscht.
- Analyse-Review bleibt sonst wie heute; der Aufklapp-Zustand von Gruppen muss den Seitenwechsel überleben.
- Wortlaut app-weit angleichen: „hinzufügen“ nur noch für Zutaten in Meal/Analyse, sonst „eintragen“ (Block 1d).

Bewusst in Kauf genommen (mit dem User besprochen am 2026-10-08): ein gespeichertes Meal eintragen braucht künftig vier
Tipps (Plus, Essen-Seite, Lupe, Reiter „Eigene“) statt zwei über das ⋮-Menü; beim iOS-Wischen-Zurück aus einem Editor
mit ungespeicherten Änderungen blitzt die Vorseite kurz auf, bevor die Nachfrage kommt (Router-Eigenheit, siehe 6b).
Nicht Teil dieser Runde: Dunkel-Varianten der Token `--warn` und `--exercise`.

Regeln aus CLAUDE.md, die hier greifen: Schreiben nur über `saveRecord`/`patchRecord`/`deleteRecord`, React-Compiler-
Lint (kein setState in Effects, Formulare mit `initial`-Props und `key`), keine Gedankenstriche in UI-Strings/Kommentaren,
Blobs nie in Datensätzen, die neu geschrieben werden (Bytes + Typ), Toasts unten, Undo bei jedem Löschen, Text nur in
Ink-Tokens.

---

## 1. Grundlagen und Kleinkram

### 1a. Aufklapp-Zustand von Meal-Gruppen bleibt (Feedback 1)

`features/diary/MealCard.tsx:341` hält `expanded` in `GroupRow`; beim Wechsel auf `/entry/$entryId` wird die Zeile
entsorgt. Neu `features/diary/expandedGroups.ts`: `readExpanded(): Set<string>` / `writeExpanded(set)` über
`sessionStorage['ft.diary.expanded']` (Set von `groupId`s, weltweit eindeutig, daher kein Datum nötig; `sessionStorage`,
damit ein neuer App-Start zugeklappt beginnt). `GroupRow`: `useState(() => readExpanded().has(groupId))`, Toggle
schreibt beides. Gilt automatisch auch auf `/diary-meal` (gleiches `DiaryRows`).
Test: `apps/web/test/components.test.tsx` (`DiaryRows` wird dort noch nicht getestet; kleiner Unit-Test für
`expandedGroups.ts` reicht: lesen/schreiben/kaputter JSON → leeres Set).

### 1b. Überschussbalken mit zweiter Stufe (Feedback 4, Mockup C)

- `apps/web/src/index.css`: Token `--over-2: oklch(0.40 0.17 27)` im Light-Block bei `--over` (Z. 59), Dark
  `oklch(0.48 0.16 27)` im `prefers-color-scheme`-Block (Z. 92), `--color-over-2: var(--over-2)` im `@theme inline` (Z. 125).
- `components/MacroBars.tsx` `TargetBar` (Z. 23-62): dritte Schicht nach `excess`:
  `excess2 = target > 0 ? Math.min(100, Math.max(0, (value - 2 * target) / target * 100)) : 0`, gerendert als
  `<div data-part="excess2" className="absolute inset-y-0 left-0 rounded-full bg-over-2" style={{ width }} />` nur bei
  `excess2 > 0` (Rot ist dann voll). Reihenfolge der Schichten: Makro, `over`, `over-2`. Text bleibt `text-over`.
  Keine neue Prop: Mikros übergeben einfach `color="bg-foreground/40"`.
- `components/NutrientBreakdown.tsx` `MicroRow` (Z. 297-317): bei `target.kind === 'max'` den eigenen Balken durch
  `<TargetBar value target={target.grams} color="bg-foreground/40" label valueText className="mt-1" />` ersetzen
  (C3: grau bis Höchstwert, dann Rot, dann Dunkelrot). Mindestwerte (`min`) behalten den eigenen Balken (grau, `bg-good`
  ab Erreichen). `status === 'high'` färbt den Text weiterhin `text-over`.
- Tests `apps/web/test/components.test.tsx` `MacroBars` (Z. 69-104): 250 % → `excess` 100 %, `excess2` 50 %; 300 % und
  400 % → `excess2` 100 %; 120 % → kein `excess2`. `NutrientBreakdown`: Zucker 120 g bei max 43 g → `[data-part=excess2]`
  vorhanden, Ballaststoffe (min) unverändert ohne `excess`.

### 1c. „Änderungen übernehmen“ (Mockup E1e)

Drei Strings: `features/foods/FoodLogPage.tsx:460`, `features/foods/QuickAddPage.tsx:164`,
`features/exercise/ExercisePage.tsx:322` (letzterer geht in Block 3c ohnehin um). Keine E2E-Treffer.

### 1d. Wortlaut „hinzufügen“ an die neue Regel angleichen

Regel aus Mockup E: ins Tagebuch heißt **eintragen**. Heute mischen sich beide Wörter:

| Stelle                                                                       | heute                                          | neu                                                          |
| ---------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------ |
| `features/foods/FoodLogPage.tsx:465` Footer                                  | `Zu ${meal} hinzufügen`                        | `Zu ${meal} eintragen`                                       |
| `FoodLogPage.tsx:263` Toast beim Bearbeiten                                  | „Eintrag gespeichert“                          | „Änderungen übernommen“                                      |
| `features/foods/AddFoodPage.tsx:170` Toast (Kürzlich-Plus)                   | `… zu ${meal} hinzugefügt`                     | `… eingetragen`                                              |
| `AddFoodPage.tsx:155` Toast                                                  | `… hinzugefügt` (ins Meal / in die Analyse)    | bleibt                                                       |
| `features/diary/MealCard.tsx:158`, `DiaryMealPage.tsx:78` Leerzustand        | „Lebensmittel hinzufügen“                      | „Essen eintragen“                                            |
| `MealCard.tsx:141`, `DiaryMealPage.tsx:52` Plus-Label                        | `Zu ${name} hinzufügen`                        | `Essen zu ${name} eintragen`                                 |
| `features/diary/ExerciseCard.tsx:36` Plus-Label                              | „Training hinzufügen“                          | „Training eintragen“                                         |
| `features/foods/QuickAddPage.tsx:91` Titel, `AddFoodPage.tsx:187` Icon-Label | „Schnell hinzufügen“                           | „Schnelleingabe“ (Eintragsname „Schnell hinzugefügt“ bleibt) |
| `features/ai/PhotoPage.tsx:479` Toast-Beschreibung                           | „… jederzeit wieder hinzufügen und bearbeiten“ | „… jederzeit wieder eintragen und bearbeiten“                |

E2E: `diary-training.spec.ts:146` (`Lebensmittel hinzufügen` an der Mahlzeit) und `smoke.spec.ts` Footer-Button
„Zu Frühstück hinzufügen“ (prüfen mit `grep -rn "hinzufügen" apps/web/e2e`) anpassen.

---

## 2. Dialoge oben und tastaturfest (Mockup A3, D1b, E1d)

`components/ui/dialog.tsx` `DialogContent` (Z. 48-55) ist heute mittig (`top-[50%] translate-y-[-50%]`, kein `max-h`).

- Hook `hooks/useVisualViewport.ts` (einmal in `AuthedLayout`, `app/router.tsx:70-82`, als `<ViewportVars />` ohne Render):
  spiegelt `window.visualViewport.height` und `.offsetTop` bei `resize`/`scroll` als `--vvh`/`--vvt` auf
  `document.documentElement.style`. Ohne `visualViewport` bleibt der Fallback `100dvh`/`0px`. Effekt nur für Listener,
  kein setState (Compiler-Lint).
- `DialogContent`: `fixed left-1/2 -translate-x-1/2 top-[calc(var(--vvt,0px)+var(--safe-top)+12px)]`, `flex flex-col`,
  `max-h-[calc(var(--vvh,100dvh)-var(--safe-top)-24px)]`, `overflow-hidden`, `gap-4 p-6` bleibt; Animation
  `fade-in-0 slide-in-from-top-2` statt `zoom-in-95`. Der Versatz geht über `top`, nicht über `translateY`: `transform`
  ist schon von `-translate-x-1/2` und den tw-animate-Keyframes belegt. Neue Exporte `DialogBody`
  (`min-h-0 flex-1 overflow-y-auto -mx-6 px-6`) für den scrollbaren Mittelteil; `DialogHeader`/`DialogFooter` bekommen `shrink-0`.
  iOS verschiebt bei offener Tastatur nur den visuellen Viewport (`offsetTop > 0`), `100dvh` schrumpft nicht; genau dafür
  sind `--vvt`/`--vvh` da. Radix fokussiert mit `preventScroll`, der Tipp des Users scrollt das Feld im Body nativ sichtbar;
  `scroll-padding` ist nicht nötig. Falls das Feld nach dem Tastatur-`resize` unter dem Footer landet (am iPhone prüfen):
  im `resize`-Handler `document.activeElement.scrollIntoView({ block: 'nearest' })`, wenn es in `[data-slot=dialog-content]` liegt.
- Keine der sieben `DialogContent`-Stellen übergibt eine `className`, der Wechsel von `grid` auf `flex flex-col` ändert
  die Optik nicht. Alle Dialoge auf `DialogBody` umstellen (Mittelteil = alles zwischen Header und Footer):
  `ProgressPage.tsx` WeightDialog, `FoodLogPage.tsx` NewPortionDialog, `ExercisePage.tsx` TemplateDialog + CustomTypeDialog,
  `MealPage.tsx` AmountDialog (entfällt in Block 6), `AccountPage.tsx` (zwei inline), `MealCard.tsx` SaveMealDialog
  (wandert in Block 3). Das Drawer-Menü (`AddSheet`, vaul) bleibt unten.
- `apps/web/index.html:5`: `interactive-widget=resizes-content` an die Viewport-Meta anhängen (Safari ignoriert es,
  Chrome Android lässt damit den Layout-Viewport mit der Tastatur schrumpfen, was auch den Sticky-Footern hilft).
- Verifikation: Playwright-MCP kann keine iOS-Tastatur; mit `browser_resize` auf 390×400 prüfen, dass D1b-Verhalten
  (Body scrollt, Footer sichtbar) greift. Auf dem iPhone (PWA) gegentesten: Tastatur auf, Button direkt tippbar.

---

## 3. Gemeinsame Bauteile und einheitliches Speichern-UI (Mockup E)

### 3a. `components/PageFooter.tsx`

Aus `features/foods/FoodLogPage.tsx:457-467` herauslösen: `<PageFooter>{children}</PageFooter>` =
`sticky bottom-0 -mx-4 border-t border-border/70 bg-background/90 px-4 pt-3 pb-[calc(var(--safe-bottom)+0.75rem)] backdrop-blur-md`.
Nutzer: FoodLogPage (bestehend), ExercisePage, ResultEditor, MealEditor, MealLogView, TrainingEditorPage, Foto-Vorschau.
`main` hat bereits `flex-1`, der Footer klebt damit auch bei kurzen Seiten unten.

### 3b. `components/NameDialog.tsx`

Ersetzt `SaveMealDialog` (`MealCard.tsx:411-473`) und `TemplateDialog` (`ExercisePage.tsx:418-474`):

```ts
interface NameDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  defaultName: string;
  maxLength?: number; // 120
  onConfirm: (name: string) => Promise<void> | void; // schließt danach
}
```

Feld „Name“ (`Label`+`Input`, `autoFocus`, `onKeyDown Enter` = bestätigen), Buttons „Abbrechen“ / `confirmLabel`,
bestätigen deaktiviert bei leerem Namen. Name-State per `key={String(open)}` zurückgesetzt (kein Effect).

### 3c. Training eintragen (E1a, E1d, E1e)

`features/exercise/ExercisePage.tsx` `ExerciseForm`:

- Header `actions`: Speichern-Icon (lucide `Save`, `aria-label="Als Training speichern"`, `disabled={!type || !minutes}`)
  immer; beim Bearbeiten zusätzlich das Trash-Icon (Reihenfolge: Save, Trash).
- Outline-Button „Als Vorlage speichern“ (Z. 324-326) und `BookmarkPlus` entfallen. Primärbutton (Z. 321-323) wandert in
  `<PageFooter>` (nach der Section, Label `entry ? 'Änderungen übernehmen' : 'Training eintragen'`). MET-Quellenzeile bleibt
  in der Section.
- `TemplateDialog` → `NameDialog` mit Titel „Als Training speichern“, Beschreibung „Sportart, Dauer, Intensität und Notiz
  stehen danach in der Schnellauswahl und unter Mehr → Gespeicherte Trainings.“, Button „Training speichern“, `onConfirm`
  = `saveExerciseTemplate` + Toast `„${name}“ gespeichert`.
- Schnellauswahl (Z. 169-215): `QuickList title="Gespeichert"` mit neuer Prop `action` (Text-Link „Verwalten“ →
  `/trainings`, Block 7); Swipe-Label `${t.name} löschen`, Toast `„${t.name}“ gelöscht`.
- `db/entries.ts:59` Kommentar und `packages/shared/src/schemas.ts:206` Kommentar: „saved training“ statt „Vorlage“.
- E2E `apps/web/e2e/diary-training.spec.ts:30-66`: Icon „Als Training speichern“ → Dialog → „Training speichern“ → Toast
  `„Bahntraining“ gespeichert` → Footer „Training eintragen“; Löschen: `Bahntraining löschen`, Toast `„Bahntraining“ gelöscht`.

### 3d. Analyse-Review (E1b, E1c)

`features/ai/PhotoPage.tsx` `ResultEditor` (Z. 414-695):

- `AiDraft` (`db/dexie.ts:72-76`) bekommt `savedMealId?: string | null`. Feld „Name des Meals“ (Z. 504-516) entfällt;
  `mealName` bleibt im Draft (Vorbelegung aus `draftFromResult`, geändert nur im Dialog).
- Header `actions`: ohne `savedMealId` Speichern-Icon (`aria-label="Als Meal speichern"`, deaktiviert bei
  `resolved.length === 0`); mit `savedMealId` ein Chip-Button „✓ Gespeichert“ (`Check`, `text-good`, `bg-good/10`,
  `rounded-full px-2.5 h-8 text-sm`), Tipp öffnet den Dialog erneut. Danach das X wie heute.
- `NameDialog` Titel „Als Meal speichern“, Beschreibung „n Zutaten werden mit dem Foto als wiederverwendbares Meal
  gespeichert. Eingetragen wird erst mit „Meal eintragen“.“, Button „Meal speichern“.
  `onConfirm(name)`: ohne `savedMealId` → `createAiMeal(db, name, items, image)` (neu in `db/entries.ts`: `storePhoto` +
  `saveRecord('meals')`, zurück `mealId`; aus `saveAiMeal` Z. 168-183 herausgelöst, das danach entfällt), dann
  `commit({ ...draft, mealName: name, savedMealId })`; mit `savedMealId` → `patchRecord('meals', id, { name })`. Toast
  `„${name}“ gespeichert`.
- Footer `<PageFooter>`: ein Button „Meal eintragen“ (`disabled={resolved.length === 0}`). Ablauf `log()`: mit
  `savedMealId` zuerst `patchRecord('meals', id, { items: aiMealItems(items), name })` (das Meal entspricht immer dem, was
  eingetragen wird; existiert es nicht mehr, weil zwischendurch gelöscht: `restoreRecord` statt Fehler), dann
  `logItems(db, items, target, { mealId, aiAnalysisId })`; ohne `savedMealId` `logAiItems` wie heute. Danach `rememberFood`,
  `discardQueueItem`, Toast `„${name}“ eingetragen` (mit Meal: Beschreibung wie heute), Navigation `/`.
- Hilfetext (Z. 678-682): „n Zutaten werden als Gruppe „{name}“ eingetragen. Mit dem Speichern-Icon oben legst du sie
  zusätzlich mit Foto unter „Gespeicherte Meals“ ab.“ bzw. nach dem Speichern „Als Meal „{name}“ gespeichert (mit Foto).
  „Meal eintragen“ hängt es an dieses Meal, so erscheint es im Tagebuch mit Foto.“ Mahlzeit-Select bleibt.
- Verwerfen der Analyse (X, „Verwerfen“ in der Liste) nach dem Speichern lässt das Meal bestehen (bewusst; es ist gespeichert).
- Tests `apps/web/test/meals-photos.test.ts`: `createAiMeal` legt Meal + Foto an ohne Einträge; `write.test.ts` ggf.
  `saveAiMeal`-Test auf `createAiMeal` + `logItems` umstellen. E2E `meals-goals.spec.ts:177-258` (Meal mit Foto) und
  `:259-349` („Nur eintragen“): neue Schritte Icon → Dialog „Meal speichern“ → Chip „Gespeichert“ → „Meal eintragen“;
  ohne Speichern nur „Meal eintragen“ → Gruppe mit KI-Namen.

---

## 4. Tagebuch: ⋮ weg, Mahlzeit-Seite mit Speichern-Icon, „+“ direkt zur Essen-Seite (Mockup A, G4)

- `features/diary/MealCard.tsx` `MealCard` (Z. 65-171): `DropdownMenu` (Z. 112-137), `saveOpen`, `SaveMealDialog`
  (Z. 411-473) und die Imports `useNavigate, Copy, EllipsisVertical, Save, Trash2, Dialog*, DropdownMenu*, Input, Label,
uuidv7, saveRecord` entfernen (`removeEntriesWithUndo`, `ListPlus`, `useDb` in `DiaryRows` bleiben). „+“ (Z. 138-145)
  und Leerzustand (Z. 149-159) werden `Link`s auf `/photo` mit `search={{ date, meal }}` (statt `addSheet.open`); `useAddSheet`
  dort entfernen. Die Meal-Erzeugung aus Einträgen (Mapping Z. 420-437) wird `entriesToMealItems(entries): MealItem[]` in
  `db/entries.ts` plus `saveMealFromEntries(db, name, entries): Promise<string>` (`saveRecord('meals', { id: uuidv7(), name, items, photoId: null })`).
- `features/diary/DiaryMealPage.tsx`: `actions` = Speichern-Icon (`Save`, `aria-label="Als Meal speichern"`,
  `disabled={entries.length === 0}`, Farbe wie Zurück) + „+“ als `Link to="/photo"` (A2, A2b). `NameDialog` Titel
  „Als Meal speichern“, Beschreibung `${fmt0(n)} Einträge werden als wiederverwendbares Meal gespeichert.` (wie heute),
  `defaultName` `${name} ${fmtDate(date)}`, Button „Meal speichern“, `onConfirm` = `saveMealFromEntries` + Toast
  `„${name}“ gespeichert`. Leerzustand-Button „Lebensmittel hinzufügen“ → `Link to="/photo"`. `useAddSheet` entfällt hier.
- `/copy-meal` löschen: `app/router.tsx:172-176` Route, `features/meals/CopyMealPage.tsx`, Eintrag in `routeTree`.
  `README.md:28` Zeile „Mahlzeit von anderem Tag kopieren“ streichen.
- Texte: `features/foods/AddFoodPage.tsx:451-452` und `features/meals/MealsPage.tsx:27-29`: „Öffne im Tagebuch eine
  Mahlzeit und tippe oben auf das Speichern-Icon, um sie als Meal abzulegen.“
- E2E: `food-search.spec.ts:80-81`, `meals-goals.spec.ts:121-122`, `diary-training.spec.ts:195-196, 284-285` (heute Menü
  „Aktionen für Frühstück“ → „Als Meal speichern“): Mahlzeit-Kopfzeile tippen → `/diary-meal` → Icon „Als Meal speichern“ →
  Dialog → „Meal speichern“. `diary-training.spec.ts:127-150` („+“ an Mahlzeit öffnet das Menü) → erwartet jetzt die
  Essen-Seite mit Titel „Essen eintragen“ und Mahlzeit im Kopf.

---

## 5. Hinzufügen-Menü und Essen-Seite (Mockup G)

### 5a. Menü (G1, G3)

- `components/ScanCameraIcon.tsx` → `components/ScanFoodIcon.tsx`: `Scan` außen, innen `Utensils` (lucide) statt
  `Camera`, gleiche Größenverhältnisse. Export `ScanFoodIcon`.
- `components/AddSheet.tsx` Kacheln (Z. 71-95): 1. „Training eintragen“ (`Dumbbell`) → `/exercise` `{ date }`; 2. „Essen eintragen“ (`ScanFoodIcon`, `primary`) → `/photo` `{ date, meal }`; 3. „Gewicht eintragen“ unverändert.
  `meal` (`target.meal ?? defaultMealForNow()`) bleibt für die Essen-Seite. Nach Block 4 öffnet nur noch die Tab-Leiste
  das Menü (ohne `target`): den Zweig `mealName`/„Zu … hinzufügen“ (`AddSheet.tsx:60-66, 101`) streichen, Titel immer
  „Hinzufügen“; `AddSheetTarget.meal` bleibt als Option erhalten, `open({ date })` reicht.
- E2E `diary-training.spec.ts:96-150`, `smoke.spec.ts:8-18`: Kachel „Essen eintragen“ statt „Foto / Scan“, Suche über
  die Lupe („Lebensmittel suchen“ als `aria-label` des Header-Icons, damit `getByRole('button'|'link', { name: 'Lebensmittel suchen' })`
  weiter passt); Hintergrundfarben-Vergleich (Z. 137-138) auf Essen- vs. Trainings-Kachel.

### 5b. Essen-Seite (G2)

`features/ai/PhotoPage.tsx` `PhotoPage` (Z. 47-102):

- `Page title` = „Essen eintragen“ + `<span className="text-sm font-normal text-muted-foreground">{mealName}</span>`
  (Muster `DiaryMealPage.tsx`), `mealName` aus `useSettings().mealNames[meal]`.
- `actions`: `Button variant="ghost" size="icon" asChild` > `<Link to="/add" search={{ date, meal }} replace aria-label="Lebensmittel suchen"><Search /></Link>`.
  Gegenstück `features/foods/AddFoodPage.tsx:178-185` (Kamera-Link auf `/photo`) bekommt ebenfalls `replace` und das
  `aria-label` „Foto oder Barcode“ (heute „Foto analysieren“). Beide Wechsel ersetzen die Seite (kein Pendeln).
- Hinweisfeld unter der Kamera (Z. 290-299) entfällt (wandert in die Vorschau, 5c). KI-deaktiviert-Hinweis (Z. 73-78),
  Section „Analysen“ und Disclaimer bleiben; Disclaimer-Text: „Barcodes im Bild werden sofort erkannt und nachgeschlagen.
  Teller-Fotos zeigen erst eine Vorschau; mit „Analysieren“ gehen sie an Claude (Anthropic) und werden dort nicht gespeichert.“

### 5c. Foto-Vorschau vor der Analyse (G5)

`CameraCapture` (Z. 120-302):

- Zustand hochziehen: `shot: Blob | null` lebt in `PhotoPage`. `CameraCapture` verliert `text`, `shot`, `preview`,
  `busy` und `analyze()`; `shoot()`/`pick()` rufen `onShot(blob)` (nach der Barcode-Prüfung wie heute, Z. 184-194:
  Barcode → sofort `onDetected`, keine Vorschau). Das Hinweisfeld (Z. 290-299) entfällt dort. Die Buttons analysieren
  nicht mehr selbst, daher neue Labels: Auslöser (Z. 210) „Foto aufnehmen“, Galerie (Z. 202) „Aus der Mediathek wählen“;
  der Kamera-Fehler-Fallback (Z. 262-275) behält „Foto aufnehmen“ / „Aus Mediathek“.
- Neue Komponente `PhotoPreview({ shot, date, meal, onDiscard, onQueued })` in `PhotoPage.tsx`, gerendert statt Kamera,
  Liste und Disclaimer, solange `shot` gesetzt ist (G5a): Foto `aspect-[3/4]` (`useObjectUrl(shot)`) mit Overlay-Button
  oben links „Neu aufnehmen“ (`RotateCcw`, Stil wie der Galerie-Button, `onClick: onDiscard`), darunter `Label`/`Input
id="ai-text"` „Hinweis für die Analyse (optional)“ (Platzhalter wie heute), Hilfetext „Erst mit „Analysieren“ geht das
  Foto an Claude.“, dann `<PageFooter>` mit Button „Analysieren“ (`disabled={busy}`). `analyze()` übernimmt die heutige
  Logik (Z. 153-175: `compressImage`, `enqueuePhoto` mit `text`, `processQueue`); bei `done` `onQueued(id)`, bei Offline
  oder Fehler Toast wie heute und `onDiscard()`; während `busy` `AnalyzingOverlay` über dem Foto.
- Zurück in der Vorschau verwirft (G5a): neue optionale `Page`-Prop `onBack?: () => void` (`components/Page.tsx:28-32`,
  ersetzt `goBack` wenn gesetzt); `PhotoPage` übergibt in der Vorschau `onBack={() => setShot(null)}`. Browser-/Wisch-Zurück
  verlässt die Seite weiterhin (Foto verworfen; akzeptiert, in der Doku vermerken).
- `enqueuePhoto`-Aufruf und Queue bleiben unverändert (`text` wird mitgegeben, Offline-Toast wie heute).
- E2E `meals-goals.spec.ts:177-258`: nach dem Foto-Upload (Mediathek) zuerst Vorschau, Hinweis tippen, „Analysieren“.

---

## 6. Meal-Editor und Eintragen-Modus (Mockup B)

`features/meals/MealPage.tsx` wird zum Verteiler, Dateien in `features/meals/`:

```
MealPage.tsx       lädt das Meal, Not-found, wählt: search.date !== undefined && search.meal !== undefined
                   → <MealLogView meal date meal />, sonst → <MealEditor key={meal.id} meal />
MealEditor.tsx     B1 (Editor, explizites Speichern, Nachfrage)
MealLogView.tsx    B2 (Eintragen)
IngredientCard.tsx eine Zutat als Section mit Slider + NumberField (auch für ResultEditor-Optik, aber eigene Komponente;
                   ResultEditor bleibt unverändert)
```

Router `app/router.tsx:161-166`: `/meals/$mealId` behält `clean({date?, meal?})`. `/meals` (Z. 155-160) verliert die
Search-Params (der Modus „Meal zu Frühstück“ war nur über das ⋮-Menü erreichbar): `MealsPage.tsx` ohne `picking`, Titel
immer „Gespeicherte Meals“, `back="/more"`.

### 6a. Draft-Modul `db/mealDraft.ts` (gerätelokal, Dexie `kv`)

Der Editor schreibt nichts bis „Speichern“, muss aber den Weg über die Zutat-Suche (`/add?into=meal:<id>` → `/food/$foodId`
oder `/scan`, `/custom-food/$id`) überstehen. Darum lebt der Entwurf in `kv` (`db/dexie.ts:92`, `KvItem { key, value }`):

```ts
export interface MealDraft {
  mealId: string;
  name: string;
  items: MealItem[];
  photo: 'keep' | 'remove' | 'pending';
}
export interface MealDraftPhoto {
  bytes: ArrayBuffer;
  type: string;
} // eigener kv-Key, siehe unten
export const draftKey = (id: string) => `mealDraft:${id}`; // Foto: `mealDraftPhoto:${id}`
export async function readMealDraft(db, mealId): Promise<MealDraft | null>;
export async function writeMealDraft(db, draft): Promise<void>; // kv.put, ohne Bytes
export async function setMealDraftPhoto(db, mealId, photo: MealDraftPhoto | null): Promise<void>;
export async function readMealDraftPhoto(db, mealId): Promise<MealDraftPhoto | null>;
export async function clearMealDraft(db, mealId): Promise<void>; // beide Keys
export function draftFromMeal(meal: Meal): MealDraft;
export function isDirty(draft: MealDraft, meal: Meal): boolean; // Name, Items (JSON-Vergleich), photo !== 'keep'
export async function saveMealDraft(db, draft): Promise<void>; // 'pending' → storePhoto(bytes) erst jetzt; 'remove' → photoId null; patchRecord('meals', …); clearMealDraft
```

Die Foto-Bytes liegen unter einem eigenen Key, weil der Draft bei jedem Tastendruck neu geschrieben und per `useLiveQuery`
neu gelesen wird (Muster `aiImages`, `db/dexie.ts:66-72`). `storePhoto` erst beim Speichern: es legt `uploaded: 0` an und
der Sync lädt das Foto sonst hoch, obwohl der Entwurf verworfen werden kann.
`db/entries.ts` `addItemToMeal(db, mealId, item)` (Z. 119) hängt die Zutat an den Draft (bei fehlendem Draft
`draftFromMeal` + Item) statt an den Datensatz; `updateMealItem` (Z. 134) entfällt (nur noch im Test genutzt). Rückgabe
`false` wie heute, wenn das Meal fehlt oder gelöscht ist. `FoodLogPage.addToTarget` und `AddFoodPage.addRecentToTarget`
bleiben unverändert.

### 6b. `MealEditor` (B1, B1b)

- Äußere Komponente lädt `meal`, Draft und Draft-Foto per `useLiveQuery` und mountet erst, wenn alle drei Abfragen
  geantwortet haben (sonst initialisiert das Formular vom gespeicherten Meal und ignoriert den eintreffenden Draft):
  `<MealEditorForm key={meal.id} meal={meal} initial={draft ?? draftFromMeal(meal)} photo={draftPhoto} />`. Innen
  `useState(initial)`; `commit(next)` = `setDraft` + `writeMealDraft` (Write-through, Muster `ResultEditor.commit`,
  `PhotoPage.tsx:424-427`). Der Name bleibt damit lokaler State ohne Round-Trip pro Tastendruck beim Lesen. Nach der
  Rückkehr von `/add` mountet die Seite neu und liest den Draft aus der DB.
- Aufbau: Header Name + Trash (löscht das Meal wie heute, `clearMealDraft`, navigiert mit `ignoreBlocker: true` nach `/meals`);
  `PhotoSection` auf Draft umgestellt (Auswahl → `compressImage` → `arrayBuffer()` → `setMealDraftPhoto` + `photo: 'pending'`,
  „Foto entfernen“ → `'remove'`, Anzeige über `MealPhoto` mit in-memory Blob aus den Bytes bzw. gespeichertes Foto);
  Section „Name“; je Zutat `IngredientCard`
  (Name, kcal, Trash-Icon `aria-label="${name} entfernen"`, deaktiviert bei einer Zutat; Gramm-Slider `min 0`, `max`
  wie `rowSliderMax` aus PhotoPage (herauslösen nach `lib/`), `step 5` für Gramm-Zutaten; Stück-Zutaten (`byGram`-Logik
  aus `AmountDialog` Z. 326-372) bekommen `NumberField` „Anzahl“ mit Einheit „×“ und Slider `step 0.5`, `max` 10; Label
  „Anzahl · Stück (60 g)“); Button „Zutat hinzufügen“ (`rememberIntoStart` + `/add` mit `into`, wie heute Z. 146-154);
  Hinweis „Änderungen gelten für künftige Einträge. …“; letzte Section: Slider „Gesamtmenge“ (25 bis 300 %, `scaleBase`
  wie ResultEditor, skaliert `quantity` aller Zutaten über `rescaleItem`), `NutrientBreakdown title="Summe"`.
- `<PageFooter>` Button „Speichern“, `disabled={!dirty}`; `onClick`: `saveMealDraft`, Toast `„${name}“ gespeichert`,
  bleibt auf der Seite (Draft weg, `dirty` false).
- Nachfrage (B1b): in `MealEditorForm` (nicht hinter Early-Returns)
  `useBlocker({ shouldBlockFn, withResolver: true, enableBeforeUnload: false })` mit
  `shouldBlockFn = useCallback(({ next }) => dirty && !(next.pathname === '/add' && next.search.into === `meal:${meal.id}`), [dirty, meal.id])`
  (`next.search` ist dort roh geparst, nicht validiert; ohne `useCallback` registriert sich der Blocker bei jedem Render neu).
  Bei `status === 'blocked'` Dialog `DiscardDialog` (`components/DiscardDialog.tsx`, wiederverwendet in Block 7): Titel
  „Änderungen verwerfen?“, Text „Du hast {name} geändert. Ohne Speichern gehen die Änderungen verloren.“, Buttons
  „Weiter bearbeiten“ (`reset`), „Verwerfen“ (`clearMealDraft`, `proceed`), „Speichern“ (`saveMealDraft`, `proceed`).
  Der Entwurf überlebt einen Reload (kv), daher kein `beforeunload`.
  Bekannte Eigenheit von TanStack History: Push-Navigationen (Links, Tab-Leiste) werden vor dem Wechsel gestoppt, Zurück
  (Page-Button, Browser, iOS-Wischgeste) erst im `popstate` und dann per `history.go` zurückgedreht; beim Wischen auf iOS
  blitzt die vorherige Seite kurz auf. Clientseitig nicht vermeidbar, akzeptiert.
- Entfernen: `AmountDialog`, `ToggleGroup`-Import, `FACTORS`, Eintragen-Section.

### 6c. `MealLogView` (B2, B2b)

- Header: Name, keine Aktionen. Section „Zutaten“: Lese-Liste (Name, `entryAmountLabel`, kcal), jede Zeile in
  `SwipeToDelete label="${name} für diesen Eintrag entfernen"`; lokaler Zustand `excluded: Set<number>` (Index),
  Wischen bei letzter verbleibender Zutat → `toast.error('Mindestens eine Zutat bleibt.')`; sonst Toast `${name} entfernt`
  mit „Rückgängig“ (entfernt aus `excluded`). Darunter Text-Link „Meal bearbeiten“ (`Link to="/meals/$mealId"` ohne
  Search, `text-primary underline`); Zurück landet wieder hier mit den gespeicherten Änderungen
  (`key={meal.updatedAt}` setzt `excluded` zurück).
- Section „Nährwerte“ (`NutrientBreakdown` über die verbleibenden, skalierten Zutaten). Section „Eintragen“: Slider
  „Menge“ (`aria-label="Menge"`, 0,5 bis 2, `step 0.1`, Anzeige `fmt1(factor)×`, Skalenbeschriftung 0,5× 1× 2×),
  Select „Mahlzeit“ (wie heute Z. 186-200). `<PageFooter>` Button `${fmt0(kcal)} kcal eintragen` →
  `logItems(db, items.filter((_, i) => !excluded.has(i)), { date, meal: target }, { factor, mealId: meal.id })`,
  Toast und Navigation wie heute (Z. 201-210). `groupDiaryEntries` zeigt die Gruppe mit dem Meal-Namen und der Zutatenzahl.

### 6d. Tests

- `apps/web/test/meals-photos.test.ts:54-77` („adds, rescales and removes ingredients but never the last one“) bricht,
  weil `addItemToMeal` in den Draft schreibt: ersetzen durch `mealDraft`-Tests (`draftFromMeal`, `addItemToMeal` legt
  Draft an bzw. hängt an und schreibt nichts in `meals`/`outbox`, `isDirty`, `saveMealDraft` schreibt Name/Items/Foto,
  legt erst jetzt `photos` an und löscht beide Keys, `'remove'` setzt `photoId` null). `into`-Tests (Z. 314-330) bleiben.
- E2E `meals-goals.spec.ts:118-157` (Meal bearbeiten): nach „Zum Meal hinzufügen“ steht die Zeile im Editor, `goBack()`
  (Z. 148) löst jetzt „Änderungen verwerfen?“ aus → „Speichern“; die Mengenänderung (Z. 152-155) über Slider/Zahlenfeld
  → Footer „Speichern“. Neuer Schritt Eintragen-Modus: Suche → Eigene → Meal → Zutat wegwischen → „kcal eintragen“ →
  Tagebuch zeigt die Gruppe mit n−1 Zutaten.

---

## 7. Gespeicherte Trainings (Mockup F)

- Routen in `app/router.tsx`: `trainings: /trainings` (`TrainingsPage`), `training: /trainings/$templateId`
  (`TrainingEditorPage`), beide lazy, ohne Search.
- `features/more/MorePage.tsx:71-76`: dritte `Row to="/trainings" icon={<Dumbbell aria-hidden />} label="Gespeicherte Trainings"`.
- `features/exercise/TrainingsPage.tsx` (Vorlage `MealsPage.tsx`): `Page title="Gespeicherte Trainings" back="/more"`,
  Liste `db.exerciseTemplates.filter(!deleted).sortBy('name')`, Zeile = `SwipeToDelete` um `Link` (Name, `describe(...)`,
  kcal rechts mit `netExerciseKcal(metFor(type, intensity), useCurrentWeight(today) ?? DEFAULT_WEIGHT_KG, minutes)`,
  `describe`/`metFor`/`TypeOption` aus `ExercisePage.tsx` nach `features/exercise/training.ts` herauslösen), Löschen +
  Undo-Toast wie `ExercisePage.tsx:176-183`. Leerzustand F2-Text.
- `features/exercise/TrainingEditorPage.tsx` (F3): lädt Template (Not-found wie MealPage), `TrainingEditorForm key initial`
  mit Zustand `{ name, typeKey, intensity, minutes, note }`. Dafür aus `ExerciseForm` herauslösen:
  `SportPicker` (Suche, `listbox`, „Eigene Sportart“ + `CustomTypeDialog`; Z. 216-261 + 343-350) und `TrainingFields`
  (Intensität, Dauer + Chips, Notiz; Z. 263-305) als Komponenten in `features/exercise/TrainingFields.tsx`, von
  `ExerciseForm` und dem Editor genutzt. kcal-Box mit Text „Verbrauch beim aktuellen Gewicht“. `<PageFooter>` „Speichern“
  (`disabled={!dirty || !type || !minutes}`) → `patchRecord('exerciseTemplates', id, { name, typeKey, typeName, minutes, intensity, note })`,
  Toast `„${name}“ gespeichert`. `useBlocker` + `DiscardDialog` wie 6b (ohne Ausnahme-Route; Draft nur im State, Reload
  verwirft). Header: Trash („Training löschen“, Undo, Navigation mit `ignoreBlocker: true` zu `/trainings`).
- Papierkorb: `db/trash.ts` `trashedTrainings(db)`, `trashCount` zählt mit; `features/more/TrashPage.tsx` Section
  „Gespeicherte Trainings“ (Name, `describe`, „gelöscht am“, „Wiederherstellen“), Intro-Text und Leerzustand ergänzen;
  `docs/sync.md:18-22` Satz ergänzen; `apps/web/test/write.test.ts:46-75` um Trainings erweitern.
- Begriff „Vorlage“: alle Treffer aus Block 3c; `README.md:32` („gespeicherte Trainings und Schnellauswahl“).
  `GoalsPage.tsx:95` (Makro-Vorlage) bleibt.
- E2E `diary-training.spec.ts`: Schritt „Verwalten“ → Liste → Editor → Name ändern → Speichern → zurück zeigt neuen
  Namen; Löschen + Papierkorb-Wiederherstellen (Muster Z. 263-303).

---

## 8. Maßband für das Gewicht (Mockup D)

- `components/TapeMeasure.tsx`:
  ```ts
  interface TapeMeasureProps {
    value: number;
    onChange: (v: number) => void;
    min?: number /*20*/;
    max?: number /*400*/;
    step?: number /*0.05*/;
    visibleRange?: number /*1 = ±1 kg*/;
    label: string;
    unit?: string /*kg*/;
    className?: string;
  }
  ```
  Eigenes `div role="slider" tabIndex={0}` mit `aria-valuemin/max/now` und `aria-valuetext="84,50 kg"`; Tastatur ←/→ ±step,
  PageUp/PageDown ±1, Home/End. Pointer: `onPointerDown` (`setPointerCapture`), `onPointerMove` rechnet
  `value = start - dx / pxPerUnit` (`pxPerUnit = width / (2 * visibleRange)`), `onPointerUp` rastet auf `step`
  (`Math.round(v / step) * step`, `round(v, 2)`); `touch-action: pan-y`. Wheel/Trackpad: `onWheel` mit `deltaX`.
  Rendering: nur das sichtbare Fenster ±(visibleRange + 0.2), Ticks aus `Math.floor((value - r) / step)` bis `ceil`,
  je Tick `absolute left = 50% + (tick - value) * pxPerUnit`; klein (0,05), mittel (0,5, `h-4`), lang (1 kg, `h-6` mit
  Beschriftung); Striche `bg-muted-foreground/60`, Labels `text-muted-foreground tabular text-xs`; Zeiger mittig
  `bg-primary w-0.5` plus Dreieck; Hintergrund `bg-card`, Ränder weich per `mask-image: linear-gradient(90deg, transparent, black 15%, black 85%, transparent)`.
  Breite: `ResizeObserver` in einem Effect, Breite in `useState` (setState im Observer-Callback, nicht im Effect-Body,
  das akzeptiert der Compiler-Lint); vor der ersten Messung Breite 0 und nichts rendern. Haptik: `navigator.vibrate?.(5)`
  beim Überschreiten einer Marke (iOS ignoriert es).
- `features/progress/ProgressPage.tsx` `WeightDialog` (Z. 234-356): `Slider`, `−`/`+`-Buttons, `sliderMin/Max`, Labels
  „79 kg … 90 kg“, `nudge`, `WEIGHT_SLIDER_RANGE_KG` entfernen; `<output>` zeigt `fmtFixed(value, 2)` (neu in
  `lib/format.ts`: `nf` mit `minimumFractionDigits = maximumFractionDigits = n`), darunter `<TapeMeasure value={value ?? base} onChange={setValue} label="Gewicht in Kilogramm" />`
  und Hilfetext „Ziehen oder wischen, rastet auf 0,05 kg ein“. `NumberField` bekommt neue Prop `decimals?: number`
  (feste Nachkommastellen in der Anzeige, wenn nicht fokussiert; `components/NumberField.tsx:17` Formatierung) → hier
  `decimals={2}`; Werte außerhalb des Rasters (84,37) bleiben erlaubt, das Maßband zeigt die nächste Marke, die große
  Zahl den getippten Wert. Bereichsfehler und Speichern (`round(value, 2)`) wie heute. D2: ohne `entry` weiter „Datum ändern“.
  Mittelteil in `DialogBody` (Block 2), damit D1b greift.
- Tests: `components.test.tsx` neues Describe `TapeMeasure` (aria-Werte, ArrowRight → 84,55, PageUp → 85,5, Pointer-Drag
  um `pxPerUnit`-Pixel ändert um 1 kg und rastet); `NumberField` mit `decimals={2}` zeigt „80,00“.
  E2E `diary-training.spec.ts:230-242`: Feld „Genauer Wert“ 84,5 → Speichern → neu öffnen → Slider „Gewicht in Kilogramm“
  `aria-valuenow 84.5`, `ArrowRight` → Anzeige „84,55“, Feld „84,55“.

---

## Reihenfolge und Commits

1. Block 1 (Aufklapp-Zustand, Überschuss-Stufe, „Änderungen übernehmen“).
2. Block 2 (Dialoge oben) und 3a/3b (PageFooter, NameDialog).
3. Block 4 (Tagebuch, ⋮ weg, copy-meal löschen) und 3c/3d (Training, Review).
4. Block 5 (Menü, Essen-Seite, Vorschau).
5. Block 6 (Meal-Editor/Eintragen-Modus).
6. Block 7 (gespeicherte Trainings, Papierkorb, Begriff).
7. Block 8 (Maßband).
8. Doku: `README.md` (Feature-Liste), `docs/sync.md` (Papierkorb), CLAUDE.md (Hinweise: `PageFooter` für
   Seiten-Primärbuttons, `NameDialog`/`DiscardDialog`, Dialoge sitzen oben, Meal-Editor schreibt über `mealDraft`,
   `/photo` ist die Essen-Seite). Mockup-Dateien aus `docs/plans/` mit committen (bisher untracked).

Ein Commit pro Block (`Round 4 block N: …`), englische Commit-Texte. Dieser Plan liegt als Kopie unter
`docs/plans/2026-10-feedback-runde-4.md` und wird mit dem ersten Block committet.

## Ablauf für Opus 5.5

1. Zuerst lesen: diesen Plan ganz, `CLAUDE.md`, `.claude/skills/offline-sync/SKILL.md` (vor Block 6 und 7),
   `docs/plans/2026-10-feedback-runde-4-mockup.html` (Textteil reicht; die Mockup-Kürzel A1, B2, E1c usw. sind die
   Referenz für Optik und Texte). Bei Widerspruch zwischen Plan und Mockup gilt das Mockup für Optik und Wortlaut, der
   Plan für Code-Struktur.
2. Blöcke in der Reihenfolge oben abarbeiten, je Block: umsetzen, `pnpm lint && pnpm typecheck && pnpm test`, dann
   Commit `Round 4 block N: <kurz>` (englisch, mit der vereinbarten Co-Authored-By-Zeile). E2E (`pnpm e2e`) nach den
   Blöcken 4, 6, 7 und 8; schlägt ein Spec fehl, Spec oder Code im selben Block fixen, nicht überspringen.
3. Nach jedem Block mit Playwright-MCP gegen `pnpm dev` (390×844, Light und Dark) die Screens des Blocks gegen das Mockup
   halten; Abweichungen, die der Plan nicht abdeckt, als kurze Liste am Ende melden statt stillschweigend zu entscheiden.
4. Nichts außerhalb des Plans umbauen (keine Refactors nebenbei, keine neuen Abhängigkeiten ohne Rückfrage). UI-Texte
   deutsch ohne Gedankenstriche; Code, Kommentare und Commits englisch.
5. Am Ende: Liste der Commits, was nur am iPhone verifiziert werden kann (Tastatur-Dialoge, Maßband mit dem Finger,
   Barcode aus der Mediathek) und offene Punkte.

## Verifikation

- `pnpm lint && pnpm typecheck && pnpm test` nach jedem Block (sequentiell, Container-RAM).
- `pnpm e2e` (chromium-iphone) nach Block 4, 6, 7, 8: angepasste Specs `smoke`, `food-search`, `diary-training`, `meals-goals`.
- Manuell mit Playwright-MCP gegen `pnpm dev` (390×844, Light und Dark): Tagebuch ohne ⋮, Mahlzeit-Seite mit Icon und
  Dialog oben, Hinzufügen-Menü mit drei Kacheln, Essen-Seite mit Lupe und Vorschau (Mediathek-Upload), Review mit Chip
  „Gespeichert“, Meal-Editor (Slider, Speichern, Nachfrage), Eintragen-Modus (Wischen, Menge-Slider), gespeicherte
  Trainings (Liste, Editor, Papierkorb), Überschussbalken bei 250 %/300 % und Zucker über Höchstwert, Maßband (Drag,
  Tastatur), Dialog bei 390×400 scrollt.
- iPhone (PWA über WireGuard): Tastatur bei „Als Meal speichern“, „Genauer Wert“ und Foto-Hinweis; Maßband mit dem Finger;
  Barcode aus der Mediathek geht weiter direkt zur Produktsuche.
