# Feedback-Runde 10: Tagesanteil-Balken, Makro-Balken im Tagebuch, vergangene Tage abschließen, Tag teilen

Ablage im Repo bei Umsetzung: `docs/plans/2026-11-feedback-runde-10.md` (Kopie dieser Datei, kommt mit dem ersten
Code-Commit mit). Mockup: `docs/plans/2026-11-feedback-runde-10-mockup.html` (Schritt 0, Opus baut, Nutzer bestätigt).

## Status (2026-11-03)

Geplant von Fable. Mockup bestätigt, alle Blöcke umgesetzt (siehe unten).

Mockup v1 gebaut (2026-11-03, Opus): A bis D, hell/dunkel, B1/B2/B3 umschaltbar, Teilen-Dialog klickbar.
Entschieden in der Mockup-Runde (2026-11-03): **B1** (Punkt + Buchstabe, wie die Vorgabe im Mockup), Teilen-Knopf links
neben Zwischenablage und Wolke, Abspann bleibt, die Zeilen im Bild zeigen die Makros wie unter Aussehen eingestellt.
Änderung zu C: der Link „Alle vergangenen Tage abschließen“ ist **grau** (`text-muted-foreground`, unterstrichen) und
**zentriert** statt rot und linksbündig. Danach „los“ für alle Blöcke ohne weitere Absprache.

**Umgesetzt (2026-11-03, Opus 5.5)**, ein Commit je Block (1, 3, 2, 4, 5), nicht gepusht. Lint, Typecheck, alle
Vitest-Suiten und Chromium-E2E grün. Abweichungen und Hinweise:

- WebKit-E2E (`ios-layout.spec.ts`) lief nicht: der Playwright-WebKit-Browser ist im Container nicht installiert.
- Block 1: zusätzlich der Test des eigenen Lebensmittel-Editors (`bar.children`) auf `[data-part=fill]` umgestellt.
- Block 3: kein Komponententest (optional im Plan); die Logik ist in `test/write.test.ts` abgedeckt.
- Block 4: `collectShareData` bekommt Einträge, Summary, Trainings, Notiz und Einstellungen von der Tagebuchseite
  (die hat sie schon) und lädt nur Meal-Namen und Fotos selbst. Fotos als Data-URLs statt Objekt-URLs (nichts
  freizugeben, der Rasterer liest sie sicher). Zusätzlich: antwortet iOS nach dem Rastern mit `NotAllowedError`
  (Teilen braucht einen frischen Tipp), zeigt der Dialog „Bild teilen“; Teilen über `shareImage`
  (`share/shareDay.tsx`), `shareOrDownloadFile` bleibt für CSV und JSON. Ist „Essen“ abgewählt, enthält das Bild
  nur Datum, gewählte Teile und Abspann. `modern-screenshot` hat in Chromium funktioniert (Inter-Schrift und Logo
  im PNG); der Test auf dem iPhone (Teilen-Blatt, Fotos im Bild, dunkles Thema) ist offen.
- Ein Durchlauf von `pnpm test` hatte einmal einen Timeout in `week-strip.test.tsx` (paralleler API-Lauf), einzeln
  und im zweiten Lauf grün.

## Context

Feedback des Nutzers vom 2026-11-03 (zwei Screenshots: „Eintrag bearbeiten“ mit „Nährwerte dieser Menge“ im Modus
„Anteil am Tagesziel“, und das Tagebuch von gestern), vier Themen:

1. **Tagesanteil-Balken.** Im Modus „Anteil am Tagesziel“ (Tipp auf die kcal-Zahl, `NutrientBreakdown` Variante
   `item`) zeigt der gestapelte Makro-Balken heute immer 100 % Breite. Er soll nur den Teil füllen, den die
   Mahlzeit am Tagesziel ausmacht (695 / 1.500 kcal = 46 %); die Aufteilung P/K/F innerhalb des gefüllten Teils
   bleibt prozentual wie heute, der Rest bleibt grau.
2. **Makros farbig im Tagebuch.** Die Zeile „P 47 · K 0 · F 3“ unter der kcal-Zahl jeder Tagebuchzeile soll farbig
   unterstrichen sein und zusammen einen kleinen Balken der Energieverteilung bilden. Erst als Mockup; gefällt es,
   wird es eine **alternative Darstellung unter Mehr → Aussehen** (Standard bleibt die heutige Textzeile).
