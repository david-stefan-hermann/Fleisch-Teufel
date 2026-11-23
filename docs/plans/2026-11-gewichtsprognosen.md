# Prognosen im Gewichtsverlauf: Implementierungsplan

Implementierungsplan für eine neue Opus-5.5-Sitzung. Den Statusblock in dieser Datei pflegen.

## Status

Geplant am 2026-11-22 auf `097201a`, umgesetzt am selben Tag, Runde 2 (Darstellung AB) ebenfalls. Nicht gepusht. Push-Stand nie aus diesem Dokument
ableiten: `git fetch` + `git status -sb`.

| Block | Commit    | Inhalt                                                        |
| ----- | --------- | ------------------------------------------------------------- |
| 1     | `c94b477` | Shared: `forecastHistory` (reine Rechnung, Unit-Tests)        |
| 2     | `81d704e` | `Chart`: Strahlen (`rays`), y-Bereich, Hervorhebung am Cursor |
| 3     | `e5031cc` | Fortschritt: Schalter, Datenabfrage, Diagramm, E2E            |
| 4     | (Doku)    | Doku: `CLAUDE.md`, dieser Statusblock                         |

Abweichungen vom Plan:

- `forecastAt(f, days)` (shared) rechnet das Ende eines Strahls; `forecastHistory` gibt `estimateExpenditure` nur die
  Wiegungen des 28-Tage-Fensters.
- `ChartSeries.cursorPoint: false`: die Legenden-Serie „Prognose +N T“ zeichnete ihren Cursorpunkt am Tag des
  Cursors, obwohl der Wert zum Ende des Strahls gehört.
- Kein Deckel für „Alle“: drei Jahre synthetische Daten rechnen in etwa 60 ms (warm, 100 ms beim ersten Lauf).
- Der Schalter steht immer unter dem Diagramm, sobald der Zeitraum Wiegungen hat.
- A2 ersetzt (Nutzer, 2026-11-22): Jeder Strahl reicht bis zum Ende des Zeitraums (heute), nicht einen festen
  Horizont weit. Die x-Achse endet wie ohne Prognosen bei heute, die Legende heißt „Prognose für heute“ und nennt,
  was der Tag unter dem Cursor für heute vorhergesagt hat.

Prüfung: `pnpm lint`, `pnpm typecheck`, `pnpm test` grün; E2E `weight chart: forecasts …` und `ios-layout` grün.
Sichtprüfung mit den Demo-Daten (390 × 844, hell und dunkel, alle vier Zeiträume): Mit Schalter aus ist die
Leinwand pixelgleich zum Stand vor dem Umbau (alter und neuer Build gegen dieselbe Datenbank verglichen). Offen:
A1 (Modell).

## Context

Wunsch (Nutzer, 2026-11-22): Im Gewichtsverlauf (`/progress`) soll man sich einblenden können, was die App an
jedem Tag des Zeitraums vorhergesagt hätte. Bei 30 Tagen also: eine Prognosekurve für den Tag vor 30 Tagen
(gerechnet nur mit den Daten bis zu diesem Tag), eine für den Tag vor 29 Tagen, und so weiter bis heute. Man
sieht dann, wie sich die Vorhersage von Tag zu Tag verschoben hat und wie gut sie zu dem passt, was danach
wirklich gewogen wurde.

Stand im Code:

- `apps/web/src/features/progress/ProgressPage.tsx`: Abschnitt „Gewichtsverlauf“ mit `Chart` (uPlot): Punkte
  „Gewicht“, Linie „7-Tage-Mittel“ (`movingAverage`), gestrichelte Linie „Ziel“. Zeitraum über den Suchparameter
  `range` (7 T, 30 T, 90 T, Alle). x-Werte sind heute nur die Tage mit Wiegung.
- Eine Prognosekurve gibt es bisher nicht. Die einzige Prognose der App steht auf „Tag abschließen“
  (`CompleteDayPage.tsx`, `fiveWeekForecast`): Gewicht in fünf Wochen, wenn jeder Tag wie dieser wäre, gerechnet
  aus Netto-kcal gegen den Erhaltungsbedarf. Der Erhaltungsbedarf kommt aus den eigenen Daten
  (`estimateExpenditure`, `useExpenditure`), sonst aus der Formel (`bodyProfile` + `tdee`).
