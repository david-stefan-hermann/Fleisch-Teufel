# Tagebuch-Zwischenablage: nach rechts wischen kopiert, Einfügen je Mahlzeit, Menü im Kopf

## Context

Heute lässt sich ein Tagebucheintrag nur per Drag-and-drop in eine andere Mahlzeit **desselben Tages** verschieben;
kopieren (gleiches Essen noch einmal, an einem anderen Tag oder in einer anderen Mahlzeit) geht nur über die Suche
oder ein gespeichertes Meal. Der Nutzer will (2026-10-19):

1. **Nach rechts wischen kopiert** die Zeile (Lebensmittel oder Mahlzeit-Gruppe, auch eine gescannte) in eine
   Zwischenablage. Nach links wischen bleibt Löschen.
2. Ist etwas kopiert, zeigt **jede Tagesmahlzeit im Tagebuch links neben ihrem „+“ ein Einfügen-Symbol**; ein Tipp
   trägt das Kopierte in diese Mahlzeit des angezeigten Tages ein.
3. Ist etwas kopiert, steht **oben links neben dem Cloud-Symbol** ein Zwischenablage-Symbol mit zwei Aktionen:
   das Essen **als Meal speichern** (für Gruppen, z. B. eine gescannte Mahlzeit) oder **die Zwischenablage leeren**.

Bausteine, die es schon gibt: `SwipeToDelete` (Wischen nach links, `components/SwipeToDelete.tsx`), `DiaryRows`
mit `EntryRow` und `GroupRow` (`features/diary/MealCard.tsx`, auch auf `/diary-meal`), `logItems` in
`db/entries.ts` (trägt Items als Gruppe mit `mealId`, `groupName`, `aiAnalysisId`, `photoIds` ein; der Kommentar dort
nennt „Kopieren eines Meals von einem anderen Tag“ bereits als Zweck), `entriesToMealItems`, `saveMealFromEntries`,
`NameDialog`, `DropdownMenu` (`components/ui/dropdown-menu.tsx`, bisher ungenutzt), Geräte-Entwürfe in `kv`.

### Entschieden (mit dem Nutzer, 2026-10-19)

- Direkt Implementierungsplan, kein Mockup.
- Wischen nach rechts = kopieren, Einfügen-Symbol links vom „+“ jeder Mahlzeit, Zwischenablage-Symbol links vom
  Cloud-Symbol mit „Als Meal speichern“ und „Zwischenablage leeren“.

### Annahmen (im Plan festgelegt, bei Widerspruch melden)

- **Eine** Zwischenablage mit **einem** Inhalt: ein neues Kopieren ersetzt den alten Inhalt. Sie lebt **auf dem
  Gerät** (`kv`, nicht synchronisiert) und bleibt nach dem Einfügen gefüllt (man kann dasselbe in mehrere Tage oder
  Mahlzeiten einfügen), bis „Zwischenablage leeren“ oder ein neues Kopieren. Sie übersteht Neuladen und App-Neustart.
- Die Zwischenablage hält eine **Momentaufnahme** (Items wie `entriesToMealItems`, Name, Gruppenfelder, Foto-Ids),
  keine Verweise auf die Quell-Einträge: die Quelle darf danach gelöscht oder geändert werden.
- **Wischen nach rechts löst sofort aus**, sobald der Finger beim Loslassen über der Schwelle (halbe Aktionsbreite) ist;
  die Zeile federt zurück. Kein zweiter Tipp wie beim Löschen, weil Kopieren nichts zerstört (Muster wie „Antworten“
  in Messengern). Während des Ziehens ist links ein blauer Bereich mit Kopier-Symbol zu sehen, hinter der Schwelle wird
  das Symbol größer und das Gerät vibriert kurz (`navigator.vibrate?.(10)`, wie beim Drag-Start).
- **Gruppe** (Zeile aus gespeichertem Meal oder Analyse) kopiert die ganze Gruppe; eine **aufgeklappte Zutat** oder ein
  **einzelner Eintrag** kopiert nur diesen als einfachen Eintrag (ohne Gruppe, ohne Fotos). Platzhalterzeilen laufender
  Analysen (`PendingAnalysisRow`) lassen sich nicht kopieren.
- Eine eingefügte **Gruppe** behält `mealId`, `groupName`, `aiAnalysisId` und `photoIds` (Fotos sind unveränderlich
  und bleiben für immer, dieselben Ids dürfen an mehreren Einträgen hängen) und bekommt neue `id`s, eine neue `groupId`
  und `loggedAt` = jetzt. So sieht und verhält sie sich wie das Original (Name folgt weiter dem Meal, Foto, Gruppen-
  Editor, ↻ mit Hinweis-Vorbelegung). Ein eingefügter **Eintrag** ist ein normaler Eintrag (`groupId: null`).
