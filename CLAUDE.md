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
- React lint uses the React Compiler rules: no `setState` in effects, no refs/impure calls during render.
  Pattern for forms: the page loads data, then mounts a form component with `initial` props (and `key`).
  Put write logic with `Date.now()` into module functions (`src/db/entries.ts`, `saveOnboarding.ts`).
- TanStack Router search params: validators return optional keys (`clean()` in the router) so links can omit them.
- shadcn/ui: components live in `apps/web/src/components/ui` and were adjusted (touch sizes h-10/h-11, no
  `transition-all`). The CLI once wrote `from "cn"`; imports must be `@/lib/utils`.
- Lists: `src/components/SwipeToDelete.tsx` wraps rows for swipe-left delete (always with an undo toast;
  `contentClassName="bg-background"` for rows outside a card). Deleted weights and meals show in the trash
  (`/settings/trash`, `src/db/trash.ts`); there is no purge.
  Entries logged together share `groupId`: from a saved meal (`mealId`, name from the meal) or as a named group
  without meal (`groupName`, AI review "Meal eintragen" without saving, via `logAiItems`). `groupDiaryEntries` (shared) builds
  diary rows; `DiaryRows` (`features/diary/MealCard.tsx`) renders them in the diary and on `/diary-meal`.
  A group carries its photo on every entry (`photoId`: the analysed photo, or the meal photo at logging time); the
  row shows it before the meal's current photo, and its own `groupName` before the meal name. The group row is a
  stretched link to the group editor; only "N Zutaten ⌄" (its own button above the link) expands the items.
- Diary group editor: `/diary-group/$groupId?date=` (`features/diary/DiaryGroupPage.tsx`) changes only these
  entries, never the saved meal: name, amounts, total amount (`scaleItems`, shared with the meal editor), remove
  and add (`into=group:<id>`). Device draft in `db/groupDraft.ts` (`kv`); `saveGroupDraft` patches, soft-deletes
  and adds entries of the same group. A name equal to the meal's stays `groupName: null`. `DiscardDialog apply`
  says "Übernehmen".
- E2E: Playwright projects `chromium-iphone` (all specs) and `webkit-iphone` (`ios-layout.spec.ts`, needs
  `playwright install webkit`).
- Food search with a target: `?into=meal:<id>` / `ai:<localId>` / `group:<groupId>` (its day is `date`) on `/add`,
  `/food/$foodId`, `/scan`, `/custom-food/$id` adds to a saved meal / AI review / diary group draft instead of the diary (`src/lib/into.ts`; return via
  `rememberIntoStart`/`returnFromInto`). AI review state lives in `aiQueue.draft`, the open review in `/photo?review=`.
  The review keeps the hint editable; ↻ calls `reanalyze` (same queue item, one more Claude call, asks first when
  `draftChanged`). While it runs the review stays visible but locked; a failed run keeps the old result.
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
  `aiImages` table via `features/ai/queue.ts`), never Blobs in records that get rewritten (WebKit breaks them).
  Every image is compressed before it is stored or sent: `compressImage(blob, IMAGE_PRESETS.analysis | mealPhoto |
label)` in `features/ai/image.ts` (pixel budget and at most 1080p, the stricter wins; size math in `fitSize`). Toasts sit at the bottom (iOS tints the status bar from top elements).
- Diary drag and drop: `features/diary/DiaryDnd.tsx` (dnd-kit, mouse + touch sensors, 300 ms long press);
  rows are wrapped in `DraggableRow`, `SwipeToDelete` gets `disabled` while a drag runs (`useDiaryDrag`).
  Moves go through `moveEntriesToMeal` (`src/db/entries.ts`).
- Add menu (tab bar "+" only): one `AddSheetProvider` in the authed layout, `useAddSheet().open({ date })`; tiles
  "Gewicht eintragen", "Essen eintragen" (middle, primary), "Training eintragen". `/photo` is the food page "Essen
  eintragen" (camera, barcode; header: bolt "Schnelleingabe" to `/quick-add` as a new page, then the magnifier to
  `/add`; food page and search replace each other). A plate photo shows a preview (`PhotoPreview`) and goes
  to the AI only on "Analysieren". The header back button in the preview drops the photo and shows the camera
  again (`Page onBack`); browser or iOS swipe back leaves the page and loses the photo (accepted). The "+" of a diary meal links straight to `/photo` for that meal.
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
- Saved meals: `/meals/$mealId` with `date`+`meal` logs (`MealLogView`, swipe leaves an ingredient out of this
  entry only), without them edits (`MealEditor`). The editor writes a device draft (`db/mealDraft.ts`, `kv`) and
  only `saveMealDraft` touches the synced record; `addItemToMeal` (food search `into=meal:`) appends to the draft.
