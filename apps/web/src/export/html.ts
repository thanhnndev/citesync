/**
 * T3 — pure standalone HTML report builder (escaping + determinism).
 *
 * A PURE function from the canonical CliReport (D024) to a standalone,
 * deterministic HTML document. The app's T4 export button is the ONLY
 * consumer; this module has zero DOM / Node builtin imports (bundled into
 * the main chunk — T5 absence checks prove `node:` / @citesync/docx /
 * @citesync/cli never leak in) and no clock / no randomness, so the same
 * report always yields the same bytes (R008/R017).
 *
 * Standalone (R011/offline-friendly): everything is inline — the `<style>`
 * block, `<meta charset="utf-8">` (Vietnamese fixture content), zero
 * external src/href/link tags. The file renders from disk with no network.
 *
 * The canonical report JSON is embedded verbatim (via serializeReport —
 * the SAME serializer the CLI `--json` uses, D024) in a
 * `<script type="application/json" id="citesync-report">` block, with `<`
 * `>` `&` escaped as `\u003c` `\u003e` `\u0026` so a hostile
 * `meta.file`/message (e.g. `x</script><script>alert(1)</script>.docx`)
 * can never break out of the script element (XSS-safe; the escapes are
 * valid JSON escapes, so `JSON.parse` of the block still round-trips to the
 * exact report — locked by node tests).
 *
 * Every report-derived string passes through `escapeHtml` (`& < > " '`)
 * before reaching markup; the severity summary renders in RULE_SEVERITIES
 * order (ERROR → WARNING → AMBIGUOUS → INFO) mirroring ReportSummary and
 * the cliReportSchema counts. Source locations render ONLY the frozen
 * SourceLocation fields (blockId + paragraphIndex/runIndex/offsets when
 * present) — never fabricated text (R012 boundary).
 */

import { RULE_SEVERITIES, serializeReport } from '@citesync/core';
import type { CliReport, LintEvidence, LintIssue, RuleSeverity } from '@citesync/core';

/** The frozen §16 SourceLocation shape, read via the LintIssue contract (R008). */
type SourceLocation = LintIssue['sourceLoc'];

const SEVERITY_CLASS: Record<RuleSeverity, string> = {
  ERROR: 'severity-error',
  WARNING: 'severity-warning',
  AMBIGUOUS: 'severity-ambiguous',
  INFO: 'severity-info',
};

/**
 * Escape a string for safe inclusion in HTML text / attribute content.
 * `&` first so previously escaped sequences are never double-escaped;
 * covers `& < > " '` — applied to EVERY report-derived string.
 */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escape serialized JSON for embedding inside a `<script>` element: `<` `>`
 * `&` become `\u003c` `\u003e` `\u0026`. These are valid JSON escape
 * sequences (round-trip safe) that remove the literal `<`/`>` characters
 * the HTML parser treats as script-data delimiters — the `</script>` /
 * `<!--` breakout vectors are structurally impossible afterwards.
 */
