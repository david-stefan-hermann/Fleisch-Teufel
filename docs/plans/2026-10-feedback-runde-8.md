# Feedback-Runde 8: Mengeneingabe

## Kontext

Runde 7 hat alle Mengen auf `AmountEditor` vereinheitlicht (Slider mit Start in der Mitte, Raster 1 g / 0,1
Portionen, −/+ am Feld, Einheiten-Dropdown). Feedback dazu:

1. Portionsslider wieder in 0,5er Schritten.
2. − und + am Eingabefeld entfernen (macht der Slider schon).
3. Das Einheiten-Dropdown soll nur sinnvolle Einheiten zeigen (keine Tasse bei Toastbrot).
4. Die Slider-Logik insgesamt fühlt sich noch schwierig an: Recherche (iOS Best Practices, andere Apps), dann
   Mockups, in denen die Mengeneingabe von Grund auf neu gedacht ist.
5. Nachtrag: Ein offline aufgenommenes Foto soll schon im Tagebuch stehen (ohne kcal), damit man sieht, dass die
   Daten sicher sind, bevor das Internet wieder da ist (Block 5).

Entschieden (Rückfragen 2026-10-10):

- Einheiten: **Regeln nach Gruppe** (BLS-Gruppe, Einheit g/ml, Namenswörter). Keine neuen Stück-Portionen mit
  Schätzgewicht.
- Ablauf: **erst Recherche und Mockups**. Die Punkte 1 bis 3 werden nicht vorab umgesetzt, sondern zusammen mit
  der gewählten Slider-Variante (Teil C). Bis dahin bleibt der App-Code unberührt.

## Ablauf nach Freigabe

1. Diesen Plan nach `docs/plans/2026-10-feedback-runde-8.md` kopieren.
2. Teil A: Recherche, Ergebnis als kurzer Abschnitt "Recherche" im Plan und im Mockup.
3. Teil B: Mockup-Datei bauen, per `SendUserFile` schicken, auf die Entscheidung warten.
4. Teil C erst nach dem "los": Implementierung in Blöcken (ein Commit je Block, je Block `pnpm lint`,
   `pnpm typecheck`, `pnpm test`), Abweichungen melden statt still entscheiden.

## Teil A: Recherche

Websuche und Lesen, kein Code. Fragen:

- Apple HIG zu Slider, Stepper, Picker (Wheel), Textfeld mit Ziffernblock: wofür ist welches Element gedacht,
  was sagt Apple zu Slidern für genaue Zahlenwerte?
- Wie lösen es Ernährungs-Apps: MyFitnessPal, Yazio, Cronometer, Lose It, FDDB, MacroFactor, Lifesum
  (Anzahl + Einheit, Wheel, Ziffernblock, Schnellwahl-Chips, zuletzt benutzte Menge)?
- Muster außerhalb der Branche für "ungefähr einstellen, genau korrigieren": Lineal/Tape (in der App schon als
  `TapeMeasure` beim Gewicht), Scrubbing auf der Zahl, Preset-Chips.
- PWA-Grenzen auf iOS: kein natives Wheel, Haptik nur eingeschränkt, `inputmode="decimal"`, Tastatur und
  `DialogBody`.

Ergebnis: 5 bis 8 Zeilen Fazit mit Quellen, daraus die Mockup-Varianten ableiten (die Liste in Teil B ist der
Startpunkt, die Recherche darf sie ändern).

### Ergebnis (2026-10-10)

- Apple HIG: Slider mit Textfeld ergänzen, besonders bei großen Bereichen; das Feld ist das genaue Element.
  Wheels (Picker) für mittellange, vorhersehbare Listen. Stepper für kleine Änderungen in wenigen Tipps.
  (developer.apple.com/design/human-interface-guidelines/sliders, /pickers, /steppers)
- NN/g: Slider nur, wenn der genaue Wert egal ist; der Daumen verrutscht beim Loslassen
  (nngroup.com/articles/gui-slider-controls). Smashing: editierbarer Wert, Presets, nichtlineare Skala
  (smashingmagazine.com/2017/07/designing-perfect-slider).
- Apps: belegt nur MacroFactor (eigene Tastatur, merkt die letzte Menge je Lebensmittel) und Cronometer
  (Zahlenfeld + Portionsauswahl); Lose It laut Sekundärquelle Wheels. MyFitnessPal, Yazio, FDDB, Lifesum nicht
  belegbar (Erinnerung: Feld + Einheit, kein Slider).
