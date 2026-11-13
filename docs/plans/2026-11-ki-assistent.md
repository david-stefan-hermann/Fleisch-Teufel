# KI-Assistent: Plan zur vollständigen Umsetzung

Umsetzung durch Opus 5.5. Den Statusblock hier pflegen (ein Block = ein Commit, Hash eintragen). Commits auf
`main`, **nicht pushen** (der Nutzer sagt, wann).

## Status

Geplant am 2026-11-13, vom Nutzer genehmigt. Noch kein Block umgesetzt.

| Block | Commit |
|---|---|
| 0 bis 12 | offen |

## Kontext

Der Nutzer will Fleisch-Teufel per Sprache (oder Text) bedienen: ein schwebender Knopf, der alles kann, was die
Oberfläche kann. Die App bleibt ohne KI voll nutzbar. Vorarbeit dieser Sitzung:

- Transkription: OpenAI `gpt-transcribe` war auf 22 eigenen Clips am treuesten (unter 1 s). Claude nimmt kein Audio.
- Verstehen: `claude-haiku-5-5`, effort low, Prompt-Cache: etwa 3 s und 0,08 Cent je Äußerung. Prototyp mit
  Systemprompt, Werkzeugen und 30 Testsätzen: `/home/dev/whisper-test/assistant_test.py` und `assistant_test2.py`
  (Endstand, Läufe `r5-low-*.txt`). Prompt und Werkzeugliste von dort übernehmen, nicht neu erfinden.
- UX: Mockup `docs/plans/2026-11-ki-assistent-mockup.html` (v6, vom Nutzer abgenommen). Es ist die Vorlage für
  Zustände, Zeiten, Texte und CSS des Knopfs.

## Entscheidungen des Nutzers (nicht neu verhandeln)

- Knopf auf jeder angemeldeten Seite, auch auf der Kamera; nur weg, solange ein Dialog offen ist. Verschiebbar,
  rastet links oder rechts ein, Position je Gerät.
- Kurz tippen = Aufnahme, noch einmal tippen = senden. Nie Ende durch Stille. Höchstens 2 Minuten, die letzten
  10 Sekunden zählen sichtbar herunter. Während der Aufnahme: Tastatur und X (verwerfen). Lang drücken (450 ms):
  Tastatur ohne Aufnahme.
- Textmodus: dunkle Fläche über der App, der gesprochene Satz als Text zum Bearbeiten, der Knopf wird „Senden“.
- Ergebnis: normaler Toast mit „Rückgängig“, keine Karte, kein Folgesatz-Fenster.
- Rückfrage: Sprechblase am Knopf mit 2 bis 4 Antworten. Nach einer gesprochenen Äußerung ist das Mikrofon 3 s von
  selbst offen (Balken läuft ab); Sprache hält es offen bis zu einer kurzen Pause, ohne Antwort geht es aus.
  Danach Antwort antippen oder Knopf antippen und sprechen. Nicht nach getippter Eingabe, nicht bei später
  ausgewerteten Offline-Sätzen. Eine unklare Antwort öffnet das Mikrofon nicht erneut.
- Offline: Aufnahmen warten, Zahl am Knopf. Ein wartender Foto-Satz fragt später per Sprechblase
  („Fotos jetzt aufnehmen?“), statt die Kamera plötzlich zu öffnen.
- Alles wird protokolliert (Gesagtes und Ausgeführtes), Audio 7 Tage, danach nur Text. Verlauf unter Mehr → Assistent.
- Figuren (Antworten vom 2026-11-13):
  - **Standard**: Symbol im Kreis, gebaut wie die bisherige Kreis-Figur: Kreis mit hellem Rand, Ring für den
    Zustand, Denk-Punkte als Pille darüber, leichtes Wippen, bessere Farben für hell und dunkel.
  - **Teufelchen**: fest in der App, als Bilderpack im Stil der Magierin (freistehend, Leuchten). Die Bilder
    liefert der Nutzer später; bis dahin die jetzige SVG-Figur aus dem Mockup, freistehend mit Leuchten.
  - **Elfenmagierin**: nicht in der App. Sie wird als fertiges Pack (eine Zip-Datei) gebaut, das der Nutzer selbst
    hochlädt. Hochgeladene Figuren liegen im Konto (Server), Geräte halten eine Kopie; welche Figur aktiv ist,
    bleibt je Gerät.
  - **Bibliothekarin**: entfällt ganz (auch aus dem Mockup, Lizenz ungeklärt).
  - Beim Verschieben zeigt die Figur das fröhliche Bild (`happy`), nicht mehr das wütende.
  - Ein Bild je Schritt (hört zu, denkt, eingetragen), keine Wechselbilder; in Ruhe erst nach 6 s wieder ein
    Gesicht von selbst.

