/**
 * @citesync/docx — the frozen pipeline-stage contract (M003, PRD §61).
 *
 * The five REAL stages of a `lintDocument` pass, in canonical order: the
 * four parse-model stages emitted by {@link buildModel} (reading →
 * detecting → finding → matching) plus the rules pass stage emitted by
 * `@citesync/core`'s `lintDocument` ('running-checks'). The M003 worker
 * forwards each stage through `postMessage` and the UI renders the §61
 * checklist from `PIPELINE_STAGES` — so the checklist can never drift from
 * the stages the engine actually runs.
 *
 * CONTRACT (D025/D020): stage names are an INTERNAL contract — observable
 * by `onStage` callers (worker/UI) but never present in the frozen CLI
 * report JSON (version/meta/issues/counts, D024), whose schema must not
 * change. The names are additive: adding a stage later is a source change
 * the worker/UI must follow, never a schema break.
 *
 * DETERMINISM (R008): stages are emitted in fixed order (this array) and
 * `onStage` is purely observational — a callback can never change the
 * resulting model or report (same bytes + same options → same output, with
 * or without a callback).
 */

/** One stage of the five-stage analysis pipeline (PRD §61, verbatim names). */
export type PipelineStage =
  | 'reading-document'
  | 'detecting-bibliography'
  | 'finding-citations'
  | 'matching-references'
  | 'running-checks';

/** The five stages in canonical, deterministic order (the UI §61 checklist). */
export const PIPELINE_STAGES: readonly PipelineStage[] = [
  'reading-document',
  'detecting-bibliography',
  'finding-citations',
  'matching-references',
  'running-checks',
] as const;
