# Feedback-Runde 7: Implementierungsplan

Projekt: `/projects/Fleisch-Teufel`. Abgelegt als `docs/plans/2026-10-feedback-runde-7.md`, wird mit dem ersten Block committet.
Ablauf wie in den Runden 4 bis 6: zuerst das Mockup (Schritt 0) für Mengen-Editor und Desktop-Banner, erst nach dem OK
des Users die Blöcke.

## Context

Rückmeldung des Users (2026-10-09):

1. **Kamera fragt bei jedem Scan/Foto nach der Erlaubnis.** Erledigt ohne Code: iOS-Einstellungen → Apps → Safari →
   Kamera → „Erlauben“ hat geholfen. Eine Lösung im Code, die die Kamera nach dem Schließen weiterlaufen lässt
   (etwa 30 s, grüner Punkt), hat der User als zu nervig **abgelehnt**. Die Kamera geht also beim Schließen weiterhin sofort aus.
2. **Die Kamera braucht 1 bis 1,5 s, bis sie ein Bild zeigt.** Den größten Teil davon braucht iOS für den Start der
   Kamera-Hardware, das kann die App nicht beeinflussen. Ziel dieser Runde: die Wartezeit, die die App selbst verursacht, abziehen und den Start ruhiger
   aussehen lassen. Erwartung realistisch halten: etwa 0,1 bis 0,3 s schneller, unter etwa 0,7 bis 1 s kommt man als Web-App kaum.

Nachtrag (User, 2026-10-09, Screenshots `user-input/IMG_3694..3697.PNG`):

3. **Mengen-Slider sind verbuggt** (KI-Review „Ergebnis prüfen“): Der Daumen steht bei 20 g, 80 g und 3050 g an
   derselben Stelle, beim Ziehen wachsen die Werte explosionsartig (bis „79.288.475.859.319.490.000 kcal“), danach
   läuft die Karte rechts aus dem Bild (kcal und Gramm-Feld abgeschnitten).
4. **„Auch an weiteren Tagen eintragen“** auf der Eintrageseite (`/food/$foodId`) soll weg.
5. **Einheitlicher Mengen-Editor** zum Eintragen und Bearbeiten von Lebensmitteln in der ganzen App, mit Slider und
   Eingabefeld. Zuerst als Mockup.
6. **Banner in der Desktop-Version**, das zur Installation der mobilen App auffordert. Ebenfalls ins Mockup.

### Entscheidungen (User, 2026-10-09)

- Keine native App: Sie soll nichts kosten und dauerhaft auf dem Handy bleiben, und das schafft nur die PWA.
- Die Kamera läuft nicht weiter, wenn kein Kamerabild sichtbar ist. Davon ausgenommen ist nur der kurze Vorstart aus Block 1,
  und der endet nach höchstens 3 s.
- Auflösung bleibt (`1920×1440 ideal`): Fotos für die KI-Analyse kommen aus demselben Stream.
- Ein Mengen-Editor `AmountEditor` für alle Mengen-Eingaben der Tabelle unten außer den Gesamtmenge-Faktoren.
- Der Mehrtage-Link entfällt ersatzlos, auch im Draft (`extraDays`).
- Mockup vor Code für Mengen-Editor und Desktop-Banner; Slider-Bugfix und Mehrtage-Link brauchen kein Mockup.

### Entscheidungen zum Mockup v2 (User, 2026-10-09)

- Mengen-Editor **Variante A** (gestapelt): Kopf „Menge“ mit Einheiten-`Select` rechts, Slider über die volle Breite
  mit Skala, darunter − Feld + und bei Portionen „= X g“.
- Der Slider startet **genau in der Mitte**: Ende = 2 × Startmenge, die mittlere Markierung der Skala ist die
  Startmenge (Skala 0 / Startmenge / Ende). Startmenge = Menge beim Öffnen, nach Einheitenwechsel oder nach dem
  Verlassen des Felds; Ziehen ändert sie nie. Ende nie über `MAX_AMOUNT`.
- Raster: **1 g bzw. 1 ml**, bei Portionen **0,1** (1,1 Portionen statt gleich 1,5). − und + springen um einen
  Rasterschritt.
