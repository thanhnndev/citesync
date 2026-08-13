/**
 * @citesync/cli — the canonical CLI-compatible JSON report (R010/R014).
 *
 * This module is the SINGLE SOURCE OF TRUTH for everything the CLI renders:
 * the default severity-summary table and the detailed per-issue list are pure
 * renderers over THIS shape, and `--json` emits exactly this document. M003's
 * export UI (R014) reuses the same schema, so the CLI and the app can never
 * drift.
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
 */

import type { LintIssue, LintReport, RuleSeverity } from '@citesync/core';
import { RULE_SEVERITIES } from '@citesync/core';
import { basename } from 'node:path';

/** Bump when the schema shape changes (M003 export contract). */
export const REPORT_VERSION = 1 as const;

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

/** Per-severity issue counts. Keys in SEVERITY_ORDER, always all four. */
export type SeverityCounts = Record<RuleSeverity, number>;

/** The canonical report `meta` block. */
export interface CliReportMeta {
  /** Basename of the analyzed file (display-friendly, machine-independent). */
  file: string;
  /** §20 citation occurrences counted on the parsed document. */
  citations: number;
  /** §21 bibliography entries (fallback: detected section blockIds count). */
  references: number;
  /** Rules that ran this pass, sorted — inspectable for debugging (R009). */
  ruleIds: string[];
}

/** Failure detail carried in the JSON when a run does not produce a report. */
export interface CliErrorInfo {
  /** Machine-readable code (stable contract, mirrors exit codes 2/3). */
  code: ErrorCode;
  /** Human-readable diagnostic (deterministic error text). */
  message: string;
}

/**
 * The canonical CLI-compatible report. `error` is present ONLY on failure;
 * success reports omit the key entirely (byte-stable success shape).
 */
export interface CliReport {
  /** Schema version (see REPORT_VERSION). */
  version: number;
  /** File + document-level counters. */
  meta: CliReportMeta;
  /** Frozen S02 LintIssue[] — deterministic severity → source → ruleId order. */
  issues: LintIssue[];
  /** Per-severity counts (all four keys, SEVERITY_ORDER). */
  counts: SeverityCounts;
  /** Present only when the run failed (parse-failure / unsupported / file-not-found). */
  error?: CliErrorInfo;
}

/** All-zero severity counts — deterministic key order. */
export function emptyCounts(): SeverityCounts {
  return Object.fromEntries(SEVERITY_ORDER.map((sev) => [sev, 0])) as SeverityCounts;
}

/** Count the issues per severity (all four keys always present). */
export function countIssues(issues: readonly LintIssue[]): SeverityCounts {
  const counts = emptyCounts();
  for (const issue of issues) {
    counts[issue.severity] += 1;
  }
  return counts;
}

/**
 * Build the canonical report from an @citesync/core LintReport.
 *
 * @param lint — the typed report from `lintDocument` (issues + doc + ruleIds).
 * @param file — the analyzed file path (only the basename is recorded).
 */
export function buildReport(lint: LintReport, file: string): CliReport {
  const bib = lint.doc.bibliography;
  return {
    version: REPORT_VERSION,
    meta: {
      file: basename(file),
      citations: lint.doc.citations.length,
      references: bib?.entries?.length ?? bib?.blockIds?.length ?? 0,
      ruleIds: [...lint.ruleIds],
    },
    issues: lint.issues,
    counts: countIssues(lint.issues),
  };
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

/**
 * Serialize the report to the canonical JSON text: 2-space pretty-printed
 * with a trailing newline, property order = insertion order, so identical
 * input always yields byte-identical output (R008 determinism).
 */
export function serializeReport(report: CliReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
