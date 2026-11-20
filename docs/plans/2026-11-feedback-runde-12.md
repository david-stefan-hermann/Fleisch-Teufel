# Feedback-Runde 12: Wochenleiste, Tagesziel, Drehen, Android-Icon, Kamera, Figuren-Bug (Planungsgrundlage)

Zusammenfassung der Wünsche vom 2026-11-19 und 2026-11-20 (Nutzer und Android-Testerin) mit den getroffenen
Entscheidungen, den offenen Fragen und den Fundstellen im Code. Grundlage für den Implementierungsplan, der in einer
eigenen Sitzung entsteht; hier ist nichts umgesetzt. Stand des Codes: `2121829` (main, gepusht, Arbeitsbaum sauber).

Für die Planungssitzung:

- UI-Punkte (1, 3, eventuell 2 und 6) gehen nach dem üblichen Ablauf zuerst als Mockup an den Nutzer, sofern er nicht
  direkt den Implementierungsplan bestellt (Runde 11 hatte keinen Mockup-Schritt). Mockups von Grund auf neu denken.
- Regeln aus `CLAUDE.md`: keine Erklärtexte im UI, keine Gedankenstriche, deutsche UI-Texte, englischer Code.
- Push-Stand nie aus diesem Dokument ableiten, immer `git fetch` + `git status -sb`.

## Übersicht

| Nr. | Thema                                          | Plattform   | Entscheidung                      | Offen                         |
| --- | ---------------------------------------------- | ----------- | --------------------------------- | ----------------------------- |
| 1   | Wochenleiste „Letzte Tage“ als Einstellung     | alle        | ja, Details unten                 | Fenster bei vergangenen Tagen |
| 2   | Drehen ins Querformat verhindern               | iPhone      | ja                                | Meldung oder gedrehtes Layout |
| 3   | Tage markieren: im Ziel oder drüber            | alle        | jeder Tag mit Eintrag, auch heute | Aussehen, Toleranz            |
| 4   | Dunkles App-Icon auf Android                   | Android     | erst auf dem Gerät testen         | ob Chrome das Icon tauscht    |
| 5   | Pfeile neben „Heute“ entfernen                 | alle        | ja                                | nichts                        |
| 6   | Assistent-Knopf nicht auf dem Kamerabild       | alle        | ja                                | wohin mit dem Knopf           |
| 7   | Kamera: Fokus für Nahaufnahmen                 | nur Android | ja, Details unten                 | Kamerawahl                    |
| 8   | Bug: Figuren-Bilder laden erst nach einem Tipp | alle        | beheben                           | Ursache bestätigen            |

Nicht Teil der Runde: Schritte auf Android automatisch anrechnen. Das gibt es schon (HC Webhook,
`POST /api/steps/health-connect`, Commit `e9f1f06`, Einrichtung unter Mehr → Schritte).

## 1. Wochenleiste: Einstellung „Kalenderwoche“ oder „Letzte Tage“

Wunsch: Man trägt nichts Tage im Voraus ein; am Montag zeigt die Leiste heute sechs Zukunftstage.

Entscheidungen des Nutzers:

- Neue Einstellung pro Gerät unter Mehr → Aussehen, Abschnitt „Tagebuch“ (wie `DiaryMacrosPref`, `localStorage`,
  `lib/appearance.ts`, `features/more/AppearancePage.tsx`). Werte: „Kalenderwoche“ (heutiges Verhalten, Standard) und
  „Letzte Tage“. `/more` nennt die Einstellung nur, wenn sie nicht auf dem Standard steht (wie bei den Makros).
- „Letzte Tage“: heute ist der zweite Tag von rechts. Die Leiste zeigt die fünf Tage davor, heute und morgen. Die
  Wochentag-Kürzel gehören dann zum jeweiligen Tag (nicht mehr fest Mo bis So).
- Die Pfeile springen in beiden Varianten wie heute um eine Woche vor oder zurück.

Offen (Vorschlag für die Planung): Das Fenster bei „Letzte Tage“ ist an heute verankert und verschiebt sich nur in
Schritten von 7 Tagen. Ein gezeigter Tag liegt immer im Fenster `[heute + 1 − 7k − 6, heute + 1 − 7k]`. Ein Tipp auf
einen Tag in der Leiste verschiebt sie also nicht, die Pfeile verschieben Tag und Fenster um genau 7 Tage.

