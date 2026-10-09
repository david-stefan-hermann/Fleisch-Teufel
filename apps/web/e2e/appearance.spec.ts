import { expect, test } from '@playwright/test';

test('Mehr → Aussehen: app theme and icon variant, kept per device', async ({ page }) => {
  await page.context().addInitScript(() => localStorage.setItem('ft.installHintDismissed', '1'));
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/login');
  const html = page.locator('html');
  await expect(html).toHaveClass(/\blight\b/);
  // The login logo follows the theme.
  await expect(page.locator('main img').first()).toHaveAttribute('src', '/logo.svg');
  await page.getByRole('button', { name: 'Neues Konto erstellen' }).click();
  await page.getByLabel('E-Mail').fill(`look-${Date.now()}@example.com`);
  await page.getByLabel('Passwort').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Konto erstellen' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);

  await page.goto('/more');
  await expect(page.getByRole('link', { name: /Aussehen/ })).toContainText(
    'Wie das System · Icon wie die App',
  );
  await page.getByRole('link', { name: /Aussehen/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Aussehen' })).toBeVisible();
  await expect(page.getByText('Folgt der Einstellung des Geräts, gerade hell.')).toBeVisible();

  // Dark app: class, colors, browser chrome and the default icon follow.
  await page
    .getByRole('radiogroup', { name: 'Darstellung der App' })
    .getByRole('radio', { name: 'Dunkel' })
    .click();
  await expect(html).toHaveClass(/\bdark\b/);
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(await bg()).not.toBe('rgb(250, 248, 246)');
  await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute('content', '#151312');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    'href',
    '/apple-touch-icon-dark-180x180.png',
  );
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute(
    'href',
    '/favicon-dark.svg',
  );

  // A fixed light icon in the dark app.
  const iconGroup = page.getByRole('radiogroup', { name: 'App-Icon' });
  await iconGroup.getByRole('radio', { name: 'Hell' }).click();
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    'href',
    '/apple-touch-icon-180x180.png',
  );
  await expect(html).toHaveClass(/\bdark\b/);

  // Survives a reload, already before the app runs (no light flash), and ignores the system theme.
  await page.reload();
  await expect(html).toHaveClass(/\bdark\b/);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    'href',
    '/apple-touch-icon-180x180.png',
  );
  await page.goto('/more');
  await expect(page.getByRole('link', { name: /Aussehen/ })).toContainText('Dunkel · Icon hell');

  // Back to the system: follows a change of the system theme live.
  await page.getByRole('link', { name: /Aussehen/ }).click();
  await page
    .getByRole('radiogroup', { name: 'Darstellung der App' })
    .getByRole('radio', { name: 'System' })
    .click();
  await iconGroup.getByRole('radio', { name: 'Wie die App' }).click();
  await expect(html).toHaveClass(/\blight\b/);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(html).toHaveClass(/\bdark\b/);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    'href',
    '/apple-touch-icon-dark-180x180.png',
  );
});
