# Feedback-Runde 11: Suche, Rädchen, Navigation, Essen eintragen, Trainingsnamen, Tagebuch-Kopf

Implementierungsplan für eine neue Fable-Sitzung. Den Statusblock in dieser Datei pflegen.

## Status (2026-11-06)

Alle acht Blöcke am 2026-11-06 von Fable umgesetzt, je Block ein Commit auf `main`, **nicht gepusht**
(Push-Stand immer mit `git fetch` und `git status -sb` prüfen). Kein Mockup-Schritt (der Nutzer hat direkt den
Implementierungsplan bestellt).

| Block | Commit          | Inhalt                                                                                    |
| ----- | --------------- | ----------------------------------------------------------------------------------------- |
| 1     | `78023ed`       | Rädchen: Finger hält und dreht weiter, Rad folgt dem Wert                                 |
| 2     | `40049f9`       | Suche: ruhige Liste, Reiter als Filter, kein Kamera-Icon                                  |
| 3     | `7f1f0ce`       | Navigation (`logFlow`), Tagebuch-Position (`diaryScroll`)                                 |
| 4     | `bd65d32`       | Essen eintragen: „Eingeben“ und „Suchen“, gemeinsames Formular, `note`, „Offene Analysen“ |
| 5     | `1f0b195`       | 20-Minuten-Regel (`logTargetFor`), `DayNote`                                              |
| 6     | `04cf619`       | Trainingsname im Tagebuch und in den Vorschlägen (`templateId`)                           |
| 7     | `d8fba30`       | Tagebuch-Kopf, Mindestdauer der Wolke                                                     |
| 8     | siehe `git log` | Doku (`CLAUDE.md`, `docs/sync.md`, dieser Status)                                         |

Zwei Migrationen laufen beim nächsten Deploy automatisch mit: `0010_food-entry-note`,
`0011_exercise-entry-template`.

### Abweichungen vom Plan

Block 1 (Rädchen)

- Der rote Test hat die im Plan beschriebene Ursache bestätigt (vier neue Tests waren vor der Änderung rot).
- Der bestehende Test „reports turns by hand“ brauchte ein `touchEnd`: Ein liegender Finger meldet jetzt
  absichtlich keinen Stopp.
- Zusätzlich: Ein Tipp, der nichts dreht, meldet nichts (`moved`), weil das Loslassen den Timer neu startet.
- Folge des Sicherheitsnetzes in einem E2E-Test (Meal-Editor): Ein Scroll per Skript bringt das Rad zurück auf
  den Wert; der Test dreht danach zwei Zeilen statt einer.

Block 2 (Suche)

- Die Reiter laufen nur über `onClick` (kein `onValueChange`): Radix schaltet schon bei „mouse down“, der Klick
  danach hätte den Filter doppelt umgeschaltet.
- `pinned` zählt nur, wenn die Liste zur selben Suchanfrage gehört (`data-q` an der Liste).
- E2E `food-search`: Die Meal-Zeile wird über ihren Link gefunden, weil Open Food Facts zeitweise Produkte
  gleichen Namens liefert (Wackler, den es schon vorher gab).

Block 3 (Navigation)

- `returnToDiary` gibt ein Promise zurück (der Button bleibt gesperrt, bis das Tagebuch erreicht ist) und prüft
  nach dem Zurückgehen auch den Tag der erreichten Seite. Seiten nutzen `useReturnToDiary` und
  `useRememberLogStart`.
- Gruppenzeilen tragen zusätzlich `data-rows` (IDs ihrer Einträge) statt einer Suche nach der Gruppe eines
  Eintrags; wartende Analysen haben `data-row="pending:<localId>"` und werden direkt angezeigt (Plan: nur die
  Mahlzeit).
- Das Tagebuch wartet vor dem Setzen der Position zusätzlich auf wartende Analysen und Vorschläge (sie ändern
  die Höhe der Karten).
- Auch der Link einer wartenden Analyse im Tagebuch merkt sich den Start. `logFoodEntry`, `logAiItems` und
  `logAiMeal` geben die neuen IDs zurück.
- „Review schließen“: Der doppelte `/photo`-Schritt wurde am Code geprüft, nicht mit einem eigenen E2E-Test
  vorab belegt; das Schließen geht jetzt einen Schritt zurück.

Block 4 (Essen eintragen)

- Die Notiz wandert bei Kopien über `DiaryItem` (Eintrag als Position mit optionaler Notiz, `entryToItem`).
- Das Schema für die getippten Werte liegt in `shared` (`aiTypedValuesSchema`, `cleanTypedValues`), damit Gerät
  und Server dieselben Grenzen haben.
- Ein alter Schnelleintrag mit Standardnamen behält seinen Namen, wenn er ohne Text gespeichert wird.
- Nur Text bei abgeschalteter KI: „Eintragen“ bleibt deaktiviert (es fehlen Kalorien), ein Hinweis erklärt es.
- Scheitert eine Analyse aus dem Formular, schließt sich das Formular; die Beschreibung steht unter „Offene
  Analysen“ („Wiederholen“ oder verwerfen).
- „Schnell schätzen“ auf „Tag abschließen“ führt direkt ins Formular. `DayNote` entstand schon in diesem Block.
- Der Suchparameter steht als `form=true` in der URL; `form=1` wird angenommen.

Block 5 (Mahlzeit für den nächsten Eintrag)

- Das „+“-Menü liest die letzten Einträge nur, solange es offen ist. `DayNote` steht auf der Lebensmittelseite
  auch beim Bearbeiten eines Eintrags von einem anderen Tag. Ein E2E-Fall für die Regel kam dazu.

Block 6 (Trainingsname)

- `TrainingValues` hat `templateId` und `templateName` (`name` bleibt die Sportart), Vorschläge einen `key`.
- Die Zeilen unter „Ausgewählt“ heißen ebenfalls wie das gespeicherte Training.
- Der erste E2E-Test im Trainingsbereich wurde angepasst: „Als Training speichern“ vor dem Eintragen verknüpft
  den Eintrag (wie im Plan vorgesehen), deshalb heißt er dort jetzt „Bahntraining“.

