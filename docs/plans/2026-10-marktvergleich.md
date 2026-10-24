# Fleisch-Teufel im Vergleich: Workflows anderer Tracker, Nutzerkritik, Ableitungen

Stand: 24.10.2026 (main `dced9fb`). Ziel laut Auftrag: keine unnötigen Funktionen, aber alles können,
was man braucht. Dieses Dokument sammelt, wie MyFitnessPal (MFP), Yazio, Cronometer, MacroFactor,
Lose It!, FatSecret, Lifesum, Cal AI und Fddb ihre Kern-Workflows lösen, woran sich deren Nutzer
stoßen, und was daraus für Fleisch-Teufel folgt.

**Stand 24.10.2026, Branch `market-features`:** Abschnitt 4 ist vollständig umgesetzt: Zubereitungsfett im Prompt und als Review-Zeile, „Zuletzt hier“
und „Wie gestern“, Barcode → Etikett, OFF-Werte korrigieren, Beschreiben statt fotografieren,
vollständige Tage in Berichten, Bedarf aus eigenen Daten mit Zielvorschlag, Montags-Wochenkarte, Rezeptmodus,
Erinnerung per Web Push (braucht VAPID-Schlüssel in der `.env`), Gewichtstrend als Hauptzahl, „N× gegessen“
im Review, Export-Hinweis unter „Daten & Sync“. Nicht gebaut (bewusst, Abschnitt 5): alles aus der
Nicht-bauen-Liste.

## Quellenlage

- Rezensions-Auswertungen 2026: Unstar (300 Google-Play-Rezensionen MFP, 202 davon 1 bis 3 Sterne;
  Branchenauswertung nach Beschwerdekategorien), MyNetDiary-Scorecard April 2026 (10 Apps, 2.995
  App-Store-Rezensionen; Herausgeber ist selbst Anbieter), Kimola-Zusammenfassungen (App Store / Google
  Play / Trustpilot).
- Forschung: Cordeiro et al., CHI 2015 (Umfrage 141 aktuelle und ehemalige Tagebuchführer, 5.526
  Forenbeiträge aus MFP, FatSecret, Calorie Count; Begleitstudie DECAF mit 257 Befragten); NIH/NIDDK-Studie
  zu Foto-Kalorien-Apps (NUTRITION 2026, 102 gewogene Mahlzeiten, vorläufig); Journal of Consumer
  Research zu Streaks (sekundär zitiert).
- Hersteller-Dokus: MacroFactor (Expenditure-Algorithmus, Check-ins, teilweise erfasste Tage, Label-Scanner),
  Cronometer (Help Center, Blog, Forum), FatSecret, Lose It! (Pressemitteilungen).
- Foren: Cronometer Community (Kürzlich/Häufig, Offline-Modus, Urlaub/Restaurant, gekochtes Gewicht),
  Fitbit Community (Trainingskalorien), MFP Community, mydealz-Kommentare (Fddb, Yazio, deutsche Nutzer).
- Nicht direkt zugänglich: Reddit (für den Crawler gesperrt). Reddit-Stimmung liegt nur über
  Zusammenfassungen von Wettbewerbern (Nutrola, Macaron) vor und ist entsprechend vorsichtig zu lesen.
  Rezensions-Seiten überzeichnen Frust; die Zahlen zeigen Richtung, nicht Verteilung.

---

## 0. Das Wichtigste in zehn Punkten

1. **Der Markt verliert Nutzer vor allem über Bezahlschranken, Werbung und Datenbankmüll**, nicht über
   fehlende Funktionen. Unstar 2026: 29 % Paywall, 18 % falsche Einträge, 15 % Werbung, 12 % Scham-Mechanik,
   8 % Sync, 6 % Streak-Angst, 5 % Export/Kontolöschung. Fleisch-Teufel hat keinen dieser Konflikte;
   das ist der Hauptvorteil und sollte so bleiben.
2. **Die größte Hürde ist Vergessen (54 %), dann „zu umständlich einzugeben“ (40 %) und „weiß nicht, was
   drin war“ (40 %)** (Cordeiro). Aufhören: 37 % „bringt nichts mehr“, 25 % zu viel Aufwand, 16 % zu
   zeitraubend. Jede Funktion ist daran zu messen, ob sie einen dieser drei Punkte senkt.
3. **13 % lassen Einträge weg, weil das Essen „ungesund“ war oder das Budget sprengt** (45 % im
   Feldversuch). Urteilende Darstellung (rot, Scham-Texte, Noom-Farben) kostet Daten. Zahlen ja,
   Urteile nein.
4. **Wiederholtes Essen schnell eintragen ist der am häufigsten genannte Workflow-Wunsch**: Kürzlich und
   Häufig _pro Mahlzeit_ (Cronometer-Forum: globale Liste nützt nichts), Mahlzeit oder Tag kopieren
   (MFP: ein Tipp, aber versehentlich auslösbar), gespeicherte Meals. Fleisch-Teufel hat Tabs Häufig/Kürzlich
   und die Zwischenablage, aber noch keine Ein-Tipp-Zeile in der Mahlzeit.
