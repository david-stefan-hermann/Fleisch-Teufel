# Prognosen im Gewichtsverlauf: Implementierungsplan

Maßgeblich für das Prognosediagramm ist das Mockup `docs/plans/2026-11-gewichtsprognosen-mockup-v9-geglaettet.html`
(v9, 2026-11-23, nur dunkel skizziert; hell mit denselben Tokens). Für alles andere auf der Seite (Gewichtsdiagramm,
Zeile „Prognose“, Einträge) gilt weiter Mockup v4 `docs/plans/2026-11-gewichtsprognosen-mockup.html`. Wo Plan und
Mockup sich widersprechen, gilt das Mockup; den Widerspruch melden statt still zu entscheiden. Den Statusblock in
dieser Datei pflegen.

## Status

Geplant am 2026-11-22 auf `097201a`. Gebaut in fünf Runden bis `501a300`, Mockup v4 am 2026-11-23. Danach
Feedback auf die Bänder („überhaupt nicht logisch herzuleiten“) und Mockups v5 bis v9 am 2026-11-23; v9 vom Nutzer
zur Umsetzung freigegeben („lass uns das so umsetzen“), Runde 6 dieses Plans, am selben Tag umgesetzt (alle
Prüfungen grün, Sichtprüfung und Touch-Test mit einem 90-Tage-Testnutzer; die Demo-Daten tragen zu wenig kcal ein,
um den Bedarf sinnvoll zu zeigen). Abnahme auf dem iPhone offen. Nicht gepusht. Push-Stand nie aus
diesem Dokument ableiten: `git fetch` + `git status -sb`.

| Stand             | Commit    | Inhalt                                                                           |
| ----------------- | --------- | -------------------------------------------------------------------------------- |
| Rechnung          | `c94b477` | Shared `forecastHistory` (wird durch Runde 6 ersetzt)                            |
| Runde 1, Strahlen | `81d704e` | `Chart` mit Strahlen, Schalter (verworfen, wieder ausgebaut)                     |
|                   | `e5031cc` |                                                                                  |
|                   | `1c77636` |                                                                                  |
| Runde 2, AB       | `41870ce` | Erwartungsband und Zeitreise in uPlot (verworfen: per Touch nicht bedienbar)     |
| Runde 3           | `9dafcfa` | Eigenes SVG-Diagramm `ForecastChart`, `Chart.tsx` zurück (bleibt)                |
| Runde 4           | `d8c76c6` | Prognose als Gerade im 80-%-Bereich (wird durch Runde 6 ersetzt)                 |
| Runde 5           | `501a300` | Zweites Diagramm unter „Prognose“, kein Regler, Einträge gekürzt (bleibt)        |
| Mockup v3, v4     | `387f360` | v4 nicht committet: Abgleich mit dem App-Design                                  |
| Mockups v5 bis v9 | offen     | v5 Bereich aus Treffern, v6 Wochentage, v7 Kalman, v8 mit kcal, v9 freigegeben   |
| Runde 6           | offen     | Umgesetzt 2026-11-23, nicht committet: Modell, Diagramm nach v9, zwei Restpunkte |

## Worum es geht

Wunsch (Nutzer, 2026-11-22): Im Gewichtsverlauf (`/progress`) sehen, was die App an jedem Tag des Zeitraums
vorhergesagt hätte, gerechnet nur mit den Daten bis zu diesem Tag. Feedback 2026-11-23: die Prognose reicht immer
bis zum rechten Rand; der Bereich muss sich herleiten lassen; „Kalorien MÜSSEN mit rein“; die Prognose ist eine
Kurve, keine verbundenen Punkte, mit leichter Glättung.

Ergebnis:

- Gewichtsdiagramm (uPlot), Zeile „Prognose“ zum Aufklappen und Einträge bleiben wie gebaut (Mockup v4).
- Das Prognosediagramm zeigt ein Zeitreihenmodell (Kalman-Filter) mit Niveau, gelerntem Bedarf und
  Wochentagseffekt, gespeist von Wiegungen und eingetragenen Kalorien. Die Prognose des gewählten Tages läuft bis
  zum rechten Rand (heute plus 14 Tage, bei 7 T plus 7), in einem glatten Fächer, dessen äußerer Teil per
  Rückrechnung auf 80 % nachjustiert ist.

Weder Schema noch Migration noch Dexie-Version ändern sich. Kein Server-Code.

## Entscheidungen des Nutzers (2026-11-23)

- In die App: Kalorienstreifen, Trefferquote als Text, Trefferbalken nach Abstand, gestrichelte Linie „Ohne
  Kalorien“ (alles wie v9).
