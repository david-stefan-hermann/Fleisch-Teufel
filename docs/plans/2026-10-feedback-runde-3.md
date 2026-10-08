# Feedback-Runde 3: Taschenlampe, Analysen-Fotos, Swipe-Löschen, Papierkorb, Nährstoffansicht

## Context

Neun Rückmeldungen des Users nach dem letzten UI-Durchgang (Commit 3cbb565). Vier davon sind kleine
UI-Korrekturen (Torch-Icon, Slider-Range, Swipe statt Button, Suche im Reiter „Eigene“), drei erweitern
Flows (zweiter Button in der Foto-Analyse, Papierkorb, Meals per Swipe löschen), einer ist ein Bugfix
(Thumbnails der Analysen laden nur manchmal) und einer ist ein Querschnittsthema: eine einheitliche
Makro/Mikro-Übersicht an jeder Stelle der App.

Geklärte Designentscheidungen (User, Stand nach der zweiten Rückmeldung):

- „Nur eintragen“ aus der Analyse: Zutaten **gruppiert ohne gespeichertes Meal**, Gruppe trägt den Namen aus dem Review.
- Makro-Anteile sind **prozentual auf die Makro-Energie** bezogen, der gestapelte Balken ist immer zu 100 % gefüllt.
- Tagesübersicht: die **drei Zielbalken bleiben** wie heute. Der Button „Nährstoffe“ darunter blendet sie aus und zeigt
  stattdessen die Nährstoffübersicht (mit Tageszielen als Zusatztext). „Weniger“ bringt die Zielbalken zurück.
- Der Aufklapper für Mikronährstoffe heißt **„Weitere Nährstoffe“**, nicht „Nährstoffe“.
- Mikro-Zeilen: Name linksbündig, Menge und Ziel rechtsbündig. Das Tagesziel („21 g von mind. 30 g“) steht
  **überall**, auch bei Lebensmittel, Meal und Analyse, mit Statusbalken.
- **Überschuss** in Zielbalken (Tagesübersicht geschlossen, und überall wo Balken relativ zum Ziel stehen): Balken
  voll in Makro-Farbe, darüber von links ein roter Balken mit der Breite des Anteils über dem Ziel. Keine Legende.
- **Tagesmodus**: Tipp auf die kcal-Zahl in Lebensmittel, Meal, Analyse und Mahlzeit-Seite schaltet um. Kopf
  „620 / 1.700 kcal“ mit Hinweis „Anteil am Tagesziel“, der dicke Verteilungsbalken bleibt, Makro-Zeilen zeigen
  „35 g / 130 g · 27 %“ mit Balken relativ zum Tagesziel. Nochmal tippen schaltet zurück. „Tagesmenge“ = Tagesziel.
  Tagesübersicht und Berichte haben keinen Wechsel: dort stehen die Makro-Balken immer relativ zum Ziel.
- Mahlzeit im Tagebuch (Frühstück, Mittag, ...): Tipp auf die Kopfzeile öffnet eine **eigene Seite** mit der Übersicht
  und den Einträgen der Mahlzeit, kein Aufklappen in der Karte.
- Gespeichertes Meal und Lebensmittel öffnen beim Tipp ihre Detailseite, die dieselbe Übersicht zeigt.
- „Berichte“: die Durchschnitts-Kacheln für Nährstoffe werden durch dieselbe Übersicht ersetzt (Ø pro Tag),
  die übrigen Kennzahlen (kcal, Tage, Gewicht, Training) bleiben Kacheln.
- Suche im Reiter „Eigene“: filtert **Meals und eigene Lebensmittel**, keine BLS/Online-Suche.

Regeln aus CLAUDE.md, die hier besonders greifen: Schreiben nur über `saveRecord`/`patchRecord`/`deleteRecord`,
React-Compiler-Lint (kein setState in Effects), keine Gedankenstriche in UI-Strings, Text in Ink-Tokens
(Makro-Farben nur für Balken/Punkte), Toasts unten, Undo bei jedem Löschen.

