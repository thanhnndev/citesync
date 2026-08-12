# CiteSync

> **ESLint for your citations.**
>
> Check citations before you submit. Your manuscript never leaves your device.

CiteSync is an **offline-first** citation consistency checker for academic documents. It reads a `.docx`, extracts the in-text citations and the bibliography, matches every citation against the reference list, and reports inconsistencies.

The product answers four primary questions:

1. Is every in-text citation represented in the bibliography?
2. Is every bibliography entry actually cited in the document?
3. Are there ambiguous or inconsistent author–year references?
4. Are numeric citations correctly mapped to bibliography entries?

## The pipeline

```text
Document
   ↓
Analyze locally
   ↓
Extract citations
   ↓
Extract bibliography
   ↓
Match
   ↓
Report inconsistencies
```

## Repository layout

This is a TypeScript npm-workspaces monorepo built on Node ≥ 24.

| Package | Path | Purpose |
|---------|------|---------|
| `@citesync/document-model` | `packages/document-model` | The shared `AcademicDocument` / `DocumentBlock` / `SourceLocation` contract types (PRD §15/§21), consumed by the reader and every downstream slice. Type-only, erased at runtime. |
| `@citesync/docx` | `packages/docx` | Bounds-guarded OOXML (`.docx`) reader and the full analysis engine: zip + XML parse into `AcademicDocument`, bibliography detection, citation extraction, reference parsing, and citation↔entry matching. |

### Core flow

- **`parseDocument(buffer)`** — the S01 entry point. Takes untrusted `.docx` bytes and returns an `AcademicDocument` with byte-faithful source offsets, metadata, and a source map. Decompression, XML parsing, and block parsing are all bounds-guarded against untrusted input.
- **`extractCitations` / `parseReferences`** — end-to-end extraction of §20 citation occurrences (over body + footnotes + endnotes, with structured-field identity overlaid) and §21 reference entries from the detected bibliography span.
- **`detectBibliography`** — the weighted-signal bibliography detector (S02) behind `AcademicDocument.bibliography`.
- **`buildMatchMap`** — the S04 match-map orchestration: per-citation × per-entry scoring with tiered name matching, culminating in match states such as `MATCHED`, `AMBIGUOUS`, `POSSIBLE_MISMATCH`, and `MISSING_REFERENCE`.

Every stage is **pure and deterministic** (pinned fixtures, no clock/randomness), and failure-isolated: a bad entry or list never throws (PRD §88).

## Getting started

Requirements: **Node ≥ 24** and npm.

```bash
npm install        # install workspace deps
npm run build      # tsc -b project-wide
npm run typecheck  # tsc -b --pretty false
npm test           # vitest run (383 tests across the workspace)
```

Test watch mode: `npm run test:watch`.

### Using the engine

```ts
import { parseDocument } from '@citesync/docx';
import { buildMatchMap } from '@citesync/docx';

const doc = parseDocument(buffer); // untrusted .docx bytes -> AcademicDocument
const matchMap = buildMatchMap(doc); // citation <-> entry match states
```

## Security model

The reader treats every `.docx` as untrusted input. It enforces hard resource bounds — max entries, max decompressed bytes per entry and in total, max XML string length, and a processing-time budget — and surfaces typed, programmatic errors instead of raw exceptions:

- `DocxReaderError` — base error type
- `NotADocxError` — not a ZIP / missing required parts / truncated package
- `ZipBombError` — an entry exceeds the configured decompression limit (declared or actual)
- `UnsupportedFormatError` — an unsupported package layout
- `ParseFailureError` — content failed to parse

Limit constants (`DOCX_ENTRY_MAX`, `TOTAL_DECOMPRESSED_MAX`, `XML_STRING_MAX`, `MAX_ENTRY_COUNT`, `PROCESSING_TIME_BUDGET_MS`) are exported for tuning.

## Fixtures & ground truth

Committed `.docx` binaries in [`fixtures/`](./fixtures/README.md) are authored deterministically by [`scripts/make-fixtures.ts`](./scripts/make-fixtures.ts) (fflate + hand-authored OOXML, never the reader). They cover author-date citations, Vietnamese diacritics, bibliography detection edge cases, match calibration, and security samples.

Single sources of truth:
- citation/reference extraction tables — [`scripts/fixture-ground-truth.ts`](./scripts/fixture-ground-truth.ts)
- match-state tables — [`scripts/fixture-ground-truth-matches.ts`](./scripts/fixture-ground-truth-matches.ts)

See [`fixtures/README.md`](./fixtures/README.md) for the full corpus catalog.

## Status

**Product Definition v1.0 / Primary Release v0.1.** The core engine (M001: offline author–date citation linter — read, extract, detect bibliography, parse references, match) is complete and test-backed. See [`CiteSync.dev — Product Requirements Document.md`](./CiteSync.dev%20%E2%80%94%20Product%20Requirements%20Document.md) for the authoritative product spec.
