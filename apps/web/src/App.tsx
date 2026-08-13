/**
 * T5 — the complete CiteSync shell (replaces the T1/T3 proof UI).
 *
 * Layout: header (title + always-present ProcessingBadge) → DropZone →
 * §61 StageChecklist → ReportSummary (done) | error panel (error).
 *
 * data-testid contract (FROZEN for T6 e2e, must never change):
 *   - file-input, drop-zone           (DropZone)
 *   - processing-badge                (always mounted; text switches with state)
 *   - stage-{stage}                   (StageChecklist, 5 items)
 *   - report-summary                  (done)
 *   - error-panel                     (error)
 */

import DropZone from './components/DropZone';
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
  const { state, analyze } = useAnalyze();

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

      {state.status === 'done' && state.report !== undefined && (
        <ReportSummary report={state.report} />
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
