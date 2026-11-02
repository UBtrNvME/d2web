import { defineConfig } from '@playwright/test';

const browserName = process.env.D2WEB_BROWSER ?? 'chromium';

export default defineConfig({
  testDir: '.',
  // Anchored to this directory: Playwright matches absolute paths, and this checkout may itself live under a .claude/worktrees folder.
  testIgnore: new RegExp(`^${import.meta.dirname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(?:.*/)?(?:\\.claude|imports|node_modules)/`),
  testMatch: ['tests/browser/*.spec.mjs', 'tests/features/*.spec.mjs', 'research/browser/*.spec.mjs', 'packages/*/tests/browser/*.spec.mjs'],
  outputDir: './artifacts/playwright',
  snapshotPathTemplate: '{testDir}/../../artifacts/native-png/{testName}/{arg}{ext}',
  updateSnapshots: 'none',
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'artifacts/report', open: 'never' }]],
  use: {
    browserName, // chromium (default), firefox or webkit; see docs/browser-support.md
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    // Linux Chromium rounds glyph advances to whole pixels unless told otherwise; the measured text widths assume fractional advances as on macOS.
    ...(browserName === 'chromium' ? { launchOptions: { args: ['--font-render-hinting=none', '--enable-font-subpixel-positioning'] } } : {}),
  },
  expect: {
    toMatchSnapshot: { threshold: 0.1, maxDiffPixelRatio: 0.001 },
  },
});
