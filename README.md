# CiteSync

**A citation consistency checker for academic documents.**

CiteSync analyzes `.docx` manuscripts offline and answers one question that matters before submission: do the in-text citations match the bibliography? It extracts every citation, reads the reference list, matches each pair, and flags inconsistencies — missing references, unused entries, ambiguous author–year matches, and broken numeric citations. The document never leaves the device.

## Status

The core TypeScript engine is functional and test-backed. It currently covers the **author–date** citation family; the product spec (including the numeric family and the CLI/Web/PWA interfaces) lives in the repository's product requirements document.

## What's inside

This is a TypeScript monorepo with two npm packages:

| Package | Purpose |
|---------|---------|
| `@citesync/document-model` | Type-only contract models shared across the engine: the in-memory document representation, citation records, reference entries, and match results. Pure types, no runtime code. |
| `@citesync/docx` | The engine. Parses untrusted `.docx` bytes into the document model, then runs bibliography detection, citation extraction, reference parsing, and citation↔reference matching on top. |

## Requirements

- **Node ≥ 24**
- **npm**

## Get started

```bash
npm install        # install workspace dependencies
npm run build      # compile all packages
npm test           # run the test suite (Vitest)
```

## Using the engine

`@citesync/docx` exposes one headline entry point, `parseDocument`, which turns untrusted `.docx` bytes into a fully analyzed `AcademicDocument`:

```ts
import { parseDocument } from '@citesync/docx';

const doc = parseDocument(buffer); // Uint8Array | ArrayBuffer
```

The individual analysis stages are exported separately so they can be composed or reused:

- `detectBibliography` — finds the bibliography section within a parsed document.
- `extractCitations` / `parseReferences` — pull citation occurrences and reference entries out of the model.
- `buildMatchMap` — scores every citation×reference pair and produces the final match states (`MATCHED`, `AMBIGUOUS`, `POSSIBLE_MISMATCH`, `MISSING_REFERENCE`, and others).

All stages are pure and deterministic, and failure-isolated: malformed content yields typed outcomes rather than exceptions.

## Security

The reader treats every `.docx` as untrusted input. It enforces hard resource bounds — a maximum entry count, a maximum decompressed size per entry and in total, a maximum XML length, and a processing-time budget — and surfaces typed errors instead of raw exceptions:

- `DocxReaderError` — base error type
- `NotADocxError` — not a ZIP package, missing required parts, or truncated
- `ZipBombError` — decompression exceeded the configured limit (declared or actual)
- `UnsupportedFormatError` — an unsupported package layout
- `ParseFailureError` — document content failed to parse

The bound constants and the low-level reader are exported for consumers who need tighter control.

## Tests & fixtures

The test suite runs against a corpus of committed `.docx` fixtures that exercise citation extraction, bibliography detection, match calibration, Vietnamese diacritics, and hostile inputs. The fixtures are generated deterministically — re-running the generator reproduces byte-identical files — and the expected extraction/match results for each fixture are asserted byte-stably by the suite, so a change to the parser, the model, or the matching policy surfaces immediately.

## License

The packages are currently marked `UNLICENSED`; licensing is not yet finalized for release.
