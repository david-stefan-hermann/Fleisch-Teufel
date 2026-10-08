# Feedback-Runde 5, Schritt 1: HTML-Mockups (überarbeitet, inkl. Nachtrag)

Nach Freigabe ersetzt dieser Plan `docs/plans/2026-10-feedback-runde-5-mockups.md` (gleicher Inhalt). Opus baut
daraus **eine** Mockup-Datei `docs/plans/2026-10-feedback-runde-5-mockup.html`; der User iteriert sie, danach
schreibe ich den Implementierungsplan. Kein App-Code, nichts committen.

## Context

Nach Runde 4 (Commits b966aa5..f0affa2) hat der User zwölf Rückmeldungen gegeben (sieben im ersten, fünf im zweiten
Durchgang). Er will vor der Umsetzung wieder ein Testmockup sehen, auch um offene Fragen (Analyse-Review mit
Nährwertübersicht) daran zu entscheiden.

| #   | Feedback (sinngemäß)                                                                                                       | Mockup       |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 1   | Eigenes Meal / eigenes Lebensmittel aus der Suche bearbeiten: Stift-Icon rechts im Header                                  | A            |
| 2   | Speichern im Editor (Meal, eigenes Lebensmittel) schließt ihn, zurück zur vorherigen Seite                                 | A (Ablauf)   |
| 3   | Schnelleingabe (Blitz) aus dem Suchheader in den Header der Essen-Seite `/photo`, neben die Lupe                           | B            |
| 4   | Training, Schnellauswahl: Suchfeld dazu, Link „Verwalten“ weg                                                              | C            |
| 5   | Zutaten gespeicherter Meals bekommen die einheitliche Nährwertübersicht                                                    | D            |
| 6   | Eigene Lebensmittel: einheitliche Nährwertübersicht mit ausfüllbaren Feldern, Speichern sticky                             | E            |
| 7   | Berichte, Kalorien: Balken nach Makros aufteilen, keine Legende dafür                                                      | F            |
| 8   | Berichte: Ändern von Dropdown/Zeitraum wirkt wie ein Neuladen der Seite                                                    | nein (Notiz) |
| 9   | Plus-Menü: „Gewicht eintragen“ und „Training eintragen“ tauschen                                                           | H            |
| 10  | Pinch-Zoom in der App abschalten                                                                                           | nein (Notiz) |
| 11  | Analyse-Review: „Wiederholen“ oben rechts, Hinweis an die KI bleibt sichtbar und editierbar, auch bei „Kein Essen erkannt“ | G            |
| 12  | (= 6) Speichern-Button im Lebensmittel-Editor sticky wie im Meal-Editor                                                    | E            |

### Geklärte Entscheidungen (2026-10-08)

- **Zutaten (5)**: im Meal-Editor **und** in der Eintragen-Ansicht (`MealLogView`), je Zutat zugeklappt, Tipp
  klappt auf. Für den **Analyse-Review** will der User per Mockup entscheiden: beide Varianten zeigen (D3/D4).
- **Eigenes Lebensmittel (6)**: Aufbau wie die gemeinsame Übersicht: Kalorien + 3 Makros, aufklappbar „Weitere
  Nährstoffe“ (Ballaststoffe, Zucker, Gesättigte Fettsäuren, Salz), darin aufklappbar „Alle 10 Nährstoffe“. Keine
  weiteren Vitamine/Mineralstoffe. **kJ und Natrium** werden automatisch aus kcal bzw. Salz errechnet, sind aber
  trotzdem editierbar (Eingabe dort rechnet kcal bzw. Salz zurück). Speichern als **Sticky-Footer**.
- **Berichte (7)**: Balkenhöhe = geloggte kcal, aufgeteilt nach der **prozentualen Makro-Energieaufteilung**
  (`energyBreakdown().macros[k].share`), **kein graues Reststück**. Legendenzeile wie heute („Gegessen“, „Ziel inkl.
  Training“), keine Makro-Einträge.