- „Nährwerte dieser Menge“ zeigt die Standard-Übersicht `NutrientBreakdown` (Variante `item`), wie heute auf der
  Eintrageseite; im Mockup v1 war sie nur vereinfacht gezeichnet.
- ~~Desktop-Banner Variante A, Handy-Leiste „Wie?“~~ (v2) ersetzt durch das **Install-Banner** aus Mockup v3
  (User, 2026-10-09: „wie die App-Store-Banner vieler Webseiten, im Stil des Update-Banners“): etwa 3 s nach dem
  Start gleitet oben ein Banner in der Form von `Banner` in `AppBanners` herein: App-Icon, „Fleisch-Teufel“, eine
  Zeile („Kostenlos, ohne App Store“ bzw. am Computer „Als App aufs Handy holen, kostenlos“), Knopf, Schließen-X.
  - iPhone: „Installieren“ öffnet einen Dialog mit den drei Schritten (Safari → Teilen → „Zum Home-Bildschirm“ →
    „Hinzufügen“) und „Verstanden“. Safari erlaubt keine Installation per Skript.
  - Android/Chrome: „Installieren“ ruft das gespeicherte `beforeinstallprompt`-Ereignis auf (Dialog von Chrome).
    Ohne das Ereignis: Dialog mit Hinweis aufs Chrome-Menü.
  - Computer: Knopf „Aufs Handy“ öffnet einen Dialog mit QR-Code der App-Adresse und Kurzanleitung.
  - Nur im Browser (nicht standalone), nach dem Schließen nie wieder auf diesem Gerät. Ersetzt den heutigen
    iPhone-Hinweis.
  - Mockup v4: oben steht **immer höchstens ein Banner** (Vorrang: Sitzung abgelaufen, dann Update, dann Install),
    nichts überlappt. Solange ein anderes Banner sichtbar ist, wartet das Install-Banner; die 3 s laufen erst, wenn
    kein anderes Banner mehr da ist. Banner schieben den Inhalt nach unten, sie liegen nie darüber.
  - Ein Installieren ohne die Schritte geht auf dem iPhone nicht (Safari hat keine Schnittstelle dafür, auch
    `navigator.install` gibt es dort nicht); auf Android/Chrome reicht ein Tap plus Bestätigung im Chrome-Dialog.
- Einheitenwechsel auch in der KI-Review (wie im Mockup): Die Zeile merkt sich die gewählte Portion, eingetragen wird
  sie mit Portion und Anzahl. Mockup v4 vom User freigegeben (2026-10-09: „Plan inklusive der besprochenen Änderungen umsetzen“).

### Heutiger Ablauf Kamera (Code)

- Alle Kameraansichten nutzen `BarcodeScanner` (`apps/web/src/components/BarcodeScanner.tsx`): `/photo`
  (`features/ai/PhotoPage.tsx`, `CameraCapture`), `/scan` (`features/foods/ScanPage.tsx`), `LabelCaptureSheet`,
  `BarcodeScanSheet`.
- `getUserMedia` startet erst im `useEffect` nach dem Mount (`BarcodeScanner.tsx:168`). Davor laufen: Tap →
  `navigate` → Laden des lazy Route-Chunks (`lazyRouteComponent`, `app/router.tsx:144`, `defaultPreload: false`) →
  Render → Effect. Beim Schließen: `getTracks().forEach(stop)` (`:217`).
- Bis das erste Bild kommt, zeigt das `<video>` eine schwarze Fläche, dann springt das Bild auf.
- Einstiege zu `/photo`: Add-Menü-Kachel „Essen eintragen“ (`components/AddSheet.tsx:83`), „+“ einer Mahlzeit
  (`features/diary/MealCard.tsx:74,82`, `features/diary/DiaryMealPage.tsx:64,90`), Kamera-Link in der Suche
  (`features/foods/AddFoodPage.tsx:188`).

### Ursache des Slider-Bugs (Code geprüft)

