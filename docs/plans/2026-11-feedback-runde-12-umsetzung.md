# Feedback-Runde 12: Implementierungsplan

Implementierungsplan für eine neue Opus-5.5-Sitzung. Den Statusblock in dieser Datei pflegen.
Planungsgrundlage (Wünsche, Entscheidungen, Fundstellen): `docs/plans/2026-11-feedback-runde-12.md`. Dieser Plan
ersetzt sie nicht, er legt fest, wie sieben der acht Punkte gebaut werden (Punkt 2 entfällt, siehe „Entschieden“).

## Status

Umgesetzt am 2026-11-20 (Opus 5.5), alle acht Blöcke, nicht gepusht. Ausgangsstand `2121829`. Push-Stand nie aus
diesem Dokument ableiten: `git fetch` + `git status -sb`. Offen sind die Abnahme der Annahmen A14 bis A18 durch den
Nutzer, die Geräteprüfungen (Abschnitt „Verifikation“) und der Ausgang des Icon-Versuchs auf Android.

Überarbeitet am 2026-11-20 nach fünf Rückmeldungen des Nutzers: kein grüner Punkt, Punkt 2 (Telefon quer) wird gar
nicht gebaut (weder eine Fläche „Nur im Hochformat“ noch ein Zurückdrehen der App), kein Zoom, die Annahmen A3, A7,
A10 und A12 sind gestrichen (die Nummern bleiben frei, damit die übrigen Verweise gelten). Dritte Rückmeldung: die
Mockup-Wahl für Block 4 (fünf Darstellungen als Einstellung, siehe unten); dazu die neuen Annahmen A13 bis A17.
Vierte Rückmeldung: Standard ist A3, das heutige Aussehen bleibt als sechste Option (A13 ist damit entschieden).

Fünfte Rückmeldung (2026-11-20): „die farben sollen noch besser zeigen ob man im limit ist oder schon drüber“, „und
wie weit drüber“. Aus sechs Farbvorschlägen (Mockup v3, `docs/plans/2026-11-wochenleiste-farben-mockup.html`) hat der
Nutzer **K5** gewählt: im Ziel grün, drüber Rot in drei Stufen (siehe „Farb-Wahl“). Die Farben aus Mockup v2 gelten
nicht mehr; Formen, Optionen, Einstellung und Standard bleiben. Neu ist die Annahme A18 (Grenzen der Stufen).

| Block | Commit                          | Inhalt                                                         |
| ----- | ------------------------------- | -------------------------------------------------------------- |
| 1     | `adee33e`                       | Tagespfeile im Tagebuch-Kopf entfernen (Punkt 5)               |
| 2     | `4040652`                       | Figuren-Bilder ohne Tipp laden (Punkt 8)                       |
| 3     | `a45c9ab`                       | Wochenleiste: „Kalenderwoche“ oder „Letzte Tage“ (Punkt 1)     |
| 4     | `56d3a22`                       | Wochenleiste: Tag im Ziel oder drüber, sechs Darstellungen (3) |
| 5     | `3915757`                       | Assistent-Knopf weicht dem Kamerabild aus (Punkt 6)            |
| 6     | `e552a66`, `07e0d05`, `22894dd` | Kamera: Dauerfokus, Tippen zum Fokussieren, Hauptkamera (7)    |
| 7     | `967446f`                       | Android: dunkles App-Icon über ein zweites Manifest (4)        |
| 8     | (dieser Commit)                 | Doku: `CLAUDE.md`, `docs/logo/README.md`, dieser Statusblock   |

### Mockup-Wahl (Block 4)

Gewählt am 2026-11-20 (Wortlaut: „A V1, A3, F V1, F2, F3 will ich als optionen drin haben, soll dann unter mehr
auswählbar sein“). Alle fünf werden gebaut, der Nutzer stellt unter Mehr ein, welche die Wochenleiste zeigt. Auf
Nachfrage am selben Tag: Standard ist A3 („Ring mit Bogen“), und das heutige Aussehen bleibt als sechste Option.
Reihenfolge in der Auswahl wie in der Tabelle:

| Wahl          | Im Mockup v2 (`VARIANTS`, Klasse)                      | Wert im Code | Name im UI (A16) |
| ------------- | ------------------------------------------------------ | ------------ | ---------------- |
| wie bisher    | `0`, Zeile „Heute“ (nur Punkte, kein Urteil)           | `dots`       | Punkte           |
| A V1          | `A0`, Zeile „v1: Ring, blauer Punkt darunter“, `.vA0`  | `ring`       | Ring             |
| A3 (Standard) | `A3`, „Blauer Bogen, so lang wie das Training“, `.vA3` | `ringArc`    | Ring mit Bogen   |
| F V1          | `F0`, Zeile „v1: Feld, beide Punkte darunter“, `.vF0`  | `field`      | Feld             |
| F2            | `F2`, „Blauer Rahmen“, `.vF2`                          | `fieldFrame` | Feld mit Rahmen  |
| F3            | `F3`, „Blauer Fuß“, `.vF3`                             | `fieldFoot`  | Feld mit Fuß     |

Geändert haben wollte er an keiner etwas. Nicht gebaut werden alle übrigen Vorschläge (A1, A2, A4 bis A6, F1, F4
bis F7, AF1 bis AF3).

Die Kürzel A1 bis A6, F1 bis F7 und AF1 bis AF3 sind Vorschläge des Mockups, nicht die Annahmen A1 bis A18 dieses
Plans.

### Farb-Wahl (Block 4)

Gewählt am 2026-11-20: **K5** („Grün im Ziel, Rot in drei Stufen“) aus Mockup v3, für alle fünf Darstellungen mit
Urteil. Dort ist es der Abschnitt K5 (Klasse `.k5.steps`, die Regeln `.k5 .day…` und die Tokens in `.light` und
`.dark`).

| Zustand                | Ring (`ring`, `ringArc`)                     | Feld (`field`, `fieldFrame`, `fieldFoot`) |
| ---------------------- | -------------------------------------------- | ----------------------------------------- |
| im Ziel                | grün (`--good`), so lang wie gegessen/Budget | blasses Grün                              |
| knapp drüber (Stufe 1) | voller Ring, blasses Rot                     | blasses Rot                               |
| drüber (Stufe 2)       | voller Ring, Rot (`--over`)                  | mittleres Rot                             |
| weit drüber (Stufe 3)  | voller Ring, Dunkelrot                       | kräftiges Rot                             |
| ausgewählter Tag       | wie bisher: hell auf `--primary`             | `bg-primary`, kein Urteil                 |

Grün für „im Ziel“ ist damit gewollt, obwohl der grüne Punkt abgelehnt war: Der Nutzer hat K5 gewählt, nachdem ich
im Mockup und im Chat darauf hingewiesen hatte. Nicht gebaut werden K1 bis K4 und K6 (kein Gelb, kein Pegel, kein
stufenloser Verlauf).

### Abweichungen vom Plan

- Block 1: Die Tageslinks der Leiste vergleichen ihre Suchparameter jetzt genau (`activeOptions.exact`). Vorher
  hielt der Router den Link auf heute an jedem Tag für aktuell (zwei `aria-current`). Der Router setzt am
  ausgewählten Tag `aria-current="page"` über unser `"date"`; Tests und `shiftDay` prüfen deshalb nur, dass das
  Attribut da ist. Zusätzlicher Commit `c6126f0`: `ios-layout.spec.ts` erwartete auf 375 px das kurze Datum, ohne
  Pfeile passt jetzt das lange.
- Block 4: `StripMark`/`stripMark` liegen in shared neben `dayVerdict` (der Plan ließ das offen), getestet in
  `packages/shared/test/strip-mark.test.ts`. Der Rahmen von „Feld mit Rahmen“ ist ein eigenes Element mit
  `border-2` statt `box-shadow`, damit der Fokusring (ebenfalls `box-shadow`) daneben bleibt; gleiches Aussehen.
  Ein Commit statt zwei.
- Block 4, Screenshots: Die 16 Zustände aus v2 und die zwölf aus v3 gibt es nicht als einzelne Zeilen. Die
  Demo-Daten liegen an allen Tagen im Ziel; die drei Rotstufen, Training und den ausgewählten Tag zeigen die
  Beispielwochen der Aussehen-Seite (hell und dunkel). Nicht hergestellt: „Kein Ziel“, „Nur Training“ am
  ausgewählten Tag, die einzelnen Prozentstufen.
- Block 5: Die gefälschte Kamera klappt im Container. `assistant-camera.spec.ts` beantwortet `/api/ai/status` mit
  „an“: Ist die Fotoanalyse auf dem Server aus, steht über dem Bild der Hinweis „KI-Analyse auf dem Server
  ausgeschaltet“, und der Knopf findet auf kleinen Bildschirmen dort seinen freien Platz (über dem Bild, nicht
  darauf).

### Nachprüfung (2026-11-20)

Alle Blöcke noch einmal gegen den Plan gelesen. Vollständig; behoben in einem Nachtrags-Commit:

- Block 6c, Fehler: Die Hauptkamera wurde gemerkt, bevor sie sich öffnen ließ. Ließ sie sich nie öffnen, startete
  die Kamera danach bei jedem Aufruf mit Fehler. Jetzt merkt der Scanner sie erst nach dem Start; scheitert ein
  Start mit gemerkter Kamera, vergisst er sie und fragt einmal ohne (`forgetMainCamera`).
