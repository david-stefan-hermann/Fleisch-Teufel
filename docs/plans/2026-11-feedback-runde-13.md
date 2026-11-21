# Feedback-Runde 13: neue Mahlzeit per Ziehen, alte Notiz beim Assistenten (Planungsgrundlage)

Zusammenfassung der Wünsche vom 2026-11-21 mit den Entscheidungen des Nutzers und den Fundstellen im Code. Grundlage
für den Implementierungsplan, der in einer eigenen Sitzung entsteht; hier ist nichts umgesetzt. Stand des Codes:
`10c8066` (main). Runde 12 wird parallel umgesetzt (`2026-11-feedback-runde-12-umsetzung.md`); vor dem Planen
`git fetch` + `git status -sb` und `git log` prüfen, ob die genannten Stellen sich geändert haben.

Regeln aus `CLAUDE.md`: keine Erklärtexte im UI, keine Gedankenstriche, deutsche UI-Texte, englischer Code. Synced
data: vor Punkt 1 den Skill `offline-sync` und `docs/sync.md` lesen.

## Übersicht

| Nr. | Thema                                                   | Art     | Stand                    |
| --- | ------------------------------------------------------- | ------- | ------------------------ |
| 1   | Eintrag unter die letzte Mahlzeit ziehen: neue Mahlzeit | Feature | entschieden              |
| 2   | Assistent öffnet Fotoseite mit alter Notiz              | Bug     | Ursache vermutet, Lösung |

## 1. Eintrag unter die letzte Mahlzeit ziehen legt eine neue Mahlzeit an

Wunsch: Beim Verschieben im Tagebuch soll man einen Eintrag (oder eine Gruppe) auch unter die letzte Mahlzeit ziehen
können; dort abgelegt entsteht direkt eine neue Mahlzeit mit diesem Eintrag.

Entscheidungen des Nutzers:

- Während eines Zuges erscheint unter der letzten Mahlzeit ein Ablageziel (nur dann sichtbar, z. B. an der Stelle von
  „Mahlzeit hinzufügen“). Ablegen dort legt eine neue Mahlzeit an und verschiebt den Eintrag hinein, mit
  Rückgängig-Toast wie beim normalen Verschieben.
- Name: der nächste passende Name (`nextMealName`: erster Standardname, den der Tag noch nicht hat, sonst „Weitere
  Mahlzeit“).
- Uhrzeit: wann der gezogene Eintrag angelegt wurde (`loggedAt`). Bei einer Gruppe in der Planung festlegen
  (Vorschlag: der jüngste Eintrag der Gruppe). Mahlzeiten sortieren nach Uhrzeit; die neue Mahlzeit kann also über
  anderen landen, obwohl sie unten abgelegt wurde. Das ist so gewollt.
- Hat die Ausgangsmahlzeit nur diesen einen Eintrag, bleibt sie sichtbar, solange der Zug läuft (heute prüfen, ob sie
  während des Zuges verschwindet oder springt). Wird wirklich abgelegt, verschwindet sie danach wie heute, weil sie
  leer ist. Das Ergebnis (gleiche Uhrzeit, nächster Name) ist erlaubt und wird nicht verhindert.
- Nicht ändern: „Mahlzeit hinzufügen“ öffnet weiter die Fotoseite für eine neue Mahlzeit (`AddMealLink`,
  `/photo?dm=new`). Es gibt keine leeren Mahlzeiten; eine Mahlzeit ist sichtbar, solange sie Einträge (oder eine
  wartende Analyse) hat, und wird nur über „Mahlzeit löschen“ oder durch Leerwerden entfernt.

Stand im Code:

- `features/diary/DiaryDnd.tsx`: Ablageziele sind nur vorhandene Mahlzeiten (`useDroppable`, `id: meal-<id>`,
  `data: { meal }`); `onDragEnd` bricht ohne Ziel ab, sonst `moveEntriesToDiaryMeal(db, row.ids, target)` und Toast
  „… zu … verschoben“ mit `restoreEntryMeals`. Ansagen für Screenreader auf Deutsch (`announcements`).
- `db/diaryMeals.ts`: `moveEntriesToDiaryMeal` schreibt den Datensatz einer virtuellen Quelle oder eines virtuellen
  Ziels zuerst (Name und Zeit bleiben); `prepareMealTarget(db, { date, meal, dm: 'new' })` vergibt id (uuidv7), Name
  und Zeit einer neuen Mahlzeit, `applyLogTarget` schreibt sie in der Transaktion des Eintragens.
