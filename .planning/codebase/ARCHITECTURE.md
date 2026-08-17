# CiteSync Architecture

## Overview

CiteSync is a TypeScript monorepo (npm workspaces) that provides a deterministic, offline-capable pipeline for checking citation consistency in academic `.docx` files. The system parses OOXML documents into a typed `AcademicDocument` model, detects bibliography sections, extracts citations (author-date and numeric), matches citations to bibliography entries, and surfaces consistency issues through a rule engine (CS001–CS009).

**Design principles:**
- **Deterministic (R008):** same `.docx` bytes always produce byte-identical output — no clock, no randomness, no platform dependence in the analysis path.
- **Pure pipeline stages:** every stage is a pure function of its input; side effects (I/O, progress callbacks) are observational only.
- **Failure isolation (§88):** malformed parts/blocks are recorded as issues, never thrown — a broken paragraph never crashes the full-document parse.
- **Conservative bias (§79):** when evidence is insufficient, the system surfaces uncertainty rather than guessing — "AMBIGUOUS" over a confident wrong "MATCHED".

---

## Monorepo Structure

```
citesync/
├── packages/
│   ├── document-model/   # Type-only contracts (§15 AcademicDocument model)
│   ├── docx/             # The engine: parse, extract, match, lint rules
│   ├── core/             # Public lint surface: lintDocument() + report builder
│   └── cli/              # CLI interface: npx citesync thesis.docx
├── apps/
│   └── web/              # React 19 PWA: drag-drop analysis UI
├── fixtures/             # Test .docx fixtures by category
├── benchmarks/           # Performance and quality benchmarking
├── docs/                 # PRD and UI spec
└── scripts/              # Fixture generators and utilities
```

---

## Package Dependency Graph

```
@citesync/document-model    (type-only — zero runtime code)
        ↑
@citesync/docx              (depends on document-model, fflate, fast-xml-parser)
        ↑
@citesync/core              (depends on docx, document-model)
        ↑
@citesync/cli               (depends on core only — never docx directly)
@citesync/web               (depends on core only — runs in Web Worker)
```

**Key rule (PRD §92/§93):** the CLI and web app consume `@citesync/core` ONLY — never the docx parser directly. This proves the core is portable across Node CLI and browser environments.

---

## Data Flow: .docx Bytes → AcademicDocument with Match Results

The pipeline has five stages (PRD §61), each observable via an `onStage` callback:

### Stage 1: `reading-document` (S01 — @citesync/docx)

```
.docx bytes (Uint8Array)
    │
    ├─ safeZipRead(bytes)        # Bounds-guarded ZIP decompression (fflate)
    │   ├─ Per-entry size cap (DOCX_ENTRY_MAX)
    │   ├─ Aggregate decompressed cap (TOTAL_DECOMPRESSED_MAX)
    │   ├─ Entry count cap (MAX_ENTRY_COUNT)
    │   └─ Processing time budget check
    │
    ├─ ZipParts (Map<path, Uint8Array>)
    │
    ├─ decodePart(parts, path)   # UTF-8 decode + XML_STRING_MAX enforcement
    │
    ├─ parseBody(documentXml)    # Scan w:p → paragraphs, w:tbl → tables
    │   ├─ classifyParagraph()   # Heading vs paragraph via style map
    │   ├─ paragraphToBlock()    # Entity-decoded, run-coalesced text + SourceLocation
    │   ├─ tableToBlock()        # Flattened cell text
    │   └─ loadStyleMap()        # word/styles.xml → heading style IDs
    │
    ├─ scanNotePart()            # footnotes.xml / endnotes.xml → note blocks
    ├─ extractCoreProperties()   # docProps/core.xml → DocumentMetadata
    ├─ scanSecurity()            # Macro detection, remote target recording
    │
    └─ AcademicDocument { metadata, blocks, sourceMap, citations: [] }
```

### Stage 2: `detecting-bibliography` (S02 — @citesync/docx)

```
AcademicDocument.blocks (body only)
    │
    ├─ detectBibliography(bodyBlocks)    # Weighted-signal detector
    │   ├─ Signal: headingText (0.35)    # Known bilingual terms
    │   ├─ Signal: headingStyle (0.15)   # Heading style classification
    │   ├─ Signal: position (0.20)       # Document-end proximity
    │   ├─ Signal: followingRefs (0.30)  # Reference-like paragraphs after heading
    │   │
    │   ├─ confidence ≥ 0.6 → 'detected' → doc.bibliography = section
    │   │       └─ parseReferences(doc) → entries + issues (§88 isolated)
    │   ├─ confidence > 0, < 0.6 → 'below-threshold' → candidates for ask-user
    │   └─ no signal → 'none' → bibliography stays undefined
    │
    └─ Or: bibliographyBlockIds (recovery) → bypass detector, build section directly
```

