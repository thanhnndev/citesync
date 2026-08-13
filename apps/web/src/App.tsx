/**
 * T5 — the complete CiteSync shell (replaces the T1/T3 proof UI).
 *
 * Layout: header (title + always-present ProcessingBadge) → DropZone →
 * §61 StageChecklist → ReportSummary (done) | error panel (error). On a done
 * envelope the S02 explorer takes over: IssueExplorer (severity-grouped,
 * R012) + DocumentView (click-to-source highlight, R009) + EvidencePanel
 * (the selected issue's deterministic evidence + possible references) +
 * BibliographyRecoveryPanel (below-threshold bibliography — PRD §63
 * ask-user). Picking a recovery section re-runs the SAME retained bytes with
 * the user-chosen heading via `rerun({ bibliographyBlockIds: [id] })` — the
 * T3 recovery seam.
 *
 * Selection: `selectedIssueId` clears whenever the run status leaves 'done'
 * (a fresh file or a recovery re-run flips status to 'analyzing' — a
 * deterministic reset, R008). The panel lookup also guards stale ids: an id
 * that no longer exists in the new issue list simply renders nothing.
 *
 * data-testid contract (FROZEN for T6 e2e, must never change):
 *   - file-input, drop-zone           (DropZone)
 *   - processing-badge                (always mounted; text switches with state)
 *   - stage-{stage}                   (StageChecklist, 5 items)
 *   - report-summary                  (done)
 *   - explorer, severity-group-{severity}, issue-row-{id} (IssueExplorer)
 *   - doc-view, source-highlight      (DocumentView)
 *   - evidence-panel, evidence-code-{code}, possible-ref-{entryId} (EvidencePanel)
 *   - recovery-panel, recovery-candidate-{blockId}, recovery-use-{blockId} (BibliographyRecoveryPanel)
 *   - error-panel                     (error)
 */

import { useEffect, useState } from 'react';
import BibliographyRecoveryPanel from './components/BibliographyRecoveryPanel';
import DocumentView from './components/DocumentView';
import DropZone from './components/DropZone';
import EvidencePanel from './components/EvidencePanel';
import IssueExplorer from './components/IssueExplorer';
import ReportSummary from './components/ReportSummary';
import StageChecklist from './components/StageChecklist';
import { useAnalyze } from './hooks/useAnalyze';
import type { AnalyzeStatus } from './hooks/useAnalyze';
import { describeWorkerError } from './worker/protocol';
import './app.css';

/** Badge text per state — the badge element ALWAYS exists, text drives e2e. */
const BADGE_TEXT: Record<AnalyzeStatus, string> = {
  idle: 'Ready — analysis runs locally in your browser',
  analyzing: 'Processing locally',
  done: 'Processed locally — never left this device',
  error: 'Analysis runs locally in your browser',
};

export default function App() {
  const { state, analyze, rerun } = useAnalyze();
  const [selectedIssueId, setSelectedIssueId] = useState<string | undefined>(undefined);

  // Selection lives only in a done envelope: a fresh file or a recovery
  // re-run flips status to 'analyzing' and resets the selection (R008).
  useEffect(() => {
    if (state.status !== 'done') setSelectedIssueId(undefined);
  }, [state.status]);

  const done = state.status === 'done';
  const issues = done ? state.report?.issues ?? [] : [];
  const selectedIssue = issues.find((issue) => issue.id === selectedIssueId);
  const bibliography = state.doc?.bibliography;

  return (
    <main className="app-shell">
      <header className="app-header">
        <h1>CiteSync</h1>
        <p className="processing-badge" data-testid="processing-badge" role="status">
          {BADGE_TEXT[state.status]}
        </p>
      </header>

      <DropZone onAnalyze={analyze} />

      <StageChecklist stages={state.stages} analyzing={state.status === 'analyzing'} />

      {done && state.report !== undefined && state.doc !== undefined && (
        <>
          <ReportSummary report={state.report} />
          <div className="explorer-layout">
            <IssueExplorer
              issues={state.report.issues}
              selectedIssueId={selectedIssueId}
              onSelect={setSelectedIssueId}
            />
            <div className="doc-column">
              <DocumentView
                doc={state.doc}
                selectedIssue={selectedIssue}
                onSelect={setSelectedIssueId}
              />
              {selectedIssue !== undefined && (
                <EvidencePanel issue={selectedIssue} doc={state.doc} />
              )}
            </div>
          </div>
          {bibliography?.outcome === 'below-threshold' && (
            <BibliographyRecoveryPanel
              bibliography={bibliography}
              onUseSection={(blockId) => {
                setSelectedIssueId(undefined);
                void rerun({ bibliographyBlockIds: [blockId] });
              }}
            />
          )}
        </>
      )}

      {state.status === 'error' && state.error !== undefined && (
        <div className="error-panel" data-testid="error-panel" role="alert">
          <strong>{describeWorkerError(state.error.name)}</strong>
          <span className="error-message">{state.error.message}</span>
        </div>
      )}
    </main>
  );
}
