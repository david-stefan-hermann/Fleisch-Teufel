# Feedback-Runde 4, Schritt 1: HTML-Mockups für alle UI-Änderungen

## Context

Der User hat nach Runde 3 (Commit d12dd1e) sechs Rückmeldungen gegeben. Bevor etwas implementiert wird, soll Opus
**eine HTML-Datei mit Mockups** aller sichtbaren Änderungen bauen; der User iteriert sie mit Opus, bis er zufrieden ist.
Erst danach entsteht der Implementierungsplan. Dieser Plan beschreibt nur die Mockups (kein App-Code wird angefasst).

Das Feedback und was davon ein Mockup braucht:

| #   | Feedback                                                                                           | Mockup?                                                                                                                                              |
| --- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Aufgeklapptes Meal im Tagebuch ist nach Zurück aus der Nährwerte-Seite wieder zu                   | Nein: reiner Zustandsbug (`useState` in `GroupRow`, `features/diary/MealCard.tsx:341`, geht beim Routenwechsel verloren). Nur in der Notiz erwähnen. |
| 2   | ⋮-Menü an den Tagesmahlzeiten weg; „Als Meal speichern“ als Save-Icon im Header der Mahlzeit-Seite | Ja (A)                                                                                                                                               |
| 3   | Editor unter „Gespeicherte Meals“ wie der Analyse-Review; dort kein Eintragen, nur Speichern       | Ja (B)                                                                                                                                               |
| 4   | Voller roter Überschussbalken füllt sich darüber in dunklerem Rot weiter                           | Ja (C)                                                                                                                                               |
| 5   | Gewichts-Slider wird ein endlos scrollbares Maßband, Zeiger mittig, ±1 kg sichtbar, 0,05-Schritte  | Ja (D, interaktiv)                                                                                                                                   |
| 6   | Einheitliches UI für Training speichern / als Vorlage speichern und Analyse-Meal speichern         | Ja (E, zwei Varianten)                                                                                                                               |

Geklärte Entscheidungen des Users (Rückfragen vom 2026-10-08):

- Vorbild für den Meal-Editor ist der **Analyse-Review** (`features/ai/PhotoPage.tsx` `ResultEditor`): Foto, Name,
  Zutatenzeilen mit Gramm-Slider und Zahlenfeld, „+ Zutat hinzufügen“, Gesamtmenge, Nährwerte.
- Der **Analyse-Review bleibt wie heute** (Eintragen direkt nach dem Scan möglich). Nur wenn man später unter
  „Gespeicherte Meals“ ein Meal bearbeitet, gibt es **kein Eintragen, nur Speichern**.
- „Von anderem Tag kopieren“ (`/copy-meal`) wird **entfernt** (einziger Zugang war das ⋮-Menü).

Annahme (im Mockup sichtbar machen, User kann sie kippen): Ein gespeichertes Meal wird weiterhin über die
Lebensmittelsuche, Reiter „Eigene“, eingetragen. Der Tipp dort öffnet die Meal-Seite im **Eintragen-Modus**
(Zutaten nur lesend, Menge 0,5× bis 2×, Mahlzeit, „… kcal eintragen“). Ohne Datum/Mahlzeit im Aufruf (Weg über
Mehr → Gespeicherte Meals) ist dieselbe Seite der **Editor** ohne Eintragen. Unterscheidung: `search.date`/`search.meal`
vorhanden oder nicht (so unterscheidet heute schon `MealsPage` ihren Titel „Meal zu Frühstück“ / „Gespeicherte Meals“).

## Ist-Zustand, den Opus kennen muss (aus dem Code)

- **Tagebuch-Mahlzeitenkarte** `features/diary/MealCard.tsx:94-137`: Kopfzeile ist ein `Link` auf `/diary-meal`
  (Name, kcal, Chevron). Rechts daneben zwei Icon-Buttons: `+` (öffnet das Plus-Menü) und `⋮` mit „Von anderem Tag
  kopieren“, „Gespeichertes Meal eintragen“, „Als Meal speichern“ (Dialog Z. 445-480: Titel „Als Meal speichern“,
  Beschreibung „n Einträge werden als wiederverwendbares Meal gespeichert.“, Feld „Name“, Buttons „Abbrechen“ /
  „Meal speichern“), Trennlinie, „Alle Einträge löschen“ (rot).
