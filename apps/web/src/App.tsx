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
 *   - export-panel, export-json       (ExportPanel — done only, T2; export-html in T4)
 *   - explorer, severity-group-{severity}, issue-row-{id} (IssueExplorer)
 *   - doc-view, source-highlight      (DocumentView)
 *   - evidence-panel, evidence-code-{code}, possible-ref-{entryId} (EvidencePanel)
 *   - recovery-panel, recovery-candidate-{blockId}, recovery-use-{blockId} (BibliographyRecoveryPanel)
 *   - error-panel                     (error)
 */

import { useEffect, useMemo, useState } from 'react';
import BibliographyRecoveryPanel from './components/BibliographyRecoveryPanel';
import DocumentView from './components/DocumentView';
import DropZone from './components/DropZone';
import EvidencePanel from './components/EvidencePanel';
import ExportPanel from './components/ExportPanel';
import IssueExplorer from './components/IssueExplorer';
import ReportSummary from './components/ReportSummary';
import ResolutionPicker from './components/ResolutionPicker';
import StageChecklist from './components/StageChecklist';
import { useAnalyze } from './hooks/useAnalyze';
import type { AnalyzeStatus } from './hooks/useAnalyze';
import { useResolutions } from './hooks/useResolutions';
import { resolutionCandidatesForIssue } from './explorer/explorer';
import { applyResolutions } from './resolutions/resolutions';
import type { ResolutionsView } from './resolutions/resolutions';
import { describeWorkerError } from './worker/protocol';
import './design-system.css';
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

  // R013 (S03-T2/T3): file-scoped session resolutions — the hook reads ONLY
  // report.meta.file for its scope (client-side; never the worker/protocol).
  const { resolutions, resolve } = useResolutions(state.report);

  // R013 view overlay (T1): UI-derived resolved states + per-severity counts.
  // Pure — never mutates the canonical report or the parsed document (D020/
  // D024/R018); an empty view while not done keeps the overlay inert.
  const done = state.status === 'done';
  const view = useMemo(
    () =>
      done && state.report !== undefined && state.doc !== undefined
        ? applyResolutions(state.report, state.doc, resolutions)
        : ({ byIssue: {}, resolvedCounts: {}, totalResolved: 0 } as ResolutionsView),
    [done, state.report, state.doc, resolutions],
  );

  // Selection lives only in a done envelope: a fresh file or a recovery
  // re-run flips status to 'analyzing' and resets the selection (R008).
  useEffect(() => {
    if (state.status !== 'done') setSelectedIssueId(undefined);
  }, [state.status]);

  const issues = done ? state.report?.issues ?? [] : [];
  const selectedIssue = issues.find((issue) => issue.id === selectedIssueId);
  const bibliography = state.doc?.bibliography;
  // R013 picker surface: offered ONLY for a selected resolvable issue —
  // CS001 MISSING_REFERENCE / CS002/CS005 entry-scoped issues never reach it
  // (resolutionCandidatesForIssue returns null, §79 never-guess).
  const pickable =
    selectedIssue !== undefined && state.doc !== undefined
      ? resolutionCandidatesForIssue(state.doc, selectedIssue)
      : null;
  const chosenEntryId =
    selectedIssue === undefined ? undefined : view.byIssue[selectedIssue.id]?.chosenEntry.id;

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
          <ExportPanel report={state.report} />
          <div className="explorer-layout">
            <IssueExplorer
              issues={state.report.issues}
              selectedIssueId={selectedIssueId}
              onSelect={setSelectedIssueId}
              resolvedByIssue={view.byIssue}
              resolvedCounts={view.resolvedCounts}
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
              {pickable !== null && (
                <ResolutionPicker
                  citationId={pickable.citationId}
                  candidates={pickable.candidates}
                  chosenEntryId={chosenEntryId}
                  onChoose={(entryId) => resolve(pickable.citationId, entryId)}
                />
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
