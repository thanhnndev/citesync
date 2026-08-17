# CiteSync — Technology Stack

## Language & Runtime

| Aspect | Detail |
|---|---|
| Language | TypeScript 5.9.3 |
| Runtime | Node.js ≥ 24.0.0 |
| Target | ES2022 |
| Module system | ESM (`"type": "module"` in every package.json) |
| TypeScript module resolution | `NodeNext` (packages), `Bundler` (web app) |
| Strict mode | Enabled (`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`) |
| Module syntax enforcement | `verbatimModuleSyntax` — `import type` required for type-only imports |

## Package Manager & Monorepo

| Aspect | Detail |
|---|---|
| Package manager | npm (lockfile v3) |
| Workspace strategy | npm workspaces — `"workspaces": ["packages/*", "apps/*"]` |
| Packages | `@citesync/document-model`, `@citesync/docx`, `@citesync/core`, `@citesync/cli` |
| Apps | `@citesync/web` |
| TypeScript project references | Yes — `tsc -b` (composite + incremental builds) via root `tsconfig.json` referencing all five workspaces |

## Build System

| Aspect | Detail |
|---|---|
| Compiler | `tsc` (TypeScript compiler) — build via `tsc -b` |
| Build tool | Vite 8.2.1 (web app only, via `@vitejs/plugin-react` 6.0.5) |
| CSS framework | Tailwind CSS v4.3.3 via `@tailwindcss/vite` plugin |
| PWA | `vite-plugin-pwa` ^1.3.0 (Workbox-based, `generateSW` strategy) |
| Output | Each package emits to `dist/`; web app emits to `dist/` (Vite) + `dist-types/` (tsc) |
| Declarations | `declaration: true`, `declarationMap: true`, `sourceMap: true` in base tsconfig |

## Test Frameworks

| Framework | Version | Scope |
|---|---|---|
| Vitest | 4.1.10 | Unit + integration tests across all packages and apps |
| Playwright | 1.62.1 (`@playwright/test`) | E2E tests for the web app only (`apps/web/e2e/`) |

**Vitest configuration:**
- Root `vitest.config.ts` defines `test.projects: ['packages/*', 'apps/*']`
- `vitest.workspace.ts` is a compat shim (deprecated file kept for tooling)
- `apps/web/vitest.config.ts` scopes includes to `tests/**/*.test.ts` + `src/**/*.test.ts` so Playwright e2e specs are excluded
- Default environment: `node`

**Playwright configuration** (`apps/web/playwright.config.ts`):
- Test directory: `e2e/`
- Browser: Chromium only
- Serves production build via `vite preview` (port 4173)
- CI-aware retries and reporter (`github` in CI, `list` locally)

## Root devDependencies

| Package | Version | Purpose |
|---|---|---|
| `typescript` | 5.9.3 | TypeScript compiler |
| `vitest` | 4.1.10 | Test runner |
| `@types/node` | ^24.13.3 | Node.js type definitions |
| `tsx` | ^4.23.12 | TypeScript execution for benchmarks/scripts |

## Production Dependencies by Package

### `@citesync/document-model`
None (type-only package — zero runtime dependencies).

### `@citesync/docx`
| Package | Version | Purpose |
|---|---|---|
| `@citesync/document-model` | 0.1.0 | Document model type contracts |
| `fast-xml-parser` | 5.10.1 | OOXML (WordprocessingML) XML parsing |
| `fflate` | 0.8.3 | ZIP decompression (bounds-guarded .docx reading) |

### `@citesync/core`
| Package | Version | Purpose |
|---|---|---|
| `@citesync/docx` | 0.1.0 | DOCX parser + rule implementations |
| `@citesync/document-model` | 0.1.0 | Document model type contracts |

### `@citesync/cli`
| Package | Version | Purpose |
|---|---|---|
| `@citesync/core` | 0.1.0 | Public lint API (`lintDocument`) |

### `@citesync/web`
| Package | Version | Purpose |
|---|---|---|
| `@citesync/core` | 0.1.0 | Public lint API (run inside Web Worker) |
| `react` | 19.2.8 | UI framework |
| `react-dom` | 19.2.8 | React DOM renderer |
| `tailwindcss` | ^4.3.3 | Utility-first CSS framework |
| `@tailwindcss/vite` | ^4.3.3 | Vite integration for Tailwind |
| `@fontsource/be-vietnam-pro` | ^5.3.0 | Local font (offline-first PWA) |
| `@fontsource/fraunces` | ^5.3.0 | Local font (offline-first PWA) |
| `@fontsource/jetbrains-mono` | ^5.3.0 | Local font (offline-first PWA) |

## Web App devDependencies

| Package | Version | Purpose |
|---|---|---|
| `vite` | 8.2.1 | Build tool / dev server |
| `@vitejs/plugin-react` | 6.0.5 | React Fast Refresh + JSX transform |
| `@playwright/test` | 1.62.1 | E2E testing |
| `vite-plugin-pwa` | ^1.3.0 | PWA generation (Workbox) |
| `@types/react` | ^19.2.18 | React type definitions |
| `@types/react-dom` | ^19.2.4 | React DOM type definitions |

## Key Libraries Summary

- **fflate** — Pure-JS ZIP decompression for .docx file reading with bounds guards (zip-bomb protection)
- **fast-xml-parser** — Fast XML parser for extracting WordprocessingML content from docx internals
- **React 19** — UI framework for the web app (runs analysis in a Web Worker)
- **Tailwind CSS v4** — Utility-first styling via `@tailwindcss/vite` plugin
- **Workbox** (via vite-plugin-pwa) — Service worker generation for offline PWA capability
- **@fontsource** — Self-hosted web fonts (Fraunces, Be Vietnam Pro, JetBrains Mono) for offline-first operation

## Module System

Every package uses native ESM:
- `"type": "module"` in all package.json files
- `module: "NodeNext"` / `moduleResolution: "NodeNext"` for Node packages
- `module: "ESNext"` / `moduleResolution: "Bundler"` for the Vite web app
- `exports` field with `types` + `import` conditions in all publishable packages
- `verbatimModuleSyntax: true` enforces explicit `import type` for type-only imports