3. **Alle vergangenen Tage abschließen.** Unter „Tag abschließen“ (Notiz-Karte im Tagebuch) ein Textlink, der nur
   erscheint, wenn mindestens ein früherer Tag offen ist, und diese Tage auf einmal abschließt.
4. **Tag teilen.** Ein Teilen-Button pro Tag im Tagebuch öffnet ein Popup mit drei Kästchen: Essen (angehakt),
   Training (nicht angehakt), Notiz (nicht angehakt). Daraus entsteht ein langes Bild wie ein Screenshot der
   Tagesübersicht ohne Unnötiges: statt Header und Kalender das Datum mit Wochentag, dann die Kalorienübersicht
   (ohne den Nährstoff-Button), dann alle nicht leeren Mahlzeiten (ohne Vorschläge), dann Training (wenn angehakt,
   ohne Vorschläge), dann die Notiz (wenn angehakt). Geteilt über den iOS-Standarddialog, Dateiname mit Datum.

### Entschieden (mit dem Nutzer, 2026-11-03)

- Der skalierte Balken gilt **nur im Modus „Anteil am Tagesziel“** (Variante `item`). Kalorienkarte im Tagebuch und
  Berichte („Ø pro Tag“, Variante `day`) behalten den vollen Balken.
- **„Offen“** = ein Tag vor dem angezeigten Tag mit mindestens einem nicht gelöschten Essens-Eintrag und ohne
  „Tag abgeschlossen“ (`completedAt`), unabhängig von der Zahl der Mahlzeiten. Tage ohne Einträge werden nie
  abgeschlossen.
- Sammel-Abschließen **sofort, mit Rückgängig-Toast** („N Tage abgeschlossen“, „Rückgängig“ öffnet genau diese Tage
  wieder). Kein Dialog.
- Der Link steht **nur im Tagebuch unter der Notiz** (unter dem Button „Tag abschließen“ bzw. unter der Zeile
  „Tag abgeschlossen um …“), nicht auf der Abschluss-Seite. „Vergangen“ = vor dem angezeigten Tag.
- Mockups zuerst; der Nutzer bestätigt, dann wird umgesetzt. Die Makro-Darstellung wird nur bei Gefallen zur
  Einstellung.

### Annahmen (im Plan festgelegt, bei Widerspruch melden statt still zu entscheiden)

- Thema 1: über dem Tagesziel ist der Balken voll (wie heute); nur das aria-Label nennt den echten Anteil
  („118 % des Tagesziels“). Ohne kcal-Ziel (0) bleibt der Balken voll.
- Thema 2: Standard der neuen Einstellung ist die heutige Textzeile (`numbers`); der Balken ist Opt-in. Die
  Einstellung ist pro Gerät (`localStorage`, wie Thema und Icon). Die Mockup-Variante mit **Punkten** vor den Zahlen
  statt farbigem Text ist die Empfehlung: `text-carbs` (gelb-orange) hat auf der hellen Karte bei 11 px etwa 2:1
  Kontrast; `CLAUDE.md` sagt „macro colors only appear in dots and bars“. Farbiger Text nur, wenn der Nutzer ihn im
  Mockup ausdrücklich will (dann vorher mit dem dataviz-Palettenprüfer hell/dunkel prüfen).
- Thema 3: der Link zeigt keine Zahl („Alle vergangenen Tage abschließen“, feste Wortwahl). Beim Antippen werden
  Tage, die inzwischen ein anderes Gerät abgeschlossen hat, übersprungen. Folge für Berichte, die der Nutzer kennt:
  Ein-Snack-Tage zählen danach als vollständig und senken Ø kcal; das Rückgängig fängt den Sofort-Fall.