- Die Karte „Bedarf aus deinen Daten“ bleibt vorerst, wie sie ist; die Prognose zeigt ihren gelernten Bedarf in
  der Legende. Zwei Zahlen, die abweichen dürfen; die Karte umzustellen ist ein eigener späterer Schritt.
- Vergessene Tage werden behoben (in v9 nachgetragen und an den drei Datensätzen geprüft): ein Tag ohne
  vollständige Einträge in einer Lücke unter 3 Tagen zählt mit dem eigenen Durchschnitt der letzten 28
  eingetragenen Tage; längere Lücken zählen als Bedarf mit großer Unsicherheit.

## Das Modell (Runde 6, neu)

Neue Datei `packages/shared/src/weightModel.ts` (rein, ohne Dexie), Tests `packages/shared/test/weight-model.test.ts`.
Ersetzt `forecastHistory.ts` samt Tests (`forecastHistory`, `forecastSpread`, `expectedRange`, `curveSpread`,
`forecastAt`, `EXPECTED_LOOKBACK_DAYS`, `FORECAST_*`); `estimateExpenditure` und die Karte bleiben unberührt.

Eingabe: eine Zeile pro Kalendertag vom ersten bis zum letzten Tag (heute) mit

- `kg`: Wiegung des Tages (mehrere: der Mittelwert), sonst null;
- `kcal`: Netto-kcal eines vollständigen Tages (`isCompleteDay` mit `today`): gegessen minus angerechnetes Training
  und Schritte (`creditedTrainingKcal` nach den Einstellungen), sonst null;
- dazu der Startwert des Bedarfs: Formel `tdee(bodyProfile(...))` an der ersten Wiegung, ohne Profil der
  Durchschnitt der ersten 28 eingetragenen Tage, sonst 2 000 kcal; Unsicherheit 250 kcal.

Zustand `[Niveau kg, Bedarf kcal, g1..g6]` (Wochentag als Dummy-Saison, der siebte = minus Summe). Übergang von Tag
t zu t + 1:

- eingetragen: Niveau += (kcal_t − Bedarf) / 7 700;
- vergessen (Lücke < `GAP_DAYS` 3, mit Geschichte): wie eingetragen mit dem Mittel der letzten `EAT_DAYS` (28)
  eingetragenen Tage, dessen Streuung als zusätzliches Rauschen des Niveaus;
- sonst (lange Lücke, keine Geschichte): Niveau bleibt, Rauschen (`MISSING_SD` 600 kcal / 7 700)²;
- immer: Rauschen Niveau `ql`², Bedarf `qb`², Wochentag `qg`².

Beobachtung: Wiegung = Niveau + Wochentagseffekt + Rauschen `obs`². Die vier Parameter per größter
Wahrscheinlichkeit auf einem Gitter (`obs` 0,2/0,3/0,4/0,5; `ql` 0,01/0,02/0,03; `qb` 2/5/10/20; `qg`
0,005/0,02/0,05), gerechnet über die letzten `FIT_DAYS` (180) Tage, Wiegungen der ersten 14 Tage nicht im Maß.

Prognose ab Tag d (nur der gefilterte Zustand an d, also nur Daten bis d), h = 0 bis H Tage:

- Essen danach: Mittel und Streuung der letzten 28 eingetragenen Tage bis d („so weiteressen wie zuletzt“);
- je Tag: `kg` (Niveau + Wochentag), `show` (kg geglättet: ¼ Vortag, ½ Tag, ¼ Folgetag), `level`, `levelSd`
  (Niveau), `obsSd` = √(levelSd² + obs² + Streuung der Wochentagseffekte an d), `maintenance`;
- erst ab `FIRST_FORECAST_DAYS` (21) Tagen nach der ersten Wiegung; keine Prognose, wenn die letzte Wiegung bis d
  älter als 14 Tage ist.

Rückrechnung: für jeden Tag d der letzten 180 Tage mit Prognose jede Wiegung 1 bis 14 Tage danach (bis heute):
z = |Wiegung − level| / obsSd. Faktor = 80. Perzentil der z (statt 1,28); ohne mindestens 20 Prüfungen 1,28.
Ergebnis: Faktor, Anzahl, Trefferquote ungeprüft (z ≤ 1,28), Trefferquote nachjustiert je Abstand 1 bis 14.

„Ohne Kalorien“: dasselbe Modell im Modus `trend` (Zustand `[Niveau, Steigung kg/Tag, g1..g6]`, Niveau +=
Steigung, keine kcal; Gitter für die Steigung 0,0005/0,001/0,003/0,01) mit eigener Rückrechnung.

