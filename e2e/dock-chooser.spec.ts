import { expect, test } from '@playwright/test';
import { onboard, stubUnconfiguredBackend } from './support/app';

/**
 * The phone dock's raised "+" opens a chooser sheet (search vs scan) rather than going
 * straight to `/log`. Desktop keeps the direct link, because `/log`'s own header already
 * carries "Scan" a few pixels away.
 *
 * The last assertion in each phone case is the one that matters most: after the sheet
 * closes it must leave *nothing* behind. A dismissed overlay that stays mounted at
 * `fixed inset-0` is invisible but still swallows every click on the page underneath —
 * a failure mode that a screenshot cannot show and a "did we navigate?" check misses.
 */

const isPhone = (projectName: string): boolean => projectName.startsWith('mobile');

test.describe('the dock’s add-chooser', () => {
  test.beforeEach(async ({ page }) => {
    await stubUnconfiguredBackend(page);
    await onboard(page);
  });

  test('phone: the + offers search or scan; desktop goes straight to the log', async ({
    page,
  }, testInfo) => {
    const dock = page.getByRole('navigation', { name: 'Main' });

    if (!isPhone(testInfo.project.name)) {
      await expect(dock.getByRole('link', { name: 'Log food' })).toBeVisible();
      await dock.getByRole('link', { name: 'Log food' }).click();
      await expect(page).toHaveURL(/\/log$/);
      return;
    }

    await dock.getByRole('button', { name: 'Log food' }).click();

    const sheet = page.getByRole('dialog', { name: /add to your log/i });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('button', { name: /search the food list/i })).toBeVisible();
    await expect(sheet.getByRole('button', { name: /scan a meal/i })).toBeVisible();

    await sheet.getByRole('button', { name: /search the food list/i }).click();
    await expect(page).toHaveURL(/\/log$/);

    // The destination has to be genuinely usable, not merely rendered.
    await page.getByLabel('Search foods').fill('banana');
    await expect(page.getByRole('button', { name: /banana/i }).first()).toBeVisible();
  });

  test('phone: choosing "Scan a meal" reaches /scan and leaves no dead overlay', async ({
    page,
  }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'the chooser is a phone-only affordance');

    const dock = page.getByRole('navigation', { name: 'Main' });
    await dock.getByRole('button', { name: 'Log food' }).click();

    const sheet = page.getByRole('dialog', { name: /add to your log/i });
    await sheet.getByRole('button', { name: /scan a meal/i }).click();

    await expect(page).toHaveURL(/\/scan$/);
    await expect(page.getByRole('heading', { name: /estimate a meal from a photo/i })).toBeVisible();

    // The sheet must be gone from the DOM, not just faded to opacity 0.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');

    // And the page under it must actually receive clicks again.
    await dock.getByRole('link', { name: 'Today' }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('phone: dismissing the chooser with Escape restores the page', async ({
    page,
  }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'the chooser is a phone-only affordance');

    const dock = page.getByRole('navigation', { name: 'Main' });
    await dock.getByRole('button', { name: 'Log food' }).click();
    await expect(page.getByRole('dialog', { name: /add to your log/i })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Still on Today, and still clickable — nothing invisible is covering the screen.
    await expect(page).toHaveURL(/\/$/);
    await dock.getByRole('link', { name: 'Insights' }).click();
    await expect(page).toHaveURL(/\/progress$/);
  });
});
