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

/** Saves the entries of a diary meal as a reusable meal: meal page, ⋯ menu, name dialog. */
async function saveDiaryMeal(page: Page, mealName: string, name: string) {
  await page.goto('/');
  await page.getByRole('link', { name: new RegExp(`^${mealName}`) }).click();
  await expect(page).toHaveURL(/\/diary-meal\?/);
  await page.getByRole('button', { name: `Aktionen für ${mealName}` }).click();
  await page.getByRole('menuitem', { name: 'Als Meal speichern' }).click();
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

/**
 * Types into the training search and waits until the text is in the URL (debounced): a tap on a
 * result while that replace runs would be lost.
 */
async function searchTraining(page: Page, text: string, label = 'Sportart oder Training suchen') {
  await page.getByLabel(label).fill(text);
  if (text.length >= 2) await expect(page).toHaveURL(new RegExp(`[?&]q=${encodeURIComponent(text)}(&|$)`));
}

async function swipeRight(page: Page, target: Locator) {
  await target.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const box = (await target.boundingBox())!;
  const y = box.y + box.height / 2;
  const x = box.x + 10;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (const dx of [10, 40, 80, 120, 160]) await page.mouse.move(x + dx, y);
  await page.mouse.up();
}

test('copy a training to another day, "Wie gestern" on an empty card', async ({ page }) => {
  await register(page);
  // Days as the app sees them (Berlin time, like the browser of the test).
  const day = (offset: number) =>
    new Date(Date.now() + offset * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
  await page.goto(`/exercise?date=${day(-1)}`);
  await searchTraining(page, 'rad');
  await page.getByRole('link', { name: /^Radfahren/ }).click();
  await page.getByRole('button', { name: /^Eintragen · \d+ kcal$/ }).click();
  await expect(page.getByRole('link', { name: /^Radfahren/ })).toBeVisible();

  // Swipe right copies; only the training card offers to paste it (no meal does).
  await swipeRight(page, page.getByText('Radfahren', { exact: true }));
  await expect(page.getByText('„Radfahren“ kopiert')).toBeVisible();
  await expect(page.getByRole('button', { name: '„Radfahren“ ins Training eintragen' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^„Radfahren“ in .* eintragen$/ })).toHaveCount(0);
  await page.goto(`/?date=${day(-3)}`);
  await page.getByRole('button', { name: '„Radfahren“ ins Training eintragen' }).click();
  await expect(page.getByText('„Radfahren“ eingetragen')).toBeVisible();
  await expect(page.getByRole('link', { name: /^Radfahren/ })).toContainText(/30 Min\. · Mittel/);

  // The day after: the empty card offers yesterday's trainings as its first chip.
  await page.goto('/');
  await page.getByRole('button', { name: /^Wie gestern, 1 Training · \d+ kcal, eintragen$/ }).click();
  await expect(page.getByText('Trainings von gestern eingetragen')).toBeVisible();
  await expect(page.getByRole('link', { name: /^Radfahren/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Wie gestern/ })).toHaveCount(0);
});

test('a sport: search, duration wheel with an exact value, own kcal, edit, save as a training', async ({
  page,
}) => {
  await register(page);
  await page.goto('/exercise');
  // "Häufig" without history: every sport A to Z.
  await expect(page.getByText('Alle Sportarten')).toBeVisible();
  await searchTraining(page, 'lauf');
  await expect(page.getByRole('button', { name: 'Eigene Sportart „lauf“ anlegen' })).toBeVisible();
  await page.getByRole('link', { name: /^Laufen \/ Joggen/ }).click();
  await expect(page).toHaveURL(/\/sport\/running\?/);
  await expect(page.getByRole('heading', { level: 1, name: 'Laufen / Joggen' })).toBeVisible();
  const wheel = page.getByRole('slider', { name: 'Dauer Laufen / Joggen' });
  await expect(wheel).toHaveAttribute('aria-valuenow', '30');
  // "Genau eingeben" opens a minute field; 47 gets its own row on the wheel.
  const exact = page.getByRole('button', { name: 'Genau eingeben' });
  await exact.click();
  await expect(exact).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Dauer in Minuten').fill('47');
  await expect(wheel).toHaveAttribute('aria-valuenow', '47');
  await page.getByLabel('Notiz (optional)').fill('Intervalle 6 × 400 m');
  // A value from the watch stays; the link takes the computed one again.
  await page.getByLabel('Verbrauch').fill('520');
  await expect(page.getByRole('button', { name: /^Berechneten Wert verwenden \(\d+ kcal\)$/ })).toBeVisible();
  await page.getByRole('button', { name: 'Eintragen · 520 kcal' }).click();

  await expect(page).toHaveURL(/\/(\?.*)?$/);
  const row = page.getByRole('link', { name: /^Laufen \/ Joggen/ });
  await expect(row).toContainText(/47 Min\. · Mittel · Intervalle 6 × 400 m/);
  await expect(row).toContainText('+520');
  await expect(page.getByRole('heading', { name: /^Training/ })).toContainText('520 kcal');

  // Editing keeps the typed kcal when the duration changes, until the computed value is taken.
  await row.click();
  await expect(page).toHaveURL(/\/exercise-entry\//);
  await expect(page.getByLabel('Verbrauch')).toHaveValue('520');
  await page.getByRole('slider', { name: 'Dauer Laufen / Joggen' }).press('ArrowDown');
  await expect(page.getByRole('slider', { name: 'Dauer Laufen / Joggen' })).toHaveAttribute(
    'aria-valuenow',
    '50',
  );
  await expect(page.getByLabel('Verbrauch')).toHaveValue('520');
  await page.getByRole('button', { name: /^Berechneten Wert verwenden/ }).click();
  await expect(page.getByLabel('Verbrauch')).not.toHaveValue('520');
  await page.getByRole('button', { name: 'Änderungen übernehmen' }).click();
  await expect(page).toHaveURL(/\/(\?.*)?$/);
  await expect(page.getByRole('link', { name: /^Laufen \/ Joggen/ })).toContainText(/50 Min\. · Mittel/);
  await expect(page.getByRole('link', { name: /^Laufen \/ Joggen/ })).not.toContainText('+520');

  // The save icon of the sport page makes a saved training of one activity; logged from there it carries its name.
  await page.goto('/exercise');
  await searchTraining(page, 'dehn');
  await page.getByRole('link', { name: /^Dehnen/ }).click();
  await page.getByRole('button', { name: 'Als Training speichern' }).click();
  const dialog = page.getByRole('dialog', { name: 'Als Training speichern' });
  await dialog.getByLabel('Name').fill('Abenddehnen');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Gespeichert als „Abenddehnen“')).toBeVisible();
  await page.getByRole('button', { name: /^Eintragen · \d+ kcal$/ }).click();
  await expect(page.getByRole('link', { name: /^Abenddehnen/ })).toContainText(
    /Dehnen \/ Mobility · 30 Min\. · Mittel/,
  );

  // The search finds a saved training by its name and by its sport; "Kürzlich" lists what was logged.
  await page.goto('/exercise');
  await searchTraining(page, 'mobil');
  await expect(page.getByRole('link', { name: /Abenddehnen/ })).toBeVisible();
  await page.getByLabel('Sportart oder Training suchen').fill('');
  await expect(page).not.toHaveURL(/[?&]q=/);
  await page.getByRole('tab', { name: 'Kürzlich' }).click();
  await expect(page.getByRole('link', { name: /Abenddehnen.*1× eingetragen/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Laufen \/ Joggen.*1× eingetragen/ })).toBeVisible();

  // An own sport from the search: the dialog takes the typed name, then its page opens.
  await searchTraining(page, 'Paddeln');
  await page.getByRole('button', { name: 'Eigene Sportart „Paddeln“ anlegen' }).click();
  const custom = page.getByRole('dialog', { name: 'Eigene Sportart' });
  await expect(custom.getByLabel('Name')).toHaveValue('Paddeln');
  await custom.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Paddeln' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Mittel' })).toBeDisabled();
});