- Block 6b/6c: Diagnosezeile und Gerätesuche laufen nur noch, wenn Chrome die Kamera „camera2 N“ nennt. Vorher
  schrieb auch das iPhone (mehrere Rückkameras) eine Zeile ins Fehlerprotokoll und wartete vor dem ersten Bild auf
  `enumerateDevices`; „auf dem iPhone ändert sich nichts“ gilt jetzt wörtlich.
- Block 6a: Zwei schnelle Tipps hinterließen einen Rückkehr-Timer, den keiner mehr löschte; die Haltezeit beginnt
  jetzt mit dem Tipp, ein beendeter Track bekommt keine Constraints mehr.
- Block 5: Der Scroll-Listener des Knopfs hört nur noch auf das Dokument (vorher auch jedes Rad und jede Leiste).
- Block 2: `loadSkin` lädt einen Pack, den das Gerät schon hat, nicht noch einmal; ein Lesefehler der lokalen
  Kopien bleibt still.
- Block 3: Auch die Wochenpfeile vergleichen genau (`activeOptions.exact`), sonst trug der Pfeil auf heute
  `aria-current`.
- Block 7: `darkManifest` bricht den Build ab, wenn es das `theme-init.js`-Tag nicht findet (statt das Manifest
  still zu verlieren); der E2E-Test des Manifests vor dem App-Start läuft ohne Service Worker, damit das Sperren
  der Skripte wirkt.
- `CLAUDE.md`: Der Essens-Punkt steht in `dots` und `field` an jedem Tag mit Essen.

Bewusst so gelassen: „Feld mit Rahmen“ trägt `data-mark="frame"` (folgt aus dem Rahmen als Element); der
Fokusring ist weiß wie die übrigen Kamera-Overlays, nicht über ein Token. Entschieden vom Nutzer (2026-11-20):
Der Knopf weicht auch dem Hinweis „KI-Analyse auf dem Server ausgeschaltet“ aus (`data-ai-avoid`; auf kleinen
Bildschirmen dann ausgeblendet), geprüft in `assistant-camera.spec.ts`.

### Annahmen

- A1, A2, A4, A5, A14 bis A18 wie geplant gebaut; vom Nutzer noch abzunehmen (Screenshots).
- A8: Lösung a) gebaut; in 390 × 664 ist der Knopf auf dem Kamera-Schritt ausgeblendet, in 390 × 844 und
  360 × 760 liegt er unter „Eingeben“/„Suchen“ (alle drei Größen und Teufelchen). Rückfall b) nicht nötig.
- A9: Diagnose und Heuristik gebaut (eigene Commits `07e0d05`, `22894dd`); ob Chrome auf dem Telefon der
  Testerin die Hauptkamera wählt, zeigt erst die Diagnosezeile.
- A11: wie geplant; der Ausgang des Versuchs ist offen.

### Prüfung

- Je Block `pnpm lint`, `pnpm typecheck`, Vitest grün. Am Ende: shared 171, web 504, api 267, bls-import 5 Tests.
- E2E: nach Block 1 die vier betroffenen Specs, nach Block 3/4 `appearance.spec.ts` und die ganze Suite (68 grün),
  nach Block 5 `assistant*.spec.ts`, nach Block 7 `appearance.spec.ts`; am Ende alles (76, davon einer rot:
  `ios-layout` erwartete das kurze Datum, angepasst in `c6126f0`, danach grün).
- Screenshots (Produktions-Build über die API, Demo-Konto, 390 × 844 und 360 × 760, hell und dunkel): Tagebuch-Kopf
  in den sechs Darstellungen (diese und Vorwoche) und mit „Letzte Tage“, Aussehen-Seite mit beiden neuen
  Auswahlen und den Beispielwochen, `/photo` mit dem Assistenten in Klein, Mittel, Groß und als Teufelchen.
  Figuren-Seite auf einem zweiten Gerät nur als Komponententest (`uploaded-skins.test.tsx`), nicht im Browser.

## Context

Acht Punkte aus dem Feedback vom 2026-11-19 und 2026-11-20 (Nutzer auf dem iPhone, eine Testerin auf Android). Der
Nutzer hat den Implementierungsplan direkt bestellt. Ein Mockup gibt es nur für Punkt 3 (Tagesurteil in der
Wochenleiste): `docs/plans/2026-11-wochenleiste-tagesurteil-mockup.html` (v2, 16 Vorschläge in drei Familien); der
Nutzer hat daraus fünf Darstellungen gewählt, die zusammen mit dem heutigen Aussehen als Einstellung gebaut werden
(Statusblock, „Mockup-Wahl“).
Was sonst am Aussehen offen war, ist unten als Annahme festgelegt; Opus liefert dazu am Ende Screenshots, damit
der Nutzer es abnehmen oder ändern kann.

### Entschieden (mit dem Nutzer)

- Punkt 1: neue Einstellung pro Gerät unter Mehr → Aussehen → „Tagebuch“, Werte „Kalenderwoche“ (Standard, wie
  heute) und „Letzte Tage“ (heute ist der zweite Tag von rechts: fünf Tage davor, heute, morgen; die Kürzel gehören
  zum jeweiligen Tag). Die Pfeile springen in beiden Varianten um eine Woche. `/more` nennt die Einstellung nur,
  wenn sie nicht auf dem Standard steht.
- Punkt 2: Wird nicht gebaut (2026-11-20). Eine Fläche „Nur im Hochformat“ hat der Nutzer abgelehnt, und die App
  auf dem iPhone gegen die Drehung zurückzudrehen ist ihm Aufwand und Risiko nicht wert. Die App verhält sich auf
  einem quer gehaltenen Telefon wie heute (die installierte App auf Android ist über `orientation: 'portrait'` im
  Manifest schon heute gesperrt, `vite.config.ts:41`).
- Punkt 3: Jeder Tag der Leiste mit mindestens einem Eintrag zeigt, ob er im Ziel oder drüber lag, auch der
  laufende Tag, unabhängig von `isCompleteDay`. Keine Serien, keine Zählungen. Kein grüner Punkt (abgelehnt
  2026-11-20). Farben: im Ziel grün, drüber Rot in drei Stufen, je weiter drüber, desto kräftiger (K5 aus Mockup
  v3, gewählt 2026-11-20). Aussehen: fünf Darstellungen aus dem Mockup v2 (A V1, A3, F V1, F2, F3) als Optionen, unter Mehr
  auswählbar (gewählt 2026-11-20, Tabelle im Statusblock). Standard ist A3. Das heutige Aussehen (nur Punkte)
  bleibt als sechste Option; wer sie wählt, sieht kein Urteil.
- Punkt 4: Das dunkle Icon auf Android ist ein Versuch, der erst auf dem Gerät entschieden wird. Scheitert er:
  auf Android die Auswahl nur für das Logo in der App anbieten.
- Punkt 5: Die Pfeile „Vorheriger Tag“/„Nächster Tag“ fallen weg, „Datum wählen“ bleibt. Der Titel bleibt, wo er
  heute steht; niemand hat verlangt, ihn zu zentrieren oder zu verschieben.
- Punkt 6: Der schwebende Assistent-Knopf liegt auf der Fotoseite nicht mehr auf dem Kamerabild, sondern unten.
- Punkt 7: `focusMode: 'continuous'`, wo der Track es meldet; Tippen ins Bild fokussiert dort (mit kurzem
  Fokusring); bei mehreren Rückkameras die Hauptkamera nehmen; alles nur über gemeldete Fähigkeiten, auf dem iPhone
  ändert sich nichts. Kein Zoom-Knopf (abgelehnt 2026-11-20): weder bauen noch anbieten.
- Punkt 8: Die Bilder hochgeladener Figuren erscheinen ohne Tipp; ein Tipp wählt nur aus. Der Fehler zeigt sich,
  weil die Packs über den Server geladen werden; auch dann sollen die Bilder direkt sichtbar sein.

### Annahmen (im Plan festgelegt, bei Widerspruch melden statt still zu entscheiden)

- **A1 (Punkt 1, Fenster):** Das Fenster von „Letzte Tage“ ist an heute verankert und verschiebt sich nur in
  Schritten von 7 Tagen (Vorschlag der Planungsgrundlage). Ein Tipp auf einen Tag verschiebt die Leiste nicht.
- **A2 (Punkt 1, Vorschau):** Die Einstellung zeigt unter der Auswahl eine kleine, nicht bedienbare Vorschau der
  sieben Tage (Kürzel und Tageszahl, heute hervorgehoben), wie die Makro-Einstellung ihre Beispielzeile hat. Kein
  Erklärsatz.
- **A4 (Punkt 3, Grenze):** Bewertet wird wie in der Kalorienkarte: drüber ist ein Tag, wenn `remainingKcal < 0`
  (Ziel plus angerechnetes Training und angerechnete Schritte), ohne Toleranz. Genau im Budget ist „im Ziel“.
- **A5 (Punkt 3, was zählt):** „Eintrag“ heißt Essens-Eintrag. Ein Tag nur mit Training hat keinen Essens-Punkt und
  kein Urteil. Ein Tag ohne eigenes Ziel (kein `Goal` gilt für das Datum, `targets.goalId === null`, die Karte
  rechnet dann mit `FALLBACK_TARGET`) bekommt kein Urteil, sondern den neutralen Punkt wie heute.