## Architektur

Gerät nimmt auf → Server transkribiert und lässt Haiku Operationen planen → Gerät führt sie mit den vorhandenen
Schreibfunktionen in einer Dexie-Transaktion aus. Rückgängig, Sync und Papierkorb bleiben wie heute. Der Server
schreibt nie selbst in synchronisierte Tabellen.

### Server (`apps/api`)

- **Konfiguration** (`src/env.ts`, `deploy/.env.example`, README): `OPENAI_API_KEY`, `TRANSCRIBE_MODEL`
  (Standard `gpt-transcribe`), `ASSISTANT_MODEL` (Standard `claude-haiku-5-5`), `ASSISTANT_EFFORT` (Standard `low`).
  `ServerInfo` bekommt optional `assistantEnabled` (KI an und Anthropic-Schlüssel) und `voiceEnabled` (zusätzlich
  OpenAI-Schlüssel). Ohne `voiceEnabled` gibt es nur den Textmodus.
- **`app.ts:48`**: `permissionsPolicy.microphone: ['self']` (heute `[]`, das sperrt jede Aufnahme). Route
  `app.route('/api/assistant', …)`. Das globale 4-MB-Limit bleibt: Audio mit etwa 32 kbit/s (120 s ≈ 0,5 MB,
  Servergrenze `MAX_AUDIO_BYTES` 3 MB), Skin-Zip als roher Body wie `routes/photos.ts`.
- **Gemeinsames aus `routes/ai.ts` herauslösen** (`src/ai/admit.ts`, ohne Verhaltensänderung): `admit` (Budget vor
  Limit), der eine `RateLimiter(60, 1h)`, `logFailure`, `classifyAiError`. Assistent und Fotoanalyse teilen Budget
  und Limit.
- **Schnittstelle** `Deps.assistant: Assistant | null` (wie `analyzer`; in `server.ts` und `test/helpers.ts`
  ergänzen, Fake für Tests): `transcribe(audio, mime, signal)` und `understand(input, tools, signal)`.
  - Transkription: schlichtes `fetch` auf `https://api.openai.com/v1/audio/transcriptions` (`model`, `language=de`,
    `response_format=json`), eigene Fehlerklassen und Zuordnung auf 502/503/504. Kosten über eine eigene Funktion
    in `ai/pricing.ts` (Preis je Audiominute, beim Umsetzen auf der OpenAI-Preisseite nachsehen), nicht über
    `MODEL_PRICES`.
  - Verstehen: Werkzeugschleife mit dem Anthropic SDK (vor dem Schreiben den Skill `claude-api` laden):
    `paramsFor`, `usageOf`, `cache_control` aus `ai/analyze.ts` wiederverwenden, höchstens 8 Anfragen.
    Lesewerkzeuge laufen auf dem Server: `search_foods` (`createFoodSearch`, `ai/foodSearch.ts`, Treffer mit
    Portionen und „zuletzt“), `search_trainings` (shared `EXERCISE_TYPES`, eigene `exerciseTypes`,
    `exerciseTemplates` über `trainingItemsOf`, letzte Werte je Sportart), `get_day` (nur andere Tage als heute
    und gestern; `toWire`, `groupDiaryEntries`, ohne Tombstones und Schritte). Schreibwerkzeuge werden **nicht
    ausgeführt**: jeder Aufruf wird geprüft (Ids nur aus dem Kontext, aus `get_day` oder aus `seen`), als
    Operation gesammelt und mit einem kurzen Ergebnis quittiert; `ask` beendet die Runde.
  - Prompt: `SYSTEM` aus `assistant_test2.py` nach `src/assistant/prompt.ts`, mit einer Änderung: die
    Uhrzeit-Regel für die Mahlzeit entfällt (sie war im Test unzuverlässig). Nennt die Person keine Mahlzeit,
    liefert das Modell `meal: null`, und das Gerät entscheidet mit `logTargetFor` (`lib/meals.ts`).
