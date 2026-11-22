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

  test('a long meal name runs inside its header, with reduced motion it stands still', async ({ page }) => {
    await page.context().addInitScript(() => localStorage.setItem('ft.installHintDismissed', '1'));
    await page.goto('/login');
    await page.getByRole('button', { name: 'Neues Konto erstellen' }).click();
    await page.getByLabel('E-Mail').fill(`marquee-${Date.now()}@example.com`);
    await page.getByLabel('Passwort').fill('e2e-password-123');
    await page.getByRole('button', { name: 'Konto erstellen' }).click();
    await expect(page).toHaveURL(/\/onboarding$/);

    // The app may still be settling on the onboarding page and interrupt this navigation.
    await expect(async () => {
      await page.goto('/photo?form=1&meal=1');
      await expect(page.getByLabel('Was hast du gegessen?')).toBeVisible({ timeout: 2_000 });
    }).toPass();
    await page.getByLabel('Was hast du gegessen?').fill('Suppe');
    await page.getByLabel('Kalorien').fill('1385');
    await page.getByRole('button', { name: 'Eintragen', exact: true }).click();
    await expect(page.getByText('Suppe', { exact: true })).toBeVisible();
    await page.goto('/');

    const long = 'Kuchen bei Oma nach dem langen Spazierga'; // 40 characters
    await page.getByRole('button', { name: 'Mittagessen, Name ändern' }).click();
    await page.getByRole('menuitem', { name: 'Eigener Name' }).click();
    await page.getByLabel('Name', { exact: true }).fill(long);
    await page.getByRole('button', { name: 'Speichern' }).click();

    const slot = page.locator('[data-meal]').first();
    const marquee = slot.locator('.marquee');
    await expect(marquee).toHaveAttribute('data-running', '');
    await expect(marquee.locator('[aria-hidden="true"]')).toHaveText(long);
    const animations = () =>
      marquee.locator('.marquee-track').evaluate((el) => el.getAnimations().map((a) => a.playState));
    expect(await animations()).toEqual(['running']);

    // The page does not scroll sideways, the buttons stay in the card.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const card = (await slot.locator('section').boundingBox())!;
    const header = [
      slot.getByRole('button', { name: /, Name ändern$/ }),
      slot.getByRole('link', { name: /kcal$/ }),
      slot.getByRole('button', { name: /^Aktionen für / }),
      slot.getByRole('link', { name: /^Essen zu / }),
    ];
    for (const control of header) {
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(card.x);
      expect(box.x + box.width).toBeLessThanOrEqual(card.x + card.width);
    }

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(marquee).not.toHaveAttribute('data-running', '');
    await expect(marquee.locator('[aria-hidden="true"]')).toHaveCount(0);
    expect(await animations()).toEqual([]);
  });

  test('the time dialog of a meal fits the screen with wheels, night choice and both buttons', async ({
    page,
  }) => {
    await page.context().addInitScript(() => localStorage.setItem('ft.installHintDismissed', '1'));
    await page.goto('/login');
    await page.getByRole('button', { name: 'Neues Konto erstellen' }).click();
    await page.getByLabel('E-Mail').fill(`time-${Date.now()}@example.com`);
    await page.getByLabel('Passwort').fill('e2e-password-123');
    await page.getByRole('button', { name: 'Konto erstellen' }).click();
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(async () => {
      await page.goto('/photo?form=1&meal=1');
      await expect(page.getByLabel('Was hast du gegessen?')).toBeVisible({ timeout: 2_000 });
    }).toPass();
    await page.getByLabel('Was hast du gegessen?').fill('Suppe');
    await page.getByLabel('Kalorien').fill('400');
    await page.getByRole('button', { name: 'Eintragen', exact: true }).click();
    await expect(page.getByText('Suppe', { exact: true })).toBeVisible();
    await page.goto('/');

    await page.getByRole('button', { name: /^Mittagessen um .*, Uhrzeit ändern$/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Mittagessen' });
    const hour = dialog.getByRole('listbox', { name: 'Stunde' });
    await hour.focus();
    await hour.press('Home');
    await expect(dialog.getByRole('radio', { name: /^Nacht auf / })).toBeVisible();

    const viewport = page.viewportSize()!;
    const box = (await dialog.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    for (const control of [
      hour,
      dialog.getByRole('listbox', { name: 'Minute' }),
      dialog.getByRole('radio', { name: /^Nacht auf / }),
      dialog.getByRole('button', { name: 'Änderungen übernehmen' }),
      dialog.getByRole('button', { name: 'Abbrechen' }),
    ]) {
      await expect(control).toBeInViewport({ ratio: 1 });
    }
    // Nothing in the dialog scrolls: everything is on the screen at once.
    expect(
      await dialog
        .locator('[data-slot="dialog-body"]')
        .evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
    ).toBe(true);
  });

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

    // A day with large macros (long numbers in the report rows) and a weight for the chart. The app may
    // still be settling on the onboarding page and interrupt this navigation.
    await expect(async () => {
      await page.goto('/photo?form=1&meal=0');
      await expect(page.getByLabel('Was hast du gegessen?')).toBeVisible({ timeout: 2_000 });
    }).toPass();
    await page.getByLabel('Was hast du gegessen?').fill('Großes Frühstück');
    await page.getByLabel('Kalorien').fill('1385');
    await page.getByLabel('Protein').fill('104');
    await page.getByLabel('Kohlenh.').fill('138');
    await page.getByLabel('Fett').fill('47');
    await page.getByRole('button', { name: 'Eintragen', exact: true }).click();
    await expect(page.getByText('Großes Frühstück', { exact: true })).toBeVisible();

    // A meal: the time stands above the card, header and all its buttons stay inside the card.
    const slot = page.locator('[data-meal]').first();
    const card = (await slot.locator('section').boundingBox())!;
    const time = (await slot.getByText(/^\d\d:\d\d$/).boundingBox())!;
    expect(time.y + time.height).toBeLessThanOrEqual(card.y + 6);
    expect(time.x).toBeGreaterThanOrEqual(card.x);
    for (const control of [
      slot.getByRole('link', { name: /^Frühstück, / }),
      slot.getByRole('button', { name: 'Aktionen für Frühstück' }),
      slot.getByRole('link', { name: 'Essen zu Frühstück eintragen' }),
    ]) {
      const b = (await control.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(card.x);
      expect(b.x + b.width).toBeLessThanOrEqual(card.x + card.width + 0.5);
    }
    expect(await fitsScreen()).toBe(true);
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
    await page.getByRole('switch', { name: 'Prognosen' }).click();
    await expect(page.getByRole('switch', { name: 'Prognosen' })).toBeChecked();
    expect(await fitsScreen()).toBe(true);

    // Diary: without day arrows the long date fits; it is never cut off.
    await page.goto('/?date=2026-09-30');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Mittwoch, 30. September');
    const date = page.getByRole('heading', { level: 1 }).locator('label > span').first();
    expect(await date.evaluate((s) => s.scrollWidth <= s.clientWidth)).toBe(true);
  });
});