### Stage 3: `finding-citations` (S03 — @citesync/docx)

```
AcademicDocument (all blocks: body + footnotes + endnotes)
    │
    ├─ extractCitations(doc)
    │   ├─ For each block:
    │   │   ├─ detectStructuredCitationsInBlock()   # Zotero CSL_CITATION / Word CITATION fields
    │   │   ├─ detectCitationsInBlock()             # Plain-text author-date grammar
    │   │   └─ detectNumericCitationsInBlock()      # Bracketed numeric [1], [1,2], [1-4]
    │   │
    │   └─ mergeBlockOccurrences(structured, plain, numeric)
    │       # Priority: structured > author-date > numeric
    │       # Overlapping regions deduplicated; contiguous ids c0..cN
    │
    ├─ buildNumericIndexMap(doc)    # D016: bracket index → bibliography entry by position
    │
    └─ doc.citations populated; doc.numericIndexMap populated (if numeric)
```

### Stage 4: `matching-references` (S04 — @citesync/docx)

```
AcademicDocument (citations + bibliography.entries populated)
    │
    ├─ buildMatchMap(doc)
    │   ├─ For each citation × each entry:
    │   │   ├─ scoreCitationAgainstEntry()    # §25 tiered author matching + §26 weighted scoring
    │   │   │   ├─ Tier 1-2: exact/normalized name key
    │   │   │   ├─ Tier 3: diacritic-insensitive
    │   │   │   ├─ Tier 4: initials
    │   │   │   └─ Tier 5: fuzzy (no stored key)
    │   │   │
    │   │   └─ Scoring: author weight + year match + suffix + page + additional authors
    │   │
    │   ├─ Orchestrator assigns MatchState:
    │   │   ├─ MATCHED (score ≥ threshold, unique)
    │   │   ├─ MISSING_REFERENCE (no viable candidate)
    │   │   ├─ AMBIGUOUS (multiple above-threshold ties)
    │   │   └─ POSSIBLE_MISMATCH (score between mismatch and match thresholds)
    │   │
    │   └─ Entry status: CITED / UNUSED / AMBIGUOUS_USAGE
    │
    └─ doc.matchMap populated
```

### Stage 5: `running-checks` (S3 — @citesync/core)

```
AcademicDocument (complete with matchMap)
    │
    ├─ lintDocumentRules(doc, options)    # CS001–CS009 built-in registry
    │   ├─ CS001–CS005: author-date rules (segment: 'author-date')
    │   │   CS001: MISSING_REFERENCE — citation has no matching entry
    │   │   CS002: UNUSED_ENTRY — bibliography entry never cited
    │   │   CS003: AMBIGUOUS_MATCH — multiple candidates tie
    │   │   CS004: POSSIBLE_MISMATCH — weak match signal
    │   │   CS005: MISSING_YEAR_SUFFIX — same-author-same-year disambiguation
    │   │
    │   └─ CS006–CS009: numeric + parse rules (segment: 'numeric')
    │       CS006: PARSE_FAILURE — citation or reference grammar failed
    │       CS007: INVALID_NUMERIC — malformed bracket citation
    │       CS008: OUT_OF_RANGE_INDEX — bracket index > entries length
    │       CS009: UNUSED_ENTRY (numeric variant)
    │
    ├─ Custom rules (createRule) run alongside built-ins
    │
    └─ LintIssue[] sorted: severity → source position → ruleId → id
```

---

## Key Modules and Responsibilities

### `@citesync/document-model` (type-only)

**Zero runtime code.** Defines the PRD §15 internal document model contract — every interface used for handoff between pipeline stages:

| Type | Purpose |
|------|---------|
| `AcademicDocument` | Top-level document model — metadata, blocks, citations, bibliography, matchMap, numericIndexMap |
| `DocumentBlock` | One block of content (paragraph/heading/list/table/footnote/endnote) |
| `SourceLocation` | Character-precise location within a block (for click-to-source) |
| `CitationOccurrence` | §20 citation extraction result (author-date or numeric) |
| `ReferenceEntry` | §21 parsed bibliography entry |
| `MatchMap` / `CitationMatchResult` | §27 citation→reference match state map |
| `NumericIndexMap` | D016 numeric bracket→entry index bindings |
| `PersonName` / `PersonNameKey` | §24/§25 tiered name normalization keys |