- **Mahlzeit-Seite** `features/diary/DiaryMealPage.tsx:39-58`: `Page` mit Titel `{Name}` + grauem `fmtRelativeDay`,
  Zurück-Pfeil, rechts nur ein `+` (`text-primary`). Inhalt: Section mit `NutrientBreakdown` „Summe“, Section
  „Einträge“ mit `DiaryRows`. Header-Icons sind 24 px (`components/Page.tsx:36-56`).
- **Meal-Seite** `features/meals/MealPage.tsx`: Header Name + Trash-Icon rechts; `PhotoSection` (ohne Foto zwei
  Outline-Buttons „Foto aufnehmen“ / „Aus Mediathek“); Feld „Name“ (speichert bei Blur); Section „Zutaten“ (Zeile:
  Name, Menge, kcal; Tipp öffnet `AmountDialog`; Swipe entfernt), Button „Zutat hinzufügen“, Hinweistext; Section
  „Nährwerte“ (`NutrientBreakdown`); Section „Eintragen“ (ToggleGroup 0,5× 1× 1,5× 2×, Select „Mahlzeit“, Button
  „{kcal} kcal eintragen“).
- **Analyse-Review** `features/ai/PhotoPage.tsx:414-695`: Titel „Ergebnis prüfen“, X rechts; Foto 4:3; Feld „Name des
  Meals“; KI-Notiz; je Zutat eine Section (Name, Badge „KI: sicher“, kcal, Trash, Select „Lebensmittel aus der
  Datenbank“, Gramm-Slider + Zahlenfeld); Outline „+ Zutat hinzufügen“; letzte Section: Slider „Gesamtmenge“
  (25-300 %), `NutrientBreakdown` „Summe“, Select „Mahlzeit“, Buttons „Als Meal speichern & eintragen“ (primär) und
  „Nur eintragen“ (outline), Hilfetext, Modell/Kosten-Zeile.
- **Training** `features/exercise/ExercisePage.tsx`: Titel „Training eintragen“ / „Training bearbeiten“, beim
  Bearbeiten Trash rechts; Datumszeile; Section „Schnellauswahl“ (Vorlagen, Zuletzt); Section „Sportart“ (Suche,
  Liste, „+ Eigene Sportart“); Formular-Section (Intensität leicht/mittel/hoch, Dauer mit Chips 15/30/45/60/90, Notiz,
  kcal-Box) mit den Buttons „Training speichern“ (primär) und „Als Vorlage speichern“ (outline, öffnet Dialog
  „Als Vorlage speichern“ mit Feld „Name“, Buttons „Abbrechen“ / „Vorlage speichern“; speichert nur die Vorlage,
  trägt nichts ein).
- **Überschussbalken** `components/MacroBars.tsx` `TargetBar`: Spur `bg-muted`, Füllung in Makro-Farbe
  (`min(100, v/t)`), darüber von links `bg-over` mit Breite `min(100, (v-t)/t)`. Ab 2× Ziel ist alles rot, 2× und
  5× sehen gleich aus. Genutzt von `MacroBars` (Tagesübersicht, Grid mit Label, Balken, „v / t g“ in `text-over`)
  und `NutrientBreakdown` im Tagesmodus.
- **Gewicht** `features/progress/ProgressPage.tsx:234-356` `WeightDialog` (shadcn `Dialog`): Titel „Gewicht
  eintragen“ / „Gewicht ändern“, Beschreibung „Ein Wert pro Tag. …“, große Zahl `84,5` + „kg“, Zeile `−` Slider `+`
  (±5 kg, Schritt 0,1), darunter „79 kg … 90 kg“, `NumberField` „Genauer Wert“, Datumszeile mit „Datum ändern“,
  Footer „Abbrechen“ / „Speichern“.