- Thema 4:
  - Der Teilen-Button sitzt im **Tagebuch-Header** links neben `ClipboardMenu`/Sync-Wolke (lucide `Share`, das
    iOS-Kästchen mit Pfeil; `aria-label="Tag teilen"`). Das Mockup zeigt ihn dort.
  - Das Bild folgt dem **aktuellen Thema** (hell/dunkel) des Geräts, Breite 390 px (iPhone), Rasterung 2 bis 3 fach.
  - Die Kalorienkarte erscheint im Bild immer im **zugeklappten Zustand** (Ring, Zeilen Ziel/Essen/Training/Übrig,
    `MacroBars`), ohne den Button „Nährstoffe“/„Weniger“ und ohne „Woher kommen die Zielwerte?“.
  - Mahlzeiten: Gruppen (Meals, KI-Analysen) **zugeklappt** mit Foto, Name, „N Zutaten“ und Summe; Einzelzeilen wie
    im Tagebuch. Keine Zeilen wartender Analysen (`PendingAnalysisRow`), keine Vorschläge, keine Buttons, kein
    „Essen eintragen“. Leere Mahlzeiten fehlen ganz. Ist nichts eingetragen, besteht „Essen“ nur aus der
    Kalorienkarte.
  - Training: nur die Zeilen (Name, Minuten · Intensität · Notiz, +kcal) und die Summe im Titel; Kästchen
    deaktiviert mit Hinweis „Kein Training eingetragen“, wenn der Tag keins hat. Notiz: Abschnitt „Notiz“ mit dem
    Text (Zeilenumbrüche erhalten); Kästchen deaktiviert mit „Keine Notiz“, wenn leer.
  - Unten ein kleiner **Abspann** mit App-Logo und „Fleisch-Teufel“ (Mockup zeigt ihn; der Nutzer kann ihn streichen).
  - Dateiname `fleisch-teufel_tagebuch_<YYYY-MM-DD>.png` (Muster der CSV- und Backup-Dateien). PNG (Text bleibt
    scharf). Ohne Web Share mit Dateien (Desktop-Browser) wird die Datei heruntergeladen, wie beim CSV-Export.
  - Die Auswahl der Kästchen wird nicht gemerkt (Vorgaben jedes Mal wie vom Nutzer genannt).
  - Bild-Erzeugung mit der Bibliothek **`modern-screenshot`** (DOM zu PNG über SVG `foreignObject`, Fork von
    `html-to-image` mit Safari-Korrekturen, `domToBlob`). Fällt sie auf iOS durch, Ersatz `html-to-image`; beides
    im Statusblock vermerken. Kein Server-Rendering (offline-first).

## Schritt 0: Mockup (Opus baut, Nutzer bestätigt)

Eine HTML-Datei `docs/plans/2026-11-feedback-runde-10-mockup.html` nach dem Muster von
`docs/plans/2026-10-kcal-ueberschreitung-mockup.html` (Telefonrahmen 375 px, Schalter Hell/Dunkel, Tokens aus
`apps/web/src/index.css` kopiert inklusive `--protein`, `--carbs`, `--fat`, `--exercise`, `--over`, `--good-text`,
`--bar-neutral`; Systemschrift; `.note.new` „Neu gegenüber vX“ ab v2; Kasten „Entschieden“ mit den Punkten oben).
Nur diese eine Datei, kein App-Code. Daten aus den Screenshots des Nutzers (Abendessen 967 kcal: White Tiger Garnelen
211, Hühner Frikassee 695, Oatly 61; Tagesziel 1.500 kcal, P 131 / K 150 / F 42 g).

**A. Tagesanteil-Balken** (Thema 1): zwei Telefone „Heute“ und „Neu“ mit der Karte „Nährwerte dieser Menge“ im
Modus „Anteil am Tagesziel“ (695 / 1.500 kcal). Neu: der P/K/F-Balken füllt 46 % der Breite (runder rechter Rand),
Rest grau; Makro-Zeilen wie heute. Dazu ein drittes Telefon mit einer Mahlzeit über dem Ziel (voller Balken).

**B. Makros im Tagebuch** (Thema 2): eine Abendessen-Karte je Variante, Einzelzeilen und eine zugeklappte Gruppe:

- B1 (Empfehlung): Zahlen bleiben grau, davor je ein Punkt in Makrofarbe („● 31 ● 55 ● 38“ mit P/K/F als Buchstabe
  oder nur Punkt), darunter ein 4 px hoher Balken in Textbreite, Segmente nach Energieanteil 4/4/9.
- B2: Buchstaben und Zahlen in Makrofarbe, gleicher Balken darunter.
- B3: Textzeile unverändert, nur der Balken darunter.
- Daneben die Seite „Aussehen“ mit neuem Abschnitt „Tagebuch“ (Umschalter „Zahlen“ / „Mit Balken“, kleine Vorschau
  einer Zeile, Hinweistext). Hell und dunkel per Schalter.

**C. Alle vergangenen Tage abschließen** (Thema 3): die Notiz-Karte zweimal (Tag offen: Button „Tag abschließen“;
Tag abgeschlossen: grüne Zeile) jeweils mit dem Textlink darunter (Stil wie „Wiederholen“ / „Schnell schätzen“:
`text-primary underline underline-offset-2`, 44 px Tippfläche), und der Toast „3 Tage abgeschlossen · Rückgängig“
unten.

