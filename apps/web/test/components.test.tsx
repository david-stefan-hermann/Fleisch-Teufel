import { targetsForDate, uuidv7 } from '@ft/shared';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BarcodeScanner, TorchButton, type TorchState } from '@/components/BarcodeScanner';
import { CalorieRing } from '@/components/CalorieRing';
import { MacroBars } from '@/components/MacroBars';
import { NutrientBreakdown } from '@/components/NutrientBreakdown';
import { MealPhoto, PHOTO_DECODE_ATTEMPTS, useObjectUrl, usePhotoBlobFrom } from '@/components/MealPhoto';
import { NumberField } from '@/components/NumberField';
import { SwipeToDelete } from '@/components/SwipeToDelete';
import { UserDb } from '@/db/dexie';
import { NO_VALUE } from '@/lib/format';

// MealPhoto reads the database from the session; components here only need a throwaway one.
vi.mock('@/app/session', () => ({ useDb: () => sessionDb }));
let sessionDb: UserDb;
beforeEach(() => {
  sessionDb = new UserDb(`s-${uuidv7()}`);
});

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
  const width = (el: Element | null) => Number.parseFloat((el as HTMLElement).style.width);

  it('exposes values as accessible meters', () => {
    render(<MacroBars macros={[{ key: 'protein', label: 'Protein', value: 80, target: 150 }]} />);
    const meter = screen.getByRole('meter', { name: 'Protein' });
    expect(meter.getAttribute('aria-valuenow')).toBe('80');
    expect(width(meter.querySelector('[data-part=fill]'))).toBeCloseTo(53.3, 1);
    expect(meter.querySelector('[data-part=excess]')).toBeNull();
  });

  it('lays the excess over a full bar in red', () => {
    render(<MacroBars macros={[{ key: 'fat', label: 'Fett', value: 76, target: 55 }]} />);
    const meter = screen.getByRole('meter', { name: 'Fett' });
    expect(width(meter.querySelector('[data-part=fill]'))).toBe(100);
    const excess = meter.querySelector('[data-part=excess]')!;
    expect(excess.className).toContain('bg-over');
    expect(width(excess)).toBeCloseTo(38.2, 1);
    expect(screen.getByText('76').className).toContain('text-over');
  });

  it('caps the excess at the full width and ignores rounding noise', () => {
    render(
      <MacroBars
        macros={[
          { key: 'carbs', label: 'Kohlenhydrate', value: 400, target: 100 },
          { key: 'protein', label: 'Protein', value: 55.3, target: 55 },
        ]}
      />,
    );
    const carbs = screen.getByRole('meter', { name: 'Kohlenhydrate' });
    expect(width(carbs.querySelector('[data-part=excess]'))).toBe(100);
    // "55 / 55 g" is on target, not over.
    expect(screen.getByRole('meter', { name: 'Protein' }).querySelector('[data-part=excess]')).toBeNull();
  });
});

