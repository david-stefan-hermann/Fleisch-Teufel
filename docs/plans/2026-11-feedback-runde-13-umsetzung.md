# Feedback-Runde 13: Implementierungsplan

Implementierungsplan für eine neue Opus-5.5-Sitzung. Den Statusblock in dieser Datei pflegen.
Planungsgrundlage (Wünsche, Entscheidungen, Fundstellen): `docs/plans/2026-11-feedback-runde-13.md`. Dieser Plan
legt fest, wie beide Punkte gebaut werden.

## Status

Geplant am 2026-11-21, umgesetzt am 2026-11-21 von Opus 5.5 auf `10c8066` (nicht gepusht). Push-Stand nie aus
diesem Dokument ableiten: `git fetch` + `git status -sb`.

| Block | Commit        | Inhalt                                                             |
| ----- | ------------- | ------------------------------------------------------------------ |
| 1     | `6bdc956`     | Assistent: alte Äußerungen nicht mehr im Kontext, Hinweis nur neu  |
| 2     | `bc8cc20`     | `moveEntriesToNewDiaryMeal` (Schreibfunktion, Unit-Tests)          |
| 3     | `fa3c1aa`     | Ablageziel „Neue Mahlzeit“ im Tagebuch, Toast, Ansagen, E2E        |
| 4     | dieser Commit | Doku: `CLAUDE.md`, dieser Statusblock, beide Plandateien committen |

### Abweichungen vom Plan

- Keine in der Sache. Die Schleife von `moveEntriesToDiaryMeal` steckt jetzt in `moveInto` (beide Verschiebe-Wege).
- `components.test.tsx` übergibt `DiaryDnd` das neue Prop `date`.
- Block 3, Punkt 4 (Messen nach dem Wachsen): geprüft mit einem eigenen Playwright-Skript. Das Ziel wird auf seiner
  ganzen Höhe von 64 px getroffen (dnd-kit misst nach der Größenänderung selbst neu, `MeasuringStrategy` bleibt
  unverändert), auch wenn es beim Start des Zuges unter dem Bildschirmrand lag und erst das automatische Scrollen
  es zeigt. Der Rückfall `h-11` war nicht nötig.

### Prüfung

- `pnpm lint`, `pnpm typecheck`, `pnpm test` grün nach jedem Block (Web 519, API 270 Tests); `pnpm e2e` ganz: 79 von 80 grün, der eine Fehler lag im neuen Gruppen-Test (zwei Toasts, „50 kcal“ in „150 kcal“), behoben; danach `day-meals`, `meals-unified` und `assistant*` grün (28).
- Sichtprüfung (Produktions-Build über die API, 390 × 844 und 360 × 760, hell und dunkel): Ziel im Zug, Ziel mit
  `isOver`, Ergebnis mit Toast. Die neue Mahlzeit sortiert nach der Zeit des Eintrags ein (im Beispiel „Abendessen“
  um 12:00 zwischen Frühstück und Mittagessen), wie entschieden.
- Offen, nur auf dem Gerät: die Liste unter „Verifikation“.

## Context

Zwei Punkte vom 2026-11-21. Kein Mockup: Punkt 1 hat ein einziges neues Element, das nur während eines Zuges
sichtbar ist und die vorhandenen Stile benutzt; Punkt 2 ist ein Fehler ohne sichtbare Änderung. Weder Schema
noch Migration noch Dexie-Version ändern sich; Punkt 1 schreibt nur vorhandene synchronisierte Tabellen
(`diaryMeals`, `foodEntries`) über die vorhandenen Schreibwege.

### Entschieden (mit dem Nutzer, aus der Planungsgrundlage)

