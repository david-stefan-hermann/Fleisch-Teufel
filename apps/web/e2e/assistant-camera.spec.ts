import { expect, test, type Locator, type Page } from '@playwright/test';

// A fake camera, so the food page shows its picture instead of the fallback.
test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  permissions: ['camera'],
});

async function register(page: Page) {
  await page.context().addInitScript(() => localStorage.setItem('ft.installHintDismissed', '1'));
  // The E2E server runs without AI: the server info offers it here (no "KI aus" note above the camera).
  await page.route('**/api/info', async (r) => {
    const res = await r.fetch();
    await r.fulfill({
      response: res,
      json: { ...(await res.json()), assistantEnabled: true },
    });
  });
  await page.route('**/api/ai/status', (r) => r.fulfill({ json: { enabled: true, model: null } }));
  await page.goto('/login');
  await page.getByRole('button', { name: 'Neues Konto erstellen' }).click();
  await page
    .getByLabel('E-Mail')
    .fill(`e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`);
  await page.getByLabel('Passwort').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Konto erstellen' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
}

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const button = (page: Page) => page.locator('.ai-btn:not(.ai-still)');
const picture = (page: Page) => page.locator('[data-ai-avoid]').first();
const buttonRow = (page: Page) =>
  page.locator('[data-ai-avoid]').filter({ has: page.getByRole('button', { name: 'Eingeben' }) });

/** The button's visible box (it is scaled from its top left corner). */
async function buttonBox(b: Locator): Promise<Box> {
  await expect(b).toBeVisible();
  // The position settles after the layout tick.
  await b.page().waitForTimeout(600);
  return (await b.boundingBox())!;
}

async function expectFree(page: Page) {
  const b = await buttonBox(button(page));
  expect(overlaps(b, (await picture(page).boundingBox())!)).toBe(false);
  expect(overlaps(b, (await buttonRow(page).boundingBox())!)).toBe(false);
}

test.describe('room below the camera', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the assistant button lies beside the camera picture, also large, left and after a drag', async ({
    page,
  }) => {
    await register(page);
    await page.goto('/photo');
    await expect(page.getByRole('button', { name: 'Foto aufnehmen' })).toBeVisible();
    await expectFree(page);

    // Large.
    await page.evaluate(() => localStorage.setItem('ft.assistant.size', 'large'));
    await page.reload();
    await expect(page.getByRole('button', { name: 'Foto aufnehmen' })).toBeVisible();
    await expectFree(page);

    // At the left edge, wanted high up (on the picture).
    await page.evaluate(() =>
      localStorage.setItem('ft.assistant.pos', JSON.stringify({ edge: 'left', y: 200 })),
    );
    await page.evaluate(() => localStorage.setItem('ft.assistant.size', 'small'));
    await page.reload();
    await expect(page.getByRole('button', { name: 'Foto aufnehmen' })).toBeVisible();
    await expectFree(page);

    // Dragged onto the picture and let go: it snaps to a free spot.
    const b = await buttonBox(button(page));
    const pic = (await picture(page).boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(pic.x + pic.width / 2, pic.y + pic.height / 2, { steps: 8 });
    await page.mouse.up();
    await expectFree(page);
  });
});

test('on a short screen the camera step has no floating button, the form has it again', async ({ page }) => {
  await register(page);
  await page.goto('/photo');
  await expect(page.getByRole('button', { name: 'Foto aufnehmen' })).toBeVisible();
  await page.waitForTimeout(600);
  await expect(button(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Eingeben' }).click();
  await expect(page.getByLabel('Was hast du gegessen?')).toBeVisible();
  await expect(button(page)).toBeVisible();
});