- **A6 (Punkt 3, Aussehen):** Keine Annahme mehr, entschieden (Statusblock, „Mockup-Wahl“ und „Farb-Wahl“). Für die
  fünf Darstellungen mit Urteil gilt: Formen wie in Mockup v2, Farben wie K5 in Mockup v3 (im Ziel `--good`, drüber
  drei Rotstufen); Training bleibt blau (`--exercise`); der ausgewählte Tag bleibt rot gefüllt.
- **A13 (Punkt 3, Optionen und Standard):** Keine Annahme mehr, entschieden (2026-11-20): sechs Optionen, die
  fünf gewählten und das heutige Aussehen; Standard für alle, die nichts einstellen, ist „Ring mit Bogen“ (A3).
  Angenommen bleibt nur die Reihenfolge der Liste (heutiges Aussehen zuerst, dann wie im Mockup).
- **A14 (Punkt 3, Ort der Einstellung):** „Unter Mehr“ heißt Mehr → Aussehen → Abschnitt „Tagebuch“, pro Gerät in
  `localStorage` wie die anderen Einstellungen dort (Makros, „Letzte Tage“ aus Block 3). `/more` nennt die
  Darstellung nur, wenn sie nicht auf dem Standard steht.
- **A15 (Punkt 3, Auswahl):** Sechs Optionen passen auf dem Telefon nicht in eine `ToggleGroup`. Die Auswahl ist
  eine Liste aus sechs Zeilen (`RadioGroup`, `components/ui/radio-group.tsx`): je Zeile der Name und darunter eine
  nicht bedienbare Beispielwoche in dieser Darstellung (dieselbe feste Woche in allen sechs Zeilen, die Woche des
  Mockups v3: im Ziel mit Training, knapp drüber, im Ziel, drüber, weit drüber mit Training, heute mit Training und
  ausgewählt, ein leerer Tag). Die ganze Zeile ist die Tippfläche. Kein Erklärsatz.
- **A16 (Punkt 3, Namen):** „Punkte“ (das heutige Aussehen), „Ring“, „Ring mit Bogen“, „Feld“, „Feld mit Rahmen“,
  „Feld mit Fuß“ (Tabelle im Statusblock). Der Nutzer hat keine Namen genannt.
- **A17 (Punkt 3, Bogen von A3):** Das Mockup lässt offen, wie lang der Bogen bei nicht angerechnetem Training ist.
  Festgelegt: Die Länge ist immer der Anteil der Trainings-kcal des Tages (ohne Schritte) am Budget des Tages,
  `clamp(trainingKcal / budgetKcal, 0.08, 1)` des Umfangs, gleich ob das Training angerechnet wird. Ein Tag nur mit
  Schritten hat wie heute kein Trainingszeichen.
- **A18 (Punkt 3, Stufen von „drüber“):** Der Nutzer will sehen, wie weit drüber; Grenzen hat er keine genannt. Wie
  im Mockup v3: Überschuss = `(eatenKcal − budgetKcal) / budgetKcal`; Stufe 1 („knapp drüber“) bis einschließlich
  10 %, Stufe 2 („drüber“) bis einschließlich 25 %, Stufe 3 („weit drüber“) darüber. Ich habe ihm die Grenzen im
  Mockup und im Chat genannt; er hat K5 gewählt, ohne andere zu nennen. Die Grenzen stehen als zwei Konstanten an
  einer Stelle.
- **A8 (Punkt 6):** Lösung a) der Grundlage: Das Kamerabild ist eine Sperrfläche, der Knopf sucht den nächsten
  freien Platz (in der Regel unter „Eingeben“/„Suchen“). Gibt es keinen freien Platz (kleiner Bildschirm, große
  Figur), ist der schwebende Knopf dort ausgeblendet, solange keine Äußerung läuft; Sprache bleibt über das
  Plus-Menü erreichbar. Lösung b) (auf dem Kamera-Schritt immer ausblenden) ist der Rückfall, wenn a) im Test
  unruhig wirkt: dann melden.
- **A9 (Punkt 7, Kamerawahl):** Ohne das Telefon der Testerin lässt sich nicht prüfen, welche Kamera Chrome wählt.
  Der Plan baut deshalb zwei Dinge: eine Diagnosezeile (welche Kamera lief, welche es gibt, was sie meldet), die
  unter „Daten & Sync“ im Fehlerprotokoll steht und kopiert werden kann, und die bekannte Heuristik für Chrome auf
  Android (Labels „camera2 N, facing back“, die niedrigste Nummer ist die Hauptkamera). Die Heuristik greift nur,
  wenn mehrere Rückkameras mit solchen Labels gemeldet werden und die laufende nicht die mit der niedrigsten Nummer
  ist. Sie ist ein eigener Commit und einzeln rücknehmbar.
- **A11 (Punkt 4, Umfang des Versuchs):** Zwei Manifeste mit gleicher `id`. Das dunkle Manifest wird nur
  eingehängt, wenn das Icon ausdrücklich auf „Dunkel“ steht; „Wie die App“ bleibt auf Android beim hellen Manifest,
  bis der Gerätetest bestanden ist (so trifft ein Fehlschlag niemanden, der nichts umgestellt hat). Die Infobox
  zum Home-Bildschirm-Icon mit den iOS-Schritten zeigt nur noch iOS; für Android steht nichts Ungeprüftes im UI.

### Im Code geprüft (2026-11-20)

- `features/diary/WeekStrip.tsx` (83 Zeilen): `monday = startOfWeek(date)`, `days = dateRange(monday, +6)`,
  `useLoggedDates`/`useTrainedDates` (nur hier benutzt), Wochenpfeile als `Link` mit `date ± 7` und den
  `aria-label`s „Vorherige Woche“/„Nächste Woche“, Tageslink `h-14` mit `aria-current="date"`, `sr-only`-Text aus
  Tagesname, „Essen eingetragen“, „Training eingetragen“, Punktzeile `mt-0.5 flex h-1 gap-[3px]` mit
  `data-dot="food"` (ausgewählt `bg-primary-foreground`, sonst `bg-primary`) und `data-dot="training"`
  (`bg-exercise`). Test: `apps/web/test/week-strip.test.tsx` (eigene `UserDb`, `@/app/session` gemockt).
- `packages/shared/src/diary.ts`: `summarizeDay({ date, entries, exercises, goals, settings })` filtert selbst nach
  `date`, liefert `budgetKcal`, `remainingKcal`, `entryCount` (Zahl der Essens-Einträge) und `targets.goalId`
  (`null` ohne geltendes Ziel, `goals.ts:66`). `CalorieCard.tsx:88`: `over = summary.remainingKcal < 0`.
- `packages/shared/src/dates.ts`: `addDays`, `diffDays(a, b)` (= b − a in Tagen), `weekdayIndex`, `startOfWeek`,
  `dateRange`, `WEEKDAYS_SHORT_DE`.
- `lib/appearance.ts`: Schlüssel `ft.theme`, `ft.icon`, `ft.diaryMacros`, `ft.assistant.*`;
  `resolveAppearance(theme, icon, systemDark, diaryMacros = 'numbers', assistant = {…})` mit Positionsparametern
  (Tests in `apps/web/test/lib.test.ts` ab Zeile 601); Setter schreiben mit `write(KEY, next, istStandard)` (der
  Standard löscht den Schlüssel); `apply()` setzt Klassen, `theme-color`, Favicon und `apple-touch-icon`.
- `features/more/AppearancePage.tsx`: Abschnitt „Tagebuch“ mit der `ToggleGroup` „Zahlen“/„Mit Balken“ und einer
  Beispielzeile; Abschnitt „App-Icon“ mit einer Infobox „Icon auf dem Home-Bildschirm“, deren iOS-Text auf jeder
  Plattform steht. `MorePage.tsx:151`: der Hinweis nennt Makros nur bei `bar`. `e2e/appearance.spec.ts` erwartet
  beim Standard „Wie das System · Icon wie die App“.
- `features/diary/DiaryPage.tsx:68-114`: die beiden Pfeil-Buttons im Titel; `ChevronLeft`, `ChevronRight` und
  `addDays` werden nur dafür importiert. `useFittingDate` zieht die Breite der anderen Kinder der Titelbox ab und
  funktioniert ohne Pfeile. Der Titel ist ein `h1` mit `flex-1 truncate` (`components/Page.tsx:54`), also links.
  E2E mit den Pfeilen: `meals-unified.spec.ts:79,94`, `share-day.spec.ts:137-140`, `meals-goals.spec.ts:1299`,
  `day-meals.spec.ts:364,488,498`. Sonst benutzt nichts die Namen (nur `dist/`, das neu gebaut wird).