- Punkt 1: Während eines Zuges erscheint unter der letzten Mahlzeit ein Ablageziel. Ablegen legt eine neue
  Mahlzeit an und verschiebt den Eintrag (oder die Gruppe) hinein, mit Rückgängig-Toast. Name: `nextMealName`,
  wobei die Ausgangsmahlzeit als vorhanden zählt, auch wenn sie durch den Zug leer wird. Uhrzeit: `loggedAt` des
  gezogenen Eintrags. Die neue Mahlzeit sortiert nach Uhrzeit ein, also oft nicht unten: gewollt. Die
  Ausgangsmahlzeit mit nur diesem Eintrag bleibt während des Zuges sichtbar und verschwindet nach dem Ablegen;
  das Ergebnis (gleiche Uhrzeit, nächster Name) wird nicht verhindert. „Mahlzeit hinzufügen“ öffnet weiter die
  Fotoseite; es gibt keine leeren Mahlzeiten.
- Punkt 2: Äußerungen von vor Tagen dürfen den Assistenten nicht mehr beeinflussen; der Hinweis für die
  Fotoseite stammt nur aus der aktuellen Äußerung.

### Annahmen (im Plan festgelegt, bei Widerspruch melden statt still zu entscheiden)

- **A1 (Uhrzeit bei einer Gruppe):** der jüngste `loggedAt` der gezogenen Einträge (Vorschlag der Grundlage).
  Passt dieser Zeitpunkt nicht zum Tag (Eintrag nachträglich für einen anderen Tag angelegt, „Wie gestern“), gilt
  wie bei jeder neuen Mahlzeit die typische Uhrzeit des Namens: `newMealEatenAt(date, name, standard, loggedAt)`.
- **A2 (Ort und Größe des Ziels):** Das Ziel sitzt genau an der Stelle von „Mahlzeit hinzufügen“ und ersetzt
  dessen Inhalt, solange ein Zug läuft. Ruhe: der Link wie heute (`h-11`). Im Zug: `h-16`, damit der Finger es
  trifft; nur was darunter liegt (Trainingskarte) rückt 20 px nach unten, keine Mahlzeit bewegt sich.
- **A3 (Text des Ziels):** Plus-Icon, „Neue Mahlzeit“ und dahinter der Name, den sie bekäme (`next.name`,
  zurückhaltend gesetzt), wie der Eintrag „Neue Mahlzeit“ im `HeaderMealPicker` (`lib/meals.ts:102`). Kein
  Erklärsatz.
- **A4 (Toast):** `<Zeile> in neue Mahlzeit „<Name>“ verschoben`, Aktion „Rückgängig“.
- **A5 (Zeitfenster des Assistenten):** „Recent utterances“ und `previousTarget` nur aus Äußerungen, die höchstens
  3 Stunden vor der neuen liegen (gemessen an `turn.createdAt`, nicht an der Sendezeit: eine offline wartende
  Äußerung behält ihren Zusammenhang). Eine Konstante. Die Prompt-Regel „also when that was yesterday“ bleibt:
  sie meint den Tag, in den die vorige Äußerung geschrieben hat, nicht ihr Alter.
- **A6 (offene Frage):** `openQuestion` bleibt, wie es ist. Sie hängt an `answersTo`, also an einer Antwort, die
  der Nutzer ausdrücklich auf diese Frage gibt; ihr Alter spielt keine Rolle.
- **A7 (kein Scrollen):** Landet die neue Mahlzeit weiter oben, scrollt das Tagebuch nicht dorthin; der Toast
  nennt sie. (Normales Verschieben scrollt auch nicht.)

### Im Code geprüft (2026-11-21, Stand `10c8066`)

- `features/diary/DiaryDnd.tsx` (182 Zeilen): `DiaryDnd({ meals, children })`, `collisionDetection=pointerWithin`,
  `onDragEnd` findet das Ziel über `over.data.current.meal` in `meals`, sonst Abbruch; Sperre `moving`;
  `announcements` deutsch; `useMealDropZone(meal)` = `useDroppable({ id: 'meal-<id>', data: { meal } })`.
  Während eines Zuges wird nichts geschrieben, die gezogene Zeile bleibt mit `opacity-40` an ihrem Platz: die
  Ausgangsmahlzeit kann also nicht verschwinden (in E2E trotzdem festhalten).
- `features/diary/DiaryPage.tsx:147-166`: `<DiaryDnd meals={meals}>` umschließt nur die `MealCard`s;
  `AddMealLink` (nur hier benutzt, `MealCard.tsx:263`) steht **außerhalb**, bei `meals.length > 0`.
