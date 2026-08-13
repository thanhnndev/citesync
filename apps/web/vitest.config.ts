import { defineConfig } from 'vitest/config';

// apps/web Vitest project config (resolved by the root `projects: ['apps/*']`
// glob — Vitest 4 picks up the per-directory config file).
//
// `include` is deliberately scoped to tests/**/*.test.ts so Playwright e2e
// specs (apps/web/e2e/*.spec.ts, T6) are NEVER collected by vitest: they run
// under @playwright/test with its own runner, not vitest.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