- „**Als Meal speichern**“ gibt es im Menü nur, wenn eine **Gruppe** in der Zwischenablage liegt (wie vom Nutzer
  gesagt: „bei Mahlzeiten“); auch wenn die Gruppe aus einem gespeicherten Meal stammt (dann entsteht eine Kopie
  des Meals mit dem Stand der Tagebuch-Einträge). Das Meal bekommt als Foto das erste Foto der Gruppe (dieselbe
  Foto-Id, keine Kopie). Ein einzelner Eintrag bekommt den Menüpunkt nicht.
- Das Einfügen-Symbol erscheint **auch im Kopf von `/diary-meal`** links vom „+“ (dieselben Zeilen, dieselbe Logik;
  ohne wäre die Seite der einzige Ort mit Kopieren, aber ohne Einfügen). Das Zwischenablage-Menü gibt es nur im
  Tagebuch-Kopf.
- Ohne Wischen (Tastatur, Screenreader) gibt es vorerst keinen Weg zum Kopieren (wie beim Verschieben per Drag-and-
  drop, das auch nur per Geste geht). Das ist bekannt und nicht Teil dieses Plans.
- iOS Safari im Browser nimmt Wischgesten in den ersten rund 20 px vom linken Bildschirmrand für „Zurück“; eine
  Kopier-Geste beginnt also besser mitten auf der Zeile. In der installierten PWA gibt es die Geste nicht. Kein
  Gegenmittel nötig.

## Umsetzung

### 1. Daten: `apps/web/src/db/clipboard.ts` (neu, ohne `@/`-Importe)

```ts
export interface Clipboard {
  kind: 'entry' | 'group';
  /** Was die Zeile zeigte: Name für Toasts, Menü und Vorschlag beim Speichern. */
  name: string;
  items: MealItem[];
  mealId: string | null;
  groupName: string | null;
  aiAnalysisId: string | null;
  photoIds: string[];
  copiedAt: number;
}
export const CLIPBOARD_KEY = 'clipboard';
```

- `readClipboard(db): Promise<Clipboard | null>` (`kv.get(CLIPBOARD_KEY)`), `clearClipboard(db)`.
- `copyToClipboard(db, kind, name, entries: readonly FoodEntry[])`: `items = entriesToMealItems(entries)`; bei
  `group` zusätzlich `mealId`, `groupName`, `aiAnalysisId` des ersten Eintrags und `photoIds = photoIdsOf(first)`;
  bei `entry` alle null bzw. `[]`. Schreibt `kv.put`. Name wird wie überall auf 120 Zeichen gekürzt.
- `pasteClipboard(db, clip, target: { date; meal }): Promise<string[]>` (die neuen Eintrags-Ids für „Rückgängig“):
  `logItems(db, clip.items, target, kind === 'group' ? { mealId, groupName, aiAnalysisId, photoIds } : {})`.
  Dafür gibt `logItems` künftig die **Ids** der angelegten Einträge zurück statt der Anzahl (`string[]`; die drei
  Aufrufer, die die Zahl brauchen, nehmen `.length`: `MealLogView`, `logAiMeal`, `logAiItems` bzw. deren Aufrufer).
  Bei `kind === 'group'` ohne `mealId` und ohne `groupName` (sollte nicht vorkommen) `groupName = clip.name`, damit es
  eine Gruppe bleibt.
- `saveMealFromItems(db, name, items, photoId)` in `db/entries.ts` (aus `saveMealFromEntries` herausgelöst, das
  es dann aufruft, `photoId: null`); das Menü ruft es mit `clip.items` und `clip.photoIds[0] ?? null`.
- `clipboardKcal(clip)`: Summe `ENERCC` der Items (für Menü und `aria-label`), gleiche Rechnung wie `mealKcal`.

Hook `useClipboard()` in `hooks/data.ts`: `useLiveQuery(() => readClipboard(db), [db])` → `Clipboard | null |
undefined`. Einmal in `DiaryPage` und `DiaryMealPage` aufgerufen, an `MealCard` als Prop weitergereicht (keine sechs
Live-Queries).

