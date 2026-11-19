# Tagesmahlzeiten: Mahlzeiten statt vier fester Fächer

Implementierungsplan für die umsetzende Sitzung. Das Mockup ist abgenommen
(`docs/plans/2026-11-tagesmahlzeiten-mockup.html`, v4). Der Nutzer hat die Umsetzung am 2026-11-19 freigegeben.

## Status

Geplant am 2026-11-19 auf Stand `feda5d7`. Die umsetzende Sitzung pflegt diese Tabelle.

| Block | Commit  | Inhalt                                                  | Stand  |
| ----- | ------- | ------------------------------------------------------- | ------ |
| 1     | 16d149e | Datenmodell, Migration `0020`, Dexie v7, Sync           | fertig |
| 2     | 573e8b6 | Reine Tageslogik `packages/shared/src/dayMeals.ts`      | fertig |
| 3     | dieser  | Schreibschicht auf dem Gerät                            | fertig |
| 4     |         | Ziel wählen: 30 Minuten, URL, Kopfzeile, Formulare      | offen  |
| 5     |         | KI-Warteschlange, verzögerte Analysen, Entwürfe         | offen  |
| 6     |         | Tagebuch: Karten, leerer Tag, Hinzufügen, Löschen       | offen  |
| 7     |         | Name: Auswahl, eigene Namen, Einstellungen, Laufschrift | offen  |
| 8     |         | Uhrzeit-Dialog und Nacht                                | offen  |
| 9     |         | „Zuletzt hier“, „Wie gestern“, Einfügen                 | offen  |
| 10    |         | Assistent                                               | offen  |
| 11    |         | Berichte, CSV, Tagesbild, Tag abschließen               | offen  |
| 12    |         | Demo-Daten, Aufräumen, E2E-Gesamtlauf                   | offen  |
| 13    |         | Doku                                                    | offen  |

**Abweichungen während der Umsetzung**: hier eintragen, nicht still entscheiden.

**Vorbedingung vor Block 1**: erfüllt, der Android-Schrittimport ist mit `e9f1f06` auf `main`.

## Ziel

Ein Tag hat so viele Mahlzeiten, wie gegessen wurde. Jede Mahlzeit hat einen Namen und eine Uhrzeit, die Liste folgt
der Uhrzeit. Bestehende Daten bleiben unangetastet, ältere App-Versionen arbeiten weiter, und zwei Geräte, die offline
waren, kommen ohne Rückfrage auf denselben Stand.

Nicht dabei: Funktionen, die später auf der echten Uhrzeit einer Mahlzeit (`eatenAt`) aufbauen.

## Entscheidungen des Nutzers (verbindlich)

1. Keine festen Fächer. Mahlzeiten eines Tages entstehen von selbst. Der automatische Name ist der erste aus
   Frühstück, Mittagessen, Abendessen, Snacks, den der Tag noch nicht hat, danach „Weitere Mahlzeit“.
2. Eine neue Mahlzeit beginnt, wenn der letzte Eintrag mehr als 30 Minuten zurückliegt. Das „+“ einer bestehenden
   Mahlzeit gewinnt immer.
3. Tipp auf den Namen: Auswahl mit den 4 Namen und „Eigener Name“. Eigene Namen bleiben in der Auswahl und lassen sich
   in den Einstellungen löschen. Eingetragene Mahlzeiten behalten ihren Namen.
4. Jede Mahlzeit hat eine Uhrzeit von ihrem ersten Eintrag. Sie ist änderbar und ändert sich **nie** von selbst.
5. Mahlzeiten stehen nach Uhrzeit sortiert und lassen sich nicht ziehen. Namen ändern sich nie von selbst. **Ausnahme alte
   Tage**: Ein Tag von vor dem Umbau behält die bisherige Reihenfolge der vier Fächer, bis dort eine Uhrzeit geändert wird
   oder eine neue Mahlzeit dazukommt (Regel „Reihenfolge eines Tages“).
6. Auf einen anderen Tag nur über das bestehende Kopieren und Einfügen.
7. Leerer Tag: eine leere Karte für die nächste Mahlzeit mit „+“ und Vorschlägen. Keine leeren Datensätze: Eine
   Mahlzeit gibt es ab ihrem ersten Eintrag.
8. Eine Mahlzeit löschen löscht ihre Einträge, mit Rückgängig. Eine leer gezogene Mahlzeit verschwindet von selbst.
9. Einzelne Einträge lassen sich weiter zwischen Mahlzeiten ziehen. Mahlzeiten lassen sich von Hand anlegen
   („Mahlzeit hinzufügen“).
10. Die Uhrzeit steht klein und grau **außerhalb** der Karte, direkt darüber. Der Kopf in der Karte bleibt genau wie
    heute (Name, kcal, Pfeil, Einfügen, ⋯, +). Tipp auf die Uhrzeit öffnet den Zeit-Dialog, Tipp auf den Namen die
    Auswahl, Tipp auf kcal oder Pfeil öffnet `/diary-meal`.
11. Zu lange Namen laufen als Laufschrift durch: nur wenn sie überlaufen, nach einer Pause, endlos und nahtlos, mit
    weichen Rändern, aus bei `prefers-reduced-motion`. Gemessen mit `ResizeObserver`, passend zu den React-Compiler-Regeln.
12. Nach Mitternacht: Der Zeit-Dialog bietet für 00:00 bis 04:59 „Nacht auf <Tag>“ an. Die Mahlzeit bleibt am Vortag und
    trägt einen Mond.
13. Die Vorschläge des Mockups gelten: „Wie gestern“ nimmt den gleichen Namen, sonst die nächstliegende Uhrzeit. Eine
    Mahlzeit für einen vergangenen Tag bekommt die typische Uhrzeit ihrer Position und bleibt änderbar. Die
    Standard-Namen bleiben umbenennbar und gelten nur für neue Mahlzeiten. Ein Tag ist ab 2 Mahlzeiten vollständig. Die
    CSV bekommt am Ende die Spalte „Uhrzeit“.

Das Mockup gilt für alles, was hier nicht steht. **Entscheidung 10 geht vor**: Der Einleitungssatz zu Abschnitt A im
Mockup („Name mit Auswahl, darunter Uhrzeit und kcal“) ist überholt, die gezeichneten Karten zeigen schon den Stand v4.

## Annahmen (bei Widerspruch melden, nicht still ändern)

- Das letzte Löschen per Wischen lässt die Karte ebenfalls verschwinden. „Rückgängig“ bringt sie mit Name und Uhrzeit zurück.
- Auf einem **anderen** Tag als heute gilt die 30-Minuten-Regel für das „+“ der Tab-Leiste gegenüber dem jüngsten Eintrag,
  der für diesen Tag gemacht wurde. Sonst legt jedes Nachtragen eine neue Mahlzeit an.
- Eine Mahlzeit, die nur aus wartenden Analysen besteht, zeigt Name und Uhrzeit ohne Tippfunktion. Sie hat noch keinen
  Datensatz (Entscheidung 7).
- „Mahlzeit löschen“ löscht Einträge, keine wartenden Analysen (wie „Alle Einträge löschen“ heute). Solange eine Analyse
  wartet, bleibt die Karte stehen.
- Die fünfte und jede weitere automatische Mahlzeit eines vergangenen Tages bekommt 21:00 als typische Uhrzeit.
- Nennt jemand dem Assistenten eine Mahlzeit, die der Tag nicht hat, entsteht sie mit diesem Namen.
- Das Rädchen läuft nicht im Kreis (`Wheel` kann das nicht): Über 00 steht keine 59. Das Mockup C1 zeigt es anders,
  für die Bedienung ändert das nichts.
- Auf einem alten Tag zeigen die Karten weiter die Uhrzeit des ersten Eintrags, auch wenn sie dadurch nicht aufsteigend
  stehen. Umbenennen und Ziehen ändern die Reihenfolge eines alten Tages nicht.

## Datenmodell

### Felder