- `rowSliderMax(base, grams)` (`apps/web/src/lib/amounts.ts:2`) setzt `max = max(50, 2,5 × base, grams)`.
- In der KI-Review ist `base = scaleBase[key]`, und jedes `update` läuft über `commitRows`
  (`features/ai/PhotoPage.tsx:538-544`), das `setScaleBase(rowGrams(next))` aufruft. Also ist `max` immer etwa
  2,5 × der aktuelle Wert: Der Daumen steht immer bei ca. 40 %, und beim Ziehen hebt jeder Tick das `max`, der
  nächste Tick rechnet gegen das größere `max`: exponentielles Wachstum. Keine Obergrenze.
- Derselbe Fehler steckt in `IngredientCard` (`features/meals/IngredientCard.tsx:71-73`) über `commitItems` →
  `setScaleBase(items)` in `MealEditor.tsx:82-86` und `DiaryGroupPage.tsx:111-115`.
- Überlauf: Kartenkopf in `PhotoPage.tsx:714-731` hat rechts kein `shrink-0`, der Karten-Grid keine
  `minmax(0,1fr)`-Spalte, eine lange Zahl macht den Grid breiter als die Karte. `IngredientCard` macht es schon richtig.
- Zusätzlich schreibt jeder Slider-Tick den Draft in Dexie (`commit` → `db.aiQueue.update`).

### Heutige Mengen-Eingaben (Bestand)

| Ort                                                            | Datei                                                                                      | Bedienung heute                                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Eintragen / Eintrag bearbeiten `/food/$foodId`                 | `features/foods/FoodLogPage.tsx:388-438`                                                   | Portions-`Select`, −/+ um `NumberField` „Anzahl Portionen“, „= X g“. Kein Slider |
| KI-Review Zutat                                                | `features/ai/PhotoPage.tsx:777-794`                                                        | Slider + `NumberField` „Gramm“ (eigener Code)                                    |
| Meal-Editor, Diary-Gruppe                                      | `features/meals/IngredientCard.tsx`                                                        | Slider + `NumberField` „Gramm“ bzw. „Anzahl · Portion“                           |
| Gesamtmenge (Meal-Editor, Gruppe, KI-Review), „Meal eintragen“ | `MealEditor.tsx:205`, `DiaryGroupPage.tsx:239`, `PhotoPage.tsx:826`, `MealLogView.tsx:165` | Faktor-Slider, kein Mengen-Editor; bleiben außerhalb des Umfangs                 |

## Schritt 0: Mockup (vor jedem Code; Stand v1, die Entscheidungen zu v2 oben gehen vor)

Datei `docs/plans/2026-10-feedback-runde-7-mockup.html` nach dem Muster von `2026-10-feedback-runde-6-mockup.html`
(Tokens aus `index.css`, Phone-Frames 375 px, jede Variante hell und dunkel nebeneinander, Versionszeile
„Mockup v1“, Box „Entschieden“ leer, später „Neu gegenüber vX“). Keine App-Dateien ändern. Danach auf das OK warten.

**A. Mengen-Editor** (gleiche Komponente in allen Frames):

- Aufbau: Zeile 1 Einheit/Portion (`Select`: „g“, „ml“ oder die Portionen des Lebensmittels, „+ Eigene Portion“ wie
  heute), Zeile 2 Slider über die volle Breite, Zeile 3 −/+ um das Eingabefeld (16 px Text) und rechts „= X g“ bzw.
  kcal der Menge. Varianten zeigen: (a) Slider über dem Feld, (b) Slider und Feld in einer Zeile wie heute.
- Slider-Skala: fester Bereich je Lebensmittel, nicht je aktuellem Wert. Bereich 0 bis `max(50, 2,5 × Referenz)`
  (Referenz: gewählte Portion oder 100 g bzw. Startmenge beim Öffnen), Schritt 5 g bzw. 0,5 Portionen, Tick-Labels
  bei 0, Referenz, max. Werte über `max` nur per Feld; dann steht der Daumen am Ende, und der Bereich wächst erst
  beim Loslassen bzw. Verlassen des Felds (`onValueCommit`/`blur`). Frames: 20 g, 80 g und 3050 g nebeneinander,
  damit die Daumenpositionen sichtbar verschieden sind.