---

## 1. Taschenlampen-Button

`apps/web/src/components/BarcodeScanner.tsx:67-82` (`TorchButton`, genutzt von `/scan` und `features/ai/PhotoPage.tsx:217-222`).

- Immer das Icon `Flashlight` (nie `FlashlightOff`): das Icon zeigt den Zustand, nicht die Aktion.
- Aus: wie bisher `bg-black/55 text-white`.
- An: invertiert, `rounded-full bg-white text-black hover:bg-white/90` (weißer Kreis, schwarzes Icon).
  `aria-pressed` und `aria-label` bleiben.
- `toggleTorch` (Z. 124-136): `setTorchOn(on)` nur im `.then` von `applyConstraints`, damit der Zustand
  nicht kippt, wenn die Kamera den Torch ablehnt.

## 2. Thumbnails der Analysen laden nur manchmal

Siehe Abschnitt 9b (Ergebnis des Design-Agenten).

## 3. Meals per Swipe löschen

`apps/web/src/features/meals/MealsPage.tsx:29-49`: jede `<li>` in `SwipeToDelete` (`src/components/SwipeToDelete.tsx`,
Props `label`, `onDelete`) wickeln, Muster wie `features/exercise/ExercisePage.tsx:176-194`:

```ts
await deleteRecord(db, 'meals', m.id);
toast(`${m.name} gelöscht`, {
  action: { label: 'Rückgängig', onClick: () => void restoreRecord(db, 'meals', m.id) },
});
```

Der Trash-Button im Header von `MealPage.tsx:80-95` bleibt (Tastatur-Zugang laut SwipeToDelete-Kommentar).

## 4. Zweiter Button „Nur eintragen“ in der Foto-Analyse

**Neues synchronisiertes Feld** `groupName` auf `foodEntries` (Name der Gruppe ohne gespeichertes Meal):

1. `packages/shared/src/schemas.ts:153-173`: `groupName: z.string().trim().max(120).nullable().default(null)`.
2. `apps/api/src/db/schema.ts:139-161`: `groupName: text()`; dann `pnpm --filter @ft/api db:generate -- --name food-entry-group-name`, SQL in `apps/api/drizzle/` committen.
3. Dexie: kein Versions-Bump (nicht indiziert).
4. `apps/api/test/sync.test.ts`: Round-Trip um `groupName` erweitern; `docs/sync.md` Feldliste ergänzen.

**Gruppierung:** `packages/shared/src/diary.ts:130-157` `groupDiaryEntries`: Gruppenzeile bekommt
`groupName: string | null` (vom ersten Eintrag). `features/diary/MealCard.tsx:183`: Name =
`mealInfo.name || row.groupName || 'Meal'`; `GroupRow` zeigt ohne Foto weiterhin das Kamera-Icon (`fromPhoto`).

**Schreiben:** `apps/web/src/db/entries.ts`

- `logItems` (Z. 63-98): Option `groupName?: string | null`; `groupId` wird erzeugt, wenn `mealId` **oder** `groupName` gesetzt ist; jedes Entry bekommt `groupName`.
- `saveAiMeal` (Z. 133-160): das Mapping `{food, grams}` → `MealItem[]` in `aiMealItems(items)` herausziehen.
- Neu `logAiItems(db, name, items, target, analysis)`: `logItems(db, aiMealItems(items), target, { groupName: name, aiAnalysisId })`. Kein `storePhoto`, kein `saveRecord('meals')`.
- Alle anderen `saveRecord('foodEntries', …)`-Aufrufe (`AddFoodPage.tsx:151`, `FoodLogPage`, `QuickAddPage`, Copy-Meal) setzen `groupName: null` (oder verlassen sich auf den Default; prüfen, ob Zod-Default beim Parse greift: `saveRecord` validiert mit Zod, daher reicht der Default).