Tests `apps/web/test/write.test.ts` (Block „clipboard“): Gruppe kopieren → einfügen am anderen Tag: neue Ids, neue
`groupId`, gleiche `mealId`/`groupName`/`aiAnalysisId`/`photoIds`, `photoId` = erstes Foto, `groupDiaryEntries`
zeigt eine Gruppenzeile; einzelner Eintrag kopieren → einfügen: `groupId: null`, keine Fotos; Quelle löschen, dann
einfügen funktioniert weiter; `clearClipboard`; `saveMealFromItems` mit Foto-Id; `logItems` liefert Ids.

### 2. `components/SwipeToDelete.tsx`: Wischen nach rechts

- Neue optionale Props `onCopy?: () => void` und `copyLabel?: string` (nur für `aria-label` des Bereichs; der Bereich
  ist kein Button). Ohne `onCopy` bleibt alles wie heute (rechts bei 0 geklemmt).
- Mit `onCopy`: `offset` darf positiv werden (gleiche Gummiband-Formel gespiegelt, Breite `ACTION_WIDTH`). Links
  liegt absolut ein Bereich `bg-primary text-primary-foreground` mit `Copy`-Icon (`size-5`, hinter der Schwelle
  `scale-125` mit Transition), `aria-hidden`, nur sichtbar bei `offset > 0`. Die Schwelle ist `ACTION_WIDTH / 2`.
- `onPointerUp` bei Achse x und `offset > ACTION_WIDTH / 2` → `onCopy()` und `setOffset(0)`; darunter nur
  `setOffset(0)`. Nach rechts gibt es keinen offenen Zustand (`open` bleibt `offset < 0`). `onPointerCancel` und
  `disabled` setzen auf 0 zurück, ohne zu kopieren.
- Vibration genau einmal je Geste beim ersten Überschreiten der Schwelle (Ref `buzzed` in `Gesture`).
- Beide Richtungen in einer Geste: ein Zug von rechts zurück über 0 nach links öffnet wie heute den Lösch-Button
  (die Formel klemmt nur noch an `-ACTION_WIDTH` bzw. `+ACTION_WIDTH` mit Gummiband).
- Doku-Kommentar der Komponente ergänzen (Name bleibt `SwipeToDelete`, weil alle anderen Listen nur löschen).

Tests `apps/web/test/components.test.tsx` (`describe('SwipeToDelete')`): Wischen +120 ruft `onCopy` einmal und die
Zeile steht danach bei 0 (kein `transform`); +20 ruft nichts; ohne `onCopy` bleibt `transform` bei +120 leer;
Wischen nach links unverändert (bestehende Fälle); `disabled` ignoriert die Geste.

### 3. Tagebuch-Zeilen kopieren, Einfügen je Mahlzeit (`features/diary/MealCard.tsx`, `DiaryMealPage.tsx`)

- `EntryRow`: `onCopy={() => void copyEntry(db, e)}` mit `copyLabel={`${e.name} kopieren`}` (auch für Zutaten in
  aufgeklappten Gruppen: kopiert nur die Zutat). `GroupRow`: `onCopy` kopiert alle `entries` als `group` mit dem
  angezeigten `name`. Beide über eine Modul-Funktion `copyWithToast(db, kind, name, entries)` in `MealCard.tsx`:
  `copyToClipboard`, dann `toast(`„${name}“ kopiert`, { description: 'Zum Eintragen auf das Einfügen-Symbol einer
Mahlzeit tippen.' })`.
- `MealCard` bekommt Prop `clipboard: Clipboard | null`. `action` wird ein `div.flex.items-center` mit (bei
  `clipboard`) einem Button `ClipboardPaste` (`variant="ghost" size="icon"`, `text-primary`,
  `aria-label={`„${clipboard.name}“ in ${name} eintragen`}`) vor dem bestehenden „+“. Tipp:
  `pasteClipboard(db, clipboard, { date, meal })` → `toast(`„${name}“ in ${mealName} eingetragen`, { action:
'Rückgängig' → `deleteRecord` je Id })`. Die Logik liegt in einer Modul-Funktion `pasteWithToast(db, clip, target,
mealName)` (mit `Date.now()` über `logItems`, keine Zeit im Render).
- Leere Mahlzeit: die gestrichelte Fläche „Essen eintragen“ bleibt; Einfügen geht über das Symbol im Kartenkopf.
- `DiaryPage`: `const clipboard = useClipboard()`, `clipboard={clipboard ?? null}` an jede `MealCard`.
- `DiaryMealPage`: `useClipboard()`, im Kopf vor dem „+“ derselbe Einfügen-Button (gleiche `pasteWithToast`),
  nach dem Speichern-Symbol. Reihenfolge im Kopf: Speichern, Einfügen, „+“.
