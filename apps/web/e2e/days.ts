import { expect, type Page } from '@playwright/test';

/** The hour a day of the app begins at (shared `DEFAULT_DAY_START_HOUR`): before it, it is still yesterday. */
const DAY_START_HOUR = 5;

/**
 * The app's day `offset` days from its today, as the browser of the test sees it: the calendar day,
 * or the one before while the clock is before the day start.
 */
export function appDay(page: Page, offset = 0): Promise<string> {
  return page.evaluate(
    ([d, start]) => {
      const t = new Date();
      if (t.getHours() < start!) t.setDate(t.getDate() - 1);
      t.setDate(t.getDate() + d!);
      return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    },
    [offset, DAY_START_HOUR],
  );
}

/**
 * Moves the diary `delta` days through the week strip (the header has no day arrows): week arrows
 * until the target day is in the strip, then its day link. Works in both strip modes and on every
 * weekday (on a Monday yesterday is in the previous week).
 */
export async function shiftDay(page: Page, delta: number): Promise<void> {
  const today = await appDay(page);
  const { from, target } = await page.evaluate(
    ([d, today]) => {
      const iso = (t: Date) =>
        `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
      const from = new URLSearchParams(location.search).get('date') ?? (today as string);
      const [y, m, day] = from.split('-').map(Number);
      return { from, target: iso(new Date(y!, m! - 1, day! + (d as number))) };
    },
    [delta, today] as const,
  );
  const strip = page.locator('ol').filter({ has: page.locator('a[aria-current]') });
  const dayLink = (d: string) =>
    strip.getByRole('link', { name: new RegExp(`^${DAY_NAME.format(noon(d))}(,|$)`) });
  const link = dayLink(target);
  let shown = from;
  // The strip shows the shown day before anything is counted in it.
  await expect(dayLink(shown)).toHaveAttribute('aria-current');
  while ((await link.count()) === 0) {
    const back = target < shown;
    await page.getByRole('link', { name: back ? 'Vorherige Woche' : 'Nächste Woche' }).click();
    const [y, m, day] = shown.split('-').map(Number);
    const next = new Date(y!, m! - 1, day! + (back ? -7 : 7));
    shown = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
    await expectDate(page, shown, today);
    await expect(dayLink(shown)).toHaveAttribute('aria-current');
  }
  await link.click();
  await expectDate(page, target, today);
}

const DAY_NAME = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
const noon = (d: string) => new Date(`${d}T12:00:00`);

async function expectDate(page: Page, date: string, today: string) {
  await expect.poll(() => new URL(page.url()).searchParams.get('date') ?? today).toBe(date);
}