**D. Tag teilen** (Thema 4):

- Tagebuch-Header mit dem Teilen-Symbol links neben Zwischenablage und Wolke.
- Dialog „Tag teilen“: Beschreibung „Als Bild, wie ein Screenshot des Tages.“, drei Kästchen-Zeilen (Essen
  angehakt; Training; Notiz), deaktivierte Zeile mit Hinweis als Beispiel, Buttons „Abbrechen“ / „Teilen“ (Symbol
  `Share`).
- Das erzeugte Bild als langer Rahmen (390 px breit, ohne Telefonecken, mit Hintergrundfarbe): Überschrift
  „Montag, 2. November 2026“, Kalorienkarte zugeklappt ohne Button, Mahlzeiten Abendessen (3 Zeilen) und Snacks
  weggelassen, Training mit zwei Zeilen, Notiz, Abspann mit Logo. Zweimal: nur Essen; Essen + Training + Notiz.
  Hell und dunkel.

Der Nutzer antwortet mit Änderungswünschen (Opus baut v2, v3 …) oder einem kurzen „los“. Entscheidungen aus der
Mockup-Runde kommen in den Statusblock dieses Plans, bevor Block 1 beginnt.

## Umsetzung

Reihenfolge nach dem OK: Block 1, 3, 2, 4, 5 (Block 2 wartet auf die Variantenwahl aus B, Block 4 ist der
größte). Je Block ein Commit.

### Block 1: Tagesanteil-Balken (`components/NutrientBreakdown.tsx`)

- `EnergySplitBar` (Zeilen 262 bis 290) bekommt `fill?: number` (0..1, Standard 1, mehr wird gekappt). Im Balken
  immer ein Wrapper `<div data-part="fill" className="flex h-full overflow-hidden rounded-full" style={{ width:
part * 100 % }}>`, darin die drei Segmente mit ihren unveränderten `share`-Breiten. Bei `fill = 1` sieht es aus wie
  heute (Variante `day` und normaler `item`-Modus unverändert).
- aria-Label: ohne `fill` wie heute „Energieverteilung: Protein 23 %, …“; mit `fill` „Energieverteilung, 36 % des
  Tagesziels: Protein 23 %, …“ (ungekappter Wert, `fmtPercent`; NBSP vor %).
- Aufruf (Zeile 126): `const fill = dayMode && targets.kcal > 0 ? b.kcal / targets.kcal : 1;`
  `<EnergySplitBar breakdown={b} fill={fill} />`. Doc-Kommentar der Komponente (Zeilen 61 bis 66) ergänzen.
- Tests `apps/web/test/components.test.tsx`: die drei Assertions, die `bar.children` lesen (ein Makro = ganzer
  Balken, leere Map, Toggle-Test Zeilen 466 bis 493), auf `[data-part=fill]` umstellen. Im Toggle-Test ersetzt
  „The energy split bar stays“: Fill-Breite 620 / 1.700 = 36,47 %, Segmente 23,14 / 39,67 / 37,19 % (140 / 240 /
  225 von 605 kcal), Label `/^Energieverteilung, 36 % des Tagesziels/`; nach dem zweiten Tipp wieder 100 %
  und altes Label. Neu: Variante `day` skaliert nie (Breite `100%`, altes Label); Mahlzeit über dem Ziel (2.000 von
  1.700) hat Breite `100%` und „118 % des Tagesziels“ im Label.

### Block 2: Makros mit Balken im Tagebuch, Einstellung unter Aussehen (nach der Variantenwahl aus B)

- `lib/appearance.ts`: `export type DiaryMacrosPref = 'numbers' | 'bar'`, Schlüssel `ft.diaryMacros`, Feld
  `diaryMacros` in `Appearance`, `resolveAppearance(theme, icon, systemDark, diaryMacros = 'numbers')` (vierter,
  optionaler Parameter, damit die fünf Aufrufe in `test/lib.test.ts` stehen bleiben), Modulvariable, Lesen in
  `startAppearance`, `setDiaryMacrosPref(next)` (Standard entfernt den Schlüssel wie bei Thema und Icon). `apply()`
  und `public/theme-init.js` bleiben unberührt (nichts davon wirkt vor dem ersten Paint). Modul-Doc um einen dritten
  Punkt ergänzen.