- `features/assistant/AssistantButton.tsx`: `measure(size)` sucht unter `nav[aria-label="Hauptnavigation"]`,
  `[data-page-footer]`, `[data-ai-avoid]`, `[data-sonner-toast]` die oberste Kante **in der unteren Bildhälfte**
  und nimmt sie als Boden (`maxY = floor − 12 − size`); `minY = top + safeTop + 60`. Auf `/photo` beginnt die
  Auslöser-Leiste (`CameraStep.tsx:79`, `data-ai-avoid`, liegt **im** Kamerabild) in der unteren Hälfte, der
  Boden ist also ihre Oberkante: Der Knopf landet zwangsläufig auf dem Bild. `data-ai-avoid` gibt es sonst nur an
  der Zeile „Eingeben“/„Suchen“ (`PhotoPage.tsx:201`). `useLayoutTick` hört auf Größe, `visualViewport` und
  DOM-Änderungen, nicht auf das Scrollen der Seite. Ziehen: frei im Bildschirm, beim Loslassen
  `pos = { edge, y: drag.y − m.top }`. `AssistantProvider.tsx` (`FloatingAssistant`) blendet aus auf `/onboarding`,
  bei ausgeschaltetem Knopf im Leerlauf und bei offenem Dialog ohne laufende Äußerung.
- Rechnung für Punkt 6: Kamerabild 3:4 über die Seitenbreite, darunter 12 px und die Knopfzeile (44 px). Android
  360 × 760: Bild bis etwa y 509, Zeile bis etwa 565, darunter rund 195 px (reicht auch für „Groß“ = 112 px).
  iPhone 13 installiert (390 × 844): rund 200 px. Playwright „iPhone 13“ (390 × 664): rund 59 px, zu wenig für
  „Mittel“ (56 px plus Abstände): dort ist der Knopf ausgeblendet.
- `components/BarcodeScanner.tsx` ist die eine Kamera für die Fotoseite (`CameraStep.tsx`), `/scan`
  (`ScanPage.tsx`), `BarcodeScanSheet`, `PhotoCaptureSheet` und `LabelCaptureSheet`; das einzige `<video>` und das
  einzige Kamera-`getUserMedia` der App (`BarcodeScanner.tsx:195`, daneben nur `cameraWarmup.ts:26`). Nach dem
  Start liest sie `track.getCapabilities()` nur für `torch`. Das Video ist `aspect-[3/4] w-full object-cover`, die
  Rahmen darüber sind `pointer-events-none`, `children` sind die Bedienelemente.
- `components/cameraWarmup.ts`: `CAMERA_CONSTRAINTS` als Konstante („warm-up and scanner must ask for exactly the
  same stream“); `apps/web/test/camera-warmup.test.ts` erwartet `getUserMedia(CAMERA_CONSTRAINTS)`.
- `features/assistant/skins/UploadedSkins.tsx`: `remoteOnly`-Packs zeigen `STANDARD_SKIN` mit dem Namen; erst
  `choose` lädt (`downloadSkin`) und wählt zugleich aus (`setAssistantSkin`). `LocalTile` zeigt die Bilder über
  `useSkinUrls`. `uploads.ts` sagt im Dateikommentar, dass andere Geräte ein Pack erst beim Auswählen laden.
- `apps/web/vite.config.ts`: `VitePWA` mit `strategies: 'injectManifest'`, Manifest mit `id: '/'`,
  `orientation: 'portrait'`, vier hellen Icons; `globPatterns` nimmt `webmanifest` in den Precache. Im gebauten
  `index.html` steht `<script src="/theme-init.js">` **vor** `<link rel="manifest">` (das Plugin hängt den Link
  an). `apps/web/scripts/icons.mjs` rendert nur helle `pwa-*`- und Maskable-Dateien; `docs/logo` hat
  `logo-dark-square.svg`, aber kein dunkles Maskable.
- Ebenen: Dialoge und Sheets `z-50`, Assistent `z-[45]`, Kopf `z-30`.
- E2E: Projekte `chromium-iphone` (iPhone 13, alle Specs außer `ios-layout`) und `webkit-iphone` (iPhone 15, nur
  `ios-layout.spec.ts`); Zeitzone `Europe/Berlin`; keine gefälschte Kamera eingerichtet, die Fotoseite zeigt dort
  ihr Ersatzfeld (`camError`). `assistant.spec.ts` schaltet den Assistenten ein, indem es `**/api/info` umleitet.
  Hilfsdateien für Specs gibt es noch keine (nur `*.spec.ts`).

## Umsetzung

Zeilennummern sind der Stand von `2121829` und dienen nur zum Finden. Bei Fehlern (Block 2) zuerst der rote Test.

### Block 1: Tagespfeile entfernen (`features/diary/DiaryPage.tsx`, vier E2E-Specs, neu `apps/web/e2e/days.ts`)

1. `DiaryPage.tsx`: beide Buttons („Vorheriger Tag“, „Nächster Tag“) entfernen, ebenso die Importe `ChevronLeft`,
   `ChevronRight` und `addDays`. `go` bleibt für das Datumsfeld. Die Titelbox (`titleBox`) und `useFittingDate`
   bleiben; den Kommentar „between the arrows“ anpassen. Am Titel selbst ändert sich nichts (Lage, Ausrichtung,
   Abstände wie heute); er rückt nur dorthin, wo der linke Pfeil stand, weil die Zeile ihn dort hinlegt.
2. E2E-Helfer `apps/web/e2e/days.ts` (kein `.spec`, wird nicht als Test gesammelt): `shiftDay(page, delta)`.
   Er liest den gezeigten Tag (Suchparameter `date`, sonst das heutige Datum **des Browsers**, per
   `page.evaluate`), rechnet den Zieltag, tippt den Wochenpfeil der Leiste, solange der Zieltag nicht in der
   Leiste steht (der Pfeil verschiebt um 7 Tage), tippt dann den Tageslink (Name beginnt mit dem langen Tagesnamen
   wie `DAY_NAME` in `WeekStrip.tsx`: Wochentag lang, Tag, Monat lang, `de-DE`) und wartet auf die URL (`date=`
   oder kein `date` für heute). Die Tests laufen an jedem Wochentag: am Montag steht gestern nicht in der Leiste,
   am Sonntag morgen nicht.
3. Die sechs Stellen umstellen: `meals-unified.spec.ts:79,94`, `share-day.spec.ts:137-140`,
   `meals-goals.spec.ts:1299`, `day-meals.spec.ts:364,488,498`. Was die Tests prüfen, bleibt gleich.

Tests: die vier Specs grün; ein Blick, dass `getByRole('button', { name: 'Vorheriger Tag' })` im Repo nicht mehr
vorkommt.

### Block 2: Figuren-Bilder ohne Tipp (`features/assistant/skins/UploadedSkins.tsx`, `uploads.ts`)

Ursache (vom Nutzer bestätigt): Ein Pack, das dieses Gerät nur vom Server kennt (`remoteOnly`), zeigt bis zum
ersten Tipp das Standard-Aussehen. Ziel: Auch solche Packs zeigen ihre Bilder direkt, ohne Tipp.

1. **Roter Test** `apps/web/test/uploaded-skins.test.tsx` (Aufbau wie `week-strip.test.tsx`: eigene `UserDb`,
   `@/app/session` gemockt; `listServerSkins` liefert ein Pack ohne lokale Kopie, der Abruf des Zips ist
   gestubbt, `URL.createObjectURL` für jsdom gestubbt): Nach dem Rendern erscheint das Bild des Packs ohne Tipp,
   `ft.assistant.skin` bleibt unverändert, ein Tipp auf die Kachel wählt aus, ohne ein zweites Mal zu laden.
2. **Fix** in `UploadedSkins.tsx`: Sobald die Liste des Servers da ist, alle `remoteOnly`-Packs nacheinander mit
   `downloadSkin(db, info)` nach Dexie laden. Die Kachel pulsiert solange (das heutige `busy`-Aussehen, als Menge
   von Ids oder die gerade ladende Id). Fehler bleiben still (kein Toast; die Kachel behält das Standard-Aussehen,
   ein Tipp lädt und wählt wie heute). Beim Verlassen der Seite bricht die Schleife ab (Flag wie `live`). Ein Pack
   wird nie doppelt geladen: ein laufender Abruf je Id wird geteilt (Tipp während des Ladens wartet auf denselben
   Abruf und wählt dann aus). `choose` wählt bei vorhandener Kopie nur noch aus.
3. Dateikommentar in `uploads.ts` anpassen (Packs werden beim Öffnen der Seite geladen).
4. Sichtprüfung mit dem Produktions-Build über die API und zwei Browser-Kontexten desselben Kontos: In Kontext A
   ein Pack hochladen (Test-Zip wie in `apps/web/test/assistant-skins.test.ts` oder ein mit
   `tools/skin-pack/build.mjs` gebautes), in Kontext B die Seite öffnen: Die Kachel zeigt ihr Bild ohne Tipp, die
   gewählte Figur bleibt, wie sie war.

Regeln: kein `setState` direkt im Effekt (in den `then`-Zweigen wie beim heutigen `setServer`).

### Block 3: Wochenleiste „Letzte Tage“ (`features/diary/stripDays.ts` neu, `WeekStrip.tsx`, `lib/appearance.ts`, `AppearancePage.tsx`, `MorePage.tsx`)

1. Reine Funktion `stripDays(date, today, mode): ISODate[]` in `features/diary/stripDays.ts`:
   - `week`: `dateRange(startOfWeek(date), +6)` wie heute.
   - `recent` (A1): `end0 = addDays(today, 1)`, `k = Math.floor(diffDays(date, end0) / 7)` (für Tage nach morgen
     negativ), `end = addDays(end0, -7 * k)`, Tage `dateRange(addDays(end, -6), end)`. Für `date = today` ist heute
     der sechste von sieben.
