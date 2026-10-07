import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * End-to-end smoke test against the production build served by the real API
 * (embedded PostgreSQL in a throwaway directory, AI disabled).
 */
const PORT = 3100;
const dbDir = join(mkdtempSync(join(tmpdir(), 'ft-e2e-')), 'db');

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium-iphone',
      testIgnore: /ios-layout/,
      use: { ...devices['iPhone 13'], browserName: 'chromium' },
    },
    {
      // Real WebKit engine for iOS-specific layout checks (`playwright install webkit`).
      name: 'webkit-iphone',
      testMatch: /ios-layout/,
      use: { ...devices['iPhone 15'] },
    },
  ],
  webServer: {
    command: 'pnpm build && pnpm --filter @ft/api exec tsx src/dev.ts',
    url: `http://localhost:${PORT}/health`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      PORT: String(PORT),
      DEV_DB_PORT: '54399',
      DEV_DB_DIR: dbDir,
      DEV_DB_FRESH: '1',
      DEV_NO_WATCH: '1',
      WEB_DIST: join(import.meta.dirname, 'dist'),
      ALLOW_REGISTRATION: 'true',
      AI_ENABLED: 'false',
      DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:54399/fleisch_teufel',
    },
  },
});
