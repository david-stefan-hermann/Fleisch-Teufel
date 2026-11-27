# Ideen-Sammlung (ab 2026-11-21, nach Runde 13)

Sammelliste für die nächste Runde. Nur sammeln, nichts umsetzen. Je Punkt: Wunsch, Entscheidungen, offene Fragen,
Fundstellen im Code. Runden 12 und 13 sind übergeben (`2026-11-feedback-runde-12.md`, `-13.md`).

## 1. Neue Mahlzeit im Kopf der Eintragen-Seiten: eigenen Namen wählen

Wunsch (Nutzer, 2026-11-21): Beim Eintragen steht oben rechts, in welche Mahlzeit es geht. Wählt man dort „+ neue
Mahlzeit“, gibt es nur den vorgegebenen Namen. Man soll dort auch selbst einen Namen schreiben können.

Stand:

- `components/HeaderMealPicker.tsx` (Kopf von Fotoseite, Formular, Suche, Barcode, Lebensmittelseite): Dropdown mit
  den Mahlzeiten des Tages und einem Eintrag „+ <Name>“ für die neue Mahlzeit (`mealOptions` in `lib/meals.ts`, Name
  aus `nextMealName`). Die Auswahl landet als `dm`/`meal` in der URL (`replace`); einen Namen trägt die URL nicht.
- Der Name einer neuen Mahlzeit wird erst beim Schreiben vergeben (`prepareMealTarget` mit `dm: 'new'`,
  `db/diaryMeals.ts`; ein begonnener Ablauf merkt sich die Mahlzeit in `ft.logStart`, `prepareFlowTarget` in
  `lib/logFlow.ts`).
- Im Tagebuch gibt es das Namensmenü schon: `features/diary/MealNameMenu.tsx` (Standardnamen, eigene Namen aus
  `settings.customMealNames`, „Eigener Name“ mit `NameDialog`, `chooseMealName` nimmt einen neuen Namen in die
  Auswahl auf, sonst Toast „Die Auswahl ist voll …“).

Offene Fragen (an den Nutzer):

- Nur „Eigener Name“ zum Tippen, oder dieselbe Auswahl wie im Tagebuch (Standardnamen, eigene Namen, „Eigener
  Name“)?
- Soll ein getippter Name wie im Tagebuch in die Auswahl der eigenen Namen aufgenommen werden?

Hinweise für die Planung: Der gewählte Name muss bis zum Schreiben mitreisen (Suchparameter neben `dm=new`, z. B.
`dmName`, oder im Ablauf-Speicher `ft.logStart`) und von allen Schritten eines Ablaufs (Fotoseite, Formular, Suche,
Review, verzögerte Analyse `logDeferred`) beachtet werden; `prepareMealTarget` nimmt ihn statt `nextMealName`. Der
Kopf zeigt danach den gewählten Namen mit „Neu“.

## 2. Assistent: der im Tagebuch gezeigte Tag als Standard

Status: umgesetzt am 2026-11-27 (Regeln „The day“ in `apps/api/src/assistant/prompt.ts`, gezeigter Tag als dritter
Eintrag in `days` mit `closed`, `today` im Kontext; Tests in `apps/api/test/assistant.test.ts` und
`apps/web/test/assistant-queue.test.ts`). Der Abschnitt „Stand“ beschreibt den Zustand davor.

Wunsch (Nutzer, Sprachnachricht 2026-11-27): Nach Mitternacht trägt er oft noch den Vortag nach. Steht das Tagebuch
auf Donnerstag und er sagt dem Assistenten „trag mir noch M&M's und eine Mate ein“ (ohne „heute“ oder „gestern“),
landet es am Freitag, weil es nach 0 Uhr ist. Der Tag, der oben gewählt ist, soll der Standard sein.

Stand:

- Das Gerät schickt den gezeigten Tag schon mit (`shownDate` in `features/assistant/controller.ts`, `contextFor` in
  `queue.ts`), und der Prompt nennt ihn dem Modell („The diary shows …“, `apps/api/src/assistant/prompt.ts`,
  `userMessage`). Eine Regel, was daraus folgt, gibt es nicht: Das Datum jeder Operation wählt das Modell, und ohne
  Tagesangabe nimmt es heute.
- Der Kontext enthält nur das Tagebuch von heute und gestern (`days`); ein weiter zurückliegender gezeigter Tag
  fehlt dem Modell.
- Ohne genannte Mahlzeit wählt das Gerät sie mit `pickMeal` (`execute.ts`) nach den Regeln des „+“
  (`logTargetFor`): Auf einem anderen Tag als heute zählt der jüngste Eintrag, der für diesen Tag gemacht wurde.

Entscheidungen (Nutzer, 2026-11-27):

