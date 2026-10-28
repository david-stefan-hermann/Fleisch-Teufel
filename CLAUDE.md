# Fleisch-Teufel: notes for Claude

Offline-first nutrition tracker PWA (MyFitnessPal-style). Talk to the user in German; code, comments and
commits in English. UI strings are German.

## Layout

- `packages/shared`: Zod schemas (wire format of every synced entity), domain math (TDEE, macros, MET,
  forecast, DGE targets), food search, LWW rule, CSV. Consumed as TypeScript source (no build step).
- `apps/api`: Hono + Drizzle (`casing: 'snake_case'`) + PostgreSQL. Entry `src/server.ts`, app factory
  `src/app.ts` (used by tests), dev runner `src/dev.ts` (embedded PostgreSQL 17).
- `apps/web`: React 19 + Vite + Tailwind v4 + shadcn/ui + TanStack Router (code-based routes in
  `src/app/router.tsx`) + Dexie. Features under `src/features/<area>`.
- `tools/bls-import`: regenerates `apps/api/data/bls-4.0.json.gz`, `apps/web/public/data/bls-compact.json`,
  `packages/shared/src/nutrients-catalog.json`.

## Commands

```bash
pnpm dev            # API :3000 + Vite :5173 (proxy /api); dev DB in ~/.local/share/fleisch-teufel/dev-db
pnpm test           # all vitest suites (API tests start an embedded PostgreSQL)
pnpm e2e            # Playwright smoke (builds the web app, starts API on :3100 with a throwaway DB)
pnpm lint           # eslint + prettier --check   (pnpm format to fix)
pnpm typecheck      # sequential tsc in all packages (parallel runs can OOM the container)
pnpm build
pnpm --filter @ft/api seed:demo   # demo user with 6 weeks of data (server must run, registration open)
pnpm --filter @ft/api db:generate -- --name <change>   # after editing apps/api/src/db/schema.ts
```

Serve the production web build through the API (same origin, service worker active):
`WEB_DIST=$PWD/apps/web/dist pnpm --filter @ft/api dev` after `pnpm --filter @ft/web build`.

## Conventions & gotchas

- Synced data: read `.claude/skills/offline-sync/SKILL.md` and `docs/sync.md` before touching schemas,
  Dexie, the sync engine or the service worker. Write synced records only via `saveRecord`/`patchRecord`/
  `deleteRecord`. Keep `apps/web/src/db` and `apps/web/src/sync` free of `@/` imports (API tests import them).
- Settings are written only through `saveSettings(db, patch)` (`src/db/settings.ts`): the fields of the saving
  page on top of the current record (or `DEFAULT_SETTINGS`), never a copy loaded at mount.
- Every "eintragen"/"speichern" button runs through `useSubmitting()` (`src/hooks/useSubmitting.ts`):
  `run(fn)` ignores a second tap while the first runs, `busy` disables the button, errors become toasts
  (`errorMessage` knows quota and Zod errors). Several records of one action go into one Dexie
  transaction (`logItems`, `saveMealDraft`, `saveGroupDraft`, `logDeferred`).
