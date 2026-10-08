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

async function swipeLeft(page: Page, text: string) {
  const row = page.getByText(text, { exact: true }).first();
  // Centre the row: toasts sit at the bottom and would catch the pointer.
  await row.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const box = (await row.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 200, y);
  await page.mouse.down();
  for (const dx of [10, 40, 80, 120, 160]) await page.mouse.move(box.x + 200 - dx, y);
  await page.mouse.up();
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

/** No element may stick out of its card (the "Abmelden" button did). */
async function expectNoOverflow(page: Page) {
  const offenders = await page.evaluate(() => {
    const out: string[] = [];
    for (const section of document.querySelectorAll('main section')) {
      const r = section.getBoundingClientRect();
      for (const el of section.querySelectorAll('button, a, input, p, span')) {
        const b = el.getBoundingClientRect();
        if (b.width > 0 && b.right > r.right + 0.5)
          out.push((el.textContent ?? el.tagName).trim().slice(0, 40));
      }
    }
    return out;
  });
  expect(offenders).toEqual([]);
}

test('account page fits, toasts sit at the bottom, swipe action fills the card corner', async ({ page }) => {
  await register(page);
  await page.goto('/settings/account');
  await expect(page.getByRole('button', { name: 'Abmelden', exact: true })).toBeVisible();
  await expectNoOverflow(page);

  await quickAdd(page, 2, 'Leberkäse', '686');
  await swipeLeft(page, 'Leberkäse');
  const del = page.getByRole('button', { name: 'Leberkäse löschen' });
  const card = page.locator('section', { has: del });
  const [btn, sec] = [(await del.boundingBox())!, (await card.boundingBox())!];
  // Last row: the red button reaches the bottom edge of the card (border 1px), no gap.
  expect(Math.abs(btn.y + btn.height - (sec.y + sec.height - 1))).toBeLessThanOrEqual(1.5);
  await del.click();
  const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'Leberkäse gelöscht' });
  await expect(toast).toBeVisible();
  const t = (await toast.boundingBox())!;
  expect(t.y).toBeGreaterThan(page.viewportSize()!.height / 2);
});

