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
});