2. `lib/appearance.ts`: `WeekStripPref = 'week' | 'recent'`, Schlüssel `ft.weekStrip` (Standard `week` löscht den
   Schlüssel), `setWeekStripPref`, Feld `weekStrip` in dem, was `useAppearance()` liefert. `resolveAppearance`
   bekommt den Wert als weiteren Parameter **am Ende** mit Standard `'week'`, damit die bestehenden Aufrufe und
   Tests gelten. `startAppearance()` liest den Schlüssel.
3. `WeekStrip.tsx`: `days = stripDays(date, today, weekStrip)`; Kürzel `WEEKDAYS_SHORT_DE[weekdayIndex(d)]`; die
   Pfeile bleiben `date ± 7` mit denselben `aria-label`s (in beiden Varianten sieben Tage). Alles andere bleibt.
4. `AppearancePage.tsx`, Abschnitt „Tagebuch“: zweite `ToggleGroup` mit `aria-label="Tage in der Wochenleiste"`,
   Werte „Kalenderwoche“ und „Letzte Tage“, gebaut wie die Makro-Auswahl darüber. Darunter die Vorschau (A2):
   sieben Zellen mit Kürzel und Tageszahl aus `stripDays(today, today, pref)`, heute hervorgehoben wie in der
   Leiste, `aria-hidden`, nicht bedienbar.
5. `MorePage.tsx:151`: der Hinweis bekommt bei `recent` den Zusatz „ · Letzte Tage“; beim Standard bleibt der Text
   wie heute (`appearance.spec.ts` prüft ihn).

Tests:

- `apps/web/test/lib.test.ts`: `stripDays` (heute; ein Tag im Fenster; sieben Tage zurück ist wieder der sechste;
  ein Tag weit zurück liegt in einem Fenster, das zu heute um ein Vielfaches von 7 versetzt ist; morgen und
  übermorgen; Monats- und Jahreswechsel); die Einstellung (Standard, Schlüssel, Standard löscht).
- `week-strip.test.tsx`: in `recent` gehören die Kürzel zu den Tagen, der ausgewählte Tag steht an sechster Stelle.
- E2E (`appearance.spec.ts` oder eine neue Spec): auf „Letzte Tage“ stellen, `/more` nennt es, im Tagebuch ist der
  sechste Tageslink `aria-current="date"`; ein Tipp auf einen anderen Tag verschiebt die Leiste nicht; „Vorherige
  Woche“ zeigt wieder den sechsten als ausgewählt und `date` ist heute minus 7; zurück auf „Kalenderwoche“ steht
  die Leiste wieder auf Mo bis So. `shiftDay` aus Block 1 muss in beiden Varianten funktionieren.

### Block 4: Tag im Ziel oder drüber, sechs Darstellungen (`packages/shared/src/diary.ts`, `hooks/data.ts`, `lib/appearance.ts`, `features/diary/StripDay.tsx` neu, `WeekStrip.tsx`, `index.css`, `AppearancePage.tsx`, `MorePage.tsx`)

Vorlage für Maße, Formen und Zustände ist das Mockup v2 `docs/plans/2026-11-wochenleiste-tagesurteil-mockup.html`:
je Darstellung der Eintrag in `VARIANTS` (`0`, `A0`, `A3`, `F0`, `F2`, `F3`: die Funktion `cell` und die Helfer
`ringBox`, `ringCell`, `fieldCell`), die Regeln unter `.ring`, `.field` und `.v<Kürzel>` im `<style>` und die
Zustandsreihe mit den 16 Zuständen (`STATES`). Vorlage für die **Farben** ist das Mockup v3
`docs/plans/2026-11-wochenleiste-farben-mockup.html`, Vorschlag K5: die Tokens in `.light` und `.dark`, die Regeln
`.k5 .day…`, `.steps`, `.rf`, `.rx`, `.field .day.v-…` und die Funktion `step`. Wo v2 und v3 sich in einer Farbe
widersprechen, gilt v3. Was dort gezeichnet ist, gilt; die Liste unten fasst es nur zusammen.

1. Shared, `diary.ts`: `dayVerdict(summary: DaySummary): 'ok' | 'over' | null`. `null` ohne Essens-Eintrag
   (`entryCount === 0`) und ohne geltendes Ziel (`targets.goalId === null`, A5); `'over'` bei
   `remainingKcal < 0`, sonst `'ok'` (A4). Daneben `overLevel(eatenKcal, budgetKcal): 1 | 2 | 3` mit den
   Konstanten `OVER_NEAR = 0.1` und `OVER_FAR = 0.25` (A18: Überschuss ≤ 10 % ist 1, ≤ 25 % ist 2, sonst 3; nur
   für Tage mit `'over'` gefragt). Export über den Index von shared.
2. `hooks/data.ts`: `useStripMarks(from, to)` ersetzt `useLoggedDates`/`useTrainedDates` (beide entfernen, sie
   werden nur in der Leiste benutzt). **Eine** Live-Query liest die Essens-Einträge und die Trainings des
   Zeitraums (ohne gelöschte); mit `useGoals()` und `useSettings()` entsteht je Tag ein `StripMark`:
   `{ food, training, verdict, level, eatenKcal, budgetKcal, trainingKcal }` (`level` aus `overLevel`, nur bei
   `verdict === 'over'`, sonst `null`). `summarizeDay` je Tag auf den geladenen
   Listen (es filtert selbst nach `date`); `food` = `entryCount > 0`, `training` wie heute ohne `isStepsEntry`,
   `eatenKcal` = `budgetKcal − remainingKcal`, `trainingKcal` = `exerciseKcal − stepsKcal` (A17). Der Typ
   `StripMark` und eine reine Funktion `stripMark(summary, hasTraining)` liegen neben `StripDay` (oder in shared
   neben `dayVerdict`), damit sie ohne Datenbank getestet werden. `undefined`, solange etwas lädt (die Leiste zeigt
   dann wie heute keine Zeichen).
3. Einstellung, `lib/appearance.ts`:
   `WeekMarksPref = 'dots' | 'ring' | 'ringArc' | 'field' | 'fieldFrame' | 'fieldFoot'`, `WEEK_MARKS` (Wert und
   Name in der Reihenfolge der Tabelle im Statusblock), `DEFAULT_WEEK_MARKS = 'ringArc'` (A13),
   Schlüssel `ft.weekMarks` (der Standard löscht den Schlüssel, ein unbekannter Wert zählt als Standard),
   `setWeekMarksPref`, Feld `weekMarks` in dem, was `useAppearance()` liefert. `resolveAppearance` bekommt den Wert
   als weiteren Parameter **am Ende** (nach `weekStrip` aus Block 3) mit dem Standard, damit die bestehenden
   Aufrufe und Tests gelten. `startAppearance()` liest den Schlüssel.
4. Tokens in `index.css` (hell unter `:root`, dunkel unter `:root.dark`, dazu die `--color-*`-Zeilen wie bei
   `--over`). Werte aus Mockup v3; das Grün ist das vorhandene `--good`. Nie feste Farbwerte in der Komponente.

   | Token                                                      | Hell                                                               | Dunkel                                                                                          |
   | ---------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
   | `--strip-track` (Spur des Rings)                           | `oklch(0.89 0.008 60)`                                             | `oklch(0.35 0.008 40)`                                                                          |
   | `--strip-excess-selected` (Überschuss am ausgewählten Tag) | `oklch(0.4 0.17 27)`                                               | `oklch(0.97 0.01 60)`                                                                           |
   | `--strip-ok` (Feld im Ziel)                                | `color-mix(in oklch, var(--good) 24%, transparent)`                | dasselbe mit 30 %                                                                               |
   | `--strip-over-ring-1`, `-2`, `-3` (Ring drüber)            | `oklch(0.78 0.1 27)`, `var(--over)`, `var(--over-2)`               | `color-mix(in oklch, var(--over) 45%, var(--background))`, `var(--over)`, `oklch(0.57 0.22 27)` |
   | `--strip-over-1`, `-2`, `-3` (Feld drüber)                 | `color-mix(in oklch, var(--over) N%, transparent)`, N = 14, 32, 56 | dasselbe mit N = 22, 36, 64                                                                     |
   | `--strip-over-num` (Tageszahl drüber, nur `field`)         | `oklch(0.45 0.18 27)`                                              | `oklch(0.84 0.1 27)`                                                                            |

   Der Ring im Ziel nimmt `--good` direkt. `--strip-mark` (neutrale Tinte aus v2) und `--field-train` werden nicht
   gebraucht. Dunkel ist Stufe 3 des Rings heller und satter als `--over-2`, weil `--over-2` dort auf dem dunklen
   Grund untergeht.

