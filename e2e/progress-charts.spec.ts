import { expect, test } from '@playwright/test';
import { logFoodFromSearch, onboard, realErrors, stubUnconfiguredBackend, watchErrors } from './support/app';

/**
 * docs/PLAN.md §8.5: "weight + macro history render as real charts from real logged
 * data; empty states show when there is none." Both halves, in a real browser — a chart
 * library rendering nothing at all is invisible to jsdom.
 *
 * No mocked success responses; this is pure guest-mode behaviour.
 */

const BANANA = 'Banana, fruit, 89 kcal per 100 g';

test.describe('progress charts', () => {
  test.beforeEach(async ({ page }) => {
    await stubUnconfiguredBackend(page);
  });

  test('empty states first — no invented data to make the screen look full', async ({ page }) => {
    const errors = watchErrors(page);
    await onboard(page);
    await page.goto('/progress');

    await expect(page.getByText('No weight readings yet')).toBeVisible();
    await expect(page.getByText('Nothing logged in this range')).toBeVisible();
    // The stat tiles say "—", not a plausible-looking zero or a fake number.
    await expect(page.getByText('Current weight', { exact: true }).locator('..')).toContainText('—');

    expect(realErrors(errors)).toEqual([]);
  });

  test('real logged data draws real charts', async ({ page }) => {
    const errors = watchErrors(page);
    await onboard(page, { age: 30, heightCm: 180, weightKg: 80 });

    await page.goto('/log');
    await logFoodFromSearch(page, 'banana', BANANA);

    await page.goto('/progress');

    // A weigh-in, entered by hand on this screen.
    await page.getByRole('button', { name: /Add today’s weight/ }).click();
    await page.getByLabel(/weight/i).first().fill('79.5');
    await page.getByRole('button', { name: /^Save/ }).click();

    await expect(page.getByText('Current weight', { exact: true }).locator('..')).toContainText('79.5 kg');
    await expect(page.getByText('Days logged', { exact: true }).locator('..')).toContainText('1');

    // The calories chart now has a real bar instead of its empty state, and the value
    // comes from the entry that was actually logged.
    // `exact` matters here: the chart's own accessible caption contains the phrase
    // "days logged", which a substring match would also hit.
    await expect(page.getByText('Nothing logged in this range')).toHaveCount(0);
    await expect(page.getByText('105 kcal').first()).toBeVisible();

    expect(realErrors(errors)).toEqual([]);
  });
});
