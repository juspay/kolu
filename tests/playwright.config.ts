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
  webServer: {
    command: 'nix run ..#default',
    url: 'http://localhost:7681/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
