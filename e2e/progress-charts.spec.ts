import { expect, test } from '@playwright/test';
import { logFoodFromSearch, onboard, realErrors, stubUnconfiguredBackend, watchErrors } from './support/app';

/**
 * The project plan §8.5: "weight + macro history render as real charts from real logged
 * data; empty states show when there is none." Both halves, in a real browser — a chart
 * library rendering nothing at all is invisible to jsdom.
 *
 * No mocked success responses; this is pure guest-mode behaviour.
 */

const BANANA = 'Banana, fruit, 89 kcal per 100 g';

/**
 * The stat tiles are desktop's. The phone mock's Insights is four cards — weight,
 * calories per day, where the calories come from, consistency — so at 390px the tiles
 * are not on the page at all and asserting them there would be asserting the desktop
 * layout twice.
 */
const isDesktop = (projectName: string): boolean => projectName.startsWith('desktop');

test.describe('progress charts', () => {
  test.beforeEach(async ({ page }) => {
    await stubUnconfiguredBackend(page);
  });

  test('empty states first — no invented data to make the screen look full', async ({
    page,
  }, testInfo) => {
    const errors = watchErrors(page);
    await onboard(page);
    await page.goto('/progress');

    await expect(page.getByText('No weight readings yet')).toBeVisible();
    await expect(page.getByText('Nothing logged in this range')).toBeVisible();
    await expect(page.getByText('No split to show yet')).toBeVisible();

    if (isDesktop(testInfo.project.name)) {
      // The stat tiles say "—", not a plausible-looking zero or a fake number.
      await expect(page.getByText('Current weight', { exact: true }).locator('..')).toContainText('—');
    } else {
      await expect(page.getByText('Current weight', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Weekly averages' })).toHaveCount(0);
    }

    expect(realErrors(errors)).toEqual([]);
  });

  test('real logged data draws real charts', async ({ page }, testInfo) => {
    const errors = watchErrors(page);
    await onboard(page, { age: 30, heightCm: 180, weightKg: 80 });

    await page.goto('/log');
    await logFoodFromSearch(page, 'banana', BANANA);

    await page.goto('/progress');

    // A weigh-in, entered by hand on this screen.
    await page.getByRole('button', { name: /Add today’s weight/ }).click();
    await page.getByLabel(/weight/i).first().fill('79.5');
    await page.getByRole('button', { name: /^Save/ }).click();

    if (isDesktop(testInfo.project.name)) {
      await expect(page.getByText('Current weight', { exact: true }).locator('..')).toContainText('79.5 kg');
      await expect(page.getByText('Days logged', { exact: true }).locator('..')).toContainText('1');
    } else {
      // Phone has no tiles, so the reading has to show up in the weight card itself.
      await expect(page.getByText('79.5', { exact: false }).first()).toBeVisible();
    }

    // The calories chart now has a real bar instead of its empty state, and the value
    // comes from the entry that was actually logged.
    // `exact` matters here: the chart's own accessible caption contains the phrase
    // "days logged", which a substring match would also hit.
    await expect(page.getByText('Nothing logged in this range')).toHaveCount(0);
    await expect(page.getByText('105 kcal').first()).toBeVisible();

    expect(realErrors(errors)).toEqual([]);
  });
});
