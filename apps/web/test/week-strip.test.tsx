import { uniformWeek, uuidv7 } from '@ft/shared';
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
import { setWeekMarksPref, setWeekStripPref, WEEK_MARKS, type WeekMarksPref } from '@/lib/appearance';

vi.mock('@/app/session', () => ({ useDb: () => sessionDb }));
let sessionDb: UserDb;
beforeEach(() => {
  sessionDb = new UserDb(`w-${uuidv7()}`);
});
afterEach(() => {
  cleanup();
  setWeekStripPref('week');
  setWeekMarksPref('ringArc');
});

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

const food = (date: string, kcal = 150) => ({
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
  nutrients: { ENERCC: kcal },
  mealId: null,
  aiAnalysisId: null,
  groupId: null,
  groupName: null,
  photoId: null,
  photoIds: null,
  note: null,
  diaryMealId: null,
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

const dots = (el: HTMLElement) =>
  [...el.querySelectorAll('[data-dot]')].map((d) => d.getAttribute('data-dot'));
const marksOf = (el: HTMLElement) =>
  [...el.querySelectorAll('[data-mark]')].map((d) => d.getAttribute('data-mark'));

describe('WeekStrip', () => {
  it('"Punkte": a red dot for food and a blue dot for training, also in the label', async () => {
    setWeekMarksPref('dots');
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

  it('"Punkte": keeps the blue dot without a ring on the selected day', async () => {
    setWeekMarksPref('dots');
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

  it('recent days: the short names belong to their days, today is the sixth', async () => {
    setWeekStripPref('recent');
    renderStrip('2026-11-20', '2026-11-20');
    await screen.findByRole('link', { name: /^Freitag, 20\. November/ });
    const days = screen.getAllByRole('listitem').map((li) => li.querySelector('a')!);
    expect(days.map((l) => l.querySelector('[aria-hidden]')!.textContent)).toEqual([
      'So',
      'Mo',
      'Di',
      'Mi',
      'Do',
      'Fr',
      'Sa',
    ]);
    expect(days.map((l) => l.hasAttribute('aria-current'))).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
      false,
    ]);
  });

  it('without a goal the default look keeps the names and the food dot, training is an arc', async () => {
    await saveRecord(sessionDb, 'foodEntries', food('2026-10-06'));
    await saveRecord(sessionDb, 'exerciseEntries', training('2026-10-06'));
    renderStrip('2026-10-09', '2026-10-09');
    const tue = await screen.findByRole('link', {
      name: 'Dienstag, 6. Oktober, Essen eingetragen, Training eingetragen',
    });
    await waitFor(() => expect(marksOf(tue)).toEqual(['arc']));
    expect(dots(tue)).toEqual(['food']);
    expect(tue.hasAttribute('data-verdict')).toBe(false);
    expect(screen.getByRole('list').getAttribute('data-marks')).toBe('ringArc');
  });

  describe('with a goal of 2000 kcal', () => {
    // Mo within (training raises the budget), Di +5 %, Mi +20 %, Do +50 %, Fr training only.
    beforeEach(async () => {
      await saveRecord(sessionDb, 'goals', {
        id: 'g:2026-01-01',
        validFrom: '2026-01-01',
        days: uniformWeek({ kcal: 2000, proteinG: 150, fatG: 70, carbsG: 200 }),
        micros: {},
      });
      await saveRecord(sessionDb, 'foodEntries', food('2026-10-05', 2100));
      await saveRecord(sessionDb, 'exerciseEntries', training('2026-10-05'));
      await saveRecord(sessionDb, 'foodEntries', food('2026-10-06', 2100));
      await saveRecord(sessionDb, 'foodEntries', food('2026-10-07', 2400));
      await saveRecord(sessionDb, 'foodEntries', food('2026-10-08', 3000));
      await saveRecord(sessionDb, 'exerciseEntries', training('2026-10-09'));
    });

    const expected: Record<WeekMarksPref, { mon: { dots: string[]; marks: string[] }; fri: string[] }> = {
      dots: { mon: { dots: ['food', 'training'], marks: [] }, fri: ['training'] },
      ring: { mon: { dots: ['training'], marks: ['ring'] }, fri: ['training'] },
      ringArc: { mon: { dots: [], marks: ['ring', 'arc'] }, fri: ['arc'] },
      field: { mon: { dots: ['food', 'training'], marks: [] }, fri: ['training'] },
      fieldFrame: { mon: { dots: [], marks: ['frame'] }, fri: ['frame'] },
      fieldFoot: { mon: { dots: [], marks: ['foot'] }, fri: ['foot'] },
    };

    it.each(WEEK_MARKS.map((m) => m.value))('%s', async (variant) => {
      setWeekMarksPref(variant);
      renderStrip('2026-10-11', '2026-10-11');
      const day = (name: RegExp) => screen.getByRole('link', { name });
      await screen.findByRole('link', { name: /^Donnerstag, 8\. Oktober, Essen eingetragen/ });
      expect(screen.getByRole('list').getAttribute('data-marks')).toBe(variant);
      const mon = day(/^Montag/);
      const fri = day(/^Freitag/);
      const wd = (name: RegExp) => day(name).getAttribute('data-verdict');
      const level = (name: RegExp) => day(name).getAttribute('data-level');
      if (variant === 'dots') {
        expect(
          screen.getByRole('link', { name: 'Montag, 5. Oktober, Essen eingetragen, Training eingetragen' }),
        ).toBe(mon);
        expect(document.querySelector('[data-verdict]')).toBeNull();
      } else {
        expect(
          screen.getByRole('link', {
            name: 'Montag, 5. Oktober, Essen eingetragen, im Ziel, Training eingetragen',
          }),
        ).toBe(mon);
        expect(
          screen.getByRole('link', { name: 'Dienstag, 6. Oktober, Essen eingetragen, über dem Ziel' }),
        ).toBe(day(/^Dienstag/));
        expect([wd(/^Montag/), wd(/^Dienstag/), wd(/^Mittwoch/), wd(/^Donnerstag/), wd(/^Freitag/)]).toEqual([
          'ok',
          'over',
          'over',
          'over',
          null,
        ]);
        expect([level(/^Montag/), level(/^Dienstag/), level(/^Mittwoch/), level(/^Donnerstag/)]).toEqual([
          null,
          '1',
          '2',
          '3',
        ]);
      }
      expect(mon.hasAttribute('data-training')).toBe(true);
      expect(fri.hasAttribute('data-training')).toBe(true);
      expect(day(/^Dienstag/).hasAttribute('data-training')).toBe(false);
      expect(dots(mon)).toEqual(expected[variant].mon.dots);
      expect(marksOf(mon)).toEqual(expected[variant].mon.marks);
      expect([...dots(fri), ...marksOf(fri)]).toEqual(expected[variant].fri);
    });
  });
});