- **Sticky-Footer** gibt es nur inline in `features/foods/FoodLogPage.tsx:457`
  (`sticky bottom-0 border-t bg-background/90 backdrop-blur-md`, ein `size="lg"`-Button). Kein gemeinsames
  Footer-Bauteil.
- **Design-Tokens** `apps/web/src/index.css` (oklch, Dark per `prefers-color-scheme`): background 0.985/0.18,
  card 1/0.225, foreground 0.2/0.95, muted 0.955/0.27, muted-foreground 0.5/0.7, border 0.91/0.32,
  primary (Teufelsrot) `oklch(0.5 0.17 25)` / `oklch(0.64 0.17 25)`, protein `oklch(0.58 0.14 250)` /
  `oklch(0.66 0.13 250)`, carbs `oklch(0.75 0.15 75)` / `oklch(0.66 0.14 70)`, fat `oklch(0.6 0.16 320)` /
  `oklch(0.62 0.15 320)`, over `oklch(0.58 0.19 27)` / `oklch(0.68 0.17 27)`, good `oklch(0.6 0.13 155)`,
  radius 0.875rem (Sections `rounded-2xl`), Font Inter (im Mockup: `-apple-system, system-ui`).
- **Vorlage**: `docs/plans/2026-10-naehrstoff-mockup.html` (Runde 3). Gleicher Aufbau: eine Datei, `.phone`
  390 px, `h2` je Screen (A, B, C …), `.label` je Zustand (A1, A2 …), `p.note` mit Erklärung, CSS-Variablen in
  `:root` + Dark-Block. Die Datei nutzt gerundete Hex-Farben; für die neue Datei die oklch-Werte oben übernehmen.

## Deliverable

**Eine Datei** `docs/plans/2026-10-feedback-runde-4-mockup.html` (liegt über SMB auf dem PC des Users, dort
öffnet er sie im Browser). Statisch, ohne Build, ohne externe Ressourcen; nur Abschnitt D braucht ein kleines
Inline-Script. Deutsch, keine Gedankenstriche (CLAUDE.md), Zahlen deutsch formatiert (`84,50 kg`, `1.700 kcal`).
Kopf wie in der Vorlage: `h1` „Feedback-Runde 4, Mockups v1“, Notiz mit den Beispielwerten (Tagesziel 1.700 kcal,
Protein 130 g, Kohlenhydrate 170 g, Fett 55 g; Beispiel-Meal „Spaghetti Bolognese“ 620 kcal) und dem Hinweis,
dass Punkt 1 (Aufklapp-Zustand) kein Mockup braucht.

Bei jeder Iteration mit dem User: Datei in place ändern, Versionsnummer im `h1` hochzählen, in der Kopfnotiz einen
Absatz „Neu gegenüber vX“ pflegen (wie in der Vorlage).

### A. Tagebuch: Mahlzeitenkarte und Mahlzeit-Seite (Feedback 2)

- **A1 Karte im Tagebuch, neu**: Kopfzeile „Mittagessen · 620 kcal ›“, rechts nur noch das `+`. Kein ⋮. Darunter
  zwei Beispielzeilen (ein Meal-Gruppenrow mit Foto-Thumbnail und Chevron, ein Einzeleintrag). Daneben als
  Vergleich klein „Vorher“ mit ⋮ (grau, optional, nur wenn es ohne viel Platz geht).
- **A2 Mahlzeit-Seite `/diary-meal`, Header**: „‹ Mittagessen Heute“ links, rechts zwei Icons: **Save** (lucide
  `save`, Pfad im SVG nachbauen) und `+` (primary-farben wie heute). Save hat `aria-label` „Als Meal speichern“;
  deaktiviert (ausgegraut) wenn die Mahlzeit leer ist: A2b als zweiter Zustand mit leerer Mahlzeit zeigen.
  Inhalt wie heute (Summe-Übersicht gekürzt, Section „Einträge“).
