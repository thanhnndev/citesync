import { defineWorkspace } from 'vitest/config';

// Deprecated-but-functional compat shim (Vitest >=3.2 prefers `test.projects`
// in vitest.config.ts). Kept so the plan's expected file exists and any tooling
// that still resolves vitest.workspace.ts sees the same package projects.
// If this ever double-runs tests next to test.projects, delete this file —
// vitest.config.ts remains the single source of truth.
export default defineWorkspace(['packages/*']);
