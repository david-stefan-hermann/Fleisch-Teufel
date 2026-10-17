# Fotoanalyse mit mehreren Fotos, Zurück ins Tagebuch, kein Auto-Öffnen des Reviews

## Context

Die Foto-Analyse kennt heute genau ein Foto pro Analyse: `aiImages` (ein Datensatz je `localId`),
`POST /api/ai/analyze` liest `form.get('image')`, `foodEntries.photoId` ist ein einzelner Wert, der
Gruppen-Editor schickt beim „Neu analysieren“ dieses eine Foto. Der Nutzer will:

1. **Mehrere Fotos je Analyse**: in der Vorschau (vor „Analysieren“) und im Review („Ergebnis prüfen“)
   weitere Fotos aufnehmen oder aus der Mediathek hinzufügen (Hauptspeise und Dessert, Teller von der
   Seite, Zutatenliste oder Nährwerttabelle einer Packung). Alle Fotos werden gespeichert und hängen am
   Tagebucheintrag; „Neu analysieren“ im Gruppen-Editor schickt alle mit, und dort können später noch
   Fotos dazukommen.
2. **Zurück während der Analyse führt ins Tagebuch** (Pfeil und Wischen), die Analyse läuft weiter.
3. **Kein Auto-Öffnen**: wird die Analyse fertig, während man im Tagebuch ist, öffnet sich das Review
   nicht. Das Ergebnis wird wie bei Offline-Fotos (Runde 8, Entscheidung E1) **automatisch eingetragen**;
   Änderungen laufen über den Gruppen-Editor.

Heute passiert bei 3 sogar das Gegenteil: `PhotoPreview.analyze()` wartet auf `processQueue` und ruft
dann `setActiveId(id)` (`navigate({ from: '/photo', search: … })`), auch wenn man längst im Tagebuch
ist; ein so fertig gewordener Eintrag ist zudem im Tagebuch unsichtbar (`usePendingAnalyses` filtert
`!result`, `logDeferred` nimmt nur `deferred`).

### Entschieden (mit dem Nutzer, 2026-10-17)

- Direkt Implementierungsplan, kein Mockup.
- **Review**: hinzugefügte oder entfernte Fotos werden nur gesammelt; erst ↻ analysiert neu (ein Aufruf
  für mehrere Fotos). Nicht analysierte Fotos sind als „Neu“ markiert, ein Hinweis sagt, dass ↻ fehlt.
- **Verlassen während der ersten Analyse**: Ergebnis wird automatisch eingetragen (Toast „… analysiert
  und eingetragen“), nie das Review geöffnet. Gilt für die erste Analyse eines Fotosatzes; eine erneute
  Analyse aus dem Review (↻) verhält sich wie heute (Review bleibt in der Liste „Analysen“).
- **Gruppen-Editor**: zeigt alle Fotos, hat „+“ (Kamera/Mediathek), neue Fotos werden erst mit
  „Änderungen übernehmen“ gespeichert und an alle Einträge der Gruppe gehängt; ↻ nimmt sie mit.

### Annahmen (im Plan festgelegt, bei Widerspruch melden)

- Höchstens **5 Fotos** je Analyse (`MAX_ANALYSIS_PHOTOS`, shared), wie `MAX_LABEL_PHOTOS = 3` beim Etikett.
- Gespeicherte Meals behalten **ein** Foto (`meals.photoId` = erstes Foto der Analyse); der Meal-Editor
  ändert sich nicht. Alle Fotos hängen an den Tagebucheinträgen (`photoIds`).
- `photoId` bleibt als erstes Foto erhalten (Thumbnail, alte Geräte), `photoIds` kommt dazu.
- Im Gruppen-Editor lassen sich nur gerade hinzugefügte, noch nicht gespeicherte Fotos wieder entfernen;
  gespeicherte Fotos bleiben (kein Löschen von Fotos eines Eintrags, nicht gefordert).
- Barcodes: nur die Live-Kamera des ersten Fotos auf `/photo` reagiert wie heute auf Barcodes. Das Sheet
  „Fotos hinzufügen“ ignoriert Barcodes (eine Nährwerttabelle hat oft einen daneben).

## Umsetzung

### 1. Shared: Konstante, Schema, Helfer

`packages/shared/src/schemas.ts`

- `export const MAX_ANALYSIS_PHOTOS = 5;` neben `ESTIMATED_ID_PREFIX`.
- `foodEntrySchema`: neues Feld
  `photoIds: z.array(idSchema).max(10).nullable().default(null)` mit Doku: alle Fotos der Gruppe in
  Reihenfolge der Analyse, auf jedem Eintrag gleich; `photoId` ist weiter das erste (Thumbnail, ältere
  Geräte). `null` bei Datensätzen älterer App-Versionen. Nie strenger machen.
