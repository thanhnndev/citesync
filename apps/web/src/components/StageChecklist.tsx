/**
 * T5 — the PRD §61 five-stage checklist.
 *
 * Rendered from `PIPELINE_STAGES` (imported from @citesync/core) — the SAME
 * canonical array the engine emits through `onStage` — so the checklist can
 * never drift from the stages that actually run (D025: stage names are the
 * internal contract; the frozen report schema D020/D024 never changes).
 *
 * Status per item: ✓ done / ● current / ○ pending. `stageStatus` is PURE and
 * exported for node-env unit tests (no DOM needed). After `done` all five
 * items are ✓ and stay persisted (e2e asserts post-completion, T6).
 *
 * data-testid contract (FROZEN for T6 e2e): `stage-${stage}` on every item,
 * e.g. data-testid="stage-running-checks".
 */

import { PIPELINE_STAGES } from '@citesync/core';
import type { PipelineStage } from '@citesync/core';

/** Checklist state of one stage. */
export type StageStatus = 'done' | 'current' | 'pending';

/**
 * Deterministic status of one stage from the stages received so far.
 * `received` is a prefix of PIPELINE_STAGES (emission order, R008):
 *   - stageIdx < received.length → done (already reported),
 *   - stageIdx === received.length && analyzing → current (in flight),
 *   - otherwise → pending.
 * Unknown stage names (defensive) collapse to pending.
 */
export function stageStatus(
  stage: PipelineStage,
  received: readonly PipelineStage[],
  analyzing: boolean,
): StageStatus {
  const stageIndex = PIPELINE_STAGES.indexOf(stage);
  if (stageIndex === -1) return 'pending';
  if (stageIndex < received.length) return 'done';
  if (analyzing && stageIndex === received.length) return 'current';
  return 'pending';
}

/** Friendly display labels for the five stages (internal names stay visible). */
const STAGE_LABELS: Record<PipelineStage, string> = {
  'reading-document': 'Reading document',
  'detecting-bibliography': 'Detecting bibliography',
  'finding-citations': 'Finding citations',
  'matching-references': 'Matching references',
  'running-checks': 'Running checks',
};

const STATUS_MARKER: Record<StageStatus, string> = { done: '\u2713', current: '\u25CF', pending: '\u25CB' };

export interface StageChecklistProps {
  /** Stages received so far, in emission order (from the state machine). */
  stages: readonly PipelineStage[];
  /** True while a run is in flight (drives the ● current state). */
  analyzing: boolean;
}

export default function StageChecklist({ stages, analyzing }: StageChecklistProps) {
  return (
    <section className="stage-checklist" aria-label="Analysis stages">
      <h2>Analysis stages</h2>
      <ol className="stage-list">
        {PIPELINE_STAGES.map((stage) => {
          const status = stageStatus(stage, stages, analyzing);
          return (
            <li key={stage} data-testid={`stage-${stage}`} className={`stage-item stage-${status}`}>
              <span className="stage-marker" aria-hidden="true">
                {STATUS_MARKER[status]}
              </span>
              <span className="stage-label">{STAGE_LABELS[stage]}</span>
              <code className="stage-name">{stage}</code>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