- Drag-and-drop: unberührt. `SwipeToDelete` ist während eines Drags weiter `disabled` (gilt auch fürs Kopieren).

### 4. Zwischenablage-Menü im Tagebuch-Kopf (`features/diary/ClipboardMenu.tsx`, neu)

- Props `clipboard: Clipboard`. `DropdownMenu` mit Trigger `Button variant="ghost" size="icon"
aria-label="Zwischenablage"` und Icon `ClipboardList` (`text-muted-foreground`, wie das Cloud-Symbol). Inhalt:
  `DropdownMenuLabel` mit Name, darunter klein `fmt0(kcal) kcal · fmtIngredients(n)` bei Gruppen bzw. die Mengen-
  angabe des Eintrags (`entryAmountLabel` auf dem ersten Item: Felder sind dieselben) bei einem Eintrag;
  `DropdownMenuSeparator`; Punkt **„Als Meal speichern“** (`Save`-Icon, nur `kind === 'group'`); Punkt
  **„Zwischenablage leeren“** (`ClipboardX`-Icon).
- „Als Meal speichern“ öffnet `NameDialog` (Titel „Als Meal speichern“, Beschreibung
  „N Zutaten werden als wiederverwendbares Meal gespeichert.“, `confirmLabel="Meal speichern"`,
  `defaultName = clipboard.name`): `saveMealFromItems(db, name, clip.items, clip.photoIds[0] ?? null)`,
  `toast.success(`„${name}“ gespeichert`)`. Die Zwischenablage bleibt gefüllt.
- „Zwischenablage leeren“: `clearClipboard(db)`; kein Toast (die Symbole verschwinden, das reicht).
- `DiaryPage`: `actions={<>{clipboard && <ClipboardMenu clipboard={clipboard} />}<SyncIndicator /></>}`.
- Das Menü ist ein Radix-Dropdown: prüfen, dass es auf dem iPhone unter dem Kopf aufgeht und die Punkte 44 px hoch
  sind (`h-11` auf `DropdownMenuItem` setzen, falls die shadcn-Vorgabe kleiner ist; gleiche Anpassung wie bei den
  anderen Touch-Größen in `components/ui`).

### 5. E2E und Doku

E2E `apps/web/e2e/meals-goals.spec.ts` (chromium-iphone), neuer Test „copy a diary group to the clipboard, paste it
into another meal and day, save it as a meal, clear“: Helfer `swipeRight(page, text)` (Spiegel von `swipeLeft`,
Start bei `box.x + 60`, Bewegung `+10 … +160`).

1. Meal mit zwei Zutaten eintragen (bestehender Ablauf), Gruppenzeile nach rechts wischen → Toast „… kopiert“,
   in jeder Mahlzeitkarte ein Button `… in Frühstück eintragen` usw., im Kopf „Zwischenablage“.
2. Einfügen in „Abendessen“ → Gruppenzeile mit gleichem Namen und kcal dort, Toast mit „Rückgängig“ → Zeile weg →
   erneut einfügen, auf den Vortag wechseln, dort einfügen → Zeile da (Zwischenablage bleibt gefüllt).
3. Zutat aufklappen, eine Zutat nach rechts wischen → Kopf-Menü zeigt den Zutatnamen, kein „Als Meal speichern“;
   einfügen → einfacher Eintrag (kein „N Zutaten“).
4. Gruppe erneut kopieren → Menü „Als Meal speichern“ → Name → `/meals` zeigt das Meal mit zwei Zutaten.
5. „Zwischenablage leeren“ → keine Einfügen-Buttons, kein „Zwischenablage“ im Kopf; Neuladen vorher mit gefüllter
   Zwischenablage zeigt die Buttons weiterhin.
6. Wischen nach links an derselben Zeile öffnet weiter den Lösch-Button (bestehender Test bleibt grün).

Doku:

- `CLAUDE.md`, Punkt „Lists“: Wischen nach rechts kopiert in die Geräte-Zwischenablage (`db/clipboard.ts`, `kv`-
  Schlüssel `clipboard`, Momentaufnahme; Gruppe mit `mealId`/`groupName`/`aiAnalysisId`/`photoIds`, Eintrag einfach);
  Einfügen-Symbol je Mahlzeit (`MealCard`, `/diary-meal`), `ClipboardMenu` im Tagebuch-Kopf (Als Meal speichern für
  Gruppen, leeren); `logItems` liefert Ids. Wording: Toast „kopiert“, „… eingetragen“.
- `docs/sync.md`, Absatz zu Geräte-Entwürfen: `kv`-Schlüssel `clipboard` (nicht synchronisiert; Foto-Ids werden
  geteilt, nicht kopiert).

