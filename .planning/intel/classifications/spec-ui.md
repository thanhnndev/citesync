# Classification: CiteSync — UI-SPEC (M005-S01)

- **Source:** docs/UI-SPEC.md
- **Type:** SPEC
- **Precedence:** 2 (SPEC — after ADR=1, before PRD=3)
- **Sections:** 9 + Appendix A, B
- **Language:** Mixed (Vietnamese + English)

## Decisions

1. **D-SPEC-01:** Tailwind CSS v4 (CSS-first @theme, no tailwind.config.js) — overrides PRD §94 vanilla CSS (§7.3)
2. **D-SPEC-02:** Hand-rolled typed i18n dictionary (EN–VI) — no i18next or library (§7.1)
3. **D-SPEC-03:** FROZEN data-testid contract — 23 patterns, 5 e2e specs reference them (§7.2, Appendix A)
4. **D-SPEC-04:** Design tokens as CSS custom properties in design-system.css on :root (§1)
5. **D-SPEC-05:** Desktop-first responsive with 4 breakpoints: wide≥1024, narrow≥768, tablet 481–767, mobile≤480 (§2.1)
6. **D-SPEC-06:** App shell layout: header/stages/report/export/error in flow-column ≤720px; explorer 2-column grid (§2.2)
7. **D-SPEC-07:** State machine: idle → analyzing → done | error, with recovery path (§3)
8. **D-SPEC-08:** Evidence/issue text stays EN FROZEN — never translated (§7.1)
9. **D-SPEC-09:** State machine stays in App.tsx as status string — no state machine library (§7.3)
10. **D-SPEC-10:** Severity canonical order: ERROR → WARNING → AMBIGUOUS → INFO (§1.1.1)

## Requirements

1. **R-SPEC-01:** Design token system: color, typography, spacing, radius, shadow, z-index (§1)
2. **R-SPEC-02:** Severity color mapping with text labels + markers, never color-only (§1.1.1, PRD §89)
3. **R-SPEC-03:** Grid 2-column explorer at ≥768px, stacked 1-column below (§2.1)
4. **R-SPEC-04:** Full state inventory for all screens: empty/loading/error/success (§4)
5. **R-SPEC-05:** 9 UI screens with wireframes: Drop, Stages, Report, Explorer, Evidence, Resolution, Export, Recovery, Onboarding (§5)
6. **R-SPEC-06:** Error classification via describeWorkerError with 6 error types (§3.3)
7. **R-SPEC-07:** Processing badge always mounted, text changes by state (§2.2)
8. **R-SPEC-08:** Issue rows grouped by severity with resolved count (§4.4)
9. **R-SPEC-09:** Source highlight with scroll-to-center for selected issues (§5.4)
10. **R-SPEC-10:** Resolution picker only for AMBIGUOUS span-scoped with candidates (§5.6)
11. **R-SPEC-11:** Bibliography recovery panel for below-threshold detection (§5.8)
12. **R-SPEC-12:** Export panel with JSON + HTML download (§5.7)
13. **R-SPEC-13:** Onboarding screen with hero, privacy badges, how-it-works, CTA (§5.9)
14. **R-SPEC-14:** i18n key naming convention: {surface}.{element}.{state} (§7.1.3)
15. **R-SPEC-15:** Parity test for EN/VI dictionaries (§7.1)
16. **R-SPEC-16:** Tailwind v4 @theme mapping from --cs-* tokens (§7.3)

## Constraints

1. **C-SPEC-01:** Report stays byte-identical (D024) — UI never changes report data
2. **C-SPEC-02:** data-testid FROZEN — 5 e2e specs depend on them
3. **C-SPEC-03:** No LLM in UI (R012)
4. **C-SPEC-04:** No guessing when data insufficient (§79 PRD)
5. **C-SPEC-05:** UI scope: apps/web only — no engine, worker protocol, or report schema changes
6. **C-SPEC-06:** Stage labels stay EN literal (D025 engine→UI contract)
7. **C-SPEC-07:** Font services not allowed — system fonts + @fontsource local bundle only (offline-first)

## Context

- Milestone: M005 (UI overhaul)
- Slices: S01 (design contract), S02 (analysis flow/export), S03 (explorer/evidence/resolution), S04 (onboarding/bilingual/responsive)
- References existing components: DropZone, StageChecklist, ReportSummary, IssueExplorer, DocumentView, EvidencePanel, ResolutionPicker, ExportPanel, BibliographyRecoveryPanel
- Onboarding component: new (S04)
- Migration map from current app.css to token system provided (§1.7)
