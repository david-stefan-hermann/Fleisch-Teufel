---
name: offline-sync
description: Rules for changing Fleisch-Teufel's offline data layer — Dexie schema/migrations, synced entities, the LWW sync engine, the service worker (vite-plugin-pwa injectManifest) and iOS PWA pitfalls. Use when adding or changing a synced table/field, touching apps/web/src/db, apps/web/src/sync, apps/web/src/sw.ts, apps/api/src/sync or apps/api/src/db/schema.ts.
---

# Offline data & sync in Fleisch-Teufel

Read `docs/sync.md` first. The invariants below are what breaks silently if forgotten.

## Adding a field to a synced entity

1. `packages/shared/src/schemas.ts`: add it to the Zod schema (wire shape, camelCase). New fields must be
   **nullable or have a default in code**, because old devices send records without them until updated:
   prefer `.nullable()` and treat `null` as "unset". Never make an existing field stricter.
2. `apps/api/src/db/schema.ts`: add the column with the same TS key (snake_case is automatic), nullable.
   Run `pnpm --filter @ft/api db:generate --name <change>` and commit the SQL in `apps/api/drizzle/`.
3. Dexie: only **indexed** fields need a schema change. If you index a new field, add
   `this.version(N+1).stores({...})` in `apps/web/src/db/dexie.ts` (never edit an existing version).
4. Tests: extend the round-trip test in `apps/api/test/sync.test.ts`.

## Adding a new synced table

Shared schema + `SYNC_SCHEMAS` entry, Drizzle table using `syncColumns()`/`syncExtras` and an entry in
`syncTables`, Dexie store in a new version, migration. If the entity is "one per day/key", give it a
deterministic id and add it to `requiredId()` so offline devices converge.

## Writing data in the app

- Always write synced tables through `saveRecord` / `patchRecord` / `deleteRecord` (`apps/web/src/db/write.ts`).
  They bump `updatedAt` monotonically, validate with Zod and enqueue the outbox **in one transaction**.
  Never `db.<table>.put()` a synced record directly — it would never upload.
- Deletes are soft (`deleted: true`); all queries filter `!deleted`. Offer undo via `restoreRecord`.
- Read with `useLiveQuery` (dexie-react-hooks) so pulls from other devices re-render automatically.
- Keep `apps/web/src/db/*` and `apps/web/src/sync/*` free of `@/` imports: the API test suite imports
  them to run real device ↔ server tests.

## Service worker / PWA

- `apps/web/src/sw.ts` (Workbox injectManifest) precaches the shell, `/data/bls-compact.json` and the
  ZXing wasm. API calls are never cached. Raising `maximumFileSizeToCacheInBytes` is needed for big assets.
- Updates use the "prompt" flow (`useUpdateReady` → banner → `SKIP_WAITING`). Don't switch to auto-update:
  a reload mid-entry loses form state.
- `index.html` and `sw.js` must be served `no-cache`; hashed `/assets/*` immutable (done in `apps/api/src/app.ts`).

## iOS pitfalls

- Storage is only durable for home-screen apps (else Safari may evict after 7 days) → install hint banner,
  `navigator.storage.persist()`.
- No Background Sync, no periodic sync: sync on start / visibility change / `online`.
- Camera: `getUserMedia({ video: { facingMode: 'environment' } })` + `<video playsInline muted>`; file inputs
  with `capture="environment"` for photos. Inputs need ≥ 16 px font or Safari zooms.
- `viewport-fit=cover` + `env(safe-area-inset-*)` (`--safe-top`/`--safe-bottom` tokens).
