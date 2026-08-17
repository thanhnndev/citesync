/**
 * T5 — the severity-grouped issue explorer (R012).
 *
 * Renders the done-envelope issues as severity groups in the canonical
 * RULE_SEVERITIES order (ERROR → WARNING → AMBIGUOUS → INFO, conservative
 * most-first) via the T4 `groupIssuesBySeverity` helper — empty groups are
 * dropped, intra-group order is the deterministic severity → source →
 * ruleId order lintDocument produced (R008). Each group has a header
 * (severity + count) and one row per issue (id + message). Clicking a row
 * selects the issue: DocumentView scrolls to and highlights its source span,
 * EvidencePanel explains it from matcher data.
 *
 * R013 (S03-T3) overlay — the manual-resolution view (D034, UI-derived):
 * a resolved issue's row gains the `issue-row-resolved` class (alongside
 * issue-row-selected) plus a `Resolved → {label}` chip; the severity-group
 * header renders a `severity-group-resolved` span with '{n} resolved' when
 * n > 0. Counts come from the T1 ResolutionsView (applyResolutions), NEVER
 * from the frozen `report.counts` — the canonical report stays byte-identical.
 *
 * M005-S02-T4 (Tailwind v4): redesign per UI-SPEC mockup 5.4 — severity
 * chips + tinted group headers, row hover/selected accent, resolved chip.
 * testids + state classes FROZEN.
 *
 * data-testid contract (FROZEN for T6 e2e): explorer, severity-group-{severity},
 * issue-row-{id}; the selected row carries the `issue-row-selected` class,
 * the resolved row the `issue-row-resolved` class.
 */

import type { LintIssue, RuleSeverity } from '@citesync/core';
import { groupIssuesBySeverity, referenceLabel } from '../explorer/explorer';
import type { ResolvedIssue } from '../resolutions/resolutions';
import { useI18n } from '../i18n/useI18n';

const SEVERITY_CLASS: Record<LintIssue['severity'], string> = {
  ERROR: 'severity-error',
  WARNING: 'severity-warning',
  AMBIGUOUS: 'severity-ambiguous',
  INFO: 'severity-info',
};

/** Tailwind accent per severity (group header + selected row). */
const SEVERITY_ACCENT: Record<LintIssue['severity'], string> = {
  ERROR: 'text-severity-error',
  WARNING: 'text-severity-warning',
  AMBIGUOUS: 'text-severity-ambiguous',
  INFO: 'text-severity-info',
};

const SEVERITY_TINT: Record<LintIssue['severity'], string> = {
  ERROR: 'bg-severity-error-tint',
  WARNING: 'bg-severity-warning-tint',
  AMBIGUOUS: 'bg-severity-ambiguous-tint',
  INFO: 'bg-severity-info-tint',
};

export interface IssueExplorerProps {
  /** The done-envelope issues (deterministic severity → source → ruleId order, R008). */
  issues: readonly LintIssue[];
  /** The currently selected issue id (undefined = nothing selected). */
  selectedIssueId?: string;
  /** Called when the user clicks an issue row. */
  onSelect: (issueId: string) => void;
  /** R013 overlay: issueId → resolved state (T1 applyResolutions view.byIssue). */
  resolvedByIssue?: Record<string, ResolvedIssue | undefined>;
  /** R013 overlay: per-severity resolved counts (T1 view.resolvedCounts — UI-derived, D034). */
  resolvedCounts?: Partial<Record<RuleSeverity, number>>;
}

export default function IssueExplorer({
  issues,
  selectedIssueId,
  onSelect,
  resolvedByIssue,
  resolvedCounts,
}: IssueExplorerProps) {
  const { t } = useI18n();
  const groups = groupIssuesBySeverity(issues);
  return (
    <section
      className="issue-explorer min-w-0 rounded-lg border border-border bg-surface p-4 shadow-sm"
      data-testid="explorer"
      aria-label={t('explorer.aria-label')}
    >
      <h2 className="m-0 mb-3 font-display text-lg font-semibold text-ink">
        {t('explorer.title')}
      </h2>
      {groups.length === 0 ? (
        <p className="issue-explorer-empty m-0 text-sm text-muted">{t('explorer.empty')}</p>
      ) : (
        groups.map((group) => {
          const resolvedInGroup = resolvedCounts?.[group.severity] ?? 0;
          return (
            <div
              key={group.severity}
              className={`severity-group ${SEVERITY_CLASS[group.severity]} mb-4 last:mb-0`}
              data-testid={`severity-group-${group.severity}`}
            >
              <h3 className="severity-group-header m-0 mb-2 flex items-center gap-2">
                <span className={`severity-group-name text-xs font-bold tracking-wide ${SEVERITY_ACCENT[group.severity]}`}>
                  {group.severity}
                </span>
                <span
                  className={`severity-group-count rounded-full px-2 py-0.5 font-mono text-xs font-medium tabular-nums ${SEVERITY_TINT[group.severity]} ${SEVERITY_ACCENT[group.severity]}`}
                >
                  {group.issues.length}
                </span>
                {resolvedInGroup > 0 && (
                  <span className="severity-group-resolved text-xs text-done">
                    {t('explorer.resolved-count', { count: resolvedInGroup })}
                  </span>
                )}
              </h3>
              <ul className="issue-list m-0 flex list-none flex-col gap-1 p-0">
                {group.issues.map((issue) => {
                  const resolved = resolvedByIssue?.[issue.id];
                  const classes = [
                    'issue-row',
                    'flex',
                    'w-full',
                    'items-start',
                    'gap-2',
                    'rounded-md',
                    'border-l-2',
                    'border-transparent',
                    'px-3',
                    'py-2',
                    'text-left',
                    'transition-colors',
                    'duration-150',
                    'cursor-pointer',
                    'hover:bg-hover',
                    issue.id === selectedIssueId
                      ? 'issue-row-selected border-accent bg-accent-tint'
                      : '',
                    resolved !== undefined ? 'issue-row-resolved' : '',
                  ]
                    .filter(Boolean)
                    .join(' ');
                  return (
                    <li key={issue.id}>
                      <button
                        type="button"
                        className={classes}
                        data-testid={`issue-row-${issue.id}`}
                        onClick={() => onSelect(issue.id)}
                      >
                        <code className="issue-row-id shrink-0 font-mono text-xs text-muted">
                          {issue.id}
                        </code>
                        <span className="issue-row-message min-w-0 text-sm text-pretty text-ink">
                          {issue.message}
                        </span>
                        {resolved !== undefined && (
                          <span className="issue-row-resolved-chip ml-auto shrink-0 self-center rounded-full bg-done/10 px-2 py-0.5 text-xs font-medium text-done">
                            {t('explorer.resolved-chip', {
                              label: referenceLabel(resolved.chosenEntry),
                            })}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })
      )}
    </section>
  );
}
