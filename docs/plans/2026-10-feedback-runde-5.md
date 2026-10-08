# Feedback-Runde 5: Implementierungsplan

Nach Freigabe als `docs/plans/2026-10-feedback-runde-5.md` ablegen. Referenz für Optik und Wortlaut ist das Mockup
`docs/plans/2026-10-feedback-runde-5-mockup.html` (v3, Kasten „Entschieden“). Der Mockup-Plan
`docs/plans/2026-10-feedback-runde-5-mockups.md` beschreibt den Ist-Zustand. Beide werden mit Block 1 committet.

## Context

Nach Runde 4 hat der User zwölf Rückmeldungen gegeben. Das Mockup ist in drei Iterationen abgestimmt. Ziel dieser
Runde:

- **Bearbeiten:** Bearbeiten über einen Stift im Header; Speichern führt zur vorherigen Seite zurück.
- **Schnelleingabe:** Der Blitz sitzt auf der Essen-Seite.
- **Training:** Suche in der Schnellauswahl.
- **Nährwerte je Zutat:** im Meal-Editor, beim Eintragen und im Analyse-Review.
- **Eigenes Lebensmittel:** ausfüllbare Nährwertübersicht mit Kalorien-Automatik, Barcode-Scan und Sticky-Speichern.
- **Berichte:** Kalorienbalken nach Makros, ohne Neuladen-Effekt.
- **Plus-Menü:** Kacheln getauscht.
- **Zoom:** kein Pinch-Zoom mehr.
- **Analyse-Review:** „Neu analysieren“ mit editierbarem Hinweis.
- **Neu:** eigene Lebensmittel per Etikettfoto ausfüllen.

### Entscheidungen (User, 2026-10-08), zusätzlich zum Kasten im Mockup

1. **Kalorien-Automatik nach EU-Formel:** kcal = 4 × Protein + 4 × Kohlenhydrate + 9 × Fett + 2 × Ballaststoffe.
   Die Prozent-Aufteilung der Makros (Leiste, Prozente, Berichte) bleibt bei 4/4/9 (`energyBreakdown`). „Omas
   Apfelkuchen“ hat damit 289 statt 285 kcal; das Mockup wird nicht mehr angepasst.
2. **Automatik ohne neues Datenfeld:** Gespeichert werden alle 10 Werte, ein Modus-Flag gibt es nicht. Beim Öffnen gilt
   Automatik, wenn die gespeicherten kcal zur Formel passen (Toleranz 0,5 kcal). Das Datenformat, Dexie und der Sync
   bleiben unverändert.
3. **Barcode-Duplikat:** Hat ein anderes, nicht gelöschtes eigenes Lebensmittel denselben Barcode, steht unter dem Feld
   grau „Schon bei „Bananenbrot“ hinterlegt.“. Speichern bleibt erlaubt.
4. **Speichern führt zurück:**
   - **Löschen im Editor:** Kam man von der Lebensmittel-Seite oder von „Meal eintragen“, führt Löschen dorthin zurück,
     wo diese Seite geöffnet wurde (Suche bzw. Tagebuch), nicht auf die tote Seite. Kam man aus Mehr, zurück zur Liste.
     Der Rückgängig-Toast bleibt wie heute.
   - **Nachfrage:** Nach dem Speichern fragt der Meal-Editor nicht mehr nach ungespeicherten Änderungen.
   - **Meal eintragen** zeigt danach die neuen Zutaten.
   - **„Anlegen und eintragen“** bleibt beim heutigen Weg.
5. **Neu analysieren:** Jeder Tipp ist ein Claude-Aufruf. Solange eine Analyse läuft oder wartet, ist ↻ gesperrt. Die
   Warteschlange liegt nur auf dem Gerät (`aiQueue` ist nicht in `SYNC_SCHEMAS`). Ein schon als Meal gespeicherter
   Review behält `savedMealId` und den Chip „Gespeichert“; die neuen Zutaten gehen erst beim Eintragen an das Meal,
   wie heute über `logAiMeal`.
6. **Berichte:** Legende und die Screenreader-Tabelle zeigen nur „Gegessen“ und „Ziel inkl. Training“. Die Ursache von
   „lädt neu“ wird im Browser bestätigt, bevor sie behoben wird.
7. **Pinch-Zoom aus**, bewusst in Kauf genommen: Kleine Schrift lässt sich nicht mehr vergrößern. Alle Eingabefelder
   haben 16 px Schrift; das gilt auch für die neuen kompakten Felder.
8. **Zutaten beim Eintragen:** Ein angefangenes Wischen klappt nicht auf.
   (`SwipeToDelete` schluckt den Klick nach horizontaler Bewegung bereits, `SwipeToDelete.tsx:339, 364-369`.)
9. **Barcode-Scan im Editor:** Er nutzt den vorhandenen `BarcodeScanner` mit `validGtin`
   (`components/BarcodeScanner.tsx:24, 91`). Ohne Kamerazugriff kommt dieselbe Meldung wie heute; Eintippen geht immer.

### Nachtrag: Etikett per KI ausfüllen (User, 2026-10-08)

Ein eigenes Lebensmittel lässt sich per Foto vom Etikett ausfüllen. Claude liest Barcode, Name, Marke, Einheit, die 10
Nährwerte und, falls aufgedruckt, die Portionsgröße. Entscheidungen:

- **Einstieg:**
  - im Lebensmittel-Editor (neu und bearbeiten)
  - auf der Scan-Seite bei „Produkt … unbekannt“; dort öffnet der Weg den Editor mit dem Barcode und startet sofort
    die Etikett-Kamera
- **Fotos:** 1 bis 3 in **einem** Claude-Aufruf (Barcode, Name und Tabelle stehen oft auf verschiedenen Seiten).
- **Übernahme:** füllt das Formular und überschreibt dabei vorhandene Eingaben, kurz hervorgehoben. Gespeichert wird
  erst mit „Anlegen“/„Speichern“.
- **Mockup zuerst:** Abschnitt I im Mockup (v4, siehe „Schritt 0“), danach wird dieser Plan final.

## 0. Schritt 0: Mockup v4, Abschnitt I (vor jeder Implementierung)

Opus ergänzt `docs/plans/2026-10-feedback-runde-5-mockup.html`:

- Version im `h1` auf v4 hochzählen, „Neu gegenüber v3“ pflegen.
- Neuer Abschnitt **„I. Etikett per KI“**, gleiche Phone-Optik.
- Kasten „Entschieden“ um die Punkte aus Context und Nachtrag ergänzen: EU-Formel, Barcode-Duplikat-Hinweis, Etikett.
- E1 zeigt „Omas Apfelkuchen“ mit 289 kcal (EU-Formel), Notiz „4 × 4 + 38 × 4 + 13 × 9 + 1,8 × 2 = 289“.
- E2 zeigt den Duplikat-Hinweis als zweiten Zustand des Barcode-Felds (E5b).

Bildschirme in Abschnitt I:

- **I1 Lebensmittel-Editor „Eigenes Lebensmittel“ (neu, leer):**
  - Ganz oben über der Section Name eine Outline-Kachel „Etikett fotografieren“ (lucide `scan-text`).
  - Untertitel grau „Name, Barcode und Nährwerte per KI ausfüllen“.
  - Beim Bearbeiten derselbe Button kleiner („Vom Etikett neu ausfüllen“).
  - Offline: deaktiviert mit „Nur online“; KI abgeschaltet: Button fehlt.
- **I2 Kamera „Etikett fotografieren“ (Vollbild über dem Editor):**
  - Header „Etikett fotografieren“ + X; Live-Kamera (Rahmen `photo`).
  - Unten Auslöser, links Mediathek, darüber ein Streifen mit bis zu 3 Vorschaubildern (je mit X); hier 2 Fotos.
  - Chip „Barcode 4006040123456 erkannt“, sobald der Live-Scanner einen gültigen Code gesehen hat.
  - Hinweis grau „Nährwerttabelle, Name und Barcode, bis zu 3 Fotos“.
  - Primärer Button „Analysieren (2 Fotos)“; beim 3. Foto ist der Auslöser aus.
- **I3 Analyse läuft:** Vorschaubilder mit dem bekannten Analyse-Overlay, Button gesperrt, X bricht ab (die Anfrage
  läuft im Hintergrund zu Ende, das Ergebnis wird verworfen).
- **I4 Zurück im Editor, ausgefüllt** („Proteinriegel Schoko“):
  - Alle übernommenen Felder kurz hervorgehoben (gleiche Markierung wie Barcode E5).
  - Toast „Vom Etikett übernommen, bitte prüfen“.
  - Grauer Kasten mit der KI-Notiz, z. B. „Ballaststoffe nicht angegeben.“
  - kcal stehen als „eigene Eingabe“, weil sie vom Etikett kommen; passen sie zur Formel, steht „aus den Makros
    berechnet“.
  - Footer „Anlegen“.
- **I5 Etikett nur pro Portion:** Umschalter steht auf „pro Portion“, „Portionsgröße 45 g“ ausgefüllt, Hinweis wie E3.
- **I6 Scan-Seite „Produkt 4006040123456 unbekannt“:**
  - Primär „Etikett fotografieren“, daneben outline „Selbst anlegen“ (bisher „Produkt anlegen“), darunter Link
    „Weiter scannen“.
  - Ohne KI: wie heute.
- **I7 Fehler:** Toast „Das Etikett konnte nicht gelesen werden. Versuche ein schärferes Foto der Nährwerttabelle.“,
  die Kamera bleibt mit den Fotos offen.
- **Notiz:**
  - Ein Aufruf kostet etwa so viel wie eine Essen-Analyse.
  - Der Barcode wird zuerst lokal aus den Fotos gelesen, Claude nur als Rückfall, immer mit Prüfziffer.
  - Nährwerte werden nur abgelesen, nie geschätzt; Unleserliches bleibt leer.

Danach dem User zeigen und iterieren. Erst wenn er zufrieden ist, die Blöcke unten umsetzen (Abschnitt 9 an das
Mockup anpassen, falls es sich geändert hat).

## 1. Kleinkram: Plus-Menü, Blitz, Pinch-Zoom (Mockup B, H, Punkt 10)

- `components/AddSheet.tsx:74-91`: Reihenfolge Gewicht | Essen (primary) | Training, Kommentar Z. 70 anpassen.
- Blitz-Link (`Zap`, `aria-label` „Schnelleingabe“, `Link /quick-add` mit `{date, meal}`, **ohne** `replace`) aus
  `features/foods/AddFoodPage.tsx:188-192` entfernen. In `features/ai/PhotoPage.tsx:99-106` links neben die Lupe setzen
  (Kamera- und Vorschau-Zustand; der Review hat eigene `actions`).
