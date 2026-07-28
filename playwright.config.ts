import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: 'list',
  // PWA 測試（tests/pwa.spec.ts）需要 http(s) 環境才能註冊 service worker，
  // file:// 不支援 SW；既有 8-bug 測試仍走 page.goto('file://...') 不受影響。
  webServer: {
    command: 'node scripts/dev-server.js',
    port: 8787,
    reuseExistingServer: !process.env.CI,
    timeout: 20000,
  },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:8787',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