test('saved trainings with several activities: editor via the search, pin, log, change and update, package row', async ({
  page,
}) => {
  await register(page);
  await page.goto('/trainings');
  await expect(page.getByText('Noch keine gespeicherten Trainings.')).toBeVisible();
  await page.getByRole('button', { name: 'Neues Training' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Neues Training' })).toBeVisible();
  const save = page.getByRole('button', { name: 'Speichern', exact: true });
  await expect(save).toBeDisabled();
  await page.getByLabel('Name').fill('Gym-Besuch');
  // "Aktivität hinzufügen" is the training search with the training as target (only sports).
  for (const [query, sport] of [
    ['kraft', /^Krafttraining/],
    ['dehn', /^Dehnen/],
  ] as const) {
    await page.getByRole('button', { name: 'Aktivität hinzufügen' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Zu „Gym-Besuch“ hinzufügen' })).toBeVisible();
    await searchTraining(page, query, 'Sportart suchen');
    await page.getByRole('link', { name: sport }).click();
    await page.getByRole('button', { name: 'Hinzufügen' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Gym-Besuch' })).toBeVisible();
  }
  await expect(page.getByRole('button', { name: /^Krafttraining\s*30 Min/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Krafttraining entfernen' })).toBeEnabled();
  await page.getByRole('switch').click();
  await save.click();
  await expect(page.getByText('„Gym-Besuch“ gespeichert', { exact: true })).toBeVisible();
  // Saving closes the editor, and back does not lead into it again.
  await expect(page).toHaveURL(/\/trainings$/);
  const listRow = page.getByRole('link', { name: /Gym-Besuch/ });
  await expect(listRow).toContainText('Krafttraining · Dehnen · 1 Std.');
  await expect(listRow.getByLabel('angepinnt')).toBeVisible();
  await page.getByRole('button', { name: 'Zurück' }).click();
  await expect(page).not.toHaveURL(/\/trainings\//);

  // Pinned: the first chip of the diary, never logged yet. One tap logs both activities as one row.
  await page.goto('/');
  await page
    .getByRole('button', { name: /^Gym-Besuch, Krafttraining · Dehnen · 1 Std\., eintragen$/ })
    .click();
  await expect(page.getByText(/^„Gym-Besuch“ eingetragen: \d+ kcal$/)).toBeVisible();
  const pkg = page.getByRole('button', { name: /^Gym-Besuch\s*2 Aktivitäten · 1 Std\./ });
  await expect(pkg).toHaveAttribute('aria-expanded', 'false');
  await pkg.click();
  await expect(pkg).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('link', { name: /^Krafttraining/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Krafttraining' })).toBeVisible();
  // A part of a package is no saved training of its own.
  await expect(page.getByRole('button', { name: 'Als Training speichern' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Zurück' }).click();
  // Swipe deletes the package as a whole, undo brings back both.
  await swipeLeft(page, page.getByText('Gym-Besuch', { exact: true }));
  await page.getByRole('button', { name: 'Gym-Besuch löschen' }).click();
  await expect(page.getByText('2 Aktivitäten · 1 Std.')).toHaveCount(0);
  await page
    .locator('[data-sonner-toast]', { hasText: 'Gym-Besuch gelöscht' })
    .getByRole('button', { name: 'Rückgängig' })
    .click();
  await expect(page.getByText('2 Aktivitäten · 1 Std.')).toBeVisible();

  // "Training eintragen" of the saved training: its saved values, a change marks the row, the save
  // icon updates it.
  await page.goto('/exercise');
  await page.getByRole('link', { name: /Gym-Besuch/ }).click();
  await expect(page).toHaveURL(/\/trainings\/[^/?]+\?date=/);
  const saveIcon = page.getByRole('button', { name: 'Als Training speichern' });
  await expect(saveIcon).toBeDisabled();
  await expect(page.getByText('geändert')).toHaveCount(0);
  await page.getByRole('slider', { name: 'Dauer Krafttraining' }).press('ArrowUp');
  await expect(page.getByText('geändert')).toBeVisible();
  await saveIcon.click();
  const ask = page.getByRole('dialog', { name: 'Als Training speichern' });
  await expect(ask.getByRole('radio', { name: '„Gym-Besuch“ aktualisieren' })).toBeChecked();
  await ask.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('„Gym-Besuch“ aktualisiert')).toBeVisible();
  await expect(page.getByText('geändert')).toHaveCount(0);
  await expect(page.getByText(/Aktivitäten\s*55 Min\./)).toBeVisible();
  await page.getByRole('button', { name: /^Eintragen · \d+ kcal$/ }).click();
  await expect(page).toHaveURL(/\/(\?.*)?$/);
  await expect(page.getByRole('button', { name: /^Gym-Besuch\s*2 Aktivitäten · 55 Min\./ })).toBeVisible();

  // Delete from the editor, then restore from the trash.
  await page.goto('/trainings');
  await page.getByRole('link', { name: /Gym-Besuch/ }).click();
  await page.getByRole('button', { name: 'Training löschen' }).click();
  await expect(page).toHaveURL(/\/trainings$/);
  await page.goto('/settings/trash');
  await expect(page.getByText(/Krafttraining · Dehnen · 55 Min\. · gelöscht am/)).toBeVisible();
  await page.getByRole('button', { name: 'Gym-Besuch wiederherstellen' }).click();
  await expect(page.getByText('„Gym-Besuch“ wiederhergestellt', { exact: true })).toBeVisible();
});

test('swipe to delete a diary entry with undo, date picker on the title', async ({ page }) => {
  await register(page);
  await page.goto('/photo?form=1&meal=0');
  await page.getByLabel('Was hast du gegessen?').fill('Croissant');
  await page.getByLabel('Kalorien').fill('230');
  await page.getByRole('button', { name: 'Eintragen', exact: true }).click();
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

test('add menu: weight, food (highlighted, middle), training; the food page leads to form and search', async ({
  page,
}) => {
  await register(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Eintragen', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Eintragen', exact: true });
  await expect(sheet.getByRole('button')).toHaveText([
    'Gewicht eintragen',
    'Essen eintragen',
    'Training eintragen',
  ]);
  const food = sheet.getByRole('button', { name: 'Essen eintragen' });
  const training = sheet.getByRole('button', { name: 'Training eintragen' });
  const bg = (el: Locator) => el.evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(await bg(food)).not.toBe(await bg(training));
  await training.click();
  await expect(page).toHaveURL(/\/exercise/);
  await expect(page.getByRole('heading', { level: 1, name: 'Training eintragen' })).toBeVisible();

  await page.goto('/');
  await page.getByRole('button', { name: 'Eintragen', exact: true }).click();
  await sheet.getByRole('button', { name: 'Essen eintragen' }).click();
  await expect(page).toHaveURL(/\/photo\?/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Essen eintragen');
  // No header icons; under the camera "Eingeben" (left) and "Suchen" (right).
  await expect(page.getByRole('banner').getByRole('link')).toHaveCount(0);
  const type = page.getByRole('button', { name: 'Eingeben' });
  expect((await type.boundingBox())!.x).toBeLessThan(
    (await page.getByRole('link', { name: 'Suchen' }).boundingBox())!.x,
  );
  // The form is a step of its own: back returns to the camera.
  await type.click();
  await expect(page).toHaveURL(/\/photo\?.*form=true/);
  await expect(page.getByLabel('Was hast du gegessen?')).toBeVisible();
  await page.getByRole('button', { name: 'Zurück' }).click();
  await expect(page).toHaveURL(/\/photo\?(?!.*form=)/);
  await expect(type).toBeVisible();
  // The search is a page of its own: back returns to the food page, once more to the diary.
  await page.getByRole('link', { name: 'Suchen' }).click();
  await expect(page).toHaveURL(/\/add\?/);
  await expect(page.getByRole('link', { name: 'Foto oder Barcode' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Zurück' }).click();
  await expect(page).toHaveURL(/\/photo\?/);
  await page.getByRole('button', { name: 'Zurück' }).click();
  await expect(page).toHaveURL(/\/(\?.*)?$/);

  // Without a chosen meal the next entry goes where the last one went (for 20 minutes), whatever the
  // clock says: two different meals, so at least one of them is not the meal of this hour.
  for (const [meal, name] of [
    [3, 'Nüsse'],
    [0, 'Kaffee'],
  ] as const) {
    await quickAdd(page, meal, name, '100');
    await page.getByRole('button', { name: 'Eintragen', exact: true }).click();
    await sheet.getByRole('button', { name: 'Essen eintragen' }).click();
    await expect(page).toHaveURL(new RegExp(`/photo\\?.*meal=${meal}`));
    // Today: the form names no day.
    await expect(page.getByText(/^(Gestern|Morgen), /)).toHaveCount(0);
  }
  // The "+" of a meal always wins.
  await page.goto('/');
  await page.getByRole('link', { name: 'Essen zu Mittagessen eintragen' }).click();
  await expect(page).toHaveURL(/\/photo\?.*meal=1/);
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
  await page.getByRole('button', { name: 'Eintragen', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Eintragen', exact: true });
  await expect(sheet).toBeVisible();
  const box = (await sheet.boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(460);
  expect(box.height).toBeLessThan(450);
  expect(Math.abs(box.x + box.width / 2 - 720)).toBeLessThan(4);
  await context.close();
});

async function quickAdd(page: Page, meal: number, name: string, kcal: string) {
  // "Eingeben" on the food page: a text and calories make a quick entry named after the text.
  await page.goto(`/photo?form=1&meal=${meal}`);
  await page.getByLabel('Was hast du gegessen?').fill(name);
  await page.getByLabel('Kalorien').fill(kcal);
  await page.getByRole('button', { name: 'Eintragen', exact: true }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}

const mealCard = (page: Page, name: string) =>
  page.locator('section').filter({ has: page.getByRole('heading', { level: 2, name }) });

test('the "+" of a meal opens the food page for that meal, ⋯ of an empty meal has nothing to do', async ({
  page,
}) => {
  await register(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Aktionen für Mittagessen' }).click();
  for (const name of ['Kopieren', 'Als Meal speichern', 'Alle Einträge löschen'])
    await expect(page.getByRole('menuitem', { name })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Wie gestern eintragen' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'Essen zu Mittagessen eintragen' }).click();
  await expect(page).toHaveURL(/\/photo\?.*meal=1/);
  await expect(page.getByRole('button', { name: 'Mahlzeit: Mittagessen' })).toBeVisible();

  // The empty state of a meal goes there as well.
  await page.goto('/');
  await mealCard(page, 'Abendessen').getByRole('link', { name: 'Essen eintragen', exact: true }).click();
  await expect(page).toHaveURL(/\/photo\?.*meal=2/);

  // So do the "+" and the empty state on the meal page, whose ⋯ menu has nothing to save while it is empty.
  await page.goto('/diary-meal?meal=3');
  await page.getByRole('button', { name: 'Aktionen für Snacks' }).click();
  await expect(page.getByRole('menuitem', { name: 'Als Meal speichern' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.getByRole('main').getByRole('link', { name: 'Essen eintragen', exact: true }).click();
  await expect(page).toHaveURL(/\/photo\?.*meal=3/);
  await page.goto('/diary-meal?meal=3');
  await page.getByRole('link', { name: 'Essen zu Snacks eintragen' }).click();
  await expect(page).toHaveURL(/\/photo\?.*meal=3/);
});

test('back means the page before: the diary keeps its place, shows the new entry, never reopens a form', async ({
  page,
}) => {
  await register(page);
  for (const meal of [0, 1])
    for (const n of [1, 2, 3, 4, 5]) await quickAdd(page, meal, `Happen ${meal}${n}`, '100');
  // A clean history inside the app: "Mehr", then the diary.
  await page.goto('/more');
  await page.getByRole('link', { name: 'Tagebuch' }).click();
  await expect(page.getByText('Happen 15', { exact: true })).toBeVisible();
  const scrollY = () => page.evaluate(() => window.scrollY);
  const plus = page.getByRole('link', { name: 'Essen zu Abendessen eintragen' });
  await plus.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const y = await scrollY();
  expect(y).toBeGreaterThan(300);

  // (b) "+", search, then back twice: every step is the page before, the diary stands where it stood.
  await plus.click();
  await expect(page).toHaveURL(/\/photo\?.*meal=2/);
  await page.getByRole('link', { name: 'Suchen' }).click();
  await expect(page).toHaveURL(/\/add\?/);
  await page.goBack();
  await expect(page).toHaveURL(/\/photo\?/);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('Happen 15', { exact: true })).toBeVisible();
  await expect.poll(scrollY).toBeGreaterThan(y - 3);
  expect(await scrollY()).toBeLessThan(y + 3);

  // (a) "+", search, food page, log: the diary is back at the old place with the new entry on the
  // screen (it was there already, so nothing moved).
  await plus.click();
  await page.getByRole('link', { name: 'Suchen' }).click();
  await page.getByLabel('Lebensmittel suchen').fill('haferflocken');
  await page.getByRole('link', { name: /^Hafer Flocken BLS/ }).click();
  await expect(page).toHaveURL(/\/food\//);
  await page.getByRole('button', { name: 'Zu Abendessen eintragen' }).click();
  await expect(page).toHaveURL(/\/$/);
  const oats = mealCard(page, 'Abendessen').getByText('Hafer Flocken', { exact: true });
  await expect(oats).toBeInViewport({ ratio: 1 });
  await expect.poll(scrollY).toBeGreaterThan(y - 3);
  expect(await scrollY()).toBeLessThan(y + 3);
  // Search, food page and camera are gone from the history: back leaves the diary.
  await page.goBack();
  await expect(page).toHaveURL(/\/more$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/$/);

  // (c) Open the entry and delete it: back to the diary, and "back" does not show the deleted entry.
  await mealCard(page, 'Abendessen').getByText('Hafer Flocken', { exact: true }).click();
  await expect(page).toHaveURL(/\/entry\//);
  await page.getByRole('button', { name: 'Eintrag löschen' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('Hafer Flocken gelöscht')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/more$/);

  // Changing an entry returns to the diary it was opened from as well, at the same place.
  await page.goForward();
  await expect(page.getByText('Happen 15', { exact: true })).toBeVisible();
  await page.getByText('Happen 15', { exact: true }).evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const y2 = await scrollY();
  await page.getByText('Happen 15', { exact: true }).click();
  await expect(page).toHaveURL(/quick-add/);
  await page.getByLabel('Kalorien').fill('120');
  await page.getByRole('button', { name: 'Änderungen übernehmen' }).click();
  await expect(page.getByText('Änderungen übernommen')).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(scrollY).toBeGreaterThan(y2 - 3);
  await page.goBack();
  await expect(page).toHaveURL(/\/more$/);

  // A flow that did not start on the diary (deep link): the diary replaces the form and scrolls to
  // the new entry, which is far below the top.
  await page.goto('/add?meal=3');
  await page.getByLabel('Lebensmittel suchen').fill('haferflocken');
  await page.getByRole('link', { name: /^Hafer Flocken BLS/ }).click();
  await page.getByRole('button', { name: 'Zu Snacks eintragen' }).click();
  await expect(page).toHaveURL(/\/(\?.*)?$/);
  await expect(mealCard(page, 'Snacks').getByText('Hafer Flocken', { exact: true })).toBeInViewport({
    ratio: 1,
  });
  expect(await scrollY()).toBeGreaterThan(300);
  await page.goBack();
  await expect(page).not.toHaveURL(/\/food\//);
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

test('a diary group: the row opens its editor, the chevron expands, the saved meal stays', async ({
  page,
}) => {
  await register(page);
  await quickAdd(page, 0, 'Joghurt', '150');
  await quickAdd(page, 0, 'Beeren', '50');
  await saveDiaryMeal(page, 'Frühstück', 'Bowl');
  await page.goto('/add?meal=1&tab=mine');
  await page.getByRole('link', { name: /Bowl/ }).click();
  await page.getByRole('button', { name: '200 kcal eintragen' }).click();
  const lunch = mealCard(page, 'Mittagessen');

  // Only the chevron expands; the page stays.
  const toggle = lunch.getByRole('button', { name: '2 Zutaten von Bowl' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('list', { name: 'Zutaten von Bowl' })).toBeVisible();
  await expect(page).toHaveURL(/\/(\?.*)?$/);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  // The row opens the editor of this entry.
  await lunch.getByRole('link', { name: 'Bowl', exact: true }).click();
  await expect(page).toHaveURL(/\/diary-group\/.+date=/);
  await expect(page.getByRole('heading', { level: 1, name: 'Bowl' })).toBeVisible();
  const apply = page.getByRole('button', { name: 'Änderungen übernehmen' });
  await expect(apply).toBeDisabled();
  await page.getByLabel('Name').fill('Große Bowl');
  await page.getByLabel('Menge', { exact: true }).first().fill('2');
  await expect(apply).toBeEnabled();

  // Adding an ingredient goes through the search and back into the editor (device draft).
  await page.getByRole('button', { name: 'Zutat hinzufügen' }).click();
  await expect(page).toHaveURL(/\/add\?.*into=group/);
  await page.getByLabel('Lebensmittel suchen').fill('haferflocken');
  await page.getByRole('link', { name: /^Hafer Flocken BLS/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Zu „Große Bowl“' })).toBeVisible();
  await page.getByLabel('Menge', { exact: true }).fill('50');
  await page.getByRole('button', { name: 'Zum Eintrag hinzufügen' }).click();
  await expect(page).toHaveURL(/\/diary-group\//);
  await expect(page.getByText('Hafer Flocken', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Name')).toHaveValue('Große Bowl');

  // Leaving with changes asks first.
  await page.getByRole('button', { name: 'Zurück' }).click();
  const discard = page.getByRole('dialog', { name: 'Änderungen verwerfen?' });
  await expect(discard).toContainText('Wenn du die Änderungen nicht übernimmst');
  await discard.getByRole('button', { name: 'Weiter bearbeiten' }).click();

  await apply.click();
  await expect(page.getByText('Änderungen übernommen')).toBeVisible();
  await expect(page).toHaveURL(/\/(\?.*)?$/);
  const renamed = lunch.getByRole('link', { name: 'Große Bowl', exact: true });
  await expect(renamed).toBeVisible();
  await expect(lunch.getByRole('button', { name: '3 Zutaten von Große Bowl' })).toBeVisible();
  // Joghurt twice (300) + Beeren (50) + 50 g Hafer Flocken (174).
  await expect(
    lunch.getByRole('listitem').filter({ has: page.getByRole('link', { name: 'Große Bowl', exact: true }) }),
  ).toContainText('524');

  // The saved meal is unchanged.
  await page.goto('/meals');
  await page.getByRole('link', { name: /Bowl/ }).click();
  await expect(page.getByLabel('Name')).toHaveValue('Bowl');
  await expect(page.getByLabel('Menge', { exact: true }).first()).toHaveValue('1');
  await expect(page.getByText('Hafer Flocken', { exact: true })).toHaveCount(0);
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

test('weight: measuring tape snaps to 0,05 kg, exact value with two decimals', async ({ page }) => {
  await register(page);
  await page.goto('/progress');
  await page.getByRole('button', { name: 'Gewicht eintragen' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Gewicht eintragen' });
  // The dialog sits at the top, not in the middle.
  expect((await dialog.boundingBox())!.y).toBeLessThan(40);
  await expect(dialog.getByRole('button', { name: /kg (weniger|mehr)/ })).toHaveCount(0);
  await dialog.getByLabel('Genauer Wert').fill('84,5');
  await dialog.getByRole('button', { name: 'Eintragen' }).click();
  await expect(page.getByText('84,5 kg eingetragen')).toBeVisible();

  await page.getByRole('button', { name: 'Gewicht eintragen' }).first().click();
  const tape = dialog.getByRole('slider', { name: 'Gewicht in Kilogramm' });
  await expect(tape).toHaveAttribute('aria-valuenow', '84.5');
  await expect(dialog.getByLabel('Genauer Wert')).toHaveValue('84,50');
  await expect(dialog.locator('output')).toHaveText('84,50');
  await tape.focus();
  await page.keyboard.press('ArrowRight');
  await expect(dialog.locator('output')).toHaveText('84,55');
  await expect(dialog.getByLabel('Genauer Wert')).toHaveValue('84,55');

  // Dragging: half the width is half a kilogram (±0,5 kg visible by default); always on the raster.
  const box = (await tape.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.75, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, y, { steps: 5 });
  await page.mouse.move(box.x + box.width * 0.25 - 3, y, { steps: 5 });
  await page.mouse.up();
  const after = Number(await tape.getAttribute('aria-valuenow'));
  expect(after).toBeGreaterThan(85.0);
  expect(after).toBeLessThan(85.2);
  expect(Math.round(after * 100) % 5).toBe(0);

  // Off the raster is fine when typed; out of range is not.
  await dialog.getByLabel('Genauer Wert').fill('84,37');
  await expect(dialog.locator('output')).toHaveText('84,37');
  await dialog.getByLabel('Genauer Wert').fill('500');
  await expect(dialog.getByText('Zwischen 20 und 400 kg.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Eintragen' })).toBeDisabled();
  await dialog.getByLabel('Genauer Wert').fill('84,3');
  await dialog.getByLabel('Genauer Wert').blur();
  await expect(dialog.getByLabel('Genauer Wert')).toHaveValue('84,30');
  await dialog.getByRole('button', { name: 'Eintragen' }).click();
  await expect(page.getByText('84,3 kg eingetragen')).toBeVisible();
});

test('dialog scrolls its middle part on a short screen, the buttons stay visible', async ({ page }) => {
  await register(page);
  await page.setViewportSize({ width: 390, height: 400 });
  await page.goto('/progress');
  await page.getByRole('button', { name: 'Gewicht eintragen' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Gewicht eintragen' });
  const save = dialog.getByRole('button', { name: 'Eintragen' });
  const box = (await dialog.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(400);
  await expect(save).toBeInViewport();
  const body = dialog.locator('[data-slot=dialog-body]');
  expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await dialog.getByLabel('Genauer Wert').scrollIntoViewIfNeeded();
  await expect(dialog.getByLabel('Genauer Wert')).toBeInViewport();
  await expect(save).toBeInViewport();
});

test('weight entries delete by swipe only, with undo', async ({ page }) => {
  await register(page);
  await page.goto('/progress');
  await page.getByRole('button', { name: 'Gewicht eintragen' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Gewicht eintragen' });
  await dialog.getByLabel('Genauer Wert').fill('84,5');
  await dialog.getByRole('button', { name: 'Eintragen' }).click();
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

test('steps from Apple Health: access, import by the shortcut, typed kcal stay, trash', async ({ page }) => {
  await register(page);
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });

  // Mehr → Schritte: the access is shown once, with the address to send to.
  await page.goto('/more');
  await expect(page.getByRole('link', { name: /Schritte.*Nicht eingerichtet/ })).toBeVisible();
  await page.getByRole('link', { name: /^Schritte/ }).click();
  await expect(page.getByRole('heading', { name: 'Kurzbefehl' })).toBeVisible();
  await expect(page.getByText('Gruppieren nach Tag').first()).toBeVisible();
  await page.getByRole('button', { name: 'Zugang erstellen' }).click();
  const token = (await page.locator('code', { hasText: /^ftst_/ }).textContent())!;
  await expect(page.getByText('Nur jetzt sichtbar.')).toBeVisible();
  await expect(page.locator('code', { hasText: /\/api\/steps\/import$/ })).toBeVisible();

  // The shortcut: day-first lists as text, like an iPhone without a date format sends them.
  const send = (steps: string) =>
    page.request.post('/api/steps/import', {
      headers: { authorization: `Bearer ${token}` },
      data: {
        stepDates: today,
        stepValues: steps,
        distanceDates: today,
        distanceValues: '6,1 km',
        now: today,
      },
    });
  expect((await send('8432')).ok()).toBe(true);

  // The diary pulls it on start: the steps row stands first, with ↻ on an iPhone.
  await page.goto('/');
  const row = page.getByRole('link', { name: '8.432 Schritte' });
  await expect(row).toBeVisible();
  await expect(page.getByText('6,1 km', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Schritte abrufen' })).toBeVisible();
  // No "training" for the week strip and no suggestion of steps.
  await expect(page.getByRole('link', { name: /Training eingetragen$/ })).toHaveCount(0);

  // Typed kcal (from the watch) stay when the next import raises the steps.
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/steps/${today}$`));
  await page.getByLabel('Verbrauch').fill('290');
  // The change must reach the server before the shortcut sends again (else the newer import wins).
  const pushed = page.waitForResponse((r) => r.url().includes('/api/sync/push'));
  await page.getByRole('button', { name: 'Änderungen übernehmen' }).click();
  await expect(page.getByText('+290', { exact: true })).toBeVisible();
  await pushed;
  expect((await send('9000')).ok()).toBe(true);
  await page.reload();
  await expect(page.getByRole('link', { name: '9.000 Schritte' })).toBeVisible();
  await expect(page.getByText('+290', { exact: true })).toBeVisible();

  // Deleting asks first; the next import leaves the day alone; the trash brings it back.
  await page.getByRole('link', { name: '9.000 Schritte' }).click();
  await page.getByRole('button', { name: 'Schritte löschen' }).click();
  const deleted = page.waitForResponse((r) => r.url().includes('/api/sync/push'));
  await page.getByRole('dialog').getByRole('button', { name: 'Löschen' }).click();
  await expect(page.getByRole('link', { name: /Schritte$/ })).toHaveCount(0);
  await deleted;
  expect((await send('9500')).ok()).toBe(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: /^Training/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Schritte$/ })).toHaveCount(0);
  await page.goto('/settings/trash');
  await page.getByRole('button', { name: /^Schritte vom .* wiederherstellen$/ }).click();
  await expect(page.getByText(/^Schritte vom .* wiederhergestellt$/)).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('link', { name: '9.000 Schritte' })).toBeVisible();
});
