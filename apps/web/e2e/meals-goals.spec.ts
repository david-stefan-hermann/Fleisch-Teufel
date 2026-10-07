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

test('nutrients are details of the overview, opened by tapping it', async ({ page }) => {
  await register(page);
  await page.goto('/');
  const overview = page.getByRole('region', { name: 'Kalorien heute' });
  await expect(overview.getByText('Ballaststoffe')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Nährstoffe' })).toHaveCount(0);
  await overview.getByText('kcal übrig').click();
  await expect(overview.getByText('Ballaststoffe')).toBeVisible();
  const toggle = overview.getByRole('button', { name: 'Weniger' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(overview.getByText('Ballaststoffe')).toHaveCount(0);
});

test('edit a saved meal: add an ingredient via search, change an amount, add a photo', async ({ page }) => {
  await register(page);
  await quickAdd(page, 0, 'Joghurt', '150');
  await page.getByRole('button', { name: 'Aktionen für Frühstück' }).click();
  await page.getByRole('menuitem', { name: 'Als Meal speichern' }).click();
  await page.getByLabel('Name').fill('Mein Frühstück');
  await page.getByRole('button', { name: 'Meal speichern' }).click();
  // Wait for the write to finish before the full reload below (the click resolves earlier).
  await expect(page.getByText('„Mein Frühstück“ gespeichert')).toBeVisible();

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
  await page.getByRole('button', { name: 'Als Meal speichern & eintragen' }).click();

  await expect(page.getByRole('button', { name: /Nudeln mit Soße/ })).toBeVisible();
  await page.goto('/meals');
  await page.getByRole('link', { name: /Nudeln mit Soße/ }).click();
  await expect(page.getByRole('img', { name: 'Foto von Nudeln mit Soße' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Hafer Flocken/ })).toBeVisible();
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
