import { uuidv7, type StepsStatus } from '@ft/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserDb } from '@/db/dexie';

const answers: StepsStatus[] = [];
vi.mock('@/lib/api', () => ({
  api: vi.fn(async () => {
    const next = answers.shift();
    if (!next) throw new Error('offline');
    return next;
  }),
}));

const { fmtReceived, refreshStepsStatus, runStepsShortcut, STEPS_SHORTCUT_URL } = await import('@/lib/steps');

const db = () => new UserDb(`steps-${uuidv7()}`);
const status = (lastUsedAt: number | null): StepsStatus => ({ configured: true, createdAt: 1, lastUsedAt });

describe('steps status on the device', () => {
  it('remembers the last answer and keeps it offline', async () => {
    const d = db();
    answers.push(status(5));
    expect(await refreshStepsStatus(d)).toEqual(status(5));
    expect(await refreshStepsStatus(d)).toBeNull();
    expect((await d.kv.get('steps.status'))?.value).toEqual(status(5));
  });

  it('says when the last import came', () => {
    const at = (iso: string) => new Date(iso).getTime();
    expect(fmtReceived(at('2026-11-10T14:02:00'), '2026-11-10')).toBe('heute, 14:02');
    expect(fmtReceived(at('2026-11-09T22:00:00'), '2026-11-10')).toBe('gestern, 22:00');
    expect(fmtReceived(at('2026-11-03T08:15:00'), '2026-11-10')).toBe('3. November, 08:15');
  });
});

describe('↻ (run the shortcut)', () => {
  // Only timers and the clock: IndexedDB (fake-indexeddb) runs on setImmediate and must keep going.
  beforeEach(() =>
    vi.useFakeTimers({
      now: new Date('2026-11-10T14:00:00'),
      toFake: ['setTimeout', 'clearTimeout', 'Date'],
    }),
  );
  afterEach(() => vi.useRealTimers());

  it('opens the shortcut, waits until the server got its import, then syncs once', async () => {
    const d = db();
    const open = vi.fn();
    const sync = vi.fn(async () => {});
    // First answer: the import before the tap; second: the one the shortcut just sent.
    answers.push(status(Date.now() - 60_000), status(Date.now() + 3000));
    const done = runStepsShortcut(d, sync, open);
    expect(open).toHaveBeenCalledWith(STEPS_SHORTCUT_URL);
    expect(STEPS_SHORTCUT_URL).toBe('shortcuts://run-shortcut?name=Fleisch-Teufel%20Schritte');
    await vi.advanceTimersByTimeAsync(2000);
    expect(sync).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(await done).toBe('received');
    expect(sync).toHaveBeenCalledTimes(1);
    expect(answers).toEqual([]);
  });

  it('gives up after 30 seconds and still syncs', async () => {
    const sync = vi.fn(async () => {});
    const done = runStepsShortcut(db(), sync, () => {});
    // A second tap while the first waits starts nothing.
    expect(await runStepsShortcut(db(), sync, () => {})).toBe('unavailable');
    await vi.advanceTimersByTimeAsync(31_000);
    expect(await done).toBe('timeout');
    expect(sync).toHaveBeenCalledTimes(1);
  });
});
