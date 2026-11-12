import type { Portion } from '@ft/shared';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AmountEditor, type Amount } from '@/components/AmountEditor';
import { convertAmount, MAX_AMOUNT } from '@/lib/amounts';

const gram: Portion = { label: '1 g', grams: 1 };
const recipe: Portion = { label: 'Ganzes Rezept', grams: 3500 };
const slice: Portion = { label: 'Scheibe', grams: 25 };

describe('convertAmount above the maximum', () => {
  it('keeps the grams instead of clamping (the editor shows the error)', () => {
    // 3 × "Ganzes Rezept (3 500 g)" are 10 500 g, not 9 999 g.
    expect(convertAmount(3, recipe, gram)).toBe(10500);
    expect(convertAmount(3, recipe, gram)! > MAX_AMOUNT.base).toBe(true);
    // 3 000 g in 25 g slices are 120 slices (99 would be 2 475 g).
    expect(convertAmount(3000, gram, slice)).toBe(120);
    expect(convertAmount(2, gram, recipe)).toBe(0.01);
  });
});

describe('AmountEditor with an amount above the maximum after a unit switch', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  /** A parent like the food page: takes every commit, an empty amount disables its button. */
  function FoodPage({ onCommit, keepEmpty = false }: { onCommit: (a: Amount) => void; keepEmpty?: boolean }) {
    const [value, setValue] = useState<Amount>({ portion: recipe, quantity: 3 });
    return (
      <AmountEditor
        name="Eintopf"
        unit="g"
        portions={[gram, recipe]}
        value={value}
        onChange={setValue}
        onCommit={(a) => {
          onCommit(a);
          // An ingredient card keeps the last amount for an empty one.
          if (!(keepEmpty && a.quantity === null)) setValue(a);
        }}
      />
    );
  }
  const field = () => screen.getByLabelText('Menge') as HTMLInputElement;
  const switchTo = (name: RegExp) =>
    fireEvent.click(
      within(screen.getByRole('listbox', { name: 'Einheit für Eintopf' })).getByRole('option', { name }),
    );

  for (const keepEmpty of [false, true]) {
    it(`shows 10 500 g as an error and commits nothing until it fits (${keepEmpty ? 'card' : 'food page'})`, () => {
      const onCommit = vi.fn();
      render(<FoodPage onCommit={onCommit} keepEmpty={keepEmpty} />);
      switchTo(/^Gramm$/);
      // Not clamped to 9 999: the field shows the real amount, marked invalid, and nothing is saved.
      expect(onCommit).toHaveBeenLastCalledWith({ portion: gram, quantity: null });
      expect(field().value).toBe('10500');
      expect(field().getAttribute('aria-invalid')).toBe('true');
      expect(screen.getByText('Höchstens 9.999 g.')).toBeTruthy();
      expect(screen.getByRole('option', { name: /^Gramm$/ }).getAttribute('aria-selected')).toBe('true');
      // A fitting amount is taken in the new unit.
      fireEvent.change(field(), { target: { value: '9000' } });
      expect(onCommit).toHaveBeenLastCalledWith({ portion: gram, quantity: 9000 });
      expect(field().getAttribute('aria-invalid')).toBeNull();
    });
  }

  it('switching back to the old unit restores the amount', () => {
    const onCommit = vi.fn();
    render(<FoodPage onCommit={onCommit} keepEmpty />);
    switchTo(/^Gramm$/);
    switchTo(/Ganzes Rezept/);
    expect(onCommit).toHaveBeenLastCalledWith({ portion: recipe, quantity: 3 });
    expect(field().value).toBe('3');
    expect(field().getAttribute('aria-invalid')).toBeNull();
  });
});