### `@citesync/docx` (the engine)

The largest package — contains the complete analysis pipeline:

| Module | Purpose |
|--------|---------|
| `zip/reader.ts` | Bounds-guarded ZIP decompression (fflate) with size/count/budget caps |
| `zip/errors.ts` | Typed error family: `NotADocxError`, `ZipBombError`, `UnsupportedFormatError`, `TimeBudgetExceededError` |
| `zip/limits.ts` | Resource limit constants |
| `xml/` | Low-level XML tag scanning (no DOM parser — streaming scan for determinism) |
| `parser/paragraph.ts` | `w:p` → `DocumentBlock` with heading classification |
| `parser/table.ts` | `w:tbl` → flattened table block |
| `parser/style.ts` | `styles.xml` → style map for heading detection |
| `parser/document.ts` | Body parse: ordered blocks + source map |
| `parser/footnotes.ts` | Footnote/endnote scanning |
| `metadata.ts` | `docProps/core.xml` → `DocumentMetadata` |
| `build-model.ts` | **Assembler** — orchestrates the full S01→S04 pipeline |
| `bibliography/detect.ts` | S02 weighted-signal bibliography detector |
| `citations/` | S03 citation extraction (author-date grammar, structured fields, numeric brackets) |
| `references/` | S03 reference entry parsing (§21 grammar) |
| `normalize/` | §24/§25 diacritic-aware name normalization |
| `match/` | S04 citation×reference matcher (tier-ladder + weighted scorer) |
| `rules/` | CS001–CS009 rule implementations + registry + aggregator |
| `extract.ts` | S03 end-to-end extraction pipeline (citations + references) |
| `pipeline-stages.ts` | Frozen 5-stage contract (PRD §61) |

### `@citesync/core` (public lint surface)

The single public package for consumers (CLI and web):

| Module | Purpose |
|--------|---------|
| `lint-document.ts` | `lintDocument(input, options)` — accepts bytes or parsed doc; runs parse + rules |
| `cli-report.ts` | `buildCliReport()` / `serializeReport()` — canonical JSON report builder (browser-safe, zero Node builtins) |
| `rules.ts` | `createRule()` — contributor custom-rule factory with shape validation |

### `@citesync/cli` (CLI)

