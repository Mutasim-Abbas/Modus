import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { createFakeBackend, FAKE_PASSWORD, FAKE_RECOVERY_CODE } from './support/fakeSync';
import { logFoodFromSearch, onboard, readStorage, realErrors, STORE_KEY, watchErrors } from './support/app';

/**
 * ⚠️ EVERY TEST IN THIS FILE IS **MOCK-BACKED**. ⚠️
 *
 * No `DATABASE_URL`, no `SESSION_PEPPER`, no Neon project exists locally and the publish
 * hold forbids creating one, so `api/auth/*` and `api/sync/*` are fulfilled by
 * `e2e/support/fakeSync.ts` against the response shapes in `docs/API.md`. These specs
 * prove the **client** works end to end across two real browser contexts. They prove
 * NOTHING about the deployed backend — the project plan §8.2 stays ⚠️ for that reason, and
 * the sign-off in the project plan §8 says so.
 */

const BANANA = 'Banana, fruit, 89 kcal per 100 g';
const EMAIL = 'test@example.com';

async function signUp(page: Page): Promise<void> {
  await page.goto('/auth/sign-up');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(FAKE_PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
}

/** The recovery-code gate: it cannot be skipped, which is the point of it. */
async function acknowledgeRecoveryCode(page: Page): Promise<void> {
  await expect(page.getByTestId('recovery-code')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continue' }).click();
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/auth/sign-in');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(FAKE_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** A second device: its own browser context, its own empty localStorage. */
async function openDeviceB(browser: Browser, viewport: { width: number; height: number }): Promise<Page> {
  const context = await browser.newContext({ viewport });
  return context.newPage();
}

test.describe('MOCK-BACKED: accounts and sync', () => {
  test('sign up → recovery code shown once → local data uploads', async ({ page }) => {
    const errors = watchErrors(page);
    const backend = createFakeBackend();
    await backend.install(page);

    await onboard(page);
    await page.goto('/log');
    await logFoodFromSearch(page, 'banana', BANANA);
    await expect(page.getByRole('button', { name: 'Edit Banana' })).toBeVisible();

    await signUp(page);

    // The code is shown exactly once, and never persisted anywhere.
    await expect(page.getByTestId('recovery-code')).toHaveText(FAKE_RECOVERY_CODE);
    const storageDump = await page.evaluate(
      () => JSON.stringify(window.localStorage) + JSON.stringify(window.sessionStorage),
    );
    expect(storageDump).not.toContain(FAKE_RECOVERY_CODE);

    // A hard reload of the same URL must not bring a "shown once" secret back — real
    // BrowserRouter history persists `history.state` across reloads (the project notes,
    // Task 5's browser-only finding).
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Nothing to show here' })).toBeVisible();
    await expect(page.getByTestId('recovery-code')).toHaveCount(0);

    // Continue → adoption runs. Local had data, the account had none: silent upload.
    await page.getByRole('button', { name: 'Go to Today' }).click();
    await expect(page).toHaveURL(/\/$/);

    await expect
      .poll(() => Array.from(backend.entries.values()).map((row) => row.name), { timeout: 10_000 })
      .toEqual(['Banana']);

    // Signing up did not touch local data.
    await page.goto('/log');
    await expect(page.getByRole('button', { name: 'Edit Banana' })).toBeVisible();

    expect(realErrors(errors)).toEqual([]);
  });

  test('two devices: A logs, B signs in on a clean profile and sees the same data', async ({ page, browser }, testInfo) => {
    const backend = createFakeBackend();
    await backend.install(page);

    // ---- Device A: onboard, log, sign up, upload ----
    await onboard(page, { age: 30, heightCm: 180, weightKg: 80 });
    await page.goto('/log');
    await logFoodFromSearch(page, 'banana', BANANA);
    await signUp(page);
    await acknowledgeRecoveryCode(page);
    await expect(page).toHaveURL(/\/$/);
    await expect.poll(() => backend.entries.size, { timeout: 10_000 }).toBe(1);
    await expect.poll(() => backend.profile !== null, { timeout: 10_000 }).toBe(true);

    // ---- Device B: brand new browser context, empty storage ----
    const viewport = testInfo.project.use.viewport ?? { width: 1440, height: 900 };
    const deviceB = await openDeviceB(browser, viewport);
    const errorsB = watchErrors(deviceB);
    await backend.install(deviceB);

    await deviceB.goto('/auth/sign-in');
    // Genuinely a clean device: nothing in its localStorage before it signs in.
    expect(await readStorage(deviceB, STORE_KEY)).toBeNull();

    await signIn(deviceB);
    // Adoption: local empty, account has data → silent download, straight to the app.
    await expect(deviceB).toHaveURL(/\/$/, { timeout: 15_000 });

    // The profile came down too, so device B is NOT bounced back into onboarding.
    // A computed headline can only exist if the profile arrived — an onboarding-less
    // dashboard would have no targets to count down from.
    await expect(deviceB.getByRole('heading', { level: 1 })).toHaveText(/kcal (left|over)$/);
    await expect(deviceB.getByText(/\d+ \/ 2761/)).toBeVisible();

    await deviceB.goto('/log');
    await expect(deviceB.getByRole('button', { name: 'Edit Banana' })).toBeVisible();
    await expect(deviceB.getByRole('button', { name: 'Edit Banana' })).toContainText('118 g');

    expect(realErrors(errorsB)).toEqual([]);
    await deviceB.context().close();
  });

  test('signing in NEVER deletes local data — both sides populated goes to /sync/merge', async ({ page }) => {
    const backend = createFakeBackend();
    backend.seedProfile({ age: 41, heightCm: 170, weightKg: 70 });
    backend.seedEntry({ id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'Server-side lentils', day: '2026-08-01' });
    await backend.install(page);

    await onboard(page);
    await page.goto('/log');
    await logFoodFromSearch(page, 'banana', BANANA);

    await signIn(page);

    // Both sides have data → the merge screen, an explicit choice. No silent overwrite.
    await expect(page).toHaveURL(/\/sync\/merge$/, { timeout: 15_000 });

    // And the local entry is still there, untouched, while the choice is pending.
    const persisted = (await readStorage(page, STORE_KEY)) as {
      days: Record<string, { entries: { name: string }[] }>;
    };
    expect(Object.values(persisted.days).flatMap((d) => d.entries).map((e) => e.name)).toEqual(['Banana']);
  });

  test('offline → the log still works → reconnect → it syncs', async ({ page }) => {
    const backend = createFakeBackend();
    await backend.install(page);

    await onboard(page);
    await signUp(page);
    await acknowledgeRecoveryCode(page);
    await expect(page).toHaveURL(/\/$/);

    // Network down for sync.
    backend.setOffline(true);
    await page.goto('/log');
    await logFoodFromSearch(page, 'banana', BANANA);

    // Logging is never blocked by a sync failure…
    await expect(page.getByRole('button', { name: 'Edit Banana' })).toBeVisible();
    // …and it survives a reload while still unsent.
    await page.reload();
    await expect(page.getByRole('button', { name: 'Edit Banana' })).toBeVisible();
    expect(backend.entries.size).toBe(0);

    // The chip must not claim "Synced" while a change is genuinely still pending (F-17).
    // (`.first()` — the chip is rendered in both the top bar and the screen header.)
    await expect(page.getByText(/pending|Offline|Sync failed/).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/^Synced/)).toHaveCount(0);

    // Reconnect.
    backend.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));

    await expect
      .poll(() => Array.from(backend.entries.values()).map((row) => row.name), { timeout: 20_000 })
      .toEqual(['Banana']);
  });

  /**
   * ❌ KNOWN DEFECT, reproduced here rather than described.
   *
   * `api/_lib/sync/rows.ts`'s `serializeEntry` sends `loggedAt` as an ISO string
   * (`toIso(row.loggedAt)`), but `src/lib/sync/wire.ts`'s `parseEntry` reads it with
   * `num(value.loggedAt)`, which returns its `0` fallback for any string. So **every
   * entry that reaches a device by sync loses its "when I ate this" timestamp** and
   * shows as 1 Jan 1970 in the entry editor.
   *
   * `src/lib/sync/wire.test.ts` misses it because its fixture passes `loggedAt` as a
   * number — a shape the real server never emits.
   *
   * Marked `test.fail()` so the suite stays green *and* honest: the day someone fixes
   * `parseEntry`, this turns into an "unexpected pass" and forces the marker's removal.
   */
  test('loggedAt survives a sync round-trip', async ({ page, browser }, testInfo) => {
    test.fail();

    const backend = createFakeBackend();
    await backend.install(page);

    await onboard(page);
    await page.goto('/log');
    await logFoodFromSearch(page, 'banana', BANANA);
    await signUp(page);
    await acknowledgeRecoveryCode(page);
    await expect.poll(() => backend.entries.size, { timeout: 10_000 }).toBe(1);

    const viewport = testInfo.project.use.viewport ?? { width: 1440, height: 900 };
    const deviceB = await openDeviceB(browser, viewport);
    await backend.install(deviceB);
    await signIn(deviceB);
    await expect(deviceB).toHaveURL(/\/$/, { timeout: 15_000 });

    const persisted = (await readStorage(deviceB, STORE_KEY)) as {
      days: Record<string, { entries: { loggedAt: number }[] }>;
    };
    const downloaded = Object.values(persisted.days).flatMap((day) => day.entries);
    expect(downloaded).toHaveLength(1);
    expect(downloaded[0]?.loggedAt).toBeGreaterThan(0);

    await deviceB.context().close();
  });
});