5. `features/diary/StripDay.tsx`: der **Inhalt** einer Tageszelle als reine Komponente
   (`{ weekday, day, mark, selected, today, variant }`, kein Link, keine Daten) plus `stripDayClass(...)` für die
   Klassen der Zelle selbst (Feld, Rahmen). `WeekStrip.tsx` rendert damit seine Links, die Einstellungsseite ihre
   Beispielwochen: eine Stelle, die zeichnet. Die Zelle behält in jeder Darstellung `h-14` und `rounded-xl`, auch
   wenn Zeichen kommen oder gehen; sie bekommt `relative overflow-hidden` (für den Fuß).
   - **`dots` (wie bisher, Zeile „Heute“):** genau die heutige Zelle: Kürzel, Zahl 16 px, darunter der rote
     Essens-Punkt an jedem Tag mit Essen und der blaue Trainings-Punkt. Kein Urteil: keine Farbe, kein
     `data-verdict`, der `sr-only`-Text wie heute ohne „im Ziel“/„über dem Ziel“.
   - **`ring` (A V1, `.vA0`):** Um die Tageszahl ein Ring, Kasten 30 px, Radius 13, Strich 2,5, Beginn bei 12 Uhr,
     runde Enden: Spur in `--strip-track`. Im Ziel die Füllung `clamp(eatenKcal / budgetKcal, 0.04, 1)` des Umfangs
     in `--good`. Drüber ist der Ring voll und trägt die Farbe der Stufe (`--strip-over-ring-<level>`); den
     dunkelroten Bogen des Überschusses aus v2 gibt es an nicht ausgewählten Tagen nicht mehr. Die Zahl im Ring
     14 px (an jedem Tag, auch ohne Ring), das Kürzel mit 15 px Zeilenhöhe. Ohne Urteil kein Ring. Punktzeile
     darunter: der rote Essens-Punkt nur, wenn gegessen wurde und es kein Urteil gibt (kein Ziel), dazu der blaue
     Trainings-Punkt wie heute. Ausgewählter Tag (die Farbe kann dort nichts sagen): Spur
     `color-mix(in oklch, var(--primary-foreground) 30%, transparent)`, Füllung `--primary-foreground`, drüber
     zusätzlich der Bogen des Überschusses `clamp((eatenKcal − budgetKcal) / budgetKcal, 0.07, 1)` in
     `--strip-excess-selected`.
   - **`ringArc` (A3, `.vA3`):** wie `ring`, aber Kasten 32 px, Ring-Radius 11,25, Zahl 13 px, und statt des
     blauen Punktes ein äußerer Bogen (Radius 15, Strich 1,5, `--exercise`, runde Enden), der bei 12 Uhr **endet**
     (`stroke-dashoffset = len − Umfang`), Länge nach A17. Ausgewählt in `--primary-foreground`. Nur Training: der
     Bogen allein um die Zahl. Kein Trainings-Punkt; der Essens-Punkt wie bei `ring`.
   - **`field` (F V1, `.vF0`):** Die Zelle ist im Ziel `--strip-ok` und drüber `--strip-over-<level>` gefüllt
     (nicht am ausgewählten Tag, der bleibt `bg-primary`); drüber ist die Tageszahl `--strip-over-num`, in allen
     drei Stufen dieselbe Farbe (nur in dieser Darstellung, nicht am ausgewählten Tag). Beide Punkte darunter wie heute, der Essens-Punkt an jedem Tag mit Essen.
   - **`fieldFrame` (F2, `.vF2`):** Feld wie `field`, die Zahl bleibt in der Textfarbe. Training ist ein Rahmen
     innen an der Zelle (`box-shadow: inset 0 0 0 2px var(--exercise)`), auch ohne Feld (nur Training). Ausgewählt
     mit Training: `inset 0 0 0 2px var(--primary), inset 0 0 0 4px var(--primary-foreground)` (heller Innenrand).
     Der Essens-Punkt nur ohne Urteil, kein Trainings-Punkt. Der Fokusring der Zelle muss neben dem Rahmen
     erkennbar bleiben.
   - **`fieldFoot` (F3, `.vF3`):** Feld wie `fieldFrame`. Training ist ein blauer Fuß: 5 px hoch über die ganze
     Breite an der Unterkante der Zelle (`--exercise`, von der Rundung der Zelle beschnitten), auch am ausgewählten
     Tag blau und auch ohne Feld. Der Essens-Punkt nur ohne Urteil, kein Trainings-Punkt.
   - Für alle mit Urteil: „Heute“ behält die rote, fette Schrift (`text-primary`), Zustände „Heute, …“ der Zustandsreihe; die
     Zeile „Gewählt, …“ zeigt den ausgewählten Tag. In `ring` und `ringArc` trägt damit auch der ausgewählte Tag
     einen Ring; die alte Regel „kein Ring am ausgewählten Tag“ (Runde 6) galt der Markierung der Auswahl und wird
     in `CLAUDE.md` entsprechend neu gefasst (Block 8).
   - Zum Prüfen und für die Tests: die Leiste trägt `data-marks="<Wert>"`, jede Zelle `data-verdict="ok|over"`
     (fehlt ohne Urteil und in `dots`), bei `over` dazu `data-level="1|2|3"`, und `data-training` (an Trainingstagen); die Punkte behalten `data-dot="food"` und
     `data-dot="training"`, Ring, Bogen und Fuß tragen `data-mark="ring"`, `"arc"`, `"foot"`. Alles Gezeichnete ist
     `aria-hidden`.
   - `sr-only` (in den fünf Darstellungen mit Urteil gleich): nach „Essen eingetragen“ folgt „im Ziel“ oder „über dem Ziel“;
     „Training eingetragen“ bleibt. Die Stufe steht nicht im Text.
6. `WeekStrip.tsx`: `marks = useStripMarks(days[0], days[6])`, `variant = useAppearance().weekMarks`, die Zellen
   über `StripDay`/`stripDayClass`. Der Dateikommentar beschreibt die Zeichen neu. `hover:bg-accent` darf das Feld
   nicht überdecken (nur ohne Feld).
7. `AppearancePage.tsx`, Abschnitt „Tagebuch“, unter der Auswahl aus Block 3: `RadioGroup` mit
   `aria-label="Zeichen in der Wochenleiste"` (A15). Sechs Zeilen aus `WEEK_MARKS`: `label` mit `RadioGroupItem`,
   dem Namen und darunter der Beispielwoche (sieben `StripDay` ohne Wochenpfeile, `aria-hidden`, nicht bedienbar).
   Die Beispielwoche ist eine Konstante neben `PREVIEW` mit den Tagen des Mockups v3 (`DAYS`, gegessen/Budget: Mo 16
   1.900/2.420 mit Training 320; Di 17 2.190/2.100; Mi 18 2.060/2.100; Do 19 2.440/2.100; Fr 20 3.150/2.390 mit
   Training 290; Sa 21 1.150/2.400 mit Training 300, heute und ausgewählt; So 22 leer), damit jede Zeile grün und
   alle drei Rotstufen zeigt. Die Vorschau A2 aus Block 3 bleibt, wie sie ist.
8. `MorePage.tsx:151`: der Hinweis nennt die Darstellung nur, wenn sie nicht der Standard ist (Zusatz
   „ · “ und der Name, zum Beispiel „ · Feld mit Fuß“ oder „ · Punkte“); beim Standard bleibt der Text wie heute.
9. Keine Zählung, keine Serie, kein neuer Text außerhalb der Leiste und der Einstellung. Berichte, Wochenkarte und
   das Tagesbild bleiben, wie sie sind.

Tests:

- `packages/shared`: `dayVerdict` (kein Eintrag; kein Ziel; genau im Budget; 1 kcal drüber; angerechnetes Training
  hebt das Budget; Schritte nicht angerechnet); `overLevel` (1 kcal drüber ist 1; genau 10 % ist 1, knapp darüber
  2; genau 25 % ist 2, knapp darüber 3; doppeltes Budget ist 3).
- `apps/web/test/lib.test.ts`: die Einstellung (Standard, Schlüssel, der Standard löscht, unbekannter Wert);
  `stripMark` (Trainings-kcal ohne Schritte; nicht angerechnetes Training behält seine kcal und hebt das Budget
  nicht); die Bogenlängen als reine Funktionen (Untergrenzen 0,04, 0,07 und 0,08, Obergrenze 1).
- `week-strip.test.tsx`: mit einem Ziel in der Test-DB ein Tag im Ziel, einer drüber, einer nur mit Training, und
  das je Darstellung (`localStorage` `ft.weekMarks` vor dem Rendern): `data-marks`, `data-verdict`, `data-level` (dazu je ein Tag in Stufe 1, 2 und 3),
  `data-training`, welche Zeichen es gibt (`dots`: beide Punkte, kein `data-verdict`, Linkname ohne Urteil;
  `ring`: Ring und Trainings-Punkt; `ringArc`: Ring und Bogen, kein
  Trainings-Punkt; `field`: beide Punkte; `fieldFrame`: kein Punkt; `fieldFoot`: Fuß), Linknamen „…, Essen
  eingetragen, im Ziel“. Die bestehenden Fälle ohne Ziel (Zeilen 102 bis 127) behalten ihre Namen und ihren
  Essens-Punkt; sie laufen jetzt mit dem Standard `ringArc` (der Trainings-Punkt dort wird zum Bogen) und einmal
  unverändert mit `dots`.
- E2E (`appearance.spec.ts`): Standard ist „Ring mit Bogen“ (`data-marks="ringArc"` im Tagebuch, `/more` nennt
  nichts); „Feld mit Fuß“ wählen, `/more` nennt es, das Tagebuch zeigt `data-marks="fieldFoot"`, auch nach einem
  Neuladen; „Punkte“ zeigt die Leiste wie vor dieser Runde; alle sechs Namen stehen in der Auswahl. Andere Specs,
  die Punkte der Leiste prüfen, an den neuen Standard anpassen.
