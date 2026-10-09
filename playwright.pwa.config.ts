import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/pwa',
  workers: 1,
  timeout: 60000,
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results-pwa',
  use: {
    baseURL: 'http://127.0.0.1:4175',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'allow',
  },
  projects: [
    { name: 'pwa-mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: {
    command: 'node tests/pwa/server.mjs',
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: false,
  },
});