- `packages/shared/src/expenditure.ts` (`estimateExpenditure`), `forecast.ts` (`linearTrend`, `movingAverage`,
  `weightForDay`), `reports.ts` (`dailyRows`, `isCompleteDay`).

Weder Schema noch Migration noch Dexie-Version ändern sich. Es wird nichts gespeichert außer einem Schalter pro
Gerät (`localStorage`). Kein Server-Code.

### Das Modell (festgelegt)

Die Prognose des Tages D benutzt nur Tage und Wiegungen mit Datum ≤ D:

- **Start**: das 7-Tage-Mittel am Tag D (Wert von `movingAverage` an der letzten Wiegung ≤ D). So zweigt jeder
  Strahl von der Linie ab, die das Diagramm schon zeigt. Ist die letzte Wiegung älter als
  `FORECAST_MAX_WEIGHT_AGE_DAYS` (14), gibt es für D keine Prognose.
- **Steigung** (kg pro Tag): `(Netto-kcal Ø − Erhaltungsbedarf) / KCAL_PER_KG_BODY_WEIGHT`, dieselbe
  Energiebilanz wie `fiveWeekForecast`, aber mit dem Durchschnitt statt eines einzelnen Tages:
  - Netto-kcal Ø: gegessen minus angerechnetes Training und Schritte (`creditedTrainingKcal`, Einstellungen
    `addExerciseCalories`/`addStepsCalories`), gemittelt über die vollständigen Tage (`isCompleteDay` mit
    `today: D`) der `EXPENDITURE_WINDOW_DAYS` (28) Tage bis D.
  - Erhaltungsbedarf: dieselbe Kette wie auf „Tag abschließen“: `estimateExpenditure` für das Fenster bis D
    (`basis: 'data'`), sonst die Formel `tdee(bodyProfile(settings, Gewicht an D, D), activityLevel)`
    (`basis: 'formula'`, auch bei `reason: 'implausible'`). Ohne vollständiges Profil keine Prognose.
  - Für `basis: 'formula'` braucht es mindestens `FORECAST_MIN_DAYS` (7) vollständige Tage im Fenster, sonst
    keine Prognose für D.
- **Form**: eine Gerade von D bis D + Horizont. Über zwei bis vier Wochen ist die Krümmung (Bedarf sinkt mit
  dem Gewicht) kleiner als die Strichbreite.

Folge, die man kennen muss: Mit `basis: 'data'` ist die Steigung gleich dem linearen Gewichtstrend der 28 Tage
bis D (so ist der Bedarf aus eigenen Daten definiert: Zufuhr minus Trend × 7 700). Die Prognose sagt dann „es
geht weiter wie in den letzten vier Wochen“. Erst mit `basis: 'formula'` rechnet sie Zufuhr gegen Formelbedarf.
Das ist dieselbe Aussage, die „Tag abschließen“ für einen Durchschnittstag machen würde.

### Annahmen (im Plan festgelegt, bei Widerspruch melden statt still zu entscheiden)

- **A1 (Modell):** wie oben. Alternative, falls der Nutzer mehr Bewegung in den Strahlen will: Zufuhr nur der
  letzten 7 Tage gegen den Bedarf der 28 Tage („wenn du so weiter isst wie diese Woche“). Dann wäre nur der
  Parameter `intakeDays` von `forecastHistory` zu ändern; ihn deshalb von Anfang an vorsehen (Standard 28).
- **A2 (Horizont):** hängt am Zeitraum: 7 T → 7 Tage, 30 T → 14, 90 T → 28, Alle → 28. Bei eingeschalteten
  Prognosen reicht die x-Achse bis heute + Horizont, damit die Prognose von heute ganz zu sehen ist.