function escapeJsonForScript(json: string): string {
  return json.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

/**
 * Compact, deterministic source location string — reads ONLY the frozen
 * SourceLocation fields (blockId required; paragraphIndex / runIndex /
 * startOffset / endOffset appended when present). Never fabricates text.
 *   { blockId: 'doc-p1', paragraphIndex: 1, startOffset: 0, endOffset: 12 }
 *   → "doc-p1:p1:chars0-12"
 */
function formatSourceLoc(loc: SourceLocation): string {
  let out = loc.blockId;
  if (loc.paragraphIndex !== undefined) out += `:p${loc.paragraphIndex}`;
  if (loc.runIndex !== undefined) out += `:r${loc.runIndex}`;
  if (loc.startOffset !== undefined || loc.endOffset !== undefined) {
    out += `:chars${loc.startOffset ?? 0}-${loc.endOffset ?? ''}`;
  }
  return out;
}

/** Severity-count summary in RULE_SEVERITIES order (mirrors ReportSummary). */
function renderSeveritySummary(counts: CliReport['counts']): string {
  const items = RULE_SEVERITIES.map((severity) => {
    const cls = SEVERITY_CLASS[severity];
    return (
      `<li class="severity-count ${cls}">` +
      `<span class="severity-name">${escapeHtml(severity)}</span>` +
      `<span class="severity-value">${counts[severity]}</span>` +
      `</li>`
    );
  });
  return `<ul class="severity-counts">\n${items.join('\n')}\n</ul>`;
}

/** One issue's evidence list: code / message / source location per item. */
function renderEvidence(evidence: readonly LintEvidence[]): string {
  if (evidence.length === 0) return '';
  const items = evidence.map(
    (ev) =>
      `<li class="evidence-item">` +
      `<code class="evidence-code">${escapeHtml(ev.code)}</code>` +
      ` <span class="evidence-message">${escapeHtml(ev.message)}</span>` +
      ` <span class="evidence-source">[${escapeHtml(formatSourceLoc(ev.source))}]</span>` +
      `</li>`,
  );
  return `<ul class="evidence">\n${items.join('\n')}\n</ul>`;
}

/** One issue: id, severity badge, ruleId, message, source, evidence. */
function renderIssue(issue: LintIssue): string {
  const cls = SEVERITY_CLASS[issue.severity];
  return (
    `<li class="issue" id="issue-${escapeHtml(issue.id)}">` +
    `<header class="issue-header">` +
    `<span class="severity-badge ${cls}">${escapeHtml(issue.severity)}</span>` +
    `<h3 class="issue-title">${escapeHtml(issue.id)} · ${escapeHtml(issue.ruleId)}</h3>` +
    `</header>` +
    `<p class="issue-message">${escapeHtml(issue.message)}</p>` +
    `<p class="issue-source">Source: <code>${escapeHtml(formatSourceLoc(issue.sourceLoc))}</code></p>` +
    renderEvidence(issue.evidence) +
    `</li>`
  );
}

/** Inline stylesheet — static, zero external references (standalone). */
const STYLE = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; margin: 0; background: #f5f6f8; color: #1a1d21; line-height: 1.5; }
.citesync-report { max-width: 860px; margin: 0 auto; padding: 24px 20px 48px; }
.report-header { border-bottom: 2px solid #1a5cff; padding-bottom: 12px; margin-bottom: 20px; }
.report-header h1 { margin: 0 0 4px; font-size: 24px; color: #1a5cff; }
.report-file { margin: 0; font-size: 15px; font-weight: 600; word-break: break-all; }
.report-version { margin: 2px 0 0; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; }
.report-meta { margin: 8px 0 0; font-size: 13px; color: #4b5563; }
.severity-counts { display: flex; gap: 8px; list-style: none; padding: 0; margin: 12px 0 0; flex-wrap: wrap; }
.severity-count { padding: 6px 12px; border-radius: 6px; font-size: 13px; font-weight: 600; }
.severity-name { margin-right: 6px; opacity: 0.75; }
.severity-error { background: #fee2e2; color: #991b1b; }
.severity-warning { background: #ffedd5; color: #9a3412; }
.severity-ambiguous { background: #fef3c7; color: #92400e; }
.severity-info { background: #e0e7ff; color: #3730a3; }
.issue-list { list-style: none; padding: 0; margin: 12px 0 0; }
.issue { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px 16px; margin: 0 0 12px; }
.issue-header { display: flex; align-items: center; gap: 10px; }
.issue-title { margin: 0; font-size: 15px; }
.severity-badge { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.04em; }
.issue-message { margin: 8px 0 4px; }
.issue-source { margin: 0 0 8px; font-size: 12px; color: #6b7280; }
.issue-source code { background: #f3f4f6; padding: 1px 5px; border-radius: 4px; }
.evidence { margin: 8px 0 0; padding-left: 18px; font-size: 13px; }
.evidence-item { margin-bottom: 4px; }
.evidence-code { background: #eef2ff; color: #3730a3; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
.evidence-source { color: #6b7280; font-size: 12px; }
`.trim();

/**
 * Build the standalone, deterministic HTML report for a canonical report.
 *
 * Deterministic (R008/R017): no timestamps, no random ids, no locale —
 * the same report always produces the same bytes. The embedded canonical
 * JSON comes from `serializeReport` (D024 — the CLI `--json` serializer),
 * so the HTML export is a pure consumer of the frozen schema.
 *
 * @param report — the canonical CLI-compatible report (D024).
 * @returns the complete standalone HTML document (utf-8, inline styles).
 */
export function buildHtmlReport(report: CliReport): string {
  const { meta, counts, issues } = report;
  const canonicalJson = escapeJsonForScript(serializeReport(report));
  const rules =
    meta.ruleIds.length > 0 ? ` (${meta.ruleIds.map((id) => escapeHtml(id)).join(', ')})` : '';
  const metaLine = `${meta.citations} citations · ${meta.references} references · ${meta.ruleIds.length} rules applied${rules}`;

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>CiteSync report — ${escapeHtml(meta.file)}</title>`,
    `<style>\n${STYLE}\n</style>`,
    '</head>',
    '<body>',
    '<main class="citesync-report">',
    '<header class="report-header">',
    '<h1>CiteSync report</h1>',
    `<p class="report-file">${escapeHtml(meta.file)}</p>`,
    `<p class="report-version">Schema v${report.version}</p>`,
    `<p class="report-meta">${metaLine}</p>`,
    '</header>',
    '<section class="severity-summary" aria-label="Severity summary">',
    '<h2>Severity summary</h2>',
    renderSeveritySummary(counts),
    '</section>',
    '<section class="issues" aria-label="Issues">',
    `<h2>Issues (${issues.length})</h2>`,
    `<ol class="issue-list">\n${issues.map(renderIssue).join('\n')}\n</ol>`,
    '</section>',
    '</main>',
    `<script type="application/json" id="citesync-report">${canonicalJson}</script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