- Screenshots für die Abnahme, neben die Mockups gelegt, hell und dunkel: die Aussehen-Seite mit den sechs
  Beispielwochen; das Tagebuch mit einer Woche aus Testdaten in jeder der sechs Darstellungen; je Darstellung mit
  Urteil die 16 Zustände der Zustandsreihe aus v2 (Formen, von „Im Ziel“ bis „Gewählt, nur Training“) und die zwölf
  aus v3 (Farben: „Halb voll“, „Knapp im Ziel“, +4 %, +10 %, +16 %, +25 %, +32 %, +60 %, +100 %, „Heute, +16 %“,
  „Gewählt, +16 %“, „Kein Ziel“), soweit sie sich mit Testdaten herstellen lassen (ein Zustand, der fehlt, wird
  genannt).

### Block 5: Assistent-Knopf und Kamerabild (`features/assistant/place.ts` neu, `AssistantButton.tsx`, `BarcodeScanner.tsx`, `CameraStep.tsx`)

1. `data-ai-avoid` bedeutet ab jetzt **Sperrfläche** (ein Rechteck, in dem der Knopf nicht liegt), nicht mehr Boden.
   Böden bleiben Tab-Leiste, `[data-page-footer]` und Toasts, mit der heutigen Regel (untere Bildhälfte).
   - `BarcodeScanner.tsx`: `data-ai-avoid` an die Wurzel (`relative overflow-hidden rounded-2xl bg-black`): gilt
     für `/photo` und `/scan`; in den Sheets ist der Knopf ohnehin ausgeblendet (Dialog).
   - `CameraStep.tsx:79`: das Attribut an der Auslöser-Leiste entfällt (sie liegt im Bild). Das Ersatzfeld bei
     Kamerafehler (`camError`, die zwei großen Knöpfe) bekommt `data-ai-avoid`.
   - `PhotoPage.tsx:201` („Eingeben“/„Suchen“) behält es.
2. Reine Funktion in `features/assistant/place.ts`:
   `placeButton({ want, size, min, max, zones, gap }): number | null`. `zones` sind die senkrechten Bereiche
   `{ top, bottom }` der Sperrflächen, die die Spalte des Knopfes waagerecht schneiden. Gesperrt für die
   Oberkante des Knopfes ist je Fläche `[top − size − gap, bottom + gap]`. Ergebnis: das freie `y` in
   `[min, max]`, das dem Wunsch (`clamp(want, min, max)`) am nächsten liegt, bei Gleichstand das untere; `null`,
   wenn es keines gibt.
3. `AssistantButton.tsx`: `measure()` liefert die Böden wie heute und dazu die Rechtecke aller sichtbaren
   `[data-ai-avoid]`. Im Render: `y = placeButton(...)` mit `want = pos.y` (Standard `Infinity`, also so tief wie
   möglich), `gap` 8 px. Bei `null`:
   - im Leerlauf rendert der Knopf nichts (A8);
   - läuft eine Äußerung oder wartet eine Frage, gilt die alte Stelle (nur Böden), damit Aufnahme und Antwort
     erreichbar bleiben.
4. Ziehen bleibt frei; `pos.y` speichert weiter den Wunsch, die gezeigte Stelle rechnet `placeButton` (beim
   Loslassen über dem Bild rastet der Knopf am nächsten freien Platz ein). Der Schreibmodus (über der Tastatur)
   bleibt, wie er ist. Den Dateikommentar oben anpassen.
5. `useLayoutTick`: zusätzlich auf das Scrollen der Seite hören (passiv, über `requestAnimationFrame` gebündelt),
   weil Sperrflächen mit der Seite wandern (offene Analysen unter der Kamera machen `/photo` scrollbar).
6. Prüfen, ob der Abstand zum unteren Rand auf Seiten ohne Tab-Leiste und ohne Fußzeile die Safe Area beachtet
   (`/photo` auf dem iPhone, Home-Balken); wenn nicht, den Boden um `--safe-bottom` anheben.

Tests:

- `apps/web/test`: `placeButton` (keine Fläche; Wunsch frei; Wunsch in einer Fläche geht zum näheren Rand; zwei
  Flächen mit Lücke, die passt und die nicht passt; alles gesperrt gibt `null`; „Groß“).
- E2E, neue Spec `assistant-camera.spec.ts` (Assistent über die `**/api/info`-Route wie in `assistant.spec.ts`,
  gefälschte Kamera über `test.use` mit den Chromium-Startargumenten `--use-fake-device-for-media-stream` und
  `--use-fake-ui-for-media-stream` (`launchOptions.args`) und `permissions: ['camera']`; klappt die gefälschte
  Kamera im Container nicht, prüft die Spec dasselbe am Ersatzfeld und das wird als Abweichung notiert):
  - Viewport 390 × 844: der Knopf ist sichtbar, sein Rechteck schneidet weder das Kamerabild noch die Zeile
    „Eingeben“/„Suchen“; dasselbe mit `ft.assistant.size` „Groß“ und mit einer Position am linken Rand.
  - Viewport 390 × 664 (Standard der Projekte): auf dem Kamera-Schritt kein schwebender Knopf; nach „Eingeben“
    (Formular) ist er wieder da.
  - Ziehen auf das Bild und loslassen: der Knopf liegt danach nicht auf dem Bild.
- Screenshots: `/photo` in 360 × 760 mit „Klein“, „Mittel“, „Groß“ und einer Figur mit Überstand (Teufelchen).

### Block 6: Kamera-Fokus (`components/cameraFocus.ts` neu, `BarcodeScanner.tsx`, `cameraWarmup.ts`)

Drei Commits, damit jeder Teil einzeln rücknehmbar ist: a) Dauerfokus und Tippen, b) Diagnose, c) Hauptkamera.

a) Fokus:

1. `components/cameraFocus.ts`, alles tolerant (jeder `applyConstraints`-Fehler wird geschluckt, nie ein Toast):
   - `focusModes(track)`: `getCapabilities?.().focusMode ?? []`.
   - `startAutofocus(track)`: setzt `{ advanced: [{ focusMode: 'continuous' }] }`, wenn gemeldet.
   - `canTapFocus(track)`: Fokus-Modi gemeldet **und**
     `navigator.mediaDevices.getSupportedConstraints().pointsOfInterest` (das Feld steht nicht in den
     Capabilities).
   - `focusAt(track, point)`: `{ advanced: [{ pointsOfInterest: [point], focusMode: 'single-shot' }] }`, wenn
     `single-shot` gemeldet ist, sonst mit `continuous`; nach `FOCUS_HOLD_MS` (5 s) zurück auf `continuous`
     (Timer, den der nächste Tipp und das Stoppen der Kamera löschen).
   - `coverPoint({ boxW, boxH, videoW, videoH, x, y })`: rechnet einen Tipp im Element durch `object-cover` in
     Bildkoordinaten 0 bis 1 um (rein, getestet).
2. `BarcodeScanner.tsx`: nach dem Start `startAutofocus(track)` und `canTapFocus` als Zustand. Nur dann reagiert
   das Video auf einen Tipp (nicht die Bedienelemente darüber): `focusAt` und ein Fokusring an der Tippstelle
   (absolut, `pointer-events-none`, `aria-hidden`, etwa 600 ms, `motion-reduce:animate-none`, Farbe über Tokens).
   Der Lampen-Schalter setzt weiter nur `torch`. Auf dem iPhone meldet der Track das nicht: kein Ring, kein
   anderes Verhalten.
3. Tests `apps/web/test/camera-focus.test.ts` mit gefälschtem Track: Capabilities vorhanden (continuous wird
   gesetzt), fehlen oder `getCapabilities` fehlt (nichts passiert), `applyConstraints` lehnt ab (kein Fehler nach
   außen), `focusAt` mit und ohne `single-shot` und die Rückkehr nach `FOCUS_HOLD_MS` (Fake-Timer),
   `coverPoint` für ein Bild, das breiter und eines, das höher ist als das Feld.

b) Diagnose (A9): Einmal je Gerät und Kamera-Label, und nur wenn `enumerateDevices()` mehr als eine Rückkamera
nennt, schreibt die Kamera eine Zeile ins Fehlerprotokoll (`recordError`, Quelle `camera-info`): Label und
`deviceId`-Kürzel des laufenden Tracks, seine `focusMode`- und `focusDistance`-Angaben, die Labels aller
Videoeingänge. Der Merker liegt in `localStorage` (`ft.cameraInfo`). Keine neue Oberfläche: Die Zeile steht unter
„Daten & Sync“ und lässt sich dort kopieren.

c) Hauptkamera (A9):

1. `pickMainCamera(devices, currentId)` (rein, in `cameraFocus.ts`): Rückkameras sind Videoeingänge, deren Label
   „back“ oder „rück“ enthält; nur wenn es mindestens zwei mit dem Muster `camera2 <N>` gibt und die laufende
   nicht die mit der kleinsten Nummer ist, liefert sie deren `deviceId`, sonst `null`.
2. `BarcodeScanner.tsx`: liefert die Funktion eine Id, den Stream stoppen und einmal mit dieser Kamera neu
   starten; die Id in `localStorage` merken (`ft.camera.main`).
3. `cameraWarmup.ts`: aus der Konstanten wird `cameraConstraints()`, das eine gemerkte Id als
   `deviceId: { ideal }` mitgibt (eine veraltete Id fällt still auf `facingMode` zurück). Warm-up und Scanner
   rufen **dieselbe** Funktion; `camera-warmup.test.ts` und der Kommentar halten den Vertrag fest.