- Editor drafts (`MealDraft`, `GroupDraft`) carry `baseUpdatedAt`; when the record changed on another
  device the page drops an untouched draft or shows `ConflictBanner` ("Neu laden" / "Meine Änderungen
  behalten"). A deletion is never undone from a draft.
- `api()` throws `TimeoutError` (not `OfflineError`) when the server did not answer in time: the request
  may have been processed (and paid for), so callers must not repeat it by themselves.
- "Daten & Sync" also restores a JSON backup (`src/db/backup.ts`: only records newer than the device's, via
  `saveRecord`) and shows the device error log (`src/lib/errorLog.ts`, localStorage, unhandled errors and
  rejections; `recordError(e, source)` for anything worth keeping). The account page lists the signed-in
  devices (`GET/DELETE /api/auth/sessions`) and deletes the account (`DELETE /api/auth/account`, password).
- React lint uses the React Compiler rules: no `setState` in effects, no refs/impure calls during render.
  Pattern for forms: the page loads data, then mounts a form component with `initial` props (and `key`).
  Put write logic with `Date.now()` into module functions (`src/db/entries.ts`, `saveOnboarding.ts`).
- TanStack Router search params: validators return optional keys (`clean()` in the router) so links can omit them.
- shadcn/ui: components live in `apps/web/src/components/ui` and were adjusted (touch sizes h-10/h-11, no
  `transition-all`). The CLI once wrote `from "cn"`; imports must be `@/lib/utils`.
- Lists: `src/components/SwipeToDelete.tsx` wraps rows for swipe-left delete (always with an undo toast;
  `contentClassName="bg-background"` for rows outside a card). Deleted weights and meals show in the trash
  (`/settings/trash`, `src/db/trash.ts`); there is no purge.
  Diary rows (`EntryRow`, `GroupRow` in `features/diary/MealCard.tsx`) also swipe right (`onCopy`): that copies
  into the device clipboard (`src/db/clipboard.ts`, `kv` key `clipboard`, not synced, one snapshot that stays
  after pasting). A group keeps `mealId`/`groupName`/`aiAnalysisId`/`photoIds` (photo ids are shared, not
  copied); a single entry or one ingredient of an expanded group pastes as a plain entry. A whole diary meal is
  copied with "Kopieren" in its ⋯ menu (kind `meal`, `parts`: its rows as `DiaryPart`s, pasted with the same
  structure). Header of each diary meal (and `/diary-meal`): [`PasteButton` while something is copied]
  [⋯ `DiaryMealMenu`: Kopieren, Als Meal speichern, Wie gestern eintragen, Alle Einträge löschen] [+]. The diary
  header shows `ClipboardMenu` left of the sync cloud: "Als Meal speichern" (groups and meals,
  `saveMealFromItems`) and "Zwischenablage leeren". "Wie gestern", the clipboard and suggestions log through
  `diaryParts`/`logParts` (`src/db/entries.ts`); a meal saved from diary rows takes every ingredient on its own
  and the first photo of any group (`firstPhotoId`). All "Als Meal speichern" use `SaveMealDialog`. `logItems` returns the new entry ids.
  Entries logged together share `groupId`: from a saved meal (`mealId`, name from the meal) or as a named group
  without meal (`groupName`, AI review "Meal eintragen" without saving, via `logAiItems`). `groupDiaryEntries` (shared) builds
  diary rows; `DiaryRows` (`features/diary/MealCard.tsx`) renders them in the diary and on `/diary-meal`.
  A group carries its photos on every entry (`photoIds`: the analysed photos, or the meal photo at logging time;
  `photoId` is always the first, read old records with `photoIdsOf`); the row shows the first before the meal's
  current photo (with `PhotoCount` when there are several), and its own `groupName` before the meal name. The group row is a
  stretched link to the group editor; only "N Zutaten ⌄" (its own button above the link) expands the items.
- Diary group editor: `/diary-group/$groupId?date=` (`features/diary/DiaryGroupPage.tsx`) changes only these
  entries, never the saved meal, except its save icon "Als Meal speichern" (`saveGroupAsMeal`, `SaveMealDialog`):
  what the editor shows becomes a new meal or, for a group logged from a meal, updates that meal (keeps its photo
  and cooked weight); the entries take over the draft and are attached to the meal (`mealId`, own name dropped
  when equal), then the editor closes. Otherwise: name, amounts, total amount (`scaleItems`, shared with the meal editor), remove
  and add (`into=group:<id>`). Device draft in `db/groupDraft.ts` (`kv`); `saveGroupDraft` patches, soft-deletes
  and adds entries of the same group. A name equal to the meal's stays `groupName: null`. The editor shows all
  photos (`PhotoStrip`) and takes new ones ("Foto aufnehmen oder wählen", `PhotoCaptureSheet`): they wait as
  bytes in `kv` (`groupDraftPhotos:<id>`, count as a change) and `saveGroupDraft` appends them to every entry. A
  group with photos has ↻ "Neu analysieren" with all of them (dialog with an optional hint, one more Claude call, online only):
  `groupDraftFromAnalysis` replaces the ingredients of the draft like an unchanged review (first candidate, the
  model's grams; the name follows the dish unless the group has a saved meal), written only on "Änderungen
  übernehmen" with the new `aiAnalysisId`. `DiscardDialog apply`
  says "Übernehmen".
- E2E: Playwright projects `chromium-iphone` (all specs) and `webkit-iphone` (`ios-layout.spec.ts`, needs
  `playwright install webkit`).
- Food search (`packages/shared/src/search.ts`, same code on device, server and in the AI `search_foods`):
  folded keys (`searchKey`: "kase" = "käse"), light stemming, compound heads ("brot" finds "Vollkornbrot" as
  bread; in hyphenated names the last part is the head; words after "mit" count as ingredients), typos from 5
  letters (`fuzzy` hits, `suggestQuery` for "Meintest du"), synonyms for words BLS spells differently
  (`synonyms.ts`). Ranking: basic foods before dishes (BLS X/Y), dry products down, OFF products with
  `popularity` (scans, not stored). Ranking quality is pinned by `apps/api/test/search-quality.test.ts` (real
  BLS): add a line whenever a real query ranks badly. On `/add` (`searchLocal`, `mergeOnline` in
  `foods/foodService.ts`) BLS, own and cached foods and saved meals form one list; OFF results are sorted into it
  when they arrive. Rows show the last logged amount, else a serving (never the whole package), and "N× gegessen".
- Food search with a target: `?into=meal:<id>` / `ai:<localId>` / `group:<groupId>` (its day is `date`) on `/add`,
  `/food/$foodId`, `/scan`, `/custom-food/$id`, `/meals/$mealId` (a saved meal: `MealLogView` adds its kept,
  scaled ingredients one by one via `addItemsToMealDraft` / `addItemsToGroupDraft` / `addFoodsToDraft`; the meal
  being edited is not listed) adds to a saved meal / AI review / diary group draft instead of the diary (`src/lib/into.ts`; return via
  `rememberIntoStart`/`returnFromInto`). AI review state lives in `aiQueue.draft`, the open review in `/photo?review=`.
  Hint fields of the analysis (photo preview, review, group editor's ↻ dialog) are `HintField`
  (`components/HintField.tsx`: `Textarea autoGrow`, one line growing to about six, Enter is a new line, at most
  `MAX_HINT_LENGTH` = 1 000 like the server, `HintCount` near the limit). The review keeps the hint editable; ↻ calls `reanalyze` (same queue item, all its photos, one more Claude call,
  asks first when `draftChanged`). While it runs the review stays visible but locked; a failed run keeps the old
  result. The review shows the photos as `PhotoStrip`; "+" adds more (`addQueuePhotos`), X removes one; photos not
  in `analyzedPhotoIds` carry "Neu" and wait for ↻ (no automatic re-analysis).
- Camera start: the taps that open `/photo` (add sheet tile, meal "+", search camera icon) call `warmUpCamera()`
  (`components/cameraWarmup.ts`) before navigating, so iOS starts the camera during the page change; the scanner
  takes the stream with `takeWarmStream()` (same `CAMERA_CONSTRAINTS`), an unused one stops after 3 s. The camera
  never runs without a visible picture otherwise (the user rejected keeping it alive). The video fades in on the
  first frame; shutters wait for `onReady`.
- Top banners (`app/AppBanners.tsx`): only one at a time, session expired > update > install. The install banner
  (store-banner style, app icon, after `INSTALL_DELAY_MS` without another banner, never standalone, closed for good
  via `ft.installHintDismissed`) shows the Safari steps on iOS, Chrome's dialog on Android (`beforeinstallprompt`
  kept by `captureInstallPrompt` in `app/pwa.ts`) and a QR code (`uqr`) of the app on a computer (`isDesktop`).
  E2E specs set the dismissed key so the banner stays out of the way.
- Meal photos: `src/db/photos.ts` (device store + upload in `SyncEngine.push`), `components/MealPhoto.tsx`,
  API `routes/photos.ts`. Images in IndexedDB are `ArrayBuffer` + type (`photos.bytes`, AI queue photos in the
  `aiPhotos` table via `features/ai/queue.ts`, several per item, ordered by id; `aiImages` of Dexie v4 is only
  migrated from), never Blobs in records that get rewritten (WebKit breaks them).
  Every image is compressed before it is stored or sent: `compressImage(blob, IMAGE_PRESETS.analysis | mealPhoto |
label)` in `features/ai/image.ts` (pixel budget and at most 1080p, the stricter wins; size math in `fitSize`). Toasts sit at the bottom (iOS tints the status bar from top elements).
- Diary drag and drop: `features/diary/DiaryDnd.tsx` (dnd-kit, mouse + touch sensors, 300 ms long press);
  rows are wrapped in `DraggableRow`, `SwipeToDelete` gets `disabled` while a drag runs (`useDiaryDrag`).
  Moves go through `moveEntriesToMeal` (`src/db/entries.ts`).
- Add menu (tab bar "+" only): one `AddSheetProvider` in the authed layout, `useAddSheet().open({ date })`; tiles
  "Gewicht eintragen", "Essen eintragen" (middle, primary), "Training eintragen". `/photo` is the food page "Essen
  eintragen" (camera, barcode; header: bolt "Schnelleingabe" to `/quick-add` as a new page, then the magnifier to
  `/add`; food page and search replace each other). Plate photos show a preview (`PhotoPreview`: `PhotoStrip`,
  "+" opens `PhotoCaptureSheet` for further plates, courses or a label, up to `MAX_ANALYSIS_PHOTOS`; the library
  takes several files) and go to the AI only on "Analysieren (N Fotos)", in one call (`analyzePhotos`). The header
  back button in the preview drops the photos and shows the camera again (`Page onBack`); browser or iOS swipe
  back leaves the page and loses them (accepted). While the analysis runs, back goes to the diary and any way out
  calls `leaveAnalysis`: the item becomes `deferred` and is logged by itself; the review opens only while the
  person waits on the page (refs `waiting`/`gone` in `PhotoPage`, never navigate after an await otherwise). The "+" of a diary meal links straight to `/photo` for that meal.
- Wording: **eintragen** = into the diary, **speichern** = keep for reuse, "hinzufügen" only for ingredients of a
  meal or an AI review, "Änderungen übernehmen" when editing an entry.
- Page primary action: `Page footer={<Button size="lg">…</Button>}` renders the sticky `PageFooter`. Saving for
  reuse is a header save icon that opens `NameDialog` (meal page, training, AI review; after saving the review
  shows a "Gespeichert" chip). Editors with explicit save (meal editor, saved training editor) block leaving
  with `useBlocker` (`shouldBlockFn` in `useCallback`) and show `DiscardDialog`; navigate with `ignoreBlocker`
  after deleting.
- Editing from where you log: own foods (`/food/$id`) and saved meals ("Meal eintragen") have a header pencil to
  `/custom-food/$id?from=food` / `/meals/$id?from=log`. Saving in the custom food and meal editors closes them
  (back to the page that opened them, `goBackOr` in `src/lib/history.ts`; the meal editor sets a `leaving` ref so
  its blocker does not ask). Deleting goes back past the page that opened the editor when `from` says so. The
  food page stashes its unsaved form for the way there and back (`features/foods/foodLogDraft.ts`, keyed by the
  history entry). "Anlegen und eintragen" still replaces the editor with the new food's page.
- Dialogs sit at the top of the visual viewport (`ViewportVars` sets `--vvh`/`--vvt`) and stay above the iOS
  keyboard; put everything between header and footer into `DialogBody` (scrolls, buttons stay visible).
- Saved meals: "Neues Meal" on `/meals` (`startNewMeal`: a draft with `isNew`, no record until "Speichern" with
  a name and an ingredient; left without input it is dropped). `/meals/$mealId` with `date`+`meal` logs (`MealLogView`, swipe leaves an ingredient out of this
  entry only), without them edits (`MealEditor`). The editor writes a device draft (`db/mealDraft.ts`, `kv`) and
  only `saveMealDraft` touches the synced record; `addItemToMeal` (food search `into=meal:`) appends to the draft.
- Saved trainings (`exerciseTemplates`, never "Vorlage" in the UI): `/trainings`, `/trainings/$templateId`; sport
  picker and fields shared with logging (`features/exercise/TrainingFields.tsx`, `training.ts`). Trash covers
  weights, meals and saved trainings.
- Training entry (`features/exercise/ExercisePage.tsx`): several trainings of a day at once. The page holds rows
  under "Ausgewählt" (own duration, intensity, note; the last one added is open; "Als Training speichern" per row)
  and logs them with `logTrainings` (`db/entries.ts`, one transaction, one `exerciseEntry` each, `loggedAt`
  ascending). Badges "Zuletzt & häufig" (`TrainingChip`/`ChipRow` in `TrainingChips.tsx`): the sports this person
  logs with the values of last time (`db/trainingSuggestions.ts` `trainingHistory`: 60 days, frequency and recency
  like the meal suggestions, same weekday higher; `withLogged` on the page keeps today's sports) and the saved
  trainings; a tap selects or deselects (`aria-pressed`). `SportPicker` marks `selectedKeys` and lists saved
  trainings that match the search. The diary's `ExerciseCard` shows `TrainingSuggestions` below its entries (one
  tap logs, undo deletes; nothing already logged that day). Editing an entry (`entryId`) stays a single open row.
- Weight entry uses `TapeMeasure` (`role=slider`): raster and visible range are personal settings
  (`settings.weightStepKg` 0,01/0,05/0,1 and `weightRangeKg` ±0,5/1/2/5, null = default 0,05 and ±0,5; Profil →
  "Gewichtseingabe"; `WEIGHT_STEPS`/`WEIGHT_RANGES` in shared). The value sits on the raster also while dragging;
  marks never crowd closer than 7 px (`MIN_MARK_PX`: 0,01 over ±0,5 kg draws marks every 0,05), labels per kg and
  at the half kilograms when less than 1,5 kg is visible. Weights display with up to two decimals.
- Food amounts use one component, `components/AmountEditor.tsx` (food page, AI review rows, `IngredientCard` of the
  meal and diary group editors): two picker wheels (`components/Wheel.tsx`, scroll-snap, three rows; amount as
  `role=slider`, unit as `listbox`), below them the field and "= X g" for portions. No slider, no −/+ (round 8).
  The amount wheel runs on a raster (`wheelValues` in `lib/amounts.ts`: 5 g up to 1.000 g, half portions up to 10);
  the field takes any amount up to `MAX_AMOUNT`, and one off the raster (137 g, 1,25 portions) gets its own row on
  the wheel and keeps it while the wheel turns (`extra` in the editor). `onChange` is live (turning), `onCommit`
  final (wheel stopped, typed, unit switched): drafts are written on commit. The wheel reports its stop through
  state and an effect, never straight from its timer (a stale closure overwrote newer state). Only input turns the
  wheel: a scroll event counts as a turn after `pointerdown`/`touchstart`/`wheel` on it; scrolls from outside (a new
  `index`, rows swapped, clamping) are set in a layout effect and their events ignored (`pending`). The amount
  wheel is keyed by the kind of unit (`key={kind}`), so a unit switch builds it anew instead of swapping 200 gram
  rows against 20 portion rows (that once logged the row the old position landed on: 2 portions became 20 g). A
  unit switch keeps the grams (`convertAmount`, `itemWithAmount`); AI review rows keep grams plus an optional `portion` that
  `aiMealItems` logs with its count. "Eigene Portion" is a button next to the label (food page). The food page logs
  on one day only.
- Units offered for a food: `portionsFor` (shared `foods.ts`), in this order: the user's portions, the food's own
  (OFF serving, custom food), the pieces a BLS food is counted in (shared `portions.ts` `piecePortionsFor`: a
  curated table by name words and BLS group, "Stück (120 g)" for a banana, "Scheibe (45 g)" for bread, "Zehe (3 g)",
  "Portion (350 g)" for dishes of group Y; none for dried, powdered, juiced or canned forms, `PROCESSED`; only
  `source: 'bls'`), the base units, then the household measures that fit (`householdPortionsFor`: name words first,
  then the BLS group letter, drinks by unit ml; no cup for toast). Labels carry the grams. `defaultPortion` picks
  the first before the base units (never a package or a household measure) for the food page and the search rows,
  else 100 g. OFF servings get their label from the serving text (`servingLabel`: "1 Riegel (45g)" → "Riegel
  (45 g)", English words translated, a bare weight stays "Portion (30 g)"). Pass the food's `name`, `source` and
  `sourceId` when there is no full `Food`. Grams, the food's own and the user's portions are always offered, and
  `editorPortions` keeps the current portion of an older entry.
- Photos waiting for analysis: a first analysis that had to wait for a connection, was left on the photo page
  (`leaveAnalysis`) or was cut off by closing the app gets `deferred` on its `aiQueue` item. Every item without a result (waiting, running, failed) shows as `PendingAnalysisRow` in its diary meal
  (`usePendingAnalyses`; photo, hint as title, state, `NO_VALUE` instead of kcal, counts in no sum, never asks to
  review). Swipe left discards it with undo (`takeQueueItem` / `restoreQueueItem`), a failed one has the text link
  "Wiederholen" (`retryQueueItem`). Once analysed, `logDeferred` (`features/ai/queue.ts`, only inside the
  serialized queue run, so never twice) logs it as a normal group with all photos (first candidate, the model's
  grams) and removes it from the queue; changes go through the diary group editor. An analysis the person waited
  for still opens the review, and one without any usable item stays a normal review (toast: under "Analysen").
- Diary rows of an AI analysis are always a group row (`groupDiaryEntries` keeps a single entry with
  `aiAnalysisId` as a group: name, photo, group editor); other groups with one entry left show as a plain entry.
- Object URLs for blobs only via `useObjectUrl(blob, key)` (`components/MealPhoto.tsx`): StrictMode-safe,
  and with a key a re-read IndexedDB blob does not flicker. Never `useMemo(URL.createObjectURL)`.
- Typography: no em or en dashes in UI strings, comments or docs. The only dash is the missing-value
  placeholder `NO_VALUE` from `src/lib/format.ts`.
- Calorie ring (`CalorieRing`): the excess arc is `--over-2` (dark red), because `--over` on the red ring
  cannot be told apart; nothing changes above twice the budget. Over budget the last row of the calorie card
  reads "Zu viel" with the amount without a minus (otherwise "Übrig"). `NutrientBreakdown` variant `day` shows the
  kcal number in `text-over` above `kcalBudget` (target plus credited training; reports use the kcal target).
- Excess bars (`TargetBar`): red `--over` up to twice the target, then dark red `--over-2` (bars only, text
  stays `text-over`); micros with a maximum use `TargetBar` too (pass `over` for decimal comparisons). Protein is
  the exception: more is good, so `overTone="good"` (`overToneOf`) shows its excess green (`--over-good`, bar and
  text `OVER_TEXT`) without a second step.
- Week strip (`features/diary/WeekStrip.tsx`): dot row of fixed height, red (left) for logged food, blue
  (`bg-exercise`, right) for a training (`useTrainedDates`); no ring on the selected day. `--exercise` (blue) is
  the training color everywhere, lighter and more cyan than `--protein`.
- Nutrient values are always shown with `src/components/NutrientBreakdown.tsx` (variant `item` with the kcal tap
  for the day mode, `day` for the day overview and reports; math in shared `energyBreakdown`). `MacroBars` /
  `TargetBar` (`components/MacroBars.tsx`) only for progress towards a target (excess as red overlay).
  Ingredients (meal editor, AI review) get `NutrientsDisclosure` ("Nährwerte", collapsed); "Meal eintragen" opens
  one ingredient row at a time.
- Custom food editor: `NutrientEditor` (same layout as the breakdown, fields instead of numbers) on the pure form
  logic in `features/foods/customFoodForm.ts`. kcal follow the macros with the EU label formula
  (`kcalFromMacrosEu`: 4/4/9 plus 2 kcal per g of fiber; the macro split everywhere stays 4/4/9) until typed over;
  kJ follow kcal, sodium follows salt, each editable and computing back. No mode is stored: on opening, kcal count
  as automatic when they match the formula to 0.5 kcal (`isAutoKcal`). All ten values are saved. Barcode scan via
  `BarcodeScanSheet`, label photos via `LabelCaptureSheet` (barcode detection and the label call on top of the
  generic `PhotoCaptureSheet`; both on `FullscreenOverlay`); a field filled from
  outside flashes with `.field-flash`. The barcode duplicate hint is informational only.
- Charts: `src/components/Chart.tsx` (uPlot). One y-axis only; text uses ink tokens, never series colors.
  Macro colors were validated with the dataviz palette checker for light and dark. The plot is rebuilt only when
  the series structure, height or theme change; new data goes in with `setData` (keep series arrays stable).
  Stacked bars are cumulative series drawn from 0, highest first; inner segments set `gapAbove`, segments
  `legend: false` (no legend row, table column or cursor point), a `kind: 'legend'` series carries the total
  (report kcal: `features/reports/chartData.ts`, grey `--bar-neutral` for days without macros). Report choices
  navigate with `resetScroll: false`.
- Appearance (Mehr → Aussehen, per device in `localStorage`): app theme system/light/dark and logo variant
  (follows the app or fixed). `public/theme-init.js` sets `.dark`/`.light` on `<html>` before the first paint,
  `src/lib/appearance.ts` (`useAppearance`) keeps it, the theme-color meta, favicon and apple-touch-icon in sync.
  Dark tokens live under `:root.dark`; never use `prefers-color-scheme` directly (use `useAppearance().mode`).
  Logo sources and the icon script: `docs/logo/README.md`; show the logo with `AppLogo`.
- No pinch or double-tap zoom (viewport `user-scalable=no`, `touch-action: pan-x pan-y` on `html`, iOS
  `gesturestart` cancelled in `main.tsx`). Every input needs at least 16 px text (`Input`/`NumberField` have it),
  or iOS zooms in on focus.
- Numbers/dates via `src/lib/format.ts` (`Intl`, German), decimal input via `NumberField` (accepts `1,5`).
- AI: `apps/api/src/ai/*`: model `claude-opus-5-5` by default, structured output via `betaZodOutputFormat`,
  `fallbacks: 'default'`. Load the `claude-api` skill before changing it. The meal photo analysis is a tool loop
  (`toolRunner`, at most `MAX_ANALYSIS_ROUNDS` requests): the model searches the database itself with `search_foods`
  (`ai/foodSearch.ts`: BLS, cached OFF, the person's own foods, live OFF below `OFF_BELOW` local hits; marks
  "früher gewählt" and "oft eingetragen") and answers with `foodId` and `alternatives`. `candidatesFor`
  (`routes/ai.ts`) accepts only ids its searches returned. A dish that is not in the database is split into
  components that are; only when that fails too the model gives `estimate` (per 100 g), which becomes a food with
  `estimated: true`, id `est:<analysisId>:<index>` and brand "KI-Schätzung": the review says so, the entry is logged
  without `foodId`. This is the one place where nutrients of a meal come from the model. Without a choice or
  estimate the older term matching runs: `matchItem` (`ai/match.ts`) pushes
  dry and instant products (`DRY_WORDS`: "Kartoffelpüree Instantpulver") down unless the name says prepared or the
  item is the dry product; the prompt asks for search terms and grams of the food as eaten. Learning: logging a
  review sends the rows whose food the person changed (`draftChoices`, also "Selbst suchen", which replaces the
  row's food via `searchRowKey`) to `POST /api/ai/choices`; table `ai_food_choices` is server only, not synced
  (changes in the diary group editor and offline are not learned). The food label reading works differently
  (`POST /api/ai/label`, `ai/label.ts`): the model only copies the printed values, never
  estimates, the barcode is kept only with a valid check digit (`cleanGtin`), and the person checks the filled
  form before saving.
- Diary meal suggestions: `MealSuggestions` ("Zuletzt hier", `src/db/suggestions.ts`) under every diary meal
  (and on `/diary-meal`), below its entries: foods and groups of this meal index in the last 60 days, scored by
  frequency and recency (same weekday higher), without what the meal already has that day (cut to 4 after
  that). One live query per day for all cards (`daySuggestions`, `useDaySuggestions`). One tap logs the last
  amount (`logSuggestion`) with undo; "Wie gestern" (`copyMealFromDay`) is a chip only while the meal is empty,
  else in the ⋯ menu.
- "Beschreiben statt fotografieren": the keyboard icon on `/photo` swaps the camera for a text form; the
  queue item has `textOnly: true` and no photos (`enqueueDescription`), `/api/ai/analyze` takes text without
  images, the review is the same (its hint field is labelled "Beschreibung der Mahlzeit").
- AI review: while no ingredient is a fat (`isFatFood`, `features/ai/fatSuggestion.ts`) the review offers
  "+ Öl 10 g" / "+ Butter 10 g" (photo apps miss about 30 g fat per meal); candidates show "N× gegessen".
  The prompt lists invisible fats as own rows by default unless the hint rules them out.
- Barcode without a hit (`ScanPage`): with AI on, straight to `/custom-food/new?barcode=&label=1` (label
  camera open). An Open Food Facts food has a pencil "Werte korrigieren": `/custom-food/new?copy=<foodId>`
  prefills an own food with the same barcode; search and online results hide the OFF twin of an own barcode
  (`ownBarcodes`, `shadowedByOwn` in `foods/foodService.ts`), the barcode lookup prefers own foods anyway.
- Complete days (`isCompleteDay`, shared `reports.ts`): closed with "Tag abschließen" or at least
  `MIN_MEALS_COMPLETE` (2) meals logged. Report averages and "im Ziel" count complete days (fallback: logged
  days, `PeriodStats.basis`), the kcal chart draws incomplete days grey, the CSV has a column "Vollständig".
  `dailyRows` takes `notes` for the closed flag.
- Expenditure from own data (shared `expenditure.ts`): `estimateExpenditure` = average intake of complete
  days minus training minus the linear weight trend × 7 700 over the last 21 days (needs 14 complete days
  and 4 weigh-ins spanning 10 days; implausible results give null). `ExpenditureCard` on `/progress` shows
  it next to the formula and suggests a kcal target (`targetFromExpenditure`, applied via
  `features/goals/applyTargetKcal.ts`, or put off 7 days in `kv` `expenditure.dismissedUntil`); the day
  forecast uses it when available (`useExpenditure`). Never changes a goal by itself.
- Monday only, today's diary: `WeekReviewCard` ("Letzte Woche": Ø kcal vs budget, Ø protein, weight trend,
  complete days; `weekSummary`), X hides it for the week (`kv` `weekReview.dismissed`). The diary stays the
  start page; no streaks, no verdicts.
- Recipe mode: `meals.cookedGrams` (shared `recipes.ts`: `mealPer100`, `mealFactorForGrams`,
  `foodFromMeal`). The meal editor has the field under "Rezept" and a header icon "Als Lebensmittel
  speichern" (`saveMealAsFood`: own food per 100 g cooked with the portion "Ganzes Rezept"); `MealLogView`
  takes "Gegessen (gekocht)" in grams when the weight is known.
- Reminder (Mehr → Erinnerung, `features/more/ReminderPage.tsx`, `lib/reminder.ts`): Web Push, one
  notification a day at a chosen local time, only when nothing is logged that day, per device
  (`push_subscriptions`, server only, `apps/api/src/push.ts` sends every minute). Needs `VAPID_PUBLIC_KEY`/
  `VAPID_PRIVATE_KEY` on the server (`pnpm --filter @ft/api push:keys`); iOS only as installed app. Signing
  out removes the device's subscription. `sw.ts` shows the notification and opens the diary on tap.
- Server housekeeping (`apps/api/src/maintenance.ts`, at start and daily): photos older than 30 days that no
  meal or entry (tombstones included) references, and expired sessions. Sessions slide up to 400 days but end
  2 years after creation. `/health` says only `{ ok }`; version and catalog size are under `/api/info`.
- `/projects` is an SMB dataset: PostgreSQL data dirs cannot live there (0700 permissions), hence the dev DB
  in the home directory.
- Secrets: project `.env` (gitignored). Never print or commit them.

## Deployment

GitHub Actions (`.github/workflows/docker.yml`) builds `ghcr.io/david-stefan-hermann/fleisch-teufel` on push to
`main`; the user deploys `deploy/docker-compose.yml` in Dockge (port 30300 → 3000). No Docker inside this container.