- Pinch-Zoom:
  - `apps/web/index.html`: Viewport um `maximum-scale=1, user-scalable=no` ergänzen.
  - `src/index.css` `html`: `touch-action: pan-x pan-y`. Das schneidet sich mit `touch-pan-y`/`touch-none` der Kinder,
    entfernt nur Zoom und Doppeltipp-Zoom.
  - `src/main.tsx`: `gesturestart`/`gesturechange` mit `preventDefault` (`{ passive: false }`) für iOS WebKit.
  - Neue Felder dieser Runde nutzen `Input`/`NumberField` (16 px), keine eigenen kleineren Inputs.
- E2E: `diary-training.spec.ts:186-188` (Kachel-Reihenfolge), `food-search.spec.ts:48` (Blitz jetzt auf `/photo`).

## 2. Stift im Header und „Speichern führt zurück“ (Mockup A1 bis A4)

**Lebensmittel-Seite:** `features/foods/FoodLogPage.tsx:309-335`.

- Text-Link „Bearbeiten“ entfernen.
- `actions` bekommt bei `food.source === 'custom'` einen Stift-Link (`Pencil`, `aria-label` „Lebensmittel
  bearbeiten“) auf `/custom-food/$id` mit `search { from: 'food' }`; im Eintragsmodus links vom Trash.
- Mockup A2 sagt: Eine noch nicht übernommene Änderung an Menge/Mahlzeit bleibt beim Hin und Zurück erhalten. Die
  Seite wird beim Zurück neu gemountet, deshalb schreibt der Stift-Klick den Formularzustand (Portion, Menge, Datum,
  Mahlzeit) in `sessionStorage`. Schlüssel: `ft:foodlog:<pathname>`. `FoodLogForm` liest ihn einmal als `initial`
  und löscht ihn (Muster: Seite lädt, Formular bekommt `initial`).

**Meal eintragen:** `features/meals/MealLogView.tsx`.

- `actions` mit Stift-Link (`aria-label` „Meal bearbeiten“) auf `/meals/$mealId`, `search { from: 'log' }`.
- Text-Link Z. 101-107 entfernen. Der `getByRole('link', { name: 'Meal bearbeiten' })` in `meals-goals.spec.ts:296`
  greift weiter.
- `key={meal.updatedAt}` in `MealPage.tsx:28` sorgt dafür, dass nach dem Speichern die neuen Zutaten erscheinen.

**Router** `src/app/router.tsx`: Search-Validatoren von `/custom-food/$id` und `/meals/$mealId` um
`from?: 'food' | 'log'` erweitern (über `clean()`).

**Meal-Editor** `features/meals/MealEditor.tsx`:

- `save()` gibt `true` zurück, danach zurück: `router.history.canGoBack()` ? `router.history.back()` :
  `navigate({ to: '/meals' })`.
- Die Nachfrage darf nicht mehr greifen: In `save()` vor dem Zurück einen Ref `leaving.current = true` setzen,
  `shouldBlockFn` prüft ihn zuerst. Ein Ref im Callback ist für den React Compiler erlaubt.
- `remove()`: bei `from === 'log'` `router.history.go(-2)` (zur Seite vor „Meal eintragen“), sonst wie heute
  `/meals`. Fallback `/meals`, wenn `canGoBack()` false ist. Immer mit `leaving.current = true`.

**Lebensmittel-Editor** `features/foods/CustomFoodPage.tsx`:

- `back` ohne festes Ziel (`back="/custom-foods"` als Fallback lassen; `Page` geht zurück, wenn es Verlauf gibt;
  prüfen in `components/Page.tsx:37-41`).
- Speichern eines **bestehenden** Lebensmittels: Toast „Gespeichert“, dann zurück (Fallback `/custom-foods`).
- **Neu** mit `search.date`: wie heute `replace` auf `/food/$id`. **Neu** ohne `date`: zurück zur Liste.
- Löschen: bei `from === 'food'` `history.go(-2)`, sonst zurück bzw. `/custom-foods`.

**Tests:**

- E2E in `meals-goals.spec.ts`: Stift auf „Meal eintragen“ → Editor → Zutatmenge ändern → Speichern → URL ist wieder
  `/meals/<id>?date=…`, neue kcal im Footer, keine Nachfrage.
- E2E in `food-search.spec.ts`: eigenes Lebensmittel anlegen → Lebensmittel-Seite → Stift → kcal ändern → Speichern
  → zurück auf `/food/<id>`, neue Werte sichtbar.

## 3. Training: Suche in der Schnellauswahl (Mockup C)

`features/exercise/ExercisePage.tsx:147-203`:

- `useState` für die Suche. Ein `Input type="search"` mit Lupe (Markup wie `AddFoodPage.tsx:200-222`) oben in der
  Section; Platzhalter wie im Mockup C1.
- Filter mit `normalize` aus `@ft/shared` (`packages/shared/src/search.ts:26`): Treffer, wenn alle Tokens der Eingabe
  in `normalize([name, typeName, note].join(' '))` vorkommen. Bei `recent` gibt es kein `typeName`, dort `name` und
  `note`.