| Module | Purpose |
|--------|---------|
| `index.ts` | `runCli(argv)` — complete CLI pipeline (arg parse → read → lint → JSON → render) |
| `args.ts` | Argument parsing: `<file.docx>` + `-d`/`-j`/`-h`/`-v` flags |
| `report.ts` | CLI report adapter (delegates to core's `buildCliReport`) |
| `render.ts` | Pure renderers: `renderDefault` (severity table), `renderDetailed` (per-issue list) |
| `json-schema.ts` | JSON report schema definition |

**Exit codes:** 0 = clean, 1 = issues found, 2 = parse failure, 3 = unsupported format.

### `@citesync/web` (PWA)

| Module | Purpose |
|--------|---------|
| `worker/lint.worker.ts` | Web Worker — runs `lintDocument` from `@citesync/core` off the main thread |
| `worker/client.ts` | `runAnalysis()` — correlated single-flight worker client |
| `worker/protocol.ts` | Typed message protocol (AnalyzeRequest → stage/done/error) |
| `hooks/useAnalyze.ts` | React hook — file → worker → state machine |
| `hooks/useResolutions.ts` | Session-scoped resolution storage |
| `components/` | UI components: DropZone, IssueExplorer, DocumentView, EvidencePanel, ResolutionPicker, etc. |
| `export/` | JSON + HTML export (shared `serializeReport` from core) |
| `resolutions/` | User resolution overlay (AMBIGUOUS → chosen entry) |
| `i18n/` | Internationalization (EN + VI) |

---

## Entry Points and Public APIs

### `parseDocument(buffer)` — @citesync/docx
```typescript
function parseDocument(
  buffer: Uint8Array | ArrayBuffer,
  options?: { onStage?, bibliographyBlockIds?, timeBudget? }
): AcademicDocument
```
Untrusted `.docx` bytes → `AcademicDocument` (S01–S04 stages 1–4).

### `lintDocument(input, options)` — @citesync/core
```typescript
function lintDocument(
  input: AcademicDocument | Uint8Array | ArrayBuffer,
  options?: { enabled?, severityOverrides?, customRules?, onStage?, bibliographyBlockIds?, timeBudgetMs? }
): { issues: LintIssue[], doc: AcademicDocument, ruleIds: string[] }
```
The one-call lint surface — accepts bytes (parse + lint) or a pre-parsed document (lint only). Returns typed issues in deterministic order.

### `runCli(argv)` — @citesync/cli
```typescript
function runCli(argv: readonly string[]): { exitCode: ExitCode, stdout: string, stderr: string }
```
Complete CLI invocation — pure (no process I/O), testable.

### `runAnalysis(worker, bytes, fileName, options)` — @citesync/web
```typescript
function runAnalysis(
  worker: Worker, bytes: ArrayBuffer, fileName: string,
  options?: { onStage?, bibliographyBlockIds? }
): Promise<{ report: CliReport, doc: AcademicDocument, stages: PipelineStage[] }>
```
Single-flight worker analysis — correlated request/response, terminates worker on completion.

### `buildCliReport(doc, issues, ruleIds, options)` — @citesync/core
```typescript
function buildCliReport(
  doc: AcademicDocument, issues: LintIssue[], ruleIds: string[],
  options: { fileName: string, version: number }
): CliReport
```
Canonical JSON report builder — shared by CLI and web (single source of truth, D024).

---

## Design Patterns

### Pure/Deterministic Stages
Every stage is a pure function of its input. No clock reads, no randomness, no platform-specific behavior in the analysis path. The `onStage` callback is purely observational — it cannot alter the model. Same bytes → same output, byte-identically (R008).

### Failure Isolation (§88)
Malformed parts/blocks/entries are recorded as `ParseIssue` or `ReferenceParseIssue` arrays on `AcademicDocument` — never thrown. A broken paragraph produces partial text, not a crash. An unparseable bibliography entry is emitted with `parseConfidence: 0` and `raw` preserved.

### Conservative Bias (§79)
When evidence is insufficient, the system surfaces uncertainty: `AMBIGUOUS` instead of a confident wrong `MATCHED`. Below the bibliography detection threshold, candidates are returned for the user to choose (ask-user flow), never silently guessed.

### Typed Error Family
Errors are discriminated by a stable `name` property (`NotADocxError`, `ZipBombError`, `UnsupportedFormatError`, `TimeBudgetExceededError`). The CLI and web classify on this name — never on `instanceof` — so errors survive structured clone across the Worker boundary.

### Additive Extensions
`AcademicDocument` fields are additive: `matchMap`, `numericIndexMap`, `referenceParseIssues`, `security`, `parseIssues` are all optional. New analysis layers extend the model without breaking existing consumers.

### Ask-User Recovery (M003, PRD §63)
When bibliography detection yields `below-threshold`, the model carries candidates for the UI to present. The user selects a section, and `buildModel` re-runs with `bibliographyBlockIds` — the detector is bypassed, the section is built directly from the user's choice.

### Report Schema Stability (D020/D024)
The JSON report schema (`{ version, meta, issues, counts }`) is frozen. Pipeline stage names are internal contract only — they never appear in the report. The `buildCliReport` / `serializeReport` functions in `@citesync/core` are the single source of truth, shared by CLI and web.

---

## Cross-Cutting Concerns

### Security (R002/R019/R022, §87)
- Macro-bearing parts (`vbaProject.bin`, anything with "vba"/"macro" in path) are flagged but never decoded or executed.
- External relationship targets (remote URLs, UNC paths) are recorded but never fetched.
- ZIP bomb protection: per-entry, aggregate, entry count, XML string, and time budget caps.

### Determinism Verification
- `determinism.test.ts` in both `docx` and `core` test suites.
- `cli-determinism.test.ts` verifies byte-identical CLI JSON output across runs.
- Golden files in `docx/tests/golden/` pin exact JSON output for known inputs.

### Time Budget (R016)
A safety valve — `TimeBudgetExceededError` thrown at coarse pipeline checkpoints when the deadline passes. Default 30 seconds (far above the 3-second perf target). Enforced in `buildModel` (4 parse-stage boundaries) and `lintDocument` (3 lint checkpoints).