## Die Seite (Runde 6)

- `apps/web/src/hooks/useWeightModel.ts` (ersetzt `useForecastHistory.ts`): liest ab der ersten Wiegung bis heute
  Tagebuch, Training, Wiegungen, Ziele, Notizen, Einstellungen, baut `dailyRows` und rechnet beide Modelle; liest
  nichts, solange „Prognose“ zu ist.
- `features/progress/forecastChart.ts` (rein): Achse vom ersten Tag des Zeitraums mit Wiegung bis heute plus
  `aheadDaysFor`; feste y-Achse je Zeitraum aus Wiegungen, Niveau und dem äußeren Fächer der heutigen Prognose;
  was ein vergangener Tag darüber hinaus zeichnet, wird abgeschnitten. `dayView`: Prognose des gewählten Tages bis
  zum rechten Rand.
- `features/progress/ForecastChart.tsx` nach v9, Ebenen von hinten: Gitter, äußerer Fächer (`--forecast` 15 %),
  innerer Fächer (30 %), „Ohne Kalorien“ gestrichelt (`--muted-foreground`, 1,3 px), Niveau (`--primary` 2,5 px,
  nach dem gewählten Tag 30 %), Prognose (`--forecast` 2 px, `show`), Wiegungen (nach dem Tag 35 %), Linie des
  Tages, Punkt auf dem Niveau. Kurven als Catmull-Rom (kubische Bézier), nicht als Polylinie; Fächer glatt auf dem
  Niveau. Heute als feine senkrechte Linie (`--border`). Keine Ziellinie (v9 hat keine).
- Kalorienstreifen darunter (84 px, gleiche x-Achse): Balken der eingetragenen Netto-kcal, Bedarf (`--primary`)
  bis zum gewählten Tag, danach blass waagerecht, angenommenes Essen gestrichelt (`--forecast`).
- Legende (feste Zeilen): Tag; Gewogen; Niveau; Bedarf (gelernt); Gegessen Ø 28 T; Prognose <Datum>
  (Niveau am Ende); Kurve (80 %); Wiegung (80 %); Ohne Kalorien. Darunter „Treffer nach Abstand (N Prüfungen)“ mit
  14 Balken und der 80-%-Linie, darunter „Mit Kalorien: ungeprüft X % getroffen, Faktor Y. Ohne Kalorien: X %,
  Faktor Y.“ (Angaben über die Daten).
- Tag wählen wie bisher (Tippen, waagerecht wischen, Pfeiltasten, Pos1, Ende), nur Tage mit Prognose.
- Tabelle für Screenreader: Datum, Niveau, Prognose für das Enddatum.

## Restpunkte aus v4 (mit Runde 6)

1. Cursorlinie des Gewichtsdiagramms in `--muted-foreground`: `.ft-chart .u-cursor-x { border-right-color:
var(--muted-foreground); }` in `index.css` (gilt für alle uPlot-Diagramme, gewollt).
2. Zeile „Prognose“ mit `text-sm` (`DisclosureTrigger className="min-h-11 text-sm font-semibold"`).

Danach `CLAUDE.md` (Absatz „Forecasts under the weight chart“ neu) und dieser Statusblock.

## Was es nicht gibt (nicht wieder einbauen)

- Strahlen aller Tage gleichzeitig (Runde 1), Prognose im uPlot-Diagramm (Runde 2), eine simulierte
  Schwankungslinie (Runde 2), Regler, Schalter, Erklärtexte.
- Das Erwartungsband „Erwartet“ (Hülle der Prognosen der 14 Tage davor) und den Bereich aus Kurvenschwankung plus
  Trendfehler (v4): „nicht logisch herzuleiten“.
- Die Hülle aller Tageskurven als Bereich (v6), Zacken nur in der ersten Woche (v9 erster Stand).

## Verifikation

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm e2e` (Spec `weight chart: forecasts …`, `ios-layout`).
- Rechenzeit des Modells auf den Demo-Daten messen (Ziel unter 200 ms auf dem Desktop).
- Sichtprüfung gegen v9 mit den Demo-Daten (`pnpm --filter @ft/api seed:demo`), 390 × 844, hell und dunkel, alle
  vier Zeiträume, ein vergangener Tag gewählt.
- Bedienung mit echten Touch-Ereignissen (Chromium mit iPhone-Emulation, CDP `Input.dispatchTouchEvent`).
- Abnahme durch den Nutzer auf dem iPhone, erst danach pushen.