**UI:** `features/ai/PhotoPage.tsx` `ResultEditor`, Z. 658-664:

- Primär `Als Meal speichern & eintragen` (wie bisher).
- Sekundär (`variant="outline"`, `size="lg"`): `Nur eintragen`. Ablauf wie `save()` (rememberFood, Queue-Item löschen, Toast `„Name“ eingetragen` ohne Beschreibung, Navigation), aber mit `logAiItems`.
- Hilfetext anpassen: „… Mit „Nur eintragen“ landen die Zutaten als Gruppe im Tagebuch, ohne Meal und ohne Foto.“
- `apps/web/test/write.test.ts` / `meals-photos.test.ts`: Test für `logAiItems` (Gruppe mit `groupName`, kein Meal, kein Foto).

## 5. Suche im Reiter „Eigene“ durchsucht nur Eigenes

`apps/web/src/features/foods/AddFoodPage.tsx`:

- Z. 81: `const searching = q.length >= 2 && tab !== 'mine'`. Online-Suche (`wantsOnline`) hängt bereits an `searching`.
- Z. 206: Tabs: bei `tab === 'mine'` bleibt der Reiter aktiv; `setTab` löscht die Query weiterhin.
- Reiter-Inhalt `mine` (Z. 305-333): `custom` und `meals` nach `q` filtern. Dafür `normalize` aus
  `packages/shared/src/search.ts` nutzen (Umlaute/Akzente falten): `normalize(name).includes(normalize(q))`,
  zusätzlich Zutatennamen der Meals. Bei `q.length >= 2` ohne Treffer: `EmptyState` „Nichts Eigenes gefunden“
  mit Link „Eigenes Lebensmittel anlegen“ (`/custom-food/new`, vorhandene Route prüfen).
- Platzhalter der Suchleiste im Reiter „Eigene“: „Eigene Lebensmittel und Meals suchen…“.
- E2E `apps/web/e2e/food-search.spec.ts:40-44`: Aussage „whatever tab is selected“ gilt nur noch für
  Häufig/Kürzlich; neuer Schritt: im Reiter „Eigene“ tippen filtert die eigene Liste, keine Markenprodukte-Überschrift.

## 6. Gewichtseinträge nur per Swipe löschen

`apps/web/src/features/progress/ProgressPage.tsx:173-219`: Trash-`Button` entfernen, `<li>` in `SwipeToDelete`
(`label={`Eintrag vom ${fmtDate(w.date)} löschen`}`) wickeln, bestehenden Delete+Undo-Code (Z. 203-211) als
`onDelete` verwenden. Der Edit-Dialog (`WeightDialog`) bleibt der Tastaturweg; Löschen dort nicht nötig,
da der Papierkorb Wiederherstellung bietet.

## 7. Papierkorb für Gewicht und Meals

Soft-Deletes sind bereits dauerhaft (`deleted: true`, nie gepurgt, `updatedAt` = Löschzeit), `restoreRecord`
existiert (`apps/web/src/db/write.ts:49-52`). Kein Schema-, Sync- oder Migrationsaufwand.

- Route `trash: createRoute({ ...r('/settings/trash'), component: lazyRouteComponent(() => import('@/features/more/TrashPage'), 'TrashPage') })` in `apps/web/src/app/router.tsx:205-211`.
- `apps/web/src/features/more/TrashPage.tsx` (Vorlage `DataPage.tsx`): `Page title="Papierkorb" back="/more" withTabBar={false}`.
  - Section „Gewicht“: `db.weightEntries.filter(w => w.deleted).reverse().sortBy('updatedAt')`; Zeile: Datum, kg, „gelöscht am …“ (`fmtDate(updatedAt)`), Button „Wiederherstellen“ (`restoreRecord`).
    Sonderfall deterministische Id `w:<date>`: wenn für den Tag inzwischen ein aktiver Eintrag existiert, ist der Tombstone bereits überschrieben, taucht also gar nicht auf. Hinweis in der Section-Beschreibung: „Ein Eintrag pro Tag: ein neues Gewicht am selben Tag ersetzt den gelöschten.“
  - Section „Meals“: `db.meals.filter(m => m.deleted)`, Zeile mit `MealPhoto`, Name, Zutatenzahl, „Wiederherstellen“.
  - Leerzustand pro Section (`EmptyState`), Toast `… wiederhergestellt` nach Restore.
  - Kein endgültiges Löschen (keine Purge-Semantik im Sync; bewusst weggelassen, in der Doku vermerken).