```ts
// packages/shared/src/schemas.ts
export const MAX_CUSTOM_MEAL_NAMES = 30;
const mealNameSchema = z.string().trim().min(1).max(40);

export const diaryMealSchema = z.object({
  ...base,
  date: isoDateSchema,
  name: mealNameSchema,
  /** Epoch ms. Set once from the first entry, afterwards only by the person. */
  eatenAt: z.number().int().nonnegative(),
  /** The index 0..3 its entries carry in `foodEntries.meal`. Never changes. */
  slot: z
    .number()
    .int()
    .min(0)
    .max(MEAL_COUNT - 1),
  /** The person set the time: an old day sorts by time from then on. */
  timeEdited: z.boolean().default(false),
});

// foodEntrySchema
diaryMealId: idSchema.nullable().default(null),

// settingsSchema
customMealNames: z.array(mealNameSchema).max(MAX_CUSTOM_MEAL_NAMES).nullable().default(null),
/** The four names as they were before the first rename: what meals without a record are called. */
legacyMealNames: z.array(mealNameSchema).length(MEAL_COUNT).nullable().default(null),

// dayId
diaryMeal: (date: string, slot: number) => `dm:${date}:${slot}`,
```

- `SYNC_SCHEMAS`: `diaryMeals` steht **vor** `foodEntries`, damit eine JSON-Sicherung die Mahlzeit zuerst einspielt.
- `requiredId('diaryMeals', r)`: Beginnt die Id mit `dm:`, muss sie `dayId.diaryMeal(r.date, r.slot)` sein, sonst `null`
  (uuidv7 ist frei).
- **Server** (`apps/api/src/db/schema.ts`): Tabelle `diary_meals` mit `syncColumns()`/`syncExtras`, Spalten `date`, `name`,
  `eatenAt` (`bigint`), `slot` (`integer`), `timeEdited` (`boolean`, Standard `false`), Eintrag in `syncTables`. `foodEntries.diaryMealId: text()`,
  `userSettings.customMealNames` und `legacyMealNames` als `jsonb`, alle neuen Spalten an bestehenden Tabellen nullable.
- **Migration**: `pnpm --filter @ft/api db:generate --name diary-meals` ergibt `0020_diary-meals.sql`. Sie enthält nur
  `CREATE TABLE` und `ADD COLUMN`, **kein** `UPDATE`.
- **Dexie**: `this.version(7).stores({ diaryMeals: 'id, date' })`. Der Index `[date+meal]` bleibt, bestehende Versionen
  werden nicht angefasst. `diaryMealId` braucht keinen Index, ein Tag wird über `date` gelesen.
- Gelesen wird immer mit `?? null`: Datensätze aus älteren Versionen und Sicherungen haben die Schlüssel nicht.

### Regeln

**Keine Massenmigration.** Alte Einträge behalten `diaryMealId: null`. Je Tag und Index bilden sie eine **virtuelle
Mahlzeit** mit der Id `dm:<Datum>:<Index>`, die nur beim Lesen entsteht.

**Sichtbar** ist eine Mahlzeit genau dann, wenn sie mindestens einen lebenden Eintrag oder eine wartende Analyse hat.
Das ist die einzige Regel für Erscheinen und Verschwinden. Ein Datensatz ohne Einträge bleibt liegen und ist unsichtbar.

**Zuordnung eines lebenden Eintrags `e`** (`buildDayMeals`, in dieser Reihenfolge):

1. `e.diaryMealId` zeigt auf einen Datensatz `r` mit `r.date === e.date` und `r.slot === e.meal`: Er gehört zu `r`. Ob
   `r.deleted` gesetzt ist, spielt keine Rolle.
2. `e.diaryMealId` ist gesetzt, der Datensatz ist noch nicht angekommen: Platzhalter unter dieser Id (Name des Index,
   Uhrzeit des ersten Eintrags). Das deckt eine Pull-Seite ab, die den Eintrag vor der Mahlzeit bringt.
3. Sonst (`null`, oder eine ältere App hat den Eintrag in ein anderes Fach gezogen und `meal` passt nicht mehr): die
   jüngste Mahlzeit dieses Index, deren `eatenAt` nicht nach `e.loggedAt` liegt, sonst die früheste dieses Index, sonst
   die virtuelle Mahlzeit `dm:<Datum>:<e.meal>`.

**Name einer virtuellen Mahlzeit**: `(settings.legacyMealNames ?? settings.mealNames)[slot]`.

**Uhrzeit einer virtuellen Mahlzeit**: das kleinste `loggedAt` aller Einträge dieses Index ohne `diaryMealId`, **einschließlich der
Grabsteine**, das zum Tag passt (Kalendertag `date`, oder Folgetag vor 05:00). Grabsteine zählen mit, damit das Löschen
des ersten Eintrags die Uhrzeit nicht verschiebt (Entscheidung 4). Passt keines, gilt die typische Uhrzeit des Index.

| Position               | Typische Uhrzeit |
| ---------------------- | ---------------- |
| 0 Frühstück            | 08:00            |
| 1 Mittagessen          | 12:30            |
| 2 Abendessen           | 18:30            |
| 3 Snacks               | 15:30            |
| 4 ff. Weitere Mahlzeit | 21:00            |

**Reihenfolge eines Tages** (`usesSlotOrder`): Ein Tag steht in Fachreihenfolge (`slot`, dann `id`), solange **jede** sichtbare
Mahlzeit eine Id `dm:…` hat und keine `timeEdited` trägt. Sonst gilt `eatenAt`, dann `slot`, dann `id`. Ein Tag wechselt also
einmal und dauerhaft, sobald die Person dort eine Uhrzeit ändert oder eine neue Mahlzeit (uuidv7) anlegt.

**Wann ein Datensatz entsteht**: beim ersten Eintrag einer neuen Mahlzeit (uuidv7), und für eine virtuelle Mahlzeit erst
beim Umbenennen, beim Ändern der Uhrzeit und beim Ziehen eines Eintrags hinein oder hinaus (`dm:<Datum>:<Index>`). Ein
Eintrag, der über „+“ in eine virtuelle Mahlzeit kommt, bleibt bei `diaryMealId: null`.

**`slot` einer neuen Mahlzeit** (`slotForNewMeal`): der Index des Standard-Namens, wenn der frei ist, sonst der erste
freie, sonst 3. Eine fünfte Mahlzeit teilt sich damit Index 3. Einträge schreiben immer `meal: slot`.

**Löschen schreibt keinen Grabstein.** „Mahlzeit löschen“ löscht die Einträge, der Datensatz bleibt unsichtbar liegen.

### Fälle

| Fall                                                      | Ergebnis                                                                            | Test                   |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------- |
| Zwei Geräte offline, beide beginnen dieselbe Mahlzeit     | Zwei Mahlzeiten (zwei uuidv7), bekannte Grenze; Einträge lassen sich zusammenziehen | `device-sync.test.ts`  |
| Zwei Geräte benennen dieselbe virtuelle Mahlzeit um       | Gleiche Id `dm:…`, LWW, beide zeigen denselben Namen                                | `device-sync.test.ts`  |
| Mahlzeit gelöscht, Eintrag kommt später vom anderen Gerät | Die Karte steht wieder da, mit Name und Uhrzeit; gegessen bleibt gegessen           | `device-sync.test.ts`  |
| Datensatz mit `deleted: true` und lebendem Eintrag        | Sichtbar (Regel 1)                                                                  | `day-meals.test.ts`    |
| Eintrag kommt vor seiner Mahlzeit an                      | Platzhalter, nach dem nächsten Pull der richtige Name                               | `device-sync.test.ts`  |
| Ältere App schreibt in einen Tag mit neuen Mahlzeiten     | Eintrag mit `null` landet über Regel 3 in der Mahlzeit dieses Index                 | `device-sync.test.ts`  |
| Ältere App zieht einen Eintrag in ein anderes Fach        | `meal` passt nicht mehr zu `slot`, Regel 3 ordnet ihn dem neuen Fach zu             | `day-meals.test.ts`    |
| Ältere App bearbeitet einen Eintrag ohne das neue Feld    | Server speichert `null`, Regel 3 findet dieselbe Mahlzeit über den Index            | `device-sync.test.ts`  |
| JSON-Sicherung von vor dem Umbau                          | `restoreBackup` überspringt die fehlende Tabelle, Einträge werden virtuell          | `device-sync.test.ts`  |
| JSON-Sicherung nach dem Umbau                             | `importRecord` hält `updatedAt`, LWW entscheidet je Datensatz                       | `device-sync.test.ts`  |
| Server-Restore (neue Epoche)                              | `resetForEpoch` nimmt `diaryMeals` über `SYNC_TABLES` von selbst mit                | `device-sync.test.ts`  |
| Wartende Analyse aus der alten App-Version                | Ohne `diaryMealId`: Regel 3 über `draft.meal ?? item.meal`                          | `meals-photos.test.ts` |

