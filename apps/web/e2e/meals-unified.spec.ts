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

async function quickAdd(page: Page, meal: number, name: string, kcal: string) {
  await page.goto(`/quick-add?meal=${meal}`);
  await page.getByLabel('Bezeichnung').fill(name);
  await page.getByLabel('Kalorien').fill(kcal);
  await page.locator('button[type=submit]').click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}

const mealCard = (page: Page, name: string) =>
  page.locator('section').filter({ has: page.getByRole('heading', { level: 2, name }) });

async function mealMenu(page: Page, meal: string, item: string) {
  await page.getByRole('button', { name: `Aktionen für ${meal}` }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

async function saveMealDialog(page: Page, name: string) {
  const dialog = page.getByRole('dialog', { name: 'Als Meal speichern' });
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByRole('button', { name: 'Meal speichern' }).click();
  await expect(page.getByText(`„${name}“ gespeichert`)).toBeVisible();
}

/** Brot (quick) and the saved meal "Bowl" (Joghurt, Beeren) in today's Mittagessen. */
async function lunch(page: Page) {
  await quickAdd(page, 0, 'Joghurt', '150');
  await quickAdd(page, 0, 'Beeren', '50');
  await page.goto('/');
  await mealMenu(page, 'Frühstück', 'Als Meal speichern');
  await saveMealDialog(page, 'Bowl');
  await mealMenu(page, 'Frühstück', 'Alle Einträge löschen');
  await expect(page.getByText('Frühstück geleert')).toBeVisible();
  await quickAdd(page, 1, 'Brot', '250');
  await page.goto('/add?meal=1&tab=mine');
  await page.getByRole('link', { name: /Bowl/ }).click();
  await page.getByRole('button', { name: /kcal eintragen$/ }).click();
  await expect(page).toHaveURL(/\/(\?.*)?$/);
}

test('diary meal ⋯: copy a whole meal to another day, save it as a meal, delete all with undo', async ({
  page,
}) => {
  await register(page);
  await lunch(page);
  const lunchCard = mealCard(page, 'Mittagessen');
  await expect(lunchCard.getByRole('link', { name: 'Bowl', exact: true })).toBeVisible();

  // Copy the whole Mittagessen, paste into yesterday's Abendessen: same rows, the group stays a group.
  await mealMenu(page, 'Mittagessen', 'Kopieren');
  await expect(page.getByText('„Mittagessen“ kopiert')).toBeVisible();
  // [Einfügen] [⋯] [+] stay on the line of the card title on an iPhone.
  const icons = [
    lunchCard.getByRole('button', { name: '„Mittagessen“ in Mittagessen eintragen' }),
    lunchCard.getByRole('button', { name: 'Aktionen für Mittagessen' }),
    lunchCard.getByRole('link', { name: 'Essen zu Mittagessen eintragen' }),
  ];
  const title = (await lunchCard.getByRole('heading', { level: 2 }).boundingBox())!;
  const card = (await lunchCard.boundingBox())!;
  for (const icon of icons) {
    const b = (await icon.boundingBox())!;
    expect(Math.abs(b.y + b.height / 2 - (title.y + title.height / 2))).toBeLessThan(4);
    expect(b.x + b.width).toBeLessThanOrEqual(card.x + card.width + 0.5);
  }
  await page.getByRole('button', { name: 'Vorheriger Tag' }).click();
  await page.getByRole('button', { name: '„Mittagessen“ in Abendessen eintragen' }).click();
  await expect(page.getByText('„Mittagessen“ in Abendessen eingetragen')).toBeVisible();
  const dinner = mealCard(page, 'Abendessen');
  await expect(dinner.getByText('Brot', { exact: true })).toBeVisible();
  await expect(dinner.getByRole('link', { name: 'Bowl', exact: true })).toBeVisible();
  await expect(dinner.getByRole('button', { name: '2 Zutaten von Bowl' })).toBeVisible();

  // Save today's Mittagessen as a meal: every ingredient on its own.
  await page.getByRole('button', { name: 'Nächster Tag' }).click();
  await mealMenu(page, 'Mittagessen', 'Als Meal speichern');
  await expect(page.getByRole('dialog', { name: 'Als Meal speichern' })).toContainText(
    'Alle 3 Zutaten werden einzeln',
  );
  await saveMealDialog(page, 'Mittag komplett');

  // Delete all entries, then undo.
  await mealMenu(page, 'Mittagessen', 'Alle Einträge löschen');
  await expect(page.getByText('Mittagessen geleert')).toBeVisible();
  await expect(lunchCard.getByText('Brot', { exact: true })).toHaveCount(0);
  await page
    .locator('[data-sonner-toast]')
    .filter({ hasText: 'Mittagessen geleert' })
    .getByRole('button', { name: 'Rückgängig' })
    .click();
  await expect(lunchCard.getByText('Brot', { exact: true })).toBeVisible();
  await expect(lunchCard.getByRole('link', { name: 'Bowl', exact: true })).toBeVisible();

  await page.goto('/meals');
  await expect(page.getByRole('link', { name: /Mittag komplett/ })).toContainText(/3\sZutaten/);

  // "Zuletzt hier" stays under a meal with entries and leaves out what it already has.
  await page.goto('/');
  await quickAdd(page, 2, 'Tee', '5');
  await page.goto('/');
  const today = mealCard(page, 'Abendessen');
  await expect(today.getByText('Zuletzt hier')).toBeVisible();
  // Yesterday's Brot was a quick add (never suggested); the meal "Bowl" is.
  await today.getByRole('button', { name: /^Bowl, / }).click();
  await expect(page.getByText('„Bowl“ in Abendessen eingetragen')).toBeVisible();
  await expect(today.getByRole('link', { name: 'Bowl', exact: true })).toBeVisible();
  await expect(today.getByRole('button', { name: /^Bowl, / })).toHaveCount(0);
  // "Wie gestern" is in the menu while the meal has entries, not a chip.
  await expect(today.getByRole('button', { name: /^Wie gestern/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Aktionen für Abendessen' }).click();
  await expect(page.getByRole('menuitem', { name: 'Wie gestern eintragen' })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('a saved meal as ingredients of another meal, and a new meal from scratch', async ({ page }) => {
  await register(page);
  await lunch(page);
  await mealMenu(page, 'Mittagessen', 'Als Meal speichern');
  await saveMealDialog(page, 'Mittag komplett');

  // "Neues Meal": nothing to save until it has a name and an ingredient.
  await page.goto('/meals');
  await page.getByRole('button', { name: 'Neues Meal' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Neues Meal' })).toBeVisible();
  const save = page.getByRole('button', { name: 'Speichern', exact: true });
  await expect(save).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Meal löschen' })).toHaveCount(0);
  await page.getByLabel('Name', { exact: true }).fill('Mein Teller');
  await expect(save).toBeDisabled();
  const editorUrl = page.url();

  // A saved meal in the search adds its ingredients one by one, scaled.
  await page.getByRole('button', { name: 'Zutat hinzufügen' }).click();
  await page.getByRole('tab', { name: 'Eigene' }).click();
  await page.getByLabel('Lebensmittel suchen').fill('Bowl');
  await page.getByRole('link', { name: /Bowl/ }).click();
  await expect(page.getByLabel('Mahlzeit')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Meal bearbeiten' })).toHaveCount(0);
  await page.getByRole('button', { name: /^2\sZutaten hinzufügen$/ }).click();
  await expect(page).toHaveURL(editorUrl);
  await expect(page.getByText('Joghurt', { exact: true })).toBeVisible();
  await expect(page.getByText('Beeren', { exact: true })).toBeVisible();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByText('„Mein Teller“ gespeichert')).toBeVisible();
  await expect(page).toHaveURL(/\/meals$/);
  await expect(page.getByRole('link', { name: /Mein Teller/ })).toContainText(/2\sZutaten/);

  // The meal being edited is not offered for itself.
  await page.getByRole('link', { name: /Mittag komplett/ }).click();
  await page.getByRole('button', { name: 'Zutat hinzufügen' }).click();
  await page.getByRole('tab', { name: 'Eigene' }).click();
  await page.getByLabel('Lebensmittel suchen').fill('Mittag');
  await expect(page.getByText('Nichts Eigenes gefunden')).toBeVisible();

  // A new meal left without any input leaves nothing behind.
  await page.goto('/meals');
  await page.getByRole('button', { name: 'Neues Meal' }).click();
  await page.getByRole('button', { name: 'Zurück' }).click();
  await expect(page).toHaveURL(/\/meals$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('diary group editor: save an analysed group as a meal, then update that meal; the hint grows', async ({
  page,
}) => {
  await register(page);
  await page.route('**/api/ai/status', (r) =>
    r.fulfill({ json: { enabled: true, model: 'claude-opus-5-5' } }),
  );
  const item = (name: string, id: string, kcal: number, grams: number) => ({
    name,
    grams,
    confidence: 'high',
    preparation: null,
    packaged: false,
    searchTerms: [],
    candidates: [
      {
        food: {
          id,
          source: 'bls',
          sourceId: id,
          name,
          nameEn: null,
          brand: null,
          group: null,
          unit: 'g',
          nutrients: { ENERCC: kcal, PROT625: 10, CHO: 20, FAT: 5 },
          portions: [],
        },
        score: 1,
      },
    ],
  });
  let hint = '';
  await page.route('**/api/ai/analyze', async (r) => {
    hint = String(
      r
        .request()
        .postDataBuffer()
        ?.toString('latin1')
        .match(/name="text"\r\n\r\n([^\r]*)/)?.[1],
    );
    await r.fulfill({
      json: {
        analysisId: '00000000-0000-7000-8000-000000000009',
        dishName: 'Reis mit Hähnchen',
        items: [item('Reis gekocht', 'bls:R', 130, 200), item('Hähnchenbrust', 'bls:H', 110, 150)],
        notes: null,
        model: 'claude-opus-5-5',
        usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.03 },
      },
    });
  });
  await page.goto('/photo?meal=1');
  await page.locator('input[type=file]:not([capture])').setInputFiles('public/pwa-192x192.png');
  // The hint is a field that grows with its text; Enter is a new line, not "Analysieren".
  const hintField = page.getByLabel('Hinweis für die Analyse (optional)');
  const oneLine = (await hintField.boundingBox())!.height;
  await hintField.fill('Reis mit Hähnchen aus der Kantine, '.repeat(6).trim());
  await hintField.press('Enter');
  await expect(page.getByRole('heading', { name: 'Ergebnis prüfen' })).toHaveCount(0);
  expect((await hintField.boundingBox())!.height).toBeGreaterThan(oneLine * 1.5);
  await page.getByRole('button', { name: 'Analysieren' }).click();
  await expect(page.getByRole('heading', { name: 'Ergebnis prüfen' })).toBeVisible();
  expect(hint.length).toBeGreaterThan(150);
  await expect(page.getByLabel('Hinweis für die Analyse', { exact: true })).toHaveValue(/Kantine/);
  await page.getByRole('button', { name: 'Meal eintragen' }).click();
  await expect(page.getByText('„Reis mit Hähnchen“ eingetragen')).toBeVisible();

  // Tap the group, save it as a new meal (no meal yet: no choice).
  await page.getByRole('link', { name: 'Reis mit Hähnchen', exact: true }).click();
  await expect(page).toHaveURL(/\/diary-group\//);
  await page.getByRole('button', { name: 'Als Meal speichern' }).click();
  const dialog = page.getByRole('dialog', { name: 'Als Meal speichern' });
  await expect(dialog.getByRole('radio')).toHaveCount(0);
  await expect(dialog.getByLabel('Name')).toHaveValue('Reis mit Hähnchen');
  await dialog.getByRole('button', { name: 'Meal speichern' }).click();
  await expect(page.getByText('„Reis mit Hähnchen“ gespeichert')).toBeVisible();
  await expect(page).not.toHaveURL(/\/diary-group\//);

  // Now the group belongs to that meal: change an amount and update the meal.
  await page.getByRole('link', { name: 'Reis mit Hähnchen', exact: true }).click();
  await page.getByLabel('Menge', { exact: true }).first().fill('100');
  await page.getByRole('button', { name: 'Als Meal speichern' }).click();
  await expect(dialog).toContainText('Übernimmt auch deine Änderungen');
  await dialog.getByRole('radio', { name: '„Reis mit Hähnchen“ aktualisieren' }).click();
  await expect(dialog).toContainText('Bereits eingetragene Tage bleiben');
  await dialog.getByLabel('Name').fill('Reis Hähnchen leicht');
  await dialog.getByRole('button', { name: 'Meal speichern' }).click();
  await expect(page.getByText('„Reis Hähnchen leicht“ gespeichert')).toBeVisible();

  await page.goto('/meals');
  await expect(page.getByRole('link', { name: /Reis/ })).toHaveCount(1);
  await page.getByRole('link', { name: /Reis Hähnchen leicht/ }).click();
  await expect(page.getByLabel('Menge', { exact: true }).first()).toHaveValue('100');
});