- `features/more/MorePage.tsx:93-109`: `Row to="/settings/trash" icon={<Trash2/>} label="Papierkorb" hint={`${n} Einträge`}` (Zähler per `useLiveQuery` über beide Tabellen) in der Daten-Section.
- `docs/sync.md`: Satz zum Papierkorb bei der Tombstone-Zeile.

## 8. Gewichtsslider ±5 kg

`apps/web/src/features/progress/ProgressPage.tsx:234`: `WEIGHT_SLIDER_RANGE_KG = 5`.
E2E `apps/web/e2e/diary-training.spec.ts:230-240` („spans ±10 kg“, erwartet 74/95 kg bei 84,5) auf ±5
(79 kg / 90 kg) anpassen.

## 9a. Einheitliche Nährstoffübersicht `NutrientBreakdown`

### Shared-Mathe

`packages/shared/src/nutrition.ts`, auf Basis von `macroEnergyShares` (Anteile summieren sich zu 100):

```ts
export type MacroKey = 'protein' | 'carbs' | 'fat';
export interface EnergyBreakdown {
  kcal: number; // gemeldete Energie des Items (ENERCC), Kopfzahl
  macros: Record<MacroKey, { grams: number; kcal: number; share: number }>;
  // kcal = Gramm × KCAL_PER_G (Atwater), share 0..1 der Makro-Energie, Summe der shares = 1
}
export function energyBreakdown(map: NutrientMap | undefined): EnergyBreakdown;
```

Der gestapelte Balken ist damit immer voll gefüllt, die drei Prozentwerte ergeben 100. Die Makro-kcal können
in Summe leicht von der Kopfzahl abweichen (Ballaststoffe, Alkohol, Rundung); das ist gewollt und ehrlich.
Leere Map: alle Werte 0, kein NaN. Tests in `packages/shared/test/nutrition.test.ts` (Normalfall, nur ein Makro
= 100 %, leere Map).

### Komponente `apps/web/src/components/NutrientBreakdown.tsx`

```ts
interface NutrientBreakdownProps {
  nutrients: NutrientMap; // absolute Werte (Portion, Mahlzeit, Meal, Tag, Ø Tag)
  title?: ReactNode; // z. B. "Summe" links neben der kcal-Zahl
  /** Ziele des Tages (kcal, Makro-Gramm, Mikros). Immer gesetzt: Mikros zeigen "von mind./max.", der Tagesmodus
   *  rechnet die Makros dagegen. */
  targets: ResolvedTargets;
  /** 'item' (Standard): Eintragsmodus, Tipp auf kcal schaltet in den Tagesmodus und zurück.
   *  'day': Tagesübersicht und Berichte; kein Wechsel, Kopf "1.640 / 1.700 kcal", Balken relativ zum Ziel. */
  variant?: 'item' | 'day';
  showMicroSources?: boolean;
  defaultMicrosOpen?: boolean;
  microsOpen?: boolean;
  onMicrosOpenChange?: (o: boolean) => void;
  className?: string;
}
```

Aufbau (ein `useId`, keine Effects; Zustand: `dayMode` per `useState(false)` für den Tipp auf kcal, Mikros in
Radix `Collapsible` aus `components/ui/collapsible.tsx`):