- Leere Teil-Liste samt Überschrift ausblenden. Sind beide leer: „Kein Training gefunden.“ (`text-sm
text-muted-foreground`, C3).
- Link „Verwalten“ und das dann ungenutzte `action`-Prop von `QuickList` (Z. 283-293) entfernen.
- E2E `diary-training.spec.ts:100-102` (Verwalten) auf Mehr → Gespeicherte Trainings umstellen; Suche „lauf“ testen.

## 4. Nährwerte je Zutat (Mockup D1 bis D3, G1)

**Neues Bauteil** `components/NutrientsDisclosure.tsx`:

- Props: `nutrients`, `targets`, `title` (Mengenlabel), `open`/`onOpenChange` optional.
- Inhalt: Trennlinie, `CollapsibleTrigger` „Nährwerte“ mit Chevron (Stil wie `Trigger` in
  `NutrientBreakdown.tsx:262-279`; den dafür exportieren statt kopieren). Darin `NutrientBreakdown` (Variante `item`).
- Mehrere dürfen offen sein.

**Meal-Editor** `features/meals/IngredientCard.tsx`:

- Unten `NutrientsDisclosure`.
- Titel: `entryAmountLabel(item)` (`features/diary/MealCard`), z. B. „100 g“ bzw. „1 Stück (10 g)“.
- `nutrients`: `item.nutrients`, folgt dem Slider live.
- Neues Prop `targets`, kommt aus `MealEditor`: `targetsForDate(goals ?? [], today())`.

**Meal eintragen** `MealLogView.tsx:82-100`:

- Zeileninhalt wird ein `<button aria-expanded>` mit Chevron rechts neben den kcal. State `openIndex`: es ist immer nur
  eine Zeile offen.
- Die Übersicht liegt **in** den `SwipeToDelete`-Kindern (`px-4 pb-3`), damit sie mit der Zeile wegwischt.
- Weglassen einer offenen Zeile setzt `openIndex` zurück.

**Analyse-Review** `PhotoPage.tsx` (Zutatenkarte ab Z. 643):

- `NutrientsDisclosure` unten in jeder Karte.
- `nutrients = scaleNutrients(food.nutrients, r.grams)` (`packages/shared/src/nutrition.ts:10`), Titel `fmtGrams(r.grams)`.
- Ohne gewähltes Lebensmittel oder ohne Gramm: kein Trigger.

**Tests:** `components.test.tsx`: Disclosure ist zu, Klick zeigt die Makro-Meter. E2E: Zeile in „Meal eintragen“
aufklappen, danach Wischen lässt sie weg.

## 5. Eigenes Lebensmittel mit ausfüllbarer Übersicht (Mockup E0 bis E5)

### 5a. Rechnen (shared, mit Tests)

`packages/shared/src/nutrients.ts`:

- `KCAL_PER_G` um `fiber: 2` ergänzen.
- `kcalFromMacrosEu(map)` = 4 × Protein + 4 × Kohlenhydrate + 9 × Fett + 2 × Ballaststoffe.
- `isAutoKcal(map)` = `|kcal − kcalFromMacrosEu(map)| ≤ 0,5` und mindestens ein Makro > 0.
- `energyBreakdown` nicht anfassen (bleibt 4/4/9).
- `kjFromKcal`/`kcalFromKj` und `saltFromSodiumMg`/`sodiumMgFromSalt` gibt es schon (Z. 70-86).
- Tests in `packages/shared/test/nutrition.test.ts`: Formel, Toleranz, Apfelkuchen = 289.

### 5b. Formularlogik als Modul

Neues Modul `features/foods/customFoodForm.ts` (reine Funktionen, testbar).

**State:**

```ts
{
  values: Record<Code10, number | null>;
  kcalAuto: boolean;
  kjAuto: boolean;
  sodiumAuto: boolean;
}
```

Codes: kcal, kj, protein, carbs, sugar, fat, satFat, fiber, salt, sodium.

**Funktionen:**

- `initFromFood(food | null)`:
  - Ohne Lebensmittel: `kcalAuto = true`.
  - Mit Lebensmittel: `kcalAuto = isAutoKcal`.
  - `kjAuto`/`sodiumAuto` sind `true`, wenn der gespeicherte Wert zur Ableitung passt.
- `setField(state, code, v)` mit den Kopplungen:
  - **Makro oder Ballaststoffe** bei `kcalAuto` → kcal neu.
  - **kcal getippt** → `kcalAuto = false`; ein leeres Feld setzt `kcalAuto = true`.
  - **kJ getippt** → kcal = kcalFromKj, `kcalAuto = false`.
  - **kcal geändert** und `kjAuto` → kJ neu.
  - **Salz ↔ Natrium:** Salz geändert und `sodiumAuto` → Natrium neu; Natrium getippt → Salz neu.
- `resetKcal(state)` für „aus Makros berechnen“.
- `toNutrients(state, factor)` liefert alle gesetzten Werte × Faktor, gerundet wie heute auf 3 Stellen.
- Validierung:
  - kcal fehlt und kein Makro gesetzt → „Kalorien oder Makros angeben.“ (E2).
  - Name und Barcode wie heute.

**Tests:** `apps/web/test/foods.test.ts`.

### 5c. Bauteil und Seite

**Neues Bauteil** `components/NutrientEditor.tsx`, gleicher Aufbau und gleiche Abstände wie `NutrientBreakdown`:

- **Kopf:** „Kalorien“ links; rechts großes `NumberField` (rechtsbündig, Schrift wie die kcal-Zahl, mindestens 16 px,
  Einheit kcal). Darunter grau „aus den Makros berechnet“ bzw. „eigene Eingabe · aus Makros berechnen“ (Button).
- **Leiste:** `EnergySplitBar` (schon exportiert) aus `energyBreakdown(values)`.
- **Makrozeilen:** Layout von `NutrientBreakdown.tsx:122-178`, statt der fetten Zahl ein kompaktes `NumberField`
  (g), daneben „· 23 % · 16 kcal“, darunter der Anteil-Balken.
- **„Weitere Nährstoffe“:** Collapsible. Beim Bearbeiten offen, bei Neu zu. Die 4 Felder mit „von mind./max. …“ und
  Balken (Zielwerte über `targets.micros`). Die Zeilenoptik aus `MicroRow` wiederverwenden, nach Bedarf mit
  `children`-Slot für das Feld erweitern, nicht kopieren.
- **„Alle 10 Nährstoffe“:** darin, kompakte Liste, alle 10 als `NumberField`, an denselben State gebunden. kJ und
  Natrium mit grauem Hinweis „wird aus kcal berechnet“ bzw. „wird aus Salz berechnet“, solange auto.
- **Verbindung zur Seite:** `onChange(code, v)`, `onResetKcal`; den State hält die Seite.

**Seite** `CustomFoodPage.tsx`:

- Raster `FIELDS` (Z. 16-25, 241-253) durch `NutrientEditor` ersetzen.
- Toggle „pro 100 g / pro Portion“ und „Portionsgröße“ mit Hinweis „Wird beim Speichern auf 100 g umgerechnet.“ (E3)
  bleiben darüber.
- `completeNutrients` beim Speichern ersetzen durch `toNutrients` (alle 10 Werte).
- **Speichern** als `Page footer`: `<Button size="lg" type="submit" form="custom-food">`, Form bekommt die `id`.
  Labels wie heute: „Speichern“ / „Anlegen“ / „Anlegen und eintragen“. Der Button am Formularende entfällt.

### 5d. Barcode im Editor (E1, E4, E5)

**Barcode-Feld:**

- Bekommt rechts im Feld einen Icon-Button (`ScanBarcode`, `aria-label` „Barcode scannen“).
- Er öffnet ein Vollbild-Overlay über dem Editor: neues `components/BarcodeScanSheet.tsx`, `fixed inset-0`,
  Header „Barcode scannen“ + X, darin `<BarcodeScanner frame="barcode">`, Status „Halte den Barcode in den Rahmen.“.

**Bei Erkennung:**

- Barcode setzen, Overlay schließen, Toast „Barcode übernommen“.
- Feld kurz hervorheben (CSS-Klasse für 1,2 s, `motion-reduce` beachten).

**Fehler:**

- Texte aus `CAM_ERRORS` (`PhotoPage.tsx:250`) als Export nach `components/BarcodeScanner.tsx` verschieben und dort und
  in PhotoPage nutzen.
- Bei Fehler: Text im Overlay plus Schließen.

**Duplikat:**

- `useLiveQuery` auf `db.customFoods.where('barcode').equals(clean)`, nicht gelöscht, `id !== existing?.id` →
  grauer Hinweis unter dem Feld.

### 5e. Tests

- Unit-Tests für 5a und 5b.
- `components.test.tsx`: `NutrientEditor` rechnet die Leiste bzw. Prozente live; kJ folgt kcal.
- E2E `food-search.spec.ts`: Lebensmittel anlegen nur mit Makros → kcal automatisch → Speichern → Lebensmittel-Seite
  zeigt die kcal.

## 6. Berichte: Makro-Stapel und kein Neuladen (Mockup F, Punkt 8)

**Erst die Ursache bestätigen:**

- Mit Playwright gegen `pnpm dev`: `/reports` scrollen, Metrik/Zeitraum wechseln, beobachten.
- Erwartet: Der Scroll springt nach oben, weil `createRouter` `scrollRestoration: true` hat und `navigate` per Default
  `resetScroll` macht. Dazu wird das Diagramm komplett neu gebaut (`Chart.tsx:144-153` zerstört uPlot bei jeder
  Datenänderung). Eventuell flackert auch `rows === null`, wenn `useLiveQuery` beim Wechsel kurz `undefined` liefert.
- Befund im Commit-Text nennen.

**Fix:**

- `set()` in `ReportsPage.tsx:123` mit `resetScroll: false`.
- `Chart.tsx`: Plot nur neu bauen, wenn sich Serien-Struktur, Höhe, Theme oder Bereich ändern; bei reinen
  Datenänderungen `plot.setData(data)`. Dazu `series` in `ReportsPage` memoisieren.
- Falls nötig, die letzten `data` halten, bis neue da sind.

**Stapel:**

- `ChartSeries` um `legend?: false` (keine Legendenzeile, nicht in der SR-Tabelle, kein Cursor-Punkt) und
  `kind: 'bars'` mit gemeinsamer Basis erweitern.