- Helfer `photoIdsOf(entry: Pick<FoodEntry, 'photoId' | 'photoIds'>): string[]` in
  `packages/shared/src/diary.ts`: `photoIds ?? (photoId ? [photoId] : [])`.
- `AiAnalysisResult` bekommt kein neues Feld (Fotos liegen beim Gerät bzw. an den Einträgen).

Tests: `packages/shared/test` (Schema-Default `photoIds: null`, `photoIds` wird aus `photoId` abgeleitet).

### 2. API: mehrere Bilder je Analyse

Vorher die Skill `claude-api` laden (Regel aus CLAUDE.md).

`apps/api/src/ai/analyze.ts`

- `AnalyzeInput` wird `{ images: { base64: string; mediaType: ImageMediaType }[]; text: string | null }`
  (wie `LabelInput`).
- Nachricht: je Foto ein Textblock `Foto ${i + 1}:` gefolgt vom Bildblock, danach
  `userPrompt(input.text, images.length)`. `cache_control` bleibt.

`apps/api/src/ai/prompt.ts`

- `SYSTEM_PROMPT`: „Du bekommst ein bis fünf Fotos einer Mahlzeit …“ und ein neuer Block:
  - Mehrere Fotos können dieselbe Mahlzeit aus anderen Winkeln zeigen (hilft bei Schichthöhe und Menge),
    verschiedene Gänge oder Teller **derselben** Mahlzeit (alles zusammen ist ein Ergebnis, jedes
    Lebensmittel nur einmal zählen, auch wenn es auf zwei Fotos zu sehen ist), oder eine Verpackung,
    Zutatenliste oder Nährwerttabelle zu einem der Lebensmittel.
  - Verpackung/Etikett: Produktname und Marke als Suchbegriffe (packaged true), die gegessene Menge aus
    den Tellerfotos oder der Notiz. Ist das Produkt nicht in der Datenbank, gelten die aufgedruckten Werte
    pro 100 g als `estimate` (dann confidence "medium" statt "low", weil abgelesen, nicht geschätzt).
  - Ein Foto ohne Essen (z. B. nur Etikett) ist kein Fehler; „Kein Essen zu sehen“ gilt nur, wenn kein
    Foto Essen zeigt.
  - `dishName` fasst die ganze Mahlzeit zusammen („Schnitzel mit Pommes und Tiramisu“).
- `userPrompt(text, photos)`: „Analysiere das Foto.“ bzw. „Analysiere die N Fotos zusammen als eine
  Mahlzeit.“

`apps/api/src/routes/ai.ts`

- `/analyze`: `bodyLimit` auf `MAX_ANALYSIS_PHOTOS * MAX_IMAGE_BYTES + 1 MiB`; `form.getAll('image')`
  wie bei `/label`: 0 → `image_missing`, > `MAX_ANALYSIS_PHOTOS` → 400 `too_many_images`, je Datei
  Typ (415) und Größe (413) prüfen, dann `images` bauen. Reihenfolge Rate-Limit vor dem Parsen bleibt wie
  heute bei `/analyze`.
- `aiAnalyses.result` zusätzlich `photos: images.length` (nur Statistik, wie beim Etikett).
- `log.info('ai analysis', …)` bekommt `photos`.
- `GET /analyses/:id/hint` bleibt.

Tests `apps/api/test/ai.test.ts`: `fakeAnalyzer` pusht weiter `input` (`received`), die Zusicherung
`received.at(-1)` mit `{ mediaType }` (Zeile um 225) wird zu `images[0].mediaType`; Helfer `photo()`
nimmt eine Anzahl; Fälle: 2 Fotos ergeben einen Aufruf mit 2 Bildern und `result.photos = 2`; 6 Fotos →
400 `too_many_images`; ein zu großes zweites Foto → 413; bestehende Fälle laufen mit einem Foto weiter.

### 3. Datenbank und Sync: `photoIds`

Skill `offline-sync` beachten.

- `apps/api/src/db/schema.ts`: `foodEntries.photoIds: jsonb().$type<string[]>()` (nullable).
  `pnpm --filter @ft/api db:generate --name food-entry-photo-ids` → `apps/api/drizzle/0006_…sql` committen.
- `apps/api/test/sync.test.ts`: Round-Trip mit `photoIds` (und ohne: bleibt `null`).
- Dexie braucht für `photoIds` keinen Index.

### 4. Gerät: Fotos der Warteschlange (Dexie v5)

`apps/web/src/db/dexie.ts`

- Neue Tabelle `aiPhotos: '++id, localId'`, Typ
  `AiPhoto { id?: number; localId: number; bytes: ArrayBuffer; type: string; createdAt: number }`
  (Reihenfolge = `id`). `this.version(5).stores({ aiPhotos: '++id, localId' })`, kein `.upgrade()`
  (gleicher Grund wie v4). `aiImages` bleibt deklariert, wird nur noch gelesen und geleert.
