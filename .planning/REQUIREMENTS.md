# REQUIREMENTS.md — CiteSync

## Core Engine

### Parsing Pipeline

| ID | Requirement | Source | Priority |
|----|-------------|--------|----------|
| R001 | Parse DOCX as OOXML (document.xml, styles.xml, footnotes.xml, endnotes.xml) | PRD §14 | v0.1 |
| R002 | Extract citations — detect candidates, parse author-date/numeric, normalize | PRD §18–20, §23 | v0.1 |
| R003 | Extract bibliography — detect heading, split entries, parse metadata, normalize | PRD §17, §21 | v0.1 |
| R004 | Source mapping — every citation/reference retains SourceLocation | PRD §16 | v0.1 |
| R005 | Internal AcademicDocument model (blocks, bibliography, citations, sourceMap) | PRD §15 | v0.1 |

### Normalization & Matching

| ID | Requirement | Source | Priority |
|----|-------------|--------|----------|
| R006 | Author normalization: case folding, Unicode, punctuation, diacritics, initials | PRD §24 | v0.1 |
| R007 | Name matching tiers: exact → normalized → diacritic-insensitive → initial → fuzzy | PRD §25 | v0.1 |
| R008 | Matching engine with weighted scoring (first-author 0.40, year 0.35, others 0.20) | PRD §26 | v0.1 |
| R009 | Match states: MATCHED, MISSING_REFERENCE, AMBIGUOUS, POSSIBLE_MISMATCH | PRD §27 | v0.1 |

### Lint Rules

| ID | Rule | Severity | Description | Source |
|----|------|----------|-------------|--------|
| R010 | CS001 | ERROR | Missing Reference — citation exists, no bibliography entry | PRD §28 |
| R011 | CS002 | WARNING | Unused Reference — bibliography entry never cited | PRD §29 |
| R012 | CS003 | WARNING | Year Mismatch — citation year ≠ bibliography year | PRD §30 |
| R013 | CS004 | AMBIGUOUS | Ambiguous Author-Date — multiple matching entries | PRD §31 |
| R014 | CS005 | WARNING | Missing Year Suffix — same author/year needs a/b | PRD §32 |
| R015 | CS006 | ERROR | Invalid Numeric Citation — number exceeds bibliography count | PRD §33 |
| R016 | CS007 | ERROR | Missing Numeric Reference — gap in citation range | PRD §34 |
| R017 | CS008 | WARNING | Unused Numeric Reference — never cited | PRD §35 |
| R018 | CS009 | WARNING | Duplicate Reference — high identity similarity (conservative) | PRD §36 |
| R019 | CS010 | INFO | Citation Parse Failure — citation-like structure unparseable | PRD §37 |

### Security & Reliability

| ID | Requirement | Source | Priority |
|----|-------------|--------|----------|
| R020 | No macros, no embedded execution, no remote URLs, zip bomb protection, XML limits, time limits | PRD §87 | v0.1 |
| R021 | Failure isolation — malformed citation MUST NOT crash analysis | PRD §88 | v0.1 |

## Web Application

### Core UI

| ID | Requirement | Source | Priority |
|----|-------------|--------|----------|
| R022 | Drop .docx → analyze locally → show report | PRD §9 | v0.1 |
| R023 | State machine: idle → analyzing → done \| error (with recovery) | UI-SPEC §3 | v0.1 |
| R024 | Design token system (color, typography, spacing, radius, shadow, z-index) | UI-SPEC §1 | v0.1 |
| R025 | Desktop-first responsive: 2-col explorer ≥768px, 1-col below | UI-SPEC §2.1 | v0.1 |
| R026 | Severity colors with text labels, never color-only | UI-SPEC §1.1.1 | v0.1 |

### Screens