test('day overview: "Nährstoffe" swaps the target bars for the nutrient overview', async ({ page }) => {
  await register(page);
  await quickAdd(page, 0, 'Müsli', '350');
  await page.goto('/');
  const overview = page.getByRole('region', { name: 'Kalorien heute' });
  const targetBars = overview.getByRole('meter', { name: 'Protein' });
  await expect(targetBars).toHaveCount(1);
  await expect(overview.getByText('Ballaststoffe')).toHaveCount(0);

  const toggle = overview.getByRole('button', { name: 'Nährstoffe' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  // The overview replaces the three target bars: one protein meter (in the overview), no kcal switch.
  await expect(overview.getByRole('img', { name: /^Energieverteilung/ })).toBeVisible();
  await expect(overview.getByText(/350\s\/\s2\.000/)).toBeVisible();
  await expect(overview.getByRole('button', { name: /Anteil am Tagesziel/ })).toHaveCount(0);
  await expect(overview.getByRole('meter', { name: 'Protein' })).toHaveCount(1);
  // "Weitere Nährstoffe" is open in the day overview, with the daily targets.
  await expect(overview.getByText('Ballaststoffe')).toBeVisible();
  await expect(overview.getByText(/von mind\.\s30\sg/)).toBeVisible();
  await overview.getByRole('button', { name: 'Woher kommen die Zielwerte?' }).click();
  await expect(overview.getByText('DGE-Referenzwert: mind. 30 g/Tag')).toBeVisible();

  const less = overview.getByRole('button', { name: 'Weniger' });
  await expect(less).toHaveAttribute('aria-expanded', 'true');
  await less.click();
  await expect(overview.getByText('Ballaststoffe')).toHaveCount(0);
  await expect(overview.getByRole('img', { name: /^Energieverteilung/ })).toHaveCount(0);
  await expect(targetBars).toBeVisible();

  // The meal header opens the meal's own page: overview with "Summe" and its entries.
  await page.getByRole('link', { name: /^Frühstück/ }).click();
  await expect(page).toHaveURL(/\/diary-meal\?.*meal=0/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Frühstück');
  await expect(page.getByText('Summe')).toBeVisible();
  const kcal = page.getByRole('button', { name: /Anteil am Tagesziel/ });
  await kcal.click();
  await expect(kcal).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Anteil am Tagesziel', { exact: true })).toBeVisible();
  const entries = page.locator('section', { has: page.getByRole('heading', { name: 'Einträge' }) });
  await expect(entries.getByText('Müsli', { exact: true })).toBeVisible();
  // Rows behave as in the diary: a tap edits the entry.
  await entries.getByText('Müsli', { exact: true }).click();
  await expect(page).toHaveURL(/quick-add/);
});

test('edit a saved meal: add an ingredient via search, change an amount, add a photo', async ({ page }) => {
  await register(page);
  await quickAdd(page, 0, 'Joghurt', '150');
  await saveDiaryMeal(page, 'Frühstück', 'Mein Frühstück');

  await page.goto('/meals');
  await page.getByRole('link', { name: /Mein Frühstück/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Mein Frühstück' })).toBeVisible();
  const mealUrl = page.url();

  await page.getByRole('button', { name: 'Zutat hinzufügen' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Zutat hinzufügen' })).toBeVisible();
  // Saved meals cannot go into a saved meal: "Eigene" has no meals section here.
  await page.getByRole('tab', { name: 'Eigene' }).click();
  await expect(page.getByRole('heading', { name: 'Eigene Lebensmittel' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Meals/ })).toHaveCount(0);
  // "Eigene" only searches own foods; the catalog search runs from the other tabs.
  await page.getByRole('tab', { name: 'Häufig' }).click();
  await page.getByLabel('Lebensmittel suchen').fill('haferflocken');
  await page.getByRole('link', { name: /^Hafer Flocken BLS/ }).click();
  await page.getByLabel('Portion', { exact: true }).click();
  await page.getByRole('option', { name: '1 g' }).click();
  await page.getByLabel('Anzahl Portionen').fill('50');
  await expect(page.getByLabel('Mahlzeit')).toHaveCount(0);
  await page.getByRole('button', { name: 'Zum Meal hinzufügen' }).click();

  // Back on the meal (search and food page left the history).
  await expect(page).toHaveURL(mealUrl);
  await expect(page.getByRole('button', { name: /Hafer Flocken/ })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/meals$/);
  await page.goForward();

  await page.getByRole('button', { name: /Hafer Flocken/ }).click();
  await page.getByLabel('Menge').fill('100');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('button', { name: /Hafer Flocken.*348/ })).toBeVisible();

  await page.locator('input[type=file]').nth(1).setInputFiles('public/pwa-192x192.png');
  await expect(page.getByRole('img', { name: 'Foto von Mein Frühstück' })).toBeVisible();
  // The photo reaches the server with the next sync.
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const r = await fetch('/api/sync/pull?since=0');
          const meal = (await r.json()).changes.find((c: { table: string }) => c.table === 'meals')?.data;
          return meal?.photoId ? (await fetch(`/api/photos/${meal.photoId}`)).status : 0;
        }),
      { timeout: 15_000 },
    )
    .toBe(200);
});

test('AI result shows the photo, takes extra ingredients and becomes a meal with photo', async ({ page }) => {
  await register(page);
  await page.route('**/api/ai/status', (r) =>
    r.fulfill({ json: { enabled: true, model: 'claude-opus-5-5' } }),
  );
  const food = (id: string, name: string, kcal: number) => ({
    food: {
      id,
      source: 'bls',
      sourceId: id,
      name,
      nameEn: null,
      brand: null,
      group: null,
      unit: 'g',
      nutrients: { ENERCC: kcal, PROT625: 5 },
      portions: [],
    },
    score: 1,
  });
  await page.route('**/api/ai/analyze', (r) =>
    r.fulfill({
      json: {
        analysisId: '00000000-0000-7000-8000-000000000001',
        dishName: 'Nudeln mit Soße',
        items: [
          {
            name: 'Nudeln',
            grams: 200,
            confidence: 'high',
            preparation: null,
            packaged: false,
            searchTerms: [],
            candidates: [food('bls:A', 'Teigwaren gekocht', 150)],
          },
        ],
        notes: null,
        model: 'claude-opus-5-5',
        usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.03 },
      },
    }),
  );
  await page.goto('/photo?meal=1');
  // A picked gallery photo (no barcode in it) is analyzed right away.
  await page.locator('input[type=file]:not([capture])').setInputFiles('public/pwa-192x192.png');
  await expect(page.getByRole('heading', { name: 'Ergebnis prüfen' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Analysiertes Foto' })).toBeVisible();
  await page.getByRole('spinbutton', { name: 'Gramm' }).or(page.getByLabel('Gramm')).first().fill('180');

  await page.getByRole('button', { name: 'Zutat hinzufügen' }).click();
  await page.getByLabel('Lebensmittel suchen').fill('haferflocken');
  await page.getByRole('link', { name: /^Hafer Flocken BLS/ }).click();
  await page.getByRole('button', { name: 'Zur Analyse hinzufügen' }).click();

  await expect(page.getByRole('heading', { name: 'Ergebnis prüfen' })).toBeVisible();
  await expect(page.getByText('von dir hinzugefügt')).toBeVisible();
  await expect(page.getByLabel('Gramm').first()).toHaveValue('180');

  // "Gesamtmenge" scales every ingredient; a manual change becomes the new 100 %.
  const scale = page.getByRole('slider', { name: 'Gesamtmenge skalieren' });
  const summary = page.locator('section').filter({ hasText: 'Summe' });
  const before = Number((await page.getByLabel('Gramm').nth(1).inputValue()) || '0');
  await scale.focus();
  for (let i = 0; i < 10; i++) await scale.press('ArrowRight');
  await expect(summary.getByText('150 %')).toBeVisible();
  await expect(page.getByLabel('Gramm').first()).toHaveValue('270');
  await expect(page.getByLabel('Gramm').nth(1)).toHaveValue(String(Math.round(before * 1.5)));
  for (let i = 0; i < 4; i++) await scale.press('ArrowLeft');
  await expect(summary.getByText('130 %')).toBeVisible();
  await expect(page.getByLabel('Gramm').first()).toHaveValue('234');
  await page.getByLabel('Gramm').first().fill('200');
  await expect(summary.getByText('100 %')).toBeVisible();
  await expect(page.getByLabel('Gramm').nth(1)).toHaveValue(String(Math.round(before * 1.3)));

  // Saving (header icon, name dialog) stores the meal with the photo but logs nothing yet.
  await expect(page.getByLabel('Name des Meals')).toHaveCount(0);
  await expect(page.getByText(/als Gruppe „Nudeln mit Soße“ eingetragen/)).toBeVisible();
  await page.getByRole('button', { name: 'Als Meal speichern' }).click();
  const dialog = page.getByRole('dialog', { name: 'Als Meal speichern' });
  await expect(dialog).toContainText('Eingetragen wird erst mit „Meal eintragen“');
  await expect(dialog.getByLabel('Name')).toHaveValue('Nudeln mit Soße');
  await dialog.getByRole('button', { name: 'Meal speichern' }).click();
  await expect(page.getByText('„Nudeln mit Soße“ gespeichert')).toBeVisible();
  const chip = page.getByRole('button', { name: /Als Meal „Nudeln mit Soße“ gespeichert/ });
  await expect(chip).toContainText('Gespeichert');
  await expect(page.getByText(/Als Meal „Nudeln mit Soße“ gespeichert \(mit Foto\)/)).toBeVisible();
  // The chip reopens the dialog to rename the meal.
  await chip.click();
  await dialog.getByLabel('Name').fill('Nudeln Bolo');
  await dialog.getByRole('button', { name: 'Meal speichern' }).click();
  await expect(page.getByText('„Nudeln Bolo“ gespeichert')).toBeVisible();
  await page.getByRole('button', { name: 'Meal eintragen' }).click();

  await expect(page.getByText('„Nudeln Bolo“ eingetragen')).toBeVisible();
  await expect(page.getByRole('button', { name: /Nudeln Bolo/ })).toBeVisible();
  await page.goto('/meals');
  await page.getByRole('link', { name: /Nudeln Bolo/ }).click();
  await expect(page.getByRole('img', { name: 'Foto von Nudeln Bolo' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Hafer Flocken/ })).toBeVisible();
});

test('AI result logged without saving becomes a named group without a saved meal', async ({ page }) => {
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
  await page.route('**/api/ai/analyze', (r) =>
    r.fulfill({
      json: {
        analysisId: '00000000-0000-7000-8000-000000000002',
        dishName: 'Reis mit Hähnchen',
        items: [item('Reis gekocht', 'bls:R', 130, 200), item('Hähnchenbrust', 'bls:H', 110, 150)],
        notes: null,
        model: 'claude-opus-5-5',
        usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.03 },
      },
    }),
  );
  await page.goto('/photo?meal=1');
  await page.locator('input[type=file]:not([capture])').setInputFiles('public/pwa-192x192.png');
  await expect(page.getByRole('heading', { name: 'Ergebnis prüfen' })).toBeVisible();
  // Regression (WebKit, broken thumbnails): many review writes, a reload, the photo still shows.
  const grams = page.getByLabel('Gramm').first();
  for (const g of ['210', '220', '230', '240', '200']) await grams.fill(g);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Ergebnis prüfen' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Analysiertes Foto' })).toHaveJSProperty('complete', true);
  await expect
    .poll(() =>
      page.getByRole('img', { name: 'Analysiertes Foto' }).evaluate((i: HTMLImageElement) => i.naturalWidth),
    )
    .toBe(192);
  await expect(page.getByLabel('Gramm').first()).toHaveValue('200');
  await page.getByRole('button', { name: 'Zurück zur Liste' }).click();
  const thumb = page.locator('section', { hasText: 'Analysen' }).locator('img');
  await expect.poll(() => thumb.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(192);
  await page.getByRole('button', { name: /Lebensmittel erkannt/ }).click();
  await expect(page.getByRole('button', { name: 'Als Meal speichern' })).toBeVisible();
  await page.getByRole('button', { name: 'Meal eintragen' }).click();

  // Without saving, the group takes the dish name of the analysis.
  await expect(page.getByText('„Reis mit Hähnchen“ eingetragen')).toBeVisible();
  const group = page.getByRole('button', { name: /Reis mit Hähnchen/ });
  await expect(group).toBeVisible();
  await expect(group).toContainText(/2\sZutaten/);
  await expect(group.getByLabel('aus Foto')).toBeVisible();
  await group.click();
  await expect(page.getByRole('list', { name: 'Zutaten von Reis mit Hähnchen' })).toContainText(
    'Reis gekocht',
  );

  // No saved meal, and the name reaches the server with the entries.
  await page.goto('/meals');
  await expect(page.getByText('Noch keine Meals')).toBeVisible();
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const r = await fetch('/api/sync/pull?since=0');
          const entries = (await r.json()).changes.filter(
            (c: { table: string }) => c.table === 'foodEntries',
          );
          return entries.map((c: { data: { groupName: string | null } }) => c.data.groupName);
        }),
      { timeout: 15_000 },
    )
    .toEqual(['Reis mit Hähnchen', 'Reis mit Hähnchen']);
});

