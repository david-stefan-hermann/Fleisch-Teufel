import { expect, test, type Page } from '@playwright/test';

/** Registers a fresh account and leaves the onboarding (lands on the diary). */
async function register(page: Page) {
  await page.context().addInitScript(() => localStorage.setItem('ft.installHintDismissed', '1'));
  await page.goto('/login');
  await page.getByRole('button', { name: 'Neues Konto erstellen' }).click();
  await page
    .getByLabel('E-Mail')
    .fill(`e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`);
  await page.getByLabel('Passwort').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Konto erstellen' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
}

async function swipeLeft(page: Page, text: string) {
  const box = (await page.getByText(text, { exact: true }).first().boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 200, y);
  await page.mouse.down();
  for (const dx of [10, 40, 80, 120, 160]) await page.mouse.move(box.x + 200 - dx, y);
  await page.mouse.up();
}

test('training with note, quick selection of recent trainings and templates', async ({ page }) => {
  await register(page);
  await page.goto('/exercise');
  await page.getByLabel('Sportart suchen').fill('lauf');
  await page
    .getByRole('option', { name: /^Laufen/ })
    .first()
    .click();
  await page.getByLabel('Dauer').fill('40');
  await page.getByLabel('Notiz (optional)').fill('Intervalle 6 × 400 m');
  await page.getByRole('button', { name: 'Als Vorlage speichern' }).click();
  await page.getByLabel('Name').fill('Bahntraining');
  await page.getByRole('button', { name: 'Vorlage speichern' }).click();
  await expect(page.getByText('Vorlage „Bahntraining“ gespeichert')).toBeVisible();
  await page.getByRole('button', { name: 'Training speichern' }).click();

  // The diary shows the note under the training.
  await expect(page).toHaveURL(/\/(\?.*)?$/);
  await expect(page.getByText(/40 Min\. · .* · Intervalle 6 × 400 m/)).toBeVisible();

  // Next time: template and last training are one tap away and fill the whole form.
  await page.goto('/exercise');
  await expect(page.getByRole('heading', { name: 'Schnellauswahl' })).toBeVisible();
  await page.getByRole('button', { name: /^Bahntraining/ }).click();
  await expect(page.getByLabel('Notiz (optional)')).toHaveValue('Intervalle 6 × 400 m');
  await expect(page.getByLabel('Dauer')).toHaveValue('40');
  await expect(page.getByRole('button', { name: /^Laufen.*Intervalle/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Swipe a template away.
  await swipeLeft(page, 'Bahntraining');
  await page.getByRole('button', { name: 'Vorlage Bahntraining löschen' }).click();
  await expect(page.getByText('Vorlage „Bahntraining“ gelöscht')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Bahntraining/ })).toHaveCount(0);
});

test('swipe to delete a diary entry with undo, date picker on the title', async ({ page }) => {
  await register(page);
  await page.goto('/quick-add?meal=0');
  await page.getByLabel('Bezeichnung').fill('Croissant');
  await page.getByLabel('Kalorien').fill('230');
  await page.locator('button[type=submit]').click();
  await expect(page.getByText('Croissant')).toBeVisible();

  // A plain tap still opens the entry; a swipe reveals the delete button instead.
  await swipeLeft(page, 'Croissant');
  await expect(page).not.toHaveURL(/quick-add/);
  await page.getByRole('button', { name: 'Croissant löschen' }).click();
  await expect(page.getByText('Croissant', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(page.getByText('Croissant', { exact: true })).toBeVisible();

  // No separate calendar button any more; the date input lies over the "Heute" label.
  await expect(page.getByRole('button', { name: 'Datum wählen' })).toHaveCount(0);
  const input = page.getByLabel('Datum wählen');
  const label = (await page.getByRole('heading', { level: 1 }).getByText('Heute').boundingBox())!;
  const box = (await input.boundingBox())!;
  expect(box.x).toBeLessThanOrEqual(label.x);
  expect(box.x + box.width).toBeGreaterThanOrEqual(label.x + label.width);
  await input.fill('2026-01-15');
  await expect(page).toHaveURL(/date=2026-01-15/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('15');
});

test('add menu stays compact on a desktop screen', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
  });
  const page = await context.newPage();
  await register(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Hinzufügen' }).click();
  const sheet = page.getByRole('dialog', { name: 'Hinzufügen' });
  await expect(sheet).toBeVisible();
  const box = (await sheet.boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(460);
  expect(box.height).toBeLessThan(450);
  expect(Math.abs(box.x + box.width / 2 - 720)).toBeLessThan(4);
  await context.close();
});
