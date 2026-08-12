/**
 * S04 — matching engine public surface (T1: weights + scorer; T2 adds the
 * match-map orchestration `buildMatchMap`).
 *
 * Exposes the §26 named tunable weight set, the §27/§79 thresholds, and the
 * §25 tier-ladder + §26 weighted per-citation×per-entry scorer. All pure and
 * deterministic (R008) — the benchmark-calibration corpus under
 * `fixtures/match/` pins their exact values.
 */

export {
  MATCH_WEIGHTS,
  MATCH_THRESHOLD,
  POSSIBLE_MISMATCH_THRESHOLD,
  MATCH_MARGIN,
} from './weights.js';
export type { MatchWeights } from './weights.js';

export { scoreCitationAgainstEntry, AUTHOR_TIER } from './score.js';
export type { CitationScore } from './score.js';
