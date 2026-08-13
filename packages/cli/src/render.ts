/**
 * @citesync/cli — human-readable renderers.
 *
 * Both renderers are PURE functions over the canonical `CliReport` (the JSON
 * single source of truth, R010/R014): they never read the raw document, never
 * call `lintDocument`, and never re-derive data — every number and string they
 * print comes out of the report object that `--json` serializes. This is the
 * mechanism that keeps default/detailed/json from drifting (M002 S4 decision).
 *
 * Default mode = severity summary table; detailed mode = per-issue list with
 * source evidence. Both are deterministic ASCII (no Unicode box drawing — CI
 * and terminal-safe).
 */

import type { CliReport } from './report.js';
import { SEVERITY_ORDER } from './report.js';

/** Width of the "Severity" column (longest severity is AMBIGUOUS, 8 chars). */
const SEVERITY_COL_WIDTH = 10;
/** Width of the right-aligned "Count" column. */
const COUNT_COL_WIDTH = 5;

/** Render the per-severity count table (default mode). */
function renderCountTable(report: CliReport): string[] {
  const header = `${'Severity'.padEnd(SEVERITY_COL_WIDTH)} ${'Count'.padStart(COUNT_COL_WIDTH)}`;
  const rule = `${'-'.repeat(SEVERITY_COL_WIDTH)} ${'-'.repeat(COUNT_COL_WIDTH)}`;
  const rows = SEVERITY_ORDER.map(
    (sev) => `${sev.padEnd(SEVERITY_COL_WIDTH)} ${String(report.counts[sev]).padStart(COUNT_COL_WIDTH)}`,
  );
  return [header, rule, ...rows];
}

/** "3 issues found (ERROR: 2, WARNING: 1)" — deterministic per-severity breakdown. */
function issueSummaryLine(report: CliReport): string {
  const total = report.issues.length;
  if (total === 0) return 'No consistency issues found.';
  const breakdown = SEVERITY_ORDER.filter((sev) => report.counts[sev] > 0)
    .map((sev) => `${sev}: ${report.counts[sev]}`)
    .join(', ');
  return `${total} issue${total === 1 ? '' : 's'} found (${breakdown})`;
}

/**
 * Render the default severity-summary table.
 *
 * @param report — the canonical report (the JSON single source of truth).
 * @param version — CLI package version (display header).
 */
export function renderDefault(report: CliReport, version: string): string {
  const lines: string[] = [
    `CiteSync v${version} — ${report.meta.file}`,
    `Citations: ${report.meta.citations}    References: ${report.meta.references}`,
    '',
    ...renderCountTable(report),
    '',
    issueSummaryLine(report),
  ];
  return `${lines.join('\n')}\n`;
}

/** Human-readable source location for one issue/evidence source. */
function sourceText(loc: { blockId: string; paragraphIndex?: number; startOffset?: number; endOffset?: number }): string {
  if (loc.paragraphIndex !== undefined && loc.startOffset !== undefined && loc.endOffset !== undefined) {
    return `${loc.blockId} (paragraph ${loc.paragraphIndex}, chars ${loc.startOffset}-${loc.endOffset})`;
  }
  if (loc.paragraphIndex !== undefined) {
    return `${loc.blockId} (paragraph ${loc.paragraphIndex})`;
  }
  return loc.blockId;
}

/** One numbered issue block: heading, source, and the deterministic evidence list. */
function renderIssue(index: number, issue: CliReport['issues'][number]): string[] {
  const lines: string[] = [
    `${index}. [${issue.severity}] ${issue.id} — ${issue.message}`,
    `   Source: ${sourceText(issue.sourceLoc)}`,
  ];
  if (issue.evidence.length > 0) {
    lines.push('   Evidence:');
    for (const ev of issue.evidence) {
      lines.push(`     - ${ev.code}: ${ev.message}`);
      if (ev.source.blockId !== issue.sourceLoc.blockId) {
        lines.push(`       (${sourceText(ev.source)})`);
      }
    }
  }
  return lines;
}

/**
 * Render the detailed per-issue list with source evidence.
 *
 * @param report — the canonical report (the JSON single source of truth).
 * @param version — CLI package version (display header).
 */
export function renderDetailed(report: CliReport, version: string): string {
  const lines: string[] = [
    `CiteSync v${version} — ${report.meta.file}`,
    `Citations: ${report.meta.citations}    References: ${report.meta.references}`,
    '',
    issueSummaryLine(report),
  ];
  report.issues.forEach((issue, i) => {
    lines.push('', ...renderIssue(i + 1, issue));
  });
  return `${lines.join('\n')}\n`;
}

/** One-line usage text (--help and usage-error output). */
export function renderUsage(): string {
  return [
    'Usage: citesync <file.docx> [options]',
    '',
    'Analyze a DOCX manuscript for citation consistency. Input is a single',
    '.docx file path only — stdin/pipe input is not supported.',
    '',
    'Positionals:',
    '  <file.docx>          Path to the DOCX file to analyze',
    '',
    'Options:',
    '  -d, --detailed       Per-issue list with source evidence',
    '  -j, --json           Machine-readable JSON report (canonical schema,',
    '                       also reused by the app export)',
    '  -h, --help           Show this help and exit',
    '  -v, --version        Show version and exit',
    '',
    'Exit codes:',
    '  0   No consistency errors',
    '  1   Consistency errors found',
    '  2   Document could not be parsed',
    '  3   Unsupported document',
    '',
  ].join('\n');
}
