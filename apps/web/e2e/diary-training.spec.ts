import { expect, test, type Locator, type Page } from '@playwright/test';

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

async function swipeLeft(page: Page, target: string | Locator) {
  const row = typeof target === 'string' ? page.getByText(target, { exact: true }).first() : target;
  // Centre the row: toasts sit at the bottom and would catch the pointer.
  await row.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const box = (await row.boundingBox())!;
  const y = box.y + box.height / 2;
  // Start inside the card even for right-aligned text (the page has a 16 px gutter).
  const x = Math.min(box.x + 200, page.viewportSize()!.width - 30);
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (const dx of [10, 40, 80, 120, 160]) await page.mouse.move(x - dx, y);
  await page.mouse.up();
}

test('training with note, quick selection of recent and saved trainings', async ({ page }) => {
  await register(page);
  await page.goto('/exercise');
  await page.getByLabel('Sportart suchen').fill('lauf');
  await page
    .getByRole('option', { name: /^Laufen/ })
    .first()
    .click();
  await page.getByLabel('Dauer').fill('40');
  await page.getByLabel('Notiz (optional)').fill('Intervalle 6 × 400 m');
  // The save icon in the header stores a saved training without logging it.
  await page.getByRole('button', { name: 'Als Training speichern' }).click();
  const dialog = page.getByRole('dialog', { name: 'Als Training speichern' });
  await expect(dialog).toContainText('Mehr → Gespeicherte Trainings');
  await dialog.getByLabel('Name').fill('Bahntraining');
  await dialog.getByRole('button', { name: 'Training speichern' }).click();
  await expect(page.getByText('„Bahntraining“ gespeichert')).toBeVisible();
  await expect(page).toHaveURL(/\/exercise/);
  await page.getByRole('button', { name: 'Training eintragen' }).click();

  // The diary shows the note under the training.
  await expect(page).toHaveURL(/\/(\?.*)?$/);
  await expect(page.getByText(/40 Min\. · .* · Intervalle 6 × 400 m/)).toBeVisible();

  // Next time: saved and last training are one tap away and fill the whole form.
  await page.goto('/exercise');
  await expect(page.getByRole('heading', { name: 'Schnellauswahl' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Gespeichert' })).toBeVisible();
  await page.getByRole('button', { name: /^Bahntraining/ }).click();
  await expect(page.getByLabel('Notiz (optional)')).toHaveValue('Intervalle 6 × 400 m');
  await expect(page.getByLabel('Dauer')).toHaveValue('40');
  await expect(page.getByRole('button', { name: /^Laufen.*Intervalle/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Swipe a saved training away.
  await swipeLeft(page, 'Bahntraining');
  await page.getByRole('button', { name: 'Bahntraining löschen' }).click();
  await expect(page.getByText('„Bahntraining“ gelöscht')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Bahntraining/ })).toHaveCount(0);
});

test('saved trainings: manage under "Mehr", edit with explicit save, trash', async ({ page }) => {
  await register(page);
  await page.goto('/exercise');
  await page.getByLabel('Sportart suchen').fill('lauf');
  await page
    .getByRole('option', { name: /^Laufen/ })
    .first()
    .click();
  await page.getByLabel('Dauer').fill('40');
  await page.getByRole('button', { name: 'Als Training speichern' }).click();
  await page.getByRole('dialog').getByLabel('Name').fill('Bahntraining');
  await page.getByRole('dialog').getByRole('button', { name: 'Training speichern' }).click();
  await expect(page.getByText('„Bahntraining“ gespeichert', { exact: true })).toBeVisible();

  // "Verwalten" in the quick selection opens the list; so does "Mehr".
  await page.reload();
  await page.getByRole('link', { name: 'Verwalten' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Gespeicherte Trainings' })).toBeVisible();
  await page.goto('/more');
  await page.getByRole('link', { name: 'Gespeicherte Trainings' }).click();
  const row = page.getByRole('link', { name: /Bahntraining/ });
  await expect(row).toContainText(/Laufen.* · 40 Min\. · Mittel/);
  await expect(row).toContainText(/\d+ kcal/);

  // Editor: same fields as logging, "Speichern" only with changes, leaving with changes asks.
  await row.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Bahntraining' })).toBeVisible();
  const save = page.getByRole('button', { name: 'Speichern', exact: true });
  await expect(save).toBeDisabled();
  await expect(page.getByText('Verbrauch beim aktuellen Gewicht')).toBeVisible();
  await page.getByLabel('Name').fill('Intervalle');
  await page.getByRole('button', { name: '60 Min.' }).click();
  await page.getByRole('button', { name: 'Zurück' }).click();
  const ask = page.getByRole('dialog', { name: 'Änderungen verwerfen?' });
  await expect(ask).toContainText('Du hast Bahntraining geändert.');
  await ask.getByRole('button', { name: 'Weiter bearbeiten' }).click();
  await save.click();
  await expect(page.getByText('„Intervalle“ gespeichert', { exact: true })).toBeVisible();
  await expect(save).toBeDisabled();
  await page.getByRole('button', { name: 'Zurück' }).click();
  await expect(page).toHaveURL(/\/trainings$/);
  await expect(page.getByRole('link', { name: /Intervalle/ })).toContainText('60 Min.');

  // Discarding keeps the saved state.
  await page.getByRole('link', { name: /Intervalle/ }).click();
  await page.getByLabel('Name').fill('Weg damit');
  await page.getByRole('button', { name: 'Zurück' }).click();
  await ask.getByRole('button', { name: 'Verwerfen' }).click();
  await expect(page.getByRole('link', { name: /Intervalle/ })).toBeVisible();

  // Delete from the editor, then restore from the trash.
  await page.getByRole('link', { name: /Intervalle/ }).click();
  await page.getByRole('button', { name: 'Training löschen' }).click();
  await expect(page).toHaveURL(/\/trainings$/);
  await expect(page.getByText('Noch keine gespeicherten Trainings')).toBeVisible();
  await page.goto('/settings/trash');
  await expect(page.getByText(/Laufen.* · 60 Min\. · Mittel · gelöscht am/)).toBeVisible();
  await page.getByRole('button', { name: 'Intervalle wiederherstellen' }).click();
  await expect(page.getByText('„Intervalle“ wiederhergestellt', { exact: true })).toBeVisible();
  await expect(page.getByText('Keine gelöschten gespeicherten Trainings')).toBeVisible();
  await page.goto('/exercise');
  await expect(page.getByRole('button', { name: /^Intervalle/ })).toBeVisible();
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

test('add menu: training, food (highlighted, middle), weight; the food page leads to the search', async ({
  page,
}) => {
  await register(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Hinzufügen', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Hinzufügen', exact: true });
  await expect(sheet.getByRole('button')).toHaveText([
    'Training eintragen',
    'Essen eintragen',
    'Gewicht eintragen',
  ]);
  const food = sheet.getByRole('button', { name: 'Essen eintragen' });
  const training = sheet.getByRole('button', { name: 'Training eintragen' });
  const bg = (el: Locator) => el.evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(await bg(food)).not.toBe(await bg(training));
  await training.click();
  await expect(page).toHaveURL(/\/exercise/);
  await expect(page.getByRole('heading', { level: 1, name: 'Training eintragen' })).toBeVisible();

  await page.goto('/');
  await page.getByRole('button', { name: 'Hinzufügen', exact: true }).click();
  await sheet.getByRole('button', { name: 'Essen eintragen' }).click();
  await expect(page).toHaveURL(/\/photo\?/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Essen eintragen');
  // Magnifier and camera icon replace each other: back leaves to the diary, no ping-pong.
  await page.getByRole('link', { name: 'Lebensmittel suchen' }).click();
  await expect(page).toHaveURL(/\/add\?/);
  await page.getByRole('link', { name: 'Foto oder Barcode' }).click();
  await expect(page).toHaveURL(/\/photo\?/);
  await page.getByRole('button', { name: 'Zurück' }).click();
  await expect(page).toHaveURL(/\/(\?.*)?$/);
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
  // (exact: the meal cards have "Zu … hinzufügen" buttons as well)
  await page.getByRole('button', { name: 'Hinzufügen', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Hinzufügen', exact: true });
  await expect(sheet).toBeVisible();
  const box = (await sheet.boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(460);
  expect(box.height).toBeLessThan(450);
  expect(Math.abs(box.x + box.width / 2 - 720)).toBeLessThan(4);
  await context.close();
});

async function quickAdd(page: Page, meal: number, name: string, kcal: string) {
  await page.goto(`/quick-add?meal=${meal}`);
  await page.getByLabel('Bezeichnung').fill(name);
  await page.getByLabel('Kalorien').fill(kcal);
  await page.locator('button[type=submit]').click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}

const mealCard = (page: Page, name: string) =>
  page.locator('section').filter({ has: page.getByRole('heading', { level: 2, name }) });

test('the "+" of a meal opens the food page for that meal, the meal card has no menu', async ({ page }) => {
  await register(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Aktionen für/ })).toHaveCount(0);
  await page.getByRole('link', { name: 'Essen zu Mittagessen eintragen' }).click();
  await expect(page).toHaveURL(/\/photo\?.*meal=1/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Mittagessen');

  // The empty state of a meal goes there as well.
  await page.goto('/');
  await mealCard(page, 'Abendessen').getByRole('link', { name: 'Essen eintragen', exact: true }).click();
  await expect(page).toHaveURL(/\/photo\?.*meal=2/);

  // So do the "+" and the empty state on the meal page, whose save icon is off while it is empty.
  await page.goto('/diary-meal?meal=3');
  await expect(page.getByRole('button', { name: 'Als Meal speichern' })).toBeDisabled();
  await page.getByRole('main').getByRole('link', { name: 'Essen eintragen', exact: true }).click();
  await expect(page).toHaveURL(/\/photo\?.*meal=3/);
  await page.goto('/diary-meal?meal=3');
  await page.getByRole('link', { name: 'Essen zu Snacks eintragen' }).click();
  await expect(page).toHaveURL(/\/photo\?.*meal=3/);
});

test('an expanded meal group stays open after visiting one of its entries', async ({ page }) => {
  await register(page);
  await quickAdd(page, 0, 'Joghurt', '150');
  await quickAdd(page, 0, 'Beeren', '50');
  await saveDiaryMeal(page, 'Frühstück', 'Bowl');
  await page.goto('/add?meal=1&tab=mine');
  await page.getByRole('link', { name: /Bowl/ }).click();
  await page.getByRole('button', { name: '200 kcal eintragen' }).click();
  const group = mealCard(page, 'Mittagessen').getByRole('button', { name: /Bowl/ });
  await expect(group).toHaveAttribute('aria-expanded', 'false');
  await group.click();
  await expect(group).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('list', { name: 'Zutaten von Bowl' }).getByText('Beeren').click();
  await expect(page).toHaveURL(/quick-add/);
  await page.goBack();
  await expect(group).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('list', { name: 'Zutaten von Bowl' })).toBeVisible();
});

test('drag an entry to another meal, with undo', async ({ page }) => {
  await register(page);
  await quickAdd(page, 0, 'Banane', '105');
  const row = page.getByText('Banane', { exact: true });
  await row.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const from = (await row.boundingBox())!;
  const target = (await mealCard(page, 'Mittagessen').boundingBox())!;

  // Long press (300 ms) lifts the row, then it follows the pointer to the other meal.
  await page.mouse.move(from.x + 20, from.y + from.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(450);
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      from.x + 20,
      from.y + from.height / 2 + ((target.y + target.height / 2 - from.y - from.height / 2) * i) / steps,
    );
  }
  await expect(mealCard(page, 'Mittagessen')).toHaveClass(/ring-2/);
  await page.mouse.up();

  await expect(page.getByText('Nach Mittagessen verschoben', { exact: true })).toBeVisible();
  await expect(mealCard(page, 'Mittagessen').getByText('Banane', { exact: true })).toBeVisible();
  await expect(mealCard(page, 'Frühstück').getByText('Banane', { exact: true })).toHaveCount(0);
  // The drop did not open the entry, and no delete button was revealed on the way.
  await expect(page).toHaveURL(/\/(\?.*)?$/);
  // (the closed delete button is aria-hidden, so it is found by its label, not its role)
  await expect(page.locator('button[aria-label="Banane löschen"]')).toHaveAttribute('tabindex', '-1');

  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(mealCard(page, 'Frühstück').getByText('Banane', { exact: true })).toBeVisible();
  await expect(mealCard(page, 'Mittagessen').getByText('Banane', { exact: true })).toHaveCount(0);

  // A quick swipe is still a delete gesture, not a drag.
  await swipeLeft(page, 'Banane');
  await expect(page.getByRole('button', { name: 'Banane löschen' })).toHaveAttribute('tabindex', '0');
});

test('touch: long press drags a whole saved meal to another meal', async ({ page }) => {
  await register(page);
  await quickAdd(page, 0, 'Joghurt', '150');
  await quickAdd(page, 0, 'Beeren', '50');
  await saveDiaryMeal(page, 'Frühstück', 'Bowl');
  await page.goto('/add?meal=1&tab=mine');
  await page.getByRole('link', { name: /Bowl/ }).click();
  await page.getByRole('button', { name: '200 kcal eintragen' }).click();
  const group = mealCard(page, 'Mittagessen').getByRole('button', { name: /Bowl/ });
  await expect(group).toBeVisible();

  // Real touch events (CDP): the touch sensor is what iOS uses.
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0, y = 0) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await group.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const from = (await group.boundingBox())!;
  const target = (await mealCard(page, 'Snacks').boundingBox())!;
  const x = from.x + 40;
  const y0 = from.y + from.height / 2;
  const y1 = Math.min(target.y + 30, page.viewportSize()!.height - 10);
  await touch('touchStart', x, y0);
  await page.waitForTimeout(450);
  for (let i = 1; i <= 10; i++) await touch('touchMove', x, y0 + ((y1 - y0) * i) / 10);
  await touch('touchEnd');

  await expect(page.getByText('Nach Snacks verschoben', { exact: true })).toBeVisible();
  const moved = mealCard(page, 'Snacks').getByRole('button', { name: /Bowl/ });
  await expect(moved).toBeVisible();
  // Both ingredients moved as one row; the drop did not expand the group.
  await expect(moved).toHaveAttribute('aria-expanded', 'false');
  await expect(moved).toContainText('2 Zutaten');
  await expect(mealCard(page, 'Mittagessen').getByRole('button', { name: /Bowl/ })).toHaveCount(0);
  // The single entries in breakfast stayed where they were.
  await expect(mealCard(page, 'Frühstück').getByText('Joghurt', { exact: true })).toBeVisible();
});

test('weight slider spans ±5 kg around the last weight', async ({ page }) => {
  await register(page);
  await page.goto('/progress');
  await page.getByRole('button', { name: 'Gewicht eintragen' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Gewicht eintragen' });
  await dialog.getByLabel('Genauer Wert').fill('84,5');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await page.getByRole('button', { name: 'Gewicht eintragen' }).first().click();
  await expect(dialog.getByText('79 kg', { exact: true })).toBeVisible();
  await expect(dialog.getByText('90 kg', { exact: true })).toBeVisible();
});

test('weight entries delete by swipe only, with undo', async ({ page }) => {
  await register(page);
  await page.goto('/progress');
  await page.getByRole('button', { name: 'Gewicht eintragen' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Gewicht eintragen' });
  await dialog.getByLabel('Genauer Wert').fill('84,5');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog).toHaveCount(0);
  const entries = page.locator('section', { has: page.getByRole('heading', { name: 'Einträge' }) });
  // No trash icon in the row any more; the delete button only appears after a swipe.
  const del = entries.getByRole('button', { name: /^Eintrag vom .* löschen$/ });
  await expect(del).toBeHidden();
  await swipeLeft(page, entries.getByText('84,5 kg', { exact: true }));
  await del.click();
  await expect(page.getByText('Gewicht gelöscht')).toBeVisible();
  await expect(entries).toHaveCount(0);
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(entries.getByText('84,5 kg', { exact: true })).toBeVisible();

  // Deleted again without undo: the trash under "Mehr" brings it back. (The row sits at the bottom
  // of a short page, where the leaving toast would catch the swipe.)
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  await swipeLeft(page, entries.getByText('84,5 kg', { exact: true }));
  await del.click();
  await expect(entries).toHaveCount(0);
  await page.goto('/more');
  await expect(page.getByRole('link', { name: /Papierkorb.*1 Eintrag/ })).toBeVisible();
  await page.getByRole('link', { name: /Papierkorb/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Papierkorb' })).toBeVisible();
  await expect(page.getByText('Keine gelöschten Meals')).toBeVisible();
  await page.getByRole('button', { name: /^Gewicht vom .* wiederherstellen$/ }).click();
  await expect(page.getByText(/^Gewicht vom .* wiederhergestellt$/)).toBeVisible();
  await expect(page.getByText('Keine gelöschten Gewichtseinträge')).toBeVisible();
  await page.goto('/progress');
  await expect(entries.getByText('84,5 kg', { exact: true })).toBeVisible();
});

test('saved meals delete by swipe, with undo', async ({ page }) => {
  await register(page);
  await quickAdd(page, 0, 'Müsli', '320');
  await saveDiaryMeal(page, 'Frühstück', 'Müsli-Frühstück');
  await page.goto('/meals');
  // A swipe does not open the meal.
  await swipeLeft(page, 'Müsli-Frühstück');
  await expect(page).toHaveURL(/\/meals$/);
  await page.getByRole('button', { name: 'Müsli-Frühstück löschen' }).click();
  await expect(page.getByText('Müsli-Frühstück gelöscht')).toBeVisible();
  await expect(page.getByRole('link', { name: /Müsli-Frühstück/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(page.getByRole('link', { name: /Müsli-Frühstück/ })).toBeVisible();

  // Without undo the meal waits in the trash.
  await swipeLeft(page, 'Müsli-Frühstück');
  await page.getByRole('button', { name: 'Müsli-Frühstück löschen' }).click();
  await expect(page.getByRole('link', { name: /Müsli-Frühstück/ })).toHaveCount(0);
  await page.goto('/settings/trash');
  await expect(page.getByText(/^1\sZutat · gelöscht am/)).toBeVisible();
  await page.getByRole('button', { name: 'Müsli-Frühstück wiederherstellen' }).click();
  await expect(page.getByText('„Müsli-Frühstück“ wiederhergestellt')).toBeVisible();
  await page.goto('/meals');
  await expect(page.getByRole('link', { name: /Müsli-Frühstück/ })).toBeVisible();
});
