# Lebensmittelsuche: Markenprodukte finden (2026-11-27)

Status: umgesetzt am 2026-11-27 (Stufen 1 bis 3). Probelauf mit dem echten Export: 333 750 Produkte aus
Deutschland, Österreich und der Schweiz (244 082 aus Deutschland), Import in 152 s bei 273 MB Arbeitsspeicher,
Tabelle mit Index 210 MB, Suchanfragen 5 bis 85 ms. „skyr gut und günstig“, „gut & günstig skyr“ und „skyr gut u“
zeigen die Skyr von Gut & Günstig zuerst. Abweichungen vom Plan: Tippfehler in Markennamen findet die Rangfolge
weiterhin nicht (nur in Produktnamen, wie bei BLS); die Live-Suche bei Open Food Facts bleibt als Ersatz, bis der
erste Import durch ist. Tests: `apps/api/test/off-catalog.test.ts`.

## Anlass

Nutzer, 2026-11-27: Skyr von Gut & Günstig ist über die Suche praktisch nicht zu finden. „skyr“ zeigt ihn nicht
(oder ganz am Ende), „skyr gut und günstig“ und der genaue Name aus der Datenbank finden gar nichts. Nur der
Barcode-Scan führt hin. Wunsch: Die Suche sucht sofort in allem, „skyr gut und günstig“ zeigt beim Tippen den Skyr
von Gut & Günstig.

## Befund (nachgestellt am 2026-11-27 mit dem echten OFF-Client und der echten Rangfolge)

Das Produkt gibt es bei Open Food Facts: `4311501657751`, Name „Skyr“, Marke Gut & Günstig, 500 g.

| Eingabe                  | BLS (Gerät) | Open Food Facts (Server) | Produkt dabei |
| ------------------------ | ----------- | ------------------------ | ------------- |
| `skyr`                   | 1           | 20 von 2 035             | nein          |
| `skyr gut`               | 0           | 0                        | nein          |
| `skyr gut und günstig`   | 0           | 0                        | nein          |
| `Skyr - Gut und Günstig` | 0           | 0                        | nein          |
| `gut und günstig`        | 0           | 0                        | nein          |
| `gut günstig`            | 0           | 130                      | (kein Skyr)   |

Gegenprobe: Liegt das Produkt schon auf dem Gerät (nach einem Scan, `foodCache`), findet die eigene Suche es mit
„skyr gut und günstig“ und mit dem genauen Namen sofort (103 Punkte). Die Rangfolge in `packages/shared/src/search.ts`
ist also nicht das Problem. Das Problem ist, dass das Produkt die Suche gar nicht erst erreicht.

## Ursachen

1. **Markenprodukte kommen nur aus einer fremden Live-Suche.** Das Gerät kennt BLS, eigene Lebensmittel und schon
   benutzte Produkte. Alles andere holt der Server pro Eingabe bei Open Food Facts (`catalog.searchOff` →
   `off/client.ts`, Search-a-licious). Was diese Suche nicht liefert, kann die App nicht zeigen.
2. **Name plus Marke findet dort nichts.** Search-a-licious verlangt alle Wörter in einem Feld. „skyr“ steht im
   Namen, „gut günstig“ in der Marke: zusammen 0 Treffer. „skyr edeka“ geht nur, weil ein Produkt „Edeka Bio Skyr“
   heißt.
3. **Füllwörter gehen ungefiltert mit.** „gut und günstig“ gibt 0 Treffer, „gut günstig“ 130: das „und“ steht in
   „Gut & Günstig“ nicht. Die eigene Suche lässt solche Wörter weg (`STOP`), die Anfrage an OFF nicht.
4. **Kein Länderfilter, nur 20 Treffer.** „skyr“ liefert die ersten 20 von 2 035 Produkten weltweit (französische,
   finnische, isländische), in der Reihenfolge von OFF. Mit `countries:"en:germany"` sind es 345 deutsche, das
   gesuchte Produkt steht dort auf Platz 8. Der Filter wird nicht gesetzt.