- Neue Datei `features/diary/MacroSummary.tsx`: `MacroSummary({ nutrients, variant, className })`, die rechte
  Spalte einer Tagebuchzeile. `numbers` = exakt die heutige Zeile; `bar` = die Darstellung aus dem bestätigten Mockup
  (B1: Punkte `size-1.5 rounded-full` in `MACRO_BG[k]` vor den Zahlen, Text bleibt `text-muted-foreground`; darunter
  `<div data-part="split" aria-hidden className="mt-0.5 flex h-1 w-full overflow-hidden rounded-full bg-muted">`
  mit drei Segmenten `MACRO_BG[k]` in Breite `energyBreakdown(nutrients).macros[k].share * 100 %`). `w-full` im
  shrink-to-fit-Container ergibt genau die Textbreite. `aria-hidden` mit Absicht: der Text nennt P/K/F schon.
- `features/diary/MealCard.tsx`: die private `NutrientSummary` (Zeilen 369 bis 379) wird zu
  `const { diaryMacros } = useAppearance(); return <MacroSummary nutrients={nutrients} variant={diaryMacros} />`.
  Damit folgen `EntryRow`, `GroupRow`, die aufgeklappten Zutaten und `/diary-meal` (`DiaryRows`) ohne Prop-Durchreichen.
  `PendingAnalysisRow` bleibt (zeigt `NO_VALUE`).
- `features/more/AppearancePage.tsx`: neuer `Section title="Tagebuch"` zwischen „Darstellung“ und „App-Icon“
  (die lange iOS-Notiz des Icon-Abschnitts soll nicht dazwischen stehen): `ToggleGroup type="single"
variant="outline"` mit „Zahlen“ / „Mit Balken“ (`h-12 flex-1`, `aria-label="Makros in den Tagebuchzeilen"`), eine
  Vorschau (`MacroSummary` mit festen Werten in einem `rounded-xl bg-muted`-Kasten, rechtsbündig) und der Hinweis
  „Protein, Kohlenhydrate und Fett jeder Zeile als Zahlen oder farbig mit einem Balken der Energieverteilung.“
- `features/more/MorePage.tsx` Zeile 116, Hinweis der Aussehen-Zeile: nur bei Abweichung anhängen
  (`… · Tagebuch mit Balken`), damit `e2e/appearance.spec.ts:20` („Wie das System · Icon wie die App“) grün bleibt.
- Tests: `test/lib.test.ts` `describe('appearance')`: Standard `numbers`, `resolveAppearance('dark','auto',false,'bar')`
  liefert `diaryMacros: 'bar'`; Store-Test `setDiaryMacrosPref('bar')` schreibt `ft.diaryMacros`, `numbers` entfernt
  den Schlüssel. `test/components.test.tsx` `describe('MacroSummary')`: `numbers` zeigt „P 10 · K 20 · F 5“ und keinen
  `[data-part=split]`; `bar` mit 10/20/5 g: Breiten 24,24 / 48,48 / 27,27 % (40/80/45 von 165 kcal), Summe 100,
  `aria-hidden`; nur kcal ohne Makros: alle Breiten 0, nie „NaN“. E2E `appearance.spec.ts`: „Mit Balken“ wählen, auf
  `/more` steht „Tagebuch mit Balken“, nach Reload immer noch.

### Block 3: Alle vergangenen Tage abschließen (`db/notes.ts`, `hooks/data.ts`, `features/diary/NoteCard.tsx`)

- `db/notes.ts` (bleibt frei von `@/`-Importen):
  - `openDays(loggedDates, notes, before): ISODate[]` rein: Daten vor `before`, nicht in der Menge der Notizen mit
    `completedAt`, sortiert, ohne Doppelte.
  - `openPastDays(db, before)`: `db.foodEntries.where('date').below(before).uniqueKeys()` (Index-Cursor, keine
    Datensätze) und `db.dayNotes.where('date').below(before).toArray()` durch `openDays`; da Tombstones ihr Datum
    behalten, danach nur die Kandidaten als Datensätze lesen (`where('date').anyOf(candidates).filter(e => !e.deleted)`)
    und Tage ohne lebenden Eintrag streichen. `below(before)` statt Vollscan, damit die Live-Query beim Tippen in der
    Notiz des angezeigten Tags (`date === before`) und beim Eintragen heute nicht neu läuft.
  - `completeDays(db, dates, now = Date.now()): Promise<ISODate[]>`: eine Transaktion über `[db.dayNotes, db.outbox]`,
    je Tag `prev` lesen, schon abgeschlossene überspringen, sonst `saveRecord(db, 'dayNotes', { id: dayId.note(date),
date, note: prev?.note ?? '', completedAt: now })`; gibt die hier abgeschlossenen Tage zurück (für Rückgängig).
  - `reopenDays(db, dates)`: dieselbe Transaktion, `completedAt: null`, Notiztext bleibt.
  - `Date.now()` nur als Parameter-Vorgabe (Regel aus `CLAUDE.md`). Keine Dexie-Version, kein Sync-Code, keine
    API-Änderung: jeder Tag ist ein normaler `dayNotes`-Datensatz plus Outbox-Zeile.