- **A3 (rückblickend, kein Protokoll):** Gerechnet wird aus den heutigen Datensätzen der Tage bis D, nicht aus
  einem damals gespeicherten Stand. Ein nachgetragener Eintrag, ein später abgeschlossener Tag oder ein
  geändertes Profil (Größe, Aktivität; die Einstellungen haben keine Historie) ändern auch alte Strahlen. Kein
  Speichern von Prognosen: das wäre eine neue synchronisierte Tabelle für einen kleinen Gewinn.
- **A4 (Tag D selbst):** `isCompleteDay(row, { today: D })`: der Tag D zählt nur, wenn er abgeschlossen wurde,
  genau wie die App es an diesem Tag gesehen hat.
- **A5 (Schalter):** ein `Switch` „Prognosen“ unter dem Diagramm, pro Gerät gemerkt (`ft.progress.forecasts`,
  Standard aus). Kein Erklärtext (Nutzerregel): Legende und Hervorhebung zeigen, was zu sehen ist.
- **A6 (Menge):** höchstens `MAX_RAYS` (120) Strahlen; bei mehr Tagen („Alle“) jeder n-te Tag, der
  hervorgehobene immer.

## Block 1: Shared `forecastHistory`

Neue Datei `packages/shared/src/forecastHistory.ts`, in `index.ts` exportieren. Rein, ohne Dexie.

```ts
export const FORECAST_MIN_DAYS = 7;
export const FORECAST_MAX_WEIGHT_AGE_DAYS = 14;

export interface DayForecast {
  date: ISODate; // the day the forecast was made on
  startKg: number; // 7-day mean on that day
  slopePerDay: number; // kg per day
  maintenanceKcal: number;
  netKcal: number;
  basis: 'data' | 'formula';
}

export function forecastHistory(params: {
  /** Daily rows from at least `EXPENDITURE_WINDOW_DAYS - 1` days before `from` up to `to`. */
  rows: readonly DailyRow[];
  /** All live weigh-ins (any dates). */
  weights: readonly WeightPoint[];
  from: ISODate;
  to: ISODate;
  settings: Pick<Settings, /* what bodyProfile needs */ … | 'activityLevel'> | undefined;
  creditExercise?: boolean;
  creditSteps?: boolean;
  intakeDays?: number; // default EXPENDITURE_WINDOW_DAYS (A1)
}): DayForecast[]; // one per day with a forecast, ascending; days without one are left out
```

Umsetzung:

1. `movingAverage(weights, 7)` einmal rechnen (läuft rückwärts, benutzt also nur Wiegungen ≤ ihrem Datum). Für
   jeden Tag D mit einem Zeiger die letzte Wiegung ≤ D mitführen (Zeilen und Wiegungen sind sortiert; nicht pro
   Tag neu filtern).
2. Pro Tag D in `[from, to]`: `window = rows` bis einschließlich D (`estimateExpenditure` schneidet selbst die
   letzten 28 ab), `estimateExpenditure({ rows: window, weights, creditExercise, creditSteps, today: D })`.
   Achtung: `estimateExpenditure` filtert die Wiegungen auf das Fenster, die Wiegungen nach D fallen dadurch
   weg (Test dafür schreiben, das ist der Kern der Funktion).
3. Netto-Durchschnitt: Die Mittelung über die vollständigen Tage steckt heute in `estimateExpenditure`. Als
   kleine exportierte Hilfsfunktion in `expenditure.ts` herausziehen
   (`netIntake(rows, { creditExercise, creditSteps, today }) → { intakeAvg, exerciseAvg, days }`, ungerundet) und
   in `estimateExpenditure` benutzen; das Verhalten dort bleibt gleich (bestehende Tests müssen unverändert grün
   sein). `intakeDays` schneidet das Fenster für diesen Durchschnitt.
4. Erhaltungsbedarf nach der Kette oben; `bodyProfile(settings, weightForDay(weights bis D, D), D)`. Die
   Signaturen von `bodyProfile`/`tdee` in `tdee.ts` nachlesen und `CompleteDayPage.tsx` als Vorbild nehmen (ohne
   dessen dritten Rückfall „Ziel minus geplantes Delta“).
5. Steigung über `MAX_WEEKLY_TREND_KG`-artige Grenze kappen ist nicht nötig; aber `Number.isFinite` prüfen und
   Tage ohne endliche Steigung auslassen.