- `features/diary/MealCard.tsx:78-90`: Ziel-Aussehen einer Karte bei `isOver`: `bg-primary/5 ring-2 ring-primary/60`.
- `db/diaryMeals.ts`: `prepareMealTarget(db, { date, meal, dm: 'new' })` (vor der Transaktion, liest über
  `readPlannedDay` auch die Warteschlange: Namen, die eine Analyse belegt, zählen) liefert `LogTarget` mit
  `diaryMealId` (uuidv7), `meal` (`slotForNewMeal`), `create: { name, eatenAt }` und `keep` (die Mahlzeit
  `dm:<date>:<slot>` desselben Index). `applyLogTarget` schreibt in der Transaktion `keep` und den Datensatz.
  `moveEntriesToDiaryMeal` (Zeile 393): Transaktion über `foodEntries`, `diaryMeals`, `settings`, `outbox`;
  `buildDay(db, date, [])`, je Eintrag `keepMeal(source)`, `keepMeal(target)`, Rückgabe `EntryMealPlace` mit
  `diaryMealId: source?.id ?? prev.diaryMealId`, dann `patchRecord({ meal, diaryMealId })`.
  `restoreEntryMeals` setzt nur die Einträge zurück.
- `packages/shared/src/dayMeals.ts`: `buildDayMeals` zeigt eine Mahlzeit nur mit Einträgen oder wartender
  Analyse; ein leerer Datensatz zählt weder für `nextMealName` noch für `slotForNewMeal`. Ein neuer Datensatz mit
  uuid beendet die Fach-Reihenfolge eines alten Tages (`usesSlotOrder`): gewollt („a new meal joins it“).
- Tests: `apps/web/test/day-meals-write.test.ts` (Abschnitt „changing meals“ mit den Verschiebe-Fällen),
  `apps/web/e2e/day-meals.spec.ts` (`dragTo`, Zeile 140; „a meal dragged empty disappears“, Zeile 228; Helfer
  `startAtNoon`, `logQuick`, `row`, `mealCard`, `timeOf`, `undo`).
- `features/assistant/queue.ts:104-135` (`contextFor`): `before` = alle `done`/`asking`-Äußerungen vor der neuen,
  ohne Altersgrenze; `recent: before.slice(-3)` mit `at: localStamp(...).slice(11)` (nur Uhrzeit);
  `previousTarget` aus `before.at(-1)`.
- `packages/shared/src/assistant.ts:196`: `recentUtteranceSchema.at` ist `z.string().max(5)`. Ein Datum in `at`
  würde ein älterer Server mit 400 ablehnen (Rollback auf ein altes Image bei schon aktualisierter App). Deshalb
  ein **neues optionales Feld**, `at` bleibt die Uhrzeit; ein älterer Server streift das Feld ab.
- `apps/api/src/assistant/prompt.ts:194`: die Zeile `- ${r.at} said: …`; Zeile 42: „call `open_camera` with what
  they said as the hint“. `tools.ts:154`: `open_camera`, `hint` Pflichtfeld (`str`); `host.ts:554`:
  `optText(input.hint, 1000) ?? ''`.
- Tests: `apps/web/test/assistant-queue.test.ts:169` (previousTarget), `apps/api/test/assistant.test.ts`
  (Kontext-Fixture Zeile 62 mit `recent: []`).

## Umsetzung

Zeilennummern sind der Stand von `10c8066` und dienen nur zum Finden. Der Fehler (Block 1) beginnt mit dem roten
Test.

### Block 1: Assistent, alte Äußerungen (`packages/shared/src/assistant.ts`, `features/assistant/queue.ts`, `apps/api/src/assistant/prompt.ts`, `tools.ts`)

