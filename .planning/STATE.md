---
gsd_state_version: 1.0
milestone: v0.2
milestone_name: — Structured Academic Documents
status: unknown
stopped_at: Phase 01 context gathered
last_updated: "2026-08-17T08:20:33.787Z"
progress:
  total_phases: 6
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# STATE.md — CiteSync

## Current Status

- **Active milestone:** M005 — UI Overhaul
- **Current slice:** S01 (design contract drafted in UI-SPEC)
- **Branch:** main

## What Exists

### Monorepo Structure

- `apps/web/` — React web application
- `packages/` — Core packages (core, docx, citations, references, matcher, rules, report, cli)
- `fixtures/` — Test fixtures (author-date, numeric)
- `benchmarks/` — Performance benchmarks
- `docs/` — PRD + UI-SPEC

### Implemented Components (9)

1. `DropZone.tsx` — File drop with validation
2. `StageChecklist.tsx` — 5-stage pipeline progress
3. `ReportSummary.tsx` — Severity counts + meta
4. `IssueExplorer.tsx` — Grouped issues with selection
5. `DocumentView.tsx` — Document rendering with highlights
6. `EvidencePanel.tsx` — Evidence explanation + possible refs
7. `ResolutionPicker.tsx` — Ambiguity resolution
8. `ExportPanel.tsx` — JSON + HTML download
9. `BibliographyRecoveryPanel.tsx` — Below-threshold recovery

### Test Infrastructure

- 5 e2e specs (smoke, explorer, resolution, export, perf)
- Vitest configuration
- FROZEN data-testid contract (23 patterns)

### Current Styling

- Tailwind CSS v4 integrated via `@tailwindcss/vite` plugin
- `design-system.css` — all --cs-* design tokens (CSS custom properties)
- `app.css` — @theme mapping + base styles + motion patterns
- Fonts: Fraunces (display), Be Vietnam Pro (body, VI-capable), JetBrains Mono (code)

## What's In Progress

- M005-S01: UI-SPEC design contract (Draft v0.2 — re-brainstormed UI/UX)
- Design token system definition (complete in UI-SPEC §1)
- Tailwind CSS v4 integration complete (UI-SPEC §7.3 + @theme mapping)
- FROZEN testid inventory documented (UI-SPEC Appendix A)
- No-deadflow guarantee verified (UI-SPEC §3.4)
- State exposure audit completed (UI-SPEC Appendix C)
- Interaction & motion patterns documented (UI-SPEC §8)
- Accessibility guidelines documented (UI-SPEC §9)

## What's Next

- M005-S02: Analysis flow + export UI
- M005-S03: Explorer + evidence + resolution
- M005-S04: Onboarding + bilingual + responsive

## Decisions Locked

See `.planning/intel/decisions.md` for full list. Key locks:

- Tailwind CSS v4 (overrides PRD §94 vanilla CSS)
- Hand-rolled typed i18n (no i18next)
- FROZEN data-testid (23 patterns, 5 e2e specs)
- Evidence/issue text EN FROZEN

## References

- PRD: `docs/CiteSync.dev — Product Requirements Document.md`
- UI-SPEC: `docs/UI-SPEC.md`
- Intel: `.planning/intel/SYNTHESIS.md`
- Conflicts: `.planning/INGEST-CONFLICTS.md`

## Session

**Last session:** 2026-08-17T08:20:33.783Z
**Stopped at:** Phase 01 context gathered
**Resume file:** .planning/phases/01-foundation-core-engine/01-CONTEXT.md