Block 7 (Tagebuch-Kopf)

- Beim Commit war im selben Lauf ein Test aus einem anderen Bereich rot (`week-strip`, Zeitlimit unter Last). Er
  lief einzeln und in drei weiteren Gesamtläufen grün; sein Zeitlimit wurde mit Block 8 angehoben.

### Annahmen

Alle Annahmen aus dem Abschnitt unten wurden so umgesetzt wie beschrieben; keine musste geändert werden.

### Prüfung

- Je Block: `pnpm lint`, `pnpm typecheck`, `pnpm test` grün (Stand nach Block 8: shared 103, bls-import 5, api 182,
  web 293 Tests).
- `pnpm e2e` nach Block 2, 3, 4, 6 und am Ende: Chromium 41 von 41 grün. WebKit (`ios-layout.spec.ts`) war im
  Container nicht installiert und wurde nachinstalliert (`playwright install --with-deps webkit`, geht bei einem
  Image-Neubau verloren): 2 von 2 grün.
- Sichtprüfung mit dem Produktions-Build über die API, iPhone-13-Format, hell und dunkel (eigenes
  Playwright-Skript, Bilder nicht im Repo): Kameraseite mit „Eingeben“ und „Suchen“, Formular in allen vier
  Button-Zuständen, Suche mit aktivem Filter-Reiter, Trainingszeile mit Namen, Tagebuch-Kopf, Schnelleintrag im
  Tagebuch und beim Bearbeiten. Keine Auffälligkeiten.
- Offen, nur am iPhone prüfbar (dem Nutzer genannt): Rädchen (drehen, Finger kurz halten, weiterdrehen, langsam
  loslassen; Wert im Feld = Zeile im Rad), Scrollposition nach dem Eintragen und nach Zurück, Kamera startet nach
  Zurück aus der Suche, Wischen in „Offene Analysen“, die Liste bleibt beim Eintreffen der Markenprodukte ruhig.

## Context

Der Nutzer hat am 2026-11-05/06 Verbesserungen aus dem Alltag mit der App gesammelt und jede Frage dazu
beantwortet. Es sind ein echter Bug (Rädchen übernimmt den letzten Stand nicht), Reibung in der Suche (Liste
springt, Text verschwindet beim Reiterwechsel), Navigation (Zurück führt nicht zur vorherigen Seite, Tagebuch
springt nach dem Eintragen an den Anfang), ein Umbau der Seite „Essen eintragen" (Buttons unter der Kamera,
Schnelleingabe und KI-Beschreibung in einem Formular), Trainingsnamen im Tagebuch und in den Vorschlägen und
Kleinigkeiten im Tagebuch-Kopf. Ziel: Alles in einer Runde, ohne dass der Nutzer zwischendurch entscheiden muss.

### Entschieden (mit dem Nutzer)

Suche (`/add`)