- `hooks/data.ts`: `useOpenPastDays(before)` = `useLiveQuery(() => openPastDays(db, before), [db, before])`.
- `NoteCard.tsx`: neue Unterkomponente `CompletePastDays({ date })` direkt unter dem Block
  `completedAt ? <Link> : <Button>` (im `grid gap-3`): `useOpenPastDays(date)`, `useSubmitting()`; bei leerer Liste
  `null`. Button-Text „Alle vergangenen Tage abschließen“, Stil wie „Wiederholen“ in `PendingAnalysisRow.tsx:76`
  (`-my-1 justify-self-start rounded-md py-2 text-sm font-medium text-primary underline underline-offset-2
disabled:opacity-50` plus Fokusring). `run(async () => { const closed = await completeDays(db, open); … toast(
closed.length === 1 ? '1 Tag abgeschlossen' : `${n} Tage abgeschlossen`, { action: { label: 'Rückgängig', onClick:
() => void reopenDays(db, closed) } }) })`. Die Undo-Closure hält nur `db` und das Array, nicht `run` (die Karte
  kann beim Tagwechsel schon weg sein). `NoteForm` und `flush` bleiben unverändert; der angezeigte Tag ist nie in
  der Liste, die Notiz-Speicherung und das Abschließen laufen in eigenen Transaktionen, beide lesen `prev` und
  behalten das jeweils andere Feld.
- Tests `test/write.test.ts`: `openDays` (sortiert, ohne Doppelte, Grenze `before`); `openPastDays` ignoriert
  Tage, die nur Tombstones haben, und den angezeigten Tag; `completeDays` überspringt schon abgeschlossene, behält
  den Notiztext („Lauf“), schreibt genau zwei Outbox-Zeilen; danach `openPastDays` leer; `reopenDays` setzt
  `completedAt: null`, Notiz bleibt, fremder Abschluss (`completedAt: 5`) bleibt. Optional Komponententest nach dem
  Muster von `test/week-strip.test.tsx` (Router nötig wegen `Link`): zwei offene Tage gesät, Button erscheint, Klick,
  beide `completedAt` gesetzt, Button weg; nur abgeschlossene Tage gesät: kein Button.

### Block 4: Tag teilen (neu `features/diary/share/`, `components/ui/checkbox.tsx`, Header von `DiaryPage.tsx`)

- Abhängigkeit `modern-screenshot` in `apps/web` (`pnpm --filter @ft/web add modern-screenshot`).
- `components/ui/checkbox.tsx` per shadcn (Radix Checkbox aus dem vorhandenen `radix-ui`-Paket), wie die anderen
  UI-Komponenten angepasst: `size-5`, kein `transition-all`, Import `@/lib/utils`.
- **Statische Bausteine aus den Tagebuchkarten herauslösen** (nur Markup, keine Hooks, keine Links, kein Swipe), die
  Karten selbst benutzen sie weiter, damit das Bild dem Tagebuch gleicht und nicht abdriftet:
  - `features/diary/CalorieCard.tsx`: Ring, `<dl>` mit den Zeilen und `MacroBars` werden `CalorieOverview({ summary,
exerciseCredited })` (exportiert, statisch); `CalorieCard` legt Klick, Button „Nährstoffe“/„Weniger“ und die
    Details darum.
  - `features/diary/MealCard.tsx`: `EntryRowBody({ entry })` (Name, Marke · Menge, `NutrientSummary`) und
    `GroupRowBody({ name, photo: ReactNode, count, nutrients })` (Foto/Icon, Name, „N Zutaten“, Summe), von
    `EntryRow`/`GroupRow` verwendet. Für das Bild bekommt `GroupRowBody` ein `<img>` mit Objekt-URL statt `MealPhoto`.
  - `features/diary/ExerciseCard.tsx`: `ExerciseRowBody({ entry })` (Name, „Min. · Intensität · Notiz“, `+kcal`
    in `text-exercise`).