5. **Barcode nicht gefunden muss nahtlos in „Etikett fotografieren“ übergehen** (MacroFactor schaltet
   automatisch um, Cronometer macht zwei Fotos und legt das Lebensmittel an). Fleisch-Teufel hat beide
   Bausteine (Scan, Etikettenlesen), aber mit Umweg über „Selbst anlegen“.
6. **Foto-KI unterschätzt systematisch**: NIH-Studie, alle vier Apps 250 bis 345 kcal und ~30 g Fett pro
   Mahlzeit zu wenig; am schlechtesten bei fettreichen Gerichten und verstecktem Öl, Soße, Käse. Nutzer von
   Cal AI melden stagnierendes Gewicht trotz „Defizit“. Konsequenz: Review-Schritt behalten, Zubereitungsfett
   aktiv abfragen, Schätzungen kennzeichnen.
7. **Adaptiver Bedarf statt Formel** ist der eine Punkt, bei dem ein Wettbewerber (MacroFactor) etwas kann,
   das Nutzer als echten Unterschied beschreiben: Erhaltungsbedarf aus Gewichtstrend und protokollierter
   Aufnahme (etwa drei Wochen Daten, wöchentliche Anpassung, teilweise erfasste Tage werden ausgeschlossen).
   Fleisch-Teufel hat alle Rohdaten dafür (Gewichte, abgeschlossene Tage, `exponentialTrend`).
8. **Unvollständige Tage verfälschen alles** (Berichte, Prognose, adaptiven Bedarf). MacroFactor empfiehlt
   „Schnellschätzung der fehlenden Mahlzeit“ (±30 % reichen). Fleisch-Teufel hat „Tag abschließen“ und die
   Schnelleingabe; die Berichte sollten nur abgeschlossene Tage werten und Lücken sichtbar machen.
9. **Offline und Restaurant sind die Momente, in denen Tracking abbricht** (Cronometer-Forum: Reisen,
   Funklöcher, Urlaub; „im Urlaub habe ich gar nichts geloggt“). Offline-first ist bereits der Kernvorteil
   von Fleisch-Teufel; für Restaurant fehlt eine Eingabe ohne Foto („beschreiben statt fotografieren“).
10. **Nicht bauen**: Streaks und Gamification (Yazio-Nutzer wechseln deswegen zu Fddb; gebrochene Streaks
    senken die Weiternutzung), Community, Rezept-Content und Ernährungspläne, Fastentimer, Lebensmittel-
    Farbcodes, KI-Coach-Chat (MFP: „unwanted AI Coach“), Werbung, Bezahlschranke, Redesign in ein
    „Heute“-Dashboard (MFP verlor 1,4 Sterne, weil das Tagebuch versteckt wurde).

---

## 1. Was Nutzer an den großen Apps kritisieren

### 1.1 Zahlen

| Quelle                                | Befund                                                                                                                                                                                                                                                            |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unstar 2026, Branche (1 bis 3 Sterne) | Paywall 29 %, Datenbankfehler 18 %, Werbung 15 %, Scham-Mechanik 12 %, Sync/Health 8 %, Programmwirkung 7 %, Streak-Angst 6 %, Export/Kontolöschung 5 %                                                                                                           |
| Unstar 2026, MFP (202 negative)       | Paywall 59 (Barcode 27), Redesign 23 (11 %), Wearable-Sync 21 (10 %), Werbung 9 %, Logout/Datenverlust 8 %, Suche kaputt 7 %                                                                                                                                      |
| MyNetDiary Scorecard 4/2026           | MFP 2,31 (1.438 Rezensionen; Redesign, KI-Coach, entfernte Funktionen), Cal AI 1,92 (Abo, Ziele bis 200 kcal, Abstürze), MacroFactor 3,05 (Abo-Schleife), Cronometer 4,06 (Suchfehler, Werbung), Lose It! 3,46 (April-Update)                                     |
| Cordeiro 2015 (n = 141)               | Nicht eingetragen: vergessen 54 %, zu schwer einzugeben 40 %, Inhalt unbekannt 40 %, sozial unangenehm 20 %, absichtlich weggelassen (ungesund/Budget) 13 %. Aufgehört (n = 94): Nutzen gesunken 37 %, zu viel Aufwand 25 %, zu zeitraubend 16 %, Motivation 10 % |
| NIH/NIDDK 2026 (102 Mahlzeiten)       | MFP, Lose It!, Cal AI, Appediet: im Mittel 250 bis 345 kcal und ~30 g Fett zu wenig; Low-Carb/fettreich am schlechtesten; Kohlenhydrate am stabilsten                                                                                                             |

### 1.2 Zitate, die Workflows betreffen

- „You turned simple tasks into 4-5 clicks instead of 1-2“ (MFP-Abonnent seit 2018, nach dem Redesign 2026).
- „Having to manually click each item to delete it is time consuming“ (MFP; Löschen ohne Wischen).
- „Four different ‚chicken breast‘ entries, all with different macros“; „Scan the same product twice and get
  two different numbers“ (MFP, Crowd-Datenbank).