- **Training (4)**: ein Suchfeld filtert „Gespeichert“ und „Zuletzt“ (Name, Sportart, Notiz); Sportart-Suche
  bleibt. Verwalten nur noch über Mehr.
- **Speichern → zurück (2)**: immer, auch aus Mehr (dann zurück zur Liste).

## Ist-Zustand, den Opus kennen muss

- **Lebensmittel-Seite** `features/foods/FoodLogPage.tsx:285-335`: Header rechts nur beim Bearbeiten eines Eintrags
  ein Trash; unter dem Header Name, Marke, Badge „Eigenes“ und Text-Link „✎ Bearbeiten“ auf `/custom-food/$id`.
- **Meal eintragen** `features/meals/MealLogView.tsx`: kein Header-Icon; Section „Zutaten“ (Zeilen Name, Menge, kcal,
  Swipe = nur für diesen Eintrag weglassen) mit Text-Link „Meal bearbeiten“; Sections „Nährwerte“, „Eintragen“;
  Footer „620 kcal eintragen“.
- **Meal-Editor** `features/meals/MealEditor.tsx` mit `IngredientCard` (`features/meals/IngredientCard.tsx`: Name,
  kcal, Trash; Slider + `NumberField`); Footer „Speichern“, bleibt heute nach dem Speichern auf der Seite.
- **Eigenes Lebensmittel** `features/foods/CustomFoodPage.tsx`: `back="/custom-foods"` fest; Section „Nährwerte“
  = Toggle pro 100 g / pro Portion + 2-Spalten-Raster aus 8 `NumberField`s; Button „Speichern“ am Formularende
  (nicht sticky).
- **Gemeinsame Übersicht** `components/NutrientBreakdown.tsx` (Variante `item`): Kopf mit großer kcal-Zahl,
  `EnergySplitBar`, drei Makrozeilen („12 g · 23 % · 48 kcal“ + Balken), Collapsible „Weitere Nährstoffe“ (4 Werte
  mit „von mind./max. …“ + Balken), darin „Alle N Nährstoffe“ (bei eigenen Lebensmitteln 10: die 8 plus kJ und
  Natrium aus `completeNutrients`, `packages/shared/src/nutrients.ts:92`).
- **Essen-Seite** `features/ai/PhotoPage.tsx:85-110`: rechts nur die Lupe. **Suche** `AddFoodPage.tsx:182-196`:
  Kamera + Blitz „Schnelleingabe“.
- **Vorschau vor der Analyse** `PhotoPage.tsx:208-248`: Foto mit „Neu aufnehmen“, darunter Feld „Hinweis für die
  Analyse (optional)“ (Platzhalter „z. B. „mit Butter gebraten“, …“), Hilfetext, Footer „Analysieren“.
- **Analyse-Review** `PhotoPage.tsx:590-700`: Titel „Ergebnis prüfen“, rechts Save-Icon bzw. Chip „✓ Gespeichert“
  und X; Foto 4:3; KI-Notiz (`result.notes`, grauer Kasten); bei 0 Zeilen `EmptyState` „Kein Essen erkannt“; je
  Zutat eine Section (Name, Badge „KI: sicher“, kcal, Trash, Kandidaten-Select, Gramm-Slider + Feld). Der
  ursprüngliche Hinweis steht heute nur in der Warteschlangen-Zeile (`item.text`), im Review nicht.
- **Plus-Menü** `components/AddSheet.tsx:72-92`: drei quadratische Kacheln: Training (links) | Essen (Mitte,
  primary) | Gewicht (rechts).
- **Training** `features/exercise/ExercisePage.tsx:147-200`; **Berichte** `features/reports/ReportsPage.tsx`
  (`buildChart('kcal')` Z. 257-280, Balken `--primary`; Metrik-Select Z. 217 und Zeitraum-Toggle Z. 133 navigieren
  per `set()` mit `replace`).
