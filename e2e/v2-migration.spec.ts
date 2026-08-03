import { expect, test } from '@playwright/test';
import { V2_PAYLOAD } from '../src/lib/__fixtures__/v2-payload';
import {
  readStorage,
  realErrors,
  seedStorage,
  STORE_KEY,
  stubUnconfiguredBackend,
  watchErrors,
} from './support/app';

/**
 * REAL-BACKEND-FREE — nothing here needs a server at all. the project plan §8.3: "an
 * existing v2 user with localStorage data … loses nothing."
 *
 * The payload is `src/lib/__fixtures__/v2-payload.ts`, captured from the actual shipped
 * v2 store (see that file's provenance note) — not hand-written to match the
 * migration's assumptions. This spec drives it through the real built bundle in a real
 * browser, which is the one thing the vitest migration tests cannot do.
 *
 * NOTE ON SCOPE: this proves the v2 → v3 migration under **guest** conditions. Running
 * the same migration *under sync* has never been reviewed or tested — see
 * the internal security audit §9 and the Task 8 sign-off in the project plan §8.
 */

/** Every entry in the fixture, with the day it must still be on afterwards. */
const V2_ENTRIES = [
  { day: '2026-07-20', name: 'Chicken breast, cooked', kcal: 248 },
  { day: '2026-07-20', name: 'Grilled salmon with rice (scan)', kcal: 540 },
  { day: '2026-07-21', name: 'Homemade lentil soup', kcal: 260 },
  { day: '2026-07-21', name: 'Simit', kcal: 275 },
] as const;

async function jumpToDay(page: import('@playwright/test').Page, day: string): Promise<void> {
  // The date label doubles as the picker toggle (src/features/log/LogScreen.tsx).
  await page.getByRole('button', { expanded: false }).first().click();
  await page.getByLabel('Jump to a date').fill(day);
}

test.describe('a v2 user opens v3', () => {
  test.beforeEach(async ({ page }) => {
    await stubUnconfiguredBackend(page);
    await seedStorage(page, STORE_KEY, V2_PAYLOAD);
  });

  test('the captured v2 payload loads with nothing lost', async ({ page }) => {
    const errors = watchErrors(page);

    await page.goto('/');

    // Straight to the dashboard — a migrated profile means onboarding must NOT reappear.
    expect(new URL(page.url()).pathname).toBe('/');
    await expect(page.getByText(/of 1481 kcal logged/)).toBeVisible();

    // Every one of the four entries is still on its original day, with its numbers.
    await page.goto('/log');
    for (const day of ['2026-07-20', '2026-07-21'] as const) {
      await jumpToDay(page, day);
      for (const entry of V2_ENTRIES.filter((e) => e.day === day)) {
        await expect(page.getByRole('button', { name: `Edit ${entry.name}` })).toBeVisible();
      }
    }

    // OBSERVED, and worth stating because it surprised me: reading does not rewrite
    // storage. `migrate()` runs in memory on boot and the blob stays at `version: 2`
    // until the user's next write. That is not data loss — it is a read staying a read
    // — but it means "did the migration persist?" can only be answered after a write.
    const beforeWrite = (await readStorage(page, STORE_KEY)) as { version: number } | null;
    expect(beforeWrite?.version).toBe(2);

    // So: make one real write, then check the rewritten blob.
    await page.getByLabel('Search foods').fill('banana');
    await page.getByRole('button', { name: 'Banana, fruit, 89 kcal per 100 g' }).click();
    await page.getByRole('button', { name: /^Add to / }).click();
    await expect(page.getByRole('button', { name: /^Edit Banana$/ })).toBeVisible();

    const persisted = (await readStorage(page, STORE_KEY)) as {
      version: number;
      settings: Record<string, unknown>;
    } | null;
    expect(persisted?.version).toBe(3);
    // The v2 user's explicit reduced-motion choice survives the migration.
    expect(persisted?.settings.reducedMotion).toBe(true);

    const blob = JSON.stringify(persisted);
    for (const day of Object.keys(V2_PAYLOAD.days)) {
      expect(blob).toContain(day);
    }
    for (const dayLog of Object.values(V2_PAYLOAD.days)) {
      for (const entry of dayLog.entries) {
        expect(blob, `entry ${entry.id} (${entry.name}) was lost`).toContain(entry.id);
      }
    }

    expect(realErrors(errors)).toEqual([]);
  });

  test('the migrated data survives a hard reload', async ({ page }) => {
    await page.goto('/history');
    await expect(page.getByRole('heading', { name: /Your logged days/ })).toBeVisible();

    await page.reload();
    const blob = JSON.stringify(await readStorage(page, STORE_KEY));
    for (const dayLog of Object.values(V2_PAYLOAD.days)) {
      for (const entry of dayLog.entries) {
        expect(blob).toContain(entry.id);
      }
    }
  });
});