4. Tests: `pickMainCamera` (eine Rückkamera; mehrere, die laufende ist Nummer 0; mehrere, die laufende ist eine
   andere; Labels ohne Muster; leere Labels vor der Freigabe), `cameraConstraints` mit und ohne gemerkte Id.

### Block 7: Android, dunkles App-Icon (`scripts/icons.mjs`, `docs/logo`, `vite.config.ts`, `public/theme-init.js`, `lib/appearance.ts`, `AppearancePage.tsx`)

Das ist der Versuch aus der Grundlage (A11). Ob Chrome das Icon einer installierten App tauscht, zeigt erst das
Gerät der Testerin nach dem Ausrollen.

1. Icons: `docs/logo/logo-maskable-dark.svg` nach dem Muster von `logo-maskable.svg` (dunkler Grund, gleiche
   Schutzzone); `icons.mjs` rendert zusätzlich `pwa-dark-64x64.png`, `pwa-dark-192x192.png`,
   `pwa-dark-512x512.png` (aus `logo-dark-square.svg`) und `maskable-icon-dark-512x512.png`. Mit
   `pnpm --filter @ft/web icons` erzeugen und die Dateien ansehen.
2. Zweites Manifest: beim Build `manifest-dark.webmanifest` aus dem fertigen `manifest.webmanifest` ableiten
   (kleines Vite-Plugin in `vite.config.ts`, das nach `VitePWA` läuft: JSON lesen, nur die `src` der `icons` und
   der Shortcut-Icons tauschen, alles andere gleich, vor allem `id`, `start_url`, `scope`). Im Build prüfen: Die
   Datei liegt in `dist/`, steht im Precache des Service Workers und wird von der API mit dem Manifest-Typ
   ausgeliefert wie die helle.
3. Einhängen: genau **ein** `link[rel="manifest"]` im Dokument. `theme-init.js` liest zusätzlich `ft.icon`; steht
   es auf `dark`, zeigt der Link auf `/manifest-dark.webmanifest`. Weil das Plugin seinen Link hinter das Skript
   setzt, entweder den Link fest in `index.html` vor das Skript schreiben (und prüfen, dass das Plugin keinen
   zweiten anhängt) oder im Skript einen eigenen Link vor allen anderen einfügen, den `apply()` später
   zusammenführt. `apply()` in `appearance.ts` setzt das `href` bei jeder Änderung (`dark` nur bei ausdrücklich
   dunklem Icon, A11).
4. `AppearancePage.tsx`: die Infobox „Icon auf dem Home-Bildschirm“ nur auf iOS (`isIos()`).
5. Tests: `lib.test.ts` (welches Manifest bei `auto`, `light`, `dark`); `appearance.spec.ts` (Icon „Dunkel“ setzt
   den Manifest-Link, nach einem Neuladen steht er schon vor dem Start der App, „Hell“ und „Wie die App“ zeigen
   auf das helle; `GET /manifest-dark.webmanifest` liefert dieselbe `id` und dunkle Icons).
6. Rückfall, erst nach dem Gerätetest und nur wenn er scheitert (eigene kleine Änderung, nicht in dieser Sitzung
   ohne das Ergebnis): zweites Manifest und Link-Tausch entfernen, auf Android (`isAndroid()`) heißt der Abschnitt
   dann nach dem, was er dort ändert (Logo in der App), ohne Erklärsatz.

### Block 8: Doku

- `CLAUDE.md`: Wochenleiste (der Absatz „Week strip“ neu: Tage über `stripDays` und `ft.weekStrip`, Urteil über
  `dayVerdict`/`useStripMarks`, die sechs Darstellungen `WeekMarksPref` mit `ft.weekMarks`, `StripDay` als die eine
  Stelle, die zeichnet, die Stufen `overLevel` (10 % und 25 %), die Tokens `--strip-*` (im Ziel `--good`, drüber drei Rotstufen); der Satz „no ring on the selected day“ entfällt), Tagebuch-Kopf
  ohne Tagespfeile (E2E-Helfer `shiftDay`), Aussehen (beide neuen Einstellungen im Abschnitt „Tagebuch“,
  Manifest-Paar und die Regel aus A11), Assistent (Sperrflächen
  `data-ai-avoid`, `placeButton`, ausgeblendet ohne freien Platz), Kamera (`cameraFocus.ts`, Diagnosezeile,
  `cameraConstraints()`), Figuren (Packs werden beim Öffnen der Seite geladen).
- `docs/logo/README.md`: die dunklen Manifest-Icons und das dunkle Maskable.
- Dieser Statusblock: Commits, Abweichungen, Annahmen, Prüfung. Beide Plan-Dateien und beide Mockups (v2 Formen, v3 Farben) mit einchecken.

## Verifikation

- Je Block: `pnpm lint`, `pnpm typecheck` (nacheinander, nie parallel), `pnpm test`. Nach den UI-Blöcken (1, 3, 4,
  5, 7) `pnpm e2e`; am Ende einmal alles.
- Sichtprüfung mit dem Produktions-Build über die API und einem eigenen Playwright-Skript (Merkzettel
  „Dev-Proxy-Login“), iPhone-Format und 360 × 760, hell und dunkel: Tagebuch-Kopf ohne Pfeile (langes und kurzes
  Datum), Wochenleiste in beiden Tage-Varianten und in den sechs Darstellungen (Screenshots aus Block 4),
  Aussehen-Seite mit beiden neuen Auswahlen,
  Fotoseite mit dem Assistenten in drei Größen, die Figuren-Seite auf einem zweiten
  Gerät. Die Screenshots dem Nutzer am Ende zeigen.
- Nur auf Geräten prüfbar (Liste für den Nutzer, nach dem Ausrollen):
  - iPhone: Kamera unverändert, kein Fokusring; Figuren-Seite zeigt die Bilder ohne Tipp; die Darstellungen
    der Wochenleiste hell und dunkel lesbar (vor allem der dünne Bogen von „Ring mit Bogen“, der Rahmen am
    ausgewählten Tag und ob sich die drei Rotstufen am Ring und im Feld auseinanderhalten lassen, auch dunkel).
  - Android (Testerin): Fotoseite mit dem Assistenten in allen Größen (Knopf unter dem Bild, Auslöser frei,
    Ziehen); Nahaufnahme einer Nährwerttabelle (stellt scharf, Tippen fokussiert an der Tippstelle, Lampe an und
    Fokus bleiben zusammen bedienbar); die Diagnosezeile unter „Daten & Sync“ kopieren und schicken; wurde die
    Kamera gewechselt, ist das Bild danach die Hauptkamera; Barcode-Scan weiter schnell.
  - Android, Icon: App löschen, Icon auf „Dunkel“, neu installieren (dunkles Icon?); bei installierter App
    umstellen, die App an mehreren Tagen öffnen (tauscht Chrome das Icon, fragt es nach?); die App bleibt eine
    einzige Installation und aktualisiert sich weiter. Ergebnis entscheidet über den Rückfall in Block 7.

## Ablauf für Opus 5.5

1. Lesen: diesen Plan, die Planungsgrundlage `docs/plans/2026-11-feedback-runde-12.md`, `CLAUDE.md`
   (Abschnitte Wochenleiste, Aussehen, Assistent, Kamera, Navigation, „No explanation texts“), dann je Block die
   genannten Dateien. `git fetch` + `git status -sb`; ist `main` nicht mehr `2121829`, die Fundstellen neu suchen.
2. Reihenfolge wie die Blöcke (1 bis 8). Je Block ein Commit (Block 6 drei; Block 4 darf zwei sein: Daten und
   Zeichen, dann Einstellung), englischer Commit-Text, Attribution nach dem Hinweis der Sitzung. Vor jedem Commit lint, typecheck, test; e2e wie oben.
3. Keine Gedankenstriche in Texten, Kommentaren, Commits. Keine Erklärtexte im UI. UI-Texte deutsch, Code und
   Kommentare englisch, im Stil der umgebenden Dateien.
4. Annahmen nicht still ändern: Passt eine nicht zum Code oder zum Test, im Statusblock notieren und dem Nutzer
   sagen. Das gilt besonders für A8 (Rückfall b) und A9 (Kamerawahl).
5. Nicht bauen: irgendetwas zu Punkt 2 (keine Fläche „Nur im Hochformat“, kein Zurückdrehen, keine Sperre), einen
   Zoom-Knopf der Kamera, einen grünen Punkt, andere Vorschläge des Mockups v2 als die fünf gewählten und die Zeile „Heute“,
   andere Farben als K5 aus Mockup v3 (kein Gelb, kein Pegel, kein stufenloser Verlauf),
   den Rückfall des Icons (Block 7, Schritt 6), Änderungen an Berichten oder der Wochenkarte.
6. Nach dem letzten Block: Statusblock füllen, die Screenshots und die Geräteliste nennen, die offenen
   Entscheidungen aufzählen (die Annahmen A14 bis A18 zur Darstellung, soweit der Nutzer sie nicht bestätigt hat;
   Ergebnis des Icon-Versuchs). Nicht pushen, bis der Nutzer es sagt; das Ausrollen (Push, grüner Actions-Lauf, Deploy in Dockge) macht der Nutzer oder gibt es frei.