- **Vorlage**: `docs/plans/2026-10-feedback-runde-4-mockup.html` (Tokens Light/Dark inkl. `--over-2`, `.phone`
  390 px, Header mit Icons, Breakdown-Markup, Notizen). Aufbau und Klassen übernehmen.

## Deliverable

`docs/plans/2026-10-feedback-runde-5-mockup.html`, statisch, ohne externe Ressourcen, Inline-JS nur für D, E, G.
Deutsch, keine Gedankenstriche, Zahlen deutsch. `h1` „Feedback-Runde 5, Mockups v1“; Kopfnotiz mit Beispielwerten
(Tagesziel 1.700 kcal, Protein 130 g, KH 170 g, Fett 55 g; Meal „Spaghetti Bolognese“ 620 kcal: Spaghetti 125 g,
Hackfleisch 100 g, Tomatensoße 150 g, Parmesan 1 Stück (10 g); eigenes Lebensmittel „Omas Apfelkuchen“ pro 100 g:
285 kcal, Protein 4 g, KH 38 g, davon Zucker 22 g, Fett 13 g, davon gesättigte 6 g, Ballaststoffe 1,8 g, Salz 0,2 g)
und einer Liste der Punkte ohne Mockup (8, 10, siehe unten). Bei jeder Iteration Version hochzählen und
„Neu gegenüber vX“ pflegen.

### A. Stift im Header, Speichern führt zurück (1, 2)

- **A1 Lebensmittel-Seite, eigenes Lebensmittel** („Omas Apfelkuchen“, Titel „Eintragen“): rechts Stift (lucide
  `pencil`, 24 px, `foreground`, `aria-label` „Lebensmittel bearbeiten“); kein Text-Link mehr unter dem Namen.
  Footer „Zu Frühstück eintragen“.
- **A2 „Eintrag bearbeiten“**: rechts Stift, daneben Trash (rot). Notiz: Stift bearbeitet das Lebensmittel, nicht
  den Eintrag.
- **A3 Meal eintragen**: Stift rechts (`aria-label` „Meal bearbeiten“), Link „Meal bearbeiten“ in „Zutaten“ entfällt.
- **A4 Ablaufketten** (beschriftete Kästchen mit Pfeilen): „Suche, Eigene → Meal eintragen → ✎ → Meal-Editor →
  Speichern → zurück zu Meal eintragen, Toast „„Spaghetti Bolognese“ gespeichert““; „Suche → Lebensmittel-Seite →
  ✎ → Lebensmittel bearbeiten → Speichern → zurück zur Lebensmittel-Seite, Toast „Gespeichert““; „Mehr → Gespeicherte
  Meals / Eigene Lebensmittel → Editor → Speichern → zurück zur Liste“.
- Notiz: Zurück-Pfeil des Lebensmittel-Editors geht zur vorherigen Seite; „Anlegen und eintragen“ (neu aus der
  Suche) bleibt wie heute.

### B. Schnelleingabe auf die Essen-Seite (3)

- **B1 `/photo`** (Kamera): Header „‹ Essen eintragen Frühstück“, rechts **Blitz** (`zap`, „Schnelleingabe“) und
  **Lupe**. **B2 `/add`**: rechts nur noch die Kamera.
- Notiz: Blitz öffnet `/quick-add` als neue Seite; Lupe/Kamera ersetzen sich wie heute; im Vorschau-Zustand
  bleibt der Header gleich.

### C. Training: Suche in der Schnellauswahl (4)

- **C1** Section „Schnellauswahl“: oben Suchfeld (Lupe links wie `/add`, Platzhalter „Gespeicherte und letzte
  Trainings suchen…“), „Gespeichert“ ohne „Verwalten“ (Beine, Laufrunde, Yoga am Abend), „Zuletzt“ (3 Zeilen),
  Section „Sportart“ angeschnitten.
- **C2** „lauf“: Gespeichert „Laufrunde“, Zuletzt „Laufen“ (gestern); leere Teil-Liste samt Überschrift weg.
- **C3** kein Treffer: „Kein Training gefunden.“ (`muted-foreground`).

