import { uuidv7 } from '@ft/shared';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserDb } from '@/db/dexie';
import { deleteRecord, saveRecord } from '@/db/write';
import { WeekStrip } from '@/features/diary/WeekStrip';

vi.mock('@/app/session', () => ({ useDb: () => sessionDb }));
let sessionDb: UserDb;
beforeEach(() => {
  sessionDb = new UserDb(`w-${uuidv7()}`);
});
afterEach(() => cleanup());

/** The week strip inside a minimal router (its days are links to the diary). */
function renderStrip(date: string, today: string) {
  const root = createRootRoute();
  const diary = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <WeekStrip date={date} today={today} />,
  });
  const router = createRouter({
    routeTree: root.addChildren([diary]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return render(<RouterProvider router={router} />);
}

const food = (date: string) => ({
  id: uuidv7(),
  date,
  meal: 0,
  loggedAt: 1,
  foodId: null,
  source: 'quick' as const,
  name: 'Joghurt',
  brand: null,
  grams: null,
  portionLabel: null,
  portionGrams: null,
  quantity: 1,
  per100: null,
  nutrients: { ENERCC: 150 },
  mealId: null,
  aiAnalysisId: null,
  groupId: null,
  groupName: null,
  photoId: null,
  photoIds: null,
  note: null,
});

const training = (date: string) => ({
  id: uuidv7(),
  date,
  typeKey: 'running',
  name: 'Laufen',
  minutes: 40,
  intensity: 'moderate' as const,
  met: 9.8,
  weightKg: 78,
  kcal: 380,
  loggedAt: 1,
  note: null,
  templateId: null,
  groupId: null,
  steps: null,
  distanceM: null,
});

describe('WeekStrip', () => {
  it('shows a red dot for food and a blue dot for training, also in the label', async () => {
    // Week of Mon 5 to Sun 11 October 2026.
    await saveRecord(sessionDb, 'foodEntries', food('2026-10-05'));
    await saveRecord(sessionDb, 'foodEntries', food('2026-10-06'));
    await saveRecord(sessionDb, 'exerciseEntries', training('2026-10-06'));
    await saveRecord(sessionDb, 'exerciseEntries', training('2026-10-07'));
    const deleted = await saveRecord(sessionDb, 'exerciseEntries', training('2026-10-08'));
    await deleteRecord(sessionDb, 'exerciseEntries', deleted.id);
    // Steps from Apple Health are no training for the strip (almost every day would be blue).
    await saveRecord(sessionDb, 'exerciseEntries', {
      ...training('2026-10-08'),
      id: 's:2026-10-08',
      typeKey: 'steps',
      name: 'Schritte',
      steps: 8432,
      distanceM: 6100,
    });
    renderStrip('2026-10-09', '2026-10-09');

    const day = (name: RegExp) => screen.getByRole('link', { name });
    const dots = (el: HTMLElement) =>
      [...el.querySelectorAll('[data-dot]')].map((d) => d.getAttribute('data-dot'));
    // (Generous: the live queries are slow while other suites run in parallel.)
    await waitFor(() => expect(dots(day(/^Dienstag, 6\. Oktober/))).toEqual(['food', 'training']), {
      timeout: 5000,
    });
    expect(
      screen.getByRole('link', { name: 'Dienstag, 6. Oktober, Essen eingetragen, Training eingetragen' }),
    ).toBe(day(/^Dienstag/));
    expect(dots(day(/^Montag/))).toEqual(['food']);
    expect(screen.getByRole('link', { name: 'Montag, 5. Oktober, Essen eingetragen' })).toBe(day(/^Montag/));
    // Training only: just the blue dot, in the training color.
    expect(dots(day(/^Mittwoch/))).toEqual(['training']);
    expect(day(/^Mittwoch/).querySelector('[data-dot=training]')!.className).toContain('bg-exercise');
    // A deleted training does not count, nor do steps.
    expect(dots(day(/^Donnerstag/))).toEqual([]);
    expect(screen.getByRole('link', { name: 'Donnerstag, 8. Oktober' })).toBe(day(/^Donnerstag/));
  });

  it('keeps the blue dot without a ring on the selected day', async () => {
    await saveRecord(sessionDb, 'foodEntries', food('2026-10-07'));
    await saveRecord(sessionDb, 'exerciseEntries', training('2026-10-07'));
    renderStrip('2026-10-07', '2026-10-09');
    const selected = await screen.findByRole('link', { name: /^Mittwoch.*Training eingetragen$/ });
    expect(selected.getAttribute('aria-current')).toBe('date');
    expect(selected.querySelector('[data-dot=food]')!.className).toContain('bg-primary-foreground');
    const blue = selected.querySelector('[data-dot=training]')!;
    expect(blue.className).toContain('bg-exercise');
    expect(blue.className).not.toContain('ring');
  });
});