- uPlot stapelt nicht, deshalb aufsummierte Serien. Gezeichnet werden alle Balken ab 0 in absteigender Höhe, damit der
  niedrigere über dem höheren liegt:
  - Gesamt in `--fat`
  - Protein + Kohlenhydrate in `--carbs`
  - Protein in `--protein`
  - plus `Ohne Makros` in neuem Token `--bar-neutral` (Light/Dark in `index.css`, 40 % Schriftfarbe als feste oklch):
    nur an Tagen ohne Makros, dann ist die Makro-Summe 0.
- Segmentwerte je Tag: `kcal × share` aus `energyBreakdown(r.nutrients)`.
- Eine unsichtbare Serie „Gegessen“ (`paths: () => null`, neutrale Marke statt rot) trägt die Legende mit der echten
  kcal-Zahl; „Ziel inkl. Training“ bleibt.
- Die Legende darf durch Klick keine Segmente ausblenden (Legenden-Zeilen der Segmente gibt es ja nicht).
- Für die Farben vorher den `dataviz`-Skill lesen; die Makrofarben sind bereits geprüft.

**Tests:** `buildChart('kcal')` als reine Funktion exportieren und in `apps/web/test/lib.test.ts` prüfen: Summe der
Segmente = kcal, Tag ohne Makros nur neutral.

## 7. Analyse-Review: Hinweis und Neu analysieren (Mockup G1 bis G4)

**`features/ai/queue.ts`:**

- Neue Funktion `reanalyze(db, localId, text)`:
  - Wenn Status `pending` oder `analyzing`: nichts tun.
  - Sonst `update { text, status: 'pending', error: undefined }`, dann `processQueue(db)`.
  - Bei Erfolg (Z. 88-95) schreibt `processQueue` zusätzlich `draft`: `undefined`, bzw.
    `{ ...draftFromResult(neu), savedMealId }`, wenn der alte Draft eines hatte.
  - Bei Fehlern bleiben das alte `result` und der alte `draft` stehen.
- Der `running`-Guard (Z. 65) verhindert parallele Läufe. Ein Doppeltipp ist zusätzlich durch den gesperrten Button
  abgefangen.

**`PhotoPage.tsx`:**

- Der Review rendert, solange `item.result` existiert. Heute nur bei `status === 'done'` (Z. 81-84), sonst fällt die
  Seite auf die Kamera zurück.
- `key` = `${localId}:${status === 'done' ? 'done' : 'busy'}`, damit nach dem neuen Ergebnis der Draft frisch geladen
  wird.

**`ResultEditor`, solange `busy`:**

- `AnalyzingOverlay` (Z. 403-421) über dem Foto.
- Hinweis, Zutaten, Footer und Speichern `disabled`/ausgegraut (G3). ↻ gesperrt. X bleibt (Analyse läuft weiter).
- Bei `pending` (offline) Toast wie in der Vorschau.

**Hinweisfeld unter der KI-Notiz** (G1), auch bei „Kein Essen erkannt“ (G2), dort unter dem `EmptyState`:

- Label „Hinweis für die Analyse (optional)“, Wert `item.text`.
- Schreiben mit `db.aiQueue.update` bei Änderung (State lokal, wie `commit`).
- Hilfetext „Ändern und oben auf ↻ tippen, um neu zu analysieren.“
- Das bestehende E2E-Label in `meals-goals.spec.ts:372` gilt für die Vorschau, die das Feld behält.

**Header:** ↻ (`RotateCcw`, `aria-label` „Neu analysieren“) links vom Speichern-Icon.

**Nachfrage G4:**

- Wann: `draftChanged(item)` (neu in `db/aiDraft.ts`) vergleicht die Zeilen von `item.draft` mit
  `draftFromResult(item)` (Schlüssel, Gramm, `foodId`, Anzahl). Mahlzeit und Name zählen nicht.
- Dialog: „Neu analysieren?“ / „Deine Änderungen an den Zutaten gehen verloren.“ / „Abbrechen“ / „Neu analysieren“
  (`Dialog` mit `DialogBody` wie die anderen Dialoge).

**Tests:**

- Unit für `draftChanged` und `reanalyze` mit gemocktem `analyzePhoto` (`meals-photos.test.ts`): Status-Folge,
  `savedMealId` bleibt, Doppelaufruf löst nur einen Call aus.
- E2E (API-Mock wie im bestehenden Foto-Spec): Review → Hinweis ändern → ↻ → neues Ergebnis.

## 9. Etikett per KI (Mockup I1 bis I7)

Vor dem API-Teil den `claude-api`-Skill laden (Regel in `CLAUDE.md`).

### 9a. API

**`apps/api/src/ai/label.ts`:**

- `labelSchema` (Zod):
  - `name`, `brand`: `string | null`
  - `barcode`: `string | null`, nur die Ziffern
  - `unit`: `'g' | 'ml'`
  - `basis`: `'per100' | 'perPortion'`
  - `servingGrams`: `number | null`; `servingLabel`: `string | null`
  - `nutrients`: Objekt mit den 10 Feldern, je `number | null`
  - `notes`: `string | null`
- System-Prompt (deutsch/englisch wie `prompt.ts`): Werte nur abschreiben, nichts schätzen. Die Spalte pro 100 g/ml
  bevorzugen, sonst pro Portion mit `servingGrams`. Unleserliches `null`, Hinweis in `notes`.