### Abweichungen vom Vorschlag

1. **Neu: `diaryMeals.slot`.** Ohne das Feld lässt sich nicht erkennen, dass eine ältere App einen Eintrag in ein anderes
   Fach gezogen hat, und `null`-Einträge fänden ihre Mahlzeit nicht, sobald eine uuidv7-Mahlzeit dieses Fach belegt.
2. **Neu: `settings.legacyMealNames`.** Virtuelle Mahlzeiten lesen ihren Namen aus den Einstellungen. Eine Umbenennung
   würde alle alten Tage mit umbenennen und damit Entscheidung 3 und 13 brechen. Die Alternative wäre, vor jeder
   Umbenennung alle alten Tage als Datensätze zu schreiben.
3. **Kein Grabstein beim Löschen einer Mahlzeit.** Sichtbarkeit folgt allein aus den Einträgen. Das macht Rückgängig,
   das Leerziehen und den Fall „gelöschte Mahlzeit, später kommt ein Eintrag“ zu einem einzigen Fall.
4. **Virtuell bleibt virtuell, solange nichts Eigenes zu merken ist.** Ein Eintrag über „+“ erzeugt keinen Datensatz.
   Das spart Schreibvorgänge und verhindert, dass ein offline eingetragenes Gerät per LWW einen Namen überschreibt, den
   ein anderes Gerät gerade vergeben hat.
5. **Die Uhrzeit virtueller Mahlzeiten zählt Grabsteine mit und prüft den Kalendertag**, weil `loggedAt` nicht immer zum
   Tag passt (nachgetragene und eingefügte Einträge, `seed-demo.ts`).
6. **Ziel `dm=new` in der URL und `newMeal` an der Warteschlange.** Eine neue Mahlzeit bekommt ihre Id erst beim Schreiben;
   eine wartende Analyse friert Id, Name und Uhrzeit beim Einreihen ein (Block 5).

## Im Code gefundene Stellen, die der Umbau treffen würde

| Stelle                                                                             | Problem                                                                                                                                      | Block   |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `pushRequestSchema` (`syncTableSchema`)                                            | Eine unbekannte Tabelle macht den **ganzen** Push zu 400. Nach einem Rollback kann eine neue PWA nichts hochladen, bis sie sich aktualisiert | Rollout |
| `moveEntriesToMeal` (`db/entries.ts:264`)                                          | Überspringt Einträge mit `prev.meal === meal`. Zwei Mahlzeiten mit Index 3 ließen sich nicht tauschen                                        | 3       |
| `saveGroupDraft` (`db/groupDraft.ts:356`)                                          | Neue Zutaten kopieren nur `meal: first.meal`, `diaryMealId` ginge verloren                                                                   | 3       |
| `FoodLogPage.save` (`FoodLogPage.tsx:296`)                                         | `saveRecord` mit der Kopie aus dem Render überschreibt, was ein anderes Gerät zwischenzeitlich geändert hat                                  | 4       |
| `runQueue` (`features/ai/queue.ts`, `draftFromResult({ meal: old.meal, result })`) | Eine erneute Analyse baut den Entwurf neu und verlöre das gewählte Ziel                                                                      | 5       |
| `applyOps` (`execute.ts`)                                                          | Die Transaktion darf nur auf IndexedDB warten, das Ziel muss vorher feststehen. Der Tabellenumfang braucht `diaryMeals`                      | 3, 10   |
| Assistent `moveEntries`                                                            | Ändert `date` und `meal`; ein altes `diaryMealId` zeigte auf den falschen Tag                                                                | 10      |
| `assistantContextSchema.mealNames` (`.length(4)`), Enum in `assistantTools`        | Das Modell kennt nur vier Namen. Beide müssen für ältere PWAs weiter gelten                                                                  | 10      |
| `mealsLogged` (`reports.ts:75`)                                                    | Zählt `e.meal`. Zwei Mahlzeiten mit Index 3 wären eine, der Tag bliebe unvollständig                                                         | 11      |
| `Section` (`components/Page.tsx`)                                                  | `overflow-hidden` schneidet alles außerhalb ab; das `h2` hat kein `min-w-0`, ein langer Name liefe also nie messbar über                     | 6, 7    |
| `README.md` „Rückweg nach einer fehlgeschlagenen Migration“                        | Verlangt pauschal das Zurückrollen des Snapshots. Das würde hier Daten der zweiten Person verwerfen, obwohl die Migration additiv ist        | 13      |
| E2E-Specs                                                                          | Viele erwarten vier leere Karten (Liste in Block 6)                                                                                          | 6       |

## Was sich nicht ändern darf

- Summen, Budget und Tagesübersicht: `summarizeDay` rechnet weiter über alle lebenden Einträge eines Tages.
- `foodEntries.meal` bleibt 0 bis 3 und wird immer geschrieben. Ältere App-Versionen lesen und schreiben weiter.
- Der Server schreibt keine Mahlzeiten und fasst bestehende Datensätze nicht an.
- Wischen nach links und rechts, Rückgängig-Toasts, Gruppen-Editor, Zwischenablage als Momentaufnahme.
- Langes Drücken zieht weiter Einträge und Gruppen (`DRAG_ACTIVATION`, Sensoren, `useDiaryDrag`).
- Navigation: `returnToDiary`, `goBackOr`, Scrollposition des Tagebuchs, Sprung zu den neuen Zeilen.
- KI: `requestId`, ein Foto wird nie doppelt bezahlt oder eingetragen, `logReview` bleibt eine Transaktion, `leaveAnalysis`.
- Der Assistent schreibt nie auf dem Server in synchronisierte Tabellen, alles läuft in einer Dexie-Transaktion mit Rückgängig.
- Training, Schritte, Gewicht, Notiz, „Tag abschließen“ als Funktion, „Alle vergangenen Tage abschließen“.
- Bestehende CSV-Spalten behalten Name und Reihenfolge.
- Ein Tag ist ab `MIN_MEALS_COMPLETE` (2) Mahlzeiten vollständig.
- Sicherung, Wiederherstellung und Epochen-Upload laufen ohne Dialog.
- Keine Erklärtexte im UI, Wortwahl „eintragen“ und „speichern“, keine Halbgeviert- oder Geviertstriche.

## Umsetzung

Zeilennummern sind der Stand von `feda5d7` und dienen nur zum Finden. Jeder Block endet grün und lauffähig: Bis Block 6
zeigt das Tagebuch weiter vier Fächer und liest dafür `meal`.

### Block 1: Datenmodell, Migration, Sync

Vorher lesen: `.claude/skills/offline-sync/SKILL.md`, `docs/sync.md`.

**Dateien**: `packages/shared/src/schemas.ts`, `apps/api/src/db/schema.ts`, `apps/api/drizzle/0020_diary-meals.sql` (erzeugt),
`apps/web/src/db/dexie.ts`, `apps/web/src/db/settings.ts`, `apps/web/src/features/more/rejectedRecords.ts`.

**Änderungen**

- Felder, `dayId.diaryMeal`, `requiredId`, Tabelle und Migration wie unter „Datenmodell“.
- `DEFAULT_SETTINGS` bekommt `customMealNames: null`, `legacyMealNames: null`.
- `UserDb.diaryMeals`, `this.version(7)`. `NewFoodEntry` lässt `diaryMealId` aus, gefüllt wird in `logFoodEntry`,
  `logQuickEntry`, `logItems` und `saveGroupDraft` (zunächst `null`). Fixtures vom Typ `FoodEntry` bekommen `diaryMealId: null`.
