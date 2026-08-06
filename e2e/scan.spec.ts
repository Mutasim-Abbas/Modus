import { expect, test } from '@playwright/test';
import { onboard, readStorage, realErrors, STORE_KEY, watchErrors } from './support/app';

/**
 * MOCK-BACKED (happy path only). There is no `GROQ_API_KEY` on this machine and
 * none may be added (the project notes ground rule 1), so `POST /api/analyze-meal` is
 * fulfilled by Playwright with the exact response shape docs/API.md documents and
 * `src/lib/api.ts`'s `parseAnalyzeResponse` validates. What is genuinely exercised here
 * is the whole client path: file read -> data URL -> request body -> response parsing
 * -> the mandatory review screen -> the write to the store.
 *
 * The 503 path below is NOT a mock of a hypothetical failure — `503 ai_unconfigured` is
 * precisely what `api/analyze-meal.ts` returns when the key is unset, i.e. the true
 * state of every environment this project has ever run in.
 */

/** A 1x1 PNG — the smallest thing `FileReader` can turn into a real data URL. */
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const ANALYZE_OK = {
  items: [
    { name: 'Grilled chicken', grams: 150, kcal: 248, protein: 46.5, carbs: 0, fat: 5.4, confidence: 0.82 },
    { name: 'White rice', grams: 180, kcal: 234, protein: 4.9, carbs: 51, fat: 0.5, confidence: 0.55 },
  ],
  totals: { kcal: 482, protein: 51.4, carbs: 51, fat: 5.9 },
  note: 'Portion sizes estimated from the plate.',
};

async function uploadPhoto(page: import('@playwright/test').Page): Promise<void> {
  await page.getByLabel('Choose a meal photo').setInputFiles({
    name: 'meal.png',
    mimeType: 'image/png',
    buffer: PNG_1x1,
  });
}

test.describe('AI scan', () => {
  test('happy path (MOCK-BACKED): photo → estimate → review → logged', async ({ page }) => {
    const errors = watchErrors(page);

    let requestBody: unknown = null;
    await page.route('**/api/analyze-meal', async (route) => {
      requestBody = route.request().postDataJSON() as unknown;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(ANALYZE_OK),
      });
    });

    await onboard(page);
    await page.goto('/scan');
    await expect(page.getByRole('heading', { name: /Estimate a meal from a photo/ })).toBeVisible();

    await uploadPhoto(page);

    // The mandatory review step — nothing is logged before this.
    await expect(page.getByRole('heading', { name: 'Check before logging' })).toBeVisible();
    await expect(page.getByText(/Portion sizes estimated from the plate\./)).toBeVisible();
    await expect(page.getByText('482 kcal')).toBeVisible();
    // Confidence is shown per item, and a low-confidence item is flagged, not hidden.
    await expect(page.getByText('High confidence (82%)')).toBeVisible();
    await expect(page.getByText('Medium confidence (55%)')).toBeVisible();

    // The client really did send base64 + a media type, not the raw data URL.
    const sent = requestBody as { imageBase64?: string; mediaType?: string } | null;
    expect(sent?.mediaType).toBe('image/png');
    expect(sent?.imageBase64?.startsWith('data:')).toBe(false);
    expect((sent?.imageBase64 ?? '').length).toBeGreaterThan(0);

    // Every number is editable before it becomes a log entry.
    await page.locator('#item-0-kcal').fill('300');
    await expect(page.getByText('534 kcal')).toBeVisible();

    await page.getByRole('button', { name: 'Log 2 items' }).click();

    await page.goto('/log');
    await expect(page.getByRole('button', { name: 'Edit Grilled chicken' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit White rice' })).toBeVisible();

    const persisted = (await readStorage(page, STORE_KEY)) as {
      days: Record<string, { entries: { name: string; source: string; kcal: number }[] }>;
    };
    const entries = Object.values(persisted.days).flatMap((d) => d.entries);
    expect(entries.map((e) => e.source)).toEqual(['scan', 'scan']);
    // The user's edit, not the model's number, is what was stored.
    expect(entries.find((e) => e.name === 'Grilled chicken')?.kcal).toBe(300);

    expect(realErrors(errors)).toEqual([]);
  });

  test('503 ai_unconfigured: the feature disables itself and says so, app unaffected', async ({ page }) => {
    const errors = watchErrors(page);

    await page.route('**/api/analyze-meal', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'ai_unconfigured' }),
      }),
    );

    await onboard(page);
    await page.goto('/scan');
    await uploadPhoto(page);

    // A 503 is a *feature*-level failure, so the screen swaps itself for the honest
    // "this isn't available" card rather than showing a retryable error next to an
    // uploader that can only fail again.
    await expect(page.getByRole('heading', { name: /Scanning isn’t available here/ })).toBeVisible();
    await expect(
      page.getByText(/AI scanning isn’t configured on this deployment\./),
    ).toBeVisible();

    // Nothing was invented and nothing was logged.
    const persisted = (await readStorage(page, STORE_KEY)) as { days: Record<string, unknown> };
    expect(Object.keys(persisted.days)).toEqual([]);

    // Once known-unavailable it stops offering an uploader that can only fail. The card
    // offers the honest alternative, and following it is in-app navigation — a full
    // `goto()` would reload the page and reset the in-memory availability flag, which
    // `src/features/scan/availability.ts` documents as deliberate (a redeploy that adds
    // the key must not have to fight a stale flag).
    await page.getByRole('link', { name: 'Log from the food database' }).click();
    await expect(page).toHaveURL(/\/log$/);
    await page.getByRole('link', { name: 'Scan' }).first().click();
    await expect(page.getByRole('heading', { name: /Scanning isn’t available here/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Log from the food database' })).toBeVisible();

    // …and the rest of the app is untouched.
    await page.getByRole('link', { name: 'Log from the food database' }).click();
    await page.getByLabel('Search foods').fill('banana');
    await page.getByRole('button', { name: 'Banana, fruit, 89 kcal per 100 g' }).click();
    await page.getByRole('button', { name: /^Add to / }).click();
    await expect(page.getByRole('button', { name: 'Edit Banana' })).toBeVisible();

    expect(realErrors(errors)).toEqual([]);
  });
});
