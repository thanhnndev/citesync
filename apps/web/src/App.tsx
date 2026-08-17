/**
 * T5 — the complete CiteSync shell (replaces the T1/T3 proof UI).
 *
 * Layout: header (title + always-present ProcessingBadge + locale) → state
 * region:
 *   - idle      → centered hero (OnboardingHero) + DropZone (mockup 5.1/5.9)
 *   - analyzing → centered compact run panel: DropZone + StageChecklist
 *   - error     → centered compact run panel: DropZone + StageChecklist
 *                 (stages reached persist — failure isolation, PRD §88) +
 *                 error-panel with guidance layer (i18n under the FROZEN
 *                 describeWorkerError text)
 *   - done      → toolbar (ReportSummary + ExportPanel) + explorer grid
 *                 (IssueExplorer | DocumentView/EvidencePanel/Resolution
 *                 Picker) + BibliographyRecoveryPanel (below-threshold)
 *
 * M005-S02-T4 (Tailwind v4 — user directive): full-viewport shell —
 * DESKTOP fits 100dvh (view-center/view-done regions; explorer columns
 * scroll internally, no deep page scroll), width 1240px max; mobile grows
 * naturally. No-deadflow: the drop zone stays mounted for analyzing/error
 * (a fresh file anywhere is an escape hatch), and a 'New document' reset
 * button (testid new-document) in the header returns done → idle. Sticky
 * header, 4-state flow, error guidance, idle shell. testids + state
 * machine FROZEN.
 *
 * Selection: `selectedIssueId` clears whenever the run status leaves 'done'
 * (a fresh file or a recovery re-run flips status to 'analyzing' — a
 * deterministic reset, R008). The panel lookup also guards stale ids: an id
 * that no longer exists in the new issue list simply renders nothing.
 *
 * data-testid contract (FROZEN for T6 e2e, must never change):
 *   - file-input, drop-zone           (DropZone — mounted for idle/analyzing/error)
 *   - processing-badge                (always mounted; text switches with state)
 *   - stage-{stage}                   (StageChecklist, 5 items)
 *   - report-summary                  (done)
 *   - export-panel, export-json, export-html, export-error (ExportPanel)
 *   - explorer, severity-group-{severity}, issue-row-{id} (IssueExplorer)
 *   - doc-view, source-highlight      (DocumentView)
 *   - evidence-panel, evidence-code-{code}, possible-ref-{entryId} (EvidencePanel)
 *   - resolution-picker, resolution-candidate-{entryId}, resolution-choose-{entryId},
 *     resolution-chosen-{entryId}     (ResolutionPicker)
 *   - recovery-panel, recovery-candidate-{blockId}, recovery-use-{blockId} (BibliographyRecoveryPanel)
 *   - error-panel                     (error)
 *   - new-document                    (M005-S02-T4 reset — NOT in the frozen set)
 */

import { useEffect, useMemo, useState } from 'react';
import BibliographyRecoveryPanel from './components/BibliographyRecoveryPanel';
import DocumentView from './components/DocumentView';
import DropZone from './components/DropZone';
import EvidencePanel from './components/EvidencePanel';
import ExportPanel from './components/ExportPanel';
import IssueExplorer from './components/IssueExplorer';
import OnboardingHero from './components/OnboardingHero';
import ReportSummary from './components/ReportSummary';
import ResolutionPicker from './components/ResolutionPicker';
import StageChecklist from './components/StageChecklist';
import { useAnalyze } from './hooks/useAnalyze';
import type { AnalyzeStatus } from './hooks/useAnalyze';
import { useResolutions } from './hooks/useResolutions';
import { resolutionCandidatesForIssue } from './explorer/explorer';
import { applyResolutions } from './resolutions/resolutions';
import type { ResolutionsView } from './resolutions/resolutions';
import { describeWorkerError, errorGuidanceKey } from './worker/protocol';
import { useI18n } from './i18n/useI18n';
import type { I18nKey } from './i18n/dictionary';
import type { Locale } from './i18n/dictionary';
import './design-system.css';
import './app.css';

/** Badge key per state — the badge element ALWAYS exists, text drives e2e. */
const BADGE_KEY: Record<AnalyzeStatus, I18nKey> = {
  idle: 'common.badge.ready',
  analyzing: 'common.badge.processing',
  done: 'common.badge.done',
  error: 'common.badge.error',
};

/** Locale switch (T04 — thô): the two supported locales, EN default. */
const LOCALE_OPTIONS: readonly { value: Locale; label: string }[] = [
  { value: 'en', label: 'EN' },
  { value: 'vi', label: 'VI' },
];

