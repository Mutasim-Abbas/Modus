import { expect, test } from '@playwright/test';
import {
  logFoodFromSearch,
  onboard,
  readStorage,
  realErrors,
  STORE_KEY,
  stubSignedOutBackend,
  stubUnconfiguredBackend,
  watchErrors,
} from './support/app';

/**
 * REAL-BACKEND (in the only sense that exists locally): these specs use no mocked
 * success responses at all. `/api/*` answers `503 …_unconfigured`, which is exactly
 * what `api/` returns when `DATABASE_URL` / `SESSION_PEPPER` / `GROQ_API_KEY` are
 * unset — the real state of this machine (the project notes: no Neon project exists and
 * none may be created).
 *
 * Covers the project plan §8.2 (first half: the phone works with the network off),
 * §8.4 (guest mode fully functional, both features degrade honestly) and §8.8 (both
 * viewports — the two Playwright projects run every one of these twice, at 390 px and
 * 1440 px).
 */

interface RouteCheck {
  path: string;
  heading: RegExp;
  /** `/more` is a phone/tablet hub; at desktop it deliberately redirects to `/profile`
   *  (src/features/more/MoreScreen.tsx). */
  desktopRedirect?: { path: string; heading: RegExp };
}

const APP_ROUTES: RouteCheck[] = [
  { path: '/', heading: /kcal (left|over)/ },
  { path: '/log', heading: /^Add food$/ },
  { path: '/scan', heading: /Estimate a meal from a photo/ },
  { path: '/progress', heading: /How it.s going/ },
  { path: '/plan', heading: /Plan it or scan it/ },
  { path: '/history', heading: /Your logged days/ },
  { path: '/profile', heading: /Your details and targets/ },
  { path: '/profile/weight', heading: /Weight log/ },
  {
    path: '/more',
    heading: /Everything else/,
    desktopRedirect: { path: '/profile', heading: /Your details and targets/ },
  },
  // `/account` is deliberately absent: on an unconfigured deployment it redirects home
  // rather than showing a dead form. That is asserted on its own, below.
];

/** Resolves what this project's viewport should actually land on for a route. */
function expectedFor(route: RouteCheck, projectName: string): { path: string; heading: RegExp } {
  if (projectName.startsWith('desktop') && route.desktopRedirect) return route.desktopRedirect;
  return { path: route.path, heading: route.heading };
}