- `FoodAnalyzer` in `ai/analyze.ts` um `readLabel({ images: {base64, mediaType}[], text })` erweitern. Gleicher Aufruf
  wie `analyze` (`client.beta.messages.parse`, `betaZodOutputFormat`, `fallbacks: 'default'`, Modell/Effort aus
  `env`), mit mehreren Bildblöcken.

**Route `POST /api/ai/label`** in `routes/ai.ts`:

- Wie `/analyze`: `bodyLimit` auf 3 × 5 MB + Rand, Medientypen-Prüfung, 1 bis 3 Dateien `image`, gemeinsamer
  `limiter`, gleiche Fehlerabbildung.
- `barcode` serverseitig mit einer GTIN-Prüfung validieren. `validGtin` liegt heute in
  `apps/web/src/components/BarcodeScanner.tsx:24`; nach `packages/shared` verschieben und im Web re-exportieren bzw.
  importieren. Ungültig → `null`.
- Protokoll in `aiAnalyses` wie gehabt, `result: { kind: 'label', … }` (jsonb, keine Migration).

**Tests** in `apps/api/test/ai.test.ts` mit dem vorhandenen Fake-Analyzer aus `test/helpers.ts` (um `readLabel`
erweitern): Erfolg, 3 Bilder, 4 Bilder → 400, ungültiger Barcode → `null`, KI aus → 503.

### 9b. Web

**`lib/api.ts`:** `readLabel(files, signal)`, Multipart wie die Foto-Analyse (`features/ai/queue.ts:13`).
Bilder vorher mit `compressImage` (`features/ai/image.ts`) verkleinern.

**`components/LabelCaptureSheet.tsx`** (Vollbild-Overlay wie `BarcodeScanSheet` aus 5d):

- Kamera über `BarcodeScanner` mit `frame="photo"` und `captureRef` (Muster `CameraCapture` in `PhotoPage.tsx:266-396`).
  `onDetected` merkt sich einen gültigen Code für den Chip, navigiert aber nicht weg.
- Mediathek per `input type=file accept=image/* multiple`, höchstens 3 Fotos.
- Für jedes Foto zusätzlich `detectBarcodeInImage` (`BarcodeScanner.tsx:37`).
- Vorschaubilder über `useObjectUrl(blob, key)`, nie `useMemo(URL.createObjectURL)`.
- „Analysieren (n Fotos)“ ruft `readLabel` auf, mit `AnalyzingOverlay`. Den Overlay aus `PhotoPage.tsx:403` exportieren,
  nicht kopieren.
- `AbortController` für X; Fehlertexte wie I7 (offline, refused, no_result, too_many_requests).
- Ergebnis per `onResult(label, localBarcode)`. Es wird nichts gespeichert, die Fotos bleiben nur im Speicher.

**`customFoodForm.ts` (5b):** `applyLabel(state, label, localBarcode)`:

- Überschreibt Name, Marke, Einheit, alle 10 Werte, Barcode (lokal > KI) und bei `perPortion` auch Modus und
  `servingGrams`.
- Danach `kcalAuto = isAutoKcal(werte)`. `kjAuto`/`sodiumAuto` nach Abgleich mit der Ableitung.
- Liefert die Liste der geänderten Felder für die Hervorhebung.

**`CustomFoodPage.tsx`:**

- Kachel bzw. Button laut I1. Sichtbar nur, wenn `api.aiStatus().enabled` (Hook wie bei der Essen-Seite), deaktiviert
  offline (`useOnline` o. ä., vorhandenen Hook suchen).
- Search-Param `label?: '1'` öffnet das Sheet beim Mounten einmal und wird per `navigate({ replace: true })` entfernt.
  Das Öffnen läuft im Event-Pfad bzw. über `useState(() => …)`, kein `setState` im Effect.
- Die KI-Notiz als grauer Kasten über der Section „Nährwerte“, bis gespeichert wird.

**`features/foods/ScanPage.tsx:94-118`:** im Zustand `notfound` primär „Etikett fotografieren“
(→ `/custom-food/new?barcode=…&label=1&date…`), outline „Selbst anlegen“, Link „Weiter scannen“. Ohne KI wie heute.

**Router:** Validator von `/custom-food/$id` um `label` ergänzen.

**Tests:**

- Unit für `applyLabel`: per 100 und pro Portion, lokaler Barcode gewinnt, kcal-Modus.
- E2E mit gemocktem `/api/ai/label` (Muster des bestehenden Foto-Specs): Editor → Etikett → Formular gefüllt →
  Anlegen.

### 9c. Regel in `CLAUDE.md`

Die Zeile „Nutrients never come from the model“ präzisieren: Bei der Essen-Analyse kommen die Nährwerte nie vom Modell.
Beim Etikett schreibt das Modell die aufgedruckten Werte nur ab, und der User prüft sie vor dem Speichern.

## 8. Doku

- `CLAUDE.md`:
  - Etikett per KI (`/api/ai/label`, `LabelCaptureSheet`, Regel aus 9c).
  - Stift im Header für eigene Lebensmittel/Meals, `from`-Param, „Speichern führt zurück“.
  - `NutrientEditor`/`customFoodForm` und die Kalorien-Automatik (EU-Formel, kein Flag).
  - `NutrientsDisclosure`.
  - Gestapelte Balken in `Chart.tsx` (`legend: false`).
  - Kein Pinch-Zoom (16 px-Regel für Felder).
  - Review mit ↻ und Hinweis.
  - Plus-Menü-Reihenfolge.
