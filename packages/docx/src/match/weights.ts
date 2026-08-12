/**
 * S04-T1 — §26 tunable matching weights + §27/§79 thresholds (S04 owns the
 * benchmark-calibrated matching engine; MEM004/MEM048).
 *
 * PRD §26 gives INDICATIVE weights — first author 0.40 / year 0.35 /
 * additional authors 0.15 / year suffix 0.05 / other 0.05 — and mandates
 * that exact weights "MUST be benchmark-driven". This module is the named,
 * tunable adjustment surface (MEM048): the scorer in `score.ts` consumes
 * these constants, and the dedicated match fixtures under `fixtures/match/`
 * are the calibration corpus that pins them (the same-author-two-years
 * fixture is the first one, authored in S04-T1).
 *
 * CONSERVATIVE BIAS (§79): the false-positive rate is the #1 product metric;
 * the engine must prefer "I am uncertain" over "This is wrong" when evidence
 * is insufficient. The thresholds below are chosen so a wrong-YEAR pairing
 * can never cross `MATCH_THRESHOLD`: the maximum score a citation can reach
 * against a year-mismatched entry is
 *
 *   firstAuthor 0.40 + additionalAuthors 0.15 + yearSuffix 0.05 + other 0.05
 *   = 0.65  (year contributes 0 on mismatch)
 *
 * strictly below `MATCH_THRESHOLD` = 0.7. The same-author-two-years fixture
 * proves this executable: a "Doe (2018)" citation against the "Doe (2021)"
 * entry scores 0.6 (the year-axis mismatch also zeroes the suffix component,
 * so the theoretical 0.65 maximum is never reached here) → never a confident
 * MATCHED (§79 false-positive class closed).
 *
 * All values here are pure constants (R008): no clock, no random, no locale.
 */

/** §26 named weight set — the calibration surface (MEM004/MEM048). */
export interface MatchWeights {
  /** First-author surname agreement (§25 tier ladder). Default 0.40. */
  firstAuthor: number;
  /** Publication-year agreement. Default 0.35. */
  year: number;
  /** Additional cited authors agreement. Default 0.15. */
  additionalAuthors: number;
  /** Same-author-year disambiguation suffix. Default 0.05. */
  yearSuffix: number;
  /** Other metadata evidence (page). Default 0.05. */
  other: number;
}

/** §26 default weights (PRD indicative values, benchmark-pinned by fixtures). */
export const MATCH_WEIGHTS: MatchWeights = {
  firstAuthor: 0.4,
  year: 0.35,
  additionalAuthors: 0.15,
  yearSuffix: 0.05,
  other: 0.05,
};

/**
 * §27/§79 — score at or above which a candidate is a CONFIDENT match.
 *
 * 0.7 sits strictly above the maximum wrong-year score (0.65), so no
 * year-mismatched candidate can ever be MATCHED — the §79 false-positive
 * guard. A single candidate at/above this threshold → MATCHED; multiple
 * candidates at/above it with a tight margin → AMBIGUOUS (T2 policy).
 */
export const MATCH_THRESHOLD = 0.7;

/**
 * §27/§79 — score at or above which a sub-threshold candidate still carries
 * enough partial evidence to be worth flagging as a near-miss.
 *
 * The top candidate scoring in [POSSIBLE_MISMATCH_THRESHOLD, MATCH_THRESHOLD)
 * → POSSIBLE_MISMATCH (a low-confidence warning, never a confident state);
 * everything below → MISSING_REFERENCE (no usable evidence, §79 no-guess).
 */
export const POSSIBLE_MISMATCH_THRESHOLD = 0.4;

/**
 * §27 — minimum top-vs-second score gap required to resolve a MATCHED target
 * when multiple candidates clear `MATCH_THRESHOLD`.
 *
 * Two candidates both ≥ MATCH_THRESHOLD whose scores are within this margin
 * → AMBIGUOUS (the engine never auto-picks, §27 "never resolves ambiguity").
 * Deterministic tie-break: stable sort by (score desc, entry index asc).
 */
export const MATCH_MARGIN = 0.1;