Code: `features/diary/WeekStrip.tsx` (`startOfWeek`, `dateRange`, `WEEKDAYS_SHORT_DE[i]`, `dateParam`), die Hooks
`useLoggedDates`/`useTrainedDates` (`hooks/data.ts`) nehmen schon `from`/`to`. Tests: Unit-Test für die
Fensterberechnung (reine Funktion), E2E für beide Varianten.

## 2. Drehen ins Querformat verhindern (iPhone)

Wunsch: Die App soll nicht ins Querformat drehen. Tritt auf dem iPhone des Nutzers auf.

Stand: Das Manifest hat `orientation: 'portrait'` (`apps/web/vite.config.ts`), das wirkt nur bei installierten PWAs auf
Android. iOS ignoriert es, und eine Web-App kann die Drehung dort nicht sperren (`screen.orientation.lock` gibt es auf
iOS nicht).

Möglichkeiten (im Plan entscheiden, eventuell den Nutzer fragen):

- a) Im Querformat auf Telefonen (Querformat und geringe Höhe, z. B. `(orientation: landscape) and (max-height: 500px)`,
  nicht iPad/Desktop) eine Vollbild-Fläche mit Logo und „Bitte hochkant halten“ über die App legen. Robust, wenig Code.
  Der Satz ist eine Bedienanweisung; als Zustand („Nur im Hochformat“) prüfen, ob er zur Regel „keine Erklärtexte“
  passt.
- b) Das Hochformat-Layout um 90° gedreht zeigen. Kämpft mit Safe Areas, Tastatur, Kamera, `--vvh`/`--vvt`; nicht
  empfohlen.

Empfehlung: a). Testen im WebKit-Projekt (`ios-layout.spec.ts`, Viewport quer).

## 3. Tage in der Wochenleiste: im Ziel oder drüber

Wunsch: Jeder Tag der Leiste zeigt, ob das Kalorienziel eingehalten wurde oder man drüber lag.

Entscheidung des Nutzers: bewertet wird jeder Tag mit mindestens einem Eintrag, auch der laufende Tag, unabhängig von
„vollständig“ (`isCompleteDay`).

Offen:

- Aussehen neben den vorhandenen Punkten (rot = Essen, blau = Training). Idee: der Essens-Punkt trägt die Bewertung
  (grün `--over-good` im Ziel, `--over` drüber); oder ein farbiges Datum. Ausgewählter Tag (`bg-primary`) muss lesbar
  bleiben, ebenso hell und dunkel. Mockup.
- Grenze: vermutlich `kcalBudget` wie die Kalorienkarte (Ziel plus angerechnetes Training und Schritte, `dayBudget`),
  ohne Toleranz. Den Nutzer zur Toleranz fragen.
- Die Regel „no streaks, no verdicts“ (`WeekReviewCard`) gilt für die Wochenkarte; hier wünscht der Nutzer ausdrücklich
  die Markierung. Keine Serien oder Zählungen daraus ableiten.
- `sr-only`-Text der Tage um den Zustand ergänzen („im Ziel“ / „über dem Ziel“).

Code: `WeekStrip.tsx`; Daten braucht ein Hook, der pro Tag kcal und Budget liefert (Bausteine: `dayBudget`,
`creditedTrainingKcal`, `dailyRows` in shared `reports.ts`, `components/NutrientBreakdown.tsx`/`CalorieCard.tsx` für
`kcalBudget`). Eine Live-Query für die sieben Tage, keine pro Tag.

## 4. Dunkles App-Icon auf Android

Wunsch: Auf Android lässt sich die Icon-Farbe nicht wechseln.

Stand: Mehr → Aussehen → Icon (`lib/appearance.ts`, `ICON_FILES`) tauscht Favicon, In-App-Logo und
`apple-touch-icon`. Das Android-Startbildschirm-Icon kommt aus `icons` des Manifests (vite-plugin-pwa, eine Datei,
helle Variante) und wird beim Installieren in die WebAPK übernommen.