1. **Kopf**: `title` links, rechts die kcal-Zahl. Bei `variant='item'` ist sie ein `<button aria-pressed={dayMode}>`
   („Anteil am Tagesziel anzeigen“), dezent hinterlegt. Eintragsmodus: `fmt0(kcal)` + „kcal“. Tagesmodus und
   `variant='day'`: `fmt0(kcal) / fmt0(targets.kcal) kcal`, im Tagesmodus zusätzlich die Zeile „Anteil am Tagesziel“.
   Darunter immer `EnergySplitBar` (`h-2`, Segmente `bg-protein/bg-carbs/bg-fat` mit `share*100 %`, zusammen 100 %),
   `role="img"` mit Label „Energieverteilung: Protein 23 %, Kohlenhydrate 40 %, Fett 37 %“. Ohne Makros: leere Spur.
2. **Makro-Zeilen** (Protein, Kohlenhydrate, Fett; Labels aus `DISPLAY_NUTRIENTS`), Zeile 1 Farbpunkt + Titel links,
   rechts tabular gedämpft, Zeile 2 `TargetBar`/Share-Balken `h-1.5`:
   - Eintragsmodus: `fmtGrams(g) · fmtPercent(share) · fmt0(kcal) kcal`, Balken = `share` (Energieanteil).
   - Tagesmodus (`item` umgeschaltet): `fmtGrams(g) / fmtGrams(target) · fmtPercent(g/target)`, Balken = `g/target`.
   - `variant='day'`: `fmtGrams(g) / fmtGrams(target) · fmtPercent(share) · fmt0(kcal) kcal`, Balken = `g/target`.
   - Balken relativ zum Ziel mit **Überschuss**: `TargetBar` (neu in `components/MacroBars.tsx`, auch von `MacroBars`
     genutzt): Spur `bg-muted`, Füllung `min(100, g/target)` in Makro-Farbe, bei `g > target` zusätzlich ein
     absolut positionierter `bg-over`-Balken von links mit Breite `min(100, (g - target)/target)`. Grammzahl `text-over`.
     `role="meter" aria-valuemax={target} aria-valuenow={g}`; Share-Balken `aria-valuetext="23 % der Energie, 140 kcal"`.
     Prozenttext in Ink-Tokens, Farbe nur Punkt/Balken.
3. **Mikros** `Collapsible` (Trigger **„Weitere Nährstoffe“**, `min-h-11`, Chevron wie AddFoodPage): Ballaststoffe, Zucker,
   gesättigte Fettsäuren, Salz als `flex justify-between`: Name linksbündig, rechts `fmtGrams(v)` + „von mind./max. X g“
   aus `targets.micros`, Statusbalken `bg-over | bg-good | bg-foreground/40` über `microStatus` (Logik aus `NutrientList`),
   `NO_VALUE` wenn der Code fehlt; optional Quelle (`MICRO_DEFAULTS[key].source` / „Eigener Zielwert“).
   Darin zweites `Collapsible` **„Alle N Nährstoffe“**, wenn mehr Katalog-Codes als `DISPLAY_NUTRIENTS` vorhanden sind
   (Katalog `@ft/shared/nutrients-catalog.json` wandert aus FoodLogPage hierher), Werte der angezeigten Menge
   (nicht mehr pro 100 g; „100 g“-Portion wählen zeigt pro 100 g).

**Ziele je Einsatzstelle** (`targetsForDate(goals, date)` aus `@ft/shared`, `goals` über `useGoals()`): FoodLogPage und
MealPage nehmen `search.date ?? today`, PhotoPage `item.date`, DiaryMealPage `date`, CalorieCard `summary.targets`,
Berichte den Durchschnitt (siehe unten).

### Einsatzstellen

- `features/foods/FoodLogPage.tsx:451-507`: Section-Inhalt wird `<NutrientBreakdown nutrients={nutrients} targets={targets} />`.
  Entfernen: `showAll`, `micros/allRows/per`, lokales `Macro` (555-565), `CATALOG`, Imports `MacroSplitBar`, `fmt1`, `NO_VALUE`, `ChevronDown`.