- „Log a meal, try to edit the portion, app crashes“ (MFP).
- „Web entries don't sync to iOS until app reopened“; „Fitbit steps double-counted with phone steps, net
  calories wrong“ (MFP-Sync).
- Cronometer-Forum zu Kürzlich/Häufig: nach einem Monat stand oben ein Testeintrag von Tag 1, das täglich
  gegessene Lebensmittel fehlte; die Kürzlich-Liste gilt für alle Mahlzeiten statt für die aktuelle und
  braucht vier Tipps.
- Cronometer-Forum Urlaub: „The final result doesn't need to be too accurate to still be helpful“; viele
  loggen auf Reisen gar nichts.
- Cordeiro: „They weren't on the list. I just avoided eating things that were hard to log“ (Tracking
  verzerrt die Essenswahl Richtung Verpacktes); „Sometimes I feel like not logging things because I know
  it's really unhealthy“.
- Fddb-Wechsler von Yazio (mydealz): nervige Diamanten- und Streak-Hinweise; Yazio-Pro-Nutzer: „früher
  schlanker, inzwischen Streaks und zusätzliche Bildschirme“.
- Fddb-KI (mydealz): erkennt Lebensmittel gut, schätzt Mengen oft falsch.

### 1.3 Was gelobt wird

- Yazio: DACH-Datenbank und Supermarktmarken („the one that actually works here“), Barcode in Europa,
  ruhige Oberfläche, deutsche Lokalisierung.
- Cronometer: geprüfte Daten (USDA, NCCDB), keine Nutzer-Einreichungen, Mikronährstoffe, „Copy Previous
  Day“, gekochtes Rezeptgewicht.
- MacroFactor: Bedarf aus eigenen Daten, keine Werbung, kein Social, schnelles Loggen bei wiederholtem
  Essen, Etikett-Scanner in allen Sprachen, Lebensmittel aus Vorder- und Etikettfoto anlegen.
- Lose It!: „Single Dial“ (ein Ring mit Restbudget), einfacher Einstieg, Mahlzeit von früher mit einem Tipp.
- FatSecret: alles kostenlos, schneller Barcode-Scanner, Kürzlich/Häufig automatisch.
- Cal AI: der „Wow“-Moment des ersten Fotos, ruhige Oberfläche; die Freude hält laut Rezensionen nicht,
  wenn die Werte nicht stimmen.

---

## 2. Kern-Workflows im Vergleich

Spalte „FT“ = Stand Fleisch-Teufel.

### 2.1 Suche und Datenbank

| App                            | Lösung                                                  | Kritik                                                                                    |
| ------------------------------ | ------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| MFP, FatSecret, Yazio, Lifesum | Crowd-Datenbank, Millionen Einträge, Branded-Filter     | Duplikate, falsche Werte, 200 Treffer für „Cheeseburger“; außerhalb der Heimatregion dünn |
| Cronometer, MyNetDiary         | geprüfte Quellen, Einreichungen werden vom Team geprüft | kleiner, Lernkurve, mehr Tipps                                                            |
| MacroFactor                    | kuratierte US-Datenbank plus Nutzer-Importe             | Lücken außerhalb der USA                                                                  |

**FT:** BLS 4.0 (geprüft, deutsch) als Basis, OFF für Verpacktes, eigene Lebensmittel; Ranking mit
Suchqualitätstests. Quelle steht auf der Food-Seite („BLS 4.0“, „Open Food Facts“, „Eigenes“).
Lücke: Ein falscher OFF-Eintrag lässt sich nicht an Ort und Stelle korrigieren; der Weg geht über
„Eigenes Lebensmittel anlegen“. Siehe 4.4.

### 2.2 Barcode und „nicht gefunden“

| App         | Lösung                                                                                                                                                                |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MacroFactor | Kein Treffer → wechselt automatisch in den Etikett-Scanner (seit 2.5.0), liest Etiketten in allen Sprachen, legt aus Vorder- und Etikettfoto Name, Marke und Werte an |
| Cronometer  | Zwei Fotos (Packung, Etikett), Lebensmittel wird automatisch angelegt, Team prüft nach                                                                                |
| MFP         | Barcode nur Premium (seit 2022, meistgenannte Beschwerde)                                                                                                             |
| Yazio       | In Europa zuverlässig, veraltete Werte und Community-Abweichungen kommen vor                                                                                          |

**FT:** Scanner mit OFF-Lookup, Varianten UPC-A/EAN-13, „Selbst anlegen“ öffnet den Editor mit Barcode,
dort Etikettenfoto (`LabelCaptureSheet`, Sonnet). Lücke: zwei Schritte statt eines; siehe 4.3.

### 2.3 Foto-KI