Aufwand: Tage × 28, für mehrere Jahre unkritisch.

Tests (`packages/shared/test/forecast-history.test.ts`, Hilfen aus `expenditure.test.ts` wiederverwenden):

- konstante Zufuhr, linear fallendes Gewicht, genug Daten: `basis: 'data'`, Steigung ≈ Trendsteigung, Start =
  7-Tage-Mittel.
- Wiegungen und Einträge nach D ändern die Prognose von D nicht (Datensatz verlängern, Ergebnis für D gleich).
- zu wenig für die Schätzung, aber 7 vollständige Tage und Profil: `basis: 'formula'`, Steigung =
  `(netto − tdee) / 7700`.
- weniger als 7 vollständige Tage, kein Profil, letzte Wiegung älter als 14 Tage: Tag fehlt im Ergebnis.
- Tag D mit zwei Mahlzeiten, nicht abgeschlossen, zählt für D nicht, für D + 1 schon.
- Training angerechnet / nicht angerechnet verschiebt `netKcal` wie in `estimateExpenditure`.

## Block 2: `Chart` kann Strahlen

`apps/web/src/components/Chart.tsx`, allgemein gehalten (kein Wissen über Gewicht):

```ts
export interface ChartRay {
  /** ISO dates and values of both ends. */
  from: string;
  to: string;
  y0: number;
  y1: number;
}
// ChartProps
rays?: ChartRay[];
/** CSS custom properties: all rays, and the one of the day under the cursor. */
rayColor?: string; // default '--muted-foreground'
rayActiveColor?: string; // default '--primary'
```

- Strahlen und Farben wie die anderen Props über `latest.current` lesen; sie gehören nicht zur `structure`
  (neue Strahlen bauen den Plot nicht neu). Nach einer Änderung von `rays` ohne Datenänderung `u.redraw()`.
- Zeichnen im Hook `drawAxes` (nach Gitter, vor den Serien, die Strahlen liegen also unter Punkten und Linie):
  `ctx.save()`, auf `u.bbox` clippen, alle Strahlen mit 1 px (× `devicePixelRatio`) und `globalAlpha` etwa 0,35
  in `rayColor`; danach den aktiven Strahl mit 2 px, gestrichelt `[4, 4]`, voller Deckkraft in `rayActiveColor`.
  Positionen mit `u.valToPos(xOf(date), 'x', true)` / `u.valToPos(y, 'y', true)`.
- Aktiver Strahl: der, dessen `from` der Tag unter dem Cursor ist (`xs[u.cursor.idx]`), ohne Cursor der Tag
  von `lastIndex(u.data)` (wie die Legende). Im `setCursor`-Hook den zuletzt gezeichneten Index merken und nur
  bei einem Wechsel `u.redraw(false)` aufrufen (nicht bei jeder Mausbewegung). Prüfen, dass `redraw` im
  `setCursor`-Hook keine Schleife auslöst; sonst über `requestAnimationFrame` entkoppeln.
- y-Bereich: die Strahlenenden müssen hinein. Die y-`range`-Funktion immer setzen (heute nur mit `yRange`):
  ohne festes `yRange` `min`/`max` um die y-Werte der Strahlen erweitern und mit `uPlot.rangeNum(lo, hi, 0.1,
true)` auffüllen (das ist uPlots eigene Auffüllung, das Bild ohne Strahlen darf sich nicht ändern: mit einem
  Screenshot vor und nach dem Umbau prüfen). `hasYRange` entfällt dann als Abhängigkeit des Aufbaus.
- Die versteckte Tabelle bleibt, wie sie ist; die Prognose kommt als Legenden-Serie hinein (Block 3).
- Farben: vor der Wahl den Skill `dataviz` laden und Deckkraft und Farben in hell und dunkel prüfen (Regel aus
  `CLAUDE.md`: Text in Tintentönen, eine y-Achse). Die Vorgaben oben sind der Ausgangspunkt, kein Dogma: die
  7-Tage-Linie muss die deutlichste Marke bleiben.

