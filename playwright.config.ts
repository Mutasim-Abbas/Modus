import { defineConfig, devices } from '@playwright/test';

// P6.1 (QA). Specs live in ./e2e and run against a LOCAL PREVIEW only — the
// publish hold (the project notes ground rule 1) means there is no deployed URL and none
// may be created. PLAYWRIGHT_BASE_URL stays supported so the same specs can be pointed
// at a deployed URL on publish day, but the default is the local `vite preview`.
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:4173';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // `list` so a run's real pass/fail counts are visible in the terminal; the HTML report
  // is still written but never auto-opens (it would block a non-interactive run).
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  // the project plan §8.8 asks for both sizes to be genuinely verified, and the project notes
  // pins the two widths every previous browser pass used: ~390 px and ~1440 px. The
  // device descriptors' own viewports (1280 and 412) are overridden so the numbers in
  // the report are the numbers in the plan.
  projects: [
    {
      name: 'desktop-1440',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile-390',
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
    },
  ],
  // Only spin up a local server when no explicit target (e.g. a deployed URL) is given.
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'npm run build && npm run preview -- --port 4173',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