| App                                                                               | Lösung                                                             | Kritik                                                                                                                                       |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Cal AI, Fddb-KI, Yazio (2026), Lose It! Snap It, Cronometer (Gold), MFP Meal Scan | Foto → Liste mit Mengen → Review                                   | Unterschätzung (NIH), Mengen falsch, gleiche Mahlzeit zweimal anders, verstecktes Fett; Korrektur „not really what most users signed up for“ |
| MacroFactor                                                                       | Foto mit Küchenwaage im Bild, Mengen des gewogenen Teils als Anker | kein freies Foto-Logging ohne Review                                                                                                         |

**FT:** mehrere Fotos, Hinweis-Chips, Review mit Datenbank-Kandidaten (Nährwerte aus BLS/OFF, Modell
nur für Erkennung und Gramm; Schätzung nur als letzte Stufe und markiert), Neu-Analyse, Lernen aus
Korrekturen, Offline-Warteschlange. Das ist bereits konservativer als der Markt. Lücken: Zubereitungsfett
wird nur per Chip „mit Öl gebraten“ abgefragt; eine Texteingabe ohne Foto fehlt; siehe 4.2 und 4.5.

### 2.4 Wiederholtes Essen

| App         | Lösung                                                                                                                                                       | Kritik                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| MFP         | Kürzlich/Häufig pro Mahlzeit, „Copy yesterday“ je Mahlzeit, Meals                                                                                            | Kopieren versehentlich auslösbar; Kopieren einzelner Items 2026 entfernt |
| Cronometer  | Copy Previous/Current Day, Items markieren und kopieren, Favoriten                                                                                           | Kürzlich-Liste global und „lernt nicht“; vier Tipps                      |
| FatSecret   | Kürzlich und Häufig automatisch; Kopieren über Tage nur Premium                                                                                              |                                                                          |
| MacroFactor | Copy/Paste einzelne Items, mehrere, ganzer Tag; Meals speichern; „Explode recipe“ (Zutaten eines Rezepts herausziehen, um eine ähnliche Mahlzeit anzupassen) |                                                                          |
| Lose It!    | ganze frühere Mahlzeit mit einem Klick                                                                                                                       |                                                                          |

**FT:** Tabs Häufig/Kürzlich/Eigene auf `/add` mit „N× gegessen“ und letzter Menge, „+“ mit Rückgängig,
Zwischenablage (Wischen rechts, Einfügen in jede Mahlzeit, Gruppe als Meal speichern), Gruppen-Editor
(entspricht „explode“). Lücke: nichts davon ist _in der Mahlzeit_ mit einem Tipp erreichbar; siehe 4.1.

### 2.5 Rezepte und gekochtes Gewicht

| App            | Lösung                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Cronometer     | „Set Cooked Recipe Weight“: Differenz wird vom Wasser abgezogen, Portionen skalieren; Rezept-Import per URL (Gold)             |
| MacroFactor    | Rezept aus Foto einer Zutatenliste (Kochbuch, handschriftlich), Rezept teilen per Link, „Log by calories“ (Menge zu Ziel-kcal) |
| MFP            | Rezeptrechner mit Zubereitungsart (Import Premium)                                                                             |
| Yazio, Lifesum | eigene Rezepte nur Pro; Rezept-Content als Hauptverkaufsargument                                                               |

Nutzer-Zitat (Noom-Review): zehn Zutaten einzeln eintragen oder „ganze Mahlzeit“ wählen, die „extrem
daneben“ liegt. Cordeiro: Hausmannskost ist die schwerste Kategorie, Verpacktes die leichteste.

**FT:** Meals mit Zutaten, Skalierung der Gesamtmenge, Gruppen im Tagebuch. Lücke: kein gekochtes
Gewicht und kein „Meal als Lebensmittel pro 100 g“; siehe 4.6.

### 2.6 Schnelleingabe, Restaurant, unvollständige Tage

| App                      | Lösung                                                                                                                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MacroFactor              | Quick Add kcal/Makros je Mahlzeit; Hilfe: fehlende Mahlzeit grob schätzen (±30 % genügt), Tag sonst löschen; „Partial logging“-Modul markiert verdächtige Tage, Algorithmus ignoriert sie |
| MFP                      | Restaurant-Logging für Ketten; Quick Add                                                                                                                                                  |
| Cronometer               | Nutzer behelfen sich mit Ketten-Einträgen, Rezept-Import, „ähnliches Produkt“, Foto später nachtragen                                                                                     |
| Cal AI, Cronometer Voice | Beschreiben oder sprechen statt fotografieren                                                                                                                                             |

**FT:** Schnelleingabe (kcal, Protein, KH, Fett), KI-Foto für Teller, „Tag abschließen“. Lücke: Beschreiben
ohne Foto (4.5); Berichte unterscheiden nicht zwischen „wenig gegessen“ und „wenig eingetragen“ (4.7).

### 2.7 Bedarf und Ziel

