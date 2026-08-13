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
 * data-testid contract (FROZEN for T6 e2e): explorer, severity-group-{severity},
 * issue-row-{id}; the selected row carries the `issue-row-selected` class.
 */

import type { LintIssue } from '@citesync/core';
import { groupIssuesBySeverity } from '../explorer/explorer';

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
}

export default function IssueExplorer({ issues, selectedIssueId, onSelect }: IssueExplorerProps) {
  const groups = groupIssuesBySeverity(issues);
  return (
    <section className="issue-explorer" data-testid="explorer" aria-label="Issues by severity">
      <h2>Issues</h2>
      {groups.length === 0 ? (
        <p className="issue-explorer-empty">No issues found.</p>
      ) : (
        groups.map((group) => (
          <div
            key={group.severity}
            className={`severity-group ${SEVERITY_CLASS[group.severity]}`}
            data-testid={`severity-group-${group.severity}`}
          >
            <h3 className="severity-group-header">
              <span className="severity-group-name">{group.severity}</span>
              <span className="severity-group-count">{group.issues.length}</span>
            </h3>
            <ul className="issue-list">
              {group.issues.map((issue) => (
                <li key={issue.id}>
                  <button
                    type="button"
                    className={`issue-row${issue.id === selectedIssueId ? ' issue-row-selected' : ''}`}
                    data-testid={`issue-row-${issue.id}`}
                    onClick={() => onSelect(issue.id)}
                  >
                    <code className="issue-row-id">{issue.id}</code>
                    <span className="issue-row-message">{issue.message}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
