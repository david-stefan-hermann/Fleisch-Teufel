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
- The trash shows tombstones of `PURGEABLE_TABLES` (`weightEntries`, `meals`, `exerciseTemplates`,
  `exerciseEntries` for steps) with `deleted && !purgedAt`. "Endgültig löschen" never removes a tombstone:
  `purgeRecords` sets the synced `purgedAt` (a normal write). `writeRecord` clears `purgedAt` whenever a
  record of those tables is written alive (restore, a new weight on the same day), so a later delete puts
  it back into the trash. New records of those tables need no `purgedAt` in `saveRecord` (it defaults to null).
- **Never rebuild a stored record from form fields when saving.** A device with an older app version
  does not know fields a newer version added; a record rebuilt from its form sets them to `null` on the
  server (the upsert writes every column). Change fields with `patchRecord`, or save a form with
  `upsertRecord(db, table, id, (prev) => fields)`, which writes the fields over the record as stored
  (read in the write transaction). `saveRecord` only for records that are new or wholly replaced.
- The write helpers check what the server's push checks (Zod schema and the fixed id of one-per-day
  records, `requiredId`): a wrong id throws `id must be <expected>` before it reaches the outbox.
- A JSON backup comes back through `importRecord` (keeps the backup's `updatedAt`, LWW decides), never
  `saveRecord` (a fresh version would beat newer changes and deletions on the server).
- Read with `useLiveQuery` (dexie-react-hooks) so pulls from other devices re-render automatically.
- Keep `apps/web/src/db/*` and `apps/web/src/sync/*` free of `@/` imports: the API test suite imports
  them to run real device ↔ server tests.

## Sync engine: rejections and server restores

- A record the server refuses for good (Zod, wrong id) leaves the outbox only when it did not change during
  the push; it lands in the device list of rejected records ("Daten & Sync", cloud warning) and the server
  logs it as `warn`. Never drop outbox rows silently elsewhere.
- Every pull answers the server's `epoch` (`app_meta` `sync_epoch`). On `reset: true` or an epoch the device
  has not seen (`kv` `sync.epoch`), the device puts all its own records (tombstones too) back into the outbox,
  marks uploaded photos as waiting and pulls from cursor 0, all without a dialog. Any change that bypasses
  `write.ts` would be missing from that re-upload. Details in `docs/sync.md` ("Epoche").
- Pulled changes an older app cannot parse are skipped and flagged (`kv` `sync.needsUpdate` with the app
  version); the next app version pulls from 0 again and fetches them.

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
- Images in IndexedDB: store `ArrayBuffer` + type, never a `Blob` in a record that is written again.
  WebKit keeps IndexedDB Blobs as files; a Blob read before its record was rewritten can no longer be
  read (`WebKitBlobResource error 1`, broken thumbnails). Meal photos (`photos.bytes`) and AI queue
  photos (own table `aiImages`, Dexie v4) follow this; build Blobs in memory with `photoBlob`/`imageBlob`.
