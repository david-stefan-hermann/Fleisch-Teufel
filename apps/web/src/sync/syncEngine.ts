/**
 * Device side of the last-write-wins sync (see docs/sync.md).
 *
 *   push: send outbox records (≤ 500 per request); afterwards drop outbox entries whose record
 *         did not change meanwhile. Records the server rejects or already has newer are dropped
 *         from the outbox too; the newer server version arrives with the next pull.
 *   pull: fetch changes after the stored cursor and apply them with the shared LWW rule.
 *         A local version that is newer than the incoming one (pending upload) is kept.
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
  type AnySyncRecord,
  type PullResult,
  type PushResult,
  type SyncTable,
} from '@ft/shared';
import { liveQuery, type Subscription } from 'dexie';
import type { UserDb } from '../db/dexie';
import { PhotoHttpError, uploadPendingPhotos } from '../db/photos';

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
}

const CURSOR_KEY = 'sync.cursor';
const LAST_SYNC_KEY = 'sync.lastSyncAt';
const REJECTED_KEY = 'sync.rejected';
const CLOCK_OFFSET_KEY = 'sync.clockOffset';

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

  /** Wires automatic triggers (browser only). */
  start(): void {
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
          for (const item of items) {
            const current = await this.db.syncTable(item.table).get(item.id);
            if (!current) {
              await this.db.outbox.delete(item.key);
              continue;
            }
            // Changed again while the request was in flight → keep it queued as is.
            if (current.updatedAt !== item.updatedAt) continue;
            if (ahead.has(item.key) && result.serverTime) {
              const fixed = { ...current, updatedAt: Math.min(current.updatedAt, result.serverTime) };
              await this.db.syncTable(item.table).put(fixed);
              await this.db.outbox.put({ ...item, updatedAt: fixed.updatedAt });
              this.again = true;
              continue;
            }
            await this.db.outbox.delete(item.key);
          }
          const rejected = result.rejected.filter((r) => r.error !== CLOCK_AHEAD);
          if (rejected.length) {
            const prev = ((await this.db.kv.get(REJECTED_KEY))?.value as unknown[]) ?? [];
            const next = [...prev, ...rejected.map((r) => ({ ...r, at: Date.now() }))].slice(-50);
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
    for (;;) {
      const since = ((await this.db.kv.get(CURSOR_KEY))?.value as number) ?? 0;
      const page = await this.request<PullResult>(`/api/sync/pull?since=${since}&limit=${pageSize}`);
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
    if (unknown > 0 && !this.state.needsUpdate) this.set({ needsUpdate: true });
    return applied;
  }

  /** Forget the cursor and re-download everything (repair tool in settings). */
  async resetAndPull(): Promise<number> {
    await this.db.kv.delete(CURSOR_KEY);
    return this.pull();
  }
}