- Einsatzorte als Frames: `/food/$foodId` neu eintragen (ohne Mehrtage-Link), Eintrag bearbeiten („Änderungen
  übernehmen“), KI-Review-Zutat (mit Datenbank-Auswahl und Nährwerte-Disclosure), Meal-Editor-Zutat in Stück.
- Lange Zahlen: Frame mit 9.999 g zeigt, dass Kopf und Feld nicht überlaufen (Obergrenze Feld 9.999 g/ml bzw. 99 Portionen).

**B. Desktop-Install-Banner**:

- Erscheint nur im Desktop-Browser (`(pointer: fine)` und Breite ≥ 768 px, nicht `isStandalone()`), oben im
  bestehenden Banner-Stapel `app/AppBanners.tsx` neben dem iOS-Hinweis. Inhalt: QR-Code mit der App-URL,
  „Fleisch-Teufel aufs Handy holen“, Kurzanleitung iPhone (Safari → Teilen → „Zum Home-Bildschirm“) und Android
  (Chrome → „App installieren“), Schließen-X (merkt sich `ft.desktopInstallDismissed`).
- Varianten: (a) schmales Banner über der Spalte, aufklappbar zum QR-Code, (b) Karte rechts neben der `max-w-xl`-Spalte
  (nutzt den leeren Desktop-Rand). Jeweils in einem Desktop-Frame (ca. 1280 × 800) hell und dunkel.

## Block 1: Kamera beim Tippen vorstarten

Neues Modul `apps/web/src/components/cameraWarmup.ts` (kein React, keine `@/`-Pflicht):

- `CAMERA_CONSTRAINTS`: die heutigen Constraints aus `BarcodeScanner.tsx:168` hierher verschieben, damit Vorstart und Scanner
  identisch anfragen.
- `warmUpCamera()`: startet `getUserMedia(CAMERA_CONSTRAINTS)`, falls noch kein Vorstart läuft, und merkt sich das
  Promise. Fehler werden geschluckt (der Scanner fragt dann selbst und zeigt seine Fehler wie heute). Ein Timer
  stoppt die Tracks, wenn der Stream nach 3 s nicht abgeholt wurde (z. B. Tap und gleich zurück).
- `takeWarmStream(): Promise<MediaStream> | null`: gibt den vorgestarteten Stream einmalig heraus und löscht den
  Timer. Ist der Stream schon beendet (`track.readyState === 'ended'`), wird `null` zurückgegeben.
- `BarcodeScanner.start()`: `stream = await (takeWarmStream() ?? navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS))`,
  den Fehlerpfad nicht ändern. Liefert der Vorstart einen Fehler, fragt der Scanner normal per `getUserMedia`.
- Aufrufe von `warmUpCamera()` im Tap-Handler **vor** `navigate`, damit Seitenwechsel und Kamerastart parallel
  laufen: `AddSheet` „Essen eintragen“, `onClick` an den `/photo`-Links in `MealCard`, `DiaryMealPage`, `AddFoodPage`.
  Der Stream muss im Tap-Handler angefordert werden, für iOS zählt das als Nutzergeste.
- Den Route-Chunk von `/photo` gleich mitladen: `router.preloadRoute({ to: '/photo', search })` oder `preload="intent"` an den
  Links. Ob das spürbar ist, hängt vom Precache des Service Workers ab: kurz messen und beibehalten, wenn es
  nichts kaputt macht.
- Nicht vorstarten: `/scan` nach einem erkannten Barcode (die Kamera ist dort aus), Etikett- und Barcode-Sheet
  (öffnen innerhalb einer Seite, Vorstart bringt dort wenig). Später als Erweiterung möglich.
- Tests: `cameraWarmup.test.ts` mit gemocktem `navigator.mediaDevices`: einmaliges Abholen, Stopp nach 3 s ohne
  Abholen (fake timers), Fehler im Vorstart führt zu `null`/normalem Pfad, zweiter `warmUpCamera()`-Aufruf startet
  nicht doppelt.

## Block 2: Kamerabild weich einblenden