1. **Rote Tests.**
   - `apps/web/test/assistant-queue.test.ts`: (a) Eine erledigte Äußerung mit `createdAt` eine Woche vor der neuen
     (direkt in `assistantTurns` anlegen, mit `applied`, das ein Ziel hat) steht nicht in `contextFor(...).recent`,
     und `previousTarget` ist `null`. (b) Eine von vor zehn Minuten steht drin, mit `date` (ISO-Tag) und `at`
     (Uhrzeit). (c) Die Grenze zählt ab `turn.createdAt`: eine neue Äußerung, die selbst zwei Tage alt ist (offline
     gewartet), sieht die zehn Minuten vor ihr liegende.
   - `apps/api/test/assistant.test.ts`: `utterancePrompt` schreibt bei einer Äußerung mit `date` Datum und Uhrzeit
     in die Zeile (`- 2026-11-20 18:05 said: …`), ohne `date` (ältere App) wie bisher nur die Uhrzeit.
2. Shared: `recentUtteranceSchema` bekommt `date: isoDateSchema.optional()` (Kommentar: neuere Apps senden es; der
   Server zeigt es dem Modell). `at` bleibt unverändert.
3. `queue.ts`: Konstante `RECENT_UTTERANCE_MS = 3 * 60 * 60_000` (exportiert, Kommentar: was älter ist, gehört
   nicht mehr zum Gespräch). `before` nach dem Statusfilter zusätzlich auf
   `t.createdAt >= turn.createdAt - RECENT_UTTERANCE_MS` begrenzen (dann gelten `recent` und `prev` beide nur im
   Fenster; die Dexie-Abfrage darf mit `between` gleich nur das Fenster lesen). `recent` sendet
   `date: localStamp(t.createdAt).slice(0, 10)` neben `at`. Den Kommentar über `contextFor` anpassen.
   `openQuestion` nicht anfassen (A6).
4. `prompt.ts`, `utterancePrompt`: Zeile `- ${r.date ? `${r.date} ` : ''}${r.at} said: …`.
5. `prompt.ts`, `ASSISTANT_SYSTEM`, Absatz zu den Fotos (Zeile 42): Der `hint` ist das, was die Person **in dieser
   Äußerung** über das Essen sagt; sagt sie nichts darüber („Ich habe Fotos“), ist er leer. Nie Text aus früheren
   Äußerungen oder aus dem Tagebuch übernehmen. Englisch, im Ton der umgebenden Regeln, ein bis zwei Sätze.
   `tools.ts`, Beschreibung von `open_camera`: „The hint is what the person said about the food in this utterance,
   empty when they said nothing about it.“ `hint` bleibt Pflichtfeld (leerer Text ist erlaubt; prüfen, dass
   `optText` einen leeren Text nicht als Fehler meldet, sonst dort abfangen und testen).
6. Vor Änderungen an `apps/api/src/assistant/*` den Skill `claude-api` laden (Regel aus `CLAUDE.md`). Am Modell,
   an der Schleife und am Caching ändert sich nichts; der Systemprompt wird einmal neu gecacht.

Nicht Teil des Blocks: eine Prüfung auf dem Server, ob der Hinweis im Transkript vorkommt; Änderungen an
`hint.ts` (die zehn Minuten dort sind in Ordnung).

### Block 2: Schreibfunktion (`apps/web/src/db/diaryMeals.ts`, `apps/web/test/day-meals-write.test.ts`)

Vorher lesen: Skill `offline-sync`, `docs/sync.md`.

`moveEntriesToNewDiaryMeal(db, date, ids): Promise<{ name: string; moved: EntryMealPlace[] } | null>` neben
`moveEntriesToDiaryMeal`:

1. **Vor** der Transaktion: `target = await prepareMealTarget(db, { date, meal: 0, dm: 'new' })`. Das gibt id,
   Namen (nächster Name, die Ausgangsmahlzeit zählt mit, weil sie noch Einträge hat), Index und `keep`, genau wie
   jede andere neue Mahlzeit. Nicht `prepareFlowTarget` (das ist kein Eintrage-Ablauf, `ft.logStart` bleibt
   unberührt).