- `TABLE_LABELS`/`TABLE_ITEM`: `diaryMeals` „Mahlzeiten“ / „Mahlzeit“.
- Fixtures mit Einstellungen: `apps/api/test/sync.test.ts:83` und `:328`, `packages/shared/test/macro-presets.test.ts:58`,
  `apps/api/scripts/seed-demo.ts:103`. Die Fixture in `apps/api/test/steps.test.ts:330` nur anfassen, wenn der Typecheck es
  verlangt (siehe Vorbedingung).

**Tests**

- `apps/api/test/sync.test.ts`: Round-Trip mit `diaryMeals`, `diaryMealId`, `customMealNames`, `legacyMealNames`; ein Eintrag
  alter Form ohne die Felder kommt mit `null` zurück; `dm:`-Id mit falschem Datum oder Index wird abgelehnt
  (`id must be …`); uuidv7 ist frei; Benutzer-Isolation.
- `apps/api/test/device-sync.test.ts`: Eine App ohne die Tabelle überspringt `diaryMeals` und meldet `needsUpdate`, nach dem
  Update holt ein voller Pull sie nach (Vorbild „skips changes of a table this app version does not know“). Ein `patchRecord`
  auf einem Datensatz mit unbekanntem Feld behält das Feld.
- `apps/web/test/write.test.ts`: `saveRecord` lehnt eine falsche `dm:`-Id ab; Dexie v7 öffnet eine v6-Datenbank mit Daten.

**Abnahme**: `0020` enthält kein `UPDATE`. Die App verhält sich unverändert.

### Block 2: Reine Tageslogik

**Dateien**: neu `packages/shared/src/dayMeals.ts`, Export in `packages/shared/src/index.ts`, neu
`packages/shared/test/day-meals.test.ts`.

**Änderungen** (alles rein, ohne Uhr und ohne Datenbank; die Zeitzone ist die des Geräts):

```ts
export const NEW_MEAL_GAP_MS = 30 * 60_000;
export const EXTRA_MEAL_NAME = 'Weitere Mahlzeit';
export const NIGHT_END_HOUR = 5;

export interface DayMeal<P = unknown> {
  id: string;
  date: ISODate;
  name: string;
  eatenAt: number;
  slot: number;
  /** No record yet (`dm:<date>:<slot>`), or a record that has not arrived. */
  virtual: boolean;
  /** Eaten after midnight, on the calendar day after `date`. */
  night: boolean;
  entries: FoodEntry[];
  pending: P[];
}
```

- `buildDayMeals({ date, entries, records, pending, names })`: `entries` samt Grabsteinen, Zuordnung nach den drei Regeln,
  nur sichtbare Mahlzeiten, sortiert nach der Regel „Reihenfolge eines Tages“. `entries` im Ergebnis nur lebende, nach `loggedAt`.
- `nextMealName(names, day)`: erster Standard-Name, den der Tag noch nicht hat (Vergleich ohne Groß/Klein), sonst `EXTRA_MEAL_NAME`.
- `slotForNewMeal(name, names, day)`, `typicalEatenAt(date, position)`, `newMealEatenAt(date, name, names, at)`
  (heute: `at`; sonst die typische Uhrzeit der Position).
- `eatenAtOf(date, hour, minute, night)`, `isNightOf(date, eatenAt)`, `canBeNight(hour)`.
- `closestMeal(target, meals)`: gleicher Name, unter mehreren die nächstliegende Uhrzeit; sonst die nächstliegende Uhrzeit
  (Minuten des Tages, die Nacht zählt hinter 23:59).
- `entryMealKey(e)`: `e.diaryMealId ?? dayId.diaryMeal(e.date, e.meal)`.

**Tests**: alle Zeilen der Tabelle „Fälle“, die keine Sync-Strecke brauchen, dazu: Name in Reihenfolge, „Snacks“ von Hand
macht die dritte Mahlzeit zu „Mittagessen“, die erste heißt um 13:00 „Frühstück“, Uhrzeit bleibt nach dem Löschen des ersten
Eintrags, `loggedAt` am falschen Tag ergibt die typische Uhrzeit, Eintrag kurz nach Mitternacht zählt als Nacht, Sortierung
der Nacht ans Ende, alter Tag bleibt in Fachreihenfolge (auch nach Umbenennen und Ziehen), wechselt nach geänderter Uhrzeit
und nach einer neuen Mahlzeit, Sommerzeit-Umstellung, zwei „Snacks“ bleiben getrennt.

**Abnahme**: Das Paket hat keinen Verbraucher außerhalb der Tests.

### Block 3: Schreibschicht auf dem Gerät

**Dateien**: neu `apps/web/src/db/diaryMeals.ts` (ohne `@/`-Importe), `apps/web/src/db/entries.ts`,
`apps/web/src/db/groupDraft.ts`, `apps/web/src/hooks/data.ts`.

**Änderungen**

- `readDay(db, date)`: liest Einträge samt Grabsteinen, `diaryMeals`, `aiQueue` und Einstellungen und ruft `buildDayMeals`.
- `useDayMeals(date)` als Live-Abfrage darauf.
- Das Ziel wird **vor** der Transaktion festgelegt:

```ts
/** Where the next entries go. `{ date, meal }` alone still means the old slot. */
export interface LogTarget {
  date: ISODate;
  meal: number;
  diaryMealId?: string | null;
  /** Written with the first entry when the meal has no record yet. */
  create?: { name: string; eatenAt: number } | null;
}

export async function prepareMealTarget(
  db: UserDb,
  ref: { date: ISODate; meal: number; dm?: string },
  at: number,
): Promise<LogTarget>;
```

- `dm === 'new'`: neue uuidv7, Name, `slot` und `eatenAt` aus Block 2. `dm` bekannt: dessen `slot`. Virtuell ohne Datensatz:
  `diaryMealId: null`. Ohne `dm`: Regel 3 über `meal`.
- `applyLogTarget(db, target)` in der Transaktion: legt den Datensatz an, wenn `create` gesetzt ist und er fehlt; liefert
  `{ meal, diaryMealId }` für den Eintrag.
- `logFoodEntry`, `logQuickEntry`, `logItems`, `logParts`, `logAiMeal`, `logAiItemsRows`: nehmen ein `LogTarget`. Der
  Tabellenumfang jeder Transaktion bekommt `db.diaryMeals`, auch `logReview` (`queue.ts:184`) und `applyOps` (`execute.ts:156`),
  sonst wirft Dexie „table not part of transaction“.
- `moveEntriesToDiaryMeal(db, ids, target)` ersetzt `moveEntriesToMeal`: legt für Quelle und Ziel einen fehlenden Datensatz
  an (die Uhrzeit bleibt so stehen), vergleicht `meal` **und** `diaryMealId`, liefert die alten Werte je Eintrag für Rückgängig
  (`restoreEntryMeals`).
- `renameDiaryMeal(db, meal, name)`, `setDiaryMealTime(db, meal, eatenAt)`: über `upsertRecord`, legen den Datensatz bei
  Bedarf an. Nur `setDiaryMealTime` setzt `timeEdited: true`; sein Rückgängig stellt auch den alten Wert von `timeEdited` wieder her.
- `saveGroupDraft`: neue Zutaten übernehmen `diaryMealId: first.diaryMealId ?? null`.

**Tests**: neu `apps/web/test/day-meals-write.test.ts` (neue Mahlzeit mit erstem Eintrag, zwei Einträge in dieselbe, virtuell
bleibt virtuell, Umbenennen legt `dm:` an, Ziehen legt Quelle und Ziel an, Tausch innerhalb Index 3, Rückgängig, Abbruch rollt
Mahlzeit und Eintrag zusammen zurück); `write.test.ts:807-832` umschreiben; `device-sync.test.ts`: Fälle der Tabelle.

**Abnahme**: Mit `{ date, meal }` entsteht weiter genau der Datensatz von heute.

### Block 4: Ziel wählen