| App                              | Lösung                                                                                                                                                                                                        | Kritik                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| MFP, Yazio, Lose It!, Cronometer | Formel (Mifflin-St Jeor o. ä.) plus Aktivität, feste Zahl                                                                                                                                                     | „Gewicht bewegt sich nicht“; Nutzer verstellen Aktivitätsgrad blind |
| MacroFactor                      | Expenditure aus Gewichtstrend plus Aufnahme, etwa drei Wochen Fenster, Status „holding“ ohne Wiegen, wöchentlicher Check-in mit Vorschlag, der abgelehnt werden kann; „Dynamic maintenance“ hält nahe am Ziel | braucht Geduld und Disziplin; Wiegen erwartet; wirkt analytisch     |
| Cronometer-Forum                 | Thread „Adaptive TDEE calculation, why don't we have it?“                                                                                                                                                     |                                                                     |

**FT:** Mifflin-St Jeor, PAL, Tempo, Wochentagsziele, Makro-Vorlagen, Trainingskalorien anrechenbar,
Prognose beim Tagesabschluss. Lücke: Bedarf aus eigenen Daten; siehe 4.8.

### 2.8 Gewicht

Alle ernsthaften Tracker zeigen einen geglätteten Trend (Happy Scale, Libra, MacroFactor, Withings:
Tagesschwankungen bis 1,5 kg entmutigen). **FT:** Trend vorhanden (`exponentialTrend`, 7-Tage-Schnitt),
Tape-Measure-Eingabe, Papierkorb. Keine Lücke; einzig die Hauptzahl könnte der Trend statt der letzten
Messung sein (Plan J).

### 2.9 Training und Wearables

Die meistgenannte Sync-Beschwerde ist doppelt gezählte Aktivität (Uhr plus Telefon, Uhr plus manueller
Eintrag) und das überraschende „du darfst mehr essen“ durch Fitbit-Anpassungen; die Debatte „Trainingskalorien
zurückessen“ ist in jedem Forum offen. **FT:** manuelle Trainings mit MET, Schalter „Trainingskalorien
anrechnen“, netto = MET minus 1 dokumentiert. Eine PWA kann HealthKit nicht lesen; das ist eine bewusste
Grenze, kein Mangel, und erspart genau diese Fehlerklasse. Optional später: CSV-Import (Plan J).

### 2.10 Berichte, Wochenansicht

MFP hat 2026 die Tagesansicht durch ein „Today“-Dashboard mit Trends ersetzt und dafür den größten
Bewertungseinbruch der Kategorie kassiert; die Lehre ist nicht „keine Wochenansicht“, sondern „das
Tagebuch bleibt die Startseite“. MacroFactors wöchentlicher Check-in wird als Ritual geschätzt, weil er
einen konkreten Vorschlag macht und ablehnbar ist. **FT:** Berichte mit Zeitraum, Diagramme, Export.
Lücke: keine verdichtete Wochenkarte (4.9).

### 2.11 Offline, Sync, Daten

Cronometer-Nutzer bitten seit Jahren um einen „limited offline mode“ (Reisen, Funklöcher, auch nur
Notizen); MFP sucht offline nicht in der Datenbank. Export und Kontolöschung hinter Bezahlschranke sind
5 % der Beschwerden. **FT:** offline-first inklusive BLS auf dem Gerät, LWW-Sync, Export, JSON-Backup und
Wiederherstellung, Geräteliste, Kontolöschung, Fehlerprotokoll. Keine Lücke.

---

## 3. Was Fleisch-Teufel heute schon besser löst als der Markt

- Keine Bezahlschranke, keine Werbung, kein Abo-Dialog, keine Streaks: die vier größten
  Beschwerdeklassen entfallen.
- Geprüfte deutsche Basis (BLS) statt Crowd-Werten, mit OFF nur für Verpacktes und sichtbarer Quelle.
- Offline-first mit Konfliktbehandlung, Papierkorb, Rückgängig bei jeder destruktiven Aktion, Wischen
  zum Löschen (MFP-Nutzer beklagen genau das Fehlen).
- Foto-KI, die Nährwerte aus der Datenbank nimmt und das Modell nur erkennen und wiegen lässt; Schätzung
  als markierte letzte Stufe; Review vor dem Eintragen; Lernen aus Korrekturen.
- Etikettenlesen mit Prüfziffer, kein Raten bei Etiketten.
- Tagesabschluss mit Prognose, Wochentagsziele, Trainingskalorien wahlweise anrechnen.
- Export, Backup/Restore, Geräteliste, Kontolöschung, Fehlerprotokoll: alles, was bei den anderen hinter
  Premium liegt oder fehlt.

---

## 4. Lücken, die „man braucht“ (Empfehlungen, nach Nutzen sortiert)

Legende: **N1** senkt direkt eine der drei Hauptbarrieren (vergessen, umständlich, Inhalt unbekannt)
oder die Genauigkeit; **N2** spürbarer Komfort; **N3** nice to have.

### 4.1 (N1) „Zuletzt hier“: Ein-Tipp-Zeile in jeder Mahlzeit

