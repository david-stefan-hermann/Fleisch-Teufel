import { expect, test, type Page } from '@playwright/test';

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

/** Saves the entries of a diary meal as a reusable meal: meal page, save icon, name dialog. */
async function saveDiaryMeal(page: Page, mealName: string, name: string) {
  await page.goto('/');
  await page.getByRole('link', { name: new RegExp(`^${mealName}`) }).click();
  await expect(page).toHaveURL(/\/diary-meal\?/);
  await page.getByRole('button', { name: 'Als Meal speichern' }).click();
  const dialog = page.getByRole('dialog', { name: 'Als Meal speichern' });
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByRole('button', { name: 'Meal speichern' }).click();
  // Wait for the write to finish before any full reload (the click resolves earlier).
  await expect(page.getByText(`„${name}“ gespeichert`)).toBeVisible();
}

/** Names of the local search results, in order. */
async function resultNames(page: Page): Promise<string[]> {
  const links = page.locator('main ul').first().locator('a[href*="/food/"] .font-medium');
  await expect(links.first()).toBeVisible();
  return links.allTextContents();
}

test('food search: tabs, used foods first, own foods with collapsible meals, header icons', async ({
  page,
}) => {
  await register(page);
  await page.goto('/add?meal=0');

  // Tabs "Häufig" (default), "Kürzlich", "Eigene".
  await expect(page.getByRole('tab')).toHaveText(['Häufig', 'Kürzlich', 'Eigene']);
  await expect(page.getByRole('tab', { name: 'Häufig' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Was du mindestens zweimal einträgst')).toBeVisible();

  // Header: only the food page (camera, 24 px icon); quick add and barcode live on the food page.
  await expect(page.getByRole('link', { name: 'Barcode scannen' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Schnelleingabe' })).toHaveCount(0);
  const icon = (await page.getByRole('link', { name: 'Foto oder Barcode' }).locator('svg').boundingBox())!;
  expect(icon.width).toBe(24);

  // Typing in "Häufig" or "Kürzlich" shows search results; no tab is active meanwhile.
  await page.getByLabel('Lebensmittel suchen').fill('brötchen');
  const plain = await resultNames(page);
  expect(plain.length).toBeGreaterThan(3);
  await expect(page.getByRole('tab', { selected: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /Markenprodukte/ })).toBeVisible();

  // Log the fourth hit; searching again puts it first.
  const picked = plain[3]!;
  await page.locator('main ul').first().getByRole('link').nth(3).click();
  await page.getByRole('button', { name: 'Zu Frühstück eintragen' }).click();
  await expect(page.getByText(`${picked} eingetragen`)).toBeVisible();
  await page.goto('/add?meal=0');
  await page.getByLabel('Lebensmittel suchen').fill('brötchen');
  await expect.poll(async () => (await resultNames(page))[0]).toBe(picked);

  // Tapping a tab leaves the search and shows the tab.
  await page.getByRole('tab', { name: 'Kürzlich' }).click();
  await expect(page.getByLabel('Lebensmittel suchen')).toHaveValue('');
  await expect(page.getByRole('tab', { name: 'Kürzlich' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('link', { name: new RegExp(picked) })).toBeVisible();

  // "Eigene": saved meals as a collapsible section (open by default, remembered), then own foods.
  await page.getByRole('tab', { name: 'Eigene' }).click();
  const meals = page.getByRole('button', { name: 'Meals (0)' });
  await expect(meals).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('Noch keine gespeicherten Meals')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Eigene Lebensmittel' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Eigenes Lebensmittel anlegen' })).toBeVisible();
  await meals.click();
  await expect(meals).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText('Noch keine gespeicherten Meals')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Meals (0)' })).toHaveAttribute('aria-expanded', 'false');
  // An unknown tab in the URL falls back to "Häufig".
  await page.goto('/add?meal=0&tab=all');
  await expect(page.getByRole('tab', { name: 'Häufig' })).toHaveAttribute('aria-selected', 'true');

  // Typing in "Eigene" filters own foods and meals only: the tab stays active, no catalog, no online search.
  await saveDiaryMeal(page, 'Frühstück', 'Sonntagsfrühstück');
  await page.goto('/add?meal=0&tab=mine');
  const search = page.getByLabel('Lebensmittel suchen');
  await expect(search).toHaveAttribute('placeholder', 'Eigene Lebensmittel und Meals suchen…');
  await search.fill('sonntagsfruhstuck');
  await expect(page.getByRole('tab', { name: 'Eigene' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('link', { name: /Sonntagsfrühstück/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Markenprodukte/ })).toHaveCount(0);
  // Ingredients count as well: the meal contains the logged roll.
  await search.fill(picked.split(' ')[0]!);
  await expect(page.getByRole('link', { name: /Sonntagsfrühstück/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /BLS/ })).toHaveCount(0);
  await search.fill('pizza');
  await expect(page.getByText('Nichts Eigenes gefunden')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Eigenes Lebensmittel anlegen' })).toHaveAttribute(
    'href',
    /custom-food\/new\?.*name=pizza/,
  );
  await expect(page.getByRole('heading', { name: /Markenprodukte/ })).toHaveCount(0);
});
