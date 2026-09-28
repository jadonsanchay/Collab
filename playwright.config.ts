import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end config. Deliberately small: this exists to cover the handful of
 * behaviours that only break when two real browsers talk to one real server,
 * which is exactly the part the unit and socket tests cannot reach.
 */
export default defineConfig({
  testDir: './e2e',
  // Dev-mode Next compiles routes on first request, so the first navigation in
  // a run is slow in a way later ones are not.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // One server, and tests that create rooms on it. Running them at once would
  // buy little and make failures harder to read.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    // `/hello` answers as soon as Express is up, without waiting for Next to
    // compile a page.
    url: 'http://localhost:3000/hello',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
