import { uuidv7 } from '@ft/shared';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BarcodeScanner, TorchButton, type TorchState } from '@/components/BarcodeScanner';
import { CalorieRing } from '@/components/CalorieRing';
import { MacroBars } from '@/components/MacroBars';
import { useObjectUrl, usePhotoBlobFrom } from '@/components/MealPhoto';
import { NumberField } from '@/components/NumberField';
import { SwipeToDelete } from '@/components/SwipeToDelete';
import { UserDb } from '@/db/dexie';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Harness({ initial }: { initial: number | null }) {
  const [v, setV] = useState<number | null>(initial);
  return (
    <>
      <NumberField label="Menge" value={v} onValueChange={setV} />
      <button onClick={() => setV((v ?? 0) + 1)}>plus</button>
      <output data-testid="value">{String(v)}</output>
    </>
  );
}

describe('NumberField', () => {
  it('accepts decimal commas and reports numbers', () => {
    render(<Harness initial={null} />);
    fireEvent.change(screen.getByLabelText('Menge'), { target: { value: '1,5' } });
    expect(screen.getByTestId('value').textContent).toBe('1.5');
    fireEvent.change(screen.getByLabelText('Menge'), { target: { value: '' } });
    expect(screen.getByTestId('value').textContent).toBe('null');
  });

  it('follows external value changes without clobbering typing', () => {
    render(<Harness initial={2} />);
    const input = screen.getByLabelText('Menge') as HTMLInputElement;
    expect(input.value).toBe('2');
    fireEvent.click(screen.getByText('plus'));
    expect(input.value).toBe('3');
    fireEvent.change(input, { target: { value: '3,' } });
    expect(input.value).toBe('3,');
  });
});

describe('CalorieRing', () => {
  it('shows remaining and over-budget states', () => {
    const { rerender } = render(<CalorieRing eaten={1500} budget={2000} />);
    expect(screen.getByText('500')).toBeTruthy();
    expect(screen.getByText('kcal übrig')).toBeTruthy();
    rerender(<CalorieRing eaten={2300} budget={2000} />);
    expect(screen.getByText('kcal zu viel')).toBeTruthy();
  });
});

describe('MacroBars', () => {
  it('exposes values as accessible meters', () => {
    render(<MacroBars macros={[{ key: 'protein', label: 'Protein', value: 80, target: 150 }]} />);
    const meter = screen.getByRole('meter', { name: 'Protein' });
    expect(meter.getAttribute('aria-valuenow')).toBe('80');
  });
});

describe('SwipeToDelete', () => {
  function Row({
    onDelete,
    onOpen,
    disabled,
  }: {
    onDelete: () => void;
    onOpen: () => void;
    disabled?: boolean;
  }) {
    return (
      <SwipeToDelete label="Kaffee löschen" onDelete={onDelete} disabled={disabled}>
        <button type="button" onClick={onOpen}>
          Kaffee
        </button>
      </SwipeToDelete>
    );
  }
  const swipe = (el: Element, dx: number, dy = 0) => {
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 200, clientY: 100, button: 0, pointerType: 'touch' });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 200 + dx / 2, clientY: 100 + dy / 2 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 200 + dx, clientY: 100 + dy });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 200 + dx, clientY: 100 + dy });
  };

  it('reveals the delete button on a left swipe without opening the row', () => {
    let deleted = 0;
    let opened = 0;
    render(<Row onDelete={() => deleted++} onOpen={() => opened++} />);
    const row = screen.getByText('Kaffee');
    const action = screen.getByLabelText('Kaffee löschen', { selector: 'button' });
    expect(action.tabIndex).toBe(-1);
    swipe(row, -120);
    fireEvent.click(row); // the click that follows the gesture
    expect(opened).toBe(0);
    expect(action.tabIndex).toBe(0);
    fireEvent.click(action);
    expect(deleted).toBe(1);
  });

  it('keeps taps and vertical scrolls as normal interactions', () => {
    let opened = 0;
    render(<Row onDelete={() => {}} onOpen={() => opened++} />);
    const row = screen.getByText('Kaffee');
    swipe(row, 0, 80);
    fireEvent.click(row);
    expect(opened).toBe(1);
    expect(screen.getByLabelText('Kaffee löschen', { selector: 'button' }).tabIndex).toBe(-1);
  });

  it('snaps back on a short swipe and closes an open row on tap', () => {
    let opened = 0;
    render(<Row onDelete={() => {}} onOpen={() => opened++} />);
    const row = screen.getByText('Kaffee');
    const action = screen.getByLabelText('Kaffee löschen', { selector: 'button' });
    swipe(row, -20);
    fireEvent.click(row);
    expect(action.tabIndex).toBe(-1);
    swipe(row, -120);
    fireEvent.click(row);
    expect(action.tabIndex).toBe(0);
    fireEvent.pointerDown(row, { pointerId: 2, clientX: 10, clientY: 10, button: 0 });
    fireEvent.pointerUp(row, { pointerId: 2, clientX: 10, clientY: 10 });
    fireEvent.click(row);
    expect(action.tabIndex).toBe(-1);
    expect(opened).toBe(0);
  });
});

