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

test('edit a saved meal: add an ingredient via search, change an amount, add a photo, save', async ({
  page,
}) => {
  await register(page);
  await quickAdd(page, 0, 'Joghurt', '150');
  await saveDiaryMeal(page, 'Frühstück', 'Mein Frühstück');

  await page.goto('/meals');
  await page.getByRole('link', { name: /Mein Frühstück/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Mein Frühstück' })).toBeVisible();
  const mealUrl = page.url();
  const save = page.getByRole('button', { name: 'Speichern', exact: true });
  // Nothing changed yet: nothing to save, and leaving does not ask.
  await expect(save).toBeDisabled();
  await expect(page.getByLabel('Mahlzeit')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /kcal eintragen/ })).toHaveCount(0);

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
  await page.getByLabel('Menge', { exact: true }).fill('50');
  await expect(page.getByLabel('Mahlzeit')).toHaveCount(0);
  await page.getByRole('button', { name: 'Zum Meal hinzufügen' }).click();

  // Back in the editor (search and food page left the history), the ingredient is an unsaved change.
  await expect(page).toHaveURL(mealUrl);
  await expect(page.getByText('Hafer Flocken', { exact: true })).toBeVisible();
  await expect(save).toBeEnabled();
  // It survives a reload (device draft) without reaching the server.
  await page.reload();
  await expect(page.getByText('Hafer Flocken', { exact: true })).toBeVisible();

  // Leaving with changes asks; "Weiter bearbeiten" stays.
  await page.getByRole('button', { name: 'Zurück' }).click();
  const ask = page.getByRole('dialog', { name: 'Änderungen verwerfen?' });
  await expect(ask).toContainText('Du hast Mein Frühstück geändert.');
  await ask.getByRole('button', { name: 'Weiter bearbeiten' }).click();
  await expect(ask).toHaveCount(0);
  await expect(page).toHaveURL(mealUrl);

  // Amount via the number field of the ingredient card (50 g → 100 g = 348 kcal).
  const oats = page.locator('section').filter({ hasText: 'Hafer Flocken' });
  const grams = oats.getByLabel('Menge', { exact: true });
  await expect(grams).toHaveValue('50');
  await grams.fill('100');
  await expect(page.getByText('348 kcal', { exact: true })).toBeVisible();
  // "Nährwerte" in the card shows the overview of the amount and follows the wheel.
  await page.getByRole('button', { name: 'Nährwerte' }).nth(1).click();
  await expect(page.getByRole('button', { name: /^348 kcal, Anteil/ })).toBeVisible();
  // The wheel turns in 5 g steps and the field follows.
  const wheel = page.getByRole('slider', { name: 'Menge Hafer Flocken' });
  await wheel.focus();
  await page.keyboard.press('ArrowDown');
  await expect(grams).toHaveValue('105');
  await expect(page.getByRole('button', { name: /^365 kcal, Anteil/ })).toBeVisible();
  // Turned by scrolling: two rows further is 115 g, saved once it stops.
  await wheel.evaluate((el) => el.scrollBy(0, 88));
  await expect(grams).toHaveValue('115');
  await expect(wheel).toHaveAttribute('aria-valuenow', '115');

  await page.locator('input[type=file]').nth(1).setInputFiles('public/pwa-192x192.png');
  await expect(page.getByRole('img', { name: 'Foto von Mein Frühstück' })).toBeVisible();
  await page.getByLabel('Name').fill('Porridge');
  await expect(page.getByRole('heading', { level: 1, name: 'Porridge' })).toBeVisible();

  // Nothing reached the server so far.
  const serverMeal = () =>
    page.evaluate(async () => {
      const r = await fetch('/api/sync/pull?since=0');
      return (await r.json()).changes.find((c: { table: string }) => c.table === 'meals')?.data as
        { name: string; photoId: string | null; items: { name: string }[] } | undefined;
    });
  expect((await serverMeal())?.name).toBe('Mein Frühstück');

  // Back with changes → "Speichern" in the dialog saves and leaves.
  await page.getByRole('button', { name: 'Zurück' }).click();
  await ask.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('„Porridge“ gespeichert', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/meals$/);
  await expect(page.getByRole('link', { name: /Porridge/ })).toBeVisible();
  // Name, items and photo reach the server with the next sync, the photo included.
  await expect
    .poll(
      async () => {
        const meal = await serverMeal();
        if (!meal?.photoId) return null;
        const status = await page.evaluate(
          async (id) => (await fetch(`/api/photos/${id}`)).status,
          meal.photoId,
        );
        return [meal.name, meal.items.map((i) => i.name).join(', '), status];
      },
      { timeout: 15_000 },
    )
    .toEqual(['Porridge', 'Joghurt, Hafer Flocken', 200]);

  // An edit discarded in the dialog leaves the meal as it was.
  await page.getByRole('link', { name: /Porridge/ }).click();
  await page.getByLabel('Name').fill('Verworfen');
  await page.getByRole('button', { name: 'Zurück' }).click();
  await ask.getByRole('button', { name: 'Verwerfen' }).click();
  await expect(page).toHaveURL(/\/meals$/);
  await expect(page.getByRole('link', { name: /Porridge/ })).toBeVisible();
  await page.getByRole('link', { name: /Porridge/ }).click();
  await expect(page.getByLabel('Name')).toHaveValue('Porridge');
  await expect(save).toBeDisabled();

  // Saving from "Mehr" closes the editor too: back to the list, without asking.
  await page.getByLabel('Name').fill('Porridge Deluxe');
  await save.click();
  await expect(page).toHaveURL(/\/meals$/);
  await expect(ask).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Porridge Deluxe/ })).toBeVisible();
});