### D. Zutaten mit Nährwertübersicht (5), interaktiv

- **D1 Meal-Editor**: zwei `IngredientCard`s; unten in jeder Karte Trennlinie + Trigger „Nährwerte“ mit Chevron
  (Stil wie „Weitere Nährstoffe“). Zweite Karte offen: gemeinsame Übersicht (Variante `item`) für diese Zutat in
  ihrer Menge, Titel = Menge („100 g“, „1 Stück (10 g)“).
- **D2 Meal eintragen**: Zutatenzeilen mit kleinem Chevron rechts neben kcal; Tipp klappt die Übersicht unter der
  Zeile auf (eine offen). Notiz: Swipe zum Weglassen bleibt.
- **D3 Analyse-Review mit Übersicht** und **D4 Analyse-Review wie heute**, nebeneinander, jeweils eine Zutatenkarte
  („Hähnchenbrust, gebraten“, Badge „KI: sicher“, Kandidaten-Select, Slider 150 g); in D3 unten derselbe Trigger
  „Nährwerte“, aufgeklappt. Notiz: „Entscheide hier, ob der Review die Übersicht je Zutat auch bekommt.“
- Inline-JS: alle Trigger klappen auf/zu.

### E. Eigenes Lebensmittel mit ausfüllbarer Übersicht (6, 12), interaktiv

- **E1 „Lebensmittel bearbeiten“** („Omas Apfelkuchen“), Header Zurück + Trash. Section Name/Marke/Barcode/Einheit
  unverändert. Section „Nährwerte“:
  1. Toggle „pro 100 g“ / „pro Portion“.
  2. Kopf: links „Kalorien“, rechts **großes Eingabefeld** (Schrift wie die kcal-Zahl, rechtsbündig, „kcal“
     dahinter, ca. 7rem breit), Pflicht.
  3. `EnergySplitBar` live aus den Makrofeldern.
  4. Drei Makrozeilen: Punkt + Label links, rechts **Eingabefeld** (g) + grau „· 23 % · 16 kcal“, darunter
     Anteil-Balken; live.
  5. Collapsible „Weitere Nährstoffe“ (beim Bearbeiten offen, bei „Neu“ zu): Ballaststoffe, Zucker, Gesättigte
     Fettsäuren, Salz als Eingabefelder + grau „von mind./max. … pro Tag“ + Balken.
  6. Darin Collapsible „Alle 10 Nährstoffe“: **alle 10 als kompakte Eingabefelder** im Listen-Layout, an dieselben
     Werte gebunden wie oben (Änderung an einer Stelle zeigt sich an der anderen). **Energie (kJ)** und **Natrium
     (mg)** sind vorbefüllt aus kcal bzw. Salz (×4,184; Salz ÷ 2,5 × 1000) und rechnen bei eigener Eingabe kcal bzw.
     Salz zurück; kleiner grauer Hinweis „wird aus kcal / Salz berechnet“.
     Section „Portionen“ wie heute; **Sticky-Footer „Speichern“** (Stil `PageFooter`, wie Meal-Editor).
- **E2 Neu, leer, nach Tipp auf „Anlegen“**: Kalorienfeld mit Fehler „Kalorien sind Pflicht.“, Split-Leiste leer,
  Makrozeilen „0 %“.
- **E3 „pro Portion“**: Feld „Portionsgröße“ unter dem Toggle, Hinweis „Wird beim Speichern auf 100 g umgerechnet.“
- **E0 Vergleich**: dieselbe Übersicht lesend wie auf der Lebensmittel-Seite.
- Inline-JS: Tippen aktualisiert Split-Leiste, Prozente, kcal je Makro und die kJ/Natrium-Kopplung in beide
  Richtungen; Komma-Eingabe.
- Offene Frage in der Notiz: Hinweis, wenn kcal deutlich von 4/4/9 der Makros abweicht? (Mockup: keiner.)

### F. Berichte: Kalorien nach Makros (7)

