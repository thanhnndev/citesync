# CiteSync — Codebase Conventions

Source-derived conventions observed across the CiteSync TypeScript monorepo.
Every rule below is backed by patterns found in actual source files.

---

## 1. Code Style and Formatting

### Indentation and Punctuation
- **2-space indentation** everywhere (source, tests, configs).
- **Single quotes** for string literals.
- **Semicolons** always terminated.
- **Trailing commas** in multi-line object/array/function parameter lists.
- **No Prettier or ESLint config** found — style enforced by convention.

### Line Length
- Soft 100–120 character guideline.

### Formatting Patterns
- Section separators: `// ---------------------------------------------------------------------------` (75 dashes).
- One export per line in barrel `index.ts` files.
- `as const satisfies readonly T[]` pattern for frozen constant arrays.

---

## 2. Naming Conventions

### Files and Directories
| Kind | Convention | Examples |
|------|-----------|----------|
| Source files | `kebab-case.ts` | `parse-document.ts`, `build-model.ts` |
| Barrel files | `index.ts` | Every subdirectory has one |
| Test files | `kebab-case.test.ts` | `smoke.test.ts`, `determinism.test.ts` |
| E2E specs | `kebab-case.spec.ts` | `smoke.spec.ts`, `export.spec.ts` |
| Golden files | `kebab-case.golden.json` | `minimal.golden.json` |

### Functions and Variables
| Kind | Convention | Examples |
|------|-----------|----------|
| Functions | `camelCase` | `parseDocument`, `detectBibliography` |
| Predicate functions | `is`/`has` prefix | `isDocument`, `isReferenceEntryBlock` |
| Local variables | `camelCase` | `blockOrder`, `budget` |

### Types and Interfaces
| Kind | Convention | Examples |
|------|-----------|----------|
| Interfaces | `PascalCase` | `AcademicDocument`, `LintIssue` |
| Type aliases | `PascalCase` | `RuleSeverity`, `ExitCode` |
| Union types | `PascalCase` | `MatchState`, `EntryMatchStatus` |

### Constants
| Kind | Convention | Examples |
|------|-----------|----------|
| Module-level | `SCREAMING_SNAKE_CASE` | `DOCX_ENTRY_MAX`, `MATCH_THRESHOLD` |
| Frozen arrays | `SCREAMING_SNAKE_CASE` | `RULE_SEVERITIES`, `PIPELINE_STAGES` |
| Error names | `PascalCase` string | `'NotADocxError'` |

### Enum-like String Unions
- `UPPER_SNAKE_CASE` for machine-readable states: `'MATCHED'`, `'MISSING_REFERENCE'`, `'AMBIGUOUS'`
- `kebab-case` for human-readable identifiers: `'reading-document'`, `'author-date'`

### Rule IDs
- Built-in: `CS001`–`CS009`
- Custom/test: `CS900`+ range

---

## 3. Import Conventions

### Import Ordering
```
// 1. Node builtins (node: prefix)
// 2. Third-party packages
// 3. Workspace packages (@citesync/*)
// 4. Relative imports (always with .js extension)
```

### Type-Only Imports
- **Mandatory** — enforced by `verbatimModuleSyntax: true`.
- Always `import type { ... }` for type-only usage.

### Relative vs Package Imports
- **Workspace packages**: always by npm package name (`@citesync/document-model`).
- **Intra-package**: always relative with `.js` extension (`'./build-model.js'`).

### Barrel Exports
- Every subdirectory with multiple modules has an `index.ts` barrel.
- Named re-exports: `export { fn } from './module.js'`.
- Type re-exports explicit: `export type { Type } from './module.js'`.

---

## 4. TypeScript Conventions

### Strict Mode Configuration
All packages extend `tsconfig.base.json` which enforces:

| Flag | Value |
|------|-------|
| `strict` | `true` |
| `noUncheckedIndexedAccess` | `true` |
| `noImplicitOverride` | `true` |
| `noFallthroughCasesInSwitch` | `true` |
| `verbatimModuleSyntax` | `true` |
| `isolatedModules` | `true` |
| `composite` | `true` |

### Type Patterns
- **Discriminated unions** for multi-state results.
- **`readonly` arrays and maps** for frozen constants.
- **`as const`** for literal types.
- **`satisfies`** for type-checked constant declarations.
- **Optional chaining + nullish coalescing** for safe access.
- **Compile-time contract checks** via `_`-prefixed unused variables.

---

## 5. Error Handling Patterns

### Typed Error Hierarchy
```
DocxReaderError (abstract)
├── NotADocxError
├── ZipBombError
├── UnsupportedFormatError
├── ParseFailureError
└── TimeBudgetExceededError
```

### Error Design Rules
- Stable `name` discriminator (survives minification).
- Dual message: `message` (short) + `detail` (diagnostic).
- Branching on `name`, never `instanceof`.

### Failure Isolation (§88)
- Malformed content yields typed outcomes, not exceptions.
- `ParseIssue[]` for malformed parts; `ReferenceParseIssue[]` for bad entries.

### Conservative Bias (§79)
- Prefer "uncertain" over "wrong" when evidence is insufficient.
- Invalid config values ignored deterministically.

---

## 6. Documentation Conventions

### File Headers
Every source file starts with a JSDoc block comment referencing PRD sections.

### Function/Interface Documentation
Every exported symbol has JSDoc with `@param`, `@returns`, `@throws`.

### Internal References
- PRD section numbers: `§15`, `§17`, `§21`, `§27`, `§79`, `§88`
- Requirement IDs: `R008`, `R009`, `R010`, `R015`, `R016`, `R017`
- Decision IDs: `D009`, `D012`, `D016`, `D020`, `D024`, `D025`
- Task IDs: `S01-T3`, `M002-S03-T1`
- Memory IDs: `MEM007`, `MEM037`, `MEM047`

---

## 7. Git Conventions

- `.gitignore` excludes: `node_modules/`, `dist/`, `dist-types/`, `coverage/`, `test-results/`, `playwright-report/`, `.env`
- Committed artifacts: fixture `.docx`, golden `.json`, benchmark result `.json`
- Write-once discipline (R017): benchmark results never overwritten without `--force`
- Task/branch references in source and commits (`M001`, `S01`, `T1`, `D012`)
- `.gsd/` directory indicates GSD workflow tool usage