Test in `apps/web/test/components.test.tsx` nur, wenn dort schon `Chart` gerendert wird (uPlot braucht Canvas);
sonst deckt die E2E-Prüfung aus Block 3 das ab.

## Block 3: Fortschrittsseite

1. **Schalter**: `src/lib/appearance.ts` hält schon Geräte-Einstellungen (`ft.weekStrip`). Für diesen einen
   Schalter kein Eintrag unter „Aussehen“: ein kleiner Hook in `features/progress/forecastPref.ts`
   (`useForecastPref(): [boolean, (on: boolean) => void]`, `localStorage` `ft.progress.forecasts`, mit try/catch
   und `useSyncExternalStore` nach dem Muster in `appearance.ts`). Unter dem Diagramm eine Zeile mit `Label`
   „Prognosen“ und `Switch` (`components/ui/switch.tsx`), nur wenn es Wiegungen im Zeitraum gibt.
2. **Daten**: `apps/web/src/hooks/useForecastHistory.ts` nach dem Vorbild von `useExpenditure.ts` (dieselben
   Abfragen, `mealRecordsFor`, `dailyRows` mit `notes`), aber für `[from − 27 Tage, today]`, und nur wenn der
   Schalter an ist (sonst gibt die Abfrage sofort `[]` zurück und liest nichts). Ergebnis: `DayForecast[]` für
   `[from, today]`. Bei „Alle“ ist `from` die erste Wiegung; die Abfrage liest dann das ganze Tagebuch, das
   ist für die Jahre eines Nutzers vertretbar, aber mit den Demo-Daten und einer künstlich verlängerten
   Datenbank einmal messen (über 300 ms: `from` für die Prognosen auf heute − 365 Tage begrenzen).
3. **Diagramm** (`ProgressPage.tsx`, die `useMemo`-Rechnung in eine reine Funktion
   `features/progress/weightChart.ts` ziehen, damit sie testbar ist):
   - Horizont aus dem Zeitraum (A2): `RANGES` um `horizon` ergänzen.
   - Mit Schalter an sind die x-Werte alle Tage von `from` bis heute (nicht nur Wiegetage), „Gewicht“ und
     „7-Tage-Mittel“ an Tagen ohne Wiegung `null` (die Linie überbrückt Lücken schon, `spanGaps`), „Ziel“ an
     jedem Tag. So hat jeder Tag einen Cursor-Index und damit seinen Strahl. Mit Schalter aus bleibt alles wie
     heute (gleiche Daten, gleiche Serien, kein Neuaufbau beim Laden).
   - `rays`: pro `DayForecast` `{ from: date, to: addDays(date, horizon), y0: startKg, y1: startKg +
slopePerDay * horizon }`, auf `MAX_RAYS` ausgedünnt (A6; der Chart hebt hervor, was es gibt: beim
     Ausdünnen den letzten Tag immer behalten).
   - Legenden-Serie `{ label: 'Prognose +14 T', color: '--primary', kind: 'legend', format: kg }` (Zahl = der
     Horizont) mit `y1` des Tages, `null` ohne Prognose. Die Legende zeigt so beim Tippen auf einen Tag, wo die
     App das Gewicht damals nach dem Horizont gesehen hat, und ohne Tippen die Prognose von heute.
   - `xRange`: `[from, addDays(today, horizon)]`, sobald es mindestens einen Strahl gibt, sonst wie heute.
   - `flat`-Sonderfall (alle Werte gleich): die Strahlenenden mitzählen.
   - `title` des Diagramms um „und Prognosen der einzelnen Tage“ ergänzen, wenn an.
4. **Leerer Fall**: Schalter an, aber kein Tag hat eine Prognose (zu wenig Daten): das Diagramm bleibt wie
   ohne Prognosen. Kein Hinweistext; die `ExpenditureCard` darüber sagt schon, was fehlt.
