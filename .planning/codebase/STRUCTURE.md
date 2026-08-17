# CiteSync Project Structure

## Directory Tree

```
citesync/                              # Monorepo root (npm workspaces)
├── packages/
│   ├── document-model/                # @citesync/document-model — type-only contracts
│   ├── docx/                          # @citesync/docx — the DOCX analysis engine
│   ├── core/                          # @citesync/core — public lint surface
│   └── cli/                           # @citesync/cli — Node CLI interface
├── apps/
│   └── web/                           # @citesync/web — React 19 PWA
├── fixtures/                          # Test .docx fixtures organized by category
├── benchmarks/                        # Performance + quality benchmarking
├── docs/                              # Product documentation
├── scripts/                           # Fixture generators and utility scripts
├── .planning/                         # Planning documents
├── .agents/                           # Agent configuration
├── .claude/                           # Claude configuration
├── .commandcode/                      # CommandCode configuration
├── .artifacts/                        # Build artifacts
├── .bg-shell/                         # Background shell state
└── .git/                              # Git repository
```

---

## Root-Level Configuration Files

| File | Purpose |
|------|---------|
| `package.json` | Monorepo root — defines `workspaces: ["packages/*", "apps/*"]`, scripts (`build`, `test`, `benchmark:*`), devDependencies (TypeScript 5.9.3, Vitest 4.1.10, tsx, @types/node) |
| `tsconfig.json` | Project references root — references all 5 workspaces for `tsc -b` |
| `tsconfig.base.json` | Shared compiler options: ES2022, NodeNext modules, strict mode, `verbatimModuleSyntax`, composite + incremental |
| `vitest.config.ts` | Root Vitest config — `test.projects: ['packages/*', 'apps/*']` for per-workspace test scoping |
| `vitest.workspace.ts` | Deprecated compat shim — kept so tooling that reads it sees the same project list |
| `.gitignore` | Git ignore rules |
| `README.md` | Project readme |
| `BENCHMARKS.md` | Benchmark documentation |
| `skills-lock.json` | Skill lock file |
| `package-lock.json` | npm lock file |

---

## `packages/document-model/` — @citesync/document-model

**Purpose:** Type-only contracts — the PRD §15 internal document model. Zero runtime code; all exports are `export type`.

```
packages/document-model/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                       # Barrel — re-exports all types from types.ts
│   └── types.ts                       # 708 lines — all interfaces/types
├── tests/
│   └── types.test.ts                  # Compile-time contract verification
└── dist/                              # Compiled output (.d.ts only — no runtime JS)
```

**No dependencies** — this is the leaf of the dependency graph.

---

## `packages/docx/` — @citesync/docx

**Purpose:** The analysis engine — parse .docx, detect bibliography, extract citations, match references, run lint rules. The largest package.

```
packages/docx/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                       # Public barrel — 251 lines
│   ├── parse-document.ts             # parseDocument() entry point
│   ├── build-model.ts                # buildModel() — S01→S04 assembler
│   ├── extract.ts                    # extractCitations() + parseReferences()
│   ├── metadata.ts                   # extractCoreProperties()
│   ├── pipeline-stages.ts            # Frozen 5-stage contract
│   │
│   ├── zip/                          # Bounds-guarded ZIP handling
│   │   ├── reader.ts                 # safeZipRead()
│   │   ├── errors.ts                 # Typed error classes
│   │   └── limits.ts                 # Resource limit constants
│   │
│   ├── xml/                          # Low-level XML utilities
│   │   ├── tag-scan.ts              # readOpenTag(), scanTagEnd(), attrVal()
│   │   ├── entities.ts              # decodeEntities()
│   │   ├── ns.ts                    # localName()
│   │   └── source-position.ts       # Source position tracking
│   │
│   ├── parser/                       # OOXML structure parsers
│   │   ├── paragraph.ts             # scanParagraphs(), classifyParagraph()
│   │   ├── table.ts                 # scanTables(), tableToBlock()
│   │   ├── style.ts                 # loadStyleMap(), headingAnalysis()
│   │   ├── document.ts              # parseBody()
│   │   └── footnotes.ts             # scanNotePart()
│   │
│   ├── bibliography/                 # S02 bibliography detection
│   │   └── detect.ts                # detectBibliography()
│   │
│   ├── citations/                    # S03 citation extraction
│   │   ├── index.ts, candidate.ts, grammar.ts, confidence.ts, authors.ts, fields.ts
│   │   └── numeric/                 # Numeric citation handling
│   │       ├── index.ts, candidate.ts, grammar.ts, confidence.ts, map.ts
│   │
│   ├── references/                   # S03 bibliography reference parsing
│   │   ├── index.ts, split.ts, parse.ts, confidence.ts
│   │
│   ├── normalize/                    # §24/§25 name normalization
│   │   ├── index.ts, names.ts
│   │
│   ├── match/                        # S04 citation×reference matching
│   │   ├── index.ts, match.ts, score.ts, weights.ts
│   │
│   └── rules/                        # Lint rules (CS001–CS009) + registry
│       ├── types.ts, author-date.ts, numeric.ts, registry.ts, index.ts
│
├── tests/                            # 29 test files + golden fixtures
│   ├── golden/                       # Golden JSON snapshots
│   └── *.test.ts                     # Unit + integration + determinism tests
└── dist/
```