- `BarcodeScanner.tsx`: State `ready` (false bis zum ersten Frame: `loadeddata`/`playing` am `<video>`, bei
  Unterstützung `requestVideoFrameCallback`). Das Video blendet mit `opacity` über etwa 150 ms ein (`transition-opacity`, kein
  `transition-all`). Darunter bleibt die schwarze Fläche mit einem dezenten Kamera-Icon oder Spinner
  (`text-white/60`, `aria-hidden`); die Rahmen und Overlay-Buttons sind sofort sichtbar.
- Kein Layout-Sprung: Das Seitenverhältnis bleibt `aspect-[3/4]`.
- Der Auslöser im Foto-Modus bleibt bis `ready` deaktiviert (heute meldet `shoot()` per Toast „Die Kamera liefert
  noch kein Bild.“). Den Toast als Rückfall behalten.
- `prefers-reduced-motion`: ohne Übergang einblenden.

## Block 3: Slider-Bug beheben (unabhängig vom Mockup)

- `lib/amounts.ts`: `sliderRange(start)` ersetzt `rowSliderMax`: `{ min: 0, max: min(2 × start, MAX_AMOUNT), step }`
  mit Schritt 1 (g/ml) bzw. 0,1 (Portionen); `start` kommt nie aus dem Wert, der gerade gezogen wird. Konstante `MAX_AMOUNT` (9.999 g/ml, 99 Portionen), Clamp in `update`/`onChange`; das
  Slider-Ende liegt nie über `MAX_AMOUNT`.
- KI-Review, `MealEditor`, `DiaryGroupPage`: `scaleBase` (Basis der Gesamtmenge) und die Slider-Referenz trennen;
  `setScaleBase` nur bei Hinzufügen, Entfernen, Tauschen und `onValueCommit`, nicht pro Tick.
- KI-Review-Kartenkopf: `shrink-0` rechts, Grid `grid-cols-[minmax(0,1fr)]`, Name `break-words`.
- Dexie-Schreiben während des Ziehens drosseln (lokaler State, Commit bei `onValueCommit`), falls es mit dem
  Fix nicht ohnehin entfällt.
- Tests: `sliderRange` (Start genau in der Mitte, kein Wachstum bei wiederholtem Setzen, Kappung bei `MAX_AMOUNT`), Clamp.

## Block 4: „Auch an weiteren Tagen eintragen“ entfernen

- `FoodLogPage.tsx:462-500` samt `extraDays`/`showDays`, Imports `CalendarPlus`, `fmtDayShort` (dann ungenutzt
  in `lib/format.ts:40`, löschen).
- `foodLogDraft.ts`: Feld `extraDays` raus; alte Drafts mit dem Feld bleiben lesbar (Validator ignoriert es).
- `logFoodEntry` (`db/entries.ts:23-37`) auf ein Datum vereinfachen; Tests `test/write.test.ts:119-140` und
  Fixture `test/lib.test.ts:152` anpassen.

## Block 5: Einheitlicher `AmountEditor` (laut Mockup)

- Neue Komponente `components/AmountEditor.tsx` auf `Slider`, `NumberField` und `sliderRange`; Props: Wert,
  Einheit/Portionen, Referenz, `onChange`, `onCommit`.
- Einsetzen in `FoodLogPage` (ersetzt Select + −/+ + Feld), `IngredientCard` (Meal-Editor, Diary-Gruppe) und die
  KI-Review-Zutat (dort den eigenen Code durch `IngredientCard`-Teile bzw. `AmountEditor` ersetzen).
- Layout Variante A laut Mockup v2 (Skala mit Beschriftung 0 / Startmenge / Ende, − und + um einen Rasterschritt,
  Gedrückthalten wiederholt). Einheitenwechsel rechnet die Menge um und setzt die Startmenge neu.
- Eintrageseite: „Nährwerte dieser Menge“ bleibt `NutrientBreakdown`.

## Block 6: Install-Banner (laut Mockup v3)

- `app/pwa.ts`: `isDesktop()` (`(pointer: fine)` und Breite ab 768 px), `isAndroid()`; `beforeinstallprompt`
  früh abfangen (`preventDefault`, Ereignis merken) und `appinstalled` beachten.
