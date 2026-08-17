# CiteSync — Testing Guide

How the CiteSync test infrastructure is organized, configured, and run.

---

## 1. Test Framework Setup

### Vitest 4.1.10 (Unit / Integration)

**Root config** (`vitest.config.ts`):
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    projects: ['packages/*', 'apps/*'],
  },
});
```

- Uses `test.projects` mechanism (Vitest 4 native).
- `vitest.workspace.ts` is a deprecated compat shim; root config is the source of truth.
- `apps/web/vitest.config.ts` scopes includes to `tests/**/*.test.ts` + `src/**/*.test.ts` (excludes Playwright e2e).

### Playwright 1.62.1 (E2E)

**Config** (`apps/web/playwright.config.ts`):
- Test directory: `e2e/`
- Chromium only
- Tests production build via `vite preview` (port 4173)
- CI-aware retries and reporter

---

## 2. Test File Organization

### Directory Layout

```
packages/
  document-model/tests/        # 1 file — compile-time contract checks
  docx/tests/                  # 29 files — unit + integration + golden
  core/tests/                  # 9 files — integration + contract + determinism
  cli/tests/                   # 5 files — pipeline tests
apps/
  web/tests/                   # 12 files — unit tests
  web/src/i18n/                # 1 file — i18n parity (co-located)
  web/e2e/                     # 6 files — Playwright e2e specs
```

### Naming Patterns
- **Test files**: `kebab-case.test.ts` (Vitest) / `kebab-case.spec.ts` (Playwright)
- **Test descriptions**: descriptive, often including task/ticket references
- **No `__tests__` directories** — flat `tests/` at package root

---

## 3. Test Fixtures

### Fixture Corpus (`fixtures/`)

Fixtures are committed `.docx` binaries organized by feature area:

```
fixtures/
  minimal.docx                    # Golden anchor: 1 heading + 2 body paragraphs
  author-date/                    # simple, et-al, multiple-authors, same-author-year, missing, ambiguous, vietnamese
  documents/docx/                 # apa-like, harvard, plain-text
  bibliography/                   # en-references, vi-tai-lieu, style-position, no-bibliography, ambiguous
  match/                          # same-author-two-years, ambiguous-same-author-year, near-miss-*
  numeric/                        # basic, ranges, multiple-brackets, out-of-range, malformed
  security/                       # garbage, truncated, not-a-docx.zip, zip-bomb, lying-bomb, vba-sample
  perf/                           # 100-page.docx (53K words, 260 entries, ~2960 citations)
  isolation/                      # garbage-and-malformed.docx
  quality/                        # medium.docx