- `features/diary/share/DayShareImage.tsx`: statischer Baum für das Bild, nur Props, kein Router, keine
  Live-Queries: Wurzel `w-[390px] bg-background p-4 text-foreground` (Themaklasse kommt von `<html>`), Überschrift
  `fmtDayLongYear(date)` (neu in `lib/format.ts`: `weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'`,
  „Montag, 2. November 2026“), dann `Section`-Karten: `CalorieOverview`; je Mahlzeit mit Zeilen (aus
  `groupDiaryEntries(entries)`, Gruppen zugeklappt) Titel „Name · N kcal“ und Zeilen mit den `…Body`-Bausteinen;
  Training (wenn gewählt und vorhanden); Notiz (wenn gewählt, `whitespace-pre-wrap`); Abspann (`AppLogo size={20}`
  und „Fleisch-Teufel“, `text-xs text-muted-foreground`).
- `features/diary/share/shareDay.ts`:
  - `collectShareData(db, date, parts)`: Einträge, Summary (`summarizeDay` wie `useDaySummary`), Trainings, Notiz,
    Einstellungen, Meal-Namen der Gruppen (wie `useMealInfo`), erste Fotos der Gruppen (`photoIdsOf`, `db.photos.get`,
    `photoBlob`) als Objekt-URLs; fehlende Fotos zeigen das Platzhalter-Icon.
  - `renderDayImage(data): Promise<Blob>`: Container `div` an `document.body` (`position: fixed; left: -10000px;
top: 0; width: 390px`), `createRoot(container).render(<DayShareImage …/>)`, zwei `requestAnimationFrame`
    abwarten, alle `<img>` `decode()`, dann `domToBlob(container, { scale: Math.min(3, devicePixelRatio || 2), type:
'image/png' })`. Auf WebKit das erste Ergebnis verwerfen und ein zweites Mal rastern (bekannter Safari-Fehler:
    Bilder fehlen beim ersten Lauf). Danach `root.unmount()`, Container entfernen, Objekt-URLs freigeben (`finally`).
  - `shareDayFileName(date)` = `fleisch-teufel_tagebuch_${date}.png`.
  - Teilen: `features/reports/export.ts` wird verallgemeinert: `shareOrDownloadFile(file: File): Promise<boolean>`
    (Web Share mit `canShare({ files })` am echten File, `AbortError` = abgebrochen, sonst Download wie
    `downloadText`); `shareOrDownloadText` ruft es auf. Toast nur im Download-Fall („Bild erstellt“) und bei Fehlern.
- `features/diary/share/ShareDayDialog.tsx`: `Dialog` wie `SaveMealDialog`: Titel „Tag teilen“, Beschreibung „Als
  Bild, wie ein Screenshot des Tages.“, `DialogBody` mit drei `Label`-Zeilen (`min-h-11`, `Checkbox`): „Essen“
  (Vorgabe an), „Training“ (aus; deaktiviert mit Nebentext „Kein Training eingetragen“, wenn der Tag keins hat),
  „Notiz“ (aus; deaktiviert mit „Keine Notiz“, wenn leer). Footer „Abbrechen“ / „Teilen“ (`Share`-Symbol; deaktiviert
  ohne Haken; während `busy` Text „Bild wird erstellt …“). Ablauf über `useSubmitting().run`: sammeln, rastern,
  teilen, Dialog schließen; Fehler als Toast.
- `features/diary/DiaryPage.tsx`: Header-`actions` bekommen vorn einen Ghost-Icon-Button `Share`
  (`aria-label="Tag teilen"`, `text-muted-foreground` wie `ClipboardMenu`), der den Dialog mit `date`, `exercises`
  und `note` öffnet (Dialog-Zustand im `DiaryPage`, `key={date}`).
- Tests: `test/lib.test.ts` `fmtDayLongYear('2026-11-02')` = „Montag, 2. November 2026“ und `shareDayFileName`.
  `test/components.test.tsx` `describe('DayShareImage')` (ohne Router): zeigt Überschrift, nur nicht leere
  Mahlzeiten, keine Vorschläge und keine Buttons/Links, Training nur mit `parts.training`, Notiz nur mit
  `parts.note`. Rasterung nicht im Unit-Test (jsdom). E2E neu `e2e/share-day.spec.ts` (Chromium): `addInitScript`
  stubbt `navigator.canShare = () => true` und `navigator.share`, merkt sich den Dateinamen; Eintrag anlegen, Teilen
  tippen, Dialog mit Vorgaben prüfen, „Teilen“, erwartet `fleisch-teufel_tagebuch_<date>.png` und Typ `image/png`.
