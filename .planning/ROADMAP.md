# ROADMAP.md — CiteSync

## Phase 1: Foundation & Core Engine

Build the monorepo structure and core parsing/matching engine.

**Packages:** @citesync/docx, @citesync/citations, @citesync/references, @citesync/matcher
**Key deliverables:**
- Monorepo setup (Turborepo/workspaces)
- DOCX/OOXML parser (document.xml, styles.xml, footnotes, endnotes)
- AcademicDocument model with source mapping
- Citation extraction (author-date + numeric families)
- Bibliography detection with confidence scoring
- Author normalization pipeline
- Matching engine with weighted scoring
- Benchmark dataset and fixture infrastructure

**Requirements:** R001–R009, R020–R021, R046–R051

---

## Phase 2: Lint Rules & Report

Implement all lint rules and report serialization.

**Packages:** @citesync/rules, @citesync/report
**Key deliverables:**
- CS001–CS010 lint rules
- CiteSyncRule interface
- Report summary with severity counts
- JSON + HTML export serialization
- .citesyncrc configuration support

**Requirements:** R010–R019, R048–R050, R053–R054

---

## Phase 3: Web Application — Core UI

Build the PWA shell and core analysis flow.

**Packages:** apps/web, @citesync/core
**Key deliverables:**
- Design token system (design-system.css)
- Tailwind CSS v4 integration with @theme
- Drop zone (drag/drop + click, validation)
- Stage checklist (5 pipeline stages)
- Report summary (severity counts + meta)
- Export panel (JSON + HTML download)
- Error panel with 6 error types
- Web Worker integration for parsing
- State machine: idle → analyzing → done | error

**Requirements:** R022–R029, R034, R039–R040, R045, R047

---

## Phase 4: Web Application — Explorer & Evidence

Build the issue explorer, document view, evidence panel, and resolution picker.

**Key deliverables:**
- Issue explorer (grouped by severity, click-to-source)
- Document view (highlight with severity tint, scroll-to-center)
- Evidence panel (explain why, possible references)
- Resolution picker (AMBIGUOUS citations, session-only)
- Bibliography recovery panel (below-threshold selection)
- FROZEN data-testid contract + 5 e2e specs

**Requirements:** R030–R033, R035, R041–R042, R052

---

## Phase 5: i18n, Onboarding & Polish

Add internationalization, onboarding screen, and final polish.

**Key deliverables:**
- Hand-rolled typed i18n (EN default + VI)
- i18n parity tests
- Onboarding screen (hero, privacy badges, how-it-works)
- PWA install prompt + offline indicator
- Accessibility audit (keyboard nav, focus states, screen-reader)
- Anonymous analytics integration

**Requirements:** R036–R038, R045, R052, R055–R056

---

## Phase 6: CLI & Developer Experience

Ship the CLI and polish developer experience.

**Packages:** packages/cli
**Key deliverables:**
- `npx citesync file.docx` CLI
- Format options: default, detailed, json
- Exit codes 0/1/2/3
- README with demo GIF, architecture, benchmarks
- Contributing guide with good-first-issue templates
- GitHub positioning (topics, description)

**Requirements:** R043–R044

---

## Future Milestones

### v0.2 — Structured Academic Documents
- Better Zotero/Mendeley support
- Footnotes + endnotes
- Superscript numeric citations
- Duplicate reference detection
- More bibliography formats
- CLI stabilization

### v0.3 — Academic Verification (optional online)
- Crossref verification
- OpenAlex verification
- DOI validation
- Reference metadata mismatch
- Core remains offline

### v0.4 — Additional Formats
- Markdown, LaTeX, BibTeX, RIS, ODT
- Reuse same internal document model

### v1.0 — Stable Release
- Stable DOCX parser + core API + rules API
- Reliable author-date + numeric matching
- 500+ public fixtures
- Documented benchmarks
- Web/PWA + CLI
