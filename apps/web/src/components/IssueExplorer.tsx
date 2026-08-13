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
 * data-testid contract (FROZEN for T6 e2e): explorer, severity-group-{severity},
 * issue-row-{id}; the selected row carries the `issue-row-selected` class,
 * the resolved row the `issue-row-resolved` class.
 */

import type { LintIssue, RuleSeverity } from '@citesync/core';
import { groupIssuesBySeverity, referenceLabel } from '../explorer/explorer';
import type { ResolvedIssue } from '../resolutions/resolutions';

const SEVERITY_CLASS: Record<LintIssue['severity'], string> = {
  ERROR: 'severity-error',
  WARNING: 'severity-warning',
  AMBIGUOUS: 'severity-ambiguous',
  INFO: 'severity-info',
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
  const groups = groupIssuesBySeverity(issues);
  return (
    <section className="issue-explorer" data-testid="explorer" aria-label="Issues by severity">
      <h2>Issues</h2>
      {groups.length === 0 ? (
        <p className="issue-explorer-empty">No issues found.</p>
      ) : (
        groups.map((group) => {
          const resolvedInGroup = resolvedCounts?.[group.severity] ?? 0;
          return (
            <div
              key={group.severity}
              className={`severity-group ${SEVERITY_CLASS[group.severity]}`}
              data-testid={`severity-group-${group.severity}`}
            >
              <h3 className="severity-group-header">
                <span className="severity-group-name">{group.severity}</span>
                <span className="severity-group-count">{group.issues.length}</span>
                {resolvedInGroup > 0 && (
                  <span className="severity-group-resolved">{resolvedInGroup} resolved</span>
                )}
              </h3>
              <ul className="issue-list">
                {group.issues.map((issue) => {
                  const resolved = resolvedByIssue?.[issue.id];
                  const classes = [
                    'issue-row',
                    issue.id === selectedIssueId ? 'issue-row-selected' : '',
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
                        <code className="issue-row-id">{issue.id}</code>
                        <span className="issue-row-message">{issue.message}</span>
                        {resolved !== undefined && (
                          <span className="issue-row-resolved-chip">
                            Resolved → {referenceLabel(resolved.chosenEntry)}
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