```

### Fixture Generation
Deterministic scripts in `scripts/`:

| Script | Purpose |
|--------|---------|
| `make-fixtures.ts` | Main corpus |
| `make-perf-fixture.ts` | 100-page performance artifact |
| `make-isolation-fixture.ts` | Failure-isolation demo |
| `make-quality-fixture.ts` | Quality-corpus fixture |

**Generation rules**: all use `fflate` + hand-authored OOXML, fully deterministic (pinned timestamps, fixed entry order), self-check: build twice, assert byte-identical. Run via: `npx tsx scripts/make-fixtures.ts`

### Ground Truth Manifests

| File | Content |
|------|---------|
| `fixture-ground-truth.ts` | `KNOWN_CITATIONS`, `KNOWN_REFERENCES` per fixture |
| `fixture-ground-truth-matches.ts` | `KNOWN_MATCHES` per fixture match states |
| `fixture-ground-truth-numeric.ts` | `KNOWN_NUMERIC_INDEX_MAP` per fixture |
| `fixture-ground-truth-quality.ts` | Quality fixture manifest |

### Golden Files

`packages/docx/tests/golden/*.golden.json` — pinned JSON snapshots for determinism verification. Updated only with reviewed diffs.

### Fixture Loading Pattern

```ts
const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
const MINIMAL = readFileSync(join(FIXTURES_DIR, 'minimal.docx'));
```

---

## 4. Test Patterns

### Structure: describe/it

```ts
describe('safeZipRead — valid .docx', () => {
  it('returns a bounded parts Map with the required parts byte-faithful', () => {
    const docx = minimalDocx();
    const reader = safeZipRead(docx);
    expect(reader.parts).toBeInstanceOf(Map);
  });
});
```

### Assertion Style
Primary assertions: `toBe`, `toEqual`, `toContain`, `toMatch`, `toHaveLength`, `toBeInstanceOf`, `toBeDefined`, `toThrow`, `expect.unreachable()`, `expect.arrayContaining()`.

### Determinism Tests (R008)
Nearly every test file includes determinism assertions:

```ts
const first = parseDocument(bytes);
const second = parseDocument(bytes);
expect(second).toEqual(first);
expect(JSON.stringify(first)).toBe(JSON.stringify(second));
```

### Ground-Truth Driven Tests
Tests iterate over committed ground-truth tables:

```ts
for (const rel of Object.keys(KNOWN_MATCHES)) {
  const doc = parseDocument(readFileSync(join(FIXTURES_DIR, rel)));
  expect(matchMap).toEqual(KNOWN_MATCHES[rel]);
}
```

### Error Testing
Typed errors, never string-matching:

```ts
expect(() => safeZipRead(garbage)).toThrow(NotADocxError);
const e = new ZipBombError('details');
expect(e.name).toBe('ZipBombError');
```

---

## 5. Coverage Expectations

### No Explicit Coverage Config
No `coverage` configuration in any `vitest.config.ts`. Relies on quality gates instead.

### R017 Quality Gates

| Metric | Target | Measured |
|--------|--------|----------|
| Detection precision | ≥ 0.98 | 1.0000 |
| Recall | ≥ 0.95 | 1.0000 |
| Matching precision | ≥ 0.97 | 1.0000 |
| False-positive issues | 0 | 0 |

Enforced by `packages/core/tests/quality-gates.test.ts` which recomputes metrics on every run.

### Corpus Size
- **28 fixtures** in quality corpus
- **435 expected citation raws** (95 hand-authored + 340 generated)
- **47 expected issues** (CS001: 35, CS002: 1, CS004: 3, CS005: 2, CS006: 1, CS007: 2, CS008: 3)

---

## 6. E2E Test Setup (apps/web)

### Playwright Configuration
- Chromium only, `data-testid` selectors
- Tests production build served by `vite preview` on port 4173

### E2E Spec Coverage

| Spec | What it proves |
|------|---------------|
| `smoke.spec.ts` | Happy path, offline SW precache, error panel |
| `explorer.spec.ts` | Issue explorer navigation |
| `export.spec.ts` | JSON/HTML export flow |
| `resolution.spec.ts` | AMBIGUOUS resolution picker |
| `perf.spec.ts` | Large document (100-page) completes |
| `error-states.spec.ts` | All typed error states render friendly messages |

---

## 7. Benchmark Setup

### Performance Benchmark (`benchmarks/perf.ts`)
- Fixture: `fixtures/perf/100-page.docx` (53K words, 260 entries, ~2960 citations)
- 3 warm-up + 8 measured runs
- Per-stage timing via `onStage` callback
- Gate: 3000 ms
- Output: `benchmarks/results/perf-100-page-<label>.json`

### Quality Benchmark (`benchmarks/quality.ts`)
- Runs `lintDocument` over full committed corpus
- Computes detection precision/recall, matching precision, false-positive rate
- Shared module: `benchmarks/quality-metrics.ts`
- Gate: non-zero exit when gate fails (CI-gated)
- Output: `benchmarks/results/quality-<label>.json`

---

## 8. How to Run Tests

```bash
# Install + build
npm install
npm run build

# All unit/integration tests
npm test

# Watch mode
npm run test:watch

# Specific package
npx vitest run --project packages/docx
npx vitest run --project packages/core

# Specific file
npx vitest run packages/docx/tests/zip.test.ts

# E2E tests (requires build first)
npm run test:e2e
cd apps/web && npx playwright test --headed

# Typecheck
npm run typecheck

# Benchmarks
npm run benchmark:perf -- --label run
npm run benchmark:quality

# Regenerate fixtures
npx tsx scripts/make-fixtures.ts
```

### Expected CI Pipeline
1. `npm install`
2. `npm run build` (tsc -b)
3. `npm run typecheck`
4. `npm test` (includes quality gates)
5. `npm run test:e2e`
