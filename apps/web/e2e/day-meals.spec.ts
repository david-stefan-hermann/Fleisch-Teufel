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

/** The form of an old link: fills in and logs, without coming from the diary. */
async function fillQuickForm(page: Page, text: string, kcal: number) {
  await page.getByLabel('Was hast du gegessen?').fill(text);
  await page.getByLabel('Kalorien').fill(String(kcal));
  await page.getByRole('button', { name: 'Eintragen', exact: true }).click();
  await expect(page.getByText(`${kcal} kcal eingetragen`)).toBeVisible();
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

/** Long press on a row, then along to the card of another meal. */
async function dragTo(page: Page, text: string, meal: string) {
  const handle = page.getByText(text, { exact: true });
  await handle.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const from = (await handle.boundingBox())!;
  const to = (await mealCard(page, meal).boundingBox())!;
  const [x, y] = [from.x + 20, from.y + from.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(450);
  const steps = 12;
  for (let i = 1; i <= steps; i++) await page.mouse.move(x, y + ((to.y + to.height / 2 - y) * i) / steps);
  await expect(mealCard(page, meal)).toHaveClass(/ring-2/);
  await page.mouse.up();
}

/** The time above the card of a meal. */
const timeOf = (page: Page, meal: string) =>
  page
    .locator('[data-meal]')
    .filter({ has: page.getByRole('heading', { level: 2, name: meal }) })
    .getByText(/^\d\d:\d\d$/);

const undo = (page: Page, message: string) =>
  page
    .locator('[data-sonner-toast]')
    .filter({ hasText: message })
    .getByRole('button', { name: 'Rückgängig' })
    .click();

test('an empty day shows one card; "Mahlzeit hinzufügen" writes nothing until something is logged', async ({
  page,
}) => {
  const noon = await startAtNoon(page);
  await expect(page.getByRole('heading', { level: 2, name: 'Frühstück' })).toBeVisible();
  for (const name of ['Mittagessen', 'Abendessen', 'Snacks'])
    await expect(page.getByRole('heading', { level: 2, name })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Aktionen für Frühstück' })).toHaveCount(0);
  await expect(page.locator('[data-meal]')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Mahlzeit hinzufügen' })).toHaveCount(0);

  await openFoodPage(page);
  await logQuick(page, 'Haferbrei', 300);
  await expect(timeOf(page, 'Frühstück')).toHaveText('12:00');

  // Inside the 30 minutes as well: a new meal, and leaving without an entry leaves nothing behind.
  await page.clock.setFixedTime(noon + 5 * MINUTE);
  await page.getByRole('link', { name: 'Mahlzeit hinzufügen' }).click();
  await expect(picker(page)).toContainText('Mittagessen');
  await expect(picker(page)).toContainText('Neu');
  await expect(page).toHaveURL(/dm=new/);
  await page.goBack();
  await expect(page.locator('[data-meal]')).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 2, name: 'Mittagessen' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Mahlzeit hinzufügen' }).click();
  await logQuick(page, 'Linseneintopf', 500);
  await expect(row(page, 'Mittagessen', 'Linseneintopf')).toBeVisible();
  await expect(timeOf(page, 'Mittagessen')).toHaveText('12:05');
});

test('deleting a meal takes its entries, undo brings it back with name and time', async ({ page }) => {
  const noon = await startAtNoon(page);
  await openFoodPage(page);
  await logQuick(page, 'Haferbrei', 300);
  await page.clock.setFixedTime(noon + 60 * MINUTE);
  await openFoodPage(page);
  await logQuick(page, 'Linseneintopf', 500);

  await page.getByRole('button', { name: 'Aktionen für Frühstück' }).click();
  await page.getByRole('menuitem', { name: 'Mahlzeit löschen' }).click();
  await expect(page.getByText('Frühstück gelöscht')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Frühstück' })).toHaveCount(0);
  await undo(page, 'Frühstück gelöscht');
  await expect(row(page, 'Frühstück', 'Haferbrei')).toBeVisible();
  await expect(timeOf(page, 'Frühstück')).toHaveText('12:00');

  // On the meal's own page deleting ends on the diary.
  await page.getByRole('link', { name: 'Mittagessen, 500 kcal' }).click();
  await expect(page).toHaveURL(/\/diary-meal\?.*dm=/);
  await page.getByRole('button', { name: 'Aktionen für Mittagessen' }).click();
  await page.getByRole('menuitem', { name: 'Mahlzeit löschen' }).click();
  await expect(page).toHaveURL(/\/(\?.*)?$/);
  await expect(page.getByRole('heading', { level: 2, name: 'Mittagessen' })).toHaveCount(0);
  await undo(page, 'Mittagessen gelöscht');
  await expect(row(page, 'Mittagessen', 'Linseneintopf')).toBeVisible();
  await expect(timeOf(page, 'Mittagessen')).toHaveText('13:00');
});

test('a meal dragged empty disappears, undo brings it back with name and time', async ({ page }) => {
  const noon = await startAtNoon(page);
  await openFoodPage(page);
  await logQuick(page, 'Apfel', 80);
  await page.clock.setFixedTime(noon + 60 * MINUTE);
  await openFoodPage(page);
  await logQuick(page, 'Linseneintopf', 500);

  await dragTo(page, 'Apfel', 'Mittagessen');
  await expect(page.getByText('Apfel zu Mittagessen verschoben')).toBeVisible();
  await expect(row(page, 'Mittagessen', 'Apfel')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Frühstück' })).toHaveCount(0);
  // The meal it went to keeps its time, although the entry is older.
  await expect(timeOf(page, 'Mittagessen')).toHaveText('13:00');

  await undo(page, 'Apfel zu Mittagessen verschoben');
  await expect(row(page, 'Frühstück', 'Apfel')).toBeVisible();
  await expect(timeOf(page, 'Frühstück')).toHaveText('12:00');
  await expect(row(page, 'Mittagessen', 'Apfel')).toHaveCount(0);
});

test('a day from before the meals keeps the order of its four slots', async ({ page }) => {
  const noon = await startAtNoon(page);
  await page.goto('/photo?form=1&meal=2');
  await fillQuickForm(page, 'Suppe', 400);
  await page.clock.setFixedTime(noon + 60 * MINUTE);
  await page.goto('/photo?form=1&meal=0');
  await fillQuickForm(page, 'Toast', 200);
  await page.goto('/');
  await expect(page.locator('[data-meal] h2')).toHaveCount(2);
  const titles = await page.locator('[data-meal] h2').allTextContents();
  expect(titles.map((t) => t.split(/\d/)[0]!.trim())).toEqual(['Frühstück', 'Abendessen']);
  await expect(timeOf(page, 'Frühstück')).toHaveText('13:00');
  await expect(timeOf(page, 'Abendessen')).toHaveText('12:00');
});

test('the last entry swiped away on the meal page leaves the page open, undo fills it again', async ({
  page,
}) => {
  await startAtNoon(page);
  await openFoodPage(page);
  await logQuick(page, 'Haferbrei', 300);
  await page.getByRole('link', { name: 'Frühstück, 300 kcal' }).click();
  await expect(page).toHaveURL(/\/diary-meal\?/);

  const entry = page.getByRole('link', { name: /^Haferbrei/ });
  const box = (await entry.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width - 20, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 20, y, { steps: 8 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Haferbrei löschen' }).click();

  await expect(page.getByText('Noch nichts eingetragen')).toBeVisible();
  await expect(page.getByText('Mahlzeit nicht gefunden')).toHaveCount(0);
  await undo(page, 'Haferbrei gelöscht');
  await expect(entry).toBeVisible();
});
