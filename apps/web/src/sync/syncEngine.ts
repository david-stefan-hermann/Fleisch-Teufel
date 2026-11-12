/**
 * Device side of the last-write-wins sync (see docs/sync.md).
 *
 *   push: send outbox records (≤ 500 per request); afterwards drop outbox entries whose record
 *         did not change meanwhile. Records the server already has newer are dropped from the
 *         outbox too; the newer server version arrives with the next pull. A record the server
 *         rejects is deleted on the device (kept as a snapshot in `sync.rejected`) and the next pull
 *         starts from cursor 0, so the server's valid version of it comes back.
 *   pull: fetch changes after the stored cursor and apply them with the shared LWW rule.
 *         A local version that is newer than the incoming one (pending upload) is kept.
 *   epoch: the server names its database epoch in every pull. A new epoch or a `reset` answer (cursor
 *         above anything the server handed out) means the database was restored from a backup: every
 *         own record goes into the outbox again, photos are uploaded again, then the pull starts at 0.
 *
 * Runs on start, when the app becomes visible, when the device comes online, shortly after
 * local writes and on demand. iOS has no Background Sync, so there is no service-worker sync.
 * Single-flight: concurrent calls share one run, and a call during a run schedules one more.
 *
 * Free of `@/` aliases on purpose: the API test suite runs this engine against the real server.
 */
import {
  CLOCK_AHEAD,
  incomingWins,
  MAX_PUSH_RECORDS,
  SYNC_SCHEMAS,
  SYNC_TABLES,
  type AnySyncRecord,
  type PullResult,
  type PushResult,
  type SyncTable,
} from '@ft/shared';
import { liveQuery, type Subscription } from 'dexie';
import type { UserDb } from '../db/dexie';
import { PhotoHttpError, pruneLocalPhotos, uploadPendingPhotos } from '../db/photos';

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error' | 'unauthorized';

export interface SyncState {
  status: SyncStatus;
  lastSyncAt: number | null;
  pending: number;
  error: string | null;
  rejected: number;
  /** The server sent changes this app version does not know (a table or a shape): update the app. */
  needsUpdate: boolean;
  /** Server clock minus device clock (ms), see `UserDb.clockOffset`. */
  clockOffset: number;
}

export interface SyncSummary {
  pushed: number;
  pulled: number;
  rejected: number;
}

export interface SyncEngineOptions {
  /** Defaults to global fetch with same-origin credentials. */
  fetch?: (path: string, init?: RequestInit) => Promise<Response>;
  /** Called when the server answers 401 (session expired or revoked). */
  onUnauthorized?: () => void;
  /** Debounce after local writes (ms). */
  writeDebounceMs?: number;
  pullPageSize?: number;
  /**
   * Version of the running app. When changes were skipped as unknown (`needsUpdate`), the flag is
   * stored with this version; after an app update the next pull loads everything again.
   */
  appVersion?: string;
  /**
   * Called after the device noticed a restored server database and queued all its records again
   * (`reason`: `reset` = cursor above the server's sequence, `epoch` = another epoch than stored).
   */
  onReset?: (info: { epoch: string; records: number; reason: 'reset' | 'epoch' }) => void;
}

/** A record the server refused, as listed under "Daten & Sync" (`sync.rejected`, the last 50). */
export interface RejectedRecord {
  table: string;
  id: string | null;
  error: string;
  at: number;
  /** The record as it was on the device before it was dropped (`null` in older list entries). */
  record?: AnySyncRecord | null;
}

const CURSOR_KEY = 'sync.cursor';
const LAST_SYNC_KEY = 'sync.lastSyncAt';
const REJECTED_KEY = 'sync.rejected';
const CLOCK_OFFSET_KEY = 'sync.clockOffset';
/** `{ version }`: the app version that skipped unknown changes (see `SyncEngineOptions.appVersion`). */
const NEEDS_UPDATE_KEY = 'sync.needsUpdate';
/** Epoch of the server database this device last synced with (see `resetForEpoch`). */
const EPOCH_KEY = 'sync.epoch';
const MAX_REJECTED = 50;

class HttpError extends Error {
  constructor(public readonly status: number) {
    super(`HTTP ${status}`);
  }
}

