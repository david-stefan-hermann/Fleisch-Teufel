import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { CalorieRing } from '@/components/CalorieRing';
import { MacroBars } from '@/components/MacroBars';
import { NumberField } from '@/components/NumberField';
import { SwipeToDelete } from '@/components/SwipeToDelete';

afterEach(cleanup);

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
  function Row({ onDelete, onOpen }: { onDelete: () => void; onOpen: () => void }) {
    return (
      <SwipeToDelete label="Kaffee löschen" onDelete={onDelete}>
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
