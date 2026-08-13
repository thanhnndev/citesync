/**
 * @citesync/core — the canonical CLI-compatible JSON report (R014, D024).
 *
 * The CLI, the M003 worker and the export UI all build the SAME frozen
 * report shape from this single pure builder. Zero Node builtin imports
 * (no fs/path/process), so it is browser-safe — the M003 worker bundles
 * @citesync/core (T1 proved the core chunk loads and runs inside a Vite Web
 * Worker) and this module is exactly what the worker needs to produce the
 * canonical report. The CLI's
 * `buildReport` delegates here, so CLI JSON and app JSON can never drift
 * (D024 — single source of truth; cli-determinism + cli-contract guard the
 * byte-compat).
 *
 * Shape (deterministic; frozen — D020/D024/D025):
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
 *     "counts": { "ERROR": n, "WARNING": n, "AMBIGUOUS": n, "INFO": n }
 *   }
 *
 * Property ordering is fixed (insertion order → JSON.stringify order), so
 * the serialized report is byte-stable across runs for identical input
 * (R008). `issues` entries are the @citesync/core LintIssue objects
 * unmodified — they already carry `evidence[]` with `source` locations, so
 * the JSON needs no enrichment. Failure reports (with `error: { code,
 * message }`) stay CLI-owned: the code classification (ErrorCode) is a CLI
 * concern, not part of this shared success builder.
 *
 * NOTE (D025): pipeline stage names (PRD §61, @citesync/docx
 * pipeline-stages) are an internal progress contract and never appear in
 * this frozen schema.
 */

import type { AcademicDocument } from '@citesync/document-model';
import type { LintIssue, RuleSeverity } from '@citesync/docx';
import { RULE_SEVERITIES } from '@citesync/docx';

/** Bump when the schema shape changes (M003 export contract). */
export const REPORT_VERSION = 1 as const;

/** Fixed, deterministic order of the severity-count keys (R008). */
const SEVERITY_ORDER: readonly RuleSeverity[] = RULE_SEVERITIES;

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

/**
 * The canonical CLI-compatible report. `error` is present ONLY on failure
 * reports — those are built by the CLI (`buildErrorReport`) with its
 * CLI-owned `ErrorCode` classification; the shared success builder never
 * produces this key. The structural shape (code/message) is part of the
 * frozen JSON contract (D020), so it is declared here for type safety.
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
  /** Present only on failure — built by the CLI (ErrorCode classification). */
  error?: { code: string; message: string };
}

/** Options for {@link buildCliReport}. */
export interface BuildCliReportOptions {
  /** Basename of the analyzed file (display-friendly, machine-independent). */
  fileName: string;
  /** Schema version (REPORT_VERSION — passed through so callers pin it). */
  version: number;
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
 * Build the canonical CLI-compatible report from a parsed document, its
 * issues and the rule ids that ran — the single source of truth shared by
 * the CLI (buildReport delegates here), the M003 worker and the export UI.
 *
 * @param doc — the §15 AcademicDocument (from `lintDocument(...).doc`).
 * @param issues — the frozen LintIssue[] (from `lintDocument(...).issues`).
 * @param ruleIds — the rule ids that ran, sorted (from lintDocument).
 * @param options — `fileName` (already basename'd by the caller — this
 *   module is pure and never touches Node's path module) and the `version`
 *   to stamp.
 * @returns the canonical report: version → meta → issues → counts in
 *   insertion order (byte-stable serialization, R008).
 */
export function buildCliReport(
  doc: AcademicDocument,
  issues: readonly LintIssue[],
  ruleIds: readonly string[],
  options: BuildCliReportOptions,
): CliReport {
  const bib = doc.bibliography;
  return {
    version: options.version,
    meta: {
      file: options.fileName,
      citations: doc.citations.length,
      references: bib?.entries?.length ?? bib?.blockIds?.length ?? 0,
      ruleIds: [...ruleIds],
    },
    issues: issues as LintIssue[],
    counts: countIssues(issues),
  };
}