- `features/diary/MealCard.tsx`: `AddMealLink` (Ende der Mahlzeitenliste), `MealChoice['next']` liefert Name und
  `slot` der nächsten Mahlzeit.
- `foodEntries.meal` (Index 0 bis 3, `slotForNewMeal`) wird für ältere App-Versionen weiter geschrieben.

Hinweise für die Planung:

- Neue Mahlzeit und Verschieben in einer Dexie-Transaktion (z. B. `moveEntriesToNewDiaryMeal` neben
  `moveEntriesToDiaryMeal`, Uhrzeit aus den gezogenen Einträgen, Name aus `nextMealName` des Tages). Festlegen, ob
  eine Ausgangsmahlzeit, die durch den Zug leer wird, beim Namen noch als vorhanden zählt (einziger Eintrag des
  Frühstücks nach unten gezogen: heißt die neue Mahlzeit dann „Mittagessen“ oder wieder „Frühstück“). Der Nutzer
  erwartet „nächster Name“, also zählt sie als vorhanden.
- Rückgängig stellt die alte Zuordnung her (`restoreEntryMeals`); die neue Mahlzeit verschwindet dann von selbst,
  weil sie leer ist (Datensatz bleibt wie bei anderen leer gewordenen Mahlzeiten).
- Toast: „… in neue Mahlzeit „<Name>“ verschoben“ o. ä.
- Ablageziel mit Rahmen wie die anderen Ziele (`isOver`), Ansage für Screenreader („Neue Mahlzeit“).
- Tests: Unit-Test der Schreibfunktion (Name, Zeit, `slot`, Rückgängig), E2E: Eintrag per langem Druck unter die
  letzte Mahlzeit ziehen (Muster in `day-meals.spec.ts`), Fall „einziger Eintrag der Quelle“.

## 2. Bug: Assistent öffnet die Fotoseite mit einer alten Notiz

Meldung: Der Nutzer sagte dem Assistenten, er habe Fotos. Der öffnete die Fotoseite, und im Hinweisfeld stand eine
Notiz von etwa einer Woche zuvor.

Wahrscheinliche Ursache (Code gelesen, nicht reproduziert; der Server-Verlauf ließ sich nicht lesen):

- Der Weg zur Fotoseite ist frisch: `storeAssistantHint(op.hint)` (`features/assistant/hint.ts`) gilt 10 Minuten,
  `PreviewStep` liest ihn einmal und löscht ihn. Der Text stammt vom Modell (Werkzeug `open_camera`, Pflichtfeld
  `hint`; Prompt `apps/api/src/assistant/prompt.ts`: „call `open_camera` with what they said as the hint“).
- Das Modell bekommt als „Recent utterances“ die letzten drei Äußerungen **ohne Altersgrenze**
  (`features/assistant/queue.ts`, `recent: before.slice(-3)`), und ihre Zeit nur als Uhrzeit
  (`at: localStamp(t.createdAt).slice(11)`), **ohne Datum**. Eine Äußerung von vor einer Woche wirkt wie eine von heute
  früher; bei einem knappen „Ich habe Fotos“ übernimmt das Modell die alte Beschreibung als `hint`.
- Gleiches Muster bei `previousTarget` (letzte Äußerung beliebigen Alters) und `openQuestion`; der Prompt erlaubt
  Folgeäußerungen „also when that was yesterday“.

Lösung (Vorschlag):

- `recent`, `previousTarget` (und eine offene Frage, sofern sinnvoll) nur aus einem kurzen Zeitfenster (z. B. die
  letzten paar Stunden, höchstens bis gestern, passend zur Folgeäußerungs-Regel), mit Datum und Uhrzeit.
- Im Prompt: der `hint` von `open_camera` stammt nur aus der aktuellen Äußerung; ohne Beschreibung leer.
- Tests: Kontext mit einer Äußerung von vor einer Woche enthält sie nicht (Web, `queue.ts`); Prompt-Text zeigt Datum.
- Bestätigung vor dem Umsetzen (optional): Verlauf unter Mehr → Assistent (`/settings/assistant`) der betreffenden
  Äußerung; steht dort der alte Text als Hinweis, ist die Ursache bestätigt.