5. **Ein leeres Ergebnis gilt als Erfolg.** Antwortet OFF mit 0 Treffern, gibt der Server nichts zurück und merkt
   sich das 6 Stunden (`SEARCH_CACHE_MS`). Die Produkte, die der Server schon kennt (jeder frühere Scan und jede
   frühere Suche aller Geräte, Tabelle `foods`, `offIndex`), werden nur bei einem Fehler oder Rate-Limit durchsucht,
   nicht bei einer leeren Antwort. Der klassische OFF-Suchendpunkt als Ersatz antwortet zurzeit mit 503.
6. **Marken kommen verstümmelt an.** Search-a-licious liefert `brands` inzwischen als Liste mit Sprachpräfix
   (`['xx:gut-gunstig']`). `brandOf` (`off/normalize.ts`) nimmt den ersten Eintrag unverändert: Die App zeigt und
   speichert „xx:gut-gunstig“ und überschreibt damit auch eine saubere Marke aus einem früheren Scan.
7. **Beim Tippen verschwinden Treffer.** Jedes getippte Wort muss passen. Bei „skyr gut u“ und „skyr gut un“ ist
   „u“/„un“ noch kein Füllwort und passt auf nichts: Die Liste wird leer, bis „und“ fertig getippt ist.
8. **Die Online-Suche kommt spät.** Sie startet erst ab 3 Zeichen und 600 ms nach dem letzten Tastendruck, dazu die
   Antwortzeit von OFF. Erlaubt sind 10 Suchen pro Minute (danach nur der Zwischenspeicher). Auf einem Tab-Filter
   („Eigene“, oder ein angetippter Tab) läuft sie gar nicht.

## Ziel

- Jede Eingabe sucht sofort in allem: BLS, Eigenes, Meals und Markenprodukte, in einer Liste.
- Name und Marke in beliebiger Reihenfolge finden das Produkt: „skyr gut und günstig“, „gut & günstig skyr“,
  „Skyr - Gut und Günstig“, auch schon während des Tippens („skyr gut“).
- Produkte aus dem deutschen Handel stehen vor denen aus anderen Ländern.
- Keine Abhängigkeit von der Erreichbarkeit und den Limits einer fremden Suche bei jedem Tastendruck.

## Stufe 1: Sofortkorrekturen (klein, ohne neue Daten)

Behebt den gemeldeten Fall und bleibt auch mit Stufe 2 nötig (Punkte 3 bis 6).

1. **Anfrage an OFF** (`off/client.ts`, `catalog.searchOff`): Füllwörter und Satzzeichen weglassen (dieselbe
   Wortliste wie `STOP`, aus shared exportieren), Länderfilter anhängen (Deutschland, Österreich, Schweiz), 50 statt 20 Treffer holen.
2. **Gelockerte Anfrage bei mehreren Wörtern:** Liefert die Anfrage weniger als 5 Produkte, die nach unserer
   Rangfolge passen, fragt der Server zusätzlich die einzelnen Wörter ab (höchstens zwei weitere Anfragen, längste
   Wörter zuerst, je 50 deutsche Produkte), legt alles zusammen und sortiert mit `rankProducts`. Dort müssen alle
   Wörter in Name oder Marke stehen, also bleibt nur, was wirklich passt. „skyr gut und günstig“ → Anfrage „skyr“
   (345 deutsche, das Produkt auf Platz 8) → nach unserer Rangfolge oben. Das Limit von 10 Suchen pro Minute bleibt
   gewahrt (`searchLimiter`); reicht es nicht, gilt Punkt 3.
3. **Server-Bestand immer dazu:** `searchOff` mischt bei jeder Antwort die passenden Produkte aus `offIndex` dazu
   (nicht nur bei Fehlern). Leere Antworten nur 5 Minuten merken statt 6 Stunden.
4. **Marke säubern** (`brandOf`): Sprachpräfix (`xx:`, `de:` …) abschneiden; ist der Rest nur ein Schlagwort
   (`gut-gunstig`), Bindestriche zu Leerzeichen und Wortanfänge groß. `store` überschreibt eine vorhandene Marke
   nicht mit einem Schlagwort. Einmalig beim Start: vorhandene `xx:`-Marken in `foods` säubern.
5. **Tippen** (`search.ts`, `prepareQuery`): Das letzte Wort der Eingabe zählt nicht, solange es der Anfang eines
   Füllworts ist („u“, „un“ → „und“) und davor schon ein Wort steht. Gilt für Gerät, Server und KI-Suche zugleich.