| ID | Screen | Source | Priority |
|----|--------|--------|----------|
| R027 | Drop zone — drag/drop + click, invalid file inline error | UI-SPEC §5.1 | v0.1 |
| R028 | Stage checklist — 5 pipeline stages with ✓/●/○ markers | UI-SPEC §5.2 | v0.1 |
| R029 | Report summary — severity counts + meta line | UI-SPEC §5.3 | v0.1 |
| R030 | Issue explorer — grouped by severity, click-to-source | UI-SPEC §5.4 | v0.1 |
| R031 | Document view — highlight citations with severity tint | UI-SPEC §5.4 | v0.1 |
| R032 | Evidence panel — explain why issue exists, possible references | UI-SPEC §5.5 | v0.1 |
| R033 | Resolution picker — AMBIGUOUS citations, session-only | UI-SPEC §5.6 | v0.1 |
| R034 | Export panel — JSON + HTML download | UI-SPEC §5.7 | v0.1 |
| R035 | Bibliography recovery — below-threshold user selection | UI-SPEC §5.8 | v0.1 |
| R036 | Onboarding — hero, privacy badges, how-it-works, CTA | UI-SPEC §5.9 | v0.1 |

### i18n

| ID | Requirement | Source | Priority |
|----|-------------|--------|----------|
| R037 | Hand-rolled typed i18n — EN default + VI, parity test | UI-SPEC §7.1 | v0.1 |
| R038 | Evidence/issue text EN FROZEN — never translated | UI-SPEC §7.1 | v0.1 |

### Error Handling

| ID | Requirement | Source | Priority |
|----|-------------|--------|----------|
| R039 | 6 error types: NotADocx, ZipBomb, ParseFailure, UnsupportedFormat, TimeBudgetExceeded, generic | UI-SPEC §3.3 | v0.1 |
| R040 | Error panel role=alert, stages preserved after error | UI-SPEC §4.2 | v0.1 |

### Testing

| ID | Requirement | Source | Priority |
|----|-------------|--------|----------|
| R041 | FROZEN data-testid contract — 23 patterns | UI-SPEC §7.2 | v0.1 |
| R042 | 5 e2e specs: smoke, explorer, resolution, export, perf | UI-SPEC Appendix A | v0.1 |

## CLI

| ID | Requirement | Source | Priority |
|----|-------------|--------|----------|
| R043 | `npx citesync file.docx` with --format default/detailed/json | PRD §49 | v0.1 |
| R044 | Exit codes: 0/1/2/3 | PRD §50 | v0.1 |

## PWA

| ID | Requirement | Source | Priority |
|----|-------------|--------|----------|
| R045 | Installable PWA, offline shell, cached parser, no network after install | PRD §57 | v0.1 |

## Performance

| ID | Requirement | Source | Priority |
|----|-------------|--------|----------|
| R046 | 100-page DOCX < 3 seconds on typical laptop | PRD §55 | v0.1 |
| R047 | Web Worker for heavy parsing, UI stays responsive | PRD §12 | v0.1 |

## Quality Targets

| ID | Metric | Target | Source |
|----|--------|--------|--------|
| R048 | Citation detection precision | ≥ 98% | PRD §78 |
| R049 | Citation detection recall | ≥ 95% | PRD §78 |
| R050 | Reference matching precision | ≥ 97% | PRD §78 |
| R051 | Benchmark dataset with reproducible fixtures | Required | PRD §74–76 |

## Accessibility

| ID | Requirement | Source | Priority |
|----|-------------|--------|----------|
| R052 | Keyboard navigation, focus states, screen-reader labels, non-color severity | PRD §89 | v0.1 |

## Extensibility

| ID | Requirement | Source | Priority |
|----|-------------|--------|----------|
| R053 | CiteSyncRule interface for community rules | PRD §52 | v0.1 |
| R054 | .citesyncrc configuration file | PRD §51 | v0.1 |

## Analytics

| ID | Requirement | Source | Priority |
|----|-------------|--------|----------|
| R055 | Anonymous metrics: app opened, analysis started/completed, parser version, doc size, duration, issue count | PRD §10 | v0.1 |
| R056 | Analytics MUST NOT include: doc text, citations, author names, ref titles, file names, bibliography | PRD §10 | v0.1 |

## Session State

| ID | Requirement | Source | Priority |
|----|-------------|--------|----------|
| R057 | Session state is local-only; document disappears when user clears session; no persistence required | PRD §44 | v0.1 |

## Documentation

| ID | Requirement | Source | Priority |
|----|-------------|--------|----------|
| R058 | README shows product immediately with recommended section sequence (hero, description, try online, install CLI, what it catches, privacy, styles, architecture, benchmarks, contributing) | PRD §81 | v0.1 |
