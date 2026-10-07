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
- Lists: `src/components/SwipeToDelete.tsx` wraps rows for swipe-left delete (always with an undo toast).
  Entries logged together from a saved meal share `groupId`; `groupDiaryEntries` (shared) builds diary rows.
- E2E: Playwright projects `chromium-iphone` (all specs) and `webkit-iphone` (`ios-layout.spec.ts`, needs
  `playwright install webkit`).
- Food search with a target: `?into=meal:<id>` / `ai:<localId>` on `/add`, `/food/$foodId`, `/scan`,
  `/custom-food/$id` adds to a saved meal / AI review instead of the diary (`src/lib/into.ts`; return via
  `rememberIntoStart`/`returnFromInto`). AI review state lives in `aiQueue.draft`, the open review in `/photo?review=`.
- Meal photos: `src/db/photos.ts` (device store + upload in `SyncEngine.push`), `components/MealPhoto.tsx`,
  API `routes/photos.ts`. Toasts sit at the bottom (iOS tints the status bar from top elements).
- Diary drag and drop: `features/diary/DiaryDnd.tsx` (dnd-kit, mouse + touch sensors, 300 ms long press);
  rows are wrapped in `DraggableRow`, `SwipeToDelete` gets `disabled` while a drag runs (`useDiaryDrag`).
  Moves go through `moveEntriesToMeal` (`src/db/entries.ts`).
- Add menu: one `AddSheetProvider` in the authed layout; open it with `useAddSheet().open({ date, meal })`.
- Object URLs for blobs only via `useObjectUrl(blob, key)` (`components/MealPhoto.tsx`): StrictMode-safe,
  and with a key a re-read IndexedDB blob does not flicker. Never `useMemo(URL.createObjectURL)`.
- Typography: no em or en dashes in UI strings, comments or docs. The only dash is the missing-value
  placeholder `NO_VALUE` from `src/lib/format.ts`.
- Charts: `src/components/Chart.tsx` (uPlot). One y-axis only; text uses ink tokens, never series colors.
  Macro colors were validated with the dataviz palette checker for light and dark.
- Numbers/dates via `src/lib/format.ts` (`Intl`, German), decimal input via `NumberField` (accepts `1,5`).
- AI: `apps/api/src/ai/*`: model `claude-opus-5-5` by default, structured output via `betaZodOutputFormat`,
  `fallbacks: 'default'`. Nutrients never come from the model. Load the `claude-api` skill before changing it.
- `/projects` is an SMB dataset: PostgreSQL data dirs cannot live there (0700 permissions), hence the dev DB
  in the home directory.
- Secrets: project `.env` (gitignored). Never print or commit them.

## Deployment

GitHub Actions (`.github/workflows/docker.yml`) builds `ghcr.io/david-stefan-hermann/fleisch-teufel` on push to
`main`; the user deploys `deploy/docker-compose.yml` in Dockge (port 30300 → 3000). No Docker inside this container.
