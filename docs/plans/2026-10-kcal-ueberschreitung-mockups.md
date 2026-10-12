# Mockup: Überschreitung des Kalorien-Tagesziels besser erkennbar

## Context

Wer über dem Kalorienziel liegt, sieht das im Tagebuch kaum. Befund im Code:

- `apps/web/src/components/CalorieRing.tsx`: der Ring ist `--primary` (Rot, Hue 25), der Überschuss-Bogen
  `--over` (Rot, Hue 27) liegt direkt darauf. Rot auf Rot, kaum Helligkeitsunterschied: der Bogen ist praktisch
  unsichtbar. Über 200 % ändert sich gar nichts mehr (kein `--over-2` wie bei `TargetBar`).
- Einziger echter Hinweis: die Zahl in der Mitte wird rot und die Unterzeile wechselt von "kcal übrig" zu
  "kcal zu viel" (12 px, grau).
- `CalorieCard.tsx`: die Zeile heißt weiter "Übrig" und zeigt eine negative Zahl in Rot.
- `NutrientBreakdown` Variante `day` (Karte aufgeklappt, Berichte): Kopf "2.130 / 1.900 kcal" ohne jeden
  Überschuss-Zustand.
- `WeekStrip`: zeigt nur "etwas eingetragen", keinen Zielstand.

Dieser Plan erzeugt nur ein HTML-Mockup mit Varianten (Workflow wie in den Feedback-Runden). Kein App-Code,
bis der User eine Variante gewählt hat; danach folgt der Umsetzungsplan.

## Ergebnis

Eine Datei `docs/plans/2026-10-kcal-ueberschreitung-mockup.html` (v1), self-contained, im Format von
`docs/plans/2026-10-feedback-runde-8-mockup.html` (Tokens aus `apps/web/src/index.css` inkl. `--over`,
`--over-2`, `--protein`, `--carbs`, `--fat`, `--exercise`; `.phone`/`.screen`, Hell/Dunkel-Schalter, deutsche
Texte, keine Gedankenstriche). Dazu dieser Plan als `docs/plans/2026-10-kcal-ueberschreitung-mockups.md`.

### Aufbau des Mockups

Oben ein Regler "Gegessen" (Ziel 1.900 kcal, Training 0 / 300 umschaltbar) plus Schnellwahl 80 %, 100 %,
112 %, 160 %, 230 %. Alle Telefone reagieren live, damit knapp drüber und weit drüber vergleichbar sind.

**0. Heute (Ist-Stand)**: exakte Nachbildung von `CalorieCard` + `CalorieRing` als Vergleich.

**A. Ring: Rot bedeutet nur noch "zu viel"** (meine Empfehlung)

- Unter dem Ziel unverändert (roter Markenring).
- Über dem Ziel wird die volle Runde neutral (dunkles Grau, `--foreground` mit reduzierter Deckkraft), der
  Überschuss läuft als zweite Runde in `--over` darüber, mit schmaler Trennfuge in Kartenfarbe am Bogenkopf.
  Ab 200 % dritte Runde in `--over-2` (gleiche Logik wie `TargetBar`).
- Mitte: "+230" in `text-over`, darunter weiter "kcal zu viel" (die längere Zeile passt nicht in den Ring).

**B. Ring bleibt rot, Überschuss als abgesetzte dunkle Runde**

- Markenring bleibt `--primary`; Überschuss in `--over-2` mit heller Trennfuge, dazu ein Chip
  "Ziel überschritten" unter dem Ring und ein roter Kartenrand (`border-over`, leichte Tönung).

**C. Ring plus Zielbalken mit Zielmarke**

- Ring wie A, zusätzlich unter Ring und Zeilen ein Balken über die volle Kartenbreite: Skala wächst mit, eine
  senkrechte Marke steht beim Ziel, alles rechts davon ist rot (dunkelrot ab 200 %), Beschriftung
  "Ziel 1.900" an der Marke und "+230" am Ende.

**In allen Varianten gleich (Zeilen der Karte)**