- `AiQueueItem`: neues Feld `analyzedPhotoIds?: number[]` (ids der `aiPhotos`, die in die letzte
  fertige Analyse eingegangen sind; für „Neu“-Markierung und `photosChanged`). Doku zu `deferred`
  erweitern: wird auch gesetzt, wenn die Person die Foto-Seite während der ersten Analyse verlässt.

`apps/web/src/features/ai/queue.ts`

- `analyzePhotos(images: Blob[], text)`: Feld `image` je Foto wiederholt (`meal-1.jpg`, …), wie
  `endpoints.readLabel`. `analyzePhoto` entfällt (Aufrufer: Queue, Gruppen-Editor).
- `loadQueueImages(db, item): Blob[]` (aus `aiPhotos` nach `localId`, sortiert nach `id`; Fallback
  `item.image`). `imageBlob` bleibt für `AiPhoto`/`AiImage` (gleiche Felder).
- `migrateLegacyImages`: zusätzlich jede `aiImages`-Zeile als `aiPhotos`-Zeile anlegen (createdAt =
  item.createdAt) und aus `aiImages` löschen; Waisen in `aiPhotos` nach `localId` entfernen.
- `enqueuePhotos(db, item, images: Blob[])` (alle `arrayBuffer()` vor der Transaktion, dann `add`
  des Items und `bulkAdd(rows, { allKeys: true })` der Fotos; `bulkAdd` ohne Option liefert nur den
  letzten Schlüssel). `addQueuePhotos(db, localId, images)`, `removeQueuePhoto(db, id)`.
- `runQueue`: lädt die Fotos **mit ids**, schickt `analyzePhotos`, schreibt bei Erfolg
  `analyzedPhotoIds` (die gesendeten ids) mit `status: 'done'`.
- `leaveAnalysis(db, localId)`: setzt in einer Transaktion `deferred: true` auf dem Item (nur wenn es
  noch kein `result` hat), danach `void processQueue(db)`. **Nicht** `logDeferred` direkt rufen:
  `logDeferred` läuft nur innerhalb von `runQueue` (Anfang und nach jedem `done`), das über
  `processQueue`/`again` serialisiert ist. So können nie zwei `logDeferred`-Läufe dasselbe Item sehen
  und doppelt eintragen. `logDeferred` wird deshalb modulintern (nicht mehr exportiert; Tests rufen
  `processQueue`).
- `logDeferred`: lädt alle Fotos und gibt sie `logAiItems` mit. Hat ein verlassenes Item kein
  brauchbares Lebensmittel (heute still `deferred: false`), zusätzlich ein Toast „Kein Essen erkannt. Das
  Foto liegt unter „Analysen“ auf der Foto-Seite.“, weil die Platzhalterzeile dann aus dem Tagebuch
  verschwindet.
- `discardQueueItem` und `takeQueueItem` löschen die Fotos über `aiPhotos.where('localId').equals(id)`
  (nicht mehr per Primärschlüssel); `takeQueueItem` gibt `photos: AiPhoto[]` zurück, `restoreQueueItem`
  legt sie mit ihren ids per `bulkPut` wieder an (ein wiederhergestelltes Item behält `deferred`).
  `reanalyze` unverändert in der Sache; es darf auch laufen, wenn nur die Fotos geändert wurden.

`apps/web/src/features/ai/useAiImage.ts` → `useAiImages(item): { id: number; blob: Blob }[] | undefined`
(Live-Query auf `aiPhotos.where('localId')`; Fallback-Kette `aiPhotos` → `aiImages`-Zeile → Legacy-Blob
`item.image`, jeweils mit id 0, weil Tagebuch und `PendingAnalysisRow` rendern können, bevor
`migrateLegacyImages` in `runQueue` gelaufen ist). Dieselbe Kette in `loadQueueImages`. Aufrufer: Review,
`QueueRow`, `PendingAnalysisRow` (erstes Foto, Anzahl als kleines Badge bei > 1).

### 5. Gerät: Eintragen mit allen Fotos

`apps/web/src/db/entries.ts`

- `logItems` opts: `photoIds?: string[] | null`; jeder Gruppeneintrag bekommt `photoIds` (und wie bisher
  `photoId`). Ohne Gruppe beides null.
- `logAiItems(db, name, items, target, analysis, photos: Blob[])`: `storePhoto` je Foto (Reihenfolge),
  `photoIds`, `photoId = photoIds[0] ?? null`.