**Dateien**: `apps/web/src/lib/meals.ts`, `apps/web/src/components/AddSheet.tsx`, `apps/web/src/app/router.tsx`,
`apps/web/src/components/HeaderMealPicker.tsx`, neu `apps/web/src/features/diary/MealTargetSelect.tsx`,
`apps/web/src/features/ai/PhotoPage.tsx`, `usePhotoFlow.ts`, `apps/web/src/features/foods/AddFoodPage.tsx`, `FoodLogPage.tsx`,
`foodLogDraft.ts`, `QuickEntryFields.tsx`, `QuickAddPage.tsx`, `ScanPage.tsx`, `CustomFoodPage.tsx`, `apps/web/src/features/meals/MealPage.tsx`,
`MealLogView.tsx`, `apps/web/src/lib/into.ts`, `apps/web/src/features/diary/diaryScroll.ts`, `apps/web/src/features/assistant/execute.ts` (nur der Aufruf).

**Änderungen**

- `logTargetFor` liefert `{ date, meal, dm }`: Liegt der jüngste Eintrag oder die jüngste wartende Analyse höchstens
  `NEW_MEAL_GAP_MS` zurück, gilt deren Mahlzeit (bei genau 30 Minuten noch dieselbe), sonst `dm: 'new'`. Über Mitternacht
  bleibt die bestehende Regel für den Vortag. `defaultMealForNow` und `STICKY_MEAL_MS` entfallen.
  `AddSheet` liest dafür zusätzlich `diaryMeals` und die Einstellungen. `execute.ts` passt bis Block 10 nur den Aufruf an und schreibt weiter über `meal`.
- Router: `MealSearch` bekommt `dm?: string`, `validateMeal` prüft es (`new` oder gültige Id). `meal` bleibt, alte Links wie
  `/photo?meal=1` funktionieren über Regel 3. Das gilt auch für `/quick-add`, `/custom-food/$id`, `/meals/$mealId`, `/diary-meal`.
- `dm` weiterreichen an allen Stellen, die heute `meal` weiterreichen: `ScanPage.tsx:42`, `:71`, `CustomFoodPage.tsx:184`,
  `PhotoPage.tsx:206`, `:214`, `AddFoodPage.tsx:86`, `:245`, `FoodLogPage.tsx:357`, `QuickAddPage.tsx:36`, `openTarget` (`into.ts`),
  `MealLogView`; in Block 5 `ReviewStep.tsx:171` und `PendingAnalysisRow.tsx:70`.
- `HeaderMealPicker` wie Mockup D: Name und darunter Uhrzeit oder „Neu“; Liste der Mahlzeiten des Tages mit Uhrzeit, darunter
  „Neue Mahlzeit“ mit dem Namen, den sie bekäme.
- `MealTargetSelect` ersetzt die drei `Select` über `settings.mealNames` (`FoodLogPage.tsx:427`, `MealLogView.tsx:303`,
  `ReviewStep.tsx:445`, dort in Block 5).
- `FoodLogPage.save` beim Bearbeiten: `upsertRecord` statt `saveRecord`; `meal` und `diaryMealId` ändern sich nur, wenn die
  Auswahl geändert wurde. `foodLogDraft` bekommt optional `dm`, alte Einträge im `sessionStorage` bleiben gültig.
- `DiaryFocus.meal` wird `mealId?: string`, `data-meal` trägt die Id der Mahlzeit.

**Tests**: `apps/web/test/lib.test.ts:84-146` neu (29 und 30 Minuten dieselbe Mahlzeit, 31 Minuten neu, wartende Analyse zählt,
gezogener Eintrag zählt in seiner neuen Mahlzeit, über Mitternacht, anderer Tag); Router-Validierung; E2E: `market.spec.ts:192-209`
(Auswahl im Kopf), neu `apps/web/e2e/day-meals.spec.ts` mit `page.clock`: unter 30 Minuten dieselbe, darüber neue Mahlzeit,
„+“ einer alten Mahlzeit gewinnt.

**Abnahme**: Mockup D1 bis D4 stimmen. `/photo?meal=1` trägt weiter in Mittagessen ein.

### Block 5: KI-Warteschlange, verzögerte Analysen, Entwürfe

**Dateien**: `apps/web/src/db/dexie.ts` (nur Typen), `apps/web/src/db/aiDraft.ts`, `apps/web/src/features/ai/queue.ts`,
`usePhotoFlow.ts`, `ReviewStep.tsx`, `QueueList.tsx`, `apps/web/src/features/diary/PendingAnalysisRow.tsx`.

**Änderungen**

- `AiQueueItem` bekommt optional `diaryMealId?: string | null` und `newMeal?: { name: string; eatenAt: number; slot: number }`.
  `AiDraft` bekommt optional `diaryMealId?: string | null`. Kein neuer Index, keine Dexie-Version, `meal` bleibt gefüllt.
- `enqueuePhotos` und `enqueueDescription`: `dm === 'new'` wird beim Einreihen zu einer festen Id mit `newMeal`
  (`eatenAt` = Aufnahmezeit). So bleiben Name und Uhrzeit stehen, auch wenn die Analyse Stunden wartet, und eine zweite Analyse
  innerhalb von 30 Minuten findet über `logTargetFor` dieselbe Id. Ist eine Mahlzeit nur durch eine wartende Analyse bekannt, trägt
  `prepareMealTarget` deren `newMeal` als `create` ins Ziel: Wer zuerst einträgt, legt den Datensatz an.
- `buildDayMeals` zeigt wartende Analysen in ihrer Mahlzeit, `newMeal` liefert Name und Uhrzeit, solange der Datensatz fehlt.
- `logReview` und `logDeferred` bauen das `LogTarget` aus `draft.diaryMealId ?? item.diaryMealId`, `item.newMeal`, sonst über
  Regel 3 aus `draft.meal ?? item.meal`. **Vorhandene Einträge der Warteschlange laufen so ohne Umbau weiter.**
- `runQueue`: Der neu gebaute Entwurf einer erneuten Analyse behält `diaryMealId`. `draftFromResult` nimmt das Feld mit.
- `ReviewStep`: `MealTargetSelect`, `commit({ ...draft, meal, diaryMealId })`.

**Tests**: `apps/web/test/meals-photos.test.ts`: altes Queue-Element ohne Felder wird in sein Fach eingetragen; `deferred` mit
`newMeal` legt Mahlzeit und Einträge in einer Transaktion an, Name und Uhrzeit vom Einreihen; zweifaches `processQueue` trägt
einmal ein; ↻ behält das Ziel; verworfene Analyse hinterlässt keinen Datensatz. E2E `meals-goals.spec.ts`: Analyse offline,
Platzhalter in der neuen Mahlzeit, online eingetragen.

**Abnahme**: Eine Analyse, die vor dem Update wartete, landet nach dem Update in ihrer Mahlzeit.

### Block 6: Tagebuch

**Dateien**: `apps/web/src/features/diary/DiaryPage.tsx`, `MealCard.tsx`, `DiaryDnd.tsx`, `DiaryMealMenu.tsx`, `DiaryMealPage.tsx`,
`apps/web/src/components/Page.tsx`.

**Änderungen**

- `DiaryPage`: `useDayMeals(date)` statt `MEAL_COUNT`. Hat der Tag keine Mahlzeit, steht eine leere Karte (`EmptyMealCard`:
  Name aus `nextMealName`, keine Uhrzeit, kein ⋯, „Essen eintragen“, Vorschläge; „+“ führt nach `/photo?dm=new`). Am Ende der
  Liste „Mahlzeit hinzufügen“, ebenfalls `dm=new`, nur wenn es schon eine Mahlzeit gibt. Beides schreibt nichts.
- `MealCard` bekommt eine `DayMeal`. Außen ein Wrapper (`mb-[18px]`, `data-meal`), darin die Zeitzeile (22 px, 13 px grau,
  `tabular`, Tippfläche über negativen Rand wie `.mtime` im Mockup) und die `Section` ohne eigenen unteren Abstand.
- Kopf: Name (in Block 7 die Auswahl, bis dahin Text), kcal und Pfeil als Link nach `/diary-meal` mit `aria-label` „<Name>, <kcal> kcal“.
  `Section` bekommt `titleClassName`, damit das `h2` schrumpfen kann.
- `DiaryDnd`: Drop-Id `meal-<id>`, `DragRowData.meal` ist die Id, `moveEntriesToDiaryMeal`, Rückgängig über `restoreEntryMeals`.
  Toast wie Mockup: „Apfel zu Mittagessen verschoben“.