## Kritische Dateien

- `apps/web/src/db/clipboard.ts` (neu), `apps/web/src/db/entries.ts` (`logItems` → Ids, `saveMealFromItems`)
- `apps/web/src/hooks/data.ts` (`useClipboard`)
- `apps/web/src/components/SwipeToDelete.tsx`
- `apps/web/src/features/diary/MealCard.tsx`, `DiaryPage.tsx`, `DiaryMealPage.tsx`,
  `features/diary/ClipboardMenu.tsx` (neu)
- `apps/web/src/features/meals/MealLogView.tsx`, `features/ai/*` (Aufrufer von `logItems`/`logAiItems`, nur
  Rückgabetyp)
- `apps/web/src/components/ui/dropdown-menu.tsx` (Touch-Höhe)
- Tests: `apps/web/test/write.test.ts`, `apps/web/test/components.test.tsx`, `apps/web/e2e/meals-goals.spec.ts`
- Doku: `CLAUDE.md`, `docs/sync.md`

Wiederverwenden: `entriesToMealItems`, `logItems`, `photoIdsOf`, `fmtIngredients`, `fmt0`, `NameDialog`,
`deleteRecord`, `DropdownMenu`, Icons `Copy`, `ClipboardPaste`, `ClipboardList`, `ClipboardX`, `Save` (lucide, alle
vorhanden).

## Verifikation

Automatisch je Block: `pnpm lint`, `pnpm typecheck`, `pnpm test`; am Ende `pnpm e2e` (chromium-iphone; webkit-iphone
fehlt im Container, wie bisher).

Manuell auf dem iPhone (Nutzer): Wischen nach rechts auf Gruppen- und Einzelzeilen (Vibration, Toast), Wischen
nach links weiter löschen, langer Druck weiter verschieben, Einfügen-Symbol und Kopf-Menü, Menü-Punkte gut
tippbar.

## Ablauf für Opus 5.5

Lesereihenfolge: `CLAUDE.md`, dieser Plan, dann `components/SwipeToDelete.tsx`, `features/diary/MealCard.tsx`,
`DiaryPage.tsx`, `DiaryMealPage.tsx`, `db/entries.ts` (`logItems`, `entriesToMealItems`, `saveMealFromEntries`),
`db/groupDraft.ts` (Muster für `kv`-Zugriffe), `components/NameDialog.tsx`, `components/ui/dropdown-menu.tsx`,
`test/components.test.tsx` (Block `SwipeToDelete`), `e2e/meals-goals.spec.ts` (`swipeLeft`, `saveDiaryMeal`).

Ein Commit je Block, vor jedem Commit `pnpm lint`, `pnpm typecheck`, `pnpm test` (E2E am Ende von Block 5).
Abweichungen vom Plan melden statt still entscheiden. Keine Em- oder En-Dashes in UI-Texten und Kommentaren.

1. Daten: `db/clipboard.ts`, `logItems` liefert Ids, `saveMealFromItems`, `useClipboard`, Tests (Abschnitt 1).
   Dieser Plan kommt mit in den ersten Commit.
2. `SwipeToDelete` mit `onCopy`, Tests (Abschnitt 2).
3. Zeilen kopieren, Einfügen-Symbol in `MealCard` und `/diary-meal`, Toasts (Abschnitt 3).
4. `ClipboardMenu` im Tagebuch-Kopf mit `NameDialog` und Leeren (Abschnitt 4).
5. E2E-Test, Doku (Abschnitt 5).

## Umsetzung (2026-10-19)

Umgesetzt in den Commits 32d4ebe bis zum Doku-Commit, Blöcke wie oben. Abweichungen vom Plan:

- Der Kopierbereich beim Wischen nach rechts ist **grau** (`bg-muted-foreground`), nicht blau und nicht
  `bg-primary`: die Primärfarbe ist rot wie Löschen, und Blau (`--exercise`) ist laut CLAUDE.md die Trainingsfarbe.
- `copyLabel` entfällt: der Kopierbereich ist kein Button (`aria-hidden`), ein Name wäre nirgends angekommen.
- `logAiItems` und `logAiMeal` liefern weiter die Anzahl (nur `logItems` liefert Ids), damit ihre Aufrufer
  unverändert bleiben.
- `DropdownMenuItem` hat jetzt `min-h-11` (44 px Touch-Höhe).
- E2E: neuer Test „clipboard: …“ in `meals-goals.spec.ts`; `chromium-iphone` komplett grün (32 Tests),
  `webkit-iphone` läuft im Container weiter nicht.