/** Only a failed network request counts as offline; everything else is an error worth showing. */
function isNetworkError(e: unknown): boolean {
  return (
    e instanceof TypeError ||
    (e instanceof DOMException && (e.name === 'AbortError' || e.name === 'TimeoutError'))
  );
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export class SyncEngine {
  private state: SyncState = {
    status: 'idle',
    lastSyncAt: null,
    pending: 0,
    error: null,
    rejected: 0,
    needsUpdate: false,
    clockOffset: 0,
  };
  private listeners = new Set<(s: SyncState) => void>();
  private running: Promise<SyncSummary> | null = null;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private subs: Subscription[] = [];
  private cleanup: (() => void)[] = [];
  private readonly doFetch: (path: string, init?: RequestInit) => Promise<Response>;
  /** The next pull starts at cursor 0 (after a rejected record, an app update or on request). */
  private fullPull = false;
  private loaded: Promise<void> | null = null;

  constructor(
    private readonly db: UserDb,
    private readonly opts: SyncEngineOptions = {},
  ) {
    this.doFetch = opts.fetch ?? ((path, init) => fetch(path, { credentials: 'same-origin', ...init }));
  }

  getState(): SyncState {
    return this.state;
  }

  subscribe(listener: (s: SyncState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private set(patch: Partial<SyncState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  /**
   * Restores what a previous start left: the "update the app" flag, or, when the app was updated since
   * it was set, a full pull that loads the skipped changes. Once per engine, before the first sync.
   */
  private load(): Promise<void> {
    this.loaded ??= (async () => {
      const stored = (await this.db.kv.get(NEEDS_UPDATE_KEY))?.value as { version?: unknown } | undefined;
      if (!stored) return;
      if (stored.version === (this.opts.appVersion ?? null)) this.set({ needsUpdate: true });
      else this.fullPull = true;
    })().catch((e: unknown) => {
      this.loaded = null; // a storage error now must not block every later sync
      throw e;
    });
    return this.loaded;
  }

  /** Wires automatic triggers (browser only). */
  start(): void {
    void this.load().catch(() => {});
    void this.db.kv.get(LAST_SYNC_KEY).then((v) => this.set({ lastSyncAt: (v?.value as number) ?? null }));
    void this.db.kv
      .get(REJECTED_KEY)
      .then((v) => this.set({ rejected: ((v?.value as unknown[]) ?? []).length }));
    void this.db.kv.get(CLOCK_OFFSET_KEY).then((v) => {
      const offset = typeof v?.value === 'number' ? v.value : 0;
      // Writes before the first server answer of this start still use the last known offset.
      if (this.db.clockOffset === 0) this.db.clockOffset = offset;
      this.set({ clockOffset: this.db.clockOffset });
    });
    this.subs.push(
      liveQuery(() => this.db.outbox.count()).subscribe((n) => {
        const grew = n > this.state.pending;
        this.set({ pending: n });
        if (grew) this.schedule(this.opts.writeDebounceMs ?? 800);
      }),
    );
    if (typeof window !== 'undefined') {
      // Visible: fetch what other devices wrote. Hidden (app switched away / closed on iOS): push now.
      const onVisible = () => this.schedule(0);
      const onOnline = () => this.schedule(0);
      document.addEventListener('visibilitychange', onVisible);
      window.addEventListener('online', onOnline);
      window.addEventListener('focus', onOnline);
      const interval = setInterval(
        () => document.visibilityState === 'visible' && this.schedule(0),
        5 * 60_000,
      );
      this.cleanup.push(() => {
        document.removeEventListener('visibilitychange', onVisible);
        window.removeEventListener('online', onOnline);
        window.removeEventListener('focus', onOnline);
        clearInterval(interval);
      });
    }
    this.schedule(0);
  }

  stop(): void {
    for (const s of this.subs) s.unsubscribe();
    for (const c of this.cleanup) c();
    this.subs = [];
    this.cleanup = [];
    if (this.timer) clearTimeout(this.timer);
  }

  schedule(delayMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.sync().catch(() => {});
    }, delayMs);
  }

  /** Push then pull until both are drained. */
  sync(): Promise<SyncSummary> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      const total: SyncSummary = { pushed: 0, pulled: 0, rejected: 0 };
      let photoError: Error | null = null;
      try {
        await this.load();
        do {
          this.again = false;
          this.set({ status: 'syncing', error: null });
          const p = await this.push();
          total.pushed += p.pushed;
          total.rejected += p.rejected;
          photoError ??= p.photoError;
          total.pulled += await this.pull();
        } while (this.again);
        // Records went both ways; a photo that could not be uploaded is reported now, retried next run.
        if (photoError)
          throw photoError instanceof PhotoHttpError ? new HttpError(photoError.status) : photoError;
        // Uploaded photos nothing references any more (deleted on another device) leave this device too.
        await pruneLocalPhotos(this.db);
        const now = Date.now();
        await this.db.kv.put({ key: LAST_SYNC_KEY, value: now });
        this.set({ status: 'idle', lastSyncAt: now, pending: await this.db.outbox.count() });
        return total;
      } catch (e) {
        if (e instanceof HttpError && e.status === 401) {
          this.set({ status: 'unauthorized', error: 'Sitzung abgelaufen' });
          this.opts.onUnauthorized?.();
        } else if (e instanceof HttpError) {
          this.set({ status: 'error', error: `Server-Fehler (${e.status})` });
        } else if (isNetworkError(e)) {
          this.set({ status: 'offline', error: null });
        } else {
          this.set({ status: 'error', error: errorText(e) });
        }
        throw e;
      } finally {
        this.running = null;
        // A write that happened during a failed run must not wait for the next trigger.
        if (this.again) {
          this.again = false;
          this.schedule(5_000);
        }
      }
    })();
    return this.running;
  }

  private async request<T extends { serverTime?: number }>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.doFetch(path, init);
    if (!res.ok) throw new HttpError(res.status);
    const body = (await res.json()) as T;
    if (typeof body.serverTime === 'number') await this.noteServerTime(body.serverTime);
    return body;
  }

  /** Measures the device clock against the server's (request latency is noise at this scale). */
  private async noteServerTime(serverTime: number): Promise<void> {
    const offset = serverTime - Date.now();
    // Below a few seconds the clock is fine; do not shift versions around for network jitter.
    const next = Math.abs(offset) < 5_000 ? 0 : offset;
    if (next === this.db.clockOffset) return;
    this.db.clockOffset = next;
    this.set({ clockOffset: next });
    await this.db.kv.put({ key: CLOCK_OFFSET_KEY, value: next });
  }

  async push(): Promise<{ pushed: number; rejected: number; photoError: Error | null }> {
    // Photos first, so a meal never arrives on another device before its photo. A failed upload
    // (429 after many analyses, 5xx) is reported after the records went through, not instead.
    const photos = await uploadPendingPhotos(this.db, this.doFetch);
    if (photos.error instanceof PhotoHttpError && photos.error.status === 401) throw new HttpError(401);
    let pushed = 0;
    let rejectedCount = 0;
    for (;;) {
      const items = await this.db.outbox.limit(MAX_PUSH_RECORDS).toArray();
      if (items.length === 0) break;
      const records: { table: SyncTable; data: AnySyncRecord }[] = [];
      for (const item of items) {
        const data = await this.db.syncTable(item.table).get(item.id);
        if (data) records.push({ table: item.table, data });
      }
      const result = await this.request<PushResult>('/api/sync/push', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ records }),
      });
      await this.db.transaction(
        'rw',
        [this.db.outbox, this.db.kv, ...items.map((i) => this.db.syncTable(i.table))],
        async () => {
          // Versions from the future (device clock was ahead): stamp them with the server time
          // and send them again instead of dropping them.
          const ahead = new Set(
            result.rejected.filter((r) => r.error === CLOCK_AHEAD).map((r) => `${r.table}:${r.id}`),
          );
          const rejected = result.rejected.filter((r) => r.error !== CLOCK_AHEAD);
          const refused = new Map(rejected.map((r) => [`${r.table}:${r.id}`, r]));
          const listed: RejectedRecord[] = rejected
            .filter((r) => r.id === null)
            .map((r) => ({ ...r, at: Date.now(), record: null }));
          for (const item of items) {
            const t = this.db.syncTable(item.table);
            const current = await t.get(item.id);
            if (!current) {
              await this.db.outbox.delete(item.key);
              continue;
            }
            // Changed again while the request was in flight → keep it queued as is.
            if (current.updatedAt !== item.updatedAt) continue;
            if (ahead.has(item.key) && result.serverTime) {
              const fixed = { ...current, updatedAt: Math.min(current.updatedAt, result.serverTime) };
              await t.put(fixed);
              await this.db.outbox.put({ ...item, updatedAt: fixed.updatedAt });
              this.again = true;
              continue;
            }
            const refusal = refused.get(item.key);
            if (refusal) {
              // The server never takes this version. Kept here it would count on this device only
              // (a tombstone would be sent again), so it goes; the full pull brings the server's.
              await t.delete(item.id);
              listed.push({ ...refusal, at: Date.now(), record: current });
              this.fullPull = true;
            }
            await this.db.outbox.delete(item.key);
          }
          if (listed.length) {
            const prev = ((await this.db.kv.get(REJECTED_KEY))?.value as RejectedRecord[]) ?? [];
            const next = [...prev, ...listed].slice(-MAX_REJECTED);
            await this.db.kv.put({ key: REJECTED_KEY, value: next });
            this.set({ rejected: next.length });
          }
        },
      );
      pushed += result.applied;
      rejectedCount += result.rejected.filter((r) => r.error !== CLOCK_AHEAD).length;
      if (items.length < MAX_PUSH_RECORDS) break;
    }
    return { pushed, rejected: rejectedCount, photoError: photos.error };
  }

  async pull(): Promise<number> {
    let applied = 0;
    let unknown = 0;
    const pageSize = this.opts.pullPageSize ?? 1000;
    // The flag is cleared only after the last page: a pull cut off halfway starts at 0 again.
    const full = this.fullPull;
    if (full) await this.db.kv.delete(CURSOR_KEY);
    for (;;) {
      const since = ((await this.db.kv.get(CURSOR_KEY))?.value as number) ?? 0;
      const page = await this.request<PullResult>(`/api/sync/pull?since=${since}&limit=${pageSize}`);
      const stored = (await this.db.kv.get(EPOCH_KEY))?.value as string | undefined;
      if (page.reset || (page.epoch && stored && page.epoch !== stored)) {
        await this.resetForEpoch(page.epoch ?? stored!, page.reset ? 'reset' : 'epoch');
        // sync() runs push and pull again: everything goes up first (LWW decides), then a pull from 0.
        return applied;
      }
      if (page.epoch && !stored) await this.db.kv.put({ key: EPOCH_KEY, value: page.epoch });
      // Changes this app version cannot store (a table or a shape added by a newer version) are
      // skipped, not fatal: the cursor still moves, so an outdated device keeps syncing the rest.
      const changes = page.changes.filter(({ table, data }) => {
        const schema = Object.hasOwn(SYNC_SCHEMAS, table) ? SYNC_SCHEMAS[table] : null;
        const ok = schema && this.db.tables.some((t) => t.name === table) && schema.safeParse(data).success;
        if (!ok) unknown++;
        return ok;
      });
      const tables = [...new Set(changes.map((c) => c.table))];
      await this.db.transaction(
        'rw',
        [this.db.outbox, this.db.kv, ...tables.map((t) => this.db.syncTable(t))],
        async () => {
          for (const { table, data } of changes) {
            const t = this.db.syncTable(table);
            const local = await t.get(data.id);
            if (incomingWins(local, data)) {
              await t.put(data);
              // Our pending version lost against a newer one from another device.
              await this.db.outbox.delete(`${table}:${data.id}`);
              applied++;
            }
          }
          await this.db.kv.put({ key: CURSOR_KEY, value: page.cursor });
        },
      );
      if (!page.hasMore) break;
    }
    if (full) this.fullPull = false;
    if (unknown > 0) {
      // Kept across starts; after an app update `load()` turns it into a full pull.
      await this.db.kv.put({ key: NEEDS_UPDATE_KEY, value: { version: this.opts.appVersion ?? null } });
      if (!this.state.needsUpdate) this.set({ needsUpdate: true });
    } else if (full) {
      // Everything from cursor 0 fitted this version: nothing is missing any more.
      await this.db.kv.delete(NEEDS_UPDATE_KEY);
      if (this.state.needsUpdate) this.set({ needsUpdate: false });
    }
    return applied;
  }

  /**
   * The server database was restored: what this device wrote after the backup exists only here. Queues
   * every own record (tombstones too) and every uploaded photo again and forgets the cursor, in one
   * transaction; the server keeps whichever version is newer.
   */
  private async resetForEpoch(epoch: string, reason: 'reset' | 'epoch'): Promise<void> {
    const tables = SYNC_TABLES.filter((t) => this.db.tables.some((x) => x.name === t));
    let records = 0;
    await this.db.transaction(
      'rw',
      [this.db.outbox, this.db.kv, this.db.photos, ...tables.map((t) => this.db.syncTable(t))],
      async () => {
        await this.db.kv.delete(CURSOR_KEY);
        await this.db.kv.put({ key: EPOCH_KEY, value: epoch });
        for (const t of tables) {
          const rows = await this.db.syncTable(t).toArray();
          await this.db.outbox.bulkPut(
            rows.map((r) => ({ key: `${t}:${r.id}`, table: t, id: r.id, updatedAt: r.updatedAt })),
          );
          records += rows.length;
        }
        // Photos the server refused for good (2) stay refused.
        await this.db.photos.where('uploaded').equals(1).modify({ uploaded: 0 });
      },
    );
    this.again = true;
    this.opts.onReset?.({ epoch, records, reason });
  }

  /** Empties the list of records the server rejected ("Daten & Sync"). */
  async clearRejected(): Promise<void> {
    await this.db.kv.delete(REJECTED_KEY);
    this.set({ rejected: 0 });
  }

  /** Forget the cursor and re-download everything (repair tool in settings). */
  async resetAndPull(): Promise<number> {
    this.fullPull = true;
    return this.pull();
  }
}
