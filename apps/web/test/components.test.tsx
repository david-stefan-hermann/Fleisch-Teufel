import { targetsForDate, uuidv7 } from '@ft/shared';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BarcodeScanner, TorchButton, type TorchState } from '@/components/BarcodeScanner';
import { CalorieRing } from '@/components/CalorieRing';
import { MacroBars } from '@/components/MacroBars';
import { NutrientBreakdown } from '@/components/NutrientBreakdown';
import { NutrientsDisclosure } from '@/components/NutrientsDisclosure';
import { NutrientEditor } from '@/components/NutrientEditor';
import { initFromFood, resetKcal, setField } from '@/features/foods/customFoodForm';
import { MealPhoto, PHOTO_DECODE_ATTEMPTS, useObjectUrl, usePhotoBlobFrom } from '@/components/MealPhoto';
import { NameDialog } from '@/components/NameDialog';
import { NumberField } from '@/components/NumberField';
import { SwipeToDelete } from '@/components/SwipeToDelete';
import { TapeMeasure } from '@/components/TapeMeasure';
import { UserDb } from '@/db/dexie';
import { ViewportVars } from '@/hooks/useVisualViewport';
import { fmtGrams, NO_VALUE } from '@/lib/format';

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

describe('NameDialog', () => {
  function Host({ onConfirm }: { onConfirm: (name: string) => Promise<void> | void }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>öffnen</button>
        <output data-testid="open">{String(open)}</output>
        <NameDialog
          open={open}
          onOpenChange={setOpen}
          title="Als Meal speichern"
          description="3 Einträge werden als wiederverwendbares Meal gespeichert."
          confirmLabel="Meal speichern"
          defaultName="Mittagessen 8.10.2026"
          onConfirm={onConfirm}
        />
      </>
    );
  }

  it('prefills the name, refuses an empty one and confirms the trimmed name with Enter', async () => {
    const onConfirm = vi.fn();
    render(<Host onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText('öffnen'));
    const dialog = await screen.findByRole('dialog', { name: 'Als Meal speichern' });
    const input = screen.getByLabelText('Name') as HTMLInputElement;
    expect(input.value).toBe('Mittagessen 8.10.2026');
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: '   ' } });
    expect((screen.getByRole('button', { name: 'Meal speichern' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '  Bowl ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('open').textContent).toBe('false'));
    expect(onConfirm).toHaveBeenCalledWith('Bowl');
    expect(dialog.isConnected).toBe(false);
  });

  it('starts again from the default name after cancelling, and stays open when saving fails', async () => {
    const onConfirm = vi.fn().mockRejectedValueOnce(new Error('boom'));
    render(<Host onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText('öffnen'));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Anders' } });
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(screen.getByTestId('open').textContent).toBe('false'));
    fireEvent.click(screen.getByText('öffnen'));
    expect(((await screen.findByLabelText('Name')) as HTMLInputElement).value).toBe('Mittagessen 8.10.2026');
    fireEvent.click(screen.getByRole('button', { name: 'Meal speichern' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Meal speichern' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    expect(screen.getByTestId('open').textContent).toBe('true');
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Mittagessen 8.10.2026');
  });
});

describe('ViewportVars', () => {
  it('mirrors the visual viewport as CSS variables and cleans up', () => {
    const vv = Object.assign(new EventTarget(), { height: 844, offsetTop: 0 });
    vi.stubGlobal('visualViewport', vv);
    const style = document.documentElement.style;
    const { unmount } = render(<ViewportVars />);
    expect(style.getPropertyValue('--vvh')).toBe('844px');
    expect(style.getPropertyValue('--vvt')).toBe('0px');
    // Keyboard open on iOS: the visual viewport shrinks and scrolls down.
    vv.height = 480;
    vv.offsetTop = 120;
    act(() => void vv.dispatchEvent(new Event('resize')));
    expect(style.getPropertyValue('--vvh')).toBe('480px');
    expect(style.getPropertyValue('--vvt')).toBe('120px');
    unmount();
    expect(style.getPropertyValue('--vvh')).toBe('');
  });
});

describe('NumberField with fixed decimals', () => {
  function Fixed({ initial }: { initial: number }) {
    const [v, setV] = useState<number | null>(initial);
    return (
      <>
        <NumberField label="Genauer Wert" value={v} onValueChange={setV} decimals={2} />
        <button onClick={() => setV(84.55)}>tape</button>
      </>
    );
  }

  it('shows two decimals, keeps typing free and formats again on blur', () => {
    render(<Fixed initial={80} />);
    const input = screen.getByLabelText('Genauer Wert') as HTMLInputElement;
    expect(input.value).toBe('80,00');
    fireEvent.change(input, { target: { value: '84,3' } });
    expect(input.value).toBe('84,3');
    fireEvent.blur(input);
    expect(input.value).toBe('84,30');
    fireEvent.click(screen.getByText('tape'));
    expect(input.value).toBe('84,55');
  });
});

describe('TapeMeasure', () => {
  // jsdom has no layout: the tape is 340 px wide, ±1 kg visible → 170 px per kg.
  function stubWidth(width: number) {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private cb: ResizeObserverCallback) {}
        observe(el: Element) {
          this.cb([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver);
          void el;
        }
        disconnect() {}
        unobserve() {}
      },
    );
  }
  function Tape({ initial = 84.5 }: { initial?: number }) {
    const [v, setV] = useState(initial);
    return <TapeMeasure value={v} onChange={setV} label="Gewicht in Kilogramm" />;
  }
  const slider = () => screen.getByRole('slider', { name: 'Gewicht in Kilogramm' });

  it('is an accessible slider with keyboard steps of 0,05 and 1 kg', () => {
    stubWidth(340);
    render(<Tape />);
    expect(slider().getAttribute('aria-valuenow')).toBe('84.5');
    expect(slider().getAttribute('aria-valuetext')).toBe('84,50 kg');
    expect(slider().getAttribute('aria-valuemin')).toBe('20');
    expect(slider().getAttribute('aria-valuemax')).toBe('400');
    fireEvent.keyDown(slider(), { key: 'ArrowRight' });
    expect(slider().getAttribute('aria-valuenow')).toBe('84.55');
    fireEvent.keyDown(slider(), { key: 'ArrowLeft' });
    fireEvent.keyDown(slider(), { key: 'ArrowLeft' });
    expect(slider().getAttribute('aria-valuenow')).toBe('84.45');
    fireEvent.keyDown(slider(), { key: 'PageUp' });
    expect(slider().getAttribute('aria-valuenow')).toBe('85.45');
    fireEvent.keyDown(slider(), { key: 'PageDown' });
    fireEvent.keyDown(slider(), { key: 'PageDown' });
    expect(slider().getAttribute('aria-valuenow')).toBe('83.45');
    fireEvent.keyDown(slider(), { key: 'End' });
    expect(slider().getAttribute('aria-valuenow')).toBe('400');
    fireEvent.keyDown(slider(), { key: 'ArrowRight' });
    expect(slider().getAttribute('aria-valuenow')).toBe('400');
    fireEvent.keyDown(slider(), { key: 'Home' });
    expect(slider().getAttribute('aria-valuenow')).toBe('20');
  });

  it('follows a drag (one kg per 170 px) and snaps to 0,05 on release', () => {
    stubWidth(340);
    render(<Tape />);
    const el = slider();
    el.setPointerCapture = () => undefined;
    fireEvent.pointerDown(el, { pointerId: 1, button: 0, clientX: 300 });
    // Dragging left by 170 px brings one more kilogram under the pointer.
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 130 });
    expect(el.getAttribute('aria-valuenow')).toBe('85.5');
    // In between it follows freely ...
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 125 });
    expect(el.getAttribute('aria-valuenow')).toBe('85.53');
    // ... and snaps to the raster when released.
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 125 });
    expect(el.getAttribute('aria-valuenow')).toBe('85.55');
    // Dragging right lowers the value and stops at the minimum.
    fireEvent.pointerDown(el, { pointerId: 2, button: 0, clientX: 0 });
    fireEvent.pointerMove(el, { pointerId: 2, clientX: 100_000 });
    fireEvent.pointerUp(el, { pointerId: 2 });
    expect(el.getAttribute('aria-valuenow')).toBe('20');
  });

  it('adds up small trackpad deltas', () => {
    stubWidth(340);
    render(<Tape />);
    // 3 px are less than half a mark (8,5 px per 0,05 kg) ...
    fireEvent.wheel(slider(), { deltaX: 3 });
    expect(slider().getAttribute('aria-valuenow')).toBe('84.5');
    // ... but two of them together reach the next mark.
    fireEvent.wheel(slider(), { deltaX: 3 });
    expect(slider().getAttribute('aria-valuenow')).toBe('84.55');
    // Vertical scrolling is left to the page.
    fireEvent.wheel(slider(), { deltaY: 200 });
    expect(slider().getAttribute('aria-valuenow')).toBe('84.55');
  });

  it('renders only the visible window: marks every 0,05, longer every 0,5, labels per kg', () => {
    stubWidth(340);
    render(<Tape initial={84.37} />);
    const marks = [...document.querySelectorAll('[data-mark]')];
    // ±1,2 kg around the nearest mark (84,35): 49 marks, labels 84 and 85 (83,15 to 85,55).
    expect(marks).toHaveLength(49);
    expect(marks.filter((m) => m.getAttribute('data-mark') === 'unit').map((m) => m.textContent)).toEqual([
      '84',
      '85',
    ]);
    expect(marks.filter((m) => m.getAttribute('data-mark') === 'half')).toHaveLength(3);
    // An off-raster value stays as it is; the tape shows the nearest mark under the pointer.
    expect(slider().getAttribute('aria-valuenow')).toBe('84.37');
    const centre = marks.find((m) => (m as HTMLElement).style.left === 'calc(50% + 0px)');
    expect(centre).toBeTruthy();
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

  it('fills a darker second step once the red bar is full', () => {
    render(
      <MacroBars
        macros={[
          { key: 'protein', label: 'Protein', value: 66, target: 55 },
          { key: 'carbs', label: 'Kohlenhydrate', value: 137.5, target: 55 },
          { key: 'fat', label: 'Fett', value: 165, target: 55 },
        ]}
      />,
    );
    const part = (name: string, p: string) =>
      screen.getByRole('meter', { name }).querySelector(`[data-part=${p}]`);
    // 120 %: red only.
    expect(width(part('Protein', 'excess'))).toBeCloseTo(20, 5);
    expect(part('Protein', 'excess2')).toBeNull();
    // 250 %: red full, dark red half.
    expect(width(part('Kohlenhydrate', 'excess'))).toBe(100);
    expect(width(part('Kohlenhydrate', 'excess2'))).toBeCloseTo(50, 5);
    expect(part('Kohlenhydrate', 'excess2')!.className).toContain('bg-over-2');
    // 300 %: both full.
    expect(width(part('Fett', 'excess2'))).toBe(100);
    // The text stays in the normal red.
    expect(screen.getByText('165').className).toContain('text-over');
    expect(screen.getByText('165').className).not.toContain('over-2');
  });

  it('caps the second step at the full width (400 %)', () => {
    render(<MacroBars macros={[{ key: 'fat', label: 'Fett', value: 220, target: 55 }]} />);
    const meter = screen.getByRole('meter', { name: 'Fett' });
    expect(width(meter.querySelector('[data-part=excess]'))).toBe(100);
    expect(width(meter.querySelector('[data-part=excess2]'))).toBe(100);
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

  it('stacks micros above their maximum like the macros, minimums keep their own bar', async () => {
    render(
      <NutrientBreakdown
        nutrients={{ ENERCC: 1700, SUGAR: targets.micros.SUGAR.grams * 2.5, NACL: 6.3, FASAT: 10, FIBT: 34 }}
        targets={targets}
        defaultMicrosOpen
      />,
    );
    const sugar = await screen.findByRole('meter', { name: 'Zucker' });
    // 2,5 × the maximum: red full, dark red 50 %.
    const max = targets.micros.SUGAR.grams;
    expect(sugar.querySelector('[data-part=fill]')!.className).toContain('bg-foreground/40');
    expect(Number.parseFloat((sugar.querySelector('[data-part=excess]') as HTMLElement).style.width)).toBe(
      100,
    );
    expect(
      Number.parseFloat((sugar.querySelector('[data-part=excess2]') as HTMLElement).style.width),
    ).toBeCloseTo(50, 5);
    expect(sugar.getAttribute('aria-valuetext')).toBe(`${fmtGrams(max * 2.5)} von max. ${fmtGrams(max)}`);
    // Decimals count: 6,3 g of max. 6 g is over although both round to 6.
    const salt = screen.getByRole('meter', { name: 'Salz' });
    expect(salt.querySelector('[data-part=excess]')).not.toBeNull();
    expect(salt.querySelector('[data-part=excess2]')).toBeNull();
    // Below the maximum: grey only.
    const sat = screen.getByRole('meter', { name: 'Gesättigte Fettsäuren' });
    expect(sat.querySelector('[data-part=excess]')).toBeNull();
    // Fibre (minimum) reached: green, never an excess layer.
    const fiber = screen.getByRole('meter', { name: 'Ballaststoffe' });
    expect(fiber.querySelector('[data-part=excess]')).toBeNull();
    expect(fiber.firstElementChild!.className).toContain('bg-good');
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

describe('NutrientsDisclosure', () => {
  const targets = {
    kcal: 1700,
    proteinG: 130,
    carbsG: 170,
    fatG: 55,
    micros: targetsForDate([], '2026-10-07').micros,
  };

  it('starts closed and shows the overview of the amount on a tap', async () => {
    render(
      <NutrientsDisclosure
        title="100 g"
        nutrients={{ ENERCC: 250, PROT625: 20, CHO: 0, FAT: 18.5 }}
        targets={targets}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Nährwerte' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('meter', { name: 'Protein' })).toBeNull();
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(await screen.findByRole('meter', { name: 'Protein' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^250 kcal, Anteil am Tagesziel/ })).toBeTruthy();
    expect(screen.getByText('100 g')).toBeTruthy();
  });

  it('follows new values while open (slider, gram field)', async () => {
    const { rerender } = render(
      <NutrientsDisclosure title="50 g" nutrients={{ ENERCC: 100, CHO: 25 }} targets={targets} open />,
    );
    expect(await screen.findByRole('button', { name: /^100 kcal/ })).toBeTruthy();
    rerender(
      <NutrientsDisclosure title="100 g" nutrients={{ ENERCC: 200, CHO: 50 }} targets={targets} open />,
    );
    expect(screen.getByRole('button', { name: /^200 kcal/ })).toBeTruthy();
    expect(screen.getByText('100 g')).toBeTruthy();
  });
});

describe('NutrientEditor', () => {
  const micros = targetsForDate([], '2026-10-07').micros;
  function Editor({ open = false }: { open?: boolean }) {
    const [state, setState] = useState(() => initFromFood(null));
    return (
      <NutrientEditor
        state={state}
        onChange={(code, v) => setState((s) => setField(s, code, v))}
        onResetKcal={() => setState(resetKcal)}
        targets={{ micros }}
        defaultMicrosOpen={open}
      />
    );
  }
  const input = (id: string) => document.getElementById(id) as HTMLInputElement;
  const type = (id: string, value: string) => fireEvent.change(input(id), { target: { value } });
  const macroLine = (key: string) =>
    document.querySelector(`[data-macro=${key}] > div`)!.textContent!.replace(/\u00a0/g, ' ');

  it('computes kcal, split and percents live from the macros', () => {
    render(<Editor open />);
    expect(screen.getByText('aus den Makros berechnet')).toBeTruthy();
    type('nf-protein', '4');
    type('nf-carbs', '38');
    type('nf-fat', '13');
    type('nf-fiber', '1,8');
    expect(input('nf-kcal').value).toBe('289');
    expect(macroLine('protein')).toContain('· 6 % · 16 kcal');
    expect(macroLine('fat')).toContain('· 41 % · 117 kcal');
    const bar = screen.getByRole('img', { name: /^Energieverteilung: Protein 6/ });
    expect(bar.children).toHaveLength(3);
  });

  it('typed kcal win; kJ follow the kcal, "aus Makros berechnen" resets', async () => {
    render(<Editor open />);
    type('nf-protein', '10');
    type('nf-kcal', '175');
    expect(screen.getByText(/eigene Eingabe/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Alle 10 Nährstoffe' }));
    expect(((await screen.findByLabelText('Energie (Kilojoule)')) as HTMLInputElement).value).toBe('732');
    expect(screen.getByText('wird aus kcal berechnet')).toBeTruthy();
    type('nf-kj-all', '1000');
    expect(input('nf-kcal').value).toBe('239');
    expect(screen.getByText(/aus deinen kJ/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'aus Makros berechnen' }));
    expect(input('nf-kcal').value).toBe('40');
    expect(input('nf-kj-all').value).toBe('167');
  });

  it('couples salt and sodium and shows the error in place of the source line', async () => {
    render(
      <NutrientEditor
        state={setField(initFromFood(null), 'salt', 0.2)}
        onChange={() => {}}
        onResetKcal={() => {}}
        targets={{ micros }}
        error="Kalorien oder Makros angeben."
        defaultMicrosOpen
      />,
    );
    expect(screen.getByText('Kalorien oder Makros angeben.')).toBeTruthy();
    expect(screen.queryByText('aus den Makros berechnet')).toBeNull();
    expect(input('nf-kcal').getAttribute('aria-invalid')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Alle 10 Nährstoffe' }));
    expect(((await screen.findByLabelText('Natrium')) as HTMLInputElement).value).toBe('80');
    expect(screen.getByText('wird aus Salz berechnet')).toBeTruthy();
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
