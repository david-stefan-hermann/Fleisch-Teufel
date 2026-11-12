import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MIN_SPIN_MS, SyncIndicator, syncLabel } from '@/components/SyncIndicator';
import { rejectedReason, rejectedTitle } from '@/features/more/rejectedRecords';
import type { SyncState } from '@/sync/syncEngine';

/** A sync engine as the indicator sees it: a state to subscribe to and `sync()`. */
function fakeSync(initial: Partial<SyncState> = {}) {
  let state: SyncState = {
    status: 'idle',
    lastSyncAt: null,
    pending: 0,
    error: null,
    rejected: 0,
    needsUpdate: false,
    clockOffset: 0,
    ...initial,
  };
  const listeners = new Set<() => void>();
  return {
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getState: () => state,
    set: (patch: Partial<SyncState>) => {
      state = { ...state, ...patch };
      listeners.forEach((l) => l());
    },
    sync: vi.fn(async () => {}),
  };
}
let sync: ReturnType<typeof fakeSync>;
vi.mock('@/app/session', () => ({ useSession: () => ({ sync }) }));

const spinning = () => !!document.querySelector('svg.animate-spin');
const pass = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

describe('SyncIndicator', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('a tap shows the loading animation for at least a second, however fast the sync is', async () => {
    sync = fakeSync();
    render(<SyncIndicator />);
    expect(spinning()).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Noch nicht synchronisiert' }));
    expect(sync.sync).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Synchronisiere…' })).toBeTruthy();
    expect(spinning()).toBe(true);
    // The sync is done at once; the animation stays.
    await pass(MIN_SPIN_MS - 100);
    expect(spinning()).toBe(true);
    // A second tap meanwhile starts nothing.
    fireEvent.click(screen.getByRole('button'));
    expect(sync.sync).toHaveBeenCalledTimes(1);
    await pass(100);
    expect(spinning()).toBe(false);
    expect(screen.getByRole('button', { name: 'Noch nicht synchronisiert' })).toBeTruthy();
  });

  it('offline or failing: only the animation, then the icon of the real state', async () => {
    sync = fakeSync({ status: 'offline' });
    sync.sync.mockRejectedValue(new Error('offline'));
    render(<SyncIndicator />);
    fireEvent.click(screen.getByRole('button', { name: 'Offline. Daten sind auf dem Gerät' }));
    expect(spinning()).toBe(true);
    expect(screen.getByRole('button', { name: 'Synchronisiere…' })).toBeTruthy();
    await pass(MIN_SPIN_MS);
    expect(spinning()).toBe(false);
    expect(screen.getByRole('button', { name: 'Offline. Daten sind auf dem Gerät' })).toBeTruthy();
    expect(document.querySelector('svg.lucide-cloud-off')).toBeTruthy();
  });

  it('a slow sync spins until it is done; one the app started spins only while it runs', async () => {
    sync = fakeSync();
    let finish = () => {};
    sync.sync.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    render(<SyncIndicator />);
    fireEvent.click(screen.getByRole('button'));
    await pass(MIN_SPIN_MS * 3);
    expect(spinning()).toBe(true);
    await act(async () => finish());
    expect(spinning()).toBe(false);
    // Started by the app (no tap): no minimum.
    act(() => sync.set({ status: 'syncing' }));
    expect(spinning()).toBe(true);
    act(() => sync.set({ status: 'idle', lastSyncAt: Date.now() }));
    expect(spinning()).toBe(false);
  });

  it('names records the server refused and shows the warning icon while the list is not empty', () => {
    sync = fakeSync({ lastSyncAt: Date.now(), rejected: 2 });
    render(<SyncIndicator />);
    const button = screen.getByRole('button', { name: '2 Datensätze vom Server abgelehnt' });
    expect(button.className).toContain('text-warn-text');
    expect(document.querySelector('svg.lucide-triangle-alert')).toBeTruthy();
    act(() => sync.set({ rejected: 1 }));
    expect(screen.getByRole('button', { name: '1 Datensatz vom Server abgelehnt' })).toBeTruthy();
    act(() => sync.set({ rejected: 0 }));
    expect(screen.getByRole('button').getAttribute('aria-label')).toMatch(/^Synchronisiert/);
    expect(document.querySelector('svg.lucide-cloud')).toBeTruthy();
    // Offline wins: the rejected records wait for the next look at "Daten & Sync".
    expect(syncLabel({ ...sync.getState(), status: 'offline', rejected: 3 })).toBe(
      'Offline. Daten sind auf dem Gerät',
    );
  });

  it('does not touch its state after it is gone', async () => {
    sync = fakeSync();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = render(<SyncIndicator />);
    fireEvent.click(screen.getByRole('button'));
    unmount();
    await pass(MIN_SPIN_MS);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe('rejected records under "Daten & Sync"', () => {
  it('names the record and the reason in German', () => {
    expect(rejectedReason('id must be s:2026-11-10')).toBe('Doppelter Tageseintrag, gehört zu s:2026-11-10');
    expect(rejectedReason('kcal: Too big: expected number to be <=20000; nutrients.ENERCC: x; kcal: y')).toBe(
      'Ungültige Werte (kcal, nutrients)',
    );
    expect(rejectedReason('something else')).toBe('Ungültige Werte');
    expect(
      rejectedTitle({
        table: 'exerciseEntries',
        id: 'x',
        error: '',
        at: 1,
        record: { id: 'x', typeName: 'Schritte', date: '2026-11-10' } as never,
      }),
    ).toBe('Training · Schritte · 10.11.2026');
    expect(rejectedTitle({ table: 'settings', id: 'profile', error: '', at: 1 })).toBe(
      'Einstellungen · profile',
    );
  });
});
