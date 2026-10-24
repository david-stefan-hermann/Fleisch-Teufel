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

const mealCard = (page: Page, name: string) =>
  page.locator('section').filter({ has: page.getByRole('heading', { level: 2, name }) });

/** Yesterday as the browser sees it (the app's "today" is the device's local date). */
async function yesterday(page: Page): Promise<string> {
  return page.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
}

test('"Zuletzt hier" logs yesterday\'s food again with one tap; "Wie gestern" copies a meal; both undo', async ({
  page,
}) => {
  await register(page);
  const y = await yesterday(page);

  // Yesterday: a database food in breakfast, a quick add in lunch.
  await page.goto(`/add?date=${y}&meal=0`);
  await page.getByLabel('Lebensmittel suchen').fill('haferflocken');
  const first = page.locator('main ul').first().getByRole('link').first();
  await expect(first).toBeVisible();
  const picked = (await first.locator('.line-clamp-2').textContent())!.trim();
  await first.click();
  await page.getByRole('button', { name: 'Zu Frühstück eintragen' }).click();
  await expect(page.getByText(`${picked} eingetragen`)).toBeVisible();
  await page.goto(`/quick-add?date=${y}&meal=1`);
  await page.getByLabel('Bezeichnung').fill('Kantine');
  await page.getByLabel('Kalorien').fill('650');
  await page.locator('button[type=submit]').click();
  await expect(page.getByText('Kantine', { exact: true })).toBeVisible();

  // Today: breakfast offers the food (last amount) and yesterday's breakfast; lunch only "Wie gestern"
  // (a quick add is no food to suggest).
  await page.goto('/');
  const breakfast = mealCard(page, 'Frühstück');
  await expect(breakfast.getByText('Zuletzt hier')).toBeVisible();
  const chip = breakfast.getByRole('button', { name: new RegExp(`^${picked},.*eintragen$`) });
  await expect(chip).toBeVisible();
  await expect(breakfast.getByRole('button', { name: /^Wie gestern/ })).toBeVisible();
  const lunch = mealCard(page, 'Mittagessen');
  await expect(lunch.getByRole('button', { name: /^Wie gestern, 650 kcal/ })).toBeVisible();
  await expect(lunch.getByRole('button', { name: /Kantine/ })).toHaveCount(0);

  // One tap logs it; the chips make way for the entries; undo brings them back.
  await chip.click();
  await expect(breakfast.getByRole('link', { name: new RegExp(picked) })).toBeVisible();
  await expect(breakfast.getByText('Zuletzt hier')).toHaveCount(0);
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(breakfast.getByRole('link', { name: new RegExp(picked) })).toHaveCount(0);
  await expect(breakfast.getByText('Zuletzt hier')).toBeVisible();

  // "Wie gestern" copies the whole meal.
  await lunch.getByRole('button', { name: /^Wie gestern/ }).click();
  await expect(lunch.getByRole('link', { name: /Kantine/ })).toBeVisible();
  await expect(page.getByText('Mittagessen von gestern eingetragen')).toBeVisible();
});

test('describe a meal instead of photographing it: text-only analysis, same review', async ({ page }) => {
  await register(page);
  await page.route('**/api/ai/status', (r) =>
    r.fulfill({ json: { enabled: true, model: 'claude-opus-5-5' } }),
  );
  let images = -1;
  let text = '';
  await page.route('**/api/ai/analyze', async (r) => {
    const body = r.request().postDataBuffer()!.toString('utf8');
    images = (body.match(/name="image"/g) ?? []).length;
    text = /name="text"\r\n\r\n([^\r]*)/.exec(body)?.[1] ?? '';
    await r.fulfill({
      json: {
        analysisId: '11111111-2222-4333-8444-555555555555',
        dishName: 'Döner',
        items: [
          {
            name: 'Döner',
            grams: 350,
            confidence: 'medium',
            preparation: null,
            packaged: false,
            searchTerms: ['Döner'],
            candidates: [
              {
                food: {
                  id: 'bls:X999999',
                  source: 'bls',
                  sourceId: 'X999999',
                  name: 'Döner Kebab',
                  nameEn: null,
                  brand: null,
                  group: null,
                  unit: 'g',
                  nutrients: { ENERCC: 215, PROT625: 12, FAT: 9, CHO: 20 },
                  portions: [],
                },
                score: 100,
              },
            ],
          },
        ],
        notes: null,
        model: 'claude-opus-5-5',
        usage: { inputTokens: 1000, outputTokens: 200, costUsd: 0.01 },
      },
    });
  });
  await page.goto('/photo?meal=1');
  await page.getByRole('button', { name: 'Beschreiben statt fotografieren' }).click();
  await page.getByLabel('Was hast du gegessen?').fill('Döner mit allem');
  await page.getByRole('button', { name: 'Analysieren', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Ergebnis prüfen' })).toBeVisible();
  expect(images).toBe(0);
  expect(text).toContain('Döner mit allem');
  // The description is the review's hint; no photo, but "+" to add one.
  await expect(page.getByLabel('Beschreibung der Mahlzeit')).toHaveValue('Döner mit allem');
  await expect(page.getByRole('button', { name: 'Fotos hinzufügen' })).toBeVisible();
  await expect(page.getByText('Döner Kebab · 215 kcal/100 g')).toBeVisible();
  // No fat among the ingredients: oil and butter are one tap away.
  await expect(page.getByText('Kein Bratfett dabei?')).toBeVisible();
  await page.getByRole('button', { name: 'Meal eintragen' }).click();
  await expect(page.getByText('„Döner“ eingetragen')).toBeVisible();
  await expect(mealCard(page, 'Mittagessen').getByRole('link', { name: 'Döner' })).toBeVisible();
});
