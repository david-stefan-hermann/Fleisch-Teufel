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
  await page.goto(`/photo?form=1&date=${y}&meal=1`);
  // The form names the day it logs for when that is not today.
  await expect(page.getByText(/^Gestern, /)).toBeVisible();
  await page.getByLabel('Was hast du gegessen?').fill('Kantine');
  await page.getByLabel('Kalorien').fill('650');
  await page.getByRole('button', { name: 'Eintragen', exact: true }).click();
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

test('"Eingeben" with a text: analysed without a photo, typed values go along as a clue, same review', async ({
  page,
}) => {
  await register(page);
  await page.route('**/api/ai/status', (r) =>
    r.fulfill({ json: { enabled: true, model: 'claude-opus-5-5' } }),
  );
  let images = -1;
  let text = '';
  let typed = '';
  await page.route('**/api/ai/analyze', async (r) => {
    const body = r.request().postDataBuffer()!.toString('utf8');
    images = (body.match(/name="image"/g) ?? []).length;
    text = /name="text"\r\n\r\n([^\r]*)/.exec(body)?.[1] ?? '';
    typed = /name="typed"\r\n\r\n([^\r]*)/.exec(body)?.[1] ?? '';
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
  await page.getByRole('button', { name: 'Eingeben' }).click();
  await expect(page).toHaveURL(/form=true/);
  const log = page.getByRole('button', { name: 'Eintragen', exact: true });
  const analyze = page.getByRole('button', { name: 'Analysieren', exact: true });
  // Nothing typed: nothing to do yet.
  await expect(log).toBeDisabled();
  await expect(analyze).toHaveCount(0);
  // Only a text: it can only be analysed.
  await page.getByLabel('Was hast du gegessen?').fill('Döner mit allem');
  await expect(analyze).toBeEnabled();
  await expect(log).toHaveCount(0);
  // Text and values: both, "Eintragen" (right) is the main button.
  await page.getByLabel('Kalorien').fill('700');
  await page.getByLabel('Protein').fill('35');
  await expect(log).toBeEnabled();
  const [a, l] = [(await analyze.boundingBox())!, (await log.boundingBox())!];
  expect(a.x).toBeLessThan(l.x);
  expect(Math.abs(a.y - l.y)).toBeLessThan(2);
  expect(Math.abs(a.width - l.width)).toBeLessThan(2);
  await analyze.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Ergebnis prüfen' })).toBeVisible();
  expect(images).toBe(0);
  expect(text).toContain('Döner mit allem');
  // The typed values are a clue for the AI; the review shows what it found.
  expect(JSON.parse(typed)).toEqual({ kcal: 700, proteinG: 35 });
  // The review took the place of the form: closing it shows the camera, not the filled form.
  await expect(page).not.toHaveURL(/form=/);
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

test('"Eingeben" with values: a quick entry titled with the beginning of the text, edited with the full text', async ({
  page,
}) => {
  await register(page);
  await page.goto('/');
  await page.getByRole('link', { name: 'Essen zu Mittagessen eintragen' }).click();
  await expect(page).toHaveURL(/\/photo\?.*meal=1/);
  // No header icons any more; two buttons of the same width under the camera.
  for (const name of ['Schnelleingabe', 'Lebensmittel suchen'])
    await expect(page.getByRole('link', { name })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Beschreiben statt fotografieren' })).toHaveCount(0);
  const type = page.getByRole('button', { name: 'Eingeben' });
  const find = page.getByRole('link', { name: 'Suchen' });
  const [t, f] = [(await type.boundingBox())!, (await find.boundingBox())!];
  expect(t.x).toBeLessThan(f.x);
  expect(Math.abs(t.y - f.y)).toBeLessThan(2);
  expect(Math.abs(t.width - f.width)).toBeLessThan(2);
  await type.click();

  const text =
    'Beim Italiener gegessen. Pizza Salami, dazu ein kleiner gemischter Salat. Danach noch ein Espresso.';
  await page.getByLabel('Was hast du gegessen?').fill(text);
  await page.getByLabel('Kalorien').fill('950');
  // The meal of the "+" stands at the right end of the header, not in the form; a tap changes it.
  await expect(page.getByLabel('Mahlzeit', { exact: true })).toHaveCount(0);
  const picker = page.getByRole('button', { name: /^Mahlzeit: / });
  await expect(picker).toHaveText('Mittagessen');
  const [h, m] = [
    (await page.getByRole('heading', { level: 1 }).boundingBox())!,
    (await picker.boundingBox())!,
  ];
  expect(m.x).toBeGreaterThan(h.x + h.width - 1);
  expect(m.x + m.width).toBeGreaterThan(page.viewportSize()!.width - 20);
  await picker.click();
  await expect(page.getByRole('menuitemradio', { name: 'Mittagessen' })).toBeChecked();
  await page.getByRole('menuitemradio', { name: 'Abendessen' }).click();
  await expect(picker).toHaveText('Abendessen');
  await expect(page).toHaveURL(/meal=2/);
  // The camera before the form, the search and the scanner follow; what was typed stays.
  await page.goBack();
  await expect(picker).toHaveText('Abendessen');
  await expect(page).toHaveURL(/\/photo\?(?!.*form=).*meal=2/);
  await expect(page.getByRole('link', { name: 'Suchen' })).toHaveAttribute('href', /meal=2/);
  await page.goForward();
  await expect(page.getByLabel('Kalorien')).toHaveValue('950');
  // The AI is off on this server: the values are logged, nothing is analysed.
  await expect(page.getByRole('button', { name: 'Analysieren', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Eintragen', exact: true }).click();
  await expect(page.getByText('950 kcal eingetragen')).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  const title = 'Beim Italiener gegessen. Pizza Salami, dazu ein kleiner…';
  const row = mealCard(page, 'Abendessen').getByRole('link', { name: new RegExp(`^${title}`) });
  await expect(
    mealCard(page, 'Mittagessen').getByRole('link', { name: new RegExp(`^${title}`) }),
  ).toHaveCount(0);
  await expect(row).toContainText('Schnell eingetragen');
  await expect(row).toContainText('950');
  // Camera and form are gone from the history.
  await page.goBack();
  await expect(page).not.toHaveURL(/\/photo/);
  await page.goForward();

  // A tap opens the same fields with the full text; an entry is only changed, not analysed.
  await row.click();
  await expect(page).toHaveURL(/\/quick-add\?/);
  await expect(page.getByRole('heading', { level: 1, name: 'Schnelleintrag bearbeiten' })).toBeVisible();
  await expect(page.getByLabel('Was hast du gegessen?')).toHaveValue(text);
  // No meal field here either: the entry stays in its meal.
  await expect(page.getByLabel('Mahlzeit', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Analysieren', exact: true })).toHaveCount(0);
  await page.getByLabel('Kalorien').fill('900');
  await page.getByRole('button', { name: 'Änderungen übernehmen' }).click();
  await expect(page.getByText('Änderungen übernommen')).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await expect(row).toContainText('900');

  // Without a text the entry is called "Schnelleingabe"; an old link to the quick add lands in the form.
  await page.goto('/quick-add?meal=0');
  await expect(page).toHaveURL(/\/photo\?.*form=true/);
  await page.getByLabel('Kalorien').fill('120');
  await page.getByRole('button', { name: 'Eintragen', exact: true }).click();
  await expect(mealCard(page, 'Frühstück').getByText('Schnelleingabe', { exact: true })).toBeVisible();
});