describe('NutrientBreakdown', () => {
  const targets = {
    kcal: 1700,
    proteinG: 130,
    carbsG: 170,
    fatG: 55,
    micros: targetsForDate([], '2026-10-07').micros,
  };
  const meters = () =>
    ['Protein', 'Kohlenhydrate', 'Fett'].map((name) => screen.getByRole('meter', { name }));
  const macroLine = (key: string) => document.querySelector(`[data-macro=${key}] > div`)!.textContent!;
  const norm = (t: string) => t.replace(/\u00a0/g, ' ');

  it('splits the energy into whole percents that sum to 100', () => {
    render(<NutrientBreakdown nutrients={{ ENERCC: 200, PROT625: 10, CHO: 20, FAT: 5 }} targets={targets} />);
    const now = meters().map((m) => Number(m.getAttribute('aria-valuenow')));
    expect(now).toEqual([24, 49, 27]);
    expect(now.reduce((a, b) => a + b, 0)).toBe(100);
    expect(meters()[0]!.getAttribute('aria-valuetext')).toBe('24\u00a0% der Energie, 40 kcal');
    expect(screen.getByRole('img', { name: /^Energieverteilung: Protein 24/ })).toBeTruthy();
    expect(norm(macroLine('protein'))).toBe('Protein10 g · 24 % · 40 kcal');
  });

  it('gives a single macro the whole bar', () => {
    render(<NutrientBreakdown nutrients={{ ENERCC: 100, CHO: 25 }} targets={targets} />);
    expect(meters().map((m) => m.getAttribute('aria-valuenow'))).toEqual(['0', '100', '0']);
    const bar = screen.getByRole('img', { name: /Energieverteilung/ });
    expect([...bar.children].map((c) => (c as HTMLElement).style.width)).toEqual(['0%', '100%', '0%']);
  });

  it('shows zeros and placeholders for an empty map, never NaN', async () => {
    render(<NutrientBreakdown nutrients={{}} targets={targets} />);
    expect(document.body.textContent).not.toContain('NaN');
    expect(
      screen.getByRole('img', { name: 'Energieverteilung: keine Makronährstoffe' }).children,
    ).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Weitere Nährstoffe' }));
    const fiber = await screen.findByRole('meter', { name: 'Ballaststoffe' });
    expect(fiber.getAttribute('aria-valuetext')).toBe('keine Angabe');
    expect(fiber.parentElement!.textContent).toContain(NO_VALUE);
    expect(document.body.textContent).not.toContain('NaN');
  });

  it('switches to the share of the daily target on a tap on the kcal number, and back', () => {
    render(
      <NutrientBreakdown
        title="Summe"
        nutrients={{ ENERCC: 620, PROT625: 35, CHO: 60, FAT: 25 }}
        targets={targets}
      />,
    );
    const kcal = screen.getByRole('button', { name: /Anteil am Tagesziel/ });
    expect(kcal.getAttribute('aria-pressed')).toBe('false');
    expect(kcal.textContent).not.toContain('/');
    expect(norm(macroLine('protein'))).toBe('Protein35 g · 23 % · 140 kcal');
    fireEvent.click(kcal);
    expect(kcal.getAttribute('aria-pressed')).toBe('true');
    expect(norm(kcal.textContent!)).toBe('620 / 1.700 kcal');
    expect(screen.getByText('Anteil am Tagesziel')).toBeTruthy();
    expect(norm(macroLine('protein'))).toBe('Protein35 g / 130 g · 27 %');
    // Bars now measure against the daily target.
    const protein = screen.getByRole('meter', { name: 'Protein' });
    expect(protein.getAttribute('aria-valuemax')).toBe('130');
    expect(protein.getAttribute('aria-valuenow')).toBe('35');
    // The energy split bar stays.
    expect(screen.getByRole('img', { name: /Energieverteilung: Protein 23/ })).toBeTruthy();
    fireEvent.click(kcal);
    expect(kcal.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByText('Anteil am Tagesziel')).toBeNull();
  });

  it('day variant: no switch, target in the head, bars against the target with excess', () => {
    render(
      <NutrientBreakdown
        variant="day"
        nutrients={{ ENERCC: 1640, PROT625: 110, CHO: 168, FAT: 76 }}
        targets={targets}
      />,
    );
    expect(screen.queryByRole('button', { name: /Anteil am Tagesziel/ })).toBeNull();
    expect(norm(document.body.textContent!)).toContain('1.640 / 1.700 kcal');
    expect(norm(macroLine('fat'))).toBe('Fett76 g / 55 g · 38 % · 684 kcal');
    const fat = screen.getByRole('meter', { name: 'Fett' });
    expect(fat.querySelector('[data-part=excess]')).not.toBeNull();
    expect(screen.getByText('76 g').className).toContain('text-over');
  });

  it('shows micros with their daily target only after opening "Weitere Nährstoffe"', async () => {
    render(<NutrientBreakdown nutrients={{ ENERCC: 620, FIBT: 6.2, NACL: 1.8 }} targets={targets} />);
    expect(screen.queryByText('Ballaststoffe')).toBeNull();
    const toggle = screen.getByRole('button', { name: 'Weitere Nährstoffe' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    const fiber = await screen.findByRole('meter', { name: 'Ballaststoffe' });
    expect(norm(fiber.parentElement!.firstElementChild!.textContent!)).toBe(
      'Ballaststoffe6,2 g von mind. 30 g',
    );
    expect(norm(screen.getByRole('meter', { name: 'Salz' }).parentElement!.textContent!)).toContain(
      '1,8 g von max. 6 g',
    );
    // Only a few catalog codes: no "Alle N Nährstoffe".
    expect(screen.queryByRole('button', { name: /^Alle \d+ Nährstoffe$/ })).toBeNull();
  });

  it('lists all catalog nutrients of the shown amount when there are more than the main ones', async () => {
    const full = Object.fromEntries(
      ['ENERCC', 'ENERCJ', 'PROT625', 'FAT', 'CHO', 'FIBT', 'SUGAR', 'FASAT', 'NACL', 'VITC', 'CA'].map(
        (c, i) => [c, i + 1],
      ),
    );
    render(<NutrientBreakdown nutrients={full} targets={targets} defaultMicrosOpen />);
    const all = await screen.findByRole('button', { name: 'Alle 11 Nährstoffe' });
    fireEvent.click(all);
    expect(await screen.findByText('Vitamin C')).toBeTruthy();
  });

  it('can be controlled and shows target sources', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <NutrientBreakdown nutrients={{}} targets={targets} microsOpen={false} onMicrosOpenChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Weitere Nährstoffe' }));
    expect(onChange).toHaveBeenCalledWith(true);
    expect(screen.queryByRole('meter', { name: 'Ballaststoffe' })).toBeNull();
    rerender(
      <NutrientBreakdown
        nutrients={{}}
        targets={targets}
        microsOpen
        onMicrosOpenChange={onChange}
        showMicroSources
      />,
    );
    expect(screen.getByRole('meter', { name: 'Ballaststoffe' })).toBeTruthy();
    expect(screen.getByText('DGE-Referenzwert: mind. 30 g/Tag')).toBeTruthy();
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

  it('blocks the native drag of links, so a mouse swipe over a link works', () => {
    render(
      <SwipeToDelete label="Meal löschen" onDelete={() => {}} contentClassName="bg-background">
        <a href="/meals/1">Meal</a>
      </SwipeToDelete>,
    );
    const link = screen.getByText('Meal');
    expect(fireEvent.dragStart(link)).toBe(false); // default prevented
    expect(link.closest('[data-slot=swipe-content]')!.className).toContain('bg-background');
    expect(link.closest('[data-slot=swipe-content]')!.className).not.toContain('bg-card');
  });

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

describe('MealPhoto', () => {
  let created: string[];
  beforeEach(() => {
    created = [];
    URL.createObjectURL = vi.fn(() => {
      created.push(`blob:test/${created.length + 1}`);
      return created.at(-1)!;
    });
    URL.revokeObjectURL = vi.fn();
  });

  it('re-creates the image once when it fails to decode, then shows "not readable"', () => {
    expect(PHOTO_DECODE_ATTEMPTS).toBe(2);
    const blob = new Blob(['jpeg'], { type: 'image/jpeg' });
    render(<MealPhoto blob={blob} blobKey="ai:1" alt="Foto" className="size-12" />);
    const img = () => screen.getByRole('img', { name: 'Foto' });
    expect(img().getAttribute('src')).toBe('blob:test/1');
    // WebKit: the blob read earlier is unreadable; the retry uses a new Blob object and URL.
    fireEvent.error(img());
    expect(created).toHaveLength(2);
    expect(img().getAttribute('src')).toBe('blob:test/2');
    expect((URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[1]![0]).not.toBe(blob);
    fireEvent.error(img());
    expect(screen.getByRole('img', { name: 'Foto (nicht lesbar)' }).tagName).toBe('DIV');
    expect(created).toHaveLength(2);
  });

  it('starts over for another photo', () => {
    const { rerender } = render(<MealPhoto blob={new Blob(['a'])} blobKey="ai:1" alt="Foto" />);
    fireEvent.error(screen.getByRole('img'));
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByRole('img', { name: 'Foto (nicht lesbar)' })).toBeTruthy();
    rerender(<MealPhoto blob={new Blob(['b'])} blobKey="ai:2" alt="Foto" />);
    expect(screen.getByRole('img', { name: 'Foto' }).tagName).toBe('IMG');
  });

  it('shows a stored meal photo (bytes) from the device database', async () => {
    await sessionDb.photos.put({
      id: 'p1',
      bytes: new Uint8Array([0xff, 0xd8, 0xff]).buffer,
      type: 'image/jpeg',
      uploaded: 1,
      createdAt: 1,
    });
    render(<MealPhoto photoId="p1" alt="Foto von Bowl" />);
    expect((await screen.findByRole('img', { name: 'Foto von Bowl' })).tagName).toBe('IMG');
    const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Blob;
    expect(blob).toMatchObject({ size: 3, type: 'image/jpeg' });
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
  function fakeCamera(torch: boolean, refuse = false) {
    const applyConstraints = vi.fn(async () => {
      if (refuse) throw new Error('OverconstrainedError');
    });
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
    expect(button.className).toContain('bg-black/55');
    fireEvent.click(button);
    expect(applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] });
    const on = await screen.findByRole('button', { name: 'Licht ausschalten' });
    expect(on.getAttribute('aria-pressed')).toBe('true');
    // On: inverted white circle, same flashlight icon (the icon shows the state, not the action).
    expect(on.className).toContain('bg-white');
    expect(on.className).toContain('rounded-full');
    expect(on.querySelector('.lucide-flashlight')).not.toBeNull();
    expect(on.querySelector('.lucide-flashlight-off')).toBeNull();
    fireEvent.click(on);
    expect(await screen.findByRole('button', { name: 'Licht einschalten' })).toBeTruthy();
  });

  it('stays off when the camera refuses the torch', async () => {
    const applyConstraints = fakeCamera(true, true);
    render(<Overlay />);
    const button = await screen.findByRole('button', { name: 'Licht einschalten' });
    fireEvent.click(button);
    await waitFor(() => expect(applyConstraints).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.getByRole('button', { name: 'Licht einschalten' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
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