- „Trage heute … ein“ nimmt den echten aktuellen Tag (nach der Tagesgrenze aus Punkt 3), egal welcher Tag gezeigt
  wird.
- „Trage hier … ein“ auf einem älteren, nicht abgeschlossenen Tag trägt auf dem gezeigten Tag ein.
- Ist der gezeigte Tag abgeschlossen, fragt der Assistent vorher, ob dort trotzdem eingetragen werden darf.

- Eine Äußerung ganz ohne Tagesangabe (weder „heute“ noch „hier“) auf einem älteren gezeigten Tag trägt auf dem
  gezeigten Tag ein.
- Nennt die Äußerung den Tag ausdrücklich („gestern Abend …“), kommt keine Rückfrage, auch wenn der Tag
  abgeschlossen ist.
- Annahme bei der Umsetzung (2026-11-27, vom Nutzer noch nicht bestätigt): Folgesätze („und noch …“) bleiben wie
  bisher beim Tag der vorigen Äußerung, auch ohne Rückfrage, wenn dieser Tag abgeschlossen ist.
- Annahme bei der Umsetzung: Die Rückfrage gibt es nur für einen älteren gezeigten Tag. Ein abgeschlossenes Heute
  wird ohne Frage beschrieben. Nach „Nein“ antwortet der Assistent „Nicht eingetragen.“.

Hinweise für die Planung: Regeln im Prompt (ein genannter Tag und „heute“ gehen vor, „hier“ und der gezeigte Tag
danach), der gezeigte Tag als dritter Eintrag in `days` mit dem Merkmal „abgeschlossen“ (`completedAt` der Notiz),
die Rückfrage als Frage-Blase mit zwei Antworten, Testfälle im Prompt-Testsatz. Der Toast sollte den Tag nennen,
wenn er nicht heute ist.

## 3. Tagesgrenze: der Tag wechselt um 5 Uhr statt um 0 Uhr

Status: umgesetzt am 2026-11-27 (`settings.dayStartHour`, Migration `0022_day-start`, `today(now, dayStartHour)` in
shared, `apps/web/src/lib/day.ts`, Mehr → „Tagesbeginn“, `appDay` in `apps/api/src/push.ts`). Der Abschnitt „Stand“
beschreibt den Zustand davor.

Wunsch (Nutzer, 2026-11-27): Festlegen, wann „heute“ endet. Der Tag soll erst um 5 Uhr morgens wechseln, für die
ganze App und den Assistenten. Einstellbar, Standard 5 Uhr.

Stand:

- „Heute“ ist überall das Kalenderdatum: `today(now)` in `packages/shared/src/dates.ts`, in der App über
  `useToday`, im Assistenten `todayOf(turn.createdAt)` (`features/assistant/queue.ts`) und „Now: …“ im Prompt.
- Für die Zeit nach Mitternacht gibt es heute Einzelregeln: `logTargetFor` (`lib/meals.ts`: der Eintrag vor
  Mitternacht zählt für gestern, `DayNote`), „Nacht auf <Tag>“ im `MealTimeDialog` (00:00 bis 04:59, Mond), die
  Zuordnung der virtuellen Mahlzeiten nach `loggedAt` in `buildDayMeals`.
- Der Server rechnet an einigen Stellen selbst mit dem Datum: Schritte-Import (heute und sechs Tage davor),
  Erinnerung (Push, „heute nichts eingetragen“), Assistent (`date lies in the future`).

Entscheidungen (Nutzer, 2026-11-27):

- Die Einstellung gilt pro Konto (synchronisiert, auf allen Geräten und auf dem Server).
- Schritte bleiben am Kalendertag, so wie Apple Health sie führt.
- Ein Gewicht vor der Tagesgrenze (z. B. um 2 Uhr nachts) zählt zum Vortag.
- Annahme bei der Umsetzung (2026-11-27, vom Nutzer noch nicht bestätigt): Eine Mahlzeit um 01:30 landet von selbst
  auf dem Vortag als „Nacht auf <Tag>“.
- Annahme bei der Umsetzung: wählbar sind volle Stunden von 0 bis 8 Uhr. Bei 0 Uhr bleibt „Nacht auf“ bis 04:59
  wählbar wie bisher.

Hinweise für die Planung: eine Funktion in shared (`today(now, dayStartHour)`), `settings.dayStartHour` (null = 5),
alle Aufrufer von `today()` und `useToday` darüber; die Mitternachtsregel in `logTargetFor` und der Bereich von
„Nacht auf“ folgen der Einstellung statt fester Zeiten; der Wechsel des Tages in der laufenden App (Timer in
`useToday`) feuert zur Grenze; Assistent-Prompt nennt Datum und Uhrzeit nach der Grenze („Now“ bleibt die echte
Uhrzeit, „Today“ der Tag der App). Ältere App-Versionen rechnen weiter mit 0 Uhr.
