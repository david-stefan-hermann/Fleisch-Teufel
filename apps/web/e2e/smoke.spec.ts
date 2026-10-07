import { expect, test, type Page } from '@playwright/test';

const email = `e2e-${Date.now()}@example.com`;
const password = 'e2e-password-123';

async function addOats(page: Page, grams: string) {
  // The meal's "+" opens the add sheet for that meal.
  await page.getByRole('button', { name: 'Zu Frühstück hinzufügen' }).click();
  await page
    .getByRole('dialog', { name: 'Zu Frühstück hinzufügen' })
    .getByRole('button', { name: 'Lebensmittel suchen' })
    .click();
  await page.getByLabel('Lebensmittel suchen').fill('haferflocken');
  await page.getByRole('link', { name: /^Hafer Flocken BLS/ }).click();
  await page.getByLabel('Portion', { exact: true }).click();
  await page.getByRole('option', { name: '1 g' }).click();
  await page.getByLabel('Anzahl Portionen').fill(grams);
  await page.getByRole('button', { name: 'Zu Frühstück hinzufügen' }).click();
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
  await expect(page.getByRole('region', { name: 'Kalorien heute' })).toContainText('209');

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
  await expect(page.getByRole('region', { name: 'Kalorien heute' })).toContainText('348');

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
  await expect(phone2.getByRole('region', { name: 'Kalorien heute' })).toContainText('348');
  await other.close();
});
