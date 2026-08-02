import { expect, type Page } from '@playwright/test';

/**
 * Shared helpers for the P6.1 end-to-end specs.
 *
 * Two rules these helpers exist to enforce:
 *
 * 1. **Every spec runs against a real local preview build** (`npm run build` +
 *    `vite preview`, wired up in `playwright.config.ts`). There is no deployed URL and
 *    none may be created — the project notes ground rule 1, the publish hold.
 * 2. **Nothing is faked silently.** A local preview has no serverless functions at all,
 *    so `/api/*` would otherwise return `index.html`. Each spec states explicitly which
 *    backend it is talking to by installing one of the stubs below, and any spec whose
 *    result depends on a stubbed backend is named `MOCK-BACKED` in its title.
 */

export const STORE_KEY = 'fitmacro.v2';
export const SYNC_KEY = 'fitmacro.sync.v1';

/* ------------------------------------------------------------------ *
 * Console / page-error capture                                        *
 * ------------------------------------------------------------------ */

export interface ErrorLog {
  /** `console.error` / `console.warn` text and uncaught exceptions, in order. */
  readonly messages: string[];
}

/**
 * Attaches console + pageerror listeners. Must be called before the first `goto`, so
 * the log can never be stale from an earlier page load.
 */
export function watchErrors(page: Page): ErrorLog {
  const messages: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      messages.push(`console.${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    messages.push(`pageerror: ${error.message}`);
  });
  return { messages };
}

/**
 * Console noise that is not a defect in the app:
 * - the preview server has no `/api/*` functions, so an unstubbed fetch logs a network
 *   failure that the app is *designed* to survive (that is the point of guest mode);
 * - Chromium logs a 404 for any icon the manifest references but the fixture omits.
 */
const IGNORABLE = [
  'Failed to load resource',
  'net::ERR_',
  'the server responded with a status of',
];

export function realErrors(log: ErrorLog): string[] {
  return log.messages.filter((message) => !IGNORABLE.some((pattern) => message.includes(pattern)));
}

/* ------------------------------------------------------------------ *
 * localStorage seeding                                                *
 * ------------------------------------------------------------------ */

/** Writes a value into localStorage before any app script runs. */
export async function seedStorage(page: Page, key: string, value: unknown): Promise<void> {
  await page.addInitScript(
    ({ k, v }: { k: string; v: string }) => {
      window.localStorage.setItem(k, v);
    },
    { k: key, v: JSON.stringify(value) },
  );
}

export async function readStorage(page: Page, key: string): Promise<unknown> {
  const raw = await page.evaluate((k: string) => window.localStorage.getItem(k), key);
  return raw === null ? null : (JSON.parse(raw) as unknown);
}

/* ------------------------------------------------------------------ *
 * Backend stubs — every one is stated, never implied                  *
 * ------------------------------------------------------------------ */

/**
 * The honest local-preview baseline: no `DATABASE_URL`, no `SESSION_PEPPER`, no
 * `ANTHROPIC_API_KEY`, so every backend feature reports itself unconfigured exactly as
 * `api/` does when those env vars are missing (docs/API.md, "Errors common to every
 * route"). This is not a mock of a working backend — it is the real shape of the
 * deployment the specs actually run against.
 */
export async function stubUnconfiguredBackend(page: Page): Promise<void> {
  await page.route('**/api/analyze-meal', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'ai_unconfigured' }) }),
  );
  await page.route('**/api/auth/**', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'sync_unconfigured' }) }),
  );
  await page.route('**/api/sync/**', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'sync_unconfigured' }) }),
  );
}

/** A signed-out but *configured* deployment: `/api/auth/me` answers 401, not 503. */
export async function stubSignedOutBackend(page: Page): Promise<void> {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'unauthorized' }) }),
  );
}

/* ------------------------------------------------------------------ *
 * Journeys                                                            *
 * ------------------------------------------------------------------ */

export interface OnboardOptions {
  age?: number;
  heightCm?: number;
  weightKg?: number;
}

/** Completes onboarding and asserts the dashboard actually took over. */
export async function onboard(page: Page, options: OnboardOptions = {}): Promise<void> {
  const { age = 30, heightCm = 180, weightKg = 80 } = options;

  await page.goto('/onboarding');
  await expect(page.getByRole('heading', { name: 'Let’s set your targets' })).toBeVisible();

  await page.getByLabel('Age').fill(String(age));
  await page.getByLabel('Height').fill(String(heightCm));
  await page.getByLabel('Weight').fill(String(weightKg));

  await page.getByRole('button', { name: 'Start tracking' }).click();
  await expect(page).toHaveURL(/\/$/);
}

/**
 * Logs a food-database food from `/log` on whatever day the screen is currently
 * showing, accepting the default portion and the suggested meal.
 */
export async function logFoodFromSearch(page: Page, query: string, accessibleName: string): Promise<void> {
  await page.getByLabel('Search foods').fill(query);
  await page.getByRole('button', { name: accessibleName }).click();
  await page.getByRole('button', { name: /^Add to / }).click();
}
