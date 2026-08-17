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
 * M005-S02 (Tailwind v4): visual redesign per UI-SPEC mockup 5.2 — stage
 * markers ✓ green / ● accent pulsing / ○ muted, mono stage-name right, rows
 * stagger in. testids + state classes FROZEN (stage-{stage}, stage-done/
 * stage-current/stage-pending), logic untouched.
 *
 * data-testid contract (FROZEN for T6 e2e): `stage-${stage}` on every item,
 * e.g. data-testid="stage-running-checks".
 */

import { PIPELINE_STAGES } from '@citesync/core';
import type { PipelineStage } from '@citesync/core';
import { useI18n } from '../i18n/useI18n';

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

/**
 * Friendly display labels for the five stages (internal names stay visible).
 *
 * FROZEN EN by decision (UI-SPEC §7.1.1): stage labels are the engine→UI
 * contract (D025) and the visible twin of the `stage-{stage}` testid — they
 * do NOT go through i18n. A future VI label map would add a separate
 * mapping keyed by the unchanged stage name; the identity never changes.
 */
const STAGE_LABELS: Record<PipelineStage, string> = {
  'reading-document': 'Reading document',
  'detecting-bibliography': 'Detecting bibliography',
  'finding-citations': 'Finding citations',
  'matching-references': 'Matching references',
  'running-checks': 'Running checks',
};

/** Marker glyph per status (aria-hidden — label text carries the meaning). */
const STATUS_MARKER: Record<StageStatus, string> = { done: '\u2713', current: '\u25CF', pending: '\u25CB' };

/** Tailwind classes per status — marker color + row tint. */
const STATUS_CLASS: Record<StageStatus, { marker: string; row: string }> = {
  done: { marker: 'text-done', row: 'text-ink' },
  current: { marker: 'text-accent animate-pulse', row: 'bg-accent-tint text-ink' },
  pending: { marker: 'text-border-strong', row: 'text-muted' },
};

export interface StageChecklistProps {
  /** Stages received so far, in emission order (from the state machine). */
  stages: readonly PipelineStage[];
  /** True while a run is in flight (drives the ● current state). */
  analyzing: boolean;
  /**
   * M005-S02-T4: done-region compact strip — the 5-stage pipeline stays
   * visible post-completion as a single horizontal row (~48px) so the
   * 100dvh shell never grows a deep scroll column. Column layout (mockup
   * 5.2) is the default for analyzing/error.
   */
  compact?: boolean;
}

export default function StageChecklist({
  stages,
  analyzing,
  compact = false,
}: StageChecklistProps) {
  const { t } = useI18n();
  if (compact) {
    return (
      <section
        className="stage-checklist-compact"
        aria-label={t('stages.title')}
      >
        <ol className="m-0 flex list-none flex-wrap items-center gap-2 p-0">
          {PIPELINE_STAGES.map((stage, index) => {
            const status = stageStatus(stage, stages, analyzing);
            const classes = STATUS_CLASS[status];
            return (
              <li
                key={stage}
                data-testid={`stage-${stage}`}
                className={`stage-item stage-${status} flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 ${classes.row}`}
                style={{ animationDelay: `${index * 100}ms` }}
              >
                <span className={`stage-marker font-mono text-xs ${classes.marker}`} aria-hidden="true">
                  {STATUS_MARKER[status]}
                </span>
                <span className="stage-label text-xs font-medium">
                  {STAGE_LABELS[stage]}
                </span>
              </li>
            );
          })}
        </ol>
      </section>
    );
  }
  return (
    <section className="stage-checklist" aria-label={t('stages.title')}>
      <h2 className="m-0 mb-3 font-display text-lg font-semibold text-ink">
        {t('stages.title')}
      </h2>
      <ol className="m-0 flex list-none flex-col gap-1 p-0">
        {PIPELINE_STAGES.map((stage, index) => {
          const status = stageStatus(stage, stages, analyzing);
          const classes = STATUS_CLASS[status];
          return (
            <li
              key={stage}
              data-testid={`stage-${stage}`}
              className={`stage-item stage-${status} flex items-center gap-3 rounded-md px-3 py-2 transition-colors duration-150 ${classes.row}`}
              style={{ animationDelay: `${index * 100}ms` }}
            >
              <span className={`stage-marker w-5 shrink-0 text-center font-mono ${classes.marker}`} aria-hidden="true">
                {STATUS_MARKER[status]}
              </span>
              <span className="stage-label text-sm">{STAGE_LABELS[stage]}</span>
              <code className="stage-name ml-auto font-mono text-xs text-muted">{stage}</code>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
