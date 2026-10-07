/**
 * Device side of the last-write-wins sync (see docs/sync.md).
 *
 *   push: send outbox records (≤ 500 per request); afterwards drop outbox entries whose record
 *         did not change meanwhile. Records the server rejects or already has newer are dropped
 *         from the outbox too — the newer server version arrives with the next pull.
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
  incomingWins,
  MAX_PUSH_RECORDS,
  type AnySyncRecord,
  type PullResult,
  type PushResult,
  type SyncTable,
} from '@ft/shared';
import { liveQuery, type Subscription } from 'dexie';
import type { UserDb } from '../db/dexie';

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error' | 'unauthorized';

export interface SyncState {
  status: SyncStatus;
  lastSyncAt: number | null;
  pending: number;
  error: string | null;
  rejected: number;
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

class HttpError extends Error {
  constructor(public readonly status: number) {
    super(`HTTP ${status}`);
  }
}

export class SyncEngine {
  private state: SyncState = { status: 'idle', lastSyncAt: null, pending: 0, error: null, rejected: 0 };
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
      try {
        do {
          this.again = false;
          this.set({ status: 'syncing', error: null });
          const p = await this.push();
          total.pushed += p.pushed;
          total.rejected += p.rejected;
          total.pulled += await this.pull();
        } while (this.again);
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
        } else {
          this.set({ status: 'offline', error: null });
        }
        throw e;
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.doFetch(path, init);
    if (!res.ok) throw new HttpError(res.status);
    return (await res.json()) as T;
  }

  async push(): Promise<{ pushed: number; rejected: number }> {
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
          for (const item of items) {
            const current = await this.db.syncTable(item.table).get(item.id);
            // Changed again while the request was in flight → keep it queued.
            if (!current || current.updatedAt === item.updatedAt) await this.db.outbox.delete(item.key);
          }
          if (result.rejected.length) {
            const prev = ((await this.db.kv.get(REJECTED_KEY))?.value as unknown[]) ?? [];
            const next = [...prev, ...result.rejected.map((r) => ({ ...r, at: Date.now() }))].slice(-50);
            await this.db.kv.put({ key: REJECTED_KEY, value: next });
            this.set({ rejected: next.length });
          }
        },
      );
      pushed += result.applied;
      rejectedCount += result.rejected.length;
      if (items.length < MAX_PUSH_RECORDS) break;
    }
    return { pushed, rejected: rejectedCount };
  }

  async pull(): Promise<number> {
    let applied = 0;
    const pageSize = this.opts.pullPageSize ?? 1000;
    for (;;) {
      const since = ((await this.db.kv.get(CURSOR_KEY))?.value as number) ?? 0;
      const page = await this.request<PullResult>(`/api/sync/pull?since=${since}&limit=${pageSize}`);
      const tables = [...new Set(page.changes.map((c) => c.table))];
      await this.db.transaction(
        'rw',
        [this.db.outbox, this.db.kv, ...tables.map((t) => this.db.syncTable(t))],
        async () => {
          for (const { table, data } of page.changes) {
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
    return applied;
  }

  /** Forget the cursor and re-download everything (repair tool in settings). */
  async resetAndPull(): Promise<number> {
    await this.db.kv.delete(CURSOR_KEY);
    return this.pull();
  }
}