test.describe('guest mode — the journey a user with no account actually takes', () => {
  test.beforeEach(async ({ page }) => {
    await stubUnconfiguredBackend(page);
  });

  test('onboard → log a food → refresh → the entry survives', async ({ page }) => {
    const errors = watchErrors(page);

    await onboard(page, { age: 30, heightCm: 180, weightKg: 80 });

    // Mifflin-St Jeor for a 30 y/o 180 cm 80 kg male, moderate (1.55), maintain. The
    // headline counts down what is left, so on a fresh day it states the whole target.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^2761 kcal left$/);

    await page.goto('/log');
    await logFoodFromSearch(page, 'banana', 'Banana, fruit, 89 kcal per 100 g');

    // The confirmation is a live region, so this asserts the write happened, not just
    // that a button was clickable.
    await expect(page.getByText(/^Banana added to /)).toBeVisible();
    const logged = page.getByRole('button', { name: /^Edit Banana$/ });
    await expect(logged).toBeVisible();

    // A hard reload — the app is re-booted from localStorage, not from React state.
    await page.reload();
    await expect(page.getByRole('button', { name: /^Edit Banana$/ })).toBeVisible();

    const persisted = (await readStorage(page, STORE_KEY)) as { version: number } | null;
    expect(persisted).not.toBeNull();
    expect(persisted?.version).toBe(3);

    // And it is on the dashboard total too, not only in the log list: 2761 − 105 = 2656.
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^2656 kcal left$/);

    expect(realErrors(errors)).toEqual([]);
  });

  test('every app route renders for a guest — no auth wall, no redirect to /auth/*', async ({ page }, testInfo) => {
    const errors = watchErrors(page);
    await onboard(page);

    for (const route of APP_ROUTES) {
      const expected = expectedFor(route, testInfo.project.name);
      await page.goto(route.path);
      await expect(page.getByRole('heading', { name: expected.heading }).first()).toBeVisible();
      // The acceptance criterion in prose: a guest is NEVER bounced to a sign-in screen.
      expect(new URL(page.url()).pathname).toBe(expected.path);
      expect(new URL(page.url()).pathname.startsWith('/auth/')).toBe(false);
    }

    expect(realErrors(errors)).toEqual([]);
  });

  test('no horizontal overflow on any route, at this project’s viewport', async ({ page }, testInfo) => {
    await onboard(page);

    for (const route of APP_ROUTES) {
      const expected = expectedFor(route, testInfo.project.name);
      await page.goto(route.path);
      await expect(page.getByRole('heading', { name: expected.heading }).first()).toBeVisible();
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(overflow.scrollWidth, `${route.path} overflows horizontally`).toBeLessThanOrEqual(
        overflow.innerWidth,
      );
    }
  });

  test('sync_unconfigured hides accounts instead of offering a button that can only 503', async ({ page }) => {
    await onboard(page);

    // `/more` on phone, `/profile` at desktop (the redirect above) — both carry the copy.
    await page.goto('/more');
    await expect(page.getByText(/Accounts aren't set up on this deployment/)).toBeVisible();
    await expect(page.getByRole('link', { name: /^Sign in$/ })).toHaveCount(0);

    // And the account route itself is not a dead form: it sends you back to the app.
    await page.goto('/account');
    await expect(page.getByRole('heading', { name: /kcal (left|over)/ })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/');
  });

  test('a food can be logged with the keyboard alone, with a visible focus indicator', async ({ page }) => {
    await onboard(page);
    await page.goto('/log');

    await page.getByLabel('Search foods').focus();
    await page.keyboard.type('banana');

    // Tab-walk to the result row. Bounded, so a broken tab order fails instead of hanging.
    let reached = false;
    for (let i = 0; i < 40 && !reached; i += 1) {
      await page.keyboard.press('Tab');
      reached =
        (await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '')) ===
        'Banana, fruit, 89 kcal per 100 g';
    }
    expect(reached, 'the food row was not reachable by keyboard').toBe(true);

    // The focused control must be visibly focused — not focus-invisible.
    const focusRing = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element) return null;
      const style = window.getComputedStyle(element);
      return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, boxShadow: style.boxShadow };
    });
    expect(
      (focusRing?.outlineStyle !== 'none' && focusRing?.outlineWidth !== '0px') ||
        (focusRing?.boxShadow !== 'none' && focusRing?.boxShadow !== ''),
      `no visible focus indicator: ${JSON.stringify(focusRing)}`,
    ).toBe(true);

    // Enter opens the portion step, and Enter on the add button logs it.
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Banana' })).toBeVisible();
    await page.getByRole('button', { name: /^Add to / }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Edit Banana' })).toBeVisible();
  });

  test('nothing auth-related is ever written to localStorage or sessionStorage', async ({ page }) => {
    await onboard(page);
    await page.goto('/log');

    const storage = await page.evaluate(() => ({
      local: Object.keys(window.localStorage),
      session: Object.keys(window.sessionStorage),
    }));

    // The store's own key is expected; a token/session/cookie mirror is not.
    expect(storage.session).toEqual([]);
    expect(storage.local.filter((key) => !key.startsWith('fitmacro.'))).toEqual([]);
    const serialised = await page.evaluate(() => JSON.stringify(window.localStorage));
    expect(serialised.toLowerCase()).not.toContain('token');
    expect(serialised.toLowerCase()).not.toContain('password');
  });
});

test.describe('guest mode on a CONFIGURED deployment — accounts offered, never enforced', () => {
  // MOCK-BACKED only in the narrow sense that `/api/auth/me` is made to answer `401`
  // instead of `503`; nothing else is faked. This is the "accounts exist but I haven't
  // signed in" state, which a local preview cannot otherwise reach.
  test.beforeEach(async ({ page }) => {
    await stubSignedOutBackend(page);
  });

  test('/account offers sign-up and sign-in, and the app still works without them', async ({ page }) => {
    const errors = watchErrors(page);
    await onboard(page);

    await page.goto('/account');
    await expect(page.getByText(/You're not signed in/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create account' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();

    // Walking away from the offer must leave the app fully usable.
    await page.goto('/log');
    await logFoodFromSearch(page, 'banana', 'Banana, fruit, 89 kcal per 100 g');
    await expect(page.getByRole('button', { name: /^Edit Banana$/ })).toBeVisible();

    expect(realErrors(errors)).toEqual([]);
  });
});
