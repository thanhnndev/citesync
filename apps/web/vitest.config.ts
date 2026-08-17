import { defineConfig } from 'vitest/config';

// apps/web Vitest project config (resolved by the root `projects: ['apps/*']`
// glob — Vitest 4 picks up the per-directory config file).
//
// `include` is deliberately scoped to tests/**/*.test.ts + src/**/*.test.ts so
// Playwright e2e specs (apps/web/e2e/*.spec.ts, T6) are NEVER collected by
// vitest: they run under @playwright/test with its own runner, not vitest.
// src/**/*.test.ts covers the co-located i18n parity test
// (src/i18n/parity.test.ts, M005-S01-T4 — UI-SPEC §7.1).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
