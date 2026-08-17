# Context — Synthesized from PRD + UI-SPEC

## Product Identity

- **Name:** CiteSync
- **Domain:** citesync.dev
- **Type:** Open-source offline-first academic utility
- **Tagline:** "ESLint for your citations."
- **License:** MIT
- **Status:** Product Definition v1.0

## Product Purpose

CiteSync checks whether citations inside an academic document correctly correspond to entries in the bibliography. It answers four questions:
1. Is every in-text citation represented in the bibliography?
2. Is every bibliography entry actually cited?
3. Are there ambiguous or inconsistent author-year references?
4. Are numeric citations correctly mapped to bibliography entries?

## Target Users

- University students (essays, assignments, capstone, graduation thesis)
- Postgraduate students (master's thesis, research reports, conference papers)
- Researchers (manuscript pre-submission, journal revision, reference cleanup)

## Core Workflow

```
Drop DOCX → Analyze locally → Extract citations → Extract bibliography → Match → Report inconsistencies
```

## Architecture Overview

- **Monorepo:** apps/web + packages/core|docx|citations|references|matcher|rules|report|cli + fixtures + benchmarks
- **Web app:** Vanilla React, Tailwind CSS v4, PWA, Web Worker for parsing
- **Core:** @citesync/core — framework-agnostic, no DOM dependency
- **Pipeline:** DOCX → AcademicDocument → Citations + References → Matching → Lint Rules → Report
- **State machine:** idle → analyzing → done | error (with recovery path for bibliography below-threshold)

## Current Implementation Status

- Existing components: DropZone, StageChecklist, ReportSummary, IssueExplorer, DocumentView, EvidencePanel, ResolutionPicker, ExportPanel, BibliographyRecoveryPanel
- 5 e2e specs covering smoke, explorer, resolution, export, performance
- Milestone M005 in progress — UI overhaul with design tokens and Tailwind v4
- Existing app.css has ~796 lines of component styles to migrate

## Citation Style Support

- **v0.1 families:** author-date, numeric
- **v0.1 styles:** APA-like, Harvard-like, IEEE-like, Vancouver-like
- **Future families:** author-only, note-based

## Roadmap Summary

- **v0.1:** Citation Linter (DOCX, author-date/numeric, offline PWA, HTML/JSON report)
- **v0.2:** Structured Academic Documents (Zotero/Mendeley support, footnotes/endnotes, CLI stabilization)
- **v0.3:** Academic Verification (Crossref/OpenAlex/DOI, optional online)
- **v0.4:** Additional Formats (Markdown, LaTeX, BibTeX, RIS, ODT)
- **v1.0:** Stable core + 500+ fixtures + documented benchmarks

## Quality Philosophy

> Prefer "I am uncertain" over "This is wrong" when evidence is insufficient.

- False-positive rate is the most critical product metric
- A linter that reports many fake problems becomes unusable
- Deterministic results required — same input = same output