- `createAiMeal(db, name, items, photo)`: bekommt das **erste** Foto (Aufrufer übergibt `photos[0]`).
- **Invariante überall: `photoId === (photoIds?.[0] ?? null)`.** Dann zeigt die Gruppenzeile immer das
  erste Foto des Streifens und der Zähler stimmt.
- `logAiMeal(…, analysis, photos: Blob[])`: speichert alle Analyse-Fotos; `photoIds =
dedupe([existing?.photoId, ...analyseIds])` (das Meal-Foto zum Zeitpunkt des Eintragens zuerst, wie
  heute), `photoId = photoIds[0]`. Dass das erste Foto bei einem gespeicherten KI-Meal doppelt in
  `photos` liegt (einmal am Meal, einmal am Eintrag) ist bewusst (Fotos sind unveränderlich und klein).
- `MealLogView.tsx` (Meal eintragen): `photoIds: meal.photoId ? [meal.photoId] : null` neben `photoId`.
- `apps/web/src/features/diary/MealCard.tsx` (`GroupRow`): Thumbnail bleibt `photoId`; bei
  `photoIdsOf(entries[0]).length > 1` ein kleines Zähler-Badge an der Ecke des Thumbnails.

`apps/web/src/db/groupDraft.ts`

- `saveGroupDraft`: neue Einträge kopieren `photoIds` (neben `photoId`); die `changed`-Prüfung gehaltener
  Einträge muss auch anschlagen, wenn sich nur `photoIds` ändert.
- Neue Fotos des Editors: kv-Schlüssel `groupDraftPhotos:<groupId>` mit
  `{ bytes: ArrayBuffer; type: string; at: number }[]` (`at` als Identität, wie `mealDraftPhoto:<id>` in
  `db/mealDraft.ts`), Funktionen `readGroupDraftPhotos`, `addGroupDraftPhotos(db, groupId, blobs)`
  (komprimiert übergeben), `removeGroupDraftPhoto(db, groupId, at)`; `clearGroupDraft` löscht beide
  Schlüssel (darauf verlassen sich „Löschen“ und `DiscardDialog onDiscard` im Editor). **Kein Zähler im
  `GroupDraft`**: der Editor hält `draft` im Komponenten-State und schreibt ihn bei jedem Tastendruck
  komplett zurück, ein in kv gesetzter Zähler würde überschrieben. Stattdessen liest der Editor die Fotos
  per `useLiveQuery(readGroupDraftPhotos)`, `dirty = isGroupDirty(…) || draftPhotos.length > 0`, und
  `saveGroupDraft` liest den Foto-Schlüssel selbst.
- `saveGroupDraft`: speichert die neuen Fotos mit `storePhoto`, patcht **alle** gehaltenen Einträge der
  Gruppe mit `photoIds: [...photoIdsOf(first), ...neu]` und `photoId: photoIds[0]`; neue Einträge bekommen
  dieselbe Liste.

Tests `apps/web/test/write.test.ts`: `logAiItems` mit 2 Fotos (zwei `photos`-Zeilen, `photoIds` auf
jedem Eintrag, `photoId` = erstes); `logAiMeal` mit Fotos; `saveGroupDraft` kopiert `photoIds` und hängt
neue Fotos an alle Einträge; `clearGroupDraft` räumt `groupDraftPhotos` weg.

### 6. Foto-Seite (`features/ai/PhotoPage.tsx`): Vorschau, Analyse, Verlassen

Zustand der Seite: `shots: Blob[]` statt `shot`, `waiting: number | null` (Item, auf das die Vorschau
wartet; zusätzlich als Ref für Cleanup).

**Vorschau (`PhotoPreview`)**

- Zeigt `PhotoStrip` (Abschnitt 8) mit den Fotos: großes Bild (gewählt, Standard das erste), darunter
  Thumbnails mit X und eine „+“-Kachel (bis `MAX_ANALYSIS_PHOTOS`). X am einzigen Foto = „Neu aufnehmen“
  (zurück zur Kamera, `onDiscard`). Der Button „Neu aufnehmen“ oben links entfällt.
- „+“ öffnet `PhotoCaptureSheet` (Abschnitt 8); „Übernehmen“ hängt die Fotos an `shots`.
- **Komprimieren beim Hinzufügen**, nicht erst in `analyze()`: `shots` enthält nur komprimierte Blobs
  (`compressImage(…, IMAGE_PRESETS.analysis)` im `onShot` der ersten Kamera und im Sheet über dessen
  `preset`), damit nicht fünf Kamerabilder in voller Größe im Speicher liegen (iOS).
