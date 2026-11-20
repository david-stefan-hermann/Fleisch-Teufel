import { expect, test, type Page } from '@playwright/test';
import { shiftDay } from './days';

async function register(page: Page) {
  await page.context().addInitScript(() => localStorage.setItem('ft.installHintDismissed', '1'));
  await page.goto('/login');
  await page.getByRole('button', { name: 'Neues Konto erstellen' }).click();
  await page
    .getByLabel('E-Mail')
    .fill(`look-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`);
  await page.getByLabel('Passwort').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Konto erstellen' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
}

/** The day links of the week strip, in order. */
const stripLinks = (page: Page) =>
  page
    .locator('ol')
    .filter({ has: page.locator('a[aria-current]') })
    .getByRole('link');
const isoDay = (page: Page, delta: number) =>
  page.evaluate((d) => {
    const t = new Date();
    t.setDate(t.getDate() + d);
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  }, delta);

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
  await expect(
    page.getByRole('radiogroup', { name: 'Darstellung der App' }).getByRole('radio', { name: 'System' }),
  ).toHaveAttribute('aria-checked', 'true');

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

  // Diary macros with the bar: named on /more only when not the default, kept after a reload.
  await page.getByRole('link', { name: /Aussehen/ }).click();
  await page
    .getByRole('radiogroup', { name: 'Makros in den Tagebuchzeilen' })
    .getByRole('radio', { name: 'Mit Balken' })
    .click();
  await expect(page.locator('[data-part=split]')).toBeVisible();
  await page.goto('/more');
  await expect(page.getByRole('link', { name: /Aussehen/ })).toContainText(
    'Dunkel · Icon hell · Tagebuch mit Balken',
  );
  await page.reload();
  await expect(page.getByRole('link', { name: /Aussehen/ })).toContainText('Tagebuch mit Balken');

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

test('week strip "Letzte Tage": today second from the right, arrows move a week, taps keep the strip', async ({
  page,
}) => {
  await register(page);
  await page.goto('/settings/appearance');
  await page
    .getByRole('radiogroup', { name: 'Tage in der Wochenleiste' })
    .getByRole('radio', { name: 'Letzte Tage' })
    .click();
  await page.goto('/more');
  await expect(page.getByRole('link', { name: /Aussehen/ })).toContainText('· Letzte Tage');

  await page.goto('/');
  const links = stripLinks(page);
  await expect(links).toHaveCount(7);
  await expect(links.nth(5)).toHaveAttribute('aria-current');
  const first = await links.first().getAttribute('href');

  // A tap on a day of the strip does not move it.
  await links.nth(1).click();
  await expect(links.nth(1)).toHaveAttribute('aria-current');
  expect(await links.first().getAttribute('href')).toBe(first);

  // The arrow moves day and strip by a week: the sixth is selected again.
  await page.goto('/');
  await page.getByRole('link', { name: 'Vorherige Woche' }).click();
  await expect(page).toHaveURL(new RegExp(`date=${await isoDay(page, -7)}`));
  await expect(links.nth(5)).toHaveAttribute('aria-current');

  // The day helper of the specs works here too.
  await shiftDay(page, 9);
  await expect(page).toHaveURL(new RegExp(`date=${await isoDay(page, 2)}`));
  await shiftDay(page, -2);
  await expect(page).not.toHaveURL(/date=/);

  // Back to the calendar week: Monday to Sunday.
  await page.goto('/settings/appearance');
  await page
    .getByRole('radiogroup', { name: 'Tage in der Wochenleiste' })
    .getByRole('radio', { name: 'Kalenderwoche' })
    .click();
  await page.goto('/');
  await expect(links.first()).toHaveAccessibleName(/^Montag/);
  await expect(links.last()).toHaveAccessibleName(/^Sonntag/);
});