Recherche: Das Manifest kennt kein helles und dunkles Icon (W3C-Issues #975/#1091 offen, Microsoft-Vorschlag
`color_scheme` an Icons nicht ausgeliefert). `purpose: 'monochrome'` für Android-Designsymbole übernimmt Chrome für das
Startbildschirm-Icon nicht verlässlich.

Möglicher Weg, **zuerst als Spike auf einem Android-Gerät prüfen**:

- Zwei Manifeste (hell, dunkel; gleiche `id`, nur andere `icons`). `public/theme-init.js` setzt vor dem ersten Paint
  `<link rel="manifest">` nach `ft.icon`, `applyAppearance` bei jeder Änderung.
- Wer vor dem Installieren „dunkel“ wählt, bekommt das dunkle Icon (sehr wahrscheinlich).
- Unbestätigt: ob Chrome bei einer installierten App das neue Icon übernimmt (WebAPK-Update-Prüfung beim Start, etwa
  einmal am Tag, mit Nachfrage-Dialog bei Icon-Wechsel) und ob ein per JS getauschter Manifest-Link dafür zählt.
- Scheitert der Spike: auf Android (`isAndroid`) die Auswahl nur für das Logo in der App anbieten (Bezeichnung
  entsprechend, kein Erklärsatz).

## 5. Tagesansicht: Pfeile neben „Heute“ entfernen

Wunsch: Die Pfeile links und rechts vom Tagestitel fallen weg; die Wochenleiste darunter kann das schon.

Code: `features/diary/DiaryPage.tsx` (Buttons „Vorheriger Tag“/„Nächster Tag“, `go(addDays(...))`; „Datum wählen“
bleibt). Klären, was den frei werdenden Platz bekommt (Titel zentriert lassen).

E2E-Specs, die die Pfeile benutzen und umgestellt werden müssen (auf die Tage der Wochenleiste oder `?date=`):
`meals-unified.spec.ts:79,94`, `share-day.spec.ts:137-140`, `meals-goals.spec.ts:1299`,
`day-meals.spec.ts:364,488,498`. Bei Wochengrenzen braucht der Test den Wochenpfeil der Leiste.

## 6. Fotoseite: Assistent-Knopf liegt auf dem Kamerabild

Wunsch der Android-Testerin (Sprachnachricht 2026-11-20): Der Sprachassistent soll auf der Fotoseite nicht auf dem
Kamerabild liegen, sondern unten. Er lässt sich nicht aus dem Kamerabild herausziehen; dreimal hat sie statt des
Auslösers den Assistenten getroffen, weil die Figur im Weg war.

Stand: `features/assistant/AssistantButton.tsx` weicht `nav[aria-label="Hauptnavigation"]`, `[data-page-footer]`,
`[data-ai-avoid]` und Toasts aus. Auf `/photo` tragen `data-ai-avoid` die Auslöser-Leiste (`CameraStep.tsx:79`) und die
Knöpfe „Eingeben“/„Suchen“ (`PhotoPage.tsx:201`). Der Knopf landet trotzdem über dem Bild, und das Einrasten am Rand
lässt keinen Platz außerhalb. Größe und Figur verschärfen es (`ASSISTANT_SCALE` bis 2, `skinOverhang`).

Möglichkeiten (zuerst Screenshot der Fotoseite mit großem Skin auf einem schmalen Android-Viewport ansehen):

- a) Das Kamerabild selbst als Sperrfläche markieren, der Knopf rutscht darunter (unter „Eingeben“/„Suchen“ oder in
  den freien Bereich darunter).
- b) Auf dem Kamera-Schritt den schwebenden Knopf ausblenden (wie bei offenen Dialogen); Sprache bleibt über den Knopf
  im Plus-Menü erreichbar.

Ausweichen und Ziehen gemeinsam prüfen: Wenn der Knopf gezogen wird, darf er auch dort nicht über dem Bild einrasten.

## 7. Kamera: Fokus für Nahaufnahmen (nur Android)