- Footer: „Analysieren“ bzw. „Analysieren (N Fotos)“ (Wortlaut wie im Etikett-Sheet).
- `analyze()`: `enqueuePhotos` → `waiting = id` → `await processQueue(db)` → wenn
  `waitingRef.current !== id`: nichts mehr tun (Seite verlassen oder übergeben). Sonst Item lesen:
  `done` und nicht `deferred` → `waiting = null`, Review öffnen; `done` und `deferred` → nichts (wurde
  beim Verlassen übernommen); `pending` (offline) → Toast, ins Tagebuch; `failed` → Toast, zurück zur
  Kamera (das Item steht mit „Wiederholen“ im Tagebuch).
- Während der Analyse: Overlay auf dem Streifen, Hinweisfeld gesperrt, Footer-Button deaktiviert mit
  Spinner „Wird analysiert…“, darunter der Satz „Du kannst zurück ins Tagebuch gehen. Das Ergebnis wird
  dort eingetragen.“

**Verlassen während der Analyse**

- Header-Pfeil (`Page onBack`): heute heißt `onBack` in der Vorschau „Foto verwerfen, zurück zur
  Kamera“. Das bleibt so, **außer** während `waiting`: dann `waitingRef.current = null`,
  `leaveAnalysis(db, id)`, `navigate({ to: '/', search: { date } })` (wie „Meal eintragen“).
- Wischen, Browser-Zurück, Lupe/Blitz-Links: Cleanup eines `useEffect` auf Seitenebene (`[db]`), das beim
  Unmount `waitingRef.current` liest, **die Ref auf null setzt** und dann `leaveAnalysis` ruft. Die
  Übergabe ans Review setzt die Ref ebenfalls vorher auf null, damit das Öffnen des Reviews (die Vorschau
  wird dabei unmontiert) nicht als Verlassen zählt. Das Nullsetzen ist entscheidend: `analyze()` läuft
  nach `await processQueue` auf dem unmontierten Baum weiter und darf dort `onQueued` nicht mehr rufen,
  sonst zieht `navigate({ from: '/photo' })` die Person aus dem Tagebuch zurück (der heutige Fehler).
- Damit öffnet sich das Review nie von selbst. Das Tagebuch zeigt derweil die Platzhalterzeile „Wird
  analysiert…“ (unverändert), danach loggt `logDeferred` die Gruppe mit allen Fotos und Toast.

**Erste Kamera (`CameraCapture`)**: unverändert in der Sache (Live-Barcode, Shutter, Mediathek). Die
Mediathek darf `multiple` bekommen: mehrere gewählte Dateien werden alle zur Vorschau (Barcode-Prüfung nur,
wenn genau eine Datei gewählt wurde).

### 7. Review (`ResultEditor`): Fotos sammeln, ↻ analysiert

- `PhotoStrip` statt des einzelnen `MealPhoto`: alle Fotos des Items (`useAiImages`), Thumbnails mit X
  (nicht am letzten), „+“-Kachel öffnet `PhotoCaptureSheet`; „Übernehmen“ → `addQueuePhotos` (komprimiert).
  X → `removeQueuePhoto`. Während `busy` gesperrt.
- `photosChanged = fotos.some(f => !analyzedPhotoIds.includes(f.id)) || analyzedPhotoIds.some(id =>
!fotos.has(id))`, im Render abgeleitet (kein State). Nicht analysierte Thumbnails tragen ein Badge
  „Neu“; unter dem Streifen bei `photosChanged` eine Hinweiszeile „1 Foto noch nicht analysiert. Tippe
  oben auf ↻.“ (Plural „N Fotos“; bei nur entfernten Fotos „Fotos geändert. Tippe oben auf ↻.“). Kein
  weiteres Signal am ↻-Button.
- ↻: wie heute (`draftChanged` fragt zuerst); schickt alle aktuellen Fotos. Der Dialogtext bleibt.
- „Meal eintragen“ / „Als Meal speichern“: `loadQueueImages` → `logAiItems(…, photos)`,
  `logAiMeal(…, photos)`, `createAiMeal(…, photos[0])`. Nicht analysierte Fotos werden trotzdem
  gespeichert (sie gehören zur Mahlzeit).
- `QueueRow` („Analysen“-Liste): erstes Foto, Zähler-Badge bei mehreren.

### 8. Gemeinsame Bausteine: `PhotoStrip` und `PhotoCaptureSheet`

`apps/web/src/components/PhotoStrip.tsx` (neu)

- Props: `photos: { key: string; blob?: Blob; photoId?: string; badge?: string; removable?: boolean }[]`,
  `onRemove?(key)`, `onAdd?()`, `max`, `busy?`, `alt`, `children` (Overlay-Slot über dem großen Bild).