- **A3 Dialog „Als Meal speichern“**: unverändert übernommen (Titel, Beschreibung „3 Einträge werden als
  wiederverwendbares Meal gespeichert.“, Feld „Name“ mit Platzhalter „z. B. Mein Mittagessen…“, „Abbrechen“ /
  „Meal speichern“). Er ist zugleich die Dialog-Vorlage für Abschnitt E, Variante 1.
- Notiz unter A: Was wegfällt und wo es stattdessen liegt: „Gespeichertes Meal eintragen“ = Plus → Lebensmittel
  suchen → Reiter „Eigene“; „Alle Einträge löschen“ = Swipe je Zeile; „Von anderem Tag kopieren“ entfällt
  ersatzlos.

### B. Meal-Editor unter „Gespeicherte Meals“ (Feedback 3)

- **B1 Editor (Mehr → Gespeicherte Meals → Meal)**, Aufbau nach dem Analyse-Review:
  1. Header „‹ Spaghetti Bolognese“, rechts Trash (rot, wie heute).
  2. Foto 4:3 mit „Ändern“ / X (bzw. ohne Foto die beiden Outline-Buttons).
  3. Section mit Feld „Name“.
  4. **Je Zutat eine Section** wie im Review: Zeile 1 Name + kcal + Trash-Icon; Zeile 2 Gramm-Slider (Spur
     `muted`, Füllung `primary`) + Zahlenfeld mit Einheit g (bei Stück-Portionen „Anzahl · Stück (60 g)“, Beispiel
     mit einer Stück-Zutat zeigen). Kein Select „Lebensmittel aus der Datenbank“ (die Zutat ist schon ein
     Lebensmittel), kein KI-Badge.
  5. Outline-Button „+ Zutat hinzufügen“.
  6. Letzte Section: Slider „Gesamtmenge“ (skaliert alle Zutaten, 25-300 %, Standard 100 %), `NutrientBreakdown`
     „Summe“ (kompakt, wie Vorlage), darunter **kein** „Mahlzeit“-Select und **kein** Eintragen.
  7. **Sticky-Footer** (Stil wie `FoodLogPage`): ein primärer Button „Speichern“. Hinweis darunter im Mockup-Text:
     Name und Mengen werden erst mit „Speichern“ geschrieben (heute: Blur/Dialog sofort). Zurück ohne Speichern
     verwirft Änderungen. Ob ein „Ungespeicherte Änderungen“-Nachfrage nötig ist, als Frage an den User in die
     Notiz schreiben.
- **B2 Eintragen-Modus (Tipp im Reiter „Eigene“ der Suche)**: gleiche Seite, aber Zutaten als **Lese-Liste**
  (Name, Menge, kcal, kein Slider, kein Trash), kein Name-Feld, kein Foto-Ändern, kein Trash im Header. Letzte
  Section „Eintragen“ wie heute: Menge-Toggle 0,5× 1× 1,5× 2×, Select „Mahlzeit“, Footer-Button „620 kcal
  eintragen“. Kleiner Text-Link „Meal bearbeiten“ unter der Zutatenliste? Nur als Frage in der Notiz, nicht zeichnen.
- Notiz unter B: die Annahme aus dem Context (Modus hängt daran, ob Datum/Mahlzeit mitkommen) klar als Annahme
  markieren.

### C. Überschussbalken mit zweiter Stufe (Feedback 4)

- Neue Farbe `--over-2` (dunkleres Rot, Vorschlag Light `oklch(0.42 0.17 27)`, Dark `oklch(0.52 0.16 27)`; auf
  Kontrast zum normalen `over` achten, beide Modi prüfen).
- **C1** fünf Balkenzeilen im `MacroBars`-Stil (Label, Balken `h-2`, „v / t g“): 50 % (nur Makro-Farbe), 120 %
  (Makro voll, rot 20 %), 200 % (rot voll), 250 % (rot voll, darüber `over-2` 50 %), 300 % und mehr (`over-2` voll;
  Notiz: ab hier keine weitere Stufe, nur die Zahl zeigt es).