- **F1** Section „Verlauf“, Metrik „Kalorien“, 14 Tage (SVG von Hand, ein Tag ohne Eintrag): je Tag ein gestapelter
  Balken, Höhe = geloggte kcal, von unten **Protein, Kohlenhydrate, Fett** (`--protein`, `--carbs`, `--fat`),
  Segmenthöhe = kcal × Energieanteil des Makros. Kein Grau. Ziel inkl. Training als gestrichelte Stufenlinie.
  Legendenzeile wie heute: „Gegessen 1.640 kcal“ (Marke neutral statt rot) und „Ziel inkl. Training 1.900 kcal“.
- **F2** Hover/Tap: Cursorlinie, Legendenzeile zeigt die Tageswerte.
- Notiz: Ein Tag mit kcal, aber ganz ohne Makros (nur Schnelleingabe mit kcal) lässt sich nicht aufteilen; dort
  ein einfarbiger Balken in `--foreground` 40 % (einziger Fall, im Mockup an einem Tag zeigen).

### G. Analyse-Review: Wiederholen und Hinweis (11), interaktiv

- **G1 Review mit Ergebnis**: Header „Ergebnis prüfen“, rechts **Wiederholen** (lucide `rotate-ccw`,
  `aria-label` „Neu analysieren“), Save-Icon, X. Unter dem Foto die KI-Notiz wie heute, darunter das Feld **„Hinweis
  für die Analyse“**, vorbefüllt mit dem ursprünglichen Text („mit Butter gebraten“), Hilfetext „Ändern und oben
  auf ↻ tippen, um neu zu analysieren.“ Dann die Zutaten.
- **G2 Kein Essen erkannt**: Foto, `EmptyState` „Kein Essen erkannt“, **darunter das Hinweisfeld** (leer) mit
  demselben Hilfetext, „+ Zutat hinzufügen“, Footer „Meal eintragen“ deaktiviert.
- **G3 Nach Tipp auf Wiederholen**: Foto mit dem Analyse-Overlay (wie in der Vorschau), Zutaten und Footer
  ausgegraut. Wenn im Review schon etwas geändert wurde, vorher Dialog **G4** „Neu analysieren?“, „Deine Änderungen
  an den Zutaten gehen verloren.“, „Abbrechen“ / „Neu analysieren“.
- Notiz: Wiederholen ersetzt das Ergebnis dieses Fotos (keine zweite Warteschlangen-Zeile); ein bereits als Meal
  gespeicherter Review bleibt mit dem Meal verknüpft, nur die Zutaten kommen neu (beim Implementieren prüfen).
  Offline: Toast wie heute, die Analyse läuft, sobald wieder verbunden.
- Inline-JS: Tipp auf ↻ zeigt G3 für 1,5 s, danach wieder G1.

### H. Plus-Menü (9)

- **H1** Drawer „Hinzufügen“ / „Was möchtest du eintragen?“ mit drei Kacheln: **Gewicht** (links) | **Essen**
  (Mitte, primary) | **Training** (rechts). Klein daneben „Vorher“ zum Vergleich.

### Ohne Mockup (nur in der Kopfnotiz erwähnen)

- **8 Berichte „lädt neu“**: Metrik-Select und Zeitraum-Toggle navigieren mit `replace`; dabei springt die Seite
  vermutlich nach oben (Router-Scroll-Reset) und das Diagramm wird neu aufgebaut. Ziel: Wechsel ohne Sprung und
  ohne Flackern.
- **10 Kein Pinch-Zoom**: gilt für die ganze App (auch Fokus-Zoom bei Eingabefeldern auf iOS).

## Ablauf für Opus

1. Vorlage `docs/plans/2026-10-feedback-runde-4-mockup.html` lesen.
2. Datei schreiben, Abschnitte A bis H in dieser Reihenfolge, Light/Dark über die Tokens.
3. Prüfen mit Playwright-MCP (`file://…`), Viewport 390×844, Screenshots Light und Dark
   (`browser_emulate_media`), alles durchscrollen; D auf-/zuklappen, in E tippen (Split-Leiste, Prozente,
   kJ ↔ kcal, Natrium ↔ Salz laufen mit), in G ↻ antippen. Keine Konsolenfehler.