Wunsch der Android-Testerin: Für die Nährwerttabelle muss sie das Telefon nah heranhalten, die Kamera stellt aber
nicht scharf. Auf dem iPhone hatte der Nutzer kein Problem; dort bleibt alles wie es ist.

Entscheidung des Nutzers:

- `focusMode: 'continuous'` anfordern, wo der Track es meldet.
- Tippen ins Bild fokussiert auf diese Stelle (`pointsOfInterest`, bei Bedarf `focusMode: 'single-shot'`), mit kurzem
  Fokusring.
- Prüfen, ob Chrome bei Telefonen mit mehreren Rückkameras eine Kamera mit schlechtem Nahfokus wählt (Ultraweitwinkel
  oder Tele), und dann gezielt die Hauptkamera nehmen (`enumerateDevices`, Labels, `getCapabilities`).
- Alles nur über `track.getCapabilities()` / `applyConstraints` und nur wenn gemeldet; iOS meldet nichts davon, also
  ändert sich dort nichts.

Code: `components/cameraWarmup.ts` (`CAMERA_CONSTRAINTS`, `takeWarmStream`), Kamera der Fotoseite (`CameraStep.tsx`),
`components/BarcodeScanner.tsx`, Etikett-Kamera (`LabelCaptureSheet` auf `PhotoCaptureSheet`). Eine gemeinsame
Funktion für Fokus und Tippen, damit alle drei Kameras sie nutzen. Tests: Unit-Test mit einem gefälschten Track
(Capabilities vorhanden / fehlen).

## 8. Bug: Bilder der hochgeladenen Assistent-Figuren erscheinen erst nach einem Tipp

Meldung des Nutzers (2026-11-20): Unter Mehr → Aussehen → „Assistent“ erscheinen die Bilder der Figuren erst, wenn man
einmal auf die Kachel tippt. Auf iPhone und Android, nur bei hochgeladenen Figuren (Packs wie Elfenmagierin,
Dämonin), nicht beim eingebauten Teufelchen.

Wahrscheinliche Ursache (Code gelesen, nicht reproduziert): `features/assistant/skins/UploadedSkins.tsx` zeigt zwei
Arten von Kacheln. Packs, die schon auf dem Gerät liegen (`db.assistantSkins`), zeigen über `LocalTile` ihre Bilder.
Packs, die nur auf dem Server liegen (`remoteOnly`: in `GET /api/assistant/skins`, aber nicht in Dexie, z. B.
auf einem anderen Gerät hochgeladen), zeigen absichtlich `STANDARD_SKIN` mit dem Namen, weil die Liste des Servers
keine Bilder enthält. Erst ein Tipp lädt das Pack (`choose` → `downloadSkin`, `GET /api/assistant/skins/:id`, ganzes
Zip) und **wählt die Figur dabei gleich aus** (`setAssistantSkin`). Man kann also eine Figur nicht ansehen, ohne sie
einzustellen.

Lösung für die Planung (Vorschlag): Beim Öffnen der Seite (online) alle `remoteOnly`-Packs im Hintergrund nach Dexie
laden (nacheinander, Fehler still, Kachel pulsiert solange wie heute bei `busy`); ein Tipp wählt dann nur noch aus.
Packs sind klein (bis `MAX_SKINS`, Größe beim Hochladen begrenzt), ein Herunterladen pro Gerät reicht. Alternative:
ein Vorschaubild pro Pack in der Server-Liste (mehr Code auf dem Server, kein Vorteil, weil das Pack beim Auswählen
ohnehin geladen wird). Offline bleibt die Kachel wie heute. Tests: Komponenten-Test mit Server-Liste ohne lokale
Kopie (Bilder erscheinen ohne Tipp, Auswahl unverändert).

## Quellen (Punkt 4)

- W3C manifest #975: https://lists.w3.org/Archives/Public/public-webapps-github/2026Feb/0108.html
- W3C manifest #1091: https://lists.w3.org/Archives/Public/public-webapps-github/2023May/0752.html
- Microsoft-Vorschlag ImageResource color_scheme:
  https://github.com/MicrosoftEdge/MSEdgeExplainers/blob/main/ImageResource-color_scheme/explainer.md
- web.dev Maskable Icons: https://web.dev/maskable-icon/