- **Routen** (`src/routes/assistant.ts`, alle hinter `requireUser`, ohne Assistent 503 `ai_disabled`):
  - `POST /transcribe` (multipart `audio`, `requestId`) → `{ text }`; speichert das Audio. Für den Textmodus
    während der Aufnahme.
  - `POST /turn` (multipart: `audio` oder `text`, `context` als JSON, `requestId`) →
    `{ turnId, transcript, ops, question, reply, usage }`. Ein `requestId`, dessen Audio schon transkribiert
    wurde, wird nicht noch einmal transkribiert.
  - `PATCH /turns/:id` (`outcome`: applied, undone, discarded), `GET /turns` (Verlauf, neueste zuerst, seitenweise),
    `GET /turns/:id/audio`.
  - `GET /skins`, `GET /skins/:id` (Zip), `PUT /skins/:id` (roher Body, höchstens 3 MB, höchstens 5 je Konto),
    `DELETE /skins/:id`.
- **Kontext vom Gerät** (das Gerät ist die Wahrheit, der Server kann hinterherhinken): Uhrzeit, gezeigter Tag,
  Tagebuch von heute und gestern in Kurzform mit Eintrags-Ids, Trainings, Gewicht, Tagesziele, die letzten drei
  Äußerungen, `previousTarget` (Tag und Mahlzeit der direkt vorigen Äußerung), `openQuestion`. Format wie
  `Run.say` im Prototyp. Wächter: ein `ask` mit demselben Fragetext wie die offene Frage wird verworfen.
- **Tabellen** (nur Server, nicht synchronisiert; Migration `0018_assistant`):
  - `assistant_turns`: `id` (= `requestId`, eindeutig je Nutzer: das ist die Idempotenz, **nicht**
    `ai_analyses.request_id`, dort bleibt es null), `userId`, `createdAt`, `source` (voice, text), `transcript`,
    `context`, `ops`, `question`, `reply`, `status` (ok, failed), `error`, `outcome`, `response` (für die
    Wiederholung). Laufende Aufrufe über eine `inflight`-Map wie in `routes/ai.ts`.
  - `assistant_audio`: `turnId`, `mime`, `bytes`, `data` (bytea wie `photos`), `createdAt`. Neuer Job
    `cleanupAssistantAudio` in `maintenance.ts` (älter als 7 Tage).
  - `assistant_skins`: `userId`, `id`, `name`, `bytes`, `data`, `createdAt`.
  - Jeder Claude-Aufruf und jede Transkription ist eine Zeile in `ai_analyses`
    (`result.kind: 'assistant' | 'transcribe'`), damit `budgetExceeded` sie zählt.

### Operationen (`packages/shared/src/assistant.ts`, Zod, auf Server und Gerät geprüft)

`logFood` (Tag, `meal | null`, Zutaten als `{ food: Food, grams, portion?, guessed? }` aus `seen`, nie Nährwerte
vom Modell; optional `groupName`), `logEstimate` (wird ein Schnelleintrag mit Text „Name (N g, geschätzt)“),
`logSavedMeal`, `logQuick`, `updateEntry` (Gramm), `moveEntries`, `copyEntries`, `deleteEntries`, `saveMeal`,
`setWeight`, `logTraining` (Sportart oder Training, Minuten, Intensität), `openCamera` (Tag, Mahlzeit, Hinweis).
Dazu `question { text, options }` und `reply` (ein kurzer Satz, bei Datenfragen die Antwort).

### Gerät (`apps/web/src/features/assistant`)

- **Ausführen** (`execute.ts`): `applyOps(db, turn, ops, now)` in **einer** Transaktion über
  `[foodEntries, meals, exerciseEntries, weightEntries, assistantTurns, outbox]`, nur Dexie-Zugriffe darin
  (`rememberFood` danach, wie `queue.ts:227`). Vorhandene Funktionen aus `db/entries.ts`: `logItems` (Zutaten wie
  `aiMealItems` mit `computeItem` bauen; alle Zutaten für dasselbe Ziel in einem Aufruf, sonst kollidiert
  `loggedAt`), `logQuickEntry`, `logTrainings` (Werte auf dem Gerät rechnen: `metFor`, `trainingKcal`, aktuelles
  Gewicht, Muster `copiesOf`), `logParts`/`copyMealFromDay`, `moveEntriesToMeal` (nur gleicher Tag, sonst
  `patchRecord` mit `date`), `saveMealFromItems`, `deleteRecord`. Neu: `setWeight` in `db/` (ohne `@/`-Importe).
  Ids, die das Gerät nicht kennt, lassen nur diese Operation aus.
