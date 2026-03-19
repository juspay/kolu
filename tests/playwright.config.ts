import { defineConfig, devices } from '@playwright/test';

const ciArgs = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--headless=new',
];

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:7681',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: process.env.CI ? ciArgs : [],
        },
      },
    },
  ],
  // PLAYWRIGHT_REUSE_SERVER=1 skips server startup (for `just test-dev`)
  webServer: process.env.PLAYWRIGHT_REUSE_SERVER ? undefined : {
    command: 'nix run ..#default',
    url: 'http://localhost:7681/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