test('macro templates: protein follows body weight', async ({ page }) => {
  await register(page);
  await page.getByRole('radio', { name: 'Männlich' }).click();
  await page.getByLabel('Geburtsdatum').fill('1990-01-01');
  await page.getByLabel('Größe').fill('180');
  await page.getByLabel('Aktuelles Gewicht').fill('80');
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('radio', { name: /Diät \/ Muskelerhalt/ }).click();
  await expect(page.getByLabel('Protein')).toHaveValue('160');
  await page.getByRole('radio', { name: /Eigene/ }).click();
  await page.getByRole('slider', { name: 'Eiweiß' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByLabel('Protein')).toHaveValue('152'); // 1.9 g/kg × 80 kg
  // Far above the 35 % energy cap: the cap applies and is explained.
  await page.keyboard.press('End');
  await expect(page.getByText(/auf 35 % der Kalorien begrenzt/)).toBeVisible();
  await page.keyboard.press('Home');
  await page.getByRole('button', { name: 'Ziele speichern' }).click();
  await expect(page.getByText('Ziele gespeichert')).toBeVisible();

  await page.goto('/goals');
  await expect(page.getByRole('radio', { name: /Eigene/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('slider', { name: 'Eiweiß' })).toHaveAttribute('aria-valuenow', '0.8');
  await page.getByRole('radio', { name: /Low Carb/ }).click();
  await page.getByRole('button', { name: 'Makros übernehmen' }).click();
  const kcal = Number(await page.getByLabel('Kalorien', { exact: true }).inputValue());
  await expect(page.getByLabel('Kohlenh.')).toHaveValue(String(Math.round((kcal * 0.2) / 4)));
});
