import { expect, test } from '@playwright/test';
import {
  logFoodFromSearch,
  onboard,
  readStorage,
  realErrors,
  STORE_KEY,
  stubUnconfiguredBackend,
  watchErrors,
} from './support/app';

/**
 * NO MOCKED SUCCESS RESPONSES — pure local behaviour, the way a guest uses it.
 * The project plan §8.1 ("new coverage for … edit/backdate") driven in a real browser.
 */

const BANANA = 'Banana, fruit, 89 kcal per 100 g';

/** Local `YYYY-MM-DD`, matching `src/lib/date.ts`'s `toDayKey`. */
function dayKey(offsetDays = 0): string {
  const now = new Date();
  now.setDate(now.getDate() + offsetDays);
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

test.describe('editing and backdating an entry', () => {
  test.beforeEach(async ({ page }) => {
    await stubUnconfiguredBackend(page);
  });

  test('edit an entry: the portion changes, the macros re-derive, and it persists', async ({ page }) => {
    const errors = watchErrors(page);
    await onboard(page);

    await page.goto('/log');
    await logFoodFromSearch(page, 'banana', BANANA);

    // The default portion is the food's first common portion: 1 medium = 118 g -> 105 kcal.
    const row = page.getByRole('button', { name: 'Edit Banana' });
    await expect(row).toContainText('118 g');
    await expect(row).toContainText('105');

    await row.click();
    const sheet = page.getByRole('dialog', { name: 'Edit entry' });
    await expect(sheet).toBeVisible();
    await sheet.getByLabel('Portion').fill('200');
    // The live preview re-derives from the food's per-100 g values, not from the old row.
    await expect(sheet.getByText('178 kcal')).toBeVisible();
    await sheet.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByRole('button', { name: 'Edit Banana' })).toContainText('200 g');
    await expect(page.getByRole('button', { name: 'Edit Banana' })).toContainText('178');

    // Survives a hard reload — the edit was written, not just rendered.
    await page.reload();
    await expect(page.getByRole('button', { name: 'Edit Banana' })).toContainText('200 g');
    await expect(page.getByRole('button', { name: 'Edit Banana' })).toContainText('178');

    expect(realErrors(errors)).toEqual([]);
  });

  test('backdate an entry: it lands on yesterday, not today', async ({ page }) => {
    const errors = watchErrors(page);
    await onboard(page);

    await page.goto('/log');
    await page.getByRole('button', { name: 'Previous day' }).click();
    await expect(page.getByRole('button', { name: 'Back to today' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Logged for Yesterday$/ })).toBeVisible();

    await logFoodFromSearch(page, 'banana', BANANA);
    // The confirmation names the day, so a backdated log can't be mistaken for today's.
    await expect(page.getByText(/^Banana added to .* on Yesterday\.$/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit Banana' })).toBeVisible();

    // Today is still empty.
    await page.getByRole('button', { name: 'Back to today' }).click();
    await expect(page.getByRole('button', { name: 'Edit Banana' })).toHaveCount(0);
    await expect(page.getByText(/^Nothing logged for Today$/)).toBeVisible();

    // And the store agrees: the row is filed under yesterday's key, not today's.
    const persisted = (await readStorage(page, STORE_KEY)) as {
      days: Record<string, { entries: { name: string }[] }>;
    };
    expect(Object.keys(persisted.days)).toContain(dayKey(-1));
    expect(persisted.days[dayKey(-1)]?.entries.map((e) => e.name)).toEqual(['Banana']);
    expect(persisted.days[dayKey()]).toBeUndefined();

    expect(realErrors(errors)).toEqual([]);
  });

  test('the future is not loggable', async ({ page }) => {
    await onboard(page);
    await page.goto('/log');
    await expect(page.getByRole('button', { name: 'Next day' })).toBeDisabled();
  });

  test('deleting an entry asks first, and names what it will delete', async ({ page }) => {
    await onboard(page);
    await page.goto('/log');
    await logFoodFromSearch(page, 'banana', BANANA);

    await page.getByRole('button', { name: /^Remove Banana from / }).click();
    await expect(
      page.getByText(/^Delete this entry\? "Banana" will be removed from /),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('button', { name: 'Edit Banana' })).toHaveCount(0);
  });
});
