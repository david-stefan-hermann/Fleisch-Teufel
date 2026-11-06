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

  await page.goto('/photo?form=1&meal=0');
  await page.getByLabel('Was hast du gegessen?').fill('Croissant');
  await page.getByLabel('Kalorien').fill('230');
  await page.getByRole('button', { name: 'Eintragen', exact: true }).click();
  await expect(page.getByText('Croissant', { exact: true })).toBeVisible();

  // Header: the cloud first, sharing last (the clipboard menu sits between them while something is copied).
  const headerButtons = page.getByRole('banner').getByRole('button');
  await expect(headerButtons.last()).toHaveAccessibleName('Tag teilen');
  const cloud = page.getByRole('banner').getByRole('button', { name: /synchronisiert/i });
  expect((await cloud.boundingBox())!.x).toBeLessThan(
    (await page.getByRole('button', { name: 'Tag teilen' }).boundingBox())!.x,
  );
  // A tap on the cloud shows the loading animation for at least a second, then the state again.
  await cloud.click();
  const spinning = page.getByRole('banner').getByRole('button', { name: 'Synchronisiere…' });
  await expect(spinning).toBeVisible();
  await page.waitForTimeout(700);
  await expect(spinning).toBeVisible();
  await expect(page.getByRole('banner').getByRole('button', { name: /^Synchronisiert/ })).toBeVisible();

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

  // Switching days keeps exactly one note card (the dialog once shared the note card's key, and
  // siblings with the same key left the cards of other days behind).
  await page.getByRole('button', { name: 'Vorheriger Tag' }).click();
  await page.getByRole('button', { name: 'Vorheriger Tag' }).click();
  await page.getByRole('button', { name: 'Nächster Tag' }).click();
  await page.getByRole('button', { name: 'Nächster Tag' }).click();
  await expect(page.getByText('Croissant', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Notiz' })).toHaveCount(1);
});
