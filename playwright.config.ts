import { defineConfig, devices } from '@playwright/test';

const PORT = 5198;

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // The other two engines only run the determinism test, which is the one that can differ.
    { name: 'firefox', use: { ...devices['Desktop Firefox'], trace: 'off' }, testMatch: 'determinism.spec.ts' },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, testMatch: 'determinism.spec.ts' },
  ],
});
