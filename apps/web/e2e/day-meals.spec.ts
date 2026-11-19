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

/** Right after registering the app may still settle on the onboarding page and interrupt a navigation. */
async function openQuickForm(page: Page, meal: number) {
  await expect(async () => {
    await page.goto(`/photo?form=1&meal=${meal}`);
    await expect(page.getByLabel('Was hast du gegessen?')).toBeVisible({ timeout: 2_000 });
  }).toPass();
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

/** Opens the time dialog of a meal and turns its wheels by keyboard to `hour:minute`. */
async function setTime(page: Page, meal: string, hour: number, minute: number) {
  await page.getByRole('button', { name: new RegExp(`^${meal} um .*, Uhrzeit ändern$`) }).click();
  const dialog = page.getByRole('dialog', { name: meal });
  for (const [label, value] of [
    ['Stunde', hour],
    ['Minute', minute],
  ] as const) {
    const wheel = dialog.getByRole('listbox', { name: label });
    await wheel.focus();
    await wheel.press('Home');
    for (let i = 0; i < value; i++) await wheel.press('ArrowDown');
    await expect(wheel.getByRole('option', { selected: true })).toHaveText(String(value).padStart(2, '0'));
  }
  return dialog;
}

const mealOrder = async (page: Page) =>
  (await page.locator('[data-meal] h2').allTextContents()).map((t) => t.split(/\d/)[0]!.trim());

test('the time of a meal: 07:40 to 14:00 sorts the day anew, the name stays, undo restores', async ({
  page,
}) => {
  const noon = await startAtNoon(page);
  await page.clock.setFixedTime(noon - 260 * MINUTE);
  await openFoodPage(page);
  await logQuick(page, 'Haferflocken', 222);
  await page.clock.setFixedTime(noon + 35 * MINUTE);
  await openFoodPage(page);
  await logQuick(page, 'Linseneintopf', 509);
  await expect(timeOf(page, 'Frühstück')).toHaveText('07:40');
  await expect.poll(() => mealOrder(page)).toEqual(['Frühstück', 'Mittagessen']);

  const dialog = await setTime(page, 'Frühstück', 14, 0);
  await expect(dialog.getByRole('radio')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Änderungen übernehmen' }).click();
  await expect(page.getByText('Frühstück auf 14:00 geändert')).toBeVisible();
  await expect(timeOf(page, 'Frühstück')).toHaveText('14:00');
  await expect.poll(() => mealOrder(page)).toEqual(['Mittagessen', 'Frühstück']);
  await expect(row(page, 'Frühstück', 'Haferflocken')).toBeVisible();

  await undo(page, 'Frühstück auf 14:00 geändert');
  await expect(timeOf(page, 'Frühstück')).toHaveText('07:40');
  await expect.poll(() => mealOrder(page)).toEqual(['Frühstück', 'Mittagessen']);
});

test('on a day from before the meals a new time switches to the clock, undo brings the slots back', async ({
  page,
}) => {
  const noon = await startAtNoon(page);
  await page.goto('/photo?form=1&meal=2');
  await fillQuickForm(page, 'Suppe', 400);
  await page.clock.setFixedTime(noon + 60 * MINUTE);
  await page.goto('/photo?form=1&meal=0');
  await fillQuickForm(page, 'Toast', 200);
  await page.goto('/');
  await expect(page.locator('[data-meal] h2')).toHaveCount(2);
  await expect.poll(() => mealOrder(page)).toEqual(['Frühstück', 'Abendessen']);

  const dialog = await setTime(page, 'Frühstück', 13, 5);
  await dialog.getByRole('button', { name: 'Änderungen übernehmen' }).click();
  await expect(timeOf(page, 'Frühstück')).toHaveText('13:05');
  await expect.poll(() => mealOrder(page)).toEqual(['Abendessen', 'Frühstück']);

  await undo(page, 'Frühstück auf 13:05 geändert');
  await expect(timeOf(page, 'Frühstück')).toHaveText('13:00');
  await expect.poll(() => mealOrder(page)).toEqual(['Frühstück', 'Abendessen']);
});

test('00:30 as the night after the day stays on that day, at its end, with a moon', async ({ page }) => {
  const noon = await startAtNoon(page);
  await openFoodPage(page);
  await logQuick(page, 'Skyr', 126);
  await page.clock.setFixedTime(noon + 60 * MINUTE);
  await openFoodPage(page);
  await logQuick(page, 'Linseneintopf', 509);
  await expect.poll(() => mealOrder(page)).toEqual(['Frühstück', 'Mittagessen']);
  const tomorrow = await page.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const parts = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
    const day = parts.formatToParts(d).find((p) => p.type === 'weekday')!.value;
    return day.endsWith('.') ? day : `${day}.`;
  });

  const dialog = await setTime(page, 'Frühstück', 0, 30);
  const night = dialog.getByRole('radio', { name: `Nacht auf ${tomorrow}` });
  await expect(night).toHaveAttribute('aria-checked', 'false');
  await night.click();
  await expect(night).toHaveAttribute('aria-checked', 'true');
  await dialog.getByRole('button', { name: 'Änderungen übernehmen' }).click();
  await expect(page.getByText('Frühstück auf 00:30 geändert')).toBeVisible();

  await expect.poll(() => mealOrder(page)).toEqual(['Mittagessen', 'Frühstück']);
  const stamp = page.locator('[data-meal]').last().locator('div').first();
  await expect(stamp).toHaveText(`00:30${tomorrow}`);
  await expect(stamp.locator('svg.lucide-moon')).toHaveCount(1);
  await expect(row(page, 'Frühstück', 'Skyr')).toBeVisible();

  // The entries stay on their day: the next day has none.
  await page.getByRole('button', { name: 'Nächster Tag' }).click();
  await expect(page.locator('[data-meal]')).toHaveCount(0);
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

test('the name of a meal: picker, own names on a second device, settings', async ({ page, browser }) => {
  await page.context().addInitScript(() => localStorage.setItem('ft.installHintDismissed', '1'));
  const email = `names-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const password = 'e2e-password-123';
  await page.goto('/login');
  await page.getByRole('button', { name: 'Neues Konto erstellen' }).click();
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort').fill(password);
  await page.getByRole('button', { name: 'Konto erstellen' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);

  await openQuickForm(page, 1);
  await fillQuickForm(page, 'Suppe', 300);
  await page.goto('/');

  // kcal and arrow still open the page of the meal.
  await page.getByRole('link', { name: 'Mittagessen, 300 kcal' }).click();
  await expect(page).toHaveURL(/\/diary-meal\?/);
  await page.goBack();

  // The four names and "Eigener Name"; the current one is marked, the automatic one is not offered.
  const nameButton = (name: string) => page.getByRole('button', { name: `${name}, Name ändern` });
  await nameButton('Mittagessen').click();
  const options = page.getByRole('menuitemcheckbox');
  await expect(options).toHaveText(['Frühstück', 'Mittagessen', 'Abendessen', 'Snacks']);
  await expect(page.getByRole('menuitemcheckbox', { name: 'Mittagessen' })).toBeChecked();
  await expect(page.getByRole('menuitem', { name: 'Eigener Name' })).toBeVisible();
  await page.getByRole('menuitemcheckbox', { name: 'Abendessen' }).click();
  await expect(nameButton('Abendessen')).toBeVisible();

  await nameButton('Abendessen').click();
  await page.getByRole('menuitem', { name: 'Eigener Name' }).click();
  const dialog = page.getByRole('dialog', { name: 'Eigener Name' });
  await dialog.getByLabel('Name').fill('Kuchen bei Oma');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(nameButton('Kuchen bei Oma')).toBeVisible();
  await expect(row(page, 'Kuchen bei Oma', 'Suppe')).toBeVisible();

  // Uploaded: a second device offers the own name.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { changes } = await (await fetch('/api/sync/pull?since=0')).json();
        return changes.some(
          (c: { table: string; data: { customMealNames?: string[] | null } }) =>
            c.table === 'settings' && c.data.customMealNames?.includes('Kuchen bei Oma'),
        );
      }),
    )
    .toBe(true);
  const other = await browser.newContext();
  await other.addInitScript(() => localStorage.setItem('ft.installHintDismissed', '1'));
  const phone2 = await other.newPage();
  await phone2.goto('/login');
  await phone2.getByLabel('E-Mail').fill(email);
  await phone2.getByLabel('Passwort').fill(password);
  await phone2.getByRole('button', { name: 'Anmelden' }).click();
  await phone2.getByRole('button', { name: 'Kuchen bei Oma, Name ändern' }).click();
  await expect(phone2.getByRole('menuitemcheckbox', { name: 'Kuchen bei Oma' })).toBeChecked();
  await other.close();

  // Deleted in the settings: gone from the picker, the meal keeps it.
  await page.goto('/more');
  await expect(page.getByRole('link', { name: /Mahlzeiten-Namen/ })).toContainText('4 Standard · 1 eigene');
  await page.getByRole('link', { name: /Mahlzeiten-Namen/ }).click();
  await page.getByRole('button', { name: '„Kuchen bei Oma“ löschen' }).click();
  const confirm = page.getByRole('dialog', { name: '„Kuchen bei Oma“ löschen?' });
  await expect(confirm).toContainText('Eingetragene Mahlzeiten behalten diesen Namen.');
  await confirm.getByRole('button', { name: 'Löschen' }).click();
  await expect(page.getByRole('heading', { name: 'Eigene Namen' })).toBeHidden();

  await page.goto('/');
  await nameButton('Kuchen bei Oma').click();
  await expect(options).toHaveText(['Frühstück', 'Mittagessen', 'Abendessen', 'Snacks']);
});

test('renaming a standard name leaves the meals already logged as they are', async ({ page }) => {
  await register(page);
  await openQuickForm(page, 0);
  await fillQuickForm(page, 'Haferbrei', 300);

  await page.goto('/settings/meals');
  await page.getByLabel('Mahlzeit 1').fill('Morgens');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page).toHaveURL(/\/more$/);

  await page.goto('/');
  await expect(mealCard(page, 'Frühstück')).toBeVisible();
  await page.getByRole('button', { name: 'Frühstück, Name ändern' }).click();
  await expect(page.getByRole('menuitemcheckbox').first()).toHaveText('Morgens');
});

test('a meal copied on one day goes into the empty card of another; "Wie gestern" names the meal it copies', async ({
  page,
}) => {
  await startAtNoon(page);
  await page.getByRole('button', { name: 'Vorheriger Tag' }).click();
  await expect(page).toHaveURL(/date=/);
  await mealCard(page, 'Frühstück').getByRole('link', { name: 'Essen zu Frühstück eintragen' }).click();
  await logQuick(page, 'Haferbrei', 300);
  // A meal logged later for a past day takes the typical time of its name.
  await expect(timeOf(page, 'Frühstück')).toHaveText('08:00');
  await page.getByRole('button', { name: 'Aktionen für Frühstück' }).click();
  await page.getByRole('menuitem', { name: 'Kopieren' }).click();
  await expect(page.getByText('„Frühstück“ kopiert')).toBeVisible();

  await page.getByRole('button', { name: 'Nächster Tag' }).click();
  const card = mealCard(page, 'Frühstück');
  await expect(
    card.getByRole('button', { name: 'Wie gestern, Frühstück 08:00 · 300 kcal, eintragen' }),
  ).toBeVisible();
  await card.getByRole('button', { name: '„Frühstück“ in Frühstück eintragen' }).click();
  await expect(page.getByText('„Frühstück“ in Frühstück eingetragen')).toBeVisible();
  await expect(row(page, 'Frühstück', 'Haferbrei')).toBeVisible();
  await expect(timeOf(page, 'Frühstück')).toHaveText('12:00');
  await expect(page.locator('[data-meal]')).toHaveCount(1);

  // The clipboard stays: pasted into the meal tapped, not into a new one.
  await card.getByRole('button', { name: '„Frühstück“ in Frühstück eintragen' }).click();
  await expect(card.getByRole('link', { name: /^Haferbrei/ })).toHaveCount(2);
  await expect(page.locator('[data-meal]')).toHaveCount(1);
});

test('"Tag abschließen" names the standard meals the day does not have, "Schnell schätzen" begins the next', async ({
  page,
}) => {
  await startAtNoon(page);
  await openFoodPage(page);
  await logQuick(page, 'Haferbrei', 300);
  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });

  await page.goto(`/day/${today}/complete`);
  await expect(page.getByText('Mittagessen, Abendessen, Snacks sind leer.')).toBeVisible();
  await page.getByRole('link', { name: 'Schnell schätzen' }).click();
  await expect(page).toHaveURL(/dm=new/);
  await expect(picker(page)).toContainText('Mittagessen');
  await fillQuickForm(page, 'Linseneintopf', 500);
  await page.goto('/');
  await expect(row(page, 'Mittagessen', 'Linseneintopf')).toBeVisible();
  await expect(row(page, 'Frühstück', 'Haferbrei')).toBeVisible();
});
