/**
 * T6 — Playwright e2e config for the offline PWA shell.
 *
 * Serves the PRODUCTION build via `vite preview` (port 4173, Vite's default)
 * so the e2e exercises the real dist/ output: SW precache (vite-plugin-pwa
 * generateSW), the worker chunk bundling @citesync/core, and the frozen
 * data-testid contract. devOptions SW is deliberately NOT used — the offline
 * reload test needs a real service worker serving precached assets.
 *
 * Notes:
 * - testDir 'e2e' is disjoint from vitest's `tests/**` include (set in
 *   vitest.config.ts at T1), so the two runners never collect each other's
 *   files.
 * - chromium only: the slice's browser UAT target. Cache at
 *   ~/.cache/ms-playwright already holds the needed revision; `npx
 *   playwright install chromium` is the fallback if a fresh machine lacks it.
 * - `webServer` starts preview once per run (reuseExistingServer outside CI
 *   lets a dev's own preview serve the tests).
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  // e2e specs are slow-ish (real browser + SW + worker); keep retries only
  // in CI so local runs stay fast and deterministic.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