2. Eine Transaktion über `foodEntries`, `diaryMeals`, `settings`, `outbox` (wie `moveEntriesToDiaryMeal`):
   - `day = await buildDay(db, date, [])` zuerst lesen (die Quellen, wie der Tag sie vor dem Schreiben zeigt).
   - Die Einträge zu `ids` laden; es zählen nur lebende des Tages (`!deleted`, `date === date`). Keiner: `null`
     zurück, nichts schreiben (kein leerer Datensatz).
   - Uhrzeit (A1): `newMealEatenAt(date, name, standard, Math.max(...loggedAt))` mit `standard` aus `mealNames(db)`.
   - `await applyLogTarget(db, { ...target, create: { name, eatenAt } })`: schreibt `keep` (die Mahlzeit
     `dm:<date>:<slot>` desselben Index bekommt ihren Datensatz, ihre Einträge ihre id) und die neue Mahlzeit
     (`timeEdited: false`).
   - Je Eintrag wie in `moveEntriesToDiaryMeal`: Quelle in `day` suchen, `keepMeal(db, source, day)` (Name und Zeit
     einer virtuellen Quelle bleiben), Platz für „Rückgängig“ merken (`diaryMealId: source?.id ?? prev.diaryMealId
?? null`), dann `patchRecord(db, 'foodEntries', id, { meal: target.meal, diaryMealId: target.diaryMealId })`.
     `foodEntries.meal` wird also weiter für ältere App-Versionen geschrieben.
   - Die gemeinsame Schleife aus `moveEntriesToDiaryMeal` in eine interne Funktion ziehen statt sie zu kopieren.
3. Rückgängig ist das vorhandene `restoreEntryMeals(db, moved)`. Der Datensatz der neuen Mahlzeit bleibt (wie bei
   jeder leer gewordenen Mahlzeit); sie ist ohne Einträge unsichtbar und belegt weder Namen noch Index.

Unit-Tests (Abschnitt „changing meals“, Aufbau wie die vorhandenen Verschiebe-Fälle):

- Zwei Einträge im Frühstück, einer wird gezogen: neue Mahlzeit heißt „Mittagessen“, `eatenAt` = `loggedAt` des
  Eintrags, `slot` wie `slotForNewMeal`, der Eintrag trägt `meal` = dieser Index und die neue id; das Frühstück
  (vorher ohne Datensatz) behält Namen und Zeit und seinen anderen Eintrag.
- Einziger Eintrag der Quelle: der Tag zeigt danach nur die neue Mahlzeit, sie heißt nach dem **nächsten** Namen
  (nicht wieder wie die Quelle) und hat die Zeit des Eintrags.
- Gruppe (zwei ids mit verschiedenem `loggedAt`): die Zeit ist die des jüngeren; beide Einträge sind drin.
- `loggedAt` passt nicht zum Tag (Eintrag für gestern, heute angelegt): typische Uhrzeit des Namens.
- Die neue Mahlzeit teilt den Index mit einer Mahlzeit ohne Datensatz (alle vier Standardnamen vergeben oder der
  Fall aus dem Test „a new meal sharing the index …“): deren übrige Einträge bleiben bei ihr.
- Rückgängig: die Einträge stehen wieder in ihrer Mahlzeit (über die id), `readDay` zeigt die neue nicht mehr,
  und `readNextMeal` nennt wieder denselben nächsten Namen.
- Nur gelöschte oder fehlende ids: `null`, kein `diaryMeals`-Datensatz, nichts in der Outbox.
- Scheitert die Transaktion (Muster „writes neither the meal nor the entry when the transaction fails“), steht
  weder die Mahlzeit noch die Änderung am Eintrag in der Datenbank.

### Block 3: Ablageziel im Tagebuch (`features/diary/DiaryDnd.tsx`, `MealCard.tsx`, `DiaryPage.tsx`, `apps/web/e2e/day-meals.spec.ts`)