Jede Tagebuch-Mahlzeit zeigt beim Aufklappen des „+“ (oder als schmale Zeile darunter) die drei bis
fünf Lebensmittel oder Meals, die in _dieser_ Mahlzeit zuletzt und am häufigsten eingetragen wurden
(Gewichtung: Häufigkeit × Aktualität, Wochentag leicht bevorzugt). Ein Tipp trägt die letzte Menge ein,
mit Rückgängig-Toast; langer Druck öffnet die Food-Seite zum Ändern der Menge. Dazu in der Mahlzeit ein
Eintrag „Gestern übernehmen“ (kopiert die gleiche Mahlzeit von gestern als Gruppe, Rückgängig), damit MFPs
beliebteste und zugleich gefährlichste Aktion sicher ist. Entspricht Plan J „Zuletzt gegessen“ und löst
die Cronometer-Kritik (globale Liste, vier Tipps). Daten vorhanden: `foodEntries` mit `meal`, `foodId`,
`mealId`, Index auf `foodId`.

### 4.2 (N1) Zubereitungsfett im Foto-Workflow

Die NIH-Zahlen (~30 g Fett zu wenig) betreffen genau die Fälle, die Fleisch-Teufel täglich sieht. Vorschläge:
(a) Prompt bittet das Modell, Bratfett, Dressing und Soße als eigene Position aufzuführen, wenn das Gericht
üblicherweise damit zubereitet wird, und die Position als „angenommen“ zu markieren; (b) im Review eine
Zeile „Öl/Butter 1 EL hinzufügen“ als Chip, wenn keine Fettposition vorhanden ist; (c) Hinweis-Chips um
„ohne Öl“ und „Restaurantportion“ ergänzen. Kein neues Feature, eine Kalibrierung des bestehenden.
Vor Änderungen am Prompt den `claude-api`-Skill laden und `ai-eval` mit echten Fotos laufen lassen.

### 4.3 (N1) Barcode nicht gefunden → sofort Etikett fotografieren

Nach einem Scan ohne Treffer bleibt die Kamera an und zeigt „Etikett fotografieren“ als Hauptaktion
(der Barcode ist schon gespeichert); das Etikettenlesen füllt das Formular, die Person prüft und
speichert, Rückkehr zur Food-Seite mit dem neuen Lebensmittel. „Selbst anlegen“ bleibt als zweite
Aktion. MacroFactor und Cronometer machen genau das, und beide ernten dafür Lob statt Barcode-Beschwerden.

### 4.4 (N1) OFF-Werte an Ort und Stelle korrigieren

Für OFF-Produkte ein Stift „Werte korrigieren“ auf der Food-Seite: öffnet den Lebensmittel-Editor als
Kopie (eigenes Lebensmittel mit gleichem Barcode, Quelle „Eigenes“, Hinweis „ersetzt Open Food Facts“),
optional direkt per Etikettenfoto. Suche und Scan bevorzugen danach die eigene Kopie. Löst „gleiches
Produkt, zwei Zahlen“ ohne Community-Editing.

### 4.5 (N1) Beschreiben statt fotografieren

Dieselbe Analyse ohne Bild: ein Textfeld („Döner mit allem, halbe Portion Pommes, Cola 0,33“), gleicher
Tool-Loop mit `search_foods`, gleiches Review, gleiche Gruppe. Deckt Restaurant, Kantine, nachträgliches
Eintragen („weiß nicht, was drin war“, 40 %) und sozial unangenehme Situationen (20 %) ab, ist billiger als
ein Foto-Call und braucht keinen neuen Server-Code außer dem optionalen Bild. In der Review-Seite sichtbar
als Variante von „Essen eintragen“ (Tastatur-Symbol neben Blitz und Lupe).

### 4.6 (N2) Rezept-Modus für Meals

Im Meal-Editor ein Feld „Gewicht nach dem Kochen“ (optional): das Meal rechnet dann pro 100 g gekocht,
eine Zutat „Wasser“ wird nicht erfunden, nur die Dichte ändert sich (Cronometer-Prinzip, ohne deren
Wasser-Trick). Beim Eintragen wählt man Gramm gekocht statt Faktor. Dazu „Als Lebensmittel speichern“
(Meal → eigenes Lebensmittel pro 100 g), damit Reste und Meal-Prep wie Verpacktes gehen. Plan J.

### 4.7 (N2) Unvollständige Tage in Berichten

Berichte und Prognosen werten nur abgeschlossene Tage (oder Tage mit ≥ 2 Mahlzeiten) als Datenpunkte;
die anderen erscheinen grau mit „nicht abgeschlossen“ und zählen nicht in „Ø kcal“ und „Tage im Ziel“.
Beim Tagesabschluss mit offensichtlicher Lücke (eine Mahlzeit leer, deutlich unter Budget) ein Satz
„Abendessen fehlt? Schnell schätzen“ mit Link zur Schnelleingabe. MacroFactors Hilfe sagt ausdrücklich,
dass dies der häufigste Grund für schlechte Empfehlungen ist.

### 4.8 (N2) Erhaltungsbedarf aus eigenen Daten