5. **Tests**:
   - `apps/web/test/lib.test.ts` oder neue Datei: `weightChart` (x-Werte mit und ohne Schalter, Strahlen,
     Ausdünnen, Legendenwert, `xRange`).
   - E2E (`diary-training.spec.ts` hat die `/progress`-Tests, dort anhängen): Daten für 30 Tage anlegen (je
     Tag zwei Mahlzeiten und eine Wiegung; vorhandene Helfer der Spec benutzen), Schalter „Prognosen“
     einschalten, die versteckte Tabelle hat die Spalte „Prognose +14 T“ mit einem Wert für heute, nach
     Reload ist der Schalter noch an, ausschalten entfernt die Spalte. `ios-layout.spec.ts`: die Seite passt
     mit Schalter weiter ohne seitliches Scrollen.

## Block 4: Doku

- `CLAUDE.md`: im Punkt „Charts“ die Strahlen (`rays`, im `drawAxes`-Hook, aktiver Strahl folgt dem Cursor)
  ergänzen; neuer Punkt „Prognosen im Gewichtsverlauf“ (Modell in drei Sätzen, `forecastHistory`,
  `useForecastHistory`, `ft.progress.forecasts`, A3 „rückblickend aus heutigen Daten“).
- Statusblock dieser Datei, Abweichungen und Prüfung wie in den Plänen der Runden 12 und 13.

## Verifikation

- Nach jedem Block: `pnpm lint`, `pnpm typecheck`, `pnpm test`; am Ende `pnpm e2e`.
- Sichtprüfung mit den Demo-Daten (`pnpm --filter @ft/api seed:demo`, 6 Wochen; Login-Hinweis: Screenshots
  per eigenem Playwright-Skript über den Proxy, siehe Memory „Dev-Proxy-Login“), 390 × 844, hell und dunkel,
  alle vier Zeiträume, Schalter an und aus. Zu prüfen:
  - Schalter aus: Diagramm pixelgleich zu vorher (y-Bereich, Block 2).
  - Die Strahlen zweigen von der 7-Tage-Linie ab, die Linie und die Punkte bleiben klar lesbar.
  - Tippen auf einen Tag hebt dessen Strahl hervor und die Legende nennt Datum und Prognosewert.
  - Bei 7 T und 30 T bleibt genug Platz für die Vergangenheit (A2); sonst Horizont kürzen und melden.
- Screenshots (30 T, hell und dunkel, an) dem Nutzer zeigen, bevor gepusht wird: es gab kein Mockup, das Bild
  ist die Abnahme. Dabei A1 (Modell) und A2 (Horizont) ansprechen.
- Nicht pushen ohne Auftrag.

## Runde 2: Darstellung AB (Mockup v2)

Der Nutzer fand die Strahlen (Stand `1c77636`) optisch schlecht. Mockup `2026-11-gewichtsprognosen-mockup.html`
v2, gewählt am 2026-11-22: **AB**, Zeitreise im Erwartungsband. Entscheidungen:

- Es gibt keine Strahlen mehr. Mit eingeschaltetem Schalter liegt das **Erwartungsband** im Hintergrund: für jeden Tag
  die Spanne dessen, was die Prognosen der 14 Tage davor für ihn vorhergesagt haben (`expectedRange`).
- Ein **gewählter Tag** (Standard heute; Regler unter dem Diagramm oder Tipp ins Diagramm) zeigt seine Prognose
  als simulierte Linie mit Band (80 %, `1,28 × √(σ² + (SE × h)²)`) bis heute, am heutigen Tag 14 Tage nach vorn.
  Gewichte und 7-Tage-Mittel nach dem gewählten Tag werden blass.
- **Simulierte Schwankung** (Nutzer: die rohe Streuung der Wiegungen ist viel zu unruhig): geschätzt aus der
  geglätteten echten Kurve, dem 7-Tage-Mittel der 28 Tage bis D minus seiner Trendgeraden: Streuung σ und
  Lag-1-Autokorrelation φ (0 bis 0,95). Daraus ein AR(1)-Weg um den Trend, deterministisch mit dem Datum als
  Startwert (`simulateForecast`).
- Legende: Datum, Gewicht, 7-Tage-Mittel, Ziel, „Erwartet: a bis b kg“, „Prognose: x kg für heute“ (am heutigen
  Tag „für <Datum + 14>“). Sie zeigt den gewählten Tag, nicht den neuesten.