- Großes Bild `aspect-[4/3]` (`MealPhoto` mit `blob`+`blobKey` oder `photoId`), gewählt per Tipp auf ein
  Thumbnail. State ist nur der gewählte `key`; das angezeigte Foto wird im Render abgeleitet
  (`photos.find(p => p.key === sel) ?? photos[0]`), kein `setState` in einem Effekt (React-Compiler-Regel).
  Thumbnail-Reihe (`size-14`, abgerundet, gewähltes mit Ring `ring-primary`), X oben rechts wie `Thumb` im
  Etikett-Sheet (sichtbar `size-7`, Trefffläche per unsichtbarem Padding auf mindestens 44 px, bewusst so,
  weil ein größeres X das Thumbnail verdeckt), „+“-Kachel (gestrichelter Rand, `Plus`-Icon, `aria-label`
  vom Aufrufer: „Fotos hinzufügen“ in Vorschau und Review, „Foto aufnehmen oder wählen“ im Gruppen-Editor,
  weil „hinzufügen“ laut CLAUDE.md Zutaten und Review vorbehalten ist) solange `photos.length < max` und
  `onAdd`. Mit einem Foto und ohne `onAdd` sieht es aus wie heute (nur das große Bild).
- Keine `URL.createObjectURL` außerhalb `useObjectUrl` (läuft über `MealPhoto`).

`apps/web/src/components/PhotoCaptureSheet.tsx` (neu, **Verallgemeinerung von `LabelCaptureSheet`**)

- `LabelCaptureSheet` wird so umgebaut, dass sein Kamerakern (FullscreenOverlay, `BarcodeScanner
frame="photo"`, Shutter, Mediathek `multiple`, Torch, Streifen mit X, Kamera-Fehler-Fallback, Maximum)
  die neue Komponente `PhotoCaptureSheet` ist. Props: `title`, `max`, `preset: ImagePreset` (Fotos werden
  beim Hinzufügen komprimiert), `onSubmit(blobs: Blob[])`, `onClose`, `footerLabel(n)`, `busy`,
  `closeLabel`, optional `onShot(blob, id)` und `onLiveCode(code)` (für die Barcode-Erkennung des Etiketts)
  und ein `overlay`-Slot (Barcode-Chip, Analyse-Overlay). `LabelCaptureSheet` wird ein dünner Wrapper, der
  Codes und den Etikett-Aufruf behält; sein Verhalten bleibt gleich (E2E `food-search.spec.ts:246` bleibt
  grün und ist die Absicherung). `CameraCapture` auf `/photo` bleibt unangetastet.
- Für Vorschau, Review und Gruppen-Editor: Titel „Fotos hinzufügen“ bzw. „Foto aufnehmen oder wählen“,
  keine Barcode-Reaktion, Footer „Übernehmen (N Fotos)“ (deaktiviert ohne Foto), Hinweiszeile „Weitere
  Teller, Gänge oder die Nährwerttabelle, bis zu N Fotos insgesamt“. Vor dem Öffnen rufen die Aufrufer
  `warmUpCamera()` (`components/cameraWarmup.ts`), damit iOS die Kamera schon startet.

### 9. Gruppen-Editor (`features/diary/DiaryGroupPage.tsx`)

- Fotos: `stored = photoIdsOf(first)`, leer → Meal-Foto als Fallback (wie heute
  `first.photoId || meal?.photoId`); dazu `draftPhotos` aus `groupDraftPhotos` (Live-Query im Formular).
  `PhotoStrip` mit gespeicherten Fotos (nicht entfernbar) und neuen (Badge „Neu“, Schlüssel
  `group:<id>:<at>`, X ruft `removeGroupDraftPhoto`), „+“ öffnet `PhotoCaptureSheet`
  (`max = MAX_ANALYSIS_PHOTOS - stored.length - draftPhotos.length`, Preset `analysis`); „Übernehmen“ →
  `addGroupDraftPhotos`. Ein Eintrag ohne Foto zeigt die Sektion mit nur der „+“-Kachel (so bekommt auch
  eine Gruppe ohne Foto eine Analyse).
- Prädikat `hasPhotos = stored.length > 0 || draftPhotos.length > 0`: ↻ im Header erscheint bei
  `hasPhotos` (heute `photoId &&`), die Hinweis-Vorbelegung (`analysisId`) hängt nur an `stored.length > 0`
  und `first.aiAnalysisId`.
- `dirty = isGroupDirty(…) || draftPhotos.length > 0`; damit greifen `useBlocker` und `DiscardDialog` auch
  für Fotos. „Änderungen übernehmen“ ist mit nur neuen Fotos aktiv.
- `reanalyze()`: lädt alle gespeicherten Fotos mit `loadPhoto` (fehlende überspringen; keins und keine
  neuen → Toast „Foto nicht mehr vorhanden“), hängt die neuen aus dem Draft an, `analyzePhotos(blobs,
hint)`; Rest wie heute (`groupDraftFromAnalysis`).
- Dialogtext: „Die KI sieht sich die Fotos noch einmal an.“ (Plural, wenn mehr als eins).