---

## `packages/core/` — @citesync/core

**Purpose:** The public lint surface — the single package consumed by CLI and web.

```
packages/core/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                       # Barrel — lintDocument, createRule, report builder
│   ├── lint-document.ts              # lintDocument()
│   ├── rules.ts                      # createRule()
│   └── cli-report.ts                 # buildCliReport(), serializeReport()
├── tests/
│   ├── core.test.ts, custom-rule.test.ts, deps.test.ts
│   ├── determinism.test.ts, isolation.test.ts
│   ├── pipeline-stages.test.ts, quality-gates.test.ts
│   ├── time-budget.test.ts, absence.test.ts
└── dist/
```

---

## `packages/cli/` — @citesync/cli

**Purpose:** The Node CLI — `npx citesync thesis.docx`.

```
packages/cli/
├── package.json                       # bin: { citesync: ./dist/index.js }
├── tsconfig.json
├── src/
│   ├── index.ts                       # runCli() + classifyError() + main guard
│   ├── args.ts                       # parseArgs()
│   ├── report.ts                     # buildReport(), buildErrorReport()
│   ├── render.ts                     # renderDefault(), renderDetailed()
│   └── json-schema.ts               # JSON report schema definition
├── tests/
│   ├── cli.test.ts, cli-contract.test.ts, cli-determinism.test.ts
│   ├── cli-report-core.test.ts, args.test.ts
└── dist/
```

---

## `apps/web/` — @citesync/web

**Purpose:** React 19 PWA — drag-drop analysis UI, runs `@citesync/core` in a Web Worker.

```
apps/web/
├── package.json
├── vite.config.ts, vitest.config.ts, playwright.config.ts
├── index.html
├── src/
│   ├── main.tsx, App.tsx, app.css, design-system.css
│   ├── components/                   # DropZone, IssueExplorer, DocumentView, etc.
│   ├── hooks/                        # useAnalyze, useResolutions
│   ├── worker/                       # lint.worker.ts, client.ts, protocol.ts
│   ├── explorer/                     # Issue explorer utilities
│   ├── export/                       # JSON + HTML export
│   ├── resolutions/                  # Resolution state management
│   └── i18n/                         # Internationalization (EN + VI)
├── tests/                            # 12 unit test files
├── e2e/                              # 6 Playwright e2e specs
└── dist/, dist-types/, dev-dist/
```

---

## `fixtures/` — Test Fixtures

```
fixtures/
├── README.md
├── minimal.docx
├── author-date/       # simple, et-al, multiple-authors, same-author-year, ambiguous, missing, vietnamese
├── numeric/           # basic, ranges, multiple-brackets, out-of-range, malformed
├── bibliography/      # en-references, vi-tai-lieu, style-position, ambiguous, no-bibliography
├── match/             # same-author-two-years, near-miss-author, near-miss-vietnamese, ambiguous-same-author-year
├── documents/docx/    # apa-like, harvard, plain-text
├── isolation/         # garbage-and-malformed
├── security/          # garbage, not-a-docx.zip, truncated, lying-bomb, zip-bomb, vba-sample
├── perf/              # 100-page.docx
└── quality/           # medium.docx
```

---

## `scripts/` — Utility Scripts

```
scripts/
├── make-fixtures.ts, make-isolation-fixture.ts
├── make-perf-fixtures.ts, make-quality-fixture.ts
├── gen-pwa-icons.mjs
├── fixture-ground-truth.ts, fixture-ground-truth-matches.ts
├── fixture-ground-truth-numeric.ts, fixture-ground-truth-quality.ts
└── fixture-ground-truth-references.ts
```

---

## `benchmarks/` — Benchmarking

```
benchmarks/
├── perf.ts, quality.ts, quality-metrics.ts
└── results/
```

---

## `docs/` — Documentation

```
docs/
├── CiteSync.dev — Product Requirements Document.md
└── UI-SPEC.md
```

---

## Test Organization

| Workspace | Test Dir | Framework | Files | Notes |
|-----------|----------|-----------|-------|-------|
| `document-model` | `tests/` | vitest | 1 | Compile-time contract checks |
| `docx` | `tests/` | vitest | 29 | Most comprehensive |
| `core` | `tests/` | vitest | 9 | Integration + contract + determinism |
| `cli` | `tests/` | vitest | 5 | Pipeline tests |
| `web` | `tests/` | vitest | 12 | Unit tests |
| `web` | `e2e/` | playwright | 6 | Browser e2e |

**Test naming:** `*.test.ts` (Vitest), `*.spec.ts` (Playwright).  
**Golden files:** `packages/docx/tests/golden/*.golden.json`.  
**Fixture-driven:** most tests load `.docx` fixtures from `fixtures/`.

---

## Build System

- **TypeScript 5.9.3** with project references (`tsc -b`)
- **Composite + incremental** builds across all workspaces
- **ESM only** (`"type": "module"` everywhere, `"module": "NodeNext"`)
- **`verbatimModuleSyntax`** enforced
- **Vitest 4.1.10** with per-workspace project scoping
- **Vite 8.2.1** for the web app
- **Playwright 1.62.1** for web app e2e tests
