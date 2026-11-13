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

test('without the assistant on the server there is no button', async ({ page }) => {
  await register(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 2, name: 'Frühstück' })).toBeVisible();
  await expect(page.locator('.ai-btn')).toHaveCount(0);
});

test('the assistant logs a typed sentence; the toast undoes it', async ({ page }) => {
  // The E2E server runs without AI: the server info and the turn are answered here.
  await page.route('**/api/info', async (r) => {
    const res = await r.fetch();
    await r.fulfill({
      response: res,
      json: { ...(await res.json()), assistantEnabled: true, voiceEnabled: false },
    });
  });
  let sent: { text: string; context: Record<string, unknown> } | null = null;
  await page.route('**/api/assistant/turn', async (r) => {
    const body = r.request().postDataBuffer()!.toString('utf8');
    const field = (name: string) => new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`).exec(body)?.[1] ?? '';
    sent = { text: field('text'), context: JSON.parse(field('context')) };
    const date = sent.context.now ? String(sent.context.now).slice(0, 10) : '';
    await r.fulfill({
      json: {
        turnId: field('requestId'),
        transcript: sent.text,
        ops: [
          {
            kind: 'logFood',
            date,
            meal: 1,
            items: [
              {
                food: {
                  id: 'bls:M111111',
                  source: 'bls',
                  sourceId: 'M111111',
                  name: 'Magerquark',
                  nameEn: null,
                  brand: null,
                  group: null,
                  unit: 'g',
                  nutrients: { ENERCC: 67, PROT625: 12 },
                  portions: [],
                },
                grams: 200,
                portion: null,
                guessed: false,
              },
            ],
            groupName: null,
          },
        ],
        question: null,
        reply: 'Magerquark eingetragen.',
        usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
      },
    });
  });
  await page.route('**/api/assistant/turns/*', (r) => r.fulfill({ json: { ok: true } }));

  await register(page);
  await page.goto('/');
  // Without voice on the server a tap opens the keyboard.
  await page.getByRole('button', { name: 'Assistent: sprechen' }).click();
  const field = page.getByLabel('Was möchtest du eintragen?');
  await field.fill('200 Gramm Magerquark zum Mittagessen');
  await field.press('Enter');

  const lunch = mealCard(page, 'Mittagessen');
  await expect(lunch.getByText('Magerquark')).toBeVisible();
  expect(sent!.text).toBe('200 Gramm Magerquark zum Mittagessen');
  expect(sent!.context).toMatchObject({ mealNames: ['Frühstück', 'Mittagessen', 'Abendessen', 'Snacks'] });
  await expect(page.getByText('Mittagessen: Magerquark · 134 kcal')).toBeVisible();
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(lunch.getByText('Magerquark')).toHaveCount(0);

  // The history keeps it, marked as undone.
  await page.goto('/settings/assistant');
  await expect(page.getByText('„200 Gramm Magerquark zum Mittagessen“')).toBeVisible();
  await expect(page.getByText('rückgängig gemacht')).toBeVisible();
});