### 10. Doku

- `CLAUDE.md`: Absätze zu Meal-Fotos, KI-Warteschlange (Tabelle `aiPhotos`, `analyzedPhotoIds`,
  `leaveAnalysis`/Auto-Eintragen beim Verlassen, kein Auto-Öffnen), Review (Fotos sammeln, ↻), Gruppen-Editor
  (Fotos hinzufügen, `groupDraftPhotos`), `PhotoStrip`/`PhotoCaptureSheet`, `MAX_ANALYSIS_PHOTOS`.
- `docs/sync.md`: `foodEntries.photoIds` im Abschnitt „neue Felder“, Fotos-Abschnitt (mehrere Fotos je
  Gruppe, erstes bleibt `photoId`), Entwürfe (`groupDraftPhotos`).
- Diesen Plan nach `docs/plans/2026-10-fotoanalyse-mehrere-fotos.md` kopieren.

## Kritische Dateien

- `packages/shared/src/schemas.ts`, `packages/shared/src/diary.ts`
- `apps/api/src/ai/analyze.ts`, `apps/api/src/ai/prompt.ts`, `apps/api/src/routes/ai.ts`,
  `apps/api/src/db/schema.ts`, `apps/api/drizzle/0006_*.sql`
- `apps/web/src/db/dexie.ts`, `apps/web/src/db/entries.ts`, `apps/web/src/db/groupDraft.ts`
- `apps/web/src/features/ai/queue.ts`, `apps/web/src/features/ai/useAiImage.ts`,
  `apps/web/src/features/ai/PhotoPage.tsx`
- `apps/web/src/components/PhotoStrip.tsx` (neu), `apps/web/src/components/PhotoCaptureSheet.tsx` (neu,
  Kern aus `LabelCaptureSheet`), `apps/web/src/components/LabelCaptureSheet.tsx` (wird Wrapper)
- `apps/web/src/features/diary/DiaryGroupPage.tsx`, `features/diary/MealCard.tsx`,
  `features/diary/PendingAnalysisRow.tsx`, `features/meals/MealLogView.tsx`
- `apps/web/src/lib/api.ts` (nur falls `analyzePhotos` dorthin wandert; sonst bleibt es in `queue.ts`)

Wiederverwenden: `compressImage`/`IMAGE_PRESETS.analysis` (`features/ai/image.ts`), `storePhoto`/`loadPhoto`
(`db/photos.ts`), `MealPhoto`/`useObjectUrl`, `FullscreenOverlay`, `BarcodeScanner`/`TorchButton`/`CAM_ERRORS`,
`AnalyzingOverlay`, `warmUpCamera`, `draftFromResult`/`draftChanged`, `logDeferred`, `goBackOr`.

## Verifikation

Automatisch (je Block, siehe Ablauf): `pnpm lint`, `pnpm typecheck`, `pnpm test`.

Neue oder angepasste Tests:

- shared: `photoIds` Default und `photoIdsOf`.
- API `ai.test.ts`: 2 Bilder in einem Aufruf, `too_many_images`, Größe je Bild; `sync.test.ts`: `photoIds`.
- Web `meals-photos.test.ts`: bestehende Zusicherungen auf `aiImages` (Block „AI queue photos“, u. a. der
  Waisen-Test mit `count()`) wandern auf `aiPhotos`; `aiImages` ist nach der Migration leer. Neu:
  `enqueuePhotos` mit 2 Fotos (zwei `aiPhotos`-Zeilen), `addQueuePhotos` / `removeQueuePhoto`,
  `analyzedPhotoIds` nach `done`, Migration `aiImages` → `aiPhotos` (plus Legacy-Blob),
  `takeQueueItem`/`restoreQueueItem` mit mehreren Fotos, `leaveAnalysis` → `processQueue` trägt die Gruppe
  mit allen Fotos ein (und nur einmal, auch wenn `leaveAnalysis` während des `done`-Schreibens kommt),
  `reanalyze` schickt alle Fotos (Fetch-Stub zählt die `image`-Felder).