- **C2** dieselben Zustände einmal als Makro-Zeile aus dem `NutrientBreakdown`-Tagesmodus (Punkt, „Fett“, rechts
  „138 g / 55 g · 250 %“ in `over`-Textfarbe, Balken `h-1.5`), damit klar ist, dass beide Stellen gleich aussehen.
- Notiz: Reihenfolge der Schichten (Makro, rot, dunkelrot, immer von links), Text bleibt in `over`, nie in `over-2`.

### D. Gewicht als Maßband (Feedback 5), interaktiv

- **D1 Dialog „Gewicht eintragen“** mit allem wie heute, nur die Slider-Zeile ist ersetzt durch das Maßband:
  - Große Zahl `84,50` + „kg“ (zwei Nachkommastellen, weil 0,05-Schritte).
  - Darunter das **Maßband**: horizontal scrollbare Skala über die volle Dialogbreite (ca. 340 px), sichtbarer
    Ausschnitt **±1 kg** um den Wert. Striche alle 0,05 kg (klein), alle 0,5 kg (mittel), jede volle kg (lang, mit
    Beschriftung „84“, „85“). Fester **Zeiger in der Mitte** (primary, dreieckig oder Linie), der Wert unter dem
    Zeiger ist der eingestellte. Skala scrollt endlos (20 bis 400 kg reicht; im Mockup darf sie bei den Grenzen
    enden).
  - Mit Inline-JS bedienbar: Ziehen/Wischen auf der Skala (Pointer-Events) bzw. Scrollen mit `scroll-snap` auf die
    0,05-Raster, Zahl aktualisiert live. Kein Framework, kein Build.
  - `−` / `+` Buttons links/rechts der Skala behalten (jetzt 0,05 kg); „Genauer Wert“-Feld und Datumszeile bleiben.
  - Striche und Labels in `muted-foreground`, Zeiger in `primary`, Skalenhintergrund `card`; Beispiel-Text, dass
    der Wert beim Loslassen einrastet.
- **D2** derselbe Dialog als „Gewicht ändern“ (Editmodus, ohne Datumszeile), damit beide Titel vorkommen.
- Notiz: Darstellung für Dark prüfen; Hinweis, dass haptisches Feedback im Mockup nicht gezeigt werden kann.

### E. Einheitliches Speichern-UI (Feedback 6), zwei Varianten

Die Begriffe sind überall gleich: **Eintragen** = ins Tagebuch; **Speichern** = wiederverwendbar ablegen (Meal,
Vorlage). Beide Varianten für beide Screens zeichnen (Training eintragen, Analyse-Review), jeweils nur der untere
Teil des Screens (letzte Section + Footer), Header separat skizziert. Der User wählt.

- **Variante 1 „Footer + Header-Icon“** (wie die Mahlzeit-Seite in A2):
  - Header rechts ein Save-Icon: Training „Als Vorlage speichern“, Review „Als Meal speichern“. Tipp öffnet denselben
    Dialog wie A3 (Titel, Beschreibung, Feld „Name“, „Abbrechen“ / „Vorlage speichern“ bzw. „Meal speichern“).
    Beim Review wird das Feld „Name des Meals“ auf der Seite dadurch **ersetzt** (Name nur noch im Dialog); nach dem
    Speichern zeigt der Header ein gefülltes Icon oder einen Chip „Als Meal gespeichert“ (E1c zeigen).
  - Sticky-Footer mit **einem** primären Button: Training „Training eintragen“, Review „Eintragen“. Der Review
    trägt immer als Gruppe ein; war vorher „Als Meal speichern“ gedrückt, hängt das Meal dran (entspricht heute
    „Als Meal speichern & eintragen“). „Nur eintragen“ entfällt als eigener Button.
  - Zustände: E1a Training, E1b Review (nicht gespeichert), E1c Review nach Speichern, E1d der Dialog.
