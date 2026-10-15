# Lebensmittelsuche: Befund und Umbau

## Context

Die Suche auf `/add` (und dieselbe Funktion im KI-Werkzeug `search_foods`) liefert für die häufigsten
Alltagsanfragen keine oder falsche Spitzentreffer. Getestet wurde `packages/shared/src/search.ts` direkt
gegen die vollen 7.140 BLS-Einträge (`apps/web/public/data/bls-compact.json`) mit 60 typischen Anfragen.
Ziel: die ersten drei Treffer sind bei Alltagsanfragen das, was man meint (Grundnahrungsmittel oder das
Markenprodukt), Tippfehler und Umlaut-Schreibweisen stören nicht, gegessene Lebensmittel und Meals stehen
oben, Markenprodukte (Open Food Facts) laufen gleichberechtigt im Relevanz-Ranking mit, die Zeile zeigt
die Standardportion.

### Was heute schlecht ist (gemessen)

| Anfrage                                                  | Heute oben                                                                          | Erwartet                                                                 | Ursache                                                                                                                                                                                                                                                   |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ei`, `eier`                                             | Ei-Einlauf, Eisbergsalat, Eier-Frischteigwaren                                      | Hühnerei roh                                                             | Nur Wortanfang-Präfix; Kopf eines Kompositums (…ei) zählt nichts; keine Mehrzahl; kein Synonym                                                                                                                                                            |
| `brot`                                                   | Brotfrucht, Brotaufstrich, Brotsuppe                                                | Vollkornbrot, Roggenmischbrot, Weizenbrot                                | Deutsche Komposita tragen den Kopf am Ende (`…brot`); Teilstring zählt nur 8 statt 20 Punkte                                                                                                                                                              |
| `öl`, `quark`, `salat`, `käse`                           | Quark-Öl-Teig, Quark-Plunder, Salat aus Eierteigwaren, Käse-Grießnockerl            | Olivenöl, Speisequark, Kopfsalat, Gouda/Emmentaler                       | Wie oben, plus: bei Bindestrich-Namen („Käse-Grießnockerl“) ist das erste Wort nur Bestimmungswort, bekommt aber den größten Positionsbonus und den +25 „Name beginnt mit Anfrage“-Bonus                                                                  |
| `joghurt`, `linsen`, `paprika`, `hackfleisch`, `tomaten` | Joghurt-Dip, Linsen-Bolognese, Paprika-Gurken-Tomatensalat, Hackfleisch-Kohlpudding | Joghurt 3,5 %, Linsen roh, Paprika roh, Rind Hackfleisch roh, Tomate roh | Gerichte (BLS-Gruppen X und Y, 2.050 von 7.140 Einträgen) werden nicht von Grundnahrungsmitteln unterschieden; die Wortzahl-Strafe trifft Grundnahrungsmittel mit langen Spezifikationen („mind. 3,5 % Fett, laktosefrei“) härter als kurze Gerichtsnamen |
| `kartoffeln`, `tomaten`, `nudeln`, `eier`                | Nur gekochte Gerichte bzw. nichts Passendes                                         | Kartoffel roh, Tomate roh, Teigwaren                                     | Keine Mehrzahl-/Flexionsbehandlung („kartoffeln“ ist kein Präfix von „kartoffel“)                                                                                                                                                                         |
| `kase`, `jogurt`, `hänchen`, `hühnchen`, `hühnerbrust`   | 0 Treffer                                                                           | Käse, Joghurt, Hähnchen, Hähnchen Brustfilet                             | „kase“ ohne e wird nur im Tab Eigene gefaltet; keine Tippfehlertoleranz; keine Synonyme (Huhn/Hühnchen/Hähnchen/Chicken, Nudeln/Pasta/Spaghetti/Teigwaren, Ei/Hühnerei)                                                                                   |
| `putenbrust`                                             | Kochpökelware                                                                       | Pute Brust, ohne Haut, roh                                               | Fugen-n: „putenbrust“ steckt nicht in „putebrust“                                                                                                                                                                                                         |
| `kartoffelpüree`                                         | Instantpulver                                                                       | Kartoffelpüree mit Milch                                                 | Die Trockenprodukt-Abwertung lebt nur in `apps/api/src/ai/match.ts`, nicht in der Nutzersuche                                                                                                                                                             |
| `magerquark`, `cola`, `milch`                            | Kräuterquark (aus Magerquark), Cola-Misch-Getränk Orange, Milch-Getreide-Brei       | Speisequark Magerstufe, Colagetränk, Vollmilch 3,5 %                     | Exakter Worttreffer an späterer Position verliert gegen Präfixtreffer am Anfang                                                                                                                                                                           |

Weitere Lücken:

- Gespeicherte Meals werden von der Hauptsuche nicht gefunden (nur im Tab Eigene, `filterOwn`).
- Open-Food-Facts-Treffer kommen in OFF-Reihenfolge und immer unter allen lokalen Treffern; der Nutzer
  will Markenprodukte gleichberechtigt nach Relevanz (heute ist fast alles Marke). Keine Doppelten-Erkennung
  nach Name + Marke.
- `searchLocal` indiziert eigene und gecachte Lebensmittel bei jedem Tastendruck neu (BLS-Scan selbst: 2 bis
  5 ms, unkritisch).
- Trefferzeile zeigt nur kcal pro 100 g; alle großen Tracker zeigen die Standardportion mit ihren kcal.
- Kein Hinweis „Meintest du …?“ bei Tippfehlern, keine Anzeige, wie oft etwas gegessen wurde.

### Konventionen, an denen sich der Umbau orientiert

Dokumentierte Ranking-Regeln von Suchmaschinen (Meilisearch: Wörter > Tippfehler > Nähe > Attribut >
Exaktheit) und die Praxis der Tracker (MyFitnessPal, Yazio, Cronometer, MyNetDiary, FatSecret):

1. Jedes Anfragewort muss treffen (AND), Reihenfolge egal, Präfix ab dem ersten Zeichen.
2. Exakter Worttreffer > Wortanfang > Kompositum-Kopf > Wortinneres; Treffer im Namen > Marke > Englisch.
3. Tippfehler: Abstand 1 ab 5 Zeichen, 2 ab 9 Zeichen, nur als Rückfall und schlechter bewertet.
4. Synonyme und Aliasse (Alltagsname → Datenbankname) sind Pflicht bei amtlichen Datenbanken wie BLS/USDA.
5. Beliebtheit zählt: persönliche Nutzung (zuletzt, wie oft) vor globaler Beliebtheit (OFF-Scans) vor
   lexikalischer Nähe. Grundnahrungsmittel/„verifizierte“ Einträge vor Gerichten und Varianten.
6. Leeres Feld zeigt Zuletzt/Häufig (ist schon so), Tippen zeigt sofort (150 ms, ist schon so).
7. Zeile: Name, Marke, Standardportion mit kcal, Herkunft; Nutzungs-Tag.

## Umsetzung

### 1. Matching in `packages/shared/src/search.ts`

- **Normalisierung**: zusätzlich `ae/oe/ue → a/o/u` (wie `filterOwn` in `apps/web/src/foods/foodService.ts`),
  Index und Anfrage gleich behandeln, sodass „kase“, „kaese“, „käse“ identisch sind. `filterOwn` dann auf
  die gemeinsame Funktion umstellen.
- **Stamm** (`stem`): leichte deutsche Endungskappung für Wörter ab 5 Zeichen (nen, en, er, es, e, n, s; Rest
  mindestens 3 Zeichen). Index speichert pro Wort `word` und `stem`; ein Token trifft, wenn Token-Stamm
  Präfix des Wort-Stamms ist („kartoffeln“ → „kartoffel“, „eier“ → „ei“, „tomaten“ → „tomat“).
- **Kompositum-Kopf**: ein Token trifft ein Wort auch am Ende (`w.endsWith(t)`, mit Fugen-n/-s-Toleranz:
  `w.endsWith(t)` oder `w.endsWith(t + 'n')`-Varianten über den Stamm), Gewicht wie Wortanfang (20); Wortinneres
  bleibt bei 8 ab 4 Zeichen. „brot“ findet so „vollkornbrot“, „öl“ „olivenöl“, „ei“ „hühnerei“.
- **Bindestrich-Namen**: `indexItem` merkt sich aus dem Originalnamen, welche Wörter Teile eines
  Bindestrich-Kompositums sind. Positionsbonus und der „Name beginnt mit Anfrage“-Bonus (+25) gelten für
  den Kopf (letztes Teil) statt für das erste Teil; „Käse-Grießnockerl“ ist für „käse“ ein Nebentreffer.
  Zusätzlich wird das Kompositum als ein zusammengeschriebenes Wort indiziert („kaesegriessnockerl“).
- **Tippfehler**: Damerau-Levenshtein mit Vorfilter (Längendifferenz ≤ 1, gleiche Anfangsbuchstaben bis auf
  Tausch). Abstand 1 ab 5 Zeichen, 2 ab 9. Nur rechnen, wenn ein Token sonst nicht trifft; Treffer zählt 12
  und wird mit `fuzzy: true` markiert (für „Meintest du …?“). Laufzeit bleibt im einstelligen ms-Bereich,
  weil nur Tokens ohne strikten Treffer geprüft werden.
- **Synonyme** (`packages/shared/src/synonyms.ts`, gepflegte Liste, Anfrage-Erweiterung mit OR, Alias-Treffer
  zählt 0,9): Ei/Eier → Hühnerei; Nudeln/Pasta/Spaghetti/Penne/Fusilli → Teigwaren; Hähnchen/Hühnchen/Huhn/
  Hühner/Chicken; Pute/Truthahn/Turkey; Käse → Schnittkäse, Gouda, Emmentaler, Edamer; Quark → Speisequark;
  Semmel/Schrippe → Weizenbrötchen; Kartoffelbrei → Kartoffelpüree; Hack → Hackfleisch; Eiweiß/Protein; Pommes
  → Pommes frites; Toast → Toastbrot; Pilze → Champignon; Möhre/Karotte; Paprika; Zwiebel; Reis; Cola →
  Colagetränk; Milch → Vollmilch, Milch. Tests dokumentieren jede Zeile.
- **Trockenprodukt-Abwertung** aus `apps/api/src/ai/match.ts` (`DRY_WORDS`, Instantpulver, Pulver, getrocknet,
  Trockenprodukt) in die gemeinsame Bewertung ziehen (−12 statt −30, `match.ts` behält seinen Zuschlag obendrauf),
  „roh“/unzubereitet bleibt +3/+4.

### 2. Ranking

- `Searchable` bekommt `kind?: 'base' | 'dish' | 'brand'` und `popularity?: number`. BLS: `dish` für
  Gruppen X und Y (Code-Buchstabe), sonst `base`; gesetzt in `apps/web/src/foods/bls.ts` und
  `apps/api/src/foods/catalog.ts`. OFF: `brand`, `popularity` aus `unique_scans_n` (Feld in `FIELDS` von
  `apps/api/src/off/client.ts` aufnehmen; prüfen, ob Search-a-licious es liefert, sonst nur `cgi/search.pl`).
- Punkte: Gericht −12, außer die Anfrage trifft den Gerichtsnamen mit mindestens zwei Tokens oder exakt.
  Marke: kein Abzug; `popularity` als `+ min(10, log10(scans+1) * 3)`.
- Wortzahl-Strafe: Spezifikationswörter (Zahlen, `%`, `fett`, `i`, `tr`, `mind`, `max`, `frisch`, `pasteurisiert`)
  nicht zählen; Strafe 1 pro Wort, maximal 8.
- Exakter Worttreffer irgendwo im Namen (30) schlägt Präfix am Anfang (20 + Position); Positionsbonus auf
  maximal +4 senken.
- Tie-Break: Grundzustand zuerst (BLS-Code endet auf `100` oder `000`), dann kürzerer Name.
- Bestehende Zuschläge bleiben: eigene +40, gecachte OFF +15, Nutzung `usageBoost` (60 + 6 pro Eintrag bis 30).
- **Meals in der Hauptsuche**: `searchLocal` indiziert gespeicherte Meals (Name und Zutatennamen, Zutaten mit
  Gewicht 0,6), Zuschlag wie eigene Lebensmittel; `db.meals` ist schon in `AddFoodPage` geladen. Treffer
  werden als Meal-Zeile (`MealList`-Zeile) in der Liste gerendert, sofern kein `into` gesetzt ist.
- **Index-Cache**: eigene, gecachte Lebensmittel und Meals einmal pro Änderung indizieren (useLiveQuery liefert
  die Arrays; `indexItem` in `useMemo` oder ein kleiner Cache nach Array-Identität in `foodService.ts`).

### 3. Online-Treffer gleichberechtigt (`AddFoodPage.tsx`, `foodService.ts`, API)

- Server: `GET /api/foods/search` bewertet OFF-Treffer mit der gemeinsamen `search` (Name + Marke) und
  gibt `score` sowie `popularity` mit; Doppelte nach `normalize(name) + normalize(brand)` fallen weg
  (`catalog.ts`, `searchOff`).
- Client: lokale Treffer sofort; sobald die Online-Antwort da ist, werden die OFF-Treffer mit ihrem Score in
  **dieselbe** Liste einsortiert (eine Neusortierung pro Anfrage; ein Treffer, der lokal schon da ist, bleibt
  der lokale). Die Überschrift „Markenprodukte (Open Food Facts)“ entfällt; die Zeile zeigt die Herkunft wie
  heute als Untertitel. Zustände `loading`/`offline`/`limited`/`error` bleiben als Zeile unter der Liste.
- OFF-Anfrage weiter ab 3 Zeichen nach 600 ms.

### 4. Trefferzeile (`FoodRow` in `AddFoodPage.tsx`)

- Rechts groß: kcal der Standardportion, darunter klein die Portion („1 Stück (120 g)“); fehlt eine Portion,
  wie heute „kcal/100 g“. Portion: erste eigene Portion des Lebensmittels, sonst erste Haushaltsportion aus
  `portionsFor` (`packages/shared/src/foods.ts`), für Meals die Gesamtmenge.
- Tag links unter dem Namen: „3×“ bzw. „Zuletzt“ aus `usage` (Anzahl der letzten 90 Tage), „Eigenes“, „Meal“.
- Bei einem Fuzzy-Treffer ganz oben eine Zeile „Meintest du „Joghurt“?“ (Klick setzt die Anfrage).
- `autoCorrect="off"` und `autoCapitalize="none"` auf dem Suchfeld (iOS ersetzt sonst Wörter).

### 5. Qualitätstest als Regressionsschutz

`apps/api/test/search-quality.test.ts` lädt die BLS-Daten der API und prüft für
eine Goldliste, dass die erwartete BLS-Id in den ersten drei Treffern liegt (Liste aus der Tabelle oben plus:
`banane` → F503100, `apfel` → F110100, `reis` → C352000, `lachs` → T410100, `haferflocken` → C133000,
`vollkornbrot` → B101000, `rührei` → Y720143, `pommes` → X654042, `avocado` → F502100, `tofu` → H861000,
`gouda` → M402600, `hähnchen brust` → V416100, `rind hack` → U010100). Dazu Tippfehler (`kase`, `jogurt`,
`hänchen`, `tomaten`, `kartoffeln`) und Synonyme (`ei`, `nudeln`, `hühnerbrust`, `putenbrust`).
Bestehende Tests anpassen: `packages/shared/test/search.test.ts`, `apps/web/test/foods.test.ts`,
`apps/api/test/ai.test.ts` (Matching-Erwartungen), `apps/web/e2e/food-search.spec.ts` (Überschrift
„Markenprodukte“ entfällt, Portion in der Zeile).

### Betroffene Dateien

- `packages/shared/src/search.ts`, neu `packages/shared/src/synonyms.ts`, `packages/shared/src/index.ts`
- `packages/shared/test/search.test.ts`, neu `packages/shared/test/search.quality.test.ts`
- `apps/web/src/foods/foodService.ts` (searchLocal: Meals, Cache, Online-Merge), `apps/web/src/foods/bls.ts` (kind)
- `apps/web/src/features/foods/AddFoodPage.tsx` (Liste, FoodRow, Tag, Portion, „Meintest du“)
- `apps/api/src/foods/catalog.ts`, `apps/api/src/off/client.ts` (Popularität, Score, Doppelte)
- `apps/api/src/ai/match.ts`, `apps/api/src/ai/foodSearch.ts` (gemeinsame Abwertung, `kind` setzen)
- `README.md` und `CLAUDE.md` (Absatz zur Suche)

## Verifikation

1. `pnpm --filter @ft/shared test`: Goldliste grün, alte Suchtests angepasst.
2. `pnpm test` gesamt (API-Tests prüfen die KI-Suche mit denselben Funktionen), `pnpm lint`, `pnpm typecheck`.
3. Laufzeit: Skript aus der Analyse (60 Anfragen, Top 6) erneut laufen lassen, pro Anfrage unter 10 ms.
4. `pnpm e2e` (`food-search.spec.ts`), danach Screenshots der Suchseite per Playwright über den Proxy :5174
   (siehe Memory „Dev-Proxy-Login“) für „brot“, „ei“, „käse“, „jogurt“ und ein Markenprodukt mit Online-Merge.
