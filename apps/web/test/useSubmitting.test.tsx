import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSubmitting } from '@/hooks/useSubmitting';

const toastError = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: toastError, success: vi.fn() }) }));

afterEach(() => toastError.mockReset());

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useSubmitting', () => {
  it('ignores a second run while the first runs, is busy meanwhile and free again afterwards', async () => {
    const { result } = renderHook(() => useSubmitting());
    expect(result.current.busy).toBe(false);
    const first = deferred<string>();
    const fn = vi.fn(() => first.promise);
    let a!: Promise<string | undefined>;
    let b!: Promise<string | undefined>;
    act(() => {
      // Two taps in one frame see the same `run`.
      a = result.current.run(fn);
      b = result.current.run(fn);
    });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(true);
    await expect(b).resolves.toBeUndefined();
    await act(async () => {
      first.resolve('done');
      await a;
    });
    await expect(a).resolves.toBe('done');
    expect(result.current.busy).toBe(false);

    const again = vi.fn(async () => 'again');
    let c!: Promise<string | undefined>;
    await act(async () => {
      c = result.current.run(again);
      await c;
    });
    expect(again).toHaveBeenCalledTimes(1);
    await expect(c).resolves.toBe('again');
  });

  it('turns a failure into a toast and frees the button', async () => {
    const { result } = renderHook(() => useSubmitting());
    const failing = deferred<void>();
    let p!: Promise<void | undefined>;
    act(() => {
      p = result.current.run(() => failing.promise);
    });
    expect(result.current.busy).toBe(true);
    await act(async () => {
      failing.reject(new Error('kaputt'));
      await p;
    });
    await expect(p).resolves.toBeUndefined();
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0]![0]).toEqual(expect.any(String));
    expect(result.current.busy).toBe(false);
  });
});