- **Variante 2 „Speichern-Zeile + ein Button“**:
  - Oberhalb des Footers eine Zeile mit **Switch**: Training „Als Vorlage speichern“, Review „Als Meal speichern“.
    Ist der Switch an, klappt darunter das Feld „Name“ auf (vorbefüllt wie heute: Sportartname bzw. KI-Name).
  - Sticky-Footer mit einem primären Button, dessen Label den Switch spiegelt: aus → „Eintragen“ / „Training
    eintragen“; an → „Speichern & eintragen“. Kein zweiter Button, kein Dialog.
  - Zustände: E2a Training Switch aus, E2b Training Switch an, E2c Review Switch an (Name sichtbar).
- Beide Varianten: Meal-Editor (B1) hat nur „Speichern“, Mahlzeit-Seite (A2) nur das Header-Icon; in der Notiz
  kurz erklären, wie B und A in beide Varianten passen (Variante 1 ist mit A2 identisch, Variante 2 bräuchte für A2
  weiterhin das Icon, weil dort nichts eingetragen wird).
- Notiz mit einer Tabelle „heute / Variante 1 / Variante 2“ (Primärbutton, Zweitaktion, Name wo) für beide Screens.

## Ablauf für Opus

1. Vorlage `docs/plans/2026-10-naehrstoff-mockup.html` lesen (Aufbau, Klassen, Breakdown-Markup wiederverwenden).
2. Datei schreiben (Abschnitte A bis E in dieser Reihenfolge, Hinweis zu Punkt 1 in der Kopfnotiz).
3. Prüfen: Datei mit Playwright-MCP öffnen (`file://…`), Viewport 390×844, Screenshots in Light und Dark
   (`browser_emulate_media` colorScheme), alle Abschnitte durchscrollen; Maßband per Drag/Scroll bedienen und
   sehen, dass die Zahl mitläuft und auf 0,05 einrastet. Keine Konsolenfehler.
4. Dem User kurz sagen, was zu sehen ist, welche Fragen in den Notizen stehen (B: ungespeicherte Änderungen,
   B2-Annahme, E: Variantenwahl) und dann auf Rückmeldung iterieren (Version hochzählen).
5. Nichts committen, nichts an der App ändern. Die Datei wird später zusammen mit dem Implementierungsplan committet.

## Für den späteren Implementierungsplan (noch nicht umsetzen)

Festgehalten, damit die Entscheidungen nicht verloren gehen:

- Punkt 1: Aufklapp-Zustand der Gruppen aus `GroupRow` herausziehen (z. B. Set von `groupId`s in `sessionStorage`
  pro Datum, oder im Router-Search), sodass Zurück aus `/entry/$entryId` den Zustand wiederherstellt.
- Punkt 2: ⋮-Menü, `SaveMealDialog` und `removeEntriesWithUndo`-Aufruf aus `MealCard.tsx` entfernen, Dialog in
  `DiaryMealPage` hinter das Header-Icon; Route und Seite `/copy-meal` löschen (inkl. E2E-Schritte, Leerzustand-Text
  in `MealsPage.tsx:27-30` anpassen).
- Punkt 3: `MealPage` in Editor-Modus (ohne `search.date`/`search.meal`) und Eintragen-Modus aufteilen; Zutatenzeilen
  wie `ResultEditor` (Slider + `NumberField`), explizites Speichern statt Blur-`patchRecord`; `AmountDialog` entfällt.
- Punkt 4: `TargetBar` bekommt dritte Schicht `bg-over-2` mit Breite `min(100, (v - 2t)/t)`; Token `--over-2` in
  `index.css`; Tests in `apps/web/test/components.test.tsx`.
- Punkt 5: Maßband-Komponente (`components/TapeMeasure.tsx`?) ersetzt den `Slider` in `WeightDialog`; Schritt 0,05,
  `round(v, 2)`; E2E `diary-training.spec.ts:230-240` (Slider ±5 kg) anpassen.
- Punkt 6: je nach gewählter Variante gemeinsames Footer-Bauteil (aus `FoodLogPage.tsx:457` herauslösen) und ggf.
  gemeinsamer „Name“-Dialog für Meal/Vorlage.
