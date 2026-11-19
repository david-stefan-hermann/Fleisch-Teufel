import { expect, test, type Page } from '@playwright/test';

const MINUTE = 60_000;

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

/** Registers and stops the clock at 12:00 of the browser's day. Returns that moment. */
async function startAtNoon(page: Page): Promise<number> {
  await register(page);
  const noon = await page.evaluate(() => new Date().setHours(12, 0, 0, 0));
  await page.clock.setFixedTime(noon);
  await page.goto('/');
  return noon;
}

const mealCard = (page: Page, name: string) =>
  page.locator('section').filter({ has: page.getByRole('heading', { level: 2, name }) });
const picker = (page: Page) => page.getByRole('button', { name: /^Mahlzeit: / });

/** The "+" of the tab bar, then "Essen eintragen". */
async function openFoodPage(page: Page) {
  await page.getByRole('button', { name: 'Eintragen', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Eintragen', exact: true })
    .getByRole('button', { name: 'Essen eintragen' })
    .click();
  await expect(page).toHaveURL(/\/photo\?/);
}

/** "Eingeben" on the food page: a quick entry, back on the diary afterwards. */
async function logQuick(page: Page, text: string, kcal: number) {
  await page.getByRole('button', { name: 'Eingeben' }).click();
  await page.getByLabel('Was hast du gegessen?').fill(text);
  await page.getByLabel('Kalorien').fill(String(kcal));
  await page.getByRole('button', { name: 'Eintragen', exact: true }).click();
  await expect(page.getByText(`${kcal} kcal eingetragen`)).toBeVisible();
  await expect(page).toHaveURL(/\/(\?.*)?$/);
}

const row = (page: Page, meal: string, text: string) =>
  mealCard(page, meal).getByRole('link', { name: new RegExp(`^${text}`) });

test('within 30 minutes the "+" stays in the meal, after that a new one begins', async ({ page }) => {
  const noon = await startAtNoon(page);

  await openFoodPage(page);
  await expect(picker(page)).toContainText('Frühstück');
  await expect(picker(page)).toContainText('Neu');
  await expect(page).toHaveURL(/dm=new/);
  await logQuick(page, 'Haferbrei', 300);
  await expect(row(page, 'Frühstück', 'Haferbrei')).toBeVisible();

  await page.clock.setFixedTime(noon + 29 * MINUTE);
  await openFoodPage(page);
  await expect(picker(page)).toContainText('Frühstück');
  await expect(picker(page)).toContainText('12:00');
  await expect(page).not.toHaveURL(/dm=new/);
  await logQuick(page, 'Kaffee', 20);
  await expect(row(page, 'Frühstück', 'Kaffee')).toBeVisible();

  // 31 minutes after the last entry.
  await page.clock.setFixedTime(noon + 60 * MINUTE);
  await openFoodPage(page);
  await expect(picker(page)).toContainText('Mittagessen');
  await expect(picker(page)).toContainText('Neu');
  await expect(page).toHaveURL(/dm=new/);
  await logQuick(page, 'Linseneintopf', 500);
  await expect(row(page, 'Mittagessen', 'Linseneintopf')).toBeVisible();
  await expect(row(page, 'Frühstück', 'Linseneintopf')).toHaveCount(0);
});

test('the header lists the meals of the day and a new one with the name it would get', async ({ page }) => {
  const noon = await startAtNoon(page);
  await openFoodPage(page);
  await logQuick(page, 'Haferbrei', 300);

  await page.clock.setFixedTime(noon + 10 * MINUTE);
  await openFoodPage(page);
  await picker(page).click();
  await expect(page.getByRole('menuitemradio', { name: /^Frühstück\s*12:00/ })).toBeChecked();
  await page.getByRole('menuitemradio', { name: /^Neue Mahlzeit\s*Mittagessen/ }).click();
  await expect(picker(page)).toContainText('Mittagessen');
  await expect(picker(page)).toContainText('Neu');
  await expect(page).toHaveURL(/dm=new/);
  await logQuick(page, 'Linseneintopf', 500);
  await expect(row(page, 'Mittagessen', 'Linseneintopf')).toBeVisible();
});

test('the "+" of a meal wins over the 30 minutes', async ({ page }) => {
  const noon = await startAtNoon(page);
  await openFoodPage(page);
  await logQuick(page, 'Haferbrei', 300);

  await page.clock.setFixedTime(noon + 6 * 60 * MINUTE);
  await page.getByRole('link', { name: 'Essen zu Frühstück eintragen' }).click();
  await expect(picker(page)).toContainText('Frühstück');
  await expect(picker(page)).toContainText('12:00');
  await expect(page).not.toHaveURL(/dm=new/);
  await logQuick(page, 'Apfel', 80);
  await expect(row(page, 'Frühstück', 'Apfel')).toBeVisible();
  await expect(mealCard(page, 'Mittagessen').getByRole('link', { name: /^Apfel/ })).toHaveCount(0);
});

test('an old link with only an index still logs into that meal', async ({ page }) => {
  await startAtNoon(page);
  await page.goto('/photo?meal=1');
  await expect(picker(page)).toContainText('Mittagessen');
  await logQuick(page, 'Suppe', 250);
  await expect(row(page, 'Mittagessen', 'Suppe')).toBeVisible();
});