describe('SwipeToDelete while disabled', () => {
  const swipe = (el: Element, dx: number) => {
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 200, clientY: 100, button: 0, pointerType: 'touch' });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 200 + dx / 2, clientY: 100 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 200 + dx, clientY: 100 });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 200 + dx, clientY: 100 });
  };
  function Row({ disabled }: { disabled: boolean }) {
    return (
      <SwipeToDelete label="Kaffee löschen" onDelete={() => {}} disabled={disabled}>
        <span>Kaffee</span>
      </SwipeToDelete>
    );
  }
  const action = () => screen.getByLabelText('Kaffee löschen', { selector: 'button' });

  it('ignores gestures when disabled', () => {
    render(<Row disabled />);
    swipe(screen.getByText('Kaffee'), -120);
    expect(action().tabIndex).toBe(-1);
    expect(action().className).toContain('invisible');
  });

  it('closes an open row when it gets disabled (a drag starts)', () => {
    const { rerender } = render(<Row disabled={false} />);
    swipe(screen.getByText('Kaffee'), -120);
    expect(action().tabIndex).toBe(0);
    rerender(<Row disabled />);
    expect(action().tabIndex).toBe(-1);
    rerender(<Row disabled={false} />);
    swipe(screen.getByText('Kaffee'), -120);
    expect(action().tabIndex).toBe(0);
  });
});

describe('useObjectUrl', () => {
  let created: string[];
  let revoked: string[];
  beforeEach(() => {
    created = [];
    revoked = [];
    let n = 0;
    // jsdom has no object URLs.
    URL.createObjectURL = vi.fn(() => {
      const url = `blob:test/${++n}`;
      created.push(url);
      return url;
    });
    URL.revokeObjectURL = vi.fn((url: string) => void revoked.push(url));
  });

  function Img({ blob, k }: { blob: Blob | null; k?: string }) {
    const url = useObjectUrl(blob, k);
    return url ? <img alt="Foto" src={url} /> : <span>leer</span>;
  }
  const src = () => screen.getByRole('img').getAttribute('src');

  it('keeps a valid URL after the StrictMode double mount', () => {
    const blob = new Blob(['a'], { type: 'image/jpeg' });
    render(
      <StrictMode>
        <Img blob={blob} />
      </StrictMode>,
    );
    expect(created.length).toBeGreaterThan(0);
    expect(src()).toBe(created.at(-1));
    expect(revoked).not.toContain(src());
  });

  it('revokes the old URL on a new blob and on unmount', () => {
    const { rerender, unmount } = render(<Img blob={new Blob(['a'])} />);
    const first = src();
    rerender(<Img blob={new Blob(['bb'])} />);
    expect(src()).not.toBe(first);
    expect(revoked).toEqual([first]);
    const second = src();
    rerender(<Img blob={null} />);
    expect(screen.getByText('leer')).toBeTruthy();
    expect(revoked).toEqual([first, second]);
    rerender(<Img blob={new Blob(['c'])} />);
    unmount();
    expect(revoked).toHaveLength(3);
  });

  it('treats a re-read blob with the same key as unchanged (no flicker)', () => {
    const { rerender } = render(<Img blob={new Blob(['abc'], { type: 'image/jpeg' })} k="ai:1" />);
    const first = src();
    // IndexedDB hands out a new Blob object on every live query run.
    rerender(<Img blob={new Blob(['abc'], { type: 'image/jpeg' })} k="ai:1" />);
    rerender(<Img blob={new Blob(['abc'], { type: 'image/jpeg' })} k="ai:1" />);
    expect(src()).toBe(first);
    expect(created).toHaveLength(1);
    expect(revoked).toEqual([]);
    // Another key (or content of another size) is a new image.
    rerender(<Img blob={new Blob(['abc'], { type: 'image/jpeg' })} k="ai:2" />);
    expect(src()).not.toBe(first);
    expect(revoked).toEqual([first]);
  });
});