- `DiaryMealMenu`: „Mahlzeit löschen“ (`removeEntriesWithUndo`, „<Name> gelöscht“). Auf `/diary-meal` führt Löschen zurück ins Tagebuch.
- `DiaryMealPage`: Suchparameter `dm`, Daten aus `useDayMeals`, unbekannte Id zeigt `NotFoundPage`.
- Bis Block 9 liest die Karte ihre Vorschläge weiter über `suggestions.get(meal.slot)`.

**E2E anpassen**: `diary-training.spec.ts:391`, `:427-455`, `:469-476`, `:638-664`, `:688-705`; `meals-goals.spec.ts:131-133`, `:857-861`,
`:921`, `:983`, `:1010`, `:1107`, `:1172-1212`; `market.spec.ts:53-73`, `:172-173`; `meals-unified.spec.ts:44-47`, `:63-101`, `:114-123`.
Mahlzeiten, die ein Test als Ziel braucht, legt er vorher mit `/photo?form=1&meal=N` an.

**Tests**: `apps/web/test/components.test.tsx` (leere Karte, Zeitzeile, kein ⋯ auf der leeren Karte); `day-meals.spec.ts`: leerer Tag
zeigt eine Karte, „Mahlzeit hinzufügen“ schreibt nichts (Rückkehr ohne Eintrag lässt die Liste unverändert), Löschen mit Rückgängig bringt
Name und Uhrzeit zurück, leer gezogene Mahlzeit verschwindet und kommt mit Rückgängig zurück; `ios-layout.spec.ts`: bei 375 px
stehen Zeitzeile, Kopf und alle Knöpfe ohne Überlauf.

**Abnahme**: Mockup A1 bis A4 und E1 bis E4b stimmen. Der Kopf in der Karte sieht aus wie heute.

### Block 7: Name

**Dateien**: neu `apps/web/src/features/diary/MealNameMenu.tsx`, neu `apps/web/src/components/MarqueeText.tsx`,
`apps/web/src/index.css`, `apps/web/src/features/more/MealNamesPage.tsx`, `MorePage.tsx`, `apps/web/src/db/diaryMeals.ts`.

**Änderungen**

- `MealNameMenu`: `DropdownMenu` mit den 4 Namen, den eigenen Namen und „Eigener Name“ (`NameDialog`, `maxLength={40}`). Der
  aktuelle Name ist markiert. „Weitere Mahlzeit“ steht nicht in der Liste.
- `chooseMealName(db, meal, name)`: Eigener Name und Umbenennung in einer Transaktion, `saveSettings` für `customMealNames`
  (ohne Dubletten, ohne Standard-Namen). Bei `MAX_CUSTOM_MEAL_NAMES` gilt der Name für die Mahlzeit, die Liste bleibt, ein Toast sagt es.
- `MealNamesPage`: Titel „Mahlzeiten-Namen“. Speichern schreibt `mealNames` und einmalig
  `legacyMealNames: settings.legacyMealNames ?? settings.mealNames`. Abschnitt „Eigene Namen“ (nur wenn es welche gibt) mit Löschen und
  `ConfirmDialog` „„X“ löschen?“, „Eingetragene Mahlzeiten behalten diesen Namen.“. `MorePage`: „4 Standard · 2 eigene“.
- `MarqueeText`: ein `ResizeObserver` auf Box und Text setzt im Callback `overflows` per `useState` und die Strecke per
  `style.setProperty('--marquee-distance', …)`. Kein `setState` direkt im Effekt, kein Ref-Zugriff beim Rendern. Läuft der Text über,
  steht er zweimal in einer Spur (die Kopie `aria-hidden`), `@keyframes` wie im Mockup: 22 % Pause, Dauer wie im Mockup (Strecke / 28 / 0,78 Sekunden).
  Weiche Ränder über `mask-image` nur während des Überlaufs. Bei `prefers-reduced-motion: reduce` keine Animation und keine Kopie,
  der Text wird abgeschnitten.

**Tests**: `components.test.tsx` mit dem vorhandenen `ResizeObserver`-Stub (`:187`): kurz kein Lauf, lang mit Kopie, `aria-hidden`,
Vorlesetext einmal; `write.test.ts`: Umbenennen hält `legacyMealNames`, ein alter Tag behält seinen Namen nach dem Umbenennen, ein eigener
Name steht nach dem Löschen nicht mehr in der Auswahl und die Mahlzeit behält ihn; E2E: Name wählen, eigener Name auf einem zweiten Gerät in
der Auswahl; `ios-layout.spec.ts`: 40 Zeichen laufen, die Seite bekommt keinen Querlauf, die Knöpfe bleiben sichtbar, mit
`reducedMotion: 'reduce'` keine Animation.

**Abnahme**: `pnpm lint` ohne Hinweis der React-Compiler-Regeln. Mockup B und F stimmen.

### Block 8: Uhrzeit-Dialog und Nacht

**Dateien**: neu `apps/web/src/features/diary/MealTimeDialog.tsx`, `MealCard.tsx`.

**Änderungen**

- Zwei `Wheel` (Stunden 00 bis 23, Minuten 00 bis 59), minutengenau, in `DialogBody`, Titel = Name der Mahlzeit. Darunter die Wahl
  „Do., 19. Nov.“ / „Nacht auf Fr.“ (`ToggleGroup`), nur für 00:00 bis 04:59. Ein Wechsel auf 05:00 oder später setzt sie zurück.
- „Änderungen übernehmen“ ruft `setDiaryMealTime`, Toast „<Name> auf 14:00 geändert“ mit Rückgängig. Die Liste sortiert sich neu.
- Mond und Kurztag neben der Uhrzeit, wenn `meal.night` gilt.

**Tests**: `apps/web/test/components.test.tsx`: Nacht nur im erlaubten Bereich, Vorbelegung einer Nacht-Mahlzeit; `day-meals-write.test.ts`:
Einträge hinzufügen oder löschen ändert `eatenAt` nie; E2E: 07:40 auf 14:00, neue Reihenfolge, Name bleibt, Rückgängig; 00:30 als Nacht steht
am Ende des Tages mit Mond, der Tag der Einträge bleibt; `ios-layout.spec.ts`: Dialog passt bei 375 × 667 über die Tastatur hinweg.

**Abnahme**: Mockup C1 bis C4 stimmen.

### Block 9: „Zuletzt hier“, „Wie gestern“, Einfügen

**Dateien**: `apps/web/src/db/suggestions.ts`, `apps/web/src/features/diary/MealSuggestions.tsx`, `DiaryMealMenu.tsx`, `MealCard.tsx`,
`apps/web/src/hooks/data.ts`.

**Änderungen**

- `daySuggestions` baut die letzten 60 Tage über `buildDayMeals` und gruppiert nach Name. Ein Standard-Name zählt über `legacyMealNames`
  und `mealNames` als derselbe, damit eine Umbenennung den Verlauf nicht verliert. Ergebnis: `Map<mealId, MealSuggestions>` plus Schlüssel für
  die leere Karte. Ausgeschlossen wird, was **diese** Mahlzeit schon hat.
- `yesterdayKcal` wird `yesterday: { id, name, eatenAt, kcal } | null` über `closestMeal`. Der Chip zeigt „Frühstück 07:35 · 429 kcal“.
- `copyMealFromDay(db, fromMeal, target)` nimmt die Einträge der gefundenen Mahlzeit. `copyYesterdayWithToast`, `logSuggestion`, `PasteButton`,
  `pasteWithToast`, `pasteClipboard` nehmen ein `LogTarget`. Das Format der Zwischenablage bleibt.

**Tests**: `apps/web/test/suggestions.test.ts` neu: gleicher Name, zwei „Snacks“ getrennt, nächstliegende Uhrzeit ohne gleichen Namen, Nacht, nach
Umbenennung derselbe Verlauf; E2E: `market.spec.ts:53-73` („Wie gestern“), Mahlzeit kopieren, auf einem anderen Tag in die leere Karte einfügen.

**Abnahme**: Mockup G1a und G1b stimmen. Eine alte Zwischenablage aus `kv` lässt sich einfügen.

### Block 10: Assistent

Vorher den Skill `claude-api` laden.