4. Dem User kurz sagen, was zu sehen ist und welche Entscheidungen offen sind (D3/D4 Review mit Übersicht,
   kcal-Abweichungshinweis in E, G4-Dialog, Tag ohne Makros in F), dann iterieren (Version hochzählen).
5. Nichts committen, keinen App-Code ändern.

## Für den späteren Implementierungsplan (noch nicht umsetzen)

- **1**: `FoodLogPage` Text-Link → Header-Icon (neben Trash im Eintragsmodus); `MealLogView` `actions` mit Stift,
  Link raus; E2E-Selektoren anpassen.
- **2**: nach Speichern `router.history.back()` mit Fallback (`/meals`, `/custom-foods`); Meal-Editor: Blocker darf
  nach dem Speichern nicht greifen (`ignoreBlocker` oder Draft vorher bereinigen); `MealLogView` remountet über
  `key={meal.updatedAt}`. Lebensmittel-Editor `back` ohne festes Ziel; Löschen darf nicht auf eine tote
  Lebensmittel-Seite zurückführen (prüfen, was `FoodLogPage` dann zeigt).
- **3**: Blitz-Link von `AddFoodPage` nach `PhotoPage` (Kamera und Vorschau, nicht im Review).
- **4**: Such-State in `ExercisePage`, Filter über `templates`/`recent` mit der Normalisierung der Lebensmittelsuche
  aus `@ft/shared` (falls vorhanden); `Verwalten` und ggf. `QuickList.action` entfernen.
- **5**: `Collapsible` + `NutrientBreakdown` in `IngredientCard`, `MealLogView`-Zeilen (Swipe nicht stören), je nach
  Entscheidung im Review.
- **6/12**: Eingabemodus für `NutrientBreakdown` oder Schwester-Komponente, die `EnergySplitBar`, Zeilen-Layout und
  Collapsibles teilt; `NumberField`-Logik; kJ/Natrium über `kjFromKcal`/`kcalFromKj`, `saltFromSodiumMg`/
  `sodiumMgFromSalt` (`packages/shared/src/nutrients.ts`), beim Speichern alle 10 Werte speichern statt
  `completeNutrients` ableiten zu lassen. `CustomFoodPage` Speichern als `Page footer` (Button mit `form=`-Attribut).
- **7**: `Chart.tsx` um gestapelte Balken erweitern (kumulierte Serien, Legende nur für markierte Serien);
  `buildChart('kcal')`: Segmente `kcal × share` je Makro, Summenserie „Gegessen“ nur für die Legende; Tag ohne
  Makros einfarbig. Dataviz-Skill lesen.
- **8**: Ursache in `ReportsPage` prüfen (`navigate({ …, resetScroll: false })`; `Chart` nur bei Serienwechsel neu
  erzeugen, sonst `setData`; Lazy-Route-Suspense ausschließen) und im Browser verifizieren.
- **9**: Reihenfolge in `AddSheet.tsx` `items` tauschen, Kommentar anpassen; E2E-Selektoren prüfen.
- **10**: `index.html` viewport `maximum-scale=1, user-scalable=no`; iOS ignoriert das für Pinch, daher zusätzlich
  `touch-action: pan-x pan-y` auf `html` und `gesturestart`-`preventDefault` (in `main.tsx`); Maßband,
  Diagramm-Touch und Drag-and-drop im Tagebuch danach auf dem iPhone testen.
- **11**: Review bekommt Hinweisfeld (State im `aiQueue`-Eintrag `text`) und ↻: Eintrag mit neuem `text` auf
  `pending`/`analyzing` zurücksetzen, `draft` verwerfen, `processQueue` anstoßen (`features/ai/queue.ts:68`), Review
  bleibt offen und zeigt das Overlay; Verhalten mit `savedMealId` klären.
