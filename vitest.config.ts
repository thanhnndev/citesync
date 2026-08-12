import { defineConfig } from 'vitest/config';

// Root Vitest config. Projects (one per npm workspace package) are declared
// here via `test.projects` — the non-deprecated mechanism since Vitest 3.2.
// vitest.workspace.ts mirrors the same list for tooling that still reads it.
export default defineConfig({
  test: {
    environment: 'node',
    projects: ['packages/*'],
  },
});