- `features/diary/CalorieCard.tsx`: Ring und Ziel/Essen/Training/Übrig bleiben. Darunter bei `!open` wie heute die
  drei `MacroBars` (Zielfortschritt), jetzt mit Überschuss-Overlay über `TargetBar`. Bei `open` werden die `MacroBars`
  **ersetzt** durch `<NutrientBreakdown variant="day" nutrients={summary.food} targets={t} showMicroSources={sources} defaultMicrosOpen />`
  plus dem Button „Woher kommen die Zielwerte?“. Der Toggle-Button darunter heißt „Nährstoffe“ / „Weniger“
  (localStorage-Präferenz `readOpen/writeOpen` und Karten-`onClick` bleiben). `NutrientList` entfällt.
- `features/diary/MealCard.tsx`: Kopfzeile (Name + kcal) wird ein `Link` auf die neue Seite `/diary-meal` mit
  `search={{ date, meal }}` (`min-h-11`, Chevron rechts). Keine Aufklapp-Logik in der Karte. `MealMicros` und Prop
  `showMicros` löschen (`DiaryPage.tsx:108`). `NutrientSummary` (Zeilen-Readout) bleibt.
- **Neue Seite** `features/diary/DiaryMealPage.tsx`, Route `diaryMeal: createRoute({ ...r('/diary-meal'), validateSearch: date + meal, component: lazy })`
  in `router.tsx`: `Page title={mealName} back withTabBar={false}`, Untertitel `fmtRelativeDay(date)`.
  Inhalt: `Section` mit `<NutrientBreakdown nutrients={totals} title="Summe" targets={targetsForDate(goals, date)} />`, darunter `Section title="Einträge"`
  mit den Zeilen der Mahlzeit (`groupDiaryEntries`, `EntryRow`/`GroupRow` aus MealCard wiederverwenden, ohne DnD),
  Leerzustand „Noch nichts eingetragen“ mit `useAddSheet().open({ date, meal })`. Entries per `useLiveQuery`
  über `db.foodEntries.where('date').equals(date)` gefiltert nach `meal` und `!deleted`.
- `features/meals/MealPage.tsx:115-122`: Titel wieder „Zutaten“, `MacroSplitBar` raus, neue
  `<Section title="Nährwerte">` mit `NutrientBreakdown nutrients={totals}` zwischen „Zutaten“ und „Eintragen“.
  Tipp auf ein Meal in Listen (`MealsPage`, `AddFoodPage` Reiter Eigene) führt bereits hierher.
- Lebensmittel: `FoodLogPage` zeigt die Übersicht (siehe oben); Tipp auf einen Tagebucheintrag öffnet sie bereits.
- `features/ai/PhotoPage.tsx:634-642`: „Summe“-Zeile + `MacroSplitBar` ersetzen durch `<NutrientBreakdown nutrients={totals} title="Summe" />`
  (E2E-Locator `hasText: 'Summe'` in `meals-goals.spec.ts:203` bleibt gültig).
- **Berichte** `features/reports/ReportsPage.tsx:166-203`: Kacheln „Ø Protein“, „Ø Kohlenh.“, „Ø Fett“, „Ø Ballaststoffe“,
  „Ø Salz“ entfallen. Die Kachel-Zeile behält „Ø kcal“, „Tage erfasst“, „Gewicht“, „Training“ (2×2 oder 3+1).
  Darunter in derselben Section `<NutrientBreakdown variant="day" nutrients={stats.avgNutrients} title="Ø pro Tag" targets={{ ...stats.avgTargets, goalId: null, micros: targetsForDate(goals, p.to).micros }} />`
  (nur bei `loggedDays > 0`). Hinweistext „Durchschnitte nur über Tage mit Einträgen“ bleibt.
  `packages/shared/src/reports.ts` `periodStats`: neue Felder `avgNutrients: NutrientMap` (Durchschnitt aller Codes
  über geloggte Tage, über `sumNutrients` + `multiplyNutrients(1/n)`) und `avgTargets: DayTarget`
  (Mittel von `targetKcal` und `DailyRow.target*G`). `avg.*` bleibt für CSV/Tests. Test in `packages/shared/test/reports.test.ts` erweitern.