- **Rückgängig**: `UndoStep` ist serialisierbar und läuft nur über `deleteRecord`, `restoreRecord`, `patchRecord`
  (`delete` mit Ids, `restore` mit Ids, `patch` mit den vorigen Feldwerten; nie ein rohes `put`). Vorige Werte
  (Mahlzeit, Gramm, Gewicht, auch Tombstone) vor dem Schreiben lesen. Die Schritte stehen am Turn, damit
  „Rückgängig“ aus dem Toast und aus dem Verlauf geht; fehlende Zeilen still überspringen.
- **Dexie Version 6** (`db/dexie.ts`, alte Versionen nicht anfassen): `assistantTurns`
  (`++localId, createdAt, status`: Quelle, Audio als `ArrayBuffer` + Typ solange es wartet, Text, Tag der
  Aufnahme, Status waiting, sending, asking, done, failed, discarded, Transkript, Ops, Frage, Zusammenfassung,
  Undo-Schritte, `undoneAt`, `requestId`) und `assistantSkins` (Id, Name, Manifest, Bilder als `ArrayBuffer`).
  In `db/localOnly.ts` und `features/more/wipeWarning.ts` aufnehmen.
- **Warteschlange** (`queue.ts`, Muster `features/ai/queue.ts`): ein serieller Lauf, Start in `app/session.tsx`
  bei `online` und `visibilitychange`. `OfflineError`: bleibt wartend, Schleife bricht ab. `TimeoutError`:
  fehlgeschlagen, nie von selbst wiederholt, „Wiederholen“ behält die `requestId`. `api()` mit `timeoutMs` 120 s;
  Audio und Skins mit rohem `fetch`, Blob-URLs nur über `useObjectUrl`. Texte in `errorMessage` für den
  Assistenten ergänzen.
- **Zustand** (`machine.ts`, reiner Reducer, getestet): idle, starting, recording, thinking, asking, listening,
  typing, confused; Stimmungen für Figuren: done, undone, discarded, carried, Ruhe-Gesichter. Zeiten aus dem
  Mockup: `LISTEN_MS` 3000, `REST_MS` 6000, Aufnahme 120 s mit Warnung ab 10 s, lang drücken 450 ms,
  Ziehschwelle 8 px, „eingetragen“ 2,3 s. Ruhe-Gesichter in der App seltener als im Mockup: alle 10 bis 20 s.
- **Aufnahme** (`recorder.ts`): `getUserMedia({ audio })`, `MediaRecorder` (`audio/mp4` auf iOS, sonst
  `audio/webm;codecs=opus`, `audioBitsPerSecond: 32000`), `AudioContext` im ersten Tipp anlegen, Pegel über
  `AnalyserNode` für das 3-Sekunden-Fenster. Das Mikrofon läuft nur während Aufnahme und Hörfenster. Abgelehnte
  Berechtigung wie bei der Kamera (`BarcodeScanner.tsx:192`) melden.
- **Oberfläche**: `AssistantProvider` in `AuthedLayout` (`app/router.tsx:82`) nach dem `Outlet`, nicht im
  Onboarding, nicht ohne `assistantEnabled`. `z-[45]` (über der Tab-Leiste 40, unter Dialogen 50). Ausblenden,
  solange `[role=dialog]` im Dokument ist (`MutationObserver`; deckt Radix, vaul und `FullscreenOverlay`).
  Startposition rechts unten über Tab-Leiste oder `PageFooter`; Position in `ft.assistant.pos`, bei
  Größenänderung und gegen `--vvh` begrenzen; weicht einem Toast nach oben aus. Teile: `AssistantButton`
  (Zeiger: Tipp, lang drücken, ziehen, einrasten), `SideButtons`, `QuestionBubble` (mit Balken), `TextLayer`
  (Textfeld mit mindestens 16 px, über der iOS-Tastatur dank `--vvh`/`--vvt`). Toast: sonner mit Aktion
  „Rückgängig“, Text „Mahlzeit: Namen · N kcal“ wie im Mockup; geschätzte Mengen tragen im Verlauf die Marke
  „geschätzt“. Eine reine Antwort (`reply` ohne Ops) erscheint in der Sprechblase. Nicht verstanden: Toast
  „Nicht verstanden“, Figur verlegen.