- Saved trainings (`exerciseTemplates`, never "Vorlage" in the UI): `/trainings`, `/trainings/$templateId`; sport
  picker and fields shared with logging (`features/exercise/TrainingFields.tsx`, `training.ts`). Trash covers
  weights, meals and saved trainings.
- Weight entry uses `TapeMeasure` (0,05 raster, `role=slider`); weights display with up to two decimals.
- Food amounts use one component, `components/AmountEditor.tsx` (food page, AI review rows, `IngredientCard` of the
  meal and diary group editors): two picker wheels (`components/Wheel.tsx`, scroll-snap, three rows; amount as
  `role=slider`, unit as `listbox`), below them the field and "= X g" for portions. No slider, no −/+ (round 8).
  The amount wheel runs on a raster (`wheelValues` in `lib/amounts.ts`: 5 g up to 1.000 g, half portions up to 10);
  the field takes any amount up to `MAX_AMOUNT`, and one off the raster (137 g, 1,25 portions) gets its own row on
  the wheel and keeps it while the wheel turns (`extra` in the editor). `onChange` is live (turning), `onCommit`
  final (wheel stopped, typed, unit switched): drafts are written on commit. The wheel reports its stop through
  state and an effect, never straight from its timer (a stale closure overwrote newer state). A unit switch keeps
  the grams (`convertAmount`, `itemWithAmount`); AI review rows keep grams plus an optional `portion` that
  `aiMealItems` logs with its count. "Eigene Portion" is a button next to the label (food page). The food page logs
  on one day only.
- Units offered for a food: `portionsFor` (shared `foods.ts`) adds only the household measures that fit
  (`householdPortionsFor`: name words first, then the BLS group letter, drinks by unit ml; no cup for toast). Pass
  the food's `name` when there is no full `Food` (ingredient without a loaded food). Grams, the food's own and the
  user's portions are always offered, and `editorPortions` keeps the current portion of an older entry.
- Photos waiting for analysis: a first analysis that had to wait for a connection gets `deferred` on its `aiQueue`
  item. Every item without a result (waiting, running, failed) shows as `PendingAnalysisRow` in its diary meal
  (`usePendingAnalyses`; photo, hint as title, state, `NO_VALUE` instead of kcal, counts in no sum, never asks to
  review). Swipe left discards it with undo (`takeQueueItem` / `restoreQueueItem`), a failed one has the text link
  "Wiederholen" (`retryQueueItem`). Once analysed, `logDeferred` (`features/ai/queue.ts`) logs it as a normal group
  with the photo (first candidate, the model's grams) and removes it from the queue; changes go through the diary
  group editor. An analysis that ran right away still opens the review, and one without any usable item stays a
  normal review.
- Diary rows of an AI analysis are always a group row (`groupDiaryEntries` keeps a single entry with
  `aiAnalysisId` as a group: name, photo, group editor); other groups with one entry left show as a plain entry.
- Object URLs for blobs only via `useObjectUrl(blob, key)` (`components/MealPhoto.tsx`): StrictMode-safe,
  and with a key a re-read IndexedDB blob does not flicker. Never `useMemo(URL.createObjectURL)`.
- Typography: no em or en dashes in UI strings, comments or docs. The only dash is the missing-value
  placeholder `NO_VALUE` from `src/lib/format.ts`.
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
  `BarcodeScanSheet`, label photos via `LabelCaptureSheet` (both on `FullscreenOverlay`); a field filled from
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
  `fallbacks: 'default'`. Load the `claude-api` skill before changing it. In the meal photo analysis nutrients
  never come from the model (it names foods and grams, the app looks them up). `matchItem` (`ai/match.ts`) pushes
  dry and instant products (`DRY_WORDS`: "Kartoffelpüree Instantpulver") down unless the name says prepared or the
  item is the dry product; the prompt asks for search terms and grams of the food as eaten. The food label reading
  (`POST /api/ai/label`, `ai/label.ts`) is the one exception: the model only copies the printed values, never
  estimates, the barcode is kept only with a valid check digit (`cleanGtin`), and the person checks the filled
  form before saving.
- `/projects` is an SMB dataset: PostgreSQL data dirs cannot live there (0700 permissions), hence the dev DB
  in the home directory.
- Secrets: project `.env` (gitignored). Never print or commit them.

## Deployment

GitHub Actions (`.github/workflows/docker.yml`) builds `ghcr.io/david-stefan-hermann/fleisch-teufel` on push to
`main`; the user deploys `deploy/docker-compose.yml` in Dockge (port 30300 → 3000). No Docker inside this container.