- Web `write.test.ts`: `logAiItems`/`logAiMeal` mit mehreren Fotos, `saveGroupDraft` mit neuen Fotos.
- E2E `meals-goals.spec.ts` (chromium-iphone, Mediathek-Input statt Kamera):
  1. Vorschau: Foto wählen, „+“ → Sheet → zweites Foto aus der Mediathek → „Übernehmen (1 Foto)“ →
     Footer „Analysieren (2 Fotos)“ → Request hat zwei `image`-Teile → Review zeigt zwei Thumbnails.
     Im Review „+“ → drittes Foto → Badge „Neu“ und Hinweis → ↻ schickt drei Bilder → „Meal eintragen“ →
     Gruppenzeile mit Zähler 3 → Gruppen-Editor zeigt drei Fotos, „+“ → viertes → ↻ schickt vier →
     „Änderungen übernehmen“ → alle Einträge der Gruppe haben vier `photoIds`, vier `photos` hochgeladen.
  2. Zurück während der Analyse: Analyse per `release`-Promise festhalten, Header-Pfeil → URL `/`, Zeile
     „Wird analysiert…“, Freigabe → Toast „analysiert und eingetragen“, Gruppenzeile da, URL bleibt `/`
     (kein `review=` in der URL). Dieselbe Prüfung mit `page.goBack()` statt Pfeil.
  3. Bestehende Specs anpassen: „Neu aufnehmen“ ist jetzt das X am einzigen Foto; Review-Foto ist der Streifen.
- Manuell auf dem iPhone (Nutzer): Kamera-Sheet aus Vorschau, Review und Gruppen-Editor; Wischen zurück
  während der Analyse; Offline-Foto weiter wie bisher.

## Ablauf für Opus 5.5

Lesereihenfolge: `CLAUDE.md`, `.claude/skills/offline-sync/SKILL.md`, `docs/sync.md`, dieser Plan,
dann `queue.ts`, `PhotoPage.tsx`, `LabelCaptureSheet.tsx`, `DiaryGroupPage.tsx`, `groupDraft.ts`,
`entries.ts`, `routes/ai.ts`, `ai/analyze.ts`, `ai/prompt.ts`. Vor Block 2 die Skill `claude-api` laden.

Ein Commit je Block, vor jedem Commit `pnpm lint`, `pnpm typecheck`, `pnpm test` (E2E am Ende von Block 8).
Abweichungen vom Plan melden statt still entscheiden.

0. Plan nach `docs/plans/2026-10-fotoanalyse-mehrere-fotos.md` kopieren (im ersten Commit).
1. Shared (Abschnitt 1) + API-Schema/Migration + Sync-Test (Abschnitt 3).
2. API Analyse mit mehreren Bildern + Prompt + Tests (Abschnitt 2).
3. Dexie v5, Queue (`aiPhotos`, `enqueuePhotos`, `analyzePhotos`, `analyzedPhotoIds`, `leaveAnalysis`,
   Migration), `useAiImages`, Aufrufer kompilierfähig (noch ein Foto in der UI) + Tests (Abschnitt 4).
4. Eintragen mit allen Fotos (`entries.ts`, `groupDraft.ts` Basis, `GroupRow`-Badge) + Tests (Abschnitt 5).
5. `PhotoCaptureSheet` aus `LabelCaptureSheet` herauslösen (Etikett-E2E bleibt grün), `PhotoStrip` (Abschnitt 8).
6. Foto-Seite: Vorschau mit mehreren Fotos, Verlassen während der Analyse, kein Auto-Öffnen (Abschnitt 6).
7. Review mit Fotostreifen, „Neu“, ↻ (Abschnitt 7); `PendingAnalysisRow`/`QueueRow`.
8. Gruppen-Editor mit Fotos und „+“ (Abschnitt 9), E2E-Specs, Doku (Abschnitt 10).

## Umsetzung (2026-10-17)

Umgesetzt in den Commits e54edc0 bis zum Doku-Commit, Blöcke wie oben. Abweichungen vom Plan:

- `logAiMeal` hängt die Analyse-Fotos an (`photoIds`, das erste ist `photoId`) und nimmt das Meal-Foto nur, wenn
  es keine gibt. Das Meal-Foto vorne anzustellen hätte dasselbe Bild doppelt im Streifen gezeigt (das Meal-Foto
  ist eine Kopie des ersten Analyse-Fotos).
- Gruppen-Editor ohne Foto: ein breiter Button „Foto aufnehmen oder wählen“ statt einer einzelnen „+“-Kachel
  (eine Kachel ohne Bild daneben war nicht als Aktion zu erkennen).
- Zusätzlich: eine erste Analyse, die durch Schließen der App abgebrochen wurde (Status „analyzing“ beim
  nächsten Start), wird ebenfalls `deferred` und selbst eingetragen, wie beim Verlassen.
- Die Vorschau komprimiert in der Seite (`addShots`), das Sheet dort ohne `preset`; Review und Gruppen-Editor
  geben `IMAGE_PRESETS.analysis` ans Sheet.
- E2E: `webkit-iphone` lief nicht, weil WebKit im Container nicht installiert ist (auch vor den Änderungen
  rot); `chromium-iphone` komplett grün, neu: Verlassen während der Analyse (Pfeil und Browser-Zurück) und der
  ganze Ablauf mit mehreren Fotos (Vorschau, Review, Gruppen-Editor, Upload).