- iOS-PWA: `<select>` ist ein Menü, kein Wheel; kein verlässliches Haptik-Feedback; Feld als `type="text"` mit
  `inputmode="decimal"` (macht `NumberField` schon); Lineal/Wheel über Scroll-Position, nicht `scrollsnapchange`.
- Fazit: Feld zuerst, gemerkte Menge als Schnellwahl, Lineal statt begrenztem Slider; Wheel nicht für Gramm.

Mockup v1: `docs/plans/2026-10-feedback-runde-8-mockup.html` (A Lineal, B Zahl + Chips, C fester Slider mit
gestauchter Skala, D Wheel, E Tagebuch-Platzhalter). Empfehlung: A plus "Zuletzt"-Chip. Entscheidung offen.

Rückmeldung zu v1 (2026-10-10): A abgelehnt ("ein Lineal hat damit nichts zu tun"), **D (Wheel) gewählt, dazu
ein Eingabefeld**. E gefällt, aber **kein "bitte prüfen"**: niemand soll zum Prüfen gedrängt werden.

Mockup v2 (gleiche Datei): nur noch D mit Feld (Rolle 5-g-Schritte bis 1.000 g bzw. 0,5 bis 10 Portionen; ein
getippter Wert abseits des Rasters bekommt nach Verlassen des Felds einen eigenen Platz auf der Rolle) und E in
zwei Fassungen: E1 Analyse wird nach dem Ergebnis von selbst eingetragen (normaler Gruppeneintrag mit kcal),
E2 stiller Platzhalter "N Lebensmittel erkannt" ohne kcal.

Entschieden (2026-10-10): **E1**, und D auch in den kompakten Zutatenkarten ("probieren wir mal aus").

## Umgesetzt (2026-10-10)

Die Blöcke 1, 2 und 4 des Plans unten sind in der Wheel-Variante aufgegangen; die Abschnitte in Teil C zeigen
den Planungsstand davor.

- **Block 1, Mengeneingabe als Wheel mit Feld** (`components/Wheel.tsx`, `components/AmountEditor.tsx`,
  `lib/amounts.ts`): zwei Rollen (Menge, Einheit), Raster 5 g bis 1.000 g bzw. 0,5 bis 10 Portionen, Feld für
  jeden Wert; ein Wert abseits des Rasters bekommt einen eigenen Platz auf der Rolle. Slider, −/+,
  `sliderRange` und `useSliderStart` sind entfernt. "Eigene Portion" ist ein Knopf neben dem Label.
  Abweichung vom Mockup: der Wert abseits des Rasters erscheint schon beim Tippen auf der Rolle, nicht erst
  nach Verlassen des Felds.
- **Block 2, sinnvolle Einheiten** (`packages/shared/src/foods.ts`, `householdPortionsFor`): Namenswörter vor
  BLS-Gruppe vor Einheit; 4.010 der 7.140 BLS-Lebensmittel bekommen keine Haushaltsmaße mehr.
- **Block 3, Offline-Foto im Tagebuch (E1)**: Platzhalterzeile `features/diary/PendingAnalysisRow.tsx` für jedes
  Foto ohne Ergebnis; ein Foto, das auf Verbindung warten musste (`deferred`), wird nach der Analyse von
  `logDeferred` selbst eingetragen (erster Treffer je Zutat, Gramm des Modells) und meldet das mit einem Toast.
  Offline führt "Analysieren" direkt ins Tagebuch. Eine Analyse, die sofort lief, öffnet weiter die Prüfung.
  Nachtrag nach Rückmeldung: die Platzhalterzeile lässt sich im Tagebuch per Wischen löschen (mit Rückgängig),
  eine fehlgeschlagene Analyse hat dort den Textlink "Wiederholen". Eine analysierte Mahlzeit ist immer eine
  Gruppenzeile (Name, Foto, Gruppen-Editor), auch mit nur einer Zutat (`groupDiaryEntries`).
- Nebenbei gefunden: Das Wheel meldet sein Anhalten über State und Effekt statt direkt aus dem Timer, sonst
  konnte ein veralteter Callback eine gleichzeitige Änderung (Foto im Meal-Editor) überschreiben.

## Teil B: Mockups

Eine Datei `docs/plans/2026-10-feedback-runde-8-mockup.html` im Stil der bisherigen Mockups (Handy-Rahmen,
hell/dunkel, App-Tokens, Versionshinweis "Neu gegenüber vX"), **funktionsfähig** (echte Interaktion, damit man
das Gefühl am iPhone prüfen kann). Jede Variante zweimal: Lebensmittelseite (Gramm, z. B. Haferflocken 60 g)
und Zutat mit Portion (z. B. 1,5 × Scheibe). Alle Varianten ohne −/+, Portionen im 0,5er Raster, Dropdown nur
mit sinnvollen Einheiten.

