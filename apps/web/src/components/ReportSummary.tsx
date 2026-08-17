/**
 * T5 — deterministic report summary from the canonical CliReport (D024).
 *
 * Renders severity counts in RULE_SEVERITIES order (ERROR → WARNING →
 * AMBIGUOUS → INFO, conservative-most first) plus a meta line from
 * report.meta (citations, references, ruleIds). S02 builds the detailed
 * explorer; this shell only summarizes.
 *
 * M005-S02-T3 (Tailwind v4): severity chips (name + value, tint per level)
 * + zero-issue success message per UI-SPEC §4.3/5.3. `isZeroIssue` is PURE
 * and exported for the node-env unit test. testids + logic FROZEN.
 *
 * data-testid contract (FROZEN for T6 e2e): wrapper `report-summary`.
 */

import { RULE_SEVERITIES } from '@citesync/core';
import type { CliReport, RuleSeverity } from '@citesync/core';
import { useI18n } from '../i18n/useI18n';

const SEVERITY_CLASS: Record<RuleSeverity, string> = {
  ERROR: 'severity-error',
  WARNING: 'severity-warning',
  AMBIGUOUS: 'severity-ambiguous',
  INFO: 'severity-info',
};

/** Chip tint per severity (Tailwind token utilities). */
const SEVERITY_CHIP: Record<RuleSeverity, string> = {
  ERROR: 'bg-severity-error-tint text-severity-error',
  WARNING: 'bg-severity-warning-tint text-severity-warning',
  AMBIGUOUS: 'bg-severity-ambiguous-tint text-severity-ambiguous',
  INFO: 'bg-severity-info-tint text-severity-info',
};

/**
 * M005-S02-T3 — zero-issue test (UI-SPEC §4.3): all four severity counts
 * are exactly 0. Pure + exported for the node-env unit test. The report's
 * issues array is derived from counts, but the contract is the COUNTS —
 * a report with issues but all-zero counts is still "zero issue" per the
 * canonical shape.
 */
export function isZeroIssue(report: CliReport): boolean {
  return RULE_SEVERITIES.every((severity) => report.counts[severity] === 0);
}

export interface ReportSummaryProps {
  /** The canonical CLI-compatible report (D024) from the done envelope. */
  report: CliReport;
}

export default function ReportSummary({ report }: ReportSummaryProps) {
  const { t } = useI18n();
  const zeroIssue = isZeroIssue(report);
  return (
    <section
      className="report-summary rounded-lg border border-border bg-surface p-5 shadow-sm"
      data-testid="report-summary"
      aria-label={t('report.aria-label')}
    >
      <h2 className="m-0 mb-3 font-display text-lg font-semibold text-ink">
        {t('report.title')}
      </h2>
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
        {RULE_SEVERITIES.map((severity) => (
          <li
            key={severity}
            className={`severity-count ${SEVERITY_CLASS[severity]} ${SEVERITY_CHIP[severity]} flex items-baseline gap-2 rounded-md px-3 py-1.5`}
          >
            <span className="severity-name text-xs font-semibold tracking-wide">{severity}</span>
            <span className="severity-value font-mono text-lg font-medium tabular-nums">
              {report.counts[severity]}
            </span>
          </li>
        ))}
      </ul>
      <p className="report-meta m-0 mt-3 text-sm text-muted">
        {t('report.meta-count', {
          citations: report.meta.citations,
          references: report.meta.references,
          rules: report.meta.ruleIds.length,
        })}
      </p>
      {zeroIssue && (
        <p className="zero-issue-message m-0 mt-2 text-sm font-medium text-done">
          {t('report.zero-issue')}
        </p>
      )}
    </section>
  );
}
