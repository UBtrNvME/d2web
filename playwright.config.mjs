import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: ['tests/browser/*.spec.mjs', 'tests/features/*.spec.mjs', 'research/browser/*.spec.mjs', 'packages/*/tests/browser/*.spec.mjs'],
  outputDir: './artifacts/playwright',
  snapshotPathTemplate: '{testDir}/../../artifacts/native-png/{testName}/{arg}{ext}',
  updateSnapshots: 'none',
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'artifacts/report', open: 'never' }]],
  use: {
    browserName: process.env.D2WEB_BROWSER ?? 'chromium', // chromium (default), firefox or webkit; see docs/browser-support.md
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    reducedMotion: 'reduce',
  },
  expect: {
    toMatchSnapshot: { threshold: 0.1, maxDiffPixelRatio: 0.001 },
  },
});