- **Löschen**: `MacroSplitBar` aus `components/MacroBars.tsx` (dort bleiben `MacroBars` und das neue `TargetBar`),
  `features/diary/NutrientCard.tsx`, `MealMicros`.
- CLAUDE.md: Hinweis „Nährwerte immer über `components/NutrientBreakdown.tsx`; `MacroBars`/`TargetBar` nur für den Zielfortschritt“.

### Tests

- `apps/web/test/components.test.tsx`: `MacroBars`-Tests um den Überschuss erweitern (Wert 76 bei Ziel 55: Füllung 100 %,
  Overlay 38 %); neues Describe `NutrientBreakdown`: Anteile (`{ENERCC:200, PROT625:10, CHO:20, FAT:5}` → Meter 24/49/27,
  Summe 100), nur Carbs → 100 %, Null-Fall (kein `NaN`, `NO_VALUE`), Tipp auf kcal schaltet in den Tagesmodus
  (`aria-pressed`, Text „/ 1.700“, Zeile „35 g / 130 g · 27 %“) und zurück, `variant="day"` ohne Button,
  Collapsibles („Ballaststoffe von mind. 30 g“ erst nach Klick auf „Weitere Nährstoffe“, „Alle N“ nur bei Katalog-Codes),
  controlled `onMicrosOpenChange`.
- E2E `meals-goals.spec.ts:72-83`: Button „Nährstoffe“ öffnet, die drei Zielbalken verschwinden, „Weniger“ schließt.
  Neuer Schritt: Tipp auf „Frühstück“ öffnet `/diary-meal` mit „Summe“ und den Einträgen.

## 9b. Foto-Fix: Analysen-Thumbnails laden nur manchmal

**Diagnose (aus dem Code bestätigt):** `db.aiQueue.update(...)` (`features/ai/queue.ts:33-42`, `PhotoPage.tsx:415` bei jedem
Tastendruck/Slider-Schritt, `db/aiDraft.ts`) schreibt den ganzen Datensatz inkl. 300-500 KB Blob neu. Auf WebKit sind
IDB-Blobs dateigestützt; ein früher gelesenes Blob-Objekt wird nach dem Neuschreiben unlesbar (`WebKitBlobResource error 1`).
`useObjectUrl` (`components/MealPhoto.tsx:75-99`) behält absichtlich das **erste** Blob-Objekt bei gleichem Key, das
`<img>` in `QueueRow` hat kein `onError`. Gleiches Muster einmalig in `photos` (`uploaded: 1`-Update nach dem Upload).

**Fix: Bytes statt Blob, eigene Tabelle, onError-Netz.**

- `apps/web/src/db/dexie.ts`: `AiQueueItem.image?: Blob` (Legacy, optional), neue Tabelle
  `aiImages: { localId: number; bytes: ArrayBuffer; type: string }`, `this.version(4).stores({ aiImages: 'localId' })`
  ohne `.upgrade()` (Blob → ArrayBuffer braucht ein Nicht-IDB-Promise). `LocalPhoto` bekommt `bytes?: ArrayBuffer; type?: string`,
  `blob?: Blob` nur noch Legacy. Gerätelokal, kein Sync/API/Doku-Impact.
- `features/ai/queue.ts`: `imageBlob(row)`, `loadQueueImage(db, item)` (neue Tabelle, Fallback `item.image`),
  `enqueuePhoto(db, item, image)` (`arrayBuffer()` **vor** der rw-Transaktion über `aiQueue`+`aiImages`),
  `discardQueueItem(db, localId)` (beide Zeilen), `migrateLegacyImages(db)` (einmalig am Anfang von `processQueue`:
  Blob → `aiImages`, `image` entfernen, verwaiste `aiImages` löschen). `processQueue`: fehlendes Bild → `failed` „Foto nicht mehr vorhanden“.