6. **Tests:** `apps/api/test/search-quality.test.ts` bekommt einen Block Markenprodukte mit festen OFF-Beispielen
   (Skyr von sechs Marken): „skyr gut und günstig“, „gut & günstig skyr“, „Skyr - Gut und Günstig“, „skyr gut u“
   finden das Produkt auf Platz 1. Test für `brandOf` mit Listen und Präfixen, Test für die gelockerte Anfrage mit
   einem OFF-Client, der bei „skyr gut günstig“ nichts liefert.

## Stufe 2: Eigener Produktbestand auf dem Server (die eigentliche Lösung)

Stufe 1 bleibt ein Umweg über eine fremde Suche: langsam, begrenzt auf 10 Anfragen pro Minute, und sie sieht nur
die ersten 50 Treffer je Wort. „Sofort nach allem suchen“ geht nur mit eigenen Daten.

1. **Daten:** Open Food Facts stellt den ganzen Bestand als Datei bereit (`en.openfoodfacts.org.products.csv.gz`,
   1,5 GB, wird regelmäßig erneuert; ODbL, Nennung steht schon unter der Liste). Ein Import liest sie als Strom
   (kein Zwischenspeichern der ganzen Datei) und behält Produkte mit Land Deutschland, Österreich oder Schweiz, Namen und Kalorienangabe:
   Barcode, Name, Marke, Menge, Portion, die Nährwerte aus `MAP`, Scans. Erwartet werden einige hunderttausend
   Zeilen; Zahl und Größe misst der erste Lauf. Beim Bau prüfen, ob die CSV-Spalten reichen (deutscher Name,
   `unique_scans_n`), sonst die Parquet-Fassung (7,7 GB).
2. **Ablage:** eigene Tabelle `off_catalog` (nur Server, nicht synchronisiert), getrennt von `foods`: Dort liegen
   weiter nur die Produkte, die jemand benutzt hat, und die Aufräumregel (90 Tage) bleibt, wie sie ist. Die Id
   bleibt `off:<Barcode>`, alte Einträge und der Gerätespeicher passen weiter. `catalog.get` und `catalog.barcode`
   schauen erst in `foods`, dann in `off_catalog`, dann live bei OFF (neue Produkte, die der Import noch nicht hat).
3. **Suche:** Kandidaten aus PostgreSQL (Volltextspalte über den gefalteten Schlüssel von Name und Marke,
   `searchKey`, Wortanfänge für das letzte Wort, sortiert nach Scans, etwa 300 Stück), dann die bekannte Rangfolge
   aus shared darüber (`search`). So bleibt es eine Rangfolge für Gerät, Server und KI. Tippfehler: zuerst über die
   bestehende „Meintest du“-Korrektur prüfen; reicht das nicht, `pg_trgm` (vorher prüfen, ob das eingebettete
   PostgreSQL der Tests die Erweiterung hat).
4. **Import-Lauf:** in `maintenance.ts`, wöchentlich und beim ersten Start von Hand auslösbar
   (`pnpm --filter @ft/api off:import`), in eine neue Tabelle schreiben und am Ende tauschen, damit die Suche
   währenddessen läuft. Stand (Datum, Zeilen) unter `/api/info`.
5. **Route:** `/api/foods/search` antwortet aus dem eigenen Bestand; die Live-Suche bei OFF entfällt für die
   Texteingabe (bleibt für den Barcode). Die KI-Suche (`ai/foodSearch.ts`) nimmt denselben Weg.

## Stufe 3: App

1. `AddFoodPage`: Online-Suche ab 2 Zeichen und mit 150 ms Verzögerung (wie die lokale), sobald Stufe 2 steht. Die
   Regel für sichtbare Zeilen (`pinned`) bleibt.
2. Statuszeile unter der Liste: „Suche Markenprodukte…“ und „Open Food Facts ist ausgelastet …“ entfallen mit dem
   eigenen Bestand; es bleiben „Offline …“ und die Quellennennung.
3. Zeilen von Markenprodukten zeigen die Marke lesbar (kommt aus Stufe 1, Punkt 4).

## Reihenfolge und Aufwand

