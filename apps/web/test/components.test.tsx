import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { CalorieRing } from '@/components/CalorieRing';
import { MacroBars } from '@/components/MacroBars';
import { NumberField } from '@/components/NumberField';

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