export default function App() {
  const { state, analyze, rerun, reset } = useAnalyze();
  const { t, locale, setLocale } = useI18n();
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
    <main className="app-shell md:h-dvh md:overflow-hidden">
      <header className="app-header">
        <h1>CiteSync</h1>
        <div className="app-header-actions flex items-center gap-3">
          <p className="processing-badge" data-testid="processing-badge" role="status">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                state.status === 'analyzing' ? 'animate-pulse bg-accent' : 'bg-done'
              }`}
              aria-hidden="true"
            />
            {t(BADGE_KEY[state.status])}
          </p>
          {/* M005-S02-T4 no-deadflow: done always has an explicit way back
              to the idle shell (fresh document) — tab-accessible, ⌘-safe. */}
          {done && (
            <button
              type="button"
              className="cursor-pointer rounded-md border border-border-strong bg-surface px-3 py-1.5 text-xs font-semibold text-ink transition-colors duration-150 hover:bg-subtle hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-[0.96]"
              data-testid="new-document"
              onClick={reset}
            >
              {t('common.new-document')}
            </button>
          )}
          <div className="locale-switch flex items-center gap-1 rounded-md border border-border bg-surface p-0.5" role="group" aria-label={t('common.language')}>
            {LOCALE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`locale-switch-option cursor-pointer rounded px-2 py-1 text-xs font-medium transition-colors duration-150 ${
                  locale === option.value
                    ? 'bg-accent text-inverse'
                    : 'text-muted hover:bg-subtle hover:text-ink'
                }`}
                aria-pressed={locale === option.value}
                onClick={() => setLocale(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {state.status === 'idle' ? (
        /* M005-S02-T4 idle: centered hero + drop (mockup 5.1/5.9). */
        <div className="view-center">
          <OnboardingHero />
          <DropZone onAnalyze={analyze} />
        </div>
      ) : state.status === 'done' && state.report !== undefined && state.doc !== undefined ? (
        /* M005-S02-T4 done: toolbar + explorer, 100dvh on desktop — the
            explorer columns scroll internally, no deep page scroll. */
        <div className="view-done">
          <div className="shrink-0">
            <StageChecklist stages={state.stages} analyzing={false} compact />
          </div>
          <div className="shrink-0 md:grid md:grid-cols-[1fr_auto] md:items-start md:gap-4">
            <ReportSummary report={state.report} />
            <ExportPanel report={state.report} />
          </div>
          <div className="explorer-layout grid min-h-0 flex-1 gap-4 md:grid-cols-[1fr_1.35fr]">
            <div className="min-h-0 overflow-y-auto pr-1">
              <IssueExplorer
                issues={issues}
                selectedIssueId={selectedIssueId}
                onSelect={setSelectedIssueId}
                resolvedByIssue={view.byIssue}
                resolvedCounts={view.resolvedCounts}
              />
            </div>
            <div className="doc-column flex min-h-0 flex-col gap-4 overflow-y-auto pr-1">
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
            <div className="shrink-0">
              <BibliographyRecoveryPanel
                bibliography={bibliography}
                onUseSection={(blockId) => {
                  setSelectedIssueId(undefined);
                  void rerun({ bibliographyBlockIds: [blockId] });
                }}
              />
            </div>
          )}
        </div>
      ) : (
        /* analyzing | error: centered compact run panel — the drop zone
            stays mounted (fresh file anywhere = escape hatch, smoke e2e
            asserts it), stages persist on error (PRD §88). */
        <div className="view-center">
          <DropZone onAnalyze={analyze} />
          <div className="w-full max-w-xl">
            <StageChecklist
              stages={state.stages}
              analyzing={state.status === 'analyzing'}
            />
            {state.status === 'error' && state.error !== undefined && (
              <div
                className="error-panel mt-4 rounded-lg border border-severity-error bg-surface p-4 shadow-sm"
                data-testid="error-panel"
                role="alert"
              >
                <strong className="font-semibold text-severity-error">
                  {describeWorkerError(state.error.name)}
                </strong>
                <span className="error-message mt-1 block text-sm text-ink">
                  {state.error.message}
                </span>
                {/* M005-S02-T3: guidance layer — i18n copy under the FROZEN
                    message (UI-SPEC §3.3). The describeWorkerError text/
                    err.name never change; this span is the recoverable-action
                    hint. */}
                <span className="error-guidance mt-2 block text-sm text-muted">
                  {t(errorGuidanceKey(state.error.name))}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}