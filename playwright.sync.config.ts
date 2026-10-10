import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/sync-e2e',
  workers: 1,
  timeout: 90000,
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results-sync',
  use: {
    baseURL: 'http://127.0.0.1:4176',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'allow',
  },
  projects: [
    { name: 'cloud-pwa', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: {
    command:
      'wrangler d1 migrations apply DB --local --config wrangler.local.jsonc --persist-to .local/sync-test-db && wrangler dev --config wrangler.local.jsonc --port 4176 --persist-to .local/sync-test-db',
    url: 'http://127.0.0.1:4176/api/sync/v1/status',
    reuseExistingServer: false,
    timeout: 60000,
  },
});