Startvarianten:

- **A: Lineal** wie `TapeMeasure`: endlos ziehbar, kein Bereich, keine "Startmenge", Raster 1 g bzw. 0,5.
- **B: Zahl im Mittelpunkt**: großes Feld mit Ziffernblock plus Schnellwahl-Chips (zuletzt benutzt, ½, 1, 1½, 2
  bzw. 50/100/150/200 g), kein Slider.
- **C: Fester Slider**: Bereich hängt nur an der Einheit, nicht an der Menge (z. B. 0 bis 500 g, 0 bis 5
  Portionen), größere Werte nur per Feld; nichts springt mehr um.
- **D: Wheel im iOS-Stil**: Spalte Anzahl, Spalte Einheit in einem Sheet.

Unter jeder Variante: 2 bis 3 Zeilen Vor- und Nachteile aus der Recherche, am Ende eine Empfehlung.

## Teil C: Implementierung (nach der Mockup-Entscheidung)

Die Blöcke 1 und 2 beschreiben den Stand für den heutigen Slider; ersetzt die gewählte Variante den Slider,
werden sie darin aufgehen. Block 3 ist unabhängig davon.

### Block 1: Portionen in 0,5er Schritten

`apps/web/src/lib/amounts.ts`

- `amountStep('portion')` → 0,5 (Slider-Raster, kleinste Slider-Menge 0,5).
- `sliderRange`: Ende auf das Raster aufrunden (Start 1,25 → Ende 2,5), mindestens 1.
- Raster und Genauigkeit trennen: `convertAmount` rundet Portionen weiter fein (2 Nachkommastellen) statt aufs
  Raster, sonst würde ein Einheitenwechsel die Gramm verändern (30 g → Schale wären 0,5 × 300 g). Getippte Werte
  bleiben wie bisher frei (1,25).
- Anzeige: `tick`/Skala in `AmountEditor.tsx` zeigt bis zu zwei Nachkommastellen (über `lib/format.ts`).
- Tests `apps/web/test/lib.test.ts` anpassen (Raster 0,5, Umrechnung behält Gramm).

### Block 2: − und + entfernen

`apps/web/src/components/AmountEditor.tsx`

- `stepButton`, `startHold`/`endHold`/`stepBy`, `HOLD_*`, Imports (`Minus`, `Plus`, `Button`, `useRef`,
  `PointerEvent`) löschen; Zeile wird Feld + "= X g".
- Kommentare in `AmountEditor.tsx`, `lib/amounts.ts`, `hooks/useSliderStart.ts` bereinigen ("−/+ beyond the end").
- `apps/web/e2e/meals-goals.spec.ts` (nutzt den Button "Weniger") auf Feld oder Slider-Tastatur umstellen;
  `apps/web/test/components.test.tsx` prüfen.

### Block 3: Nur sinnvolle Einheiten

`packages/shared/src/foods.ts`

- Neue reine Funktion `householdPortionsFor(food)`; `portionsFor` nimmt zusätzlich `name`, `source`,
  `sourceId` (alle optional) und hängt nur noch deren Ergebnis an statt aller `HOUSEHOLD_PORTIONS`.
- Regeln (Reihenfolge: Einheit, BLS-Buchstabe aus `sourceId`, sonst Namenswörter):
  - `unit: 'ml'` oder BLS N/P: TL, EL, Tasse, Glas, Becher.
  - Q (Fette, Öle), R (Würzmittel, Saucen): TL, EL.
  - S: TL, EL nur bei Zucker, Honig, Konfitüre, Sirup, Creme; sonst nichts.
  - M: Löffelbares/Trinkbares (Milch, Joghurt, Quark, Sahne, Kefir ...) EL, Glas, Becher; Käse nichts.
  - C (Getreide, Flocken, Müsli, Reis), H: EL, Schale.
  - X, Y (Gerichte, Suppen): EL, Schale; Suppe/Eintopf zusätzlich Tasse.
  - B, D, E, F, G, K, T, U, V, W (Brot, Backwaren, Obst, Gemüse, Fleisch, Fisch ...): keine Haushaltsmaße.
  - Ohne BLS-Code (OFF, eigene Lebensmittel, Zutat ohne geladenes Lebensmittel): dieselben Wortlisten auf den
    Namen; kein Treffer = keine Haushaltsmaße.