test('log a saved meal: leave out an ingredient for this entry, amount slider, pencil to the editor', async ({
  page,
}) => {
  await register(page);
  await quickAdd(page, 0, 'Joghurt', '150');
  await quickAdd(page, 0, 'Beeren', '50');
  await quickAdd(page, 0, 'Honig', '60');
  await saveDiaryMeal(page, 'Frühstück', 'Bowl');

  await page.goto('/add?meal=1&tab=mine');
  await page.getByRole('link', { name: /Bowl/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Bowl' })).toBeVisible();
  // Read-only ingredients, no editing in the head.
  await expect(page.getByRole('button', { name: 'Meal löschen' })).toHaveCount(0);
  await expect(page.getByLabel('Name')).toHaveCount(0);
  const logButton = page.getByRole('button', { name: /kcal eintragen$/ });
  await expect(logButton).toHaveText('260 kcal eintragen');

  // A tap shows the nutrients of one ingredient at a time.
  const joghurt = page.getByRole('button', { name: /^Joghurt/ });
  const honig = page.getByRole('button', { name: /^Honig/ });
  await joghurt.click();
  await expect(joghurt).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: /^150 kcal, Anteil/ })).toBeVisible();
  await honig.click();
  await expect(joghurt).toHaveAttribute('aria-expanded', 'false');
  await expect(honig).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: /^60 kcal, Anteil/ })).toBeVisible();

  // Swipe leaves Honig out of this entry only (its open overview goes with it); undo brings it back,
  // a second swipe removes it again.
  await swipeLeft(page, 'Honig');
  await page.getByRole('button', { name: 'Honig für diesen Eintrag entfernen' }).click();
  await expect(logButton).toHaveText('200 kcal eintragen');
  await expect(page.getByRole('button', { name: /^60 kcal, Anteil/ })).toHaveCount(0);
  await expect(page.getByText('Ohne Honig. Das gespeicherte Meal bleibt unverändert.')).toBeVisible();
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(logButton).toHaveText('260 kcal eintragen');
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  await swipeLeft(page, 'Honig');
  await page.getByRole('button', { name: 'Honig für diesen Eintrag entfernen' }).click();
  await expect(logButton).toHaveText('200 kcal eintragen');

  // Amount 0,5× to 2× in tenths.
  const amount = page.getByRole('slider', { name: 'Menge' });
  await expect(amount).toHaveAttribute('aria-valuenow', '1');
  await amount.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  await expect(page.getByText('1,5×', { exact: true })).toBeVisible();
  await expect(logButton).toHaveText('300 kcal eintragen');
  await page.keyboard.press('End');
  await expect(amount).toHaveAttribute('aria-valuenow', '2');
  await page.keyboard.press('Home');
  await expect(amount).toHaveAttribute('aria-valuenow', '0.5');
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  await expect(logButton).toHaveText('200 kcal eintragen');

  await logButton.click();
  await expect(page.getByText(/^Bowl: 2\sZutaten eingetragen$/)).toBeVisible();
  const group = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { level: 2, name: 'Mittagessen' }) })
    .getByRole('button', { name: /Bowl/ });
  await expect(group).toContainText(/2\sZutaten/);
  // The saved meal still has all three.
  await page.goto('/meals');
  await expect(page.getByRole('link', { name: /Bowl/ })).toContainText(/3\sZutaten/);

  // The pencil ("Meal bearbeiten") opens the editor; saving closes it and logging shows the changes,
  // without asking about unsaved changes.
  await page.goto('/add?meal=1&tab=mine');
  await page.getByRole('link', { name: /Bowl/ }).click();
  const logUrl = page.url();
  await page.getByRole('link', { name: 'Meal bearbeiten' }).click();
  await expect(page).toHaveURL(/\/meals\/[^?]+\?from=log$/);
  await expect(page.getByRole('button', { name: 'Speichern', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Honig entfernen' }).click();
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByText('„Bowl“ gespeichert', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(logUrl);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /kcal eintragen$/ })).toHaveText('200 kcal eintragen');
  await expect(page.getByText('Honig', { exact: true })).toHaveCount(0);

  // Deleting in the editor returns past "Meal eintragen" to the search; undo brings the meal back.
  await page.getByRole('link', { name: 'Meal bearbeiten' }).click();
  await page.getByRole('button', { name: 'Meal löschen' }).click();
  await expect(page).toHaveURL(/\/add\?/);
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(page.getByRole('link', { name: /Bowl/ })).toBeVisible();
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
  let hint: string | null = null;
  page.on('request', (r) => {
    if (r.url().endsWith('/api/ai/analyze'))
      hint =
        r
          .postDataBuffer()
          ?.toString('latin1')
          .match(/name="text"\r\n\r\n([^\r]*)/)?.[1] ?? '';
  });
  await page.goto('/photo?meal=1');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Essen eintragen\s*Mittagessen/);
  // A picked gallery photo (no barcode in it) shows a preview first; nothing goes to the AI yet.
  await page.locator('input[type=file]:not([capture])').setInputFiles('public/pwa-192x192.png');
  await expect(page.getByRole('img', { name: 'Aufgenommenes Foto' })).toBeVisible();
  await expect(page.getByText('Erst mit „Analysieren“ geht das Foto an Claude.')).toBeVisible();
  // "Neu aufnehmen" drops it, so does back (the page stays).
  await page.getByRole('button', { name: 'Neu aufnehmen' }).click();
  await expect(page.getByRole('img', { name: 'Aufgenommenes Foto' })).toHaveCount(0);
  await page.locator('input[type=file]:not([capture])').setInputFiles('public/pwa-192x192.png');
  await page.getByRole('button', { name: 'Zurück' }).click();
  await expect(page).toHaveURL(/\/photo/);
  await expect(page.getByRole('img', { name: 'Aufgenommenes Foto' })).toHaveCount(0);
  expect(hint).toBeNull();
  await page.locator('input[type=file]:not([capture])').setInputFiles('public/pwa-192x192.png');
  await page.getByLabel('Hinweis für die Analyse (optional)').fill('viel Parmesan');
  await page.getByRole('button', { name: 'Analysieren' }).click();
  await expect(page.getByRole('heading', { name: 'Ergebnis prüfen' })).toBeVisible();
  expect(hint).toBe('viel Parmesan');
  await expect(page.getByRole('img', { name: 'Analysiertes Foto' })).toBeVisible();
  await page.getByLabel('Menge', { exact: true }).first().fill('180');
  // Each ingredient card opens the nutrients of its grams (150 kcal per 100 g × 180 g).
  const pasta = page.locator('section').filter({ hasText: 'Teigwaren gekocht' });
  await pasta.getByRole('button', { name: 'Nährwerte' }).click();
  await expect(pasta.getByRole('button', { name: /^270 kcal, Anteil/ })).toBeVisible();
  await expect(
    pasta.locator('[data-slot=collapsible-content]').getByText('180 g', { exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Zutat hinzufügen' }).click();
  await page.getByLabel('Lebensmittel suchen').fill('haferflocken');
  await page.getByRole('link', { name: /^Hafer Flocken BLS/ }).click();
  await page.getByRole('button', { name: 'Zur Analyse hinzufügen' }).click();

  await expect(page.getByRole('heading', { name: 'Ergebnis prüfen' })).toBeVisible();
  await expect(page.getByText('von dir hinzugefügt')).toBeVisible();
  await expect(page.getByLabel('Menge', { exact: true }).first()).toHaveValue('180');

  // "Gesamtmenge" scales every ingredient; a manual change becomes the new 100 %.
  const scale = page.getByRole('slider', { name: 'Gesamtmenge skalieren' });
  const summary = page.locator('section').filter({ hasText: 'Summe' });
  const before = Number((await page.getByLabel('Menge', { exact: true }).nth(1).inputValue()) || '0');
  await scale.focus();
  for (let i = 0; i < 10; i++) await scale.press('ArrowRight');
  await expect(summary.getByText('150 %')).toBeVisible();
  await expect(page.getByLabel('Menge', { exact: true }).first()).toHaveValue('270');
  await expect(page.getByLabel('Menge', { exact: true }).nth(1)).toHaveValue(
    String(Math.round(before * 1.5)),
  );
  for (let i = 0; i < 4; i++) await scale.press('ArrowLeft');
  await expect(summary.getByText('130 %')).toBeVisible();
  await expect(page.getByLabel('Menge', { exact: true }).first()).toHaveValue('234');
  await page.getByLabel('Menge', { exact: true }).first().fill('200');
  await expect(summary.getByText('100 %')).toBeVisible();
  await expect(page.getByLabel('Menge', { exact: true }).nth(1)).toHaveValue(
    String(Math.round(before * 1.3)),
  );

  // Saving (header icon, name dialog) stores the meal with the photo but logs nothing yet.
  await expect(page.getByLabel('Name des Meals')).toHaveCount(0);
  await expect(page.getByText(/als Gruppe „Nudeln mit Soße“ eingetragen/)).toBeVisible();
  await page.getByRole('button', { name: 'Als Meal speichern' }).click();
  const dialog = page.getByRole('dialog', { name: 'Als Meal speichern' });
  await expect(dialog).toContainText('Eingetragen wird erst mit „Meal eintragen“');
  await expect(dialog.getByLabel('Name')).toHaveValue('Nudeln mit Soße');
  await dialog.getByRole('button', { name: 'Meal speichern' }).click();
  await expect(page.getByText('„Nudeln mit Soße“ gespeichert', { exact: true })).toBeVisible();
  const chip = page.getByRole('button', { name: /Als Meal „Nudeln mit Soße“ gespeichert/ });
  await expect(chip).toContainText('Gespeichert');
  await expect(page.getByText(/Als Meal „Nudeln mit Soße“ gespeichert \(mit Foto\)/)).toBeVisible();
  // The chip reopens the dialog to rename the meal.
  await chip.click();
  await dialog.getByLabel('Name').fill('Nudeln Bolo');
  await dialog.getByRole('button', { name: 'Meal speichern' }).click();
  await expect(page.getByText('„Nudeln Bolo“ gespeichert', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Meal eintragen' }).click();

  await expect(page.getByText('„Nudeln Bolo“ eingetragen')).toBeVisible();
  await expect(page.getByRole('button', { name: /Nudeln Bolo/ })).toBeVisible();
  await page.goto('/meals');
  await page.getByRole('link', { name: /Nudeln Bolo/ }).click();
  await expect(page.getByRole('img', { name: 'Foto von Nudeln Bolo' })).toBeVisible();
  await expect(page.getByText('Hafer Flocken', { exact: true })).toBeVisible();
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
  await page.getByRole('button', { name: 'Analysieren' }).click();
  await expect(page.getByRole('heading', { name: 'Ergebnis prüfen' })).toBeVisible();
  // Regression (WebKit, broken thumbnails): many review writes, a reload, the photo still shows.
  const grams = page.getByLabel('Menge', { exact: true }).first();
  for (const g of ['210', '220', '230', '240', '200']) await grams.fill(g);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Ergebnis prüfen' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Analysiertes Foto' })).toHaveJSProperty('complete', true);
  await expect
    .poll(() =>
      page.getByRole('img', { name: 'Analysiertes Foto' }).evaluate((i: HTMLImageElement) => i.naturalWidth),
    )
    .toBe(192);
  await expect(page.getByLabel('Menge', { exact: true }).first()).toHaveValue('200');
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
  // The analysed photo is kept on the entries and shown on the row.
  const groupPhoto = page.getByRole('listitem').filter({ has: group }).locator('img').first();
  await expect.poll(() => groupPhoto.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(192);
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

test('AI review: the hint stays editable, ↻ analyzes again (asking after changes)', async ({ page }) => {
  await register(page);
  await page.route('**/api/ai/status', (r) =>
    r.fulfill({ json: { enabled: true, model: 'claude-opus-5-5' } }),
  );
  const result = (dish: string, name: string, grams: number) => ({
    analysisId: '00000000-0000-7000-8000-000000000002',
    dishName: dish,
    items: [
      {
        name,
        grams,
        confidence: 'high',
        preparation: null,
        packaged: false,
        searchTerms: [],
        candidates: [
          {
            food: {
              id: `bls:${name}`,
              source: 'bls',
              sourceId: name,
              name: `${name} gekocht`,
              nameEn: null,
              brand: null,
              group: null,
              unit: 'g',
              nutrients: { ENERCC: 150, PROT625: 5 },
              portions: [],
            },
            score: 1,
          },
        ],
      },
    ],
    notes: `Erkannt: ${dish}.`,
    model: 'claude-opus-5-5',
    usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.03 },
  });
  const hints: string[] = [];
  let release: (() => void) | null = null;
  await page.route('**/api/ai/analyze', async (r) => {
    const hint =
      r
        .request()
        .postDataBuffer()
        ?.toString('utf8')
        .match(/name="text"\r\n\r\n([^\r]*)/)?.[1] ?? '';
    hints.push(hint);
    if (hints.length === 1) return r.fulfill({ json: result('Nudeln mit Soße', 'Nudeln', 200) });
    // The second analysis waits until the test lets it finish (to see the busy state).
    await new Promise<void>((resolve) => (release = resolve));
    await r.fulfill({ json: result('Reis mit Gemüse', 'Reis', 150) });
  });

  await page.goto('/photo?meal=1');
  await page.locator('input[type=file]:not([capture])').setInputFiles('public/pwa-192x192.png');
  await page.getByLabel('Hinweis für die Analyse (optional)').fill('mit Butter');
  await page.getByRole('button', { name: 'Analysieren' }).click();
  await expect(page.getByRole('heading', { name: 'Ergebnis prüfen' })).toBeVisible();

  // The hint of the preview is in the review, under the note of the AI.
  const hint = page.getByLabel('Hinweis für die Analyse', { exact: true });
  await expect(hint).toHaveValue('mit Butter');
  await expect(page.getByText('Ändern und oben auf ↻ tippen, um neu zu analysieren.')).toBeVisible();
  await expect(page.getByText('Erkannt: Nudeln mit Soße.')).toBeVisible();

  // After a change to the ingredients ↻ asks first; "Abbrechen" keeps everything.
  await page.getByLabel('Menge', { exact: true }).first().fill('180');
  const redo = page.getByRole('button', { name: 'Neu analysieren' });
  await redo.click();
  const ask = page.getByRole('dialog', { name: 'Neu analysieren?' });
  await expect(ask).toContainText('Deine Änderungen an den Zutaten gehen verloren.');
  await ask.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(page.getByLabel('Menge', { exact: true }).first()).toHaveValue('180');

  // New hint, ↻, confirm: the review is greyed out under the overlay, ↻ is locked meanwhile.
  await hint.fill('ohne Butter, mit Reis');
  await redo.click();
  await ask.getByRole('button', { name: 'Neu analysieren' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Analysiere Foto…' })).toBeVisible();
  await expect(redo).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Meal eintragen' })).toBeDisabled();
  await expect(hint).toBeDisabled();
  expect(hints).toEqual(['mit Butter', 'ohne Butter, mit Reis']);
  release!();

  // The new result replaces the rows; one queue item, the hint stays.
  await expect(page.getByText('Erkannt: Reis mit Gemüse.')).toBeVisible();
  await expect(page.getByLabel('Menge', { exact: true }).first()).toHaveValue('150');
  await expect(redo).toBeEnabled();
  await expect(page.getByLabel('Hinweis für die Analyse', { exact: true })).toHaveValue(
    'ohne Butter, mit Reis',
  );
  // Still one analysis in the list (replaced, not added).
  await page.getByRole('button', { name: 'Zurück zur Liste' }).click();
  await expect(page.getByText(/1 Lebensmittel erkannt, bitte prüfen/)).toHaveCount(1);
});

test('a photo taken offline shows in the diary right away and is logged once analysed', async ({
  page,
  context,
}) => {
  await register(page);
  await page.route('**/api/ai/status', (r) =>
    r.fulfill({ json: { enabled: true, model: 'claude-opus-5-5' } }),
  );
  await page.goto('/photo?meal=1');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await context.setOffline(true);
  await page.locator('input[type=file]:not([capture])').setInputFiles('public/pwa-192x192.png');
  await page.getByRole('button', { name: 'Analysieren' }).click();

  // Offline: straight to the diary, where the photo waits in its meal without kcal.
  await expect(page.getByText(/^Offline gespeichert\./)).toBeVisible();
  await expect(page).toHaveURL(/\/\?date=|\/$/);
  const lunch = page.locator('section', { has: page.getByRole('link', { name: /^Mittagessen/ }) });
  const waiting = lunch.getByRole('listitem').filter({ hasText: 'Foto-Analyse' });
  await expect(waiting).toContainText('Gespeichert, wird analysiert sobald du online bist');
  await expect(waiting.getByLabel('noch keine Kalorien')).toBeVisible();
  await expect(lunch.getByRole('link', { name: /^Mittagessen/ })).not.toContainText('kcal');
  await expect.poll(() => waiting.locator('img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(192);

  // Back online the analysis runs and the result is logged by itself, as a normal group.
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
  let serverDown = true;
  await page.route('**/api/ai/analyze', (r) =>
    serverDown
      ? r.fulfill({ status: 500, json: { error: 'Analyse nicht möglich' } })
      : r.fulfill({
          json: {
            analysisId: '00000000-0000-7000-8000-000000000008',
            dishName: 'Reis mit Hähnchen',
            items: [item('Reis gekocht', 'bls:R', 130, 200), item('Hähnchenbrust', 'bls:H', 110, 150)],
            notes: null,
            model: 'claude-opus-5-5',
            usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.03 },
          },
        }),
  );
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  // A failed analysis stays in the diary: swipe deletes it (with undo), "Wiederholen" runs it again.
  const retry = lunch.getByRole('button', { name: 'Wiederholen' });
  await expect(retry).toBeVisible();
  await swipeLeft(page, 'Foto-Analyse');
  await page.getByRole('button', { name: 'Foto-Analyse löschen' }).click();
  await expect(waiting).toHaveCount(0);
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(retry).toBeVisible();
  await expect.poll(() => waiting.locator('img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(192);
  serverDown = false;
  await retry.click();
  await expect(page.getByText('„Reis mit Hähnchen“ analysiert und eingetragen')).toBeVisible();
  await expect(waiting).toHaveCount(0);
  await expect(lunch.getByText('Reis mit Hähnchen', { exact: true })).toBeVisible();
  await expect(lunch.getByRole('link', { name: /^Mittagessen/ })).toContainText('425 kcal');
  // Nothing is left to review on the food page.
  await page.goto('/photo?meal=1');
  await expect(page.getByRole('button', { name: /Lebensmittel erkannt/ })).toHaveCount(0);
});
