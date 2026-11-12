import { expect, test } from '@playwright/test';

/**
 * Runs in the WebKit/iPhone project: date inputs (birth date in the onboarding) must not overflow
 * the screen. WebKit on Linux is not iOS Safari, but it shares the date-input box model that caused
 * the overflow; the final check is still on a real iPhone.
 */
test('onboarding date input fits the iPhone screen', async ({ page }, info) => {
  await page.context().addInitScript(() => localStorage.setItem('ft.installHintDismissed', '1'));
  await page.goto('/login');
  await page.getByRole('button', { name: 'Neues Konto erstellen' }).click();
  await page.getByLabel('E-Mail').fill(`ios-${Date.now()}@example.com`);
  await page.getByLabel('Passwort').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Konto erstellen' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);

  const birth = page.getByLabel('Geburtsdatum');
  await birth.fill('1990-05-17');
  const viewport = page.viewportSize()!;
  const box = (await birth.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 8);
  expect(box.height).toBeLessThanOrEqual(48);
  const height = (await page.getByLabel('Größe').boundingBox())!.height;
  expect(Math.abs(box.height - height)).toBeLessThanOrEqual(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('onboarding-iphone.png') });

  // Profile: date field next to a number field: both inputs start at the same height and the date
  // value is vertically centred like the number.
  await page.goto('/settings/profile');
  const pBirth = page.getByLabel('Geburtsdatum');
  await pBirth.fill('2001-04-29');
  const date = (await pBirth.boundingBox())!;
  const size = (await page.getByLabel('Größe').boundingBox())!;
  expect(Math.abs(date.y - size.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(date.height - size.height)).toBeLessThanOrEqual(2);
  await page.screenshot({ path: info.outputPath('profile-iphone.png') });

  // Account: nothing sticks out of its card.
  await page.goto('/settings/account');
  const overflow = await page.evaluate(() =>
    [...document.querySelectorAll('main section')].some((s) => {
      const r = s.getBoundingClientRect();
      return [...s.querySelectorAll('button')].some((b) => b.getBoundingClientRect().right > r.right + 0.5);
    }),
  );
  expect(overflow).toBe(false);
});

test('no zoom: viewport forbids scaling, html blocks pinch, inputs are at least 16px', async ({ page }) => {
  await page.goto('/login');
  const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(viewport).toContain('maximum-scale=1');
  expect(viewport).toContain('user-scalable=no');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).touchAction)).toBe(
    'pan-x pan-y',
  );
  // Gesture events (iOS pinch) are cancelled.
  const prevented = await page.evaluate(() => {
    const e = new Event('gesturestart', { cancelable: true });
    document.dispatchEvent(e);
    return e.defaultPrevented;
  });
  expect(prevented).toBe(true);
  const sizes = await page.evaluate(() =>
    [...document.querySelectorAll('input')].map((i) => parseFloat(getComputedStyle(i).fontSize)),
  );
  expect(sizes.length).toBeGreaterThan(0);
  for (const s of sizes) expect(s).toBeGreaterThanOrEqual(16);
});

test.describe('375 px (iPhone mini and SE)', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('reports, goals, progress and the diary header fit without cutting numbers', async ({
    page,
  }, info) => {
    await page.context().addInitScript(() => localStorage.setItem('ft.installHintDismissed', '1'));
    await page.goto('/login');
    await page.getByRole('button', { name: 'Neues Konto erstellen' }).click();
    await page.getByLabel('E-Mail').fill(`mini-${Date.now()}@example.com`);
    await page.getByLabel('Passwort').fill('e2e-password-123');
    await page.getByRole('button', { name: 'Konto erstellen' }).click();
    await expect(page).toHaveURL(/\/onboarding$/);
    const fitsScreen = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

    // A day with large macros (long numbers in the report rows) and a weight for the chart.
    await page.goto('/photo?form=1&meal=0');
    await page.getByLabel('Was hast du gegessen?').fill('Großes Frühstück');
    await page.getByLabel('Kalorien').fill('1385');
    await page.getByLabel('Protein').fill('104');
    await page.getByLabel('Kohlenh.').fill('138');
    await page.getByLabel('Fett').fill('47');
    await page.getByRole('button', { name: 'Eintragen', exact: true }).click();
    await expect(page.getByText('Großes Frühstück', { exact: true })).toBeVisible();
    await page.evaluate(async () => {
      const d = new Date();
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const r = await fetch('/api/sync/push', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          records: [
            {
              table: 'weightEntries',
              data: { id: `w:${date}`, updatedAt: Date.now() - 1_000, deleted: false, date, kg: 82.4 },
            },
          ],
        }),
      });
      if (!r.ok) throw new Error(`push ${r.status}`);
    });

    // Reports: every macro row keeps its numbers inside the card (they may wrap).
    await page.goto('/reports');
    const rows = page.locator('li[data-macro]');
    await expect(rows.first()).toBeVisible();
    const cut = await rows.evaluateAll((lis) =>
      lis.some((li) => {
        const box = li.getBoundingClientRect();
        return [...li.querySelectorAll('span')].some(
          (s) => s.getBoundingClientRect().right > box.right + 0.5,
        );
      }),
    );
    expect(cut).toBe(false);
    expect(await fitsScreen()).toBe(true);
    await page.screenshot({ path: info.outputPath('reports-375.png'), fullPage: true });

    // Goals: the macro fields show their whole number, the unit sits next to them.
    await page.goto('/goals');
    for (const label of ['Protein', 'Kohlenh.', 'Fett']) {
      const field = page.getByLabel(label, { exact: true });
      await field.fill('1500');
      expect(await field.evaluate((i: HTMLInputElement) => i.scrollWidth <= i.clientWidth)).toBe(true);
    }
    expect(await fitsScreen()).toBe(true);
    await page.screenshot({ path: info.outputPath('goals-375.png'), fullPage: true });

    // Progress: the chart's table for screen readers does not widen the page.
    await page.goto('/progress');
    await expect(page.getByRole('img', { name: /^Gewicht/ })).toBeVisible();
    expect(await fitsScreen()).toBe(true);

    // Diary: a long date becomes the short one instead of being cut off.
    await page.goto('/?date=2026-09-30');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Mi., 30. Sept.');
    const date = page.getByRole('heading', { level: 1 }).locator('label > span').first();
    expect(await date.evaluate((s) => s.scrollWidth <= s.clientWidth)).toBe(true);
  });
});