- **Kamera**: `openCamera` navigiert zu `/photo` mit Tag und Mahlzeit; der Hinweis reist nicht in der URL
  (`strParam` ist zu kurz), sondern in `sessionStorage` (`ft.assistant.hint`), `PreviewStep.tsx` nimmt ihn als
  Startwert des Hinweisfelds.
- **Verlauf** `/settings/assistant` (Zeile „Assistent“ in `MorePage.tsx`): Gerätetabelle zuerst (geht offline,
  mit „Rückgängig“, „Verwerfen“ für Wartende, Marken „wartet“, „rückgängig gemacht“, „geschätzt“, „getippt“),
  online ergänzt um Äußerungen anderer Geräte aus `GET /turns` (nur lesen). Abspielknopf, solange das Audio da ist.
  Aufbau wie Frame D1 im Mockup. Keine Erklärtexte.

### Figuren

- `skins/types.ts`: `SkinManifest { format: 'fleisch-teufel-skin', version: 1, name, style: 'free' | 'circle',
  pixelArt?, thinkingDots?, images: Record<key, file>, states: Partial<Record<State, key>>, idle: key[] }`.
  Pflicht ist nur `states.idle`; fehlt ein Bild, bleibt die Ruhe stehen. Zustände: idle, typing, listening, warn,
  thinking, asking, confused, error, done, undone, discarded, carried.
- `StandardSkin` (Komponente, Symbole Mikrofon, Stopp, Punkte, Senden; Farben als Tokens in `index.css` für hell
  und dunkel, kein fest verdrahtetes Rot) und `PictureSkin` für alle Bilderpacks: `free` ohne Kreis, Leuchten als
  `drop-shadow` am Rahmen (rot beim Zuhören, lila beim Denken, schneller in den letzten 10 s), Maske am Bild für
  den weichen unteren Rand, kleines Schild für Mikrofon, Stopp, Senden; `circle` mit Rand und Ring; `pixelArt`
  mit `image-rendering: pixelated` und ganzzahliger Skalierung in Gerätepixeln. CSS aus dem Mockup übernehmen.
- Teufelchen: `skins/teufelchen/` mit Manifest; solange keine Bilder da sind, die SVG-Figur aus dem Mockup als
  `free`-Figur mit Leuchten. Kommen Bilder als PNG oder WebP, `webp` in `globPatterns` (`vite.config.ts`) ergänzen.
- Eigene Packs: Zip mit `skin.json` und Bildern, auf dem Gerät mit `fflate` gelesen und geprüft (höchstens 3 MB,
  40 Bilder, nur PNG und WebP, je höchstens 512 px), dann `PUT /skins/:id` und Kopie in `assistantSkins`; andere
  Geräte laden die Liste beim Öffnen der Seite und das gewählte Pack einmal.
- `tools/skin-pack/build.mjs <Ordner> <Manifest> <Ziel>`: wandelt in WebP 256 px und packt die Zip. Damit das
  Pack **Elfenmagierin** aus `/home/dev/fleisch-teufel-assistant-test/Elf Mage` bauen (17 Bilder, Zuordnung wie
  `ELF_FRAMES` im Mockup, aber `carried: happy`; `furious` wird ein Ruhe-Gesicht weniger oder bleibt ungenutzt)
  nach `/projects/Fleisch-Teufel/skins/elfenmagierin.zip`; `/skins/` in `.gitignore` (das Pack darf laut Readme
  genutzt, aber nicht weitergegeben werden).
- Mehr → Aussehen, Abschnitt „Assistent“ (`AppearancePage.tsx`, `lib/appearance.ts`: `ft.assistant.button`,
  `ft.assistant.skin`): Schalter „Knopf anzeigen“, Kacheln Standard, Teufelchen, hochgeladene Figuren (mit
  Löschen), „Eigene Figur“ (Dateiauswahl).