Nach 14 abgeschlossenen Tagen und mindestens vier Wiegungen in drei Wochen rechnet die App den
Erhaltungsbedarf aus Ø Aufnahme und Trendänderung (7.700 kcal/kg) und zeigt ihn auf der Fortschritts-
oder Zielseite als „Dein Bedarf aus deinen Daten: 2.350 kcal (Formel: 2.500)“ mit Vertrauensband.
Wöchentlich ein ablehnbarer Vorschlag „Ziel um 100 kcal senken?“, niemals eine automatische Änderung
(MacroFactor-Kritik: „wirkt analytisch“, „erwartet Wiegen“; Cal-AI-Kritik: zu niedrige Ziele). Die
Prognose beim Tagesabschluss nutzt dann diesen Wert statt der Formel. Shared-Mathe liegt in `tdee.ts`,
`forecast.ts`, `reports.ts`; teilweise erfasste Tage aus 4.7 werden ausgeschlossen.

### 4.9 (N2) Wochenkarte

Am Montag (oder auf Wunsch) oben im Tagebuch eine einklappbare Karte: Ø kcal gegen Ziel, Ø Protein,
Gewichtstrend der Woche, abgeschlossene Tage von 7, ein Satz ohne Wertung. Tippen öffnet die Berichte
für die Woche. Nicht als Startseite, nicht als Ersatz der Tagesansicht (MFP-Lehre).

### 4.10 (N2) Eine Erinnerung, nicht mehr

Vergessen ist die größte Barriere. Eine optionale Web-Push-Erinnerung (iOS ab 16.4 für installierte
PWAs, Android Chrome) zu einer selbst gewählten Uhrzeit, nur wenn an dem Tag noch nichts eingetragen
wurde, ohne Streak-Bezug und ohne Wiederholung. Braucht einen kleinen Push-Teil im Server (VAPID,
Abonnements je Gerät, täglicher Job neben dem Housekeeping). Der Nutzen ist belegt, die Gefahr ist
Nerven: deshalb genau eine, standardmäßig aus.

### 4.11 (N3) Kleinigkeiten mit Marktbezug

- Hauptzahl beim Gewicht ist der Trend, die Messung steht darunter (Happy Scale, MacroFactor).
- „N× gegessen“ auch in den Review-Zeilen der Foto-KI (Vertrauenssignal für Kandidaten).
- Export ohne Hürde ist da; dazu ein Hinweis in „Daten & Sync“, dass alles jederzeit exportierbar ist
  (die Angst, Daten zu verlieren, ist in 5 % der negativen Rezensionen Thema).
- Portionswörter: Nutzer schätzen Hausmaße („Tasse“, „EL“); vorhanden, Hinweis nur zur Bestätigung.

---

## 5. Was bewusst nicht gebaut wird (und warum)

| Funktion                                       | Begründung aus der Recherche                                                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Streaks, Diamanten, Abzeichen, Konfetti        | 6 % der negativen Rezensionen; gebrochene Streaks senken die Weiternutzung; Yazio-Nutzer wechseln deswegen; PROMISS-Studie: kein messbarer Effekt |
| Community, Freunde, Challenges                 | Cordeiro: Freunde hören auf oder sind zu erfolgreich, beides führt zum Abbruch                                                                    |
| Rezept-Content, Ernährungspläne, Einkaufsliste | Yazio/Lifesum-Verkaufsargument, bei deren Nutzern Hauptgrund für „Bloat“ und Paywall-Ärger                                                        |
| Fastentimer                                    | Zweit-App-Thema; „Startzeit nicht änderbar“-Beschwerden zeigen, wie viel Pflege das kostet                                                        |
| Farbcodes für Lebensmittel (Noom)              | Rot musste 2022 umbenannt werden; urteilende Darstellung kostet Einträge (13 % lassen „Ungesundes“ weg)                                           |
| KI-Coach-Chat                                  | MFP 2026: „unwanted AI Coach“ in den Top-3-Beschwerden; Cal AI: Ziele bis 200 kcal                                                                |
| Wearable-/HealthKit-Sync                       | PWA kann es nicht; der Markt leidet an Doppelzählung und „du darfst mehr essen“-Überraschungen                                                    |
| Wasser-Zähler                                  | In keiner Quelle als vermisst genannt; bei Lose It! Premium-Beiwerk, bei Yazio Gratis-Füller. Nur bauen, wenn der Nutzer es selbst will           |
| Wochen-Dashboard als Startseite                | MFP-Redesign 2026: minus 1,4 Sterne                                                                                                               |
| Sprach-Eingabe                                 | Beschreiben per Text (4.5) deckt den Nutzen; Diktat liefert die Tastatur                                                                          |

---

## 6. Vorgeschlagene Reihenfolge

1. 4.2 Zubereitungsfett (Prompt und Chips; klein, wirkt sofort auf Genauigkeit).
2. 4.1 „Zuletzt hier“ plus „Gestern übernehmen“ (größter Komfortgewinn, Daten vorhanden).
3. 4.3 Barcode → Etikett und 4.4 OFF korrigieren (gemeinsam, gleicher Editor).
4. 4.5 Beschreiben statt fotografieren (Server: Bild optional; Web: Textfeld, gleiche Review).
5. 4.7 Unvollständige Tage, dann 4.8 Bedarf aus Daten (baut auf 4.7 auf), dann 4.9 Wochenkarte.
6. 4.6 Rezept-Modus.
7. 4.10 Erinnerung (einziger Punkt mit neuer Server-Infrastruktur, deshalb zuletzt).