- Immer angeboten bleiben: Gramm/Milliliter, eigene Portionen, Hersteller-Portion (OFF), "+ Eigene Portion
  anlegen…" und die aktuelle Portion eines alten Eintrags (`editorPortions` in `lib/amounts.ts` macht das schon).
- Aufrufer geben den Namen mit: `features/foods/FoodLogPage.tsx`, `features/ai/PhotoPage.tsx`,
  `features/meals/IngredientCard.tsx` (Fallback ohne Lebensmittel: `{ portions: [], unit, name: item.name }`).
- Tests in `packages/shared/test/foods-csv.test.ts`: Toastbrot ohne Tasse, Olivenöl mit EL, Apfelsaft mit Glas,
  Haferflocken mit Schale, OFF-Produkt nur per Name, eigene Portion bleibt vorn.

### Block 4: gewählte Mengeneingabe

Inhalt nach der Mockup-Entscheidung hier ergänzen (weiter eine Komponente `AmountEditor`, `onChange` live /
`onCommit` final, Entwürfe nur bei Commit).

### Block 5: Offline-Analyse steht schon im Tagebuch

Heute liegt ein offline aufgenommenes Foto nur in der Warteschlange auf `/photo` (`aiQueue`, `QueueRow` in
`features/ai/PhotoPage.tsx`); im Tagebuch sieht man nichts davon. Neu: jedes Element der Warteschlange erscheint
sofort als Platzhalterzeile im Tagebuch, am Tag `item.date` in der Mahlzeit `item.meal`, ohne kcal.

- Kein neuer synchronisierter Datensatz: die Zeile wird direkt aus `aiQueue` gelesen (Foto und Warteschlange
  liegen ohnehin nur auf diesem Gerät, kein Schema- oder Sync-Eingriff). Sie zählt nicht in Tages- und
  Mahlzeitsummen und nicht als roter Punkt im `WeekStrip`.
- Neue Komponente `features/diary/PendingAnalysisRow.tsx`, eingehängt in `MealCard` unter den `DiaryRows`
  (`useLiveQuery` auf `aiQueue` für den Tag, einmal in `DiaryPage`, nach Mahlzeit verteilt). Aufbau wie eine
  Gruppenzeile: Foto (`MealPhoto` + `useAiImage`, dafür aus `PhotoPage.tsx` nach `features/ai/queue` bzw. einen
  Hook auslagern), Titel = Hinweistext oder "Foto-Analyse", Statuszeile, rechts `NO_VALUE` statt kcal.
- Status (Texte wie in `QueueRow`, gemeinsam nutzen): `pending` "Gespeichert, wird analysiert sobald du online
  bist", `analyzing` "Wird analysiert…" (Spinner auf dem Foto), `done` "N Lebensmittel erkannt, bitte prüfen",
  `failed` Fehlertext.
- Tippen: mit Ergebnis `/photo?review=<localId>`, sonst `/photo` (Warteschlange mit Erneut versuchen/Verwerfen).
  Nicht ziehbar (`DraggableRow` nur für echte Einträge); Verwerfen per `SwipeToDelete` nur, wenn sich ein Undo
  sauber machen lässt (verzögertes `discardQueueItem`), sonst bleibt Verwerfen auf `/photo`.
- Eine Mahlzeit, die nur Platzhalter enthält, wird wie eine mit Einträgen dargestellt (nicht als leer).
- Nach "Meal eintragen" im Review verschwindet das Queue-Element wie bisher, die echten Einträge ersetzen die
  Zeile.
- Tests: Komponententest (Zeile je Status, keine kcal, Summe unverändert), E2E offline: Foto aufnehmen,
  "Analysieren", Tagebuch zeigt die Zeile; online → Zeile wird "bitte prüfen".
- Kommt als eigener Abschnitt mit ins Mockup (Tagebuch mit Platzhalterzeile in den vier Status, hell/dunkel).

### Block 6: Doku

`CLAUDE.md` (Abschnitt Food amounts, AI-Warteschlange im Tagebuch), `docs/plans/2026-10-feedback-runde-8.md` auf Endstand.

## Verifikation

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm e2e` (chromium-iphone).
- Von Hand über das eigene Playwright-Skript mit Proxy :5174 (Vite :5173 gibt beim Login 403): Lebensmittelseite
  Toastbrot (Dropdown ohne Tasse/Glas), Olivenöl (TL/EL), Saft (Glas); Portion ziehen rastet auf 0,5; 30 g →
  Portion wechseln behält die Gramm; Zutat im Meal-Editor und KI-Review verhalten sich gleich; Screenshots hell
  und dunkel.
