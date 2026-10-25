import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './auth-e2e',
  outputDir: 'auth-test-results',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  use: { baseURL: process.env.LUMI_AUTH_TEST_ORIGIN || 'http://localhost:15173', serviceWorkers: 'block', trace: 'off', locale: 'it-IT' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1050 } } },
    { name: 'android', use: { ...devices['Pixel 7'] } },
  ],
});