- Dokumentierte Grenzen: in iOS-Standalone-PWAs geht der Download-Fallback nicht, deshalb immer Web Share zuerst
  (wie beim CSV). Ein Bild mit sehr vielen Zeilen wird lang; PNG bleibt scharf, Größe meist unter 1 MB.

### Block 5: Doku

- `README.md`: 📒 Tagebuch (Zeile 23): Makros je Zeile als Zahlen oder mit Balken (Mehr → Aussehen → Tagebuch);
  Teilen-Button pro Tag (Bild wie ein Screenshot, Essen/Training/Notiz wählbar). 🥦 Nährstoffübersicht (Zeile 30):
  im Anteil-Modus füllt der Balken nur den erreichten Anteil. 📝 Tagesnotiz (Zeile 33): „Alle vergangenen Tage
  abschließen“ mit Rückgängig.
- `CLAUDE.md`: Absatz „Appearance“ (`DiaryMacrosPref`, `ft.diaryMacros`, `MacroSummary`), Absatz „Complete days“
  (`openPastDays`/`completeDays`/`reopenDays`, Link in `NoteCard`, Toast mit Rückgängig), Absatz „Nutrient values“
  (`EnergySplitBar fill` im Anteil-Modus), neuer Absatz „Share a day“ (`features/diary/share`, statische
  `…Body`/`CalorieOverview`-Bausteine, `modern-screenshot`, `shareOrDownloadFile`, Dateiname). Kurz, im Stil der
  bestehenden Absätze, keine em- oder en-Striche.
- Diese Datei: Statusblock mit Mockup-Entscheidungen und Abweichungen.

## Verifikation

- Je Block `pnpm lint`, `pnpm typecheck` (nacheinander), `pnpm test`; nach Block 2 und 4 `pnpm e2e` (Chromium).
- Sichtprüfung über `pnpm dev` mit dem Demo-Nutzer (Login-Hinweis: Vite-Proxy gibt 403, siehe Gedächtnis
  „Dev-Proxy-Login“: eigener Playwright-Lauf hinter dem kleinen Proxy auf :5174): Anteil-Modus auf der
  Lebensmittelseite, Tagebuch mit „Mit Balken“, Link unter der Notiz nach dem Anlegen von Einträgen an zwei
  früheren Tagen, Teilen-Dialog und das erzeugte PNG (im Chromium-Lauf per gestubbtem `navigator.share` als Datei
  speichern und ansehen).
- Der echte iOS-Test (Teilen-Sheet, Fotos im Bild, dunkles Thema) bleibt beim Nutzer; Opus nennt ihn ausdrücklich
  als offen.

## Ablauf für Opus 5.5

Lesereihenfolge: dieser Plan, `CLAUDE.md`, dann je Block die genannten Dateien; vor Block 3 `.claude/skills/
offline-sync/SKILL.md` (nur Lesen, es ändert sich keine Tabelle). **Zuerst Schritt 0**: Mockup v1 bauen, dem Nutzer
den Pfad nennen (Datei liegt per SMB unter `\\truenas\claude-code\Fleisch-Teufel\docs\plans\`), auf Rückmeldung
warten, Varianten iterieren, erst nach „los“ mit Block 1 beginnen. Die Entscheidungen aus der Mockup-Runde oben
im Statusblock festhalten (Variante aus B; Abspann ja/nein; Platz des Teilen-Buttons).

Je Block ein Commit (Commit-Text englisch, Attribution laut Session-Hinweis); vor jedem Commit `pnpm lint`,
`pnpm typecheck` (nacheinander, nicht parallel), `pnpm test`; nach Block 2 und 4 zusätzlich `pnpm e2e` (Chromium;
WebKit nur, wenn `playwright install webkit` im Container vorhanden ist, sonst im Statusblock vermerken).
Abweichungen vom Plan im Statusblock dieser Datei festhalten und dem Nutzer nennen, nicht still entscheiden.
Keine em- oder en-Striche in UI-Texten, Kommentaren und Doku. Nach dem letzten Block: Status hier aktualisieren,
nicht pushen, bis der Nutzer es sagt.