- `features/ai/PhotoPage.tsx`: Hook `useAiImage(item)` (`useLiveQuery` auf `aiImages`, Legacy-Fallback);
  `QueueRow` rendert `<MealPhoto blob={image} blobKey={`ai:${localId}`} />` statt eigenem `<img>`; `ResultEditor` nutzt
  `useAiImage`, übergibt `image ?? null` an `saveAiMeal`, löscht mit `discardQueueItem` (Z. 380, 465).
- `db/photos.ts`: `storePhoto` speichert `bytes`+`type` (Signatur unverändert), `uploadPendingPhotos` sendet
  `p.bytes ?? p.blob`, `loadPhoto` speichert `res.arrayBuffer()` und gibt einen in-memory Blob zurück; `photoBlob(p)` Helper.
- `components/MealPhoto.tsx`: `usePhotoBlobFrom` liest über `photoBlob`; `MealPhoto` bekommt `retries`-State,
  Key `${key}#${retries}` verwirft das gehaltene Blob, `<img onError>` bumpt bis 2 Versuche, danach `ImageOff`.
  `useObjectUrl` selbst bleibt unverändert.
- Tests `apps/web/test/meals-photos.test.ts`: `enqueuePhoto` legt `aiImages`-Zeile ohne `image` am Queue-Datensatz an,
  `loadQueueImage` für neue und Legacy-Form, `discardQueueItem`, `migrateLegacyImages`; Photos: `bytes instanceof ArrayBuffer`,
  Legacy-Lesen. `components.test.tsx`: `MealPhoto` feuert `error` → zweiter `createObjectURL`-Aufruf, nach dem zweiten Fehler Platzhalter.
  `apps/api/test/device-sync.test.ts` nutzt nur `storePhoto`/`loadPhoto`: unverändert.

---

## Reihenfolge

1. Kleinkram ohne Abhängigkeiten: 1 (Torch), 8 (Slider), 6 (Gewicht Swipe), 3 (Meals Swipe), 5 (Eigene-Suche).
2. 7 Papierkorb (nutzt nur Bestehendes).
3. 4 „Nur eintragen“ (Shared-Schema, API-Migration, Gruppierung, UI).
4. 9b Foto-Fix (Dexie v4, queue, photos, MealPhoto).
5. 9a `NutrientBreakdown` (Shared-Helper, Komponente, Einsatzstellen inkl. neuer Mahlzeit-Seite und Berichte, Löschungen).
6. Tests/E2E anpassen, Doku (CLAUDE.md, docs/sync.md), ein Commit pro Block oder ein Sammel-Commit nach Absprache.

## Verifikation

- `pnpm lint && pnpm typecheck && pnpm test` (sequentiell, Container-RAM).
- `pnpm e2e` (chromium-iphone): angepasste Specs `food-search`, `diary-training`; neue Schritte: Meal swipen + Undo,
  Gewicht swipen + Papierkorb-Restore, „Nur eintragen“ erzeugt Gruppe mit Namen, Torch-Button `aria-pressed`.
- Manuell im Dev-Server (`pnpm dev`, PC: Vite-Port) mit Playwright-MCP: Food-Detail, Meal, Analyse-Review,
  Tagesübersicht (nach „Nährstoffe“), Mahlzeit-Seite und Berichte zeigen dieselbe `NutrientBreakdown`; Light/Dark prüfen.
- Foto-Fix: Analyse anlegen, Slider mehrfach bewegen (Draft-Writes), Seite neu laden, Thumbnail und Review-Bild
  bleiben sichtbar; auf dem iPhone (PWA via WireGuard) gegentesten.
- DB-Migration: `pnpm --filter @ft/api db:generate` erzeugt genau eine SQL-Datei; API-Sync-Test rund um `groupName` grün.