- C, D, E des Mockups v1 abgelehnt. Das Modell (A1) bleibt.

Umgesetzt am 2026-11-22. Abweichungen: Der Regler steht unter der Legende (uPlot rendert die Legende direkt unter
dem Diagramm); die Prognose nennt den Trendwert, nicht das Ende der simulierten Linie; das Erwartungsband ist
um 0,1 kg je Seite verbreitert, damit ruhige Wochen keine Haarlinie zeichnen; uPlots Cursorlinie ist mit
Prognosen aus, die Tagesmarke ersetzt sie (sie rastet auf dem Tag ein).

## Runde 3: Durchgetestet und neu gebaut (2026-11-23)

Der Nutzer fand die Umsetzung von Runde 2 auf dem iPhone „quasi nicht benutzbar“. Touch-Test (iPhone-Emulation,
echte Touch-Ereignisse) ergab: Wischen über das Diagramm wählte keinen Tag (uPlot kennt kein Touch-Scrubben);
nach einem Tipp blieb uPlots Cursor stehen, Regler und Legende zeigten verschiedene Tage, die Legende Striche;
die Legende war fünf Zeilen hoch; Bänder, Prognose und blasse Linie im selben Rot; der gewählte Tag blieb über
Zeiträume hängen; bei 7 T zwei Drittel Zukunft; der Regler unter der Legende; bei 90 T ein leeres Drittel.

Umbau: eigenes SVG-Diagramm `ForecastChart` nur für eingeschaltete Prognosen (Pointer-Events, `touch-pan-y`),
Regler direkt darunter, Legende mit drei festen Zeilen (Mittel des letzten Wiegetags, nie leer), Farbe
`--forecast` aus dem Mockup, feste y-Achse je Zeitraum, Achse ab der ersten Wiegung, 7 Tage Zukunft bei 7 T, der
gewählte Tag gilt nur in seinem Zeitraum. `Chart` (uPlot) ist wieder auf dem Stand vor den Prognosen.

## Runde 4: wieder eine Gerade (2026-11-23)

Nutzer nach dem Test auf dem iPhone: die simulierte Schwankung wirkt komisch, die Prognose soll wieder eine
Gerade sein, mit Erwartungsbereich. Die Prognose des gewählten Tages ist jetzt eine gerade Linie in ihrem
80-%-Band; `simulateForecast` und die Autokorrelation entfallen, die Streuung des 7-Tage-Mittels um seinen Trend
(`curveSpread`) bestimmt weiter die Breite des Bandes am Anfang.

## Runde 5: zweites Diagramm zum Aufklappen (2026-11-23)

Nutzer: Fehler im Bild (Tipp ins Gewichtsdiagramm: Loch in der Linie, Cursorlinie neben den Punkten), Regler weg
(die Hand genügt), Prognose als zweites Diagramm unter „Prognose“ zum Aufklappen, Gewichtseinträge auf die
letzten 7 begrenzt, der Rest aufklappbar. Umgesetzt: uPlot-Cursor rastet auf dem Tag ein, Cursorpunkte gefüllt;
das Gewichtsdiagramm bleibt immer, „Prognose“ (`DisclosureTrigger`, gemerkt in `ft.progress.forecasts`) öffnet
`ForecastChart`; das Diagramm ist selbst der Schieber (`role=slider`, Pfeiltasten); „Ältere Einträge (N)“ klappt
die übrigen Einträge auf (darin weiter in Schritten von 60).

## Mockup v3 (2026-11-23)

Auf Wunsch des Nutzers beschreibt `2026-11-gewichtsprognosen-mockup.html` jetzt als v3 den umgesetzten Stand
vollständig: die ganze Seite, Gewichtsdiagramm mit Cursor, Prognose mit heute und mit einem vergangenen Tag, alle
Zeiträume, Sonderfälle (zu wenig Daten, Tag ohne Prognose, Beginn des Erwartungsbands), Einträge zu und auf,
dazu Bedienung, Zeichenregeln, Legende und Rechnung als Tabellen. Bedienbar, mit derselben Rechnung wie die App.
