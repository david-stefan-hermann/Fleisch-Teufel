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

/** Names of the local search results, in order. */
async function resultNames(page: Page): Promise<string[]> {
  const links = page.locator('main ul').first().locator('a[href*="/food/"] .font-medium');
  await expect(links.first()).toBeVisible();
  return links.allTextContents();
}

test('food search: tabs, used foods first, own foods with collapsible meals, header icons', async ({
  page,
}) => {
  await register(page);
  await page.goto('/add?meal=0');

  // Tabs "Häufig" (default), "Kürzlich", "Eigene".
  await expect(page.getByRole('tab')).toHaveText(['Häufig', 'Kürzlich', 'Eigene']);
  await expect(page.getByRole('tab', { name: 'Häufig' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Was du mindestens zweimal einträgst')).toBeVisible();

  // Header: only the food page (camera, 24 px icon); quick add and barcode live on the food page.
  await expect(page.getByRole('link', { name: 'Barcode scannen' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Schnelleingabe' })).toHaveCount(0);
  const icon = (await page.getByRole('link', { name: 'Foto oder Barcode' }).locator('svg').boundingBox())!;
  expect(icon.width).toBe(24);

  // Typing in "Häufig" or "Kürzlich" shows search results; no tab is active meanwhile.
  await page.getByLabel('Lebensmittel suchen').fill('brötchen');
  const plain = await resultNames(page);
  expect(plain.length).toBeGreaterThan(3);
  await expect(page.getByRole('tab', { selected: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /Markenprodukte/ })).toBeVisible();

  // Log the fourth hit; searching again puts it first.
  const picked = plain[3]!;
  await page.locator('main ul').first().getByRole('link').nth(3).click();
  await page.getByRole('button', { name: 'Zu Frühstück eintragen' }).click();
  await expect(page.getByText(`${picked} eingetragen`)).toBeVisible();
  await page.goto('/add?meal=0');
  await page.getByLabel('Lebensmittel suchen').fill('brötchen');
  await expect.poll(async () => (await resultNames(page))[0]).toBe(picked);

  // Tapping a tab leaves the search and shows the tab.
  await page.getByRole('tab', { name: 'Kürzlich' }).click();
  await expect(page.getByLabel('Lebensmittel suchen')).toHaveValue('');
  await expect(page.getByRole('tab', { name: 'Kürzlich' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('link', { name: new RegExp(picked) })).toBeVisible();

  // "Eigene": saved meals as a collapsible section (open by default, remembered), then own foods.
  await page.getByRole('tab', { name: 'Eigene' }).click();
  const meals = page.getByRole('button', { name: 'Meals (0)' });
  await expect(meals).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('Noch keine gespeicherten Meals')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Eigene Lebensmittel' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Eigenes Lebensmittel anlegen' })).toBeVisible();
  await meals.click();
  await expect(meals).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText('Noch keine gespeicherten Meals')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Meals (0)' })).toHaveAttribute('aria-expanded', 'false');
  // An unknown tab in the URL falls back to "Häufig".
  await page.goto('/add?meal=0&tab=all');
  await expect(page.getByRole('tab', { name: 'Häufig' })).toHaveAttribute('aria-selected', 'true');

  // Typing in "Eigene" filters own foods and meals only: the tab stays active, no catalog, no online search.
  await saveDiaryMeal(page, 'Frühstück', 'Sonntagsfrühstück');
  await page.goto('/add?meal=0&tab=mine');
  const search = page.getByLabel('Lebensmittel suchen');
  await expect(search).toHaveAttribute('placeholder', 'Eigene Lebensmittel und Meals suchen…');
  await search.fill('sonntagsfruhstuck');
  await expect(page.getByRole('tab', { name: 'Eigene' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('link', { name: /Sonntagsfrühstück/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Markenprodukte/ })).toHaveCount(0);
  // Ingredients count as well: the meal contains the logged roll.
  await search.fill(picked.split(' ')[0]!);
  await expect(page.getByRole('link', { name: /Sonntagsfrühstück/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /BLS/ })).toHaveCount(0);
  await search.fill('pizza');
  await expect(page.getByText('Nichts Eigenes gefunden')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Eigenes Lebensmittel anlegen' })).toHaveAttribute(
    'href',
    /custom-food\/new\?.*name=pizza/,
  );
  await expect(page.getByRole('heading', { name: /Markenprodukte/ })).toHaveCount(0);
});

test('own food: the pencil edits it, saving returns to the food page, deleting returns to the search', async ({
  page,
}) => {
  await register(page);
  await page.goto('/add?meal=0&tab=mine');
  await page.getByRole('link', { name: 'Eigenes Lebensmittel anlegen' }).click();
  await page.getByLabel('Name').fill('Omas Apfelkuchen');
  await page.getByLabel('Kalorien', { exact: true }).fill('285');
  await page.getByRole('button', { name: 'Anlegen und eintragen' }).click();
  await expect(page).toHaveURL(/\/food\//);
  const foodUrl = page.url();
  await expect(page.getByRole('heading', { level: 2, name: 'Omas Apfelkuchen' })).toBeVisible();
  // No text link any more, the pencil sits in the header.
  await expect(page.getByRole('link', { name: 'Bearbeiten', exact: true })).toHaveCount(0);

  // An unsaved amount survives the way to the editor and back.
  await page.getByLabel('Anzahl Portionen').fill('2');
  await page.getByRole('link', { name: 'Lebensmittel bearbeiten' }).click();
  await expect(page).toHaveURL(/\/custom-food\/[^?]+\?from=food$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Lebensmittel bearbeiten' })).toBeVisible();
  await page.getByLabel('Kalorien', { exact: true }).fill('300');
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByText('Gespeichert', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(foodUrl);
  await expect(page.getByLabel('Anzahl Portionen')).toHaveValue('2');
  await expect(page.getByRole('button', { name: /^600 kcal, Anteil/ })).toBeVisible();

  // A fresh visit of the same food starts with the defaults again.
  await page.goto('/add?meal=0&tab=mine');
  await page.getByRole('link', { name: /Omas Apfelkuchen/ }).click();
  await expect(page.getByLabel('Anzahl Portionen')).toHaveValue('1');

  // Deleting in the editor does not land on the dead food page but on the search before it.
  await page.getByRole('link', { name: 'Lebensmittel bearbeiten' }).click();
  await page.getByRole('button', { name: 'Lebensmittel löschen' }).click();
  await expect(page).toHaveURL(/\/add\?/);
  await expect(page.getByText('Omas Apfelkuchen gelöscht')).toBeVisible();
});

test('own food: kcal from the macros, ten values saved, sticky save, barcode hint', async ({ page }) => {
  await register(page);
  await page.goto('/custom-foods');
  await page.goto('/custom-food/new');
  const save = page.getByRole('button', { name: 'Anlegen', exact: true });
  // The save button stays at the bottom of the screen while the form is longer than the screen.
  const viewport = page.viewportSize()!;
  const box = (await save.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  await save.click();
  await expect(page.getByText('Kalorien oder Makros angeben.')).toBeVisible();

  await page.getByLabel('Name').fill('Omas Apfelkuchen');
  await page.getByLabel('Barcode (optional)').fill('4006040123453');
  const kcal = page.getByLabel('Kalorien', { exact: true });
  await page.getByRole('textbox', { name: 'Protein' }).fill('4');
  await page.getByRole('textbox', { name: 'Kohlenhydrate' }).fill('38');
  await page.getByRole('textbox', { name: 'Fett' }).fill('13');
  await expect(kcal).toHaveValue('285');
  await page.getByRole('button', { name: 'Weitere Nährstoffe' }).click();
  await page.getByRole('textbox', { name: 'Ballaststoffe' }).fill('1,8');
  await page.getByRole('textbox', { name: 'Salz' }).fill('0,2');
  // EU formula: 4 × 4 + 38 × 4 + 13 × 9 + 1,8 × 2 = 289.
  await expect(kcal).toHaveValue('289');
  await expect(page.getByText('aus den Makros berechnet')).toBeVisible();
  await page.getByRole('button', { name: 'Alle 10 Nährstoffe' }).click();
  await expect(page.getByLabel('Natrium', { exact: true })).toHaveValue('80');
  await save.click();
  await expect(page.getByText('Lebensmittel angelegt')).toBeVisible();
  await expect(page).toHaveURL(/\/custom-foods$/);

  // On the food page the overview shows the computed kcal and all ten values.
  await page.goto('/add?meal=0&tab=mine');
  await page.getByRole('link', { name: /Omas Apfelkuchen/ }).click();
  await page.getByLabel('Portion', { exact: true }).click();
  await page.getByRole('option', { name: '100 g' }).click();
  await expect(page.getByRole('button', { name: /^289 kcal, Anteil/ })).toBeVisible();

  // Reopened, the kcal are still automatic (no mode is stored); typing makes them an own input.
  await page.getByRole('link', { name: 'Lebensmittel bearbeiten' }).click();
  await expect(page.getByText('aus den Makros berechnet')).toBeVisible();
  await page.getByLabel('Kalorien', { exact: true }).fill('300');
  await expect(page.getByText(/eigene Eingabe/)).toBeVisible();
  await page.getByRole('button', { name: 'aus Makros berechnen' }).click();
  await expect(page.getByLabel('Kalorien', { exact: true })).toHaveValue('289');

  // A second food with the same barcode gets a hint, saving still works.
  await page.goto('/custom-food/new');
  await page.getByLabel('Name').fill('Apfelkuchen (Blech)');
  await page.getByLabel('Barcode (optional)').fill('4006040123453');
  await expect(page.getByText('Schon bei „Omas Apfelkuchen“ hinterlegt.')).toBeVisible();
  await page.getByLabel('Kalorien', { exact: true }).fill('250');
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page.getByText('Lebensmittel angelegt')).toBeVisible();

  // Per portion: converted to 100 g, the portion is kept.
  await page.goto('/custom-food/new');
  await page.getByLabel('Name').fill('Proteinriegel');
  await page.getByRole('radio', { name: 'pro Portion' }).click();
  await expect(page.getByText('Wird beim Speichern auf 100 g umgerechnet.')).toBeVisible();
  await page.getByLabel('Portionsgröße').fill('45');
  await page.getByLabel('Kalorien', { exact: true }).fill('175');
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/custom-foods$/);
  await page.goto('/add?meal=0&tab=mine');
  await page.getByRole('link', { name: /Proteinriegel/ }).click();
  await expect(page.getByLabel('Portion', { exact: true })).toContainText('Portion (45 g)');
  await expect(page.getByRole('button', { name: /^175 kcal, Anteil/ })).toBeVisible();
});

test('own food from a label photo: two photos, one call, form filled and highlighted', async ({ page }) => {
  await register(page);
  await page.route('**/api/ai/status', (r) =>
    r.fulfill({ json: { enabled: true, model: 'claude-opus-5-5' } }),
  );
  let calls = 0;
  let photos = 0;
  await page.route('**/api/ai/label', (r) => {
    calls++;
    photos = (
      r
        .request()
        .postDataBuffer()
        ?.toString('latin1')
        .match(/name="image"/g) ?? []
    ).length;
    if (calls === 1) return r.fulfill({ status: 422, json: { error: 'no_label', notes: null } });
    return r.fulfill({
      json: {
        analysisId: '00000000-0000-7000-8000-00000000000a',
        name: 'Proteinriegel Schoko',
        brand: 'Bergkorn',
        barcode: '4006040123453',
        unit: 'g',
        basis: 'per100',
        servingGrams: 45,
        servingLabel: '1 Riegel',
        nutrients: {
          kcal: 389,
          kj: 1628,
          protein: 33,
          carbs: 36,
          sugar: 4.7,
          fat: 13.8,
          satFat: 7.6,
          fiber: null,
          salt: 0.4,
          sodium: null,
        },
        notes: 'Ballaststoffe nicht angegeben.',
        model: 'claude-opus-5-5',
        usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.03 },
      },
    });
  });

  await page.goto('/custom-food/new');
  await page.getByRole('button', { name: /^Etikett fotografieren/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Etikett fotografieren' });
  await expect(sheet.getByText('Nährwerttabelle, Name und Barcode, bis zu 3 Fotos')).toBeVisible();
  const analyze = sheet.getByRole('button', { name: /^Analysieren/ });
  await expect(analyze).toBeDisabled();
  // No camera in the test browser: the photo library is the way in (several at once).
  await sheet
    .locator('input[type=file][multiple]')
    .setInputFiles(['public/pwa-192x192.png', 'public/pwa-512x512.png']);
  await expect(sheet.getByRole('img', { name: /^Foto \d$/ })).toHaveCount(2);
  await expect(analyze).toHaveText('Analysieren (2 Fotos)');

  // Unreadable: a toast, the camera stays open with the photos.
  await analyze.click();
  await expect(
    page.getByText(
      'Das Etikett konnte nicht gelesen werden. Versuche ein schärferes Foto der Nährwerttabelle.',
    ),
  ).toBeVisible();
  await expect(sheet.getByRole('img', { name: /^Foto \d$/ })).toHaveCount(2);
  // A photo can be removed again.
  await sheet.getByRole('button', { name: 'Foto 2 entfernen' }).click();
  await expect(analyze).toHaveText('Analysieren (1 Foto)');
  await analyze.click();

  // The form is filled; the AI note sits above the nutrients; saving is still up to the person.
  await expect(sheet).toHaveCount(0);
  expect(calls).toBe(2);
  expect(photos).toBe(1);
  await expect(page.getByText('Vom Etikett übernommen, bitte prüfen')).toBeVisible();
  await expect(page.getByLabel('Name')).toHaveValue('Proteinriegel Schoko');
  await expect(page.getByLabel('Name')).toHaveClass(/field-flash/);
  await expect(page.getByLabel('Marke (optional)')).toHaveValue('Bergkorn');
  await expect(page.getByLabel('Barcode (optional)')).toHaveValue('4006040123453');
  await expect(page.getByLabel('Kalorien', { exact: true })).toHaveValue('389');
  await expect(page.getByText(/eigene Eingabe/)).toBeVisible();
  await expect(page.getByText('Ballaststoffe nicht angegeben.')).toBeVisible();
  await expect(page.getByText('1 Riegel · 45 g')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Vom Etikett neu ausfüllen' })).toBeVisible();
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page.getByText('Lebensmittel angelegt')).toBeVisible();

  // Scan page, unknown product: "Etikett fotografieren" opens the editor with the code and the camera.
  await page.route('**/api/foods/barcode/**', (r) =>
    r.fulfill({ status: 404, json: { error: 'not_found' } }),
  );
  await page.goto('/scan?meal=0&code=4006040123460');
  await expect(page.getByText('Produkt 4006040123460 unbekannt')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Selbst anlegen' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Weiter scannen' })).toBeVisible();
  await page.getByRole('button', { name: 'Etikett fotografieren' }).click();
  await expect(page.getByRole('dialog', { name: 'Etikett fotografieren' })).toBeVisible();
  await expect(page).toHaveURL(/\/custom-food\/new\?(?!.*label=)/);
  await page.getByRole('button', { name: 'Schließen' }).click();
  await expect(page.getByLabel('Barcode (optional)')).toHaveValue('4006040123460');
});