1. `DiaryDnd.tsx`:
   - Prop `date: ISODate` dazu. `useNewMealDropZone()`: `useDroppable({ id: 'meal-new', data: { newMeal: true } })`,
     gibt `{ setDropRef, isOver, dragging }` zurück (`dragging` aus `useDiaryDrag`).
   - `onDragEnd`: zuerst prüfen, ob `over.data.current.newMeal` gesetzt ist. Dann (unter derselben Sperre
     `moving`) `moveEntriesToNewDiaryMeal(db, date, row.ids)`; bei `null` nichts; sonst Toast nach A4 mit
     „Rückgängig“ → `restoreEntryMeals(db, moved)`. Fehler wie bisher `toast.error(errorMessage(err))`. Der
     vorhandene Zweig für Mahlzeiten bleibt unverändert.
   - `announcements`: über dem neuen Ziel `<Zeile> ist über „Neue Mahlzeit“.`, am Ende
     `<Zeile> in eine neue Mahlzeit verschoben.` (der Name steht dort noch nicht fest).
   - Dateikommentar oben ergänzen (ein Satz: das Ziel unter der letzten Mahlzeit beginnt eine neue).
2. `MealCard.tsx`, `AddMealLink`: ein äußeres `div` mit `ref={setDropRef}`, `mb-4` und `data-new-meal-drop`, das
   **immer** gerendert ist (so ist das Ziel schon beim Start des Zuges angemeldet). Darin in Ruhe der Link wie
   heute (ohne sein `mb-4`), während `dragging` stattdessen die Zielfläche nach A2/A3: kein Link, `h-16`, gleicher
   gestrichelter Rahmen und Rundung, bei `isOver` `bg-primary/5 ring-2 ring-primary/60` wie die Karten. Kein
   `transition-all`. Die Zielfläche ist kein bedienbares Element (kein `role`, kein Fokus); Tastatur-Nutzer ändern
   die Mahlzeit weiter auf der Eintragsseite.
3. `DiaryPage.tsx`: `AddMealLink` in `<DiaryDnd date={date} meals={meals}>` hineinziehen (nach den Karten, nur bei
   `meals.length > 0`); `EmptyMealCard` bleibt außerhalb. Kommentar an der Stelle anpassen.
4. Prüfen (dnd-kit misst Ablageziele beim Start des Zuges und nach Größenänderungen neu): Das auf `h-16`
   gewachsene Ziel wird getroffen, auch wenn es beim Start außerhalb des Bildschirms lag und erst durch das
   automatische Scrollen erscheint. Klappt das nicht verlässlich, das Ziel in Ruhe und im Zug gleich hoch lassen
   (`h-11`) und es im Statusblock melden.

E2E in `day-meals.spec.ts` (Helfer `dragToNewMeal(page, text)` neben `dragTo`: langer Druck, zum Element
`[data-new-meal-drop]` ziehen, dort `ring-2` erwarten, loslassen):

- Zwei Einträge im Frühstück (12:00 angelegt, Uhr vor dem Zug auf 13:00 stellen): während des Zuges steht
  „Neue Mahlzeit“ an der Stelle von „Mahlzeit hinzufügen“ und der Link ist weg; nach dem Ablegen Toast
  „Apfel in neue Mahlzeit „Mittagessen“ verschoben“ (`exact`, wegen der Ansage), „Mittagessen“ zeigt den Apfel
  mit der Uhrzeit **12:00** (die des Eintrags, nicht 13:00), das Frühstück behält den anderen Eintrag;
  „Rückgängig“ stellt alles her, „Mittagessen“ ist weg, „Mahlzeit hinzufügen“ ist wieder ein Link.
- Einziger Eintrag der Quelle: mitten im Zug ist die Überschrift „Frühstück“ noch sichtbar; nach dem Ablegen ist
  sie weg und „Mittagessen“ steht da; „Rückgängig“ bringt „Frühstück“ mit seiner Uhrzeit zurück.
- Eine Gruppe (ein eingetragenes Meal oder zwei Einträge einer KI-Gruppe, je nachdem, was die Spec schon
  herstellen kann) wandert als Ganzes.

Sichtprüfung (Produktions-Build über die API, eigenes Playwright-Skript nach dem Merkzettel „Dev-Proxy-Login“,
390 × 844 und 360 × 760, hell und dunkel): Screenshot mitten im Zug (Ziel ohne und mit `isOver`), nach dem
Ablegen mit Toast. Dem Nutzer am Ende zeigen (A2 bis A4 abnehmen).