- `docs/` nur, wo betroffen (z. B. Nutzerdoku zur Analyse, falls vorhanden).

## Reihenfolge und Commits

| Block | Inhalt                                         | E2E danach |
| ----- | ---------------------------------------------- | ---------- |
| 1     | Kleinkram (Abschnitt 1) + Plan-/Mockup-Dateien | ja         |
| 2     | Stift und Zurück (2)                           | ja         |
| 3     | Training-Suche (3)                             |            |
| 4     | Nährwerte je Zutat (4)                         | ja         |
| 5     | Eigenes Lebensmittel (5a bis 5e)               | ja         |
| 6     | Berichte (6)                                   |            |
| 7     | Analyse-Review (7)                             | ja         |
| 8     | Etikett per KI (9a bis 9c)                     | ja         |
| 9     | Doku (8)                                       |            |

Schritt 0 (Mockup v4) kommt vor Block 1 und wird nicht committet, bis der User zufrieden ist. Danach gehen Mockup und
Pläne mit Block 1 ins Repo.

Commit je Block: `Round 5 block N: <kurz>` (englisch, mit der vereinbarten Co-Authored-By-Zeile).

## Ablauf für Opus 5.5

1. **Zuerst lesen:**
   - diesen Plan ganz
   - `CLAUDE.md`
   - den Textteil von `docs/plans/2026-10-feedback-runde-5-mockup.html`; die Kürzel A1, E3, G4 usw. sind die Referenz
     für Optik und Wortlaut. Bei Widerspruch gilt das Mockup für Optik und Text, der Plan für Code-Struktur und die
     Entscheidungen oben (z. B. EU-Formel statt 4/4/9).
   - vor Block 5 und 7 `.claude/skills/offline-sync/SKILL.md` (es ändert sich zwar kein Schema, aber
     `customFoods`-Schreibwege und `aiQueue`)
   - vor Block 6 den `dataviz`-Skill
   - vor Block 8 den `claude-api`-Skill
   - **Mit Schritt 0 beginnen** (Mockup v4, Abschnitt I) und auf das OK des Users warten, bevor Block 1 startet.
2. **Je Block:** umsetzen, dann `pnpm lint && pnpm typecheck && pnpm test` (sequentiell), Commit. `pnpm e2e` nach den
   markierten Blöcken. Ein fehlschlagendes Spec im selben Block fixen.
3. **Gegen das Mockup prüfen:** nach jedem Block mit Playwright-MCP gegen `pnpm dev` (390×844, Light und Dark); Login
   über den eigenen Proxy laut Memory „Dev-Proxy-Login“. Abweichungen, die der Plan nicht abdeckt, als Liste melden statt
   still zu entscheiden.
4. **Grenzen:** Keine Refactors nebenbei, keine neuen Abhängigkeiten ohne Rückfrage. UI-Texte deutsch ohne
   Gedankenstriche; Code, Kommentare und Commits englisch.
5. **Am Ende:** Commit-Liste; was nur am iPhone prüfbar ist (Pinch-Zoom, Maßband, Diagramm antippen, Ziehen und
   Wischen im Tagebuch, Barcode-Scan im Editor, Kameraablehnung); offene Punkte.

## Verifikation

- `pnpm lint && pnpm typecheck && pnpm test` nach jedem Block; `pnpm e2e` (chromium-iphone) nach den Blöcken 1, 2, 4,
  5, 7. Angepasste Specs: `diary-training`, `food-search`, `meals-goals`.
- Playwright-MCP manuell:
  - Plus-Menü-Reihenfolge, Blitz auf `/photo`
  - Stift → Editor → Speichern → zurück (Meal und Lebensmittel, aus Suche und aus Mehr)
  - Löschen aus dem Editor landet nicht auf einer toten Seite
  - Training-Suche „lauf“
  - Nährwerte je Zutat (Editor, Eintragen mit Wischen, Review)
  - Lebensmittel-Editor: nur Makros → kcal automatisch; kcal tippen → eigene Eingabe; „aus Makros berechnen“;
    kJ ↔ kcal und Natrium ↔ Salz; pro Portion; Duplikat-Barcode-Hinweis; Footer bleibt beim Scrollen stehen
  - Berichte: Wechsel ohne Sprung und Flackern, gestapelte Balken, Legende nur zwei Einträge
  - Review: Hinweis ändern, ↻ gesperrt während der Analyse, G4 nach Gramm-Änderung, „Kein Essen erkannt“ mit Feld
  - Etikett: 2 Fotos aus der Mediathek → Formular gefüllt und hervorgehoben → Anlegen; Scan-Seite „unbekannt“ →
    Etikett; Fehlerfall mit gemockter 502. Ein echter Claude-Aufruf nur einmal, mit `ANTHROPIC_API_KEY` aus der
    Projekt-`.env`, an einem echten Etikettfoto.
- iPhone (PWA über WireGuard):
  - kein Pinch- und kein Doppeltipp-Zoom
  - Maßband, Diagramm-Cursor, Drag-and-drop und Wischen im Tagebuch funktionieren
  - Barcode-Scan im Editor; abgelehnte Kamera zeigt die Meldung
  - Etikett mit Live-Kamera, Barcode-Chip, drei Fotos
