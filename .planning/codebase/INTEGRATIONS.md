# CiteSync — Integrations & Dependencies

## External Service Integrations

**None.** CiteSync is fully offline-capable. The web app is a Progressive Web App (PWA) with a service worker that precaches all assets. There are no external API calls, no cloud services, no analytics, and no external font CDN — all fonts are self-hosted via `@fontsource`.

## Internal Package Dependency Graph

```
@citesync/document-model   (leaf — type-only contracts, zero dependencies)
         ▲
         │ types
         ├── @citesync/docx        (parse engine: fflate + fast-xml-parser)
         │         ▲
         │         │ parse + rules
         │         ├── @citesync/core       (public lint API: lintDocument, createRule, CLI report)
         │         │         ▲
         │         │         │
         │         │         ├── @citesync/cli   (CLI binary: npx citesync thesis.docx)
         │         │         │
         │         │         └── @citesync/web   (PWA: React 19, runs core in Web Worker)
         │         │
         │         └── (re-exports document-model types for downstream)
         │
         └── (consumed by docx and core for type contracts)
```

### TypeScript Project References

The build graph (`tsc -b`) mirrors the runtime dependency graph:

| Package | References |
|---|---|
| `packages/document-model` | (none — leaf) |
| `packages/docx` | `packages/document-model` |
| `packages/core` | `packages/document-model`, `packages/docx` |
| `packages/cli` | `packages/core` |
| `apps/web` | `packages/core` |

### Package Roles

| Package | Role | Consumes |
|---|---|---|
| `@citesync/document-model` | Type-only contracts (PRD §15): `AcademicDocument`, `DocumentBlock`, `SourceLocation`, citation/reference types | Nothing (leaf) |
| `@citesync/docx` | DOCX parsing engine: zip decompression → XML parse → blocks + source map + citations + references + match map + rules (CS001–CS009) | `document-model` types |
| `@citesync/core` | Public lint surface: `lintDocument()`, `createRule()`, `buildCliReport()`, pipeline stages | `docx` (parser + rules), `document-model` (types) |
| `@citesync/cli` | CLI binary (`npx citesync`): arg parsing → read file → `lintDocument()` → JSON/table/detailed output with exit codes | `core` only (never docx directly) |
| `@citesync/web` | Offline PWA: React 19 app running `@citesync/core` lint inside a Web Worker, with Tailwind CSS styling | `core` only (never docx directly) |

## Build Pipeline & Toolchain

### Build Commands

| Command | Scope | Tool |
|---|---|---|
| `npm run build` (root) | All packages + apps | `tsc -b` (TypeScript project references, composite + incremental) |
| `npm run build` (web app) | Web app only | `tsc -b && vite build` |
| `npm run typecheck` (root) | All packages + apps | `tsc -b --pretty false` |

### Build Order (enforced by tsc project references)

1. `packages/document-model` — type declarations only
2. `packages/docx` — depends on document-model
3. `packages/core` — depends on document-model + docx
4. `packages/cli` — depends on core
5. `apps/web` — depends on core (parallel to cli)

### Web App Build Pipeline

1. `tsc -b` — emits type declarations to `dist-types/`
2. `vite build` — bundles React app with:
   - `@vitejs/plugin-react` — JSX transform + Fast Refresh
   - `@tailwindcss/vite` — Tailwind CSS v4 compilation
   - `vite-plugin-pwa` — Workbox service worker generation (`generateSW` strategy, 5MB cache limit)

### Testing Pipeline

| Command | Scope | Runner |
|---|---|---|
| `npm test` (root) | All packages + apps (unit/integration) | Vitest 4.1.10 |
| `npm run test:watch` (root) | Watch mode | Vitest |
| `npm run test:e2e` (root) | Web app E2E | Playwright 1.62.1 (Chromium, production build) |

### Benchmark Scripts

| Command | Script | Purpose |
|---|---|---|
| `npm run benchmark:perf` | `benchmarks/perf.ts` | Performance benchmarks (via `tsx`) |
| `npm run benchmark:quality` | `benchmarks/quality.ts` | Quality/accuracy benchmarks (via `tsx`) |

### Fixture Generation Scripts

Located in `scripts/`:
- `make-fixtures.ts`, `make-quality-fixture.ts`, `make-perf-fixture.ts`, `make-isolation-fixture.ts` — generate test fixtures
- `fixture-ground-truth*.ts` — ground-truth data for quality benchmarks
- `gen-pwa-icons.mjs` — deterministic PWA icon generation

## CI/CD Setup

**No CI/CD configuration found.** There is no `.github/workflows/` directory, no Dockerfile, no `.gitlab-ci.yml`, and no other CI configuration in the repository. The Playwright config does include CI-aware settings (`process.env.CI` for retries and reporter selection), indicating CI integration is anticipated but not yet configured.

## External APIs & Services

**None.** CiteSync operates entirely locally:
- DOCX files are read from the local filesystem (CLI) or via browser File API (web app)
- All analysis runs client-side: the web app runs `@citesync/core` inside a Web Worker
- The PWA caches all assets for offline use
- No network requests are made during analysis

## Resource Limits & Security Boundaries

The DOCX parser enforces bounds guards on untrusted input:

| Constant | Purpose |
|---|---|
| `DOCX_ENTRY_MAX` | Maximum size for a single ZIP entry |
| `TOTAL_DECOMPRESSED_MAX` | Maximum total decompressed size (zip-bomb protection) |
| `XML_STRING_MAX` | Maximum XML string length |
| `MAX_ENTRY_COUNT` | Maximum number of ZIP entries |
| `PROCESSING_TIME_BUDGET_MS` | Time budget for the entire analysis pipeline |

Typed error classes (`NotADocxError`, `ZipBombError`, `UnsupportedFormatError`, `ParseFailureError`, `TimeBudgetExceededError`) provide stable `name` discriminators for programmatic error handling across package boundaries.
