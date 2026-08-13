/**
 * M002-S01-T1 — deterministic numeric citation confidence (R008, [0,1]).
 *
 * A pure, locale-free scoring function over the structural features the
 * numeric grammar observed. Same input, same output — pinned here and in
 * `numeric.test.ts` so the pipeline is byte-stable.
 *
 * Base 1.0 and penalties (documented policy):
 *   > 1 index token (list form)  × 0.97  ("[1,2]")
 *   range form present           × 0.95  ("[1-4]", "[1,2,4-5]")
 *
 * So: [1] → 1.0 · [1,2] → 0.97 · [1-4] → 0.95 · [1,2,4-5] → 0.9215.
 * The score is rounded to 4 decimals and clamped to [0.05, 1]; 0 never
 * occurs here (only cleanly parsed brackets are emitted — 0 is the invalid
 * / non-citation outcome marker, not a score).
 */

/** Structural features observed by the numeric grammar for one bracket. */
export interface NumericFeatures {
  /** Number of index tokens (single + range) in the bracket. */
  tokenCount: number;
  /** Number of flattened indices (`[1-4]` → 4, `[1,2]` → 2). */
  indexCount: number;
  /** At least one token is a range ("1-4"). */
  hasRange: boolean;
}

/** The canonical feature set for a clean single `[1]` citation. */
export const BASE_NUMERIC_FEATURES: NumericFeatures = {
  tokenCount: 1,
  indexCount: 1,
  hasRange: false,
};

/**
 * Deterministic [0, 1] confidence for one numeric citation occurrence.
 * Pure function of the features — same input, same output (R008).
 */
export function numericConfidence(f: NumericFeatures): number {
  let c = 1;
  if (f.tokenCount > 1) c *= 0.97;
  if (f.hasRange) c *= 0.95;
  const rounded = Math.round(c * 10000) / 10000;
  return Math.min(1, Math.max(0.05, rounded));
}
