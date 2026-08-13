/**
 * T5 — deterministic report summary from the canonical CliReport (D024).
 *
 * Renders severity counts in RULE_SEVERITIES order (ERROR → WARNING →
 * AMBIGUOUS → INFO, conservative-most first) plus a meta line from
 * report.meta (citations, references, ruleIds). S02 builds the detailed
 * explorer; this shell only summarizes.
 *
 * data-testid contract (FROZEN for T6 e2e): wrapper `report-summary`.
 */

import { RULE_SEVERITIES } from '@citesync/core';
import type { CliReport, RuleSeverity } from '@citesync/core';

const SEVERITY_CLASS: Record<RuleSeverity, string> = {
  ERROR: 'severity-error',
  WARNING: 'severity-warning',
  AMBIGUOUS: 'severity-ambiguous',
  INFO: 'severity-info',
};

export interface ReportSummaryProps {
  /** The canonical CLI-compatible report (D024) from the done envelope. */
  report: CliReport;
}

export default function ReportSummary({ report }: ReportSummaryProps) {
  return (
    <section className="report-summary" data-testid="report-summary" aria-label="Report summary">
      <h2>Report</h2>
      <ul className="severity-counts">
        {RULE_SEVERITIES.map((severity) => (
          <li key={severity} className={`severity-count ${SEVERITY_CLASS[severity]}`}>
            <span className="severity-name">{severity}</span>
            <span className="severity-value">{report.counts[severity]}</span>
          </li>
        ))}
      </ul>
      <p className="report-meta">
        {report.meta.citations} citations · {report.meta.references} references ·{' '}
        {report.meta.ruleIds.length} rules applied
      </p>
    </section>
  );
}
