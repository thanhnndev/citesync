# Requirements — Synthesized from PRD + UI-SPEC

## Core Engine (from PRD)

### Parsing
- R001: Parse DOCX as OOXML — word/document.xml, styles.xml, footnotes.xml, endnotes.xml (PRD §14)
- R002: Extract citations — detect candidates, parse author-date/numeric, normalize (PRD §18–20, §23)
- R003: Extract bibliography — detect heading, split entries, parse metadata, normalize (PRD §17, §21)
- R004: Source mapping — every citation/reference retains original location with SourceLocation (PRD §16)
- R005: Internal document model AcademicDocument with blocks, bibliography, citations, sourceMap (PRD §15)

### Normalization
- R006: Author normalization — case folding, Unicode, punctuation, diacritics, initials (PRD §24)
- R007: Name matching tiers — exact → normalized → diacritic-insensitive → initial-compatible → fuzzy (PRD §25)

### Matching
- R008: Matching engine with weighted scoring (first-author 0.40, year 0.35, additional-authors 0.15, suffix 0.05, other 0.05) (PRD §26)
- R009: Match results: MATCHED, MISSING_REFERENCE, AMBIGUOUS, POSSIBLE_MISMATCH + CITED, UNUSED, AMBIGUOUS_USAGE (PRD §27)

### Lint Rules
- R010: CS001 — Missing Reference (ERROR) (PRD §28)
- R011: CS002 — Unused Reference (WARNING) (PRD §29)
- R012: CS003 — Year Mismatch (WARNING) (PRD §30)
- R013: CS004 — Ambiguous Author-Date Match (AMBIGUOUS) (PRD §31)
- R014: CS005 — Missing Year Suffix (WARNING) (PRD §32)
- R015: CS006 — Invalid Numeric Citation (ERROR) (PRD §33)
- R016: CS007 — Missing Numeric Reference (ERROR) (PRD §34)
- R017: CS008 — Unused Numeric Reference (WARNING) (PRD §35)
- R018: CS009 — Duplicate Reference (WARNING, conservative) (PRD §36)
- R019: CS010 — Citation Parse Failure (INFO) (PRD §37)

### Security
- R020: No macros, no embedded execution, no remote URLs, zip bomb protection, XML size limits, time limits (PRD §87)
- R021: Failure isolation — malformed citation MUST NOT crash analysis (PRD §88)

## Web Application (from PRD + UI-SPEC)

### UI Core
- R022: Drop .docx file → analyze locally → show report (PRD §9)
- R023: UI state machine: idle → analyzing → done | error (UI-SPEC §3)
- R024: Design token system — color, typography, spacing, radius, shadow, z-index (UI-SPEC §1)
- R025: Desktop-first responsive — 2-col explorer ≥768px, 1-col below (UI-SPEC §2.1)
- R026: Severity color mapping with text labels, never color-only (UI-SPEC §1.1.1, PRD §89)

### Screens
- R027: Drop zone — drag/drop + click, invalid file inline error (UI-SPEC §5.1)
- R028: Stage checklist — 5 pipeline stages with ✓/●/○ markers (UI-SPEC §5.2)
- R029: Report summary — severity counts + meta line (UI-SPEC §5.3)
- R030: Issue explorer — grouped by severity, click-to-source (UI-SPEC §5.4)
- R031: Document view — highlight citations with severity tint (UI-SPEC §5.4)
- R032: Evidence panel — show why issue exists, possible references (UI-SPEC §5.5)
- R033: Resolution picker — for AMBIGUOUS citations, session-only (UI-SPEC §5.6)
- R034: Export panel — JSON + HTML download (UI-SPEC §5.7)
- R035: Bibliography recovery — below-threshold user selection (UI-SPEC §5.8)
- R036: Onboarding — hero, privacy badges, how-it-works, CTA (UI-SPEC §5.9)

### i18n
- R037: Hand-rolled typed i18n — EN default + VI, parity test required (UI-SPEC §7.1)
- R038: Evidence/issue text EN FROZEN — never translated (UI-SPEC §7.1)

### Error Handling
- R039: 6 error types via describeWorkerError: NotADocx, ZipBomb, ParseFailure, UnsupportedFormat, TimeBudgetExceeded, generic (UI-SPEC §3.3)
- R040: Error panel role=alert, stages preserved after error (UI-SPEC §4.2)

### Testing
- R041: FROZEN data-testid contract — 23 patterns (UI-SPEC §7.2, Appendix A)
- R042: 5 e2e specs: smoke, explorer, resolution, export, perf (UI-SPEC Appendix A)

## CLI (from PRD)
- R043: `npx citesync file.docx` with format options: default, detailed, json (PRD §49)
- R044: Exit codes: 0=no errors, 1=consistency errors, 2=parse failure, 3=unsupported (PRD §50)

## PWA (from PRD)
- R045: Installable PWA, offline shell, cached parser, no network after install (PRD §57)

## Performance (from PRD)
- R046: 100-page DOCX < 3 seconds on typical laptop (PRD §55)
- R047: Web Worker for heavy parsing, UI stays responsive (PRD §12)

## Quality (from PRD)
- R048: Citation detection precision ≥ 98% (PRD §78)
- R049: Citation detection recall ≥ 95% (PRD §78)
- R050: Reference matching precision ≥ 97% (PRD §78)
- R051: Benchmark dataset with reproducible fixtures (PRD §74–76)

## Accessibility (from PRD)
- R052: Keyboard navigation, visible focus states, screen-reader labels, semantic status, non-color severity (PRD §89)

## Extensibility (from PRD)
- R053: CiteSyncRule interface for community rules (PRD §52)
- R054: .citesyncrc configuration (PRD §51)

## Analytics (from PRD)
- R055: Anonymous metrics allowed (app opened, analysis started/completed, parser version, doc size bucket, processing duration, issue count bucket) (PRD §10)
- R056: Analytics MUST NOT include doc text, citation text, author names, ref titles, file names, bibliography (PRD §10)

## Session State (from PRD)
- R057: Session state is local-only; document disappears when user clears session; no persistence required (PRD §44)

## Documentation (from PRD)
- R058: README shows product immediately with recommended section sequence (hero, description, try online, install CLI, what it catches, privacy, styles, architecture, benchmarks, contributing) (PRD §81)
