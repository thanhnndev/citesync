/**
 * @citesync/core — public lint core (R009).
 *
 * The one public package the CLI (S4) and the M003 UI consume — never the
 * parser directly (PRD §92). Zero React/DOM/server/UI dependencies.
 *
 * Surface:
 *   - `lintDocument(input, options)` — run the CS001–CS009 registry over a
 *     parsed `AcademicDocument` OR raw `.docx` bytes (parse + lint
 *     end-to-end via @citesync/docx); `{ issues, doc, ruleIds }` in
 *     deterministic order (R008).
 *   - `createRule(config)` — contributor rule factory (shape-validated).
 *     Custom rules run alongside built-ins via `options.customRules`
 *     without modifying the matcher (slice demo contract).
 *   - The frozen S02 rule contract re-exported — `Rule`, `LintIssue`,
 *     `RuleContext`, severity/segment types — so contributors import the
 *     contract from THIS public package, never internals. `REGISTERED_RULES`
 *     / `RULE_BY_ID` / `RULE_SEGMENTS` are inspectable for debugging (R009).
 */

// The lint entry.
export { lintDocument } from './lint-document.js';
export type {
  DocBytes,
  LintDocumentInput,
  LintDocumentOptions,
  LintReport,
} from './lint-document.js';

// The contributor rule surface.
export { createRule } from './rules.js';
export type { RuleConfig } from './rules.js';

// The frozen S02 contract (single source of truth in @citesync/docx),
// re-exported so the public core package is the one import point for
// contributors (R009). Types are `export type` — verbatimModuleSyntax.
export { REGISTERED_RULES, RULE_BY_ID, RULE_SEGMENTS, RULE_SEVERITIES } from '@citesync/docx';
export type {
  LintDocumentRulesOptions,
  LintEvidence,
  LintIssue,
  Rule,
  RuleContext,
  RuleEvidenceCode,
  RuleSeverity,
  RuleSegment,
  SeverityInput,
} from '@citesync/docx';

// M003 (T2): the canonical CLI-compatible report builder (R014, D024) — pure
// and browser-safe (zero Node builtins), so the CLI delegates here (buildReport →
// buildCliReport) and the M003 worker/export UI consume the SAME builder from
// core. CLI JSON and app JSON can never drift.
export { buildCliReport, countIssues, emptyCounts, REPORT_VERSION, serializeReport } from './cli-report.js';
export type {
  BuildCliReportOptions,
  CliReport,
  CliReportMeta,
  SeverityCounts,
} from './cli-report.js';

// The frozen pipeline-stage contract (PRD §61): the worker forwards each
// stage via postMessage and the UI renders the §61 checklist. Stage names are
// internal contract (D025) — they never enter the frozen report schema. The
// VALUE is re-exported too so the worker/UI take the stage list from the
// public core package (PRD §93), never from @citesync/docx.
export { PIPELINE_STAGES } from '@citesync/docx';
export type { PipelineStage } from '@citesync/docx';

// The §15 model type, re-exported so the worker/UI take AcademicDocument from
// the public core package (PRD §93), never from @citesync/docx.
export type { AcademicDocument } from '@citesync/document-model';