- Zeile "Übrig" heißt bei Überschuss "Zu viel" und zeigt "230" ohne Minus, `text-over`.

**D. Zusätzlicher Umfang (einzeln wählbar)**

- D1 `NutrientBreakdown` `day`: Kopf "2.130 / 1.900 kcal" mit roter Ist-Zahl und Zusatz "+230". Im Mockup
  als aufgeklappte Karte und als Berichte-Ausschnitt ("Ø pro Tag").
- D2 Wochenleiste: Tage über dem Ziel bekommen statt des roten Essens-Punkts einen abgesetzten Marker
  (Vorschlag: dunkelroter, breiterer Strich `--over-2`); zwei Alternativen nebeneinander. Hinweis im Mockup:
  braucht pro Tag den Zielstand, also mehr als `useLoggedDates`.

Unter jeder Variante kurze Vor- und Nachteile (`.pc`), am Ende eine Box "Zu entscheiden" (Ring A/B/C, D1 ja
/nein, D2 ja/nein und welcher Marker).

### Regeln für das Mockup

- Zielvergleich immer gegen `budgetKcal` (Ziel plus angerechnetes Training), wie der Ring heute.
- Text nie in `--over-2` (nur Balken und Bögen), Texte in `text-over`.
- Neue Farbkombinationen (neutraler Ring gegen `--over`, `--over` gegen `--over-2` auf Karte hell und dunkel)
  mit dem Palette-Checker des `dataviz`-Skills prüfen und das Ergebnis in einer Notiz vermerken.
- Protein bleibt außen vor (dort ist mehr gut, `overTone="good"`).

## Ablauf

1. Skills `dataviz` und `artifact-design` laden.
2. `CalorieRing.tsx`, `CalorieCard.tsx`, `MacroBars.tsx` (`TargetBar`), `WeekStrip.tsx` und den Kopf von
   `NutrientBreakdown.tsx` lesen, damit Ist-Stand und Maße (Ring 148 px, Strich 12 px) stimmen.
3. Mockup-Datei schreiben, Plan nach `docs/plans/` kopieren. Kein App-Code, kein Commit.
4. Als privates Artifact veröffentlichen (SendUserFile ging in früheren Runden nicht) und den Link nennen;
   die Datei liegt zusätzlich per SMB unter `docs/plans/`.

## Verifikation

- Mockup mit Playwright in 1280 px Breite öffnen, je ein Screenshot Hell und Dunkel bei 80 %, 112 %, 160 %
  und 230 %; prüfen, dass der Überschuss in A, B und C bei 112 % auf einen Blick erkennbar ist und bei 230 %
  die zweite Stufe sichtbar wird.
- Keine Konsolenfehler, Regler und Themenschalter funktionieren, kein horizontales Scrollen bei 390 px.
- `pnpm lint` (prettier prüft auch `docs/`), bei Bedarf `pnpm format`.

## Stand nach v1 (2026-10-12)

Entschieden vom User: die neu gestalteten Ringe A, B und C sind verworfen ("sehen alle schlecht aus"), D2
(Wochenleiste) entfällt. Mockup v2 zeigt nur noch:

- **E**: Ring unverändert, der Überschuss-Bogen bekommt ein dunkleres Rot. E1 nimmt `--over-2`, E2 einen
  eigenen, dunkleren Ton (`--over-3`: hell `oklch(0.33 0.14 27)`, dunkel `oklch(0.42 0.15 27)`). Abstand zum
  Ring laut Palette-Checker: E1 9,7 hell / 16 dunkel, E2 17 hell / 22 dunkel (heute 8,1).
- **D1**: im Kopf von `NutrientBreakdown` `day` wird nur die kcal-Zahl rot, sobald der Tag über Ziel plus
  angerechnetem Training liegt. Keine Zusatzzeile.

Entschieden nach v2: E1 (Überschuss in `--over-2`) und die Zeile "Zu viel" ohne Minus. Umgesetzt in
`CalorieRing.tsx`, `CalorieCard.tsx` und `NutrientBreakdown.tsx` (`kcalBudget`).