**Dateien**: `packages/shared/src/assistant.ts`, `apps/api/src/assistant/tools.ts`, `prompt.ts`, `host.ts`, `apps/api/src/routes/assistant.ts`,
`apps/web/src/db/dexie.ts` (Typen), `apps/web/src/features/assistant/execute.ts`, `queue.ts`, `controller.ts`, `HistoryPage.tsx`, `AssistantProvider.tsx`.

**Änderungen** (ältere PWA und neuer Server müssen zusammen funktionieren, deshalb nur Ergänzungen mit Standardwert):

- Kontext: `days[].meals` (`{ id, name, time, night }`, Standard `[]`), `contextEntrySchema.diaryMealId` (Standard `null`),
  `previousTarget.diaryMealId` (Standard `null`). `mealNames` und `meal` bleiben.
- Operationen `logFood`, `logEstimate`, `logSavedMeal`, `logQuick`, `copyEntries`, `openCamera`: zusätzlich `diaryMealId` und `mealName`, Standard `null`.
  `moveEntries`: `toDiaryMealId`, `toMealName`. `meal`/`toMeal` bleiben gefüllt.
- Tools: `meal` wird ein freier String (Kurz-Id `m1` oder Name) statt Enum. Das hält die Tool-Liste je Person gleich. `Aliases` bekommt die Art `m`.
- `host.ts`: Mit `days[].meals` löst `meal()` Kurz-Id oder Namen auf, ein unbekannter Name wird `mealName`. Ohne `meals` (ältere PWA) gilt die heutige
  Prüfung gegen die vier Namen. `get_day` nutzt `buildDayMeals` mit den Datensätzen des Servers.
- `dayText` listet Mahlzeiten mit Uhrzeit und Kurz-Id, ohne `meals` wie heute. Ein Satz im Systemprompt erklärt das; ohne genannte Mahlzeit bleibt
  `meal` weiter leer und das Gerät entscheidet.
- `execute.ts`: `targetResolver` löst vor der Transaktion auf (`diaryMealId`, dann `mealName`, dann `meal`, dann `logTargetFor`), alle Operationen eines
  Turns ohne Mahlzeit gehen in dieselbe. `moveEntries` schreibt `date`, `meal`, `diaryMealId`, die Rückgängig-Schritte enthalten alle drei.
  `AppliedOp.target` bekommt `diaryMealId` und Name. Gespeicherte Turns ohne die Felder bleiben lesbar (`?? null`).
- `HistoryPage.describeOps`: `op.mealName`, sonst der Name des Index.

**Tests**: `apps/api/test/assistant.test.ts`: neuer Kontext, alter Kontext ohne `meals` ergibt dieselben Operationen wie heute, unbekannter Name, zwei
„Snacks“ über Kurz-Id; `apps/web/test/assistant-execute.test.ts`: alle Auflösungswege, Verschieben auf einen anderen Tag, Rückgängig, alter Turn;
`apps/web/test/assistant-queue.test.ts`: Kontext; E2E `assistant.spec.ts:84-97`.

**Abnahme**: Der Assistent trägt in eine bestehende, eine neue und eine benannte Mahlzeit ein, Rückgängig stellt alles her.

### Block 11: Berichte, CSV, Tagesbild, Tag abschließen

**Dateien**: `packages/shared/src/reports.ts`, `packages/shared/src/diary.ts`, `apps/web/src/features/reports/export.ts`, `ReportsPage.tsx`,
`apps/web/src/features/diary/share/DayShareImage.tsx`, `ShareDayDialog.tsx`, `shareDay.tsx`, `apps/web/src/features/day/CompleteDayPage.tsx`.

**Änderungen**

- `mealsLogged`: `new Set(es.map(entryMealKey)).size`. `MIN_MEALS_COMPLETE` bleibt 2.
- `entriesCsv(entries, mealOf, dialect)`: „Mahlzeit“ ist der Name, sortiert nach Datum, `eatenAt`, `loggedAt`, neue Spalte **„Uhrzeit“ am Ende** (Uhrzeit der
  Mahlzeit). `ReportsPage` liest dafür `diaryMeals` des Zeitraums.
- Tagesbild: `DayShareData.meals` statt `mealNames`, jede Mahlzeit mit Uhrzeit (und Mond), keine Laufschrift, Name abgeschnitten.
- `CompleteDayPage`: „… ist leer“ nennt Standard-Namen, die der Tag nicht hat; „Schnell schätzen“ führt nach `/photo?dm=new&form=1`.

**Tests**: `apps/web/test/write.test.ts:436` (CSV: Spalten unverändert, „Uhrzeit“ zuletzt, Reihenfolge, Nacht am Ende des Tages), `packages/shared/test` zu
`mealsLogged` (zwei „Snacks“ mit gleichem Index zählen zwei), `components.test.tsx:1978` (Tagesbild), `share-day.spec.ts`.

**Abnahme**: Mockup G2 und G3 stimmen. Die Spalten einer alten Auswertung stehen an derselben Stelle.

### Block 12: Demo-Daten, Aufräumen, E2E-Gesamtlauf

**Dateien**: `apps/api/scripts/seed-demo.ts`, `packages/shared/src/diary.ts`, `apps/web/src/lib/meals.ts`, E2E.

**Änderungen**

- `seed-demo.ts`: `loggedAt` zur Tageszeit des jeweiligen Tages (heute `now + d * 100 + i`), einige Tage mit `diaryMeals` (zwei „Snacks“, ein eigener Name).
- Aufräumen: `perMeal` und `mealCount` aus `summarizeDay`, verwaiste Importe von `MEAL_COUNT`.
- `pnpm e2e` komplett (`chromium-iphone`, `webkit-iphone` für `ios-layout.spec.ts`).
- Sichtprüfung im Produktions-Build über die API neben dem Mockup v4, hell und dunkel, iPhone-Format (Login nicht über Vite :5173).
- Alt-Daten: Mit `seed:demo` **vor** diesem Block angelegte Tage zeigen sich richtig.

**Tests**: der volle Lauf aus diesem Block; `seed:demo` gegen eine leere Entwicklungsdatenbank.

**Abnahme**: Alle Suiten grün, die Liste „Was sich nicht ändern darf“ ist einzeln abgehakt.

### Block 13: Doku

- `CLAUDE.md`: Absätze zu Tagebuch-Mahlzeiten, Hinzufügen-Menü, Ziehen, „Zuletzt hier“, Assistent, Berichte; neue Regeln `buildDayMeals` und `LogTarget`.
- `docs/sync.md`: Tabelle `diaryMeals`, deterministische Id `dm:`, neue Felder, virtuelle Mahlzeiten, Verhalten älterer App-Versionen.
- `.claude/skills/offline-sync/SKILL.md`: nur wenn eine Regel neu ist, die dort fehlt.
- `README.md`: Funktionszeile „Tagebuch“; im Abschnitt „Rückweg nach einer fehlgeschlagenen Migration“ den Unterschied zwischen additiver und nicht additiver Migration.
- Statusblock dieses Plans, Liste der nur am iPhone prüfbaren Punkte.

**Tests**: `pnpm lint` (Prettier über die Doku).

**Abnahme**: Kein Absatz in `CLAUDE.md` oder `docs/sync.md` beschreibt noch vier feste Fächer.

## Risiken