describe('usePhotoBlob', () => {
  function Probe({ db, id, fetchFn }: { db: UserDb; id: string; fetchFn: typeof fetch }) {
    const blob = usePhotoBlobFrom(db, id, fetchFn);
    return (
      <output>{blob === undefined ? 'loading' : blob === null ? 'missing' : `size ${blob.size}`}</output>
    );
  }

  it('retries a failed download when the device comes back online', async () => {
    const db = new UserDb(`c-${uuidv7()}`);
    const id = uuidv7();
    let online = false;
    const fetchFn = vi.fn(async () => {
      if (!online) throw new TypeError('offline');
      // (a jsdom Blob cannot be a Node Response body)
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 1, 2]), {
        headers: { 'content-type': 'image/jpeg' },
      });
    });
    render(<Probe db={db} id={id} fetchFn={fetchFn as unknown as typeof fetch} />);
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('status').textContent).toBe('missing');
    online = true;
    act(() => void window.dispatchEvent(new Event('online')));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('size 5'));
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect((await db.photos.get(id))?.uploaded).toBe(1);
  });

  it('shares one attempt between components and waits before retrying', async () => {
    const db = new UserDb(`c-${uuidv7()}`);
    const id = uuidv7();
    const fetchFn = vi.fn(async () => new Response('', { status: 404 }));
    render(
      <>
        <Probe db={db} id={id} fetchFn={fetchFn as unknown as typeof fetch} />
        <Probe db={db} id={id} fetchFn={fetchFn as unknown as typeof fetch} />
      </>,
    );
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('torch', () => {
  function fakeCamera(torch: boolean) {
    const applyConstraints = vi.fn(async () => {});
    const track = { getCapabilities: () => ({ torch }), applyConstraints, stop: vi.fn() };
    const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: { getUserMedia: vi.fn(async () => stream) },
    });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    return applyConstraints;
  }

  function Overlay() {
    const [torch, setTorch] = useState<TorchState>(null);
    return (
      <BarcodeScanner frame="photo" onDetected={() => {}} onError={() => {}} onTorchState={setTorch}>
        {torch ? <TorchButton torch={torch} /> : <span>kein Licht</span>}
      </BarcodeScanner>
    );
  }

  it('hands the torch to the parent overlay as an icon toggle', async () => {
    const applyConstraints = fakeCamera(true);
    render(<Overlay />);
    const button = await screen.findByRole('button', { name: 'Licht einschalten' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getAllByRole('button')).toHaveLength(1); // no second toggle from the scanner
    fireEvent.click(button);
    expect(applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] });
    const on = screen.getByRole('button', { name: 'Licht ausschalten' });
    expect(on.getAttribute('aria-pressed')).toBe('true');
  });

  it('reports no torch when the camera has none', async () => {
    fakeCamera(false);
    render(<Overlay />);
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());
    expect(screen.getByText('kein Licht')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows its own toggle top right without a parent overlay', async () => {
    fakeCamera(true);
    render(<BarcodeScanner onDetected={() => {}} onError={() => {}} />);
    const button = await screen.findByRole('button', { name: 'Licht einschalten' });
    expect(button.className).toContain('top-3');
  });
});