- `app/AppBanners.tsx`: neues Banner `install` mit App-Icon (`/pwa-64x64.png`), Name, Unterzeile, Knopf und X, 3 s
  Verzögerung (Timer in einem Effect, der nur einen Event-Callback setzt), Einblenden von oben (`motion-reduce`
  ohne). Ersetzt den iPhone-Hinweis; Schließen in `ft.installHintDismissed` (bestehender Schlüssel).
- Dialoge `InstallDialog` (iPhone-Schritte bzw. Android-Rückfall) und `QrDialog` (Computer) auf `Dialog`/`DialogBody`.
- QR-Code mit einer kleinen Bibliothek ohne Abhängigkeiten (z. B. `uqr`), offline aus dem Bundle.
- `AppBanners` rendert nur das erste Banner nach Vorrang statt aller gestapelt.
- Test: Banner erscheint nach 3 s nur ohne standalone, ohne Schließen-Merker und ohne anderes Banner (fake timers).

## Block 7: Doku

- `CLAUDE.md` „Conventions & gotchas“: ein Satz zu `cameraWarmup.ts` (Vorstart im Tap-Handler vor `navigate`,
  Stop nach 3 s, die Kamera läuft sonst nie ohne sichtbares Bild).
- `CLAUDE.md`: `AmountEditor` (eine Komponente für jede Menge, Start in der Mitte, Ende 2 × Startmenge, Raster
  1 g / 0,1, Bereich nie aus dem gezogenen Wert), Install-Banner (iPhone, Android, Computer), Wegfall des Mehrtage-Eintrags.
- `CAM_ERRORS.permission` ist bereits richtig („iOS-Einstellungen (Safari → Kamera)“). Prüfen, ob der Hinweis auf
  „Erlauben“ statt nur „erlauben“ klarer ist, und den Text höchstens leicht ändern.

## Ablauf für Opus 5.5

- Lesen: dieser Plan, `CLAUDE.md`, `components/BarcodeScanner.tsx`, `features/ai/PhotoPage.tsx` (`CameraCapture`,
  Review-Karten), `components/AddSheet.tsx`, `features/meals/IngredientCard.tsx`, `features/foods/FoodLogPage.tsx`,
  `lib/amounts.ts`, `app/AppBanners.tsx`, `app/pwa.ts`.
- Schritt 0 zuerst, dann auf das OK des Users warten. Danach alle Blöcke am Stück.
- Ein Commit pro Block, vor jedem Commit `pnpm lint`, `pnpm typecheck`, `pnpm test`.
- React-Compiler-Regeln: kein `setState` in Effects außer in Event-Callbacks (`ready` über Video-Events setzen),
  `warmUpCamera()` nur in Event-Handlern, nie beim Rendern.
- Abweichungen vom Plan melden statt still zu entscheiden.

## Verification

- Unit-Tests aus Block 1, 3 und 4 grün, `pnpm e2e` (Chromium-Projekt nutzt eine Fake-Kamera; falls nicht, prüfen, dass
  `/photo` ohne Kamera den Fehlerpfad zeigt wie heute).
- Manuell im Container (Playwright mit `--use-fake-device-for-media-stream`): Tap auf „Essen eintragen“ ruft
  `getUserMedia` genau einmal auf (Spy), das Video blendet ein, nach Tap und sofortigem Zurück ist nach 3 s kein
  Track mehr aktiv.
- Playwright-Skript (Proxy :5174): KI-Review mit Demo-Draft, Slider ziehen, Wert bleibt im Bereich, Karte ohne
  horizontalen Überlauf (`scrollWidth <= clientWidth`); Desktop-Viewport 1280 × 800 zeigt das Banner, Mobil nicht.
- Auf dem iPhone (User, nach Deploy): Zeit vom Tap bis zum Bild vorher und nachher grob vergleichen; der grüne
  Kamerapunkt verschwindet beim Schließen sofort wie bisher; Slider in KI-Review, Meal-Editor und Eintrageseite.