test('week strip looks: "Ring mit Bogen" by default, six to choose, kept per device', async ({ page }) => {
  await register(page);
  await page.goto('/');
  await expect(page.locator('ol[data-marks]')).toHaveAttribute('data-marks', 'ringArc');
  await page.goto('/more');
  await expect(page.getByRole('link', { name: /Aussehen/ })).toContainText(
    'Wie das System · Icon wie die App',
  );
  await expect(page.getByRole('link', { name: /Aussehen/ })).not.toContainText('Ring');

  await page.goto('/settings/appearance');
  const looks = page.getByRole('radiogroup', { name: 'Zeichen in der Wochenleiste' });
  await expect(looks.getByRole('radio')).toHaveCount(6);
  for (const name of ['Punkte', 'Ring', 'Ring mit Bogen', 'Feld', 'Feld mit Rahmen', 'Feld mit Fuß'])
    await expect(looks.getByRole('radio', { name, exact: true })).toBeVisible();
  await expect(looks.getByRole('radio', { name: 'Ring mit Bogen' })).toHaveAttribute('aria-checked', 'true');

  await looks.getByText('Feld mit Fuß').click();
  await expect(looks.getByRole('radio', { name: 'Feld mit Fuß' })).toHaveAttribute('aria-checked', 'true');
  await page.goto('/more');
  await expect(page.getByRole('link', { name: /Aussehen/ })).toContainText('· Feld mit Fuß');
  await page.goto('/');
  await page.reload();
  await expect(page.locator('ol[data-marks]')).toHaveAttribute('data-marks', 'fieldFoot');

  // "Punkte" is the strip as before: no verdict.
  await page.goto('/settings/appearance');
  await looks.getByRole('radio', { name: 'Punkte' }).click();
  await page.goto('/more');
  await expect(page.getByRole('link', { name: /Aussehen/ })).toContainText('· Punkte');
  await page.goto('/');
  await expect(page.locator('ol[data-marks]')).toHaveAttribute('data-marks', 'dots');
  await expect(page.locator('[data-verdict]')).toHaveCount(0);
});

test('icon "Dunkel" hooks in the dark manifest (one app id), the others the light one', async ({ page }) => {
  await register(page);
  const manifest = page.locator('link[rel="manifest"]');
  await expect(manifest).toHaveCount(1);
  await expect(manifest).toHaveAttribute('href', '/manifest.webmanifest');
  await page.goto('/settings/appearance');
  const iconGroup = page.getByRole('radiogroup', { name: 'App-Icon' });
  await iconGroup.getByRole('radio', { name: 'Dunkel' }).click();
  await expect(manifest).toHaveAttribute('href', '/manifest-dark.webmanifest');

  // Already before the app runs: theme-init.js sets it.
  await page.route('**/assets/*.js', (r) => r.abort());
  await page.reload();
  await expect(manifest).toHaveAttribute('href', '/manifest-dark.webmanifest');
  await expect(manifest).toHaveCount(1);
  await page.unroute('**/assets/*.js');
  await page.reload();

  await page.getByRole('radiogroup', { name: 'App-Icon' }).getByRole('radio', { name: 'Hell' }).click();
  await expect(manifest).toHaveAttribute('href', '/manifest.webmanifest');
  await page
    .getByRole('radiogroup', { name: 'App-Icon' })
    .getByRole('radio', { name: 'Wie die App' })
    .click();
  await expect(manifest).toHaveAttribute('href', '/manifest.webmanifest');

  const light = await page.request.get('/manifest.webmanifest');
  const dark = await page.request.get('/manifest-dark.webmanifest');
  expect(dark.headers()['content-type']).toBe(light.headers()['content-type']);
  const l = (await light.json()) as { id: string; start_url: string; icons: { src: string }[] };
  const d = (await dark.json()) as typeof l;
  expect(d.id).toBe(l.id);
  expect(d.start_url).toBe(l.start_url);
  expect(d.icons.map((i) => i.src)).toEqual([
    'pwa-dark-64x64.png',
    'pwa-dark-192x192.png',
    'pwa-dark-512x512.png',
    'maskable-icon-dark-512x512.png',
  ]);
});