- Stufe 1: ein Arbeitsgang, kein Schema, sofort auslieferbar.
- Stufe 2 und 3: ein eigener Arbeitsgang mit Migration (`db:generate --name off-catalog`), Import, Tests und einem
  Probelauf gegen die echte Datei, bevor es ausgeliefert wird (Speicherbedarf auf dem NAS, Dauer des Imports).

## Entscheidungen (Nutzer, 2026-11-27)

1. Stufe 2 wird gebaut. Der Server darf Daten vorhalten; erst wenn der Bestand über 5 GB braucht, vorher
   Bescheid sagen (der Probelauf misst das).
2. Länder: Deutschland, Österreich und Schweiz (`en:germany`, `en:austria`, `en:switzerland`), in Stufe 1 als
   Filter der Anfrage, in Stufe 2 als Auswahl beim Import. Bei gleicher Punktzahl stehen deutsche Produkte vorn.
3. „Erst auf Suchen drücken“ meint die Taste der Tastatur: Der Nutzer erlebt, dass Markenprodukte erst nach dem
   Abschicken erscheinen. Im Code gibt es dafür keine Behandlung; die Markensuche startet von selbst, 600 ms nach
   dem letzten Tastendruck. Vermutete Erklärung: Die Antwort von OFF kommt spät, und ihre Produkte werden unter die
   Zeilen sortiert, die über der Tastatur zu sehen sind (`pinned`), also in den Bereich, den die Tastatur verdeckt.
   Erst wenn sie zugeht, sieht man sie. Mit Stufe 2 und 3 kommt die Antwort so schnell wie die lokale Suche; danach
   auf dem iPhone prüfen, dass Markenprodukte beim Tippen ohne Abschicken über der Tastatur erscheinen (Abnahme).

## Offene Fragen

Keine.

## Nachtrag: Tippfehler und „&“ (2026-11-27, nach der Durchsicht von cde14b6)

Wunsch: Marken und Produkte auch mit Tippfehlern finden; „und“ statt „&“ muss gehen.

1. Rangfolge (shared `search.ts`, also Gerät und Server): Wörter der Marke zählen jetzt zum Wortschatz, in dem
   Tippfehler gesucht werden („milsni skyr“ findet Milsani). Ein Tippfehler ab 4 Buchstaben (vorher 5), zwei ab 9;
   doppelt oder einfach geschriebene Buchstaben zählen als ein Tippfehler („barrila“, „millka“). Vier Buchstaben
   finden nur ein ganzes Wort („mlka“), keinen Wortanfang und kein „Meintest du“.
2. „&“, „und“, „u“, „u.“, „and“ und „n“ sind dasselbe: alle sind Füllwörter („gut u günstig“, „fish and chips“,
   „mac n cheese“).
3. Server: die Trigramm-Ausweichsuche ist ersetzt. Der Server hält die Wörter des Bestands im Speicher (rund 79 000,
   beim Start und nach jedem Import gelesen, unter 1 s) und fragt bei weniger als 5 Treffern zusätzlich nach den
   Schreibweisen, für die ein Wort stehen kann, mit derselben Regel wie die Rangfolge (vertauschte Buchstaben zählen
   einmal; Trigramme scheiterten daran bei kurzen Wörtern wie „mikla“). Gemessen am echten Bestand: 30 bis 90 ms je
   neuem Wort, danach aus dem Zwischenspeicher.
4. Probe am echten Bestand: „mikla“, „mlka“, „nutela“, „harbio“, „kerygold“, „coca coal“, „ritter sprot“,
   „spaghetti barrila“, „ehrmann high protien“, „weihenstefan milch“, „oatly barrista“, „gut und günstg skyr“
   finden das Gemeinte. Nicht gefunden: Tippfehler in Wörtern mit 3 Buchstaben („jaa“), zwei Fehler in Wörtern unter
   9 Buchstaben, zusammengeschriebene Marken ohne Vorbild im Bestand.
5. Aus der Durchsicht: ein Import von Hand (`off:import`) wird vom laufenden Server beim nächsten täglichen Lauf
   bemerkt (vorher erst beim Neustart); die Statuszeile nennt wieder „ausgelastet“, solange noch live gesucht wird.