### Block 4: Doku

- `CLAUDE.md`: im Punkt „Diary drag and drop“ das Ziel unter der letzten Mahlzeit (`moveEntriesToNewDiaryMeal`,
  Name `nextMealName`, Zeit der jüngste `loggedAt`, Rückgängig über `restoreEntryMeals`, `AddMealLink` ist im Zug
  das Ziel); im Punkt „Diary meals“ bei „Records are written only when …“ den neuen Anlass; im Punkt „Assistant“
  das Zeitfenster (`RECENT_UTTERANCE_MS`, `recent` mit `date`) und dass der Hinweis von `open_camera` nur aus der
  aktuellen Äußerung stammt. Keine Gedankenstriche.
- Statusblock dieser Datei füllen (Commits, Abweichungen, Prüfung). Beide Plandateien der Runde committen
  (`2026-11-feedback-runde-13.md` ist noch nicht im Repo).

## Verifikation

- Je Block: `pnpm lint`, `pnpm typecheck` (nacheinander, nie parallel), `pnpm test`. Nach Block 3 `pnpm e2e`
  (mindestens `day-meals.spec.ts`, `meals-unified.spec.ts`, `assistant*.spec.ts`), am Ende einmal alles.
- Nur auf dem Gerät prüfbar (Liste für den Nutzer, nach dem Ausrollen):
  - iPhone: Eintrag lange drücken, nach unten ziehen (auch über den Bildschirmrand hinaus scrollen lassen), auf
    „Neue Mahlzeit“ ablegen; die Mahlzeit erscheint mit der Uhrzeit des Eintrags; „Rückgängig“.
  - Assistent: einige Stunden nach der letzten Äußerung „Ich habe Fotos“ sagen; das Hinweisfeld der Fotoseite ist
    leer. Mit Beschreibung („Ich habe Fotos von der Lasagne bei Oma“) steht sie drin.
  - Optional zur Bestätigung der Ursache: Mehr → Assistent, die damalige Äußerung ansehen (stand der alte Text als
    Hinweis an „Kamera öffnen“?).

## Ablauf für Opus 5.5

1. Lesen: diesen Plan, die Planungsgrundlage, `CLAUDE.md` (Punkte „Diary meals“, „Diary drag and drop“,
   „Assistant“, „No explanation texts“), Skill `offline-sync` und `docs/sync.md` vor Block 2, Skill `claude-api`
   vor Block 1. `git fetch` + `git status -sb`; ist `main` nicht mehr `10c8066`, die Fundstellen neu suchen.
2. Reihenfolge wie die Blöcke (1 bis 4), je Block ein Commit, englischer Commit-Text, Attribution nach dem
   Hinweis der Sitzung. Vor jedem Commit lint, typecheck, test; e2e wie oben.
3. Keine Gedankenstriche in Texten, Kommentaren, Commits. Keine Erklärtexte im UI. UI-Texte deutsch, Code und
   Kommentare englisch, im Stil der umgebenden Dateien.
4. Annahmen nicht still ändern: Passt eine nicht zum Code oder zum Test, im Statusblock notieren und dem Nutzer
   sagen. Das gilt besonders für A2 (Höhe des Ziels, Rückfall `h-11`) und A5 (Zeitfenster).
5. Nicht bauen: leere Mahlzeiten, ein Ziehen der Mahlzeiten selbst, eine Änderung an „Mahlzeit hinzufügen“ in
   Ruhe, ein Löschen des Datensatzes beim Rückgängig, ein Verschieben in eine neue Mahlzeit über den Assistenten,
   Schema- oder Dexie-Änderungen, Änderungen an `openQuestion` oder an `hint.ts`.
6. Nach dem letzten Block: Statusblock füllen, Screenshots und Geräteliste nennen, die Annahmen A1 bis A7 zur
   Abnahme aufzählen. Nicht pushen, bis der Nutzer es sagt; das Ausrollen (Push, grüner Actions-Lauf, Deploy in
   Dockge) macht der Nutzer oder gibt es frei.