- Zeilen, die beim Eintreffen der Online-Treffer schon auf dem Bildschirm stehen, bleiben stehen. Alles darunter
  wird nach Rang gemischt („probieren wir so").
- Optik der Reiter bleibt. Text eingeben sucht über alles (kein Reiter aktiv), wie heute. Neu: Ein Tipp auf einen
  Reiter behält den Text und sucht nur in diesem Reiter. Der aktive Reiter zeigt dann oben rechts ein kleines x;
  ein Tipp auf den aktiven Reiter (ganze Fläche) löst den Filter, es wird wieder über alles gesucht.
- Auf „Eigene" filtert das Tippen direkt die eigenen, wie heute.
- Das Kamera-Icon im Kopf der Suche entfällt (ohne Ziel erreicht man die Suche nur über die Kameraseite).

Rädchen

- Rädchen bleiben. Was das Rad zeigt, ist der Wert, der gespeichert wird.

Navigation

- Zurück führt zur vorherigen Seite. Zwei Ausnahmen: nach dem Eintragen oder Speichern nicht zurück ins fertige
  Formular, nach dem Löschen nicht auf die gelöschte Seite.
- Tagebuch: Nach dem Eintragen scrollt es so, dass der neue Eintrag sichtbar ist; ist er an der alten Position
  schon zu sehen, bewegt sich nichts. Zurück ohne Eintragen stellt die alte Position wieder her.

Essen eintragen (`/photo`)

- Unter der Kamera zwei Buttons nebeneinander (50/50): links „Eingeben", rechts „Suchen". Blitz, Tastatur und
  Lupe im Kopf entfallen.
- „Eingeben" öffnet ein gemeinsames Formular: Textfeld „Was hast du gegessen?" und optionale Felder für Kalorien
  und Makros. Nur Werte: Button „Eintragen". Nur Text: Button „Analysieren". Beides: beide Buttons, „Eintragen"
  ist der Hauptbutton, „Analysieren" steht daneben.
- „Eintragen" legt einen normalen Schnelleingabe-Eintrag an (kein Meal, keine Gruppe). Der volle Text steht in
  einem neuen Feld des Eintrags; die Tagebuchzeile zeigt als Titel den Anfang des Textes (an einer Wortgrenze
  gekürzt), ohne Text „Schnelleingabe". Antippen öffnet dasselbe Formular mit vollem Text und Werten, dort nur
  „Änderungen übernehmen" (keine nachträgliche Analyse).
- „Analysieren" mit getippten Werten: Die Werte gehen als Anhaltspunkt an die KI; das Review zeigt das Ergebnis
  der KI.
- Der Abschnitt „Analysen" heißt „Offene Analysen", ist einklappbar (standardmäßig zu, Anzahl im Titel, Zustand
  pro Gerät gemerkt). Kein Verlauf bereits eingetragener Analysen.
- Zeilen darin: Mülleimer weg, Wischen nach links verwirft mit Rückgängig wie im Tagebuch; „Wiederholen" als
  Textlink.
- Lebensmittelseite: Abschnittstitel „Nährwerte dieser Menge" wird „Nährwerte".

Mahlzeit für den nächsten Eintrag

- Gilt für jeden Weg ohne ausdrücklich gewählte Mahlzeit. Das „+" an einer Mahlzeit geht immer vor.
- Nur heute: Liegt der letzte Eintrag von heute weniger als 20 Minuten zurück, geht der nächste in dieselbe
  Mahlzeit. Das gilt auch, wenn der letzte Eintrag per Drag and drop in eine andere Mahlzeit korrigiert wurde.
- Über Mitternacht: Wurde der letzte Eintrag vor Mitternacht für den damaligen Tag eingetragen und ist jünger
  als 20 Minuten, geht der nächste noch zu gestern in dieselbe Mahlzeit. Das Formular nennt den Tag, danach
  öffnet sich das Tagebuch von gestern.
- Nachtragen oder Ändern an einem vergangenen Tag löst nichts aus (angezeigter Tag, Mahlzeit nach Uhrzeit).

Trainings

- Ein Eintrag aus einem gespeicherten Training zeigt im Tagebuch dessen Namen als Titel, die Sportart steht in
  der Unterzeile vor Dauer und Intensität. Benennt man das gespeicherte Training um, zeigen auch alte Einträge
  den neuen Namen (wie bei Meals). Alte Einträge ohne Verbindung zeigen wie bisher die Sportart.
- Auch die Vorschläge („Zuletzt & häufig" auf der Trainingsseite, Vorschläge im Tagebuch) zeigen den
  Trainingsnamen. Ein Vorschlag trägt die Werte vom letzten Mal ein, nicht die aktuellen des gespeicherten
  Trainings.

Tagebuch-Kopf

- Reihenfolge neu: Wolke, Zwischenablage (wenn etwas kopiert ist), Teilen.
- Ein Tipp auf die Wolke zeigt die Ladeanimation mindestens 1 Sekunde. Offline nur die Animation, kein Hinweis.

### Annahmen (im Plan festgelegt, bei Widerspruch melden statt still zu entscheiden)

- **Offline bleibt „Analysieren" möglich.** Dem Nutzer wurde gesagt, offline fehle der Button. Der Code stellt eine
  Beschreibung offline aber schon heute in die Warteschlange (`enqueueDescription`, Zeile im Tagebuch, Analyse
  später). Das bleibt. „Analysieren" fehlt nur, wenn `aiEnabled === false`.
- **Name ohne Text:** Neue Schnelleinträge ohne Text heißen „Schnelleingabe" (heute „Schnell hinzugefügt", das
  widerspricht der Wortregel „hinzufügen nur für Zutaten"). Bestehende Einträge behalten ihren Namen.
- **Mahlzeit im Formular:** Das gemeinsame Formular behält die Auswahl „Mahlzeit" der heutigen Schnelleingabe; sie
  gilt für „Eintragen" und für „Analysieren".
- **Getippte Werte an die KI** gehen als eigenes Feld der Anfrage, nicht in den Beschreibungstext (der Text ist
  Review-Hinweis, Platzhaltername im Tagebuch und `aiAnalyses.userText`).
- **Wartende Analysen zählen** für die 20-Minuten-Regel wie Einträge (sie stehen als Zeile in der Mahlzeit).
- **Rückkehr nach dem Eintragen** geht im Verlauf zurück zum Tagebuch, wenn der Ablauf dort begann (wie
  `returnFromInto`); sonst ersetzt das Tagebuch das Formular wie heute.
- **Tagebuch-Scroll:** ein Merkplatz (Tag + Position) für die laufende App, nicht pro Tag und nicht über einen
  Neustart hinweg.
- CSV: neue Spalten nur am Ende („Notiz" bei Einträgen, „Training" bei Trainings).

### Im Code geprüft (2026-11-06)

- `Wheel.tsx`: Nach dem Stopp (`SETTLE_MS` 160 ms ohne Scroll-Ereignis) wird `turned` falsch; spätere
  Scroll-Ereignisse ohne neuen `touchstart`/`pointerdown` werden verworfen. Finger liegt still und dreht weiter
  oder lässt langsam los: Das Rad rastet auf der nächsten Zeile ein, der Wert bleibt auf der gemeldeten. Die
  Vermutung „Speichern innerhalb der 160 ms verliert den Wert" stimmt **nicht**: Alle drei Verwender
  (`FoodLogPage`, `ReviewRow` in `PhotoPage`, `IngredientCard` in `MealEditor`/`DiaryGroupPage`) speichern aus
  State, den auch das Live-`onChange` setzt.
- Router: `scrollRestoration: true`, das Fenster scrollt. TanStack stellt die Position genau einmal bei
  `onRendered` wieder her; das Tagebuch zeigt dann noch drei Skeletons (kurze Seite), die Position wird gekappt.
  Nach dem Eintragen wird zudem eine neue `/`-Seite geöffnet (`replace` oder push), also ohne Wiederherstellung.
- `/add` ohne `into` ist nur über `/photo` erreichbar (`PhotoPage.tsx:327`); mit `into` zeigt `/add` kein
  Kamera-Icon.
- `AddSheet` wird nur von der Tab-Leiste und ohne Ziel geöffnet: `meal = target.meal ?? defaultMealForNow()`.
- `loggedAt` ist beim Anlegen `Date.now()` (`+i`); `moveEntriesToMeal` und Bearbeiten ändern es nicht.
- Sync und Backup sind generisch über Zod- und Drizzle-Schema; ein nicht indiziertes Feld braucht keine neue
  Dexie-Version. `.nullable().default(null)` macht das Feld im TS-Typ zur Pflicht: Jede Stelle, die einen ganzen
  Datensatz baut, muss es setzen (`saveRecord` speichert das Original, nicht das geparste Objekt).

## Umsetzung

Zeilennummern sind der Stand von `253b4fe` und dienen nur zum Finden.

### Block 1: Rädchen übernimmt immer, was es zeigt (`components/Wheel.tsx`)

Zuerst die Ursache mit einem roten Test belegen (`apps/web/test/components.test.tsx`, `describe('Wheel')`, falsche
Timer wie die bestehenden): `touchStart`, `scrollTop = 3 * 44` + `scroll`, 200 ms vorspulen (Finger liegt noch),
`scrollTop = 4 * 44` + `scroll`, `touchEnd`, vorspulen. Erwartet: letztes `onSettle` ist Zeile 4. Heute bleibt 3.

Änderungen:

- `held`-Ref: `touchstart` setzt, `touchend`/`touchcancel` löschen. Nur Touch-Ereignisse (iOS feuert
  `pointercancel`, sobald der Browser scrollt). `pointerdown`/`wheel` bleiben wie heute das Zeichen für eine Drehung.
- Der Stopp-Timer meldet nicht, solange `held` gesetzt ist. `touchend`/`touchcancel` lassen `turned` stehen und
  starten den Timer neu, damit auch ein Loslassen ohne weiteres Scrollen meldet.
- Gemeldet wird nur auf dem Raster: Liegt `scrollTop` mehr als 1 px neben `row * ROW`, läuft das Einrasten noch;
  Timer neu starten, nach höchstens 1 s trotzdem `rowAt(el)` melden.
- Sicherheitsnetz: Kommt ein Scroll-Ereignis ohne Drehung und ohne `pending` und steht das Rad danach neben
  `index`, setzt ein Timer (`SETTLE_MS`) das Rad über den `pending`-Weg zurück auf `index`. Das Rad folgt dem
  Wert, nie umgekehrt (sonst kehrt der Fehler aus Runde 9 zurück: 2 Portionen wurden 20 g).
- Die Meldung läuft weiter über State und Effekt (kein direkter Aufruf aus dem Timer).

Tests: der rote Test oben; „Loslassen ohne weiteres Scrollen meldet"; „Scroll von außen: kein `onChange`/
`onSettle`, Rad steht danach wieder auf `index`". Die bestehenden Tests (`strayScroll`, „reports turns by hand")
bleiben grün. iOS-Schwung lässt sich hier nicht nachstellen: Der Nutzer prüft am iPhone (siehe Verifikation).

### Block 2: Suche (`features/foods/AddFoodPage.tsx`, `foods/foodService.ts`, Route `/add`)

**Ruhige Liste**

- `mergeOnline(rows, online, query, usage, corrected, pinned = 0)`: Die ersten `pinned` lokalen Zeilen bleiben in
  ihrer Reihenfolge oben, der Rest wird wie heute mit den Online-Treffern nach Score gemischt, „rest" am Ende.
- `pinned` entsteht in dem Moment, in dem die Online-Antwort ankommt (im asynchronen Teil des Effekts bei
  Zeile 131 bis 146, zusammen mit `setResult`, also kein `setState` im Effektkörper): Anzahl der Ergebniszeilen,
  deren Oberkante über der Unterkante des sichtbaren Bereichs liegt (`visualViewport.height`, sonst
  `innerHeight`; Liste per Ref, mindestens 0). Als Feld `pinned` im `result`-State; gilt nur für dieses `q`.
- Test in `apps/web/test/foods.test.ts` neben „sorts online products into the local results by relevance":
  mit `pinned = 2` bleiben die ersten zwei lokalen Zeilen oben, auch wenn ein Online-Treffer höher punktet.

**Reiter filtern die Suche**

- Neuer optionaler Suchparameter `scope` (`'frequent' | 'recent' | 'mine' | 'all'`) an der Route `/add`
  (`validateSearch` in `app/router.tsx`, mit `clean()`).
- Wirksamer Filter beim Suchen (`q.length >= 2`): `scope === 'all'` → keiner; sonst `scope`; ohne `scope` gilt
  `tab === 'mine'` als Filter „Eigene" (wie heute), sonst keiner.
- Tipp auf einen Reiter beim Suchen: Ist er der wirksame Filter, wird `scope: 'all'` gesetzt (Filter gelöst);
  sonst `scope` und `tab` auf diesen Reiter. Der Text bleibt. `setTab` leert `query` nie mehr (auch ohne Suche
  nicht); `resetScroll: false` ergänzen. Fällt `q` unter 2 Zeichen, entfällt `scope` aus der URL.
- `Tabs value`: wirksamer Filter, sonst beim Suchen `''`, sonst `tab`. Der aktive Reiter zeigt beim Suchen ein
  kleines `X` (lucide, `size-3`, oben rechts im Trigger, `aria-hidden`) und bekommt
  `aria-label="<Name>, Filter aufheben"`. Tippfläche ist der ganze Reiter (das vorhandene `onClick` am
  `TabsTrigger`, weil Radix den Klick auf den aktiven Reiter ignoriert).
- Inhalte: „Eigene" wie heute (`filterOwn`). „Häufig"/„Kürzlich": neues `filterRecent(q, items)` in
  `foodService.ts` (gleiche gefaltete Teilwortsuche wie `filterOwn` auf `name` und `brand`), gerendert mit
  `RecentList` (Schnell-„+" und Zähler bleiben). Leerer Filter: „Nichts in „Kürzlich" für „q"" plus Textbutton
  „Überall suchen" (setzt `scope: 'all'`).
- Online wird nur ohne Filter gesucht (`wantsOnline` zusätzlich an „kein Filter" binden).

**Kamera-Icon und Verlauf**

- `actions` mit dem Kamera-Link (`AddFoodPage.tsx:225` bis 241) entfernen, `warmUpCamera`-Import mit.
- `PhotoPage.tsx:327`: `replace` am Link zur Suche entfernen (Zurück aus der Suche führt zur Kameraseite). Der
  Link selbst wandert in Block 4 unter die Kamera.

Tests: `e2e/food-search.spec.ts:40` umschreiben (kein Kamera-Icon; Tipp auf „Kürzlich" behält den Text, zeigt
gefilterte Zeilen und das x; zweiter Tipp sucht wieder über alles; „Eigene" filtert beim Tippen wie bisher);
`e2e/diary-training.spec.ts:241` bis 247: Zurück aus der Suche landet auf `/photo`, noch einmal Zurück im
Tagebuch. `meals-goals.spec.ts:165` bis 170 und `meals-unified.spec.ts:146` klicken Reiter und füllen dann die
Suche: prüfen, ob die Reihenfolge noch das Erwartete zeigt.

### Block 3: Navigation und Tagebuch-Position

**Regel:** Zurück = vorherige Seite. Ausnahmen: erledigtes Formular, gelöschte Seite.

Neu `apps/web/src/lib/logFlow.ts` (Muster von `lib/into.ts`, `sessionStorage`-Schlüssel `ft.logStart`):

- `rememberLogStart(history, { path, date })`: merkt `__TSR_index`, Pfad und Tag der Seite, von der ein
  Eintrage-Ablauf startet. Aufrufer: die Kacheln „Essen eintragen" und „Training eintragen" in
  `components/AddSheet.tsx`, der „+"-Link einer Mahlzeit (`features/diary/MealCard.tsx:114`), die Links zu
  `/photo` in `DiaryMealPage.tsx:74`/`:106`, „Training eintragen" in `ExerciseCard.tsx`.
- `returnToDiary(router, { date, focus })`: setzt den Fokus fürs Tagebuch (siehe unten), liest und löscht den
  Start. Ist der Start `/` mit demselben `date` und liegt er vor dem aktuellen Index: `history.go(start -
current)`; einmalig auf `router.subscribe('onResolved')` prüfen, dass der Pfad `/` ist, sonst Ersatzweg. Ersatzweg:
  `navigate({ to: '/', search: { date }, replace: true })`.
- `DiaryPage` löscht `ft.logStart` beim Einhängen (ein alter Start darf später nichts auslösen).

Stellen (heute → neu):

| Stelle                                                                                   | heute                | neu                                                                                                          |
| ---------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------ |
| `FoodLogPage.tsx:304` neu eingetragen                                                    | `/` replace          | `returnToDiary`                                                                                              |
| `FoodLogPage.tsx:304` Änderung übernommen                                                | `/` replace          | `goBackOr(1, → '/' mit date)`                                                                                |
| `FoodLogPage.tsx:313`, `QuickAddPage.tsx:112`, `ExercisePage.tsx:211` gelöscht           | `/` push             | `goBackOr(1, → '/' mit date)`                                                                                |
| `QuickAddPage.tsx:90` (ab Block 4 nur noch Bearbeiten)                                   | `/` push             | `goBackOr(1, …)`                                                                                             |
| `MealLogView.tsx:121`                                                                    | `/` push             | `returnToDiary`                                                                                              |
| `PhotoPage.tsx:923` Review eingetragen, `:185` Analyse verlassen, `:259` offline wartend | `/` replace          | `returnToDiary`                                                                                              |
| `ExercisePage.tsx:173` neu / bearbeitet                                                  | `/` push             | `returnToDiary` / `goBackOr(1, …)`                                                                           |
| `CompleteDayPage.tsx:70`                                                                 | `/` push             | `goBackOr(1, → '/' mit date)`                                                                                |
| `PhotoPage.tsx:377` Barcode im Kamerabild → `/scan`                                      | replace              | push (Zurück vom Produkt führt zur Kamera)                                                                   |
| `PhotoPage.tsx:145`/`:276` Review schließen                                              | replace auf `/photo` | `goBackOr(1, → bisheriges replace)`; vorher per E2E prüfen, ob heute ein doppelter `/photo`-Schritt entsteht |

Bleiben, weil sie unter die Ausnahmen fallen oder nur URL-Zustand sind: `ScanPage.tsx:46`/`:73` (Durchgangsseite),
`CustomFoodPage.tsx:70`/`:96`/`:174`, `AddFoodPage.tsx:94`/`:185`, `ProgressPage.tsx:71`/`:182`,
`ReportsPage.tsx:123`, `lib/into.ts`. Abläufe, die auf `/diary-meal` oder einem anderen Reiter begannen, nehmen
den Ersatzweg (wie heute).

**Tagebuch merkt die Position und zeigt den neuen Eintrag** (neu `features/diary/diaryScroll.ts`, Hook in
`DiaryPage.tsx`)

- Merkplatz im Modul: `{ date, y }`. Solange das Tagebuch geladen ist (nicht die Skeletons bei Zeile 125),
  schreibt ein passiver `scroll`-Listener `window.scrollY` für den gezeigten Tag hinein. Anderer Tag überschreibt.
- Sobald der Tag geladen ist (`summary`, `entries`, `exercises`, `settings`), einmal je Einhängen und Tag in einem
  Layout-Effekt: gemerkte Position für diesen Tag setzen (`window.scrollTo(0, y)`), danach den Fokus anwenden.
  TanStack setzt die Position schon bei `onRendered`; unser Schritt kommt später und gewinnt (per E2E belegen,
  sonst ein `requestAnimationFrame` dazwischen).
- Fokus: `returnToDiary` legt `{ date, rows: string[], meal?: number }` in denselben Modulzustand (die neuen
  Eintrags-IDs aus `logFoodEntry`/`logItems`/`logAiItems`/`logTrainings`, bei wartender Analyse nur `meal`).
  Das Tagebuch sucht `[data-row="<id>"]`, sonst `[data-row="group:<groupId>"]` des Eintrags, sonst
  `[data-meal="<n>"]`; ist das Element nicht ganz zwischen Kopf (Unterkante des sticky Headers) und Tab-Leiste
  sichtbar, `scrollIntoView({ block: 'center' })`. Fokus danach löschen.
- DOM-Anker ergänzen (heute gibt es keine): `data-meal={meal}` an der `Section` von `MealCard`, `data-row` an den
  `<li>` der Einträge (`row.entry.id` bzw. `group:${groupId}`) und an den Trainingszeilen in `ExerciseCard`.

Tests: `apps/web/test/lib.test.ts` für `logFlow` (zurück bei passendem Start, Ersatzweg bei anderem Tag, anderem
Pfad, fehlendem Start); E2E neu in `e2e/diary-training.spec.ts`: (a) viele Einträge, nach unten scrollen, im
Abendessen „+" → Suche → Lebensmittel eintragen: Tagebuch steht an der alten Stelle, neuer Eintrag im Bild, ein
Zurück führt nicht in Suche oder Formular; (b) nach unten scrollen, „+", zweimal Zurück: alte Position; (c)
Eintrag antippen, löschen, Zurück führt nicht auf den gelöschten Eintrag.

### Block 4: Essen eintragen (`features/ai/PhotoPage.tsx`, `features/foods/QuickAddPage.tsx`, Schema, API)

Vorher `.claude/skills/offline-sync/SKILL.md` und `docs/sync.md` lesen; vor dem API-Teil den Skill `claude-api`
laden (Vorgabe aus `CLAUDE.md`).

**4a Feld `note` am Essenseintrag**

- `packages/shared/src/schemas.ts`: `note: z.string().trim().max(MAX_HINT_LENGTH).nullable().default(null)` in
  `foodEntrySchema` (nicht in `loggedItemShape`, Meal-Zutaten bekommen es nicht).
- `apps/api/src/db/schema.ts`: `note: text()` in `foodEntries`; `pnpm --filter @ft/api db:generate -- --name
food-entry-note`.
- Alle Stellen, die einen ganzen `FoodEntry` bauen, setzen `note` (der Typecheck zeigt sie: `db/entries.ts`
  `NewFoodEntry`/`logFoodEntry`/`logItems`, `AddFoodPage.tsx:203`, `FoodLogPage.tsx:280`, `db/groupDraft.ts:342`,
  `apps/api/scripts/seed-demo.ts`, Test-Fixtures). Kopien eines ganzen Eintrags behalten die Notiz
  (Zwischenablage, „Wie gestern", `DiaryPart`); wird ein Eintrag Zutat eines Meals, entfällt sie.
- `features/reports/export.ts` `entriesCsv`: Spalte „Notiz" am Ende. `docs/sync.md` „Datensätze" ergänzen;
  Round-Trip- und „older app versions"-Test in `apps/api/test/sync.test.ts` erweitern.

**4b Gemeinsames Formular**

- Neu `features/foods/QuickEntryFields.tsx`: Felder und Zustand für Text (`HintField`, Label „Was hast du
  gegessen?", `MAX_HINT_LENGTH`), Kalorien, Protein, Kohlenhydrate, Fett (`NumberField`, der Makro-Hinweis mit
  „Übernehmen" aus `QuickAddPage.tsx:138` bis 151 zieht mit) und „Mahlzeit" (`Select`). Meldet `hasText` und
  `valid` (kcal gesetzt, 0 bis unter 20 000) nach oben.
- Schreiblogik als Modulfunktionen in `db/entries.ts`: `logQuickEntry(db, { date, meal, text, kcal, proteinG,
carbsG, fatG })` (gibt die ID zurück) und `saveQuickEntry(db, entry, …)`. Titel über neues
  `quickEntryTitle(text)` in `packages/shared/src/diary.ts`: erste Zeile, höchstens 60 Zeichen, an der Wortgrenze
  gekürzt mit „…"; ohne Text „Schnelleingabe". `note` = voller Text oder `null`. Unit-Test in shared.
- `PhotoPage`: `DescribeForm` wird durch das neue Formular ersetzt. `describing` wird zum Suchparameter `form`
  an `/photo` (push beim Öffnen, Kopf-Zurück ist dann der normale Verlaufsschritt; `onBack` für `describe`
  entfällt). Fuß der Seite:
  - nur gültige Werte → „Eintragen" (primär);
  - nur Text → „Analysieren" (primär);
  - beides → `grid grid-cols-2`: „Analysieren" (`variant="outline"`) und „Eintragen" (primär);
  - nichts → „Eintragen" deaktiviert. Beide laufen über `useSubmitting()`.
  - `aiEnabled === false`: kein „Analysieren".
- „Eintragen": `logQuickEntry`, Toast wie heute („N kcal eingetragen"), `returnToDiary` mit der neuen ID.
- „Analysieren": wie `describeMeal` über `follow`, mit den getippten Werten (4c). Öffnet danach das Review, ersetzt
  dabei den `form`-Schritt (`navigate({ search: { review, form: undefined }, replace: true })`).
- `QuickAddPage` bleibt die Route `/quick-add?entryId=` und zeigt für Bearbeiten dieselben Felder: Text
  vorbelegt mit `entry.note ?? entry.name` (leer, wenn der Name einer der Standardnamen ist), nur „Änderungen
  übernehmen", Mülleimer wie heute. Ohne `entryId` leitet sie auf `/photo?form=1` um (alte Links).
- `entryAmountLabel` („Schnell eingetragen") bleibt.

**4c Getippte Werte als Anhaltspunkt für die KI**

- `AiQueueItem.typed?: { kcal?: number; proteinG?: number; carbsG?: number; fatG?: number }`
  (`db/dexie.ts`, nicht indiziert, keine neue Version); `enqueueDescription` nimmt es an, `runQueue` und
  `reanalyze` reichen es an `analyzePhotos(images, text, typed?)` weiter (Formularfeld `typed` als JSON).
- `apps/api/src/routes/ai.ts`: `typed` lesen und mit einem kleinen Zod-Schema prüfen (Zahlen in sinnvollen
  Grenzen; Ungültiges wird ignoriert). `AnalyzeInput.typed`, `userPrompt(text, photos, typed)` in
  `ai/prompt.ts` hängt eine Zeile an: „Angabe der Person zur ganzen Mahlzeit: etwa 600 kcal, 40 g Protein, …
  Nimm sie als Anhaltspunkt für die Mengen." Test in `apps/api/test/ai.test.ts`.

**4d Buttons unter der Kamera, Kopf**

- Kopf-`actions` (Blitz, Tastatur, Lupe, `PhotoPage.tsx:305` bis 332) entfernen.
- Direkt unter `CameraCapture`: `grid grid-cols-2 gap-2 mt-3`, zwei `Button variant="outline" size="lg"`:
  links `Keyboard` + „Eingeben" (öffnet `form`, deaktiviert während `analyzing`), rechts `Search` + „Suchen"
  (`Link to="/add" search={{ date, meal }}`, push). Nur in der Kameraansicht, nicht in Vorschau oder Formular.

**4e „Offene Analysen"**

- Abschnitt `PhotoPage.tsx:379` bis 387: Titel „Offene Analysen (N)", einklappbar nach dem Muster von
  `AddFoodPage.tsx:52` bis 66 (`localStorage`-Schlüssel `ft:photo:queueOpen`, Standard zu).
- `QueueRow`: Icon-Buttons Mülleimer und ↻ entfernen; Zeile in `SwipeToDelete` (Label „… löschen", Verwerfen mit
  `takeQueueItem`/`restoreQueueItem` und Rückgängig-Toast wie `features/diary/PendingAnalysisRow.tsx:36` bis 42),
  „Wiederholen" als Textlink mit den Klassen von dort.

**4f** `FoodLogPage.tsx:430`: `Section title="Nährwerte"`.

Tests: `market.spec.ts:74` (Beschreiben läuft über „Eingeben"), neuer Fall „Werte tippen und eintragen, Text mit
drei Sätzen: Titel gekürzt, Antippen zeigt den vollen Text" und „beides: zwei Buttons"; `diary-training.spec.ts:
207` (keine Kopf-Icons, zwei Buttons, „Suchen" führt zur Suche und Zurück zur Kamera); die
Schnelleingabe-Helfer in `diary-training`, `market`, `meals-goals`, `meals-unified`, `share-day` (`/quick-add?
meal=…`, Feld „Bezeichnung") auf `/photo?form=1` und das Textfeld umstellen; `meals-goals.spec.ts:559`
(Locator „Analysen" → „Offene Analysen", erst aufklappen); `food-search.spec.ts:53`; `apps/web/test/
meals-photos.test.ts` (`enqueueDescription` mit `typed`).

### Block 5: Mahlzeit für den nächsten Eintrag (`lib/meals.ts`, `components/AddSheet.tsx`)

- Reine Funktion `logTargetFor({ shownDate, today, now, entries, pending })` in `lib/meals.ts` → `{ date, meal }`:
  1. `shownDate !== today` → `{ date: shownDate, meal: defaultMealForNow(now) }`.
  2. Kandidaten: nicht gelöschte Essenseinträge mit `date === today`, dazu die von gestern, deren `loggedAt` am
     Kalendertag gestern liegt (am eigenen Tag eingetragen); ebenso wartende Analysen (`aiQueue` ohne `result`,
     Zeit `createdAt`). Jüngster Kandidat mit `now - Zeit < 20 min` (`STICKY_MEAL_MS`) → dessen `date` und `meal`.
  3. Sonst `{ date: today, meal: defaultMealForNow(now) }`.
- `AddSheet`: `useLiveQuery` für die Einträge von heute und gestern und die wartenden Analysen; beim Tipp auf
  „Essen eintragen" `logTargetFor` mit `Date.now()` rechnen (nur wenn `target.meal` fehlt). `warmUpCamera()`
  bleibt der erste Aufruf im Tipp. „Training eintragen" nimmt nur das `date` daraus.
- Tag sichtbar machen (heute zeigt kein Essensformular den Tag): kleine Komponente `DayNote` (nichts für heute,
  sonst eine graue Zeile wie die Datumszeile in `ExercisePage.tsx:219`, „Gestern, …" über `lib/format.ts`) auf
  `/photo` (Kamera, Vorschau, Formular), `FoodLogPage`, `MealLogView` und im Review.
- Tests: `apps/web/test/lib.test.ts` für `logTargetFor`: gleiche Mahlzeit innerhalb 20 min, nach 21 min Uhrzeit,
  per Drag and drop verschobener Eintrag (anderes `meal`, altes `loggedAt`), 23:55 → 00:10 geht zu gestern,
  00:20 zu heute Frühstück, tagsüber für gestern nachgetragen löst nichts aus, angezeigter Tag vorgestern.

### Block 6: Trainingsname im Tagebuch und in den Vorschlägen

Vorher `offline-sync`-Skill lesen.

- Schema: `templateId: idSchema.nullable().default(null)` in `exerciseEntrySchema`; Drizzle `templateId: text()`
  in `exerciseEntries`; Migration `--name exercise-entry-template`. Alle Baustellen eines ganzen Eintrags setzen
  das Feld (`TrainingToLog` in `db/entries.ts`, `ExercisePage.save()` Zeile 149 bis 161 reicht `r.templateId`
  durch, `TrainingSuggestions.logOne`, Fixtures). `docs/sync.md` und Sync-Tests wie in 4a.
- `ExercisePage`: Bearbeiten startet mit `entry.templateId`; wechselt die Sportart einer Zeile, wird
  `templateId` `null`. „Als Training speichern" setzt es schon (Zeile 412).
- Anzeige: Helfer `trainingTitle(entry, templates)` in `features/exercise/training.ts` → Titel = Name des
  gespeicherten Trainings (auch eines gelöschten, wie bei Meals), sonst `entry.name`; Sportart für die Unterzeile
  nur, wenn sie vom Titel abweicht. `ExerciseRowBody` (`ExerciseCard.tsx:93`) bekommt Titel und Sportart als Props;
  `ExerciseCard`, `DayShareImage` (über `collectShareData`) und die Lösch-Toasts (`ExerciseCard.tsx:62`,
  `ExercisePage.tsx:422`) nutzen den Helfer. `exerciseCsv`: Spalte „Training" am Ende.
- Vorschläge (`db/trainingSuggestions.ts`): Gruppenschlüssel `templateId` eines **nicht gelöschten**
  gespeicherten Trainings, sonst `typeKey`. `TrainingValues` bekommt `templateId` und den aufgelösten Namen; Werte
  bleiben die des letzten Eintrags der Gruppe. „Heute schon eingetragen" prüft denselben Schlüssel. `last` (Werte
  je Sportart für den Sport-Picker) bleibt je `typeKey`.
- `TrainingSuggestions` (Tagebuch): Titel = Trainingsname, Detail „Sportart · N Min. · Intensität", `saved`-Icon;
  ein Tipp trägt mit `templateId` und den Werten vom letzten Mal ein.
- `ExercisePage`-Chips: Ein Vorschlag mit `templateId` ersetzt den Chip desselben gespeicherten Trainings (kein
  doppelter Chip); gespeicherte Trainings ohne Vorschlag bleiben mit ihren eigenen Werten. `pressed` wie heute
  über `rowOfType(...)?.templateId`.
- Tests: `apps/web/test/trainingSuggestions.test.ts` (zwei Trainings derselben Sportart ergeben zwei Vorschläge;
  Werte vom letzten Mal; gelöschtes Training fällt auf die Sportart zurück), `components.test.tsx`
  (`DayShareImage`, Zeile mit Namen), E2E in `diary-training.spec.ts:119` („saved trainings…"): Zeile und
  Vorschlag zeigen den Namen, Umbenennen ändert die alte Zeile.

### Block 7: Tagebuch-Kopf (`features/diary/DiaryPage.tsx:93` bis 108, `components/SyncIndicator.tsx`)

- Reihenfolge der `actions`: `SyncIndicator`, `ClipboardMenu`, Teilen-Button.
- `SyncIndicator`: lokaler Zustand `tapped`; Tipp setzt ihn, `Promise.allSettled([sync.sync(), 1 s])` löscht ihn
  (nicht nach dem Aushängen). Solange `tapped` oder `status === 'syncing'`: drehender `LoaderCircle` und Label
  „Synchronisiere…"; danach das Icon des echten Zustands. Der automatische Sync bleibt ohne Mindestdauer.
- Tests: Komponententest mit falschen Timern (sofort fertiger Sync dreht 1 s; Fehler/offline dreht 1 s und zeigt
  dann `CloudOff`); E2E, die die Kopf-Reihenfolge prüfen (`share-day.spec.ts`), anpassen.

### Block 8: Doku

- `CLAUDE.md`: Suche (Reiter als Filter, `scope`, `pinned`, kein Kamera-Icon), der Satz „food page and search
  replace each other" und der Absatz „Add menu" (Buttons unter der Kamera, gemeinsames Formular, `form`,
  „Offene Analysen"), Rädchen-Regel (`held`, Raster, Rad folgt dem Wert), neue Navigationsregel mit `logFlow` und
  `diaryScroll`, `note` am Eintrag, `templateId` und Trainingsnamen, 20-Minuten-Regel (`logTargetFor`),
  Kopf-Reihenfolge und Mindestdauer der Wolke.
- `docs/sync.md` (Felder), Statusblock dieses Plans.

## Verifikation

- Je Block: `pnpm lint`, `pnpm typecheck` (nacheinander), `pnpm test`. `pnpm e2e` nach Block 2, 3, 4 und 6
  (Chromium; WebKit `ios-layout.spec.ts` nur, wenn installiert, sonst im Status vermerken).
- Sichtprüfung mit dem Produktions-Build über die API (`WEB_DIST=… pnpm --filter @ft/api dev`, Hinweise in der
  Memory-Notiz „Dev-Proxy-Login") und Playwright-Screenshots im iPhone-Format, hell und dunkel: Kameraseite mit
  den zwei Buttons, Formular in allen vier Button-Zuständen, Suche mit aktivem Filter-Reiter, Trainingszeile mit
  Namen, Tagebuch-Kopf.
- Nur am iPhone prüfbar, dem Nutzer am Ende als Liste nennen: Rädchen (drehen, Finger kurz halten, weiterdrehen,
  langsam loslassen; Wert im Feld = Zeile im Rad), Scrollposition nach Eintragen und nach Zurück, Kamera startet
  nach Zurück aus der Suche, Wischen in „Offene Analysen".

## Ablauf für Fable

Lesereihenfolge: dieser Plan, `CLAUDE.md`, dann je Block die genannten Dateien. Vor Block 4 und 6
`.claude/skills/offline-sync/SKILL.md` und `docs/sync.md`, vor 4c den Skill `claude-api`.

Reihenfolge der Blöcke 1 bis 8 wie oben (3 vor 4, weil 4 `returnToDiary` nutzt). Je Block ein Commit
(Commit-Text englisch, Attribution laut Session-Hinweis), davor Lint, Typecheck und Tests wie unter Verifikation.
Keine em- oder en-Striche in UI-Texten, Kommentaren und Doku. UI-Texte deutsch nach der Wortregel (eintragen,
speichern, hinzufügen nur für Zutaten).

Abweichungen vom Plan im Statusblock festhalten und dem Nutzer nennen, nicht still entscheiden; das gilt
besonders für die Annahmen oben. Zeigt ein roter Test in Block 1 eine andere Ursache als beschrieben, erst die
Ursache klären, dann ändern. Nach dem letzten Block: Status aktualisieren, die iPhone-Prüfliste nennen, nicht
pushen, bis der Nutzer es sagt (beide Migrationen laufen beim nächsten Deploy automatisch mit).
