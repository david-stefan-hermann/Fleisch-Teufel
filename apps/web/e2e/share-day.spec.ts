import { expect, test } from '@playwright/test';

test('Tag teilen: dialog with defaults, a PNG of the day goes to the share sheet', async ({ page }) => {
  await page.context().addInitScript(() => {
    localStorage.setItem('ft.installHintDismissed', '1');
    // Stub the Web Share API: remember what would go to the share sheet.
    const w = window as unknown as { __shared?: { name: string; type: string; size: number }[] };
    w.__shared = [];
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => {
        for (const f of data.files ?? []) w.__shared!.push({ name: f.name, type: f.type, size: f.size });
      },
    });
  });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Neues Konto erstellen' }).click();
  await page.getByLabel('E-Mail').fill(`share-${Date.now()}@example.com`);
  await page.getByLabel('Passwort').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Konto erstellen' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);

  await page.goto('/quick-add?meal=0');
  await page.getByLabel('Bezeichnung').fill('Croissant');
  await page.getByLabel('Kalorien').fill('230');
  await page.locator('button[type=submit]').click();
  await expect(page.getByText('Croissant', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Tag teilen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Tag teilen' });
  await expect(dialog.getByRole('checkbox', { name: 'Essen' })).toBeChecked();
  // No training and no note that day: both are disabled and say why.
  await expect(dialog.getByRole('checkbox', { name: /Training/ })).toBeDisabled();
  await expect(dialog.getByText('Kein Training eingetragen')).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: /Notiz/ })).toBeDisabled();
  // Without any part there is nothing to share.
  await dialog.getByRole('checkbox', { name: 'Essen' }).click();
  await expect(dialog.getByRole('button', { name: 'Teilen' })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: 'Essen' }).click();

  await dialog.getByRole('button', { name: 'Teilen' }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const shared = await page.evaluate(() => (window as unknown as { __shared: unknown[] }).__shared);
  expect(shared).toEqual([
    { name: `fleisch-teufel_tagebuch_${today}.png`, type: 'image/png', size: expect.any(Number) },
  ]);
  expect((shared[0] as { size: number }).size).toBeGreaterThan(5_000);
});