Jeder Punkt braucht vor der Umsetzung einen kurzen Mockup-Durchlauf wie in den Feedback-Runden
(`docs/plans/2026-10-feedback-runde-*.md`).

---

## Quellen

Rezensionen und Auswertungen

- https://unstar.app/blog/calorie-tracking-apps-ranked-1-star-reviews-2026
- https://unstar.app/blog/is-myfitnesspal-premium-worth-it-paywall-app-reviews-2026
- https://www.mynetdiary.com/diet-app-scorecard-april-2026.html (Herausgeber ist Wettbewerber)
- https://kimola.com/reports/myfitnesspal-removes-free-barcode-scanner-feature-140890
- https://kimola.com/reports/unlock-insights-with-yazio-app-feedback-analysis-report-app-store-de-151937
- https://kimola.com/reports/unveil-user-insights-on-cal-ai-calorie-tracker-app-store-us-155190
- https://news.slashdot.org/story/22/08/25/1955238/myfitnesspal-paywalls-barcode-scanner-that-made-counting-calories-easy
- https://techpoint.africa/?p=357997 (gesponsert, MyNetDiary)
- https://nutrola.app/en/blog/what-do-reddit-users-say-about-yazio-2026 (Wettbewerber)
- https://nutrola.app/en/blog/what-do-reddit-users-say-about-cal-ai-2026 (Wettbewerber)
- https://macaron.im/playbook/macrofactor-reddit-reviews (Aggregator)
- https://calorie-trackers.com/reviews/fatsecret/ , https://calorie-trackers.com/reviews/lifesum/ , https://calorie-trackers.com/reviews/yazio/
- https://www.mydealz.de/deals/fddb-premium-12-monate-999eur-2639390 , https://www.mydealz.de/deals/winterspeck-ade-yazio-pro-jahresabo-fur850eur-uber-vpn-turkei-2500366 , https://www.mydealz.de/deals/fddb-kalorientracker-app-jahresabo-70-reduziert-2785332
- https://www.choice.com.au/health-and-body/diet-and-fitness/weight-loss/articles/noom-weight-loss-app-review

Forschung

- Cordeiro et al., CHI 2015, „Rethinking the Mobile Food Journal“ (DECAF) und „Barriers and Negative Nudges“: https://homes.cs.washington.edu/~jfogarty/publications/chi2015-decaf.pdf , https://news.cs.washington.edu/2015/04/16/barriers-and-negative-nudges-uw-cse-research-team-led-by-james-fogarty-co-authors-new-study-of-mobile-food-journaling/
- NIH/NIDDK, NUTRITION 2026: https://www.newswise.com/articles/photo-based-calorie-tracking-apps-may-underestimate-energy-in-meals
- Streaks (Journal of Consumer Research, sekundär): https://www.olsonzaltman.com/zfiles/freaky-streaks
- PROMISS-Diät-App-Studie (Gamification ohne Effekt): https://utrecht-main-test.atmire.com/items/60d5460c-6124-45a8-ba8a-e41515d26701
- Abbruch in Personal Informatics: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5428074/

Hersteller und Foren

- MacroFactor: https://macrofactor.com/macrofactors-algorithms-and-core-philosophy/ , https://macrofactor.com/expenditure-v3/ , https://help.macrofactorapp.com/en/articles/29-how-do-macrofactor-s-coaching-algorithms-deal-with-partially-logged-days , https://help.macrofactorapp.com/en/articles/213-label-scanner , https://macrofactor.com/10-macrofactor-features/ , https://macrofactor.com/mm-july-2026/ , https://help.macrofactorapp.com/en/articles/247-introduction-to-check-ins-and-coaching-modules
- Cronometer: https://cronometer.com/blog/?p=58829 , https://support.cronometer.com/hc/en-us/articles/4406291608724-Set-Cooked-Recipe-Weight , https://forums.cronometer.com/discussion/comment/21680/ , https://forums.cronometer.com/discussion/5430/limited-offline-mode-please-its-2022 , https://forums.cronometer.com/discussion/comment/19893 , https://forums.cronometer.com/discussion/comment/21763/
- Lose It!: https://www.accessnewswire.com/newsroom/en/publishing-and-media/lose-it-finds-ai-powered-logging-boosts-weight-loss-success-and-greater-nutrit-1015267
- FatSecret: https://www.fatsecret.com/au/articles/lifestyle/make-food-logging-easier-to-stick-to
- Fitbit Community zu Trainingskalorien: https://community.fitbit.com/t5/Manage-Weight/Calories/td-p/2282760
- MFP Community (Prognose): https://community.myfitnesspal.com/de/discussion/1478019/the-prediction-of-future-weight-seems-to-be-broken
- Friction-Debatte: https://lwgrs.bearblog.dev/re-friction-with-calorie-tracking/
