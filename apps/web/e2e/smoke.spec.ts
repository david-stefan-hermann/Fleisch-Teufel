import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const email = `e2e-${Date.now()}@example.com`;
const password = 'e2e-password-123';

async function addOats(page: Page, grams: string) {
  // The meal's "+" opens the food page for that meal; "Suchen" under the camera leads to the search.
  await page.getByRole('link', { name: 'Essen zu Frühstück eintragen' }).click();
  await page.getByRole('link', { name: 'Suchen' }).click();
  await page.getByLabel('Lebensmittel suchen').fill('haferflocken');
  // Logged before, the row says so ("1× gegessen") between the name and the source.
  await page.getByRole('link', { name: /^Hafer Flocken (1× gegessen )?BLS/ }).click();
  await page.getByLabel('Menge', { exact: true }).fill(grams);
  await page.getByRole('button', { name: 'Zu Frühstück eintragen' }).click();
  await expect(page.getByText('Hafer Flocken eingetragen')).toBeVisible();
}

test('register, log food, survive offline reload, sync to a second device', async ({
  page,
  context,
  browser,
}) => {
  await context.addInitScript(() => localStorage.setItem('ft.installHintDismissed', '1'));
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('button', { name: 'Neues Konto erstellen' }).click();
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort').fill(password);
  await page.getByRole('button', { name: 'Konto erstellen' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByRole('button', { name: 'Zurück' }).first().click();

  // Log 60 g oats (348 kcal/100 g → 209 kcal).
  await addOats(page, '60');
  await expect(page.getByRole('region', { name: 'Kalorienübersicht des Tages' })).toContainText('209');

  // Service worker takes control, then the app must work fully offline.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(async () => (await (await fetch('/api/sync/pull?since=0')).json()).changes.length),
    )
    .toBeGreaterThan(0);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('Hafer Flocken')).toBeVisible();
  // Offline search (BLS on the device) and logging still work.
  await addOats(page, '40');
  await expect(page.getByRole('region', { name: 'Kalorienübersicht des Tages' })).toContainText('348');

  // Back online: the pending entry is pushed.
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect
    .poll(
      async () =>
        page.evaluate(
          async () =>
            (await (await fetch('/api/sync/pull?since=0')).json()).changes.filter(
              (c: { table: string }) => c.table === 'foodEntries',
            ).length,
        ),
      { timeout: 15_000 },
    )
    .toBe(2);

  // A second device sees both entries after signing in.
  const other = await browser.newContext();
  const phone2 = await other.newPage();
  await phone2.goto('/login');
  await phone2.getByLabel('E-Mail').fill(email);
  await phone2.getByLabel('Passwort').fill(password);
  await phone2.getByRole('button', { name: 'Anmelden' }).click();
  await expect(phone2.getByRole('region', { name: 'Kalorienübersicht des Tages' })).toContainText('348');
  await other.close();
});

test('accessibility: the diary has no critical or serious axe findings (light and dark)', async ({
  page,
  context,
}) => {
  await context.addInitScript(() => localStorage.setItem('ft.installHintDismissed', '1'));
  await page.goto('/login');
  await page.getByRole('button', { name: 'Neues Konto erstellen' }).click();
  await page.getByLabel('E-Mail').fill(`axe-${Date.now()}@example.com`);
  await page.getByLabel('Passwort').fill(password);
  await page.getByRole('button', { name: 'Konto erstellen' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);

  // A day with an entry, so the meal rows and the calorie card have content.
  await page.goto('/photo?form=1&meal=0');
  await page.getByLabel('Was hast du gegessen?').fill('Croissant');
  await page.getByLabel('Kalorien').fill('230');
  await page.getByRole('button', { name: 'Eintragen', exact: true }).click();
  await expect(page.getByText('Croissant', { exact: true })).toBeVisible();

  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => localStorage.setItem('ft.theme', t), theme);
    await page.reload();
    await expect(page.getByText('Croissant', { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Kalorienübersicht des Tages' })).toBeVisible();
    const { violations } = await new AxeBuilder({ page }).analyze();
    const severe = violations
      .filter((v) => v.impact === 'critical' || v.impact === 'serious')
      .map((v) => `${theme} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
    expect(severe).toEqual([]);
  }
});
