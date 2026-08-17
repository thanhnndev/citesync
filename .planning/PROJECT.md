# PROJECT.md — CiteSync

## Identity

- **Name:** CiteSync
- **Domain:** citesync.dev
- **Type:** Open-source offline-first academic utility
- **License:** MIT
- **Tagline:** "ESLint for your citations."

## Purpose

CiteSync is an offline-first citation consistency linter for DOCX academic documents. It checks whether citations inside an academic document correctly correspond to entries in the bibliography, surfacing missing references, unused references, ambiguous matches, and numeric citation errors — all with evidence and source mapping.

## Goals

- Provide deterministic, reproducible citation consistency checks
- Keep all document processing local — no upload, no account, no cloud
- Produce actionable lint reports with evidence and source mapping
- Support author-date and numeric citation families
- Ship as installable PWA + reusable TypeScript packages + CLI

## Non-Goals

- PDF support (v0.1)
- Google Docs / Microsoft Word extensions
- Reference existence verification (DOI/Crossref/OpenAlex)
- LLM parsing or AI writing
- Plagiarism detection or grammar checking
- Citation style formatting or bibliography generation
- Automatic document editing
- User accounts, cloud storage, collaboration

## Architecture

```
citesync/
  apps/web/          — React PWA (Tailwind CSS v4, Web Worker parsing)
  packages/core/     — Framework-agnostic lint pipeline
  packages/docx/     — DOCX/OOXML parser
  packages/citations/— Citation detection + normalization
  packages/references/ — Bibliography detection + parsing
  packages/matcher/  — Citation-reference matching engine
  packages/rules/    — Lint rules CS001–CS010
  packages/report/   — Report serialization (JSON, HTML)
  packages/cli/      — CLI interface
  fixtures/          — Reproducible test fixtures
  benchmarks/        — Performance benchmarks
```

## Decisions

<!-- LOCKED — from PRD (highest precedence) -->

- **D001** Offline-first — core parser MUST NOT depend on remote resources
- **D002** Deterministic-first — same document + same version = same result
- **D003** Privacy by default — no document upload, no storage, no account
- **D004** No LLM in core — engine MUST NOT use generative models
- **D005** DOCX-only for v0.1 — PDF excluded
- **D006** CiteSync is a linter, not a writing assistant
- **D007** Monorepo: apps/web + 8 packages + fixtures + benchmarks
- **D008** @citesync/core independent of React, DOM, server, UI
- **D009** UI never directly parses documents — always via core API
- **D010** Evidence never LLM-generated
- **D011** Severity model: ERROR, WARNING, AMBIGUOUS, INFO
- **D012** Citation families: author-date + numeric
- **D013** Structured citation metadata > text heuristics
- **D014** Bibliography detection returns confidence; never silently guesses
- **D015** Tailwind CSS v4 for styling (UI-SPEC §7.3, overrides PRD §94)
- **D016** Hand-rolled typed i18n dictionary EN–VI (UI-SPEC §7.1)
- **D017** FROZEN data-testid contract — 23 patterns (UI-SPEC §7.2)
- **D018** Evidence/issue text EN FROZEN — never translated

## Constraints

- No server, database, WASM, ML models, API keys, vendor AI services
- Source files < 400 lines (tests exempt)
- 100-page DOCX < 3 seconds
- Desktop-first (Chrome, Edge, Firefox, Safari)
- v0.1 UI English only; parser supports English + Vietnamese
- DOCX max 50 MB recommended
- Untrusted input: no macros, no scripts, no remote URLs, zip bomb protection

## Success Metric

> **False-positive rate** — a linter that reports many fake problems becomes unusable. Prefer "I am uncertain" over "This is wrong" when evidence is insufficient. (PRD §79)

## References

- PRD: `docs/CiteSync.dev — Product Requirements Document.md`
- UI-SPEC: `docs/UI-SPEC.md`
- Intel: `.planning/intel/`