## Blöcke (je ein Commit, danach `pnpm lint`, `pnpm typecheck`, `pnpm test`)

0. Mockup nachziehen: Bibliothekarin entfernen, Verschieben = `happy`, Standard
   im neuen Kreis-Stil, Teufelchen freistehend. Mockup committen (ohne Bibliothekarin ist die Lizenzfrage erledigt).
1. Shared: Operations- und Turn-Schemata, `assistantEnabled`/`voiceEnabled`, Env, Mikrofon-Policy, `/api/info`.
2. Server: `ai/admit.ts` herauslösen (bestehende `ai.test.ts` bleibt grün).
3. Server: Tabellen, Migration, `Deps.assistant` mit Fake, `/transcribe`, Transkriptionspreis, Audio-Aufräumjob.
4. Server: `/turn` mit Werkzeugschleife, Lesewerkzeugen, Prüfung der Ops, Idempotenz, `/turns`.
5. Gerät: `setWeight`, `applyOps`, `UndoStep` mit Tests (noch ohne Oberfläche).
6. Gerät: Dexie v6, Warteschlange, `localOnly`, `wipeWarning`.
7. Knopf mit Textmodus: Provider, Reducer, Toast mit Rückgängig, Sprechblase, Ausblendregeln, Standard-Figur.
   Ab hier ist der Assistent benutzbar.
8. Sprache: Aufnahme, 2-Minuten-Grenze, lang drücken, Hörfenster, Offline-Zahl, Kamera-Operation.
9. Verlauf `/settings/assistant` mit Abspielen.
10. Figuren: `PictureSkin`, Teufelchen, Abschnitt „Assistent“ unter Aussehen.
11. Eigene Packs: `assistant_skins`, Routen, `fflate`, `tools/skin-pack`, Elfenmagierin-Pack bauen.
12. Doku: Abschnitt „Assistent“ in `CLAUDE.md`, README (Env-Tabelle), `deploy/.env.example`, `docs/sync.md`
    (neue Gerätetabellen).

## Prüfung

- API (`apps/api/test/assistant.test.ts`, Fake wie `fakeAnalyzer`): ohne Assistent 503; Budget und Limit geteilt
  mit `/api/ai`; wiederholte `requestId` ohne zweiten Modellaufruf; Ops mit fremden Ids abgelehnt; `get_day` ohne
  Tombstones und fremde Nutzer; Audio-Erkennung und Größe; Permissions-Policy; `cleanupAssistantAudio` in
  `maintenance.test.ts`; Skin-Upload (Größe, Anzahl, Besitzer).
- Web (`apps/web/test`): `applyOps` und Rückgängig je Operation (eine Outbox-Zeile je Schreibvorgang, Gewicht
  über einem Tombstone, Rollback wenn eine Operation scheitert), Reducer, Warteschlange (offline bleibt wartend,
  Timeout wird nicht wiederholt), Zip-Prüfung, `localOnly`.
- E2E: Playwright läuft mit `AI_ENABLED=false`: der Knopf fehlt, bestehende Specs bleiben unverändert. Eine neue
  Spec stubbt `/api/info` und `/api/assistant/turn` per `page.route`, tippt einen Satz im Textmodus und prüft
  Tagebuchzeile, Toast und „Rückgängig“.
- Echter Durchlauf im Dev-Server mit den Schlüsseln aus der Projekt-`.env`: die 30 Testsätze des Prototyps als
  Skript gegen `/api/assistant/turn` (Text), Ergebnis mit `r5-low-*.txt` vergleichen; ein paar WAV-Clips aus
  `/home/dev/whisper-test/clips` gegen `/transcribe`.
- Screenshots hell und dunkel (eigenes Playwright-Skript über den Proxy :5174, siehe Memory `dev-proxy-login`)
  von Knopf, Aufnahme, Sprechblase, Textmodus, Verlauf, Aussehen; Pack hochladen und wählen.
- Offen für den Nutzer am iPhone (im Statusblock festhalten): öffnet das Mikrofon in der installierten PWA ohne
  Tipp (sonst Ausweichlösung: den Stream von der Aufnahme bis zum Ende des Hörfensters offen halten), Mikrofon
  und Kamera gleichzeitig auf `/photo`, Sitz des Knopfs über der iOS-Tastatur.
