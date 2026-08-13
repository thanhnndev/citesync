/**
 * @citesync/cli — the canonical CLI-compatible JSON report (R010/R014).
 *
 * The success-report shape is now built by `@citesync/core`'s pure
 * `buildCliReport` (D024 — single source of truth shared with the M003
 * worker and export UI, browser-safe): `buildReport` delegates here, so
 * CLI JSON and app JSON can never drift. Serialization (`serializeReport`)
 * also lives in @citesync/core now (D024 extension) and is re-exported from
 * here, so `--json` output is byte-identical to the app's export by
 * construction. This module keeps the CLI-owned pieces: the
 * `SEVERITY_ORDER` re-derivation and the failure classification
 * (`ErrorCode`, `CliErrorInfo`, `buildErrorReport`).
 *
 * Shape (deterministic; frozen for M003 — T2 adds the contract tests):
 *
 *   {
 *     "version": 1,
 *     "meta": {
 *       "file":        string   — basename of the analyzed .docx
 *       "citations":   number   — §20 citation occurrences
 *       "references":  number   — §21 bibliography entries (blockIds fallback)
 *       "ruleIds":     string[] — rules that ran, sorted
 *     },
 *     "issues": [ ...LintIssue... ],   — the frozen S02 shape verbatim
 *     "counts": { "ERROR": n, "WARNING": n, "AMBIGUOUS": n, "INFO": n },
 *     "error": { "code": ..., "message": ... }   — present ONLY on failure
 *   }
 *
 * Property ordering is fixed (insertion order → JSON.stringify order), so the
 * serialized report is byte-stable across runs for identical input (R008).
 * `issues` entries are the @citesync/core LintIssue objects unmodified — they
 * already carry `evidence[]` with `source` locations (R009 source evidence),
 * so the JSON needs no enrichment and stays identical to what S03
 * `lintDocument` produces.
 *
 * NOTE (D025): pipeline stage names (PRD §61) are an internal progress
 * contract — never serialized here.
 */

import type { CliReport, LintReport, RuleSeverity } from '@citesync/core';
import { RULE_SEVERITIES, buildCliReport, emptyCounts, REPORT_VERSION } from '@citesync/core';
import { basename } from 'node:path';

// The canonical success-report contract now lives in @citesync/core (D024) —
// re-exported so json-schema.ts `satisfies` binds, render.ts and the
// cli-contract/cli-determinism tests keep resolving. Failure classification
// (ErrorCode/CliErrorInfo) stays CLI-owned below.

/**
 * Serialize the report to the canonical JSON text (byte contract): 2-space
 * pretty-printed with a trailing newline, property order = insertion order,
 * so identical input always yields byte-identical output (R008 determinism).
 * Owned by @citesync/core (D024 extension) — re-exported here so the CLI
 * surface and `--json` output are unchanged.
 */
export { REPORT_VERSION, countIssues, emptyCounts, serializeReport } from '@citesync/core';
export type { CliReport, CliReportMeta, SeverityCounts } from '@citesync/core';

/** Fixed, deterministic order of the severity-count keys (R008). */
export const SEVERITY_ORDER: readonly RuleSeverity[] = RULE_SEVERITIES;

/** Machine-readable failure classification — mirrors the R010 exit codes. */
export type ErrorCode =
  /** Document could not be parsed (NotADocx / zip-bomb / parse failure) — exit 2. */
  | 'parse-failure'
  /** Well-formed but unsupported (encryption / unknown compression) — exit 3. */
  | 'unsupported-document'
  /** The given path does not exist / cannot be read — exit 2 (input error). */
  | 'file-not-found'
  /** Bad flags / missing file argument — exit 2 (usage). */
  | 'usage';

/** Failure detail carried in the JSON when a run does not produce a report. */
export interface CliErrorInfo {
  /** Machine-readable code (stable contract, mirrors exit codes 2/3). */
  code: ErrorCode;
  /** Human-readable diagnostic (deterministic error text). */
  message: string;
}

/**
 * Build the canonical report from an @citesync/core LintReport — delegates
 * to the shared `buildCliReport` (D024), so the CLI and the M003
 * worker/export UI serialize the SAME bytes for the same input.
 *
 * @param lint — the typed report from `lintDocument` (issues + doc + ruleIds).
 * @param file — the analyzed file path (only the basename is recorded).
 */
export function buildReport(lint: LintReport, file: string): CliReport {
  return buildCliReport(lint.doc, lint.issues, lint.ruleIds, {
    fileName: basename(file),
    version: REPORT_VERSION,
  });
}

/**
 * Build the failure report used by `--json` when a run does not produce a
 * lint report (parse failure / unsupported document / file not found). The
 * shape is the same report minus real issues, plus the `error` block — so CI
 * and M003 can branch on `error.code` while still parsing one stable schema.
 */
export function buildErrorReport(file: string, error: CliErrorInfo): CliReport {
  return {
    version: REPORT_VERSION,
    meta: { file: basename(file), citations: 0, references: 0, ruleIds: [] },
    issues: [],
    counts: emptyCounts(),
    error,
  };
}