| Risiko                                                         | Wahrscheinlichkeit | Folge                                          | Gegenmaßnahme                                                                           |
| -------------------------------------------------------------- | ------------------ | ---------------------------------------------- | --------------------------------------------------------------------------------------- |
| Ein Eintrag verschwindet aus der Anzeige                       | gering             | Summe und Liste passen nicht zusammen          | Jede Zuordnung endet in einer Mahlzeit (Regel 3); Test: Summe aller Karten = Tagessumme |
| Eine Schreibstelle vergisst `diaryMeals` im Transaktionsumfang | mittel             | Eintragen schlägt fehl                         | Alle Stellen in Block 3 benannt, je ein Test pro Weg                                    |
| Alter Tag wechselt beim Ändern einer Uhrzeit die Reihenfolge   | gering             | Gewollt, einmalig je Tag                       | Rückgängig stellt die Fachreihenfolge wieder her (Entscheidung 5)                       |
| Offline doppelte Mahlzeiten                                    | gering             | Zwei Karten                                    | Bekannte Grenze, Einträge lassen sich zusammenziehen                                    |
| Eigene Namen gehen bei gleichzeitigen Einstellungen verloren   | gering             | Name fehlt in der Auswahl, Mahlzeit behält ihn | LWW je Datensatz wie alle Einstellungen, hingenommen                                    |
| Ältere PWA der zweiten Person bleibt lange aktiv               | mittel             | Höchstens vier Fächer sichtbar                 | Regeln 1 bis 3, Sync-Status „App-Update nötig“, keine Datenänderung                     |
| Rollback, neue PWA pusht `diaryMeals` an den alten Server      | gering             | Push 400, Sync steht bis zum PWA-Update        | Outbox bleibt erhalten, siehe „Rollout“                                                 |
| Reise in eine andere Zeitzone                                  | gering             | Uhrzeiten erscheinen verschoben                | `eatenAt` ist ein Zeitpunkt, Anzeige in Gerätezeit, der Tag bleibt `date`               |
| Laufschrift kostet Akku oder ruckelt                           | gering             | Unruhiger Kopf                                 | Nur `transform`, nur beim Überlauf, aus bei reduzierter Bewegung                        |
| Prompt-Änderung verschlechtert den Assistenten                 | mittel             | Falsche Mahlzeit                               | Alter Kontext bleibt getestet, Rückgängig vorhanden, iPhone-Prüfung                     |

## Rollout

Nur auf ausdrückliche Ansage des Nutzers pushen. Im Produktivsystem liegen die Daten von **zwei** echten Konten.

1. **Vor dem Deploy**: ZFS-Snapshot des App-Datasets `tank/applications/fleisch-teufel` (Zariel `plan_dataset_snapshot`, Name `vor-tagesmahlzeiten`).
   Prüfen, dass er existiert. Eine aktuelle JSON-Sicherung unter „Daten & Sync“ kann der Nutzer zusätzlich ziehen.
2. Push auf `main`, `gh run watch` bis `ci.yml` samt Job `image` grün ist.
3. Der Nutzer deployt in Dockge. Die Migration `0020` läuft beim Start.
4. **Prüfen**: `/health`, `/api/info`, im Log kein `sync records rejected`; auf einem Gerät eintragen, auf dem zweiten sehen.
5. **Ältere PWAs**: Sie laufen weiter, schreiben Einträge mit `meal` und zeigen höchstens vier Fächer. Sobald es Mahlzeiten gibt, meldet der Sync-Status
   „App-Update nötig“. Nach dem Update lädt ein voller Pull alles nach (`sync.needsUpdate`). Am Konto der zweiten Person ändert der Deploy nichts.

**Rollback**

- **Normalfall nur das Image**: In `deploy/docker-compose.yml` `image: ghcr.io/david-stefan-hermann/fleisch-teufel:sha-<zuletzt laufender Commit>` setzen und neu deployen. Die Migration ist
  additiv: Der alte Server liest und schreibt nur seine bekannten Spalten, und der Migrator wendet keine alten Dateien erneut an. **Den Snapshot dafür nicht
  zurückrollen**, sonst gehen Einträge seit dem Deploy verloren.
- Neue PWAs bekommen danach bei jedem Push 400 (`diaryMeals` ist dem alten Server unbekannt). Es geht nichts verloren, die Outbox bleibt, nach dem Update-Banner läuft
  der Sync wieder.
- Beim erneuten Ausrollen greift Regel 3 für alles, was die alte Version in der Zwischenzeit geschrieben hat.
- **Snapshot nur bei beschädigter Datenbank**: Ablauf „Restore“ im README, einschließlich Rotation der Sync-Epoche. Die Geräte laden danach alles Neuere wieder hoch.

## iPhone-Prüfliste für den Nutzer

- [ ] Leerer Tag: eine Karte, „+“ öffnet die Kamera, die Karte zeigt noch keine Uhrzeit.
- [ ] Eintragen, 10 Minuten später wieder über das „+“ der Tab-Leiste: dieselbe Mahlzeit. Nach über 30 Minuten: neue Mahlzeit mit dem nächsten Namen.
- [ ] Das „+“ einer alten Mahlzeit trägt dort ein, egal wie spät es ist.
- [ ] Die Uhrzeit steht klein über der Karte und lässt sich mit dem Daumen treffen, ohne den Kopf der Karte zu berühren.
- [ ] Tipp auf den Namen: Auswahl. Tipp auf kcal oder Pfeil: Seite der Mahlzeit.
- [ ] Eigener Name: erscheint danach auf dem zweiten Gerät in der Auswahl; Löschen in den Einstellungen, die Mahlzeit behält ihn.
- [ ] Sehr langer Name: läuft ruhig und nahtlos, mit weichen Rändern. Mit „Bewegung reduzieren“ in iOS steht er still.
- [ ] Zeit-Dialog: Rädchen drehen sich sauber, die Tastatur kommt nicht dazwischen, die Liste sortiert sich neu, Rückgängig stellt die Zeit wieder her.
- [ ] 00:30 als „Nacht auf Fr.“: Die Mahlzeit bleibt am Donnerstag ganz unten und trägt den Mond.
- [ ] Eintrag lange drücken und in eine andere Mahlzeit ziehen. Die leere Mahlzeit verschwindet, Rückgängig bringt sie zurück.
- [ ] Mahlzeit über ⋯ löschen und mit Rückgängig zurückholen.
- [ ] Foto offline aufnehmen, App schließen, online öffnen: Die Analyse landet in der Mahlzeit, die beim Aufnehmen angezeigt wurde.
- [ ] „Wie gestern“ und „Zuletzt hier“ passen zum Namen der Mahlzeit.
- [ ] Kopieren, anderen Tag öffnen, einfügen.
- [ ] Assistent: „zum Mittagessen“, „neue Mahlzeit Kuchen bei Oma“ und ein Satz ohne Mahlzeit.
- [ ] Tagesbild teilen: Uhrzeiten stehen dabei. CSV öffnen: „Uhrzeit“ ist die letzte Spalte.
- [ ] Ein Tag von vor dem Update sieht vollständig aus, steht in der gewohnten Reihenfolge, Summen stimmen.
- [ ] Zweites Gerät mit älterer App-Version: Es trägt weiter ein und zeigt den Update-Hinweis.

## Ablauf für Opus 5.5

1. **Lesen, in dieser Reihenfolge**: `CLAUDE.md`, `.claude/skills/offline-sync/SKILL.md`, `docs/sync.md`, dieser Plan (vor allem „Entscheidungen“, „Annahmen“,
   „Datenmodell“), das Mockup v4 im Browser oder per Playwright-Screenshot. Vor Block 10 zusätzlich den Skill `claude-api`.
2. **Vorbedingung prüfen** (`git status -sb`). Liegt die Android-Änderung noch offen, nachfragen.
3. **Blöcke 1 bis 13 in dieser Reihenfolge**, ein Commit je Block, englische Nachricht mit der Zeile
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Plan und Mockup gehen mit dem ersten Commit hinein.
4. **Je Block**: `pnpm lint`, `pnpm typecheck`, `pnpm test`. Zusätzlich `pnpm e2e` nach den Blöcken 4, 6, 8, 9, 10 und 12. Ein Block ist erst fertig, wenn alles
   grün ist.
5. **Dateien einzeln zum Commit hinzufügen, nie `git add -A` oder `git add .`.** Die lokal über `.git/info/exclude`
   ausgeschlossenen Dateien lassen `pnpm lint` lokal warnen und dürfen **nie** committet werden.
   Sie sind der einzige hinnehmbare Hinweis von `prettier --check`.
6. **Abweichungen im Statusblock melden** statt still zu entscheiden. Passt eine Annahme nicht zum Code oder fehlt eine Entscheidung, nachfragen.
7. Keine Halbgeviert- oder Geviertstriche. Keine Erklärtexte im UI. Keine Gesundheitsdetails im Repository.
8. **Nicht pushen**, bis der Nutzer es ausdrücklich sagt. Danach gilt der Abschnitt „Rollout“.
