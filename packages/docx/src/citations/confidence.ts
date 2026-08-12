/**
 * S03-T03 — deterministic citation confidence (§20 `confidence: [0,1]`).
 *
 * A pure, locale-free scoring function (R008) over the structural features
 * the grammar observed. Multiplicative penalties for form ambiguity, so the
 * score stays in (0, 1] and more unusual forms score lower — S04 consumes
 * this as a matching-priority signal. Exact values are pinned here and in the
 * unit tests (`citations.test.ts`) so the pipeline is byte-stable.
 *
 * Base 1.0 and penalties (documented policy):
 *   narrative form          × 0.9   (name/date split across the paren)
 *   Harvard no-comma        × 0.85  ("(Nguyen 2021)")
 *   > 1 real author         × 0.93
 *   et al.                  × 0.9   (abbreviated author list)
 *   multi-year              × 0.92  ("(Smith, 2020, 2022)")
 *   year-suffix             × 0.95  ("(Smith, 2021a)")
 *   multi-citation (;)      × 0.9   ("(A, 2020; B, 2019)")
 *   page present            × 0.97
 *   no year (n.d.)          × 0.7
 *   no author at all        × 0.55  ("(n.d.)" missing-author edge case)
 *
 * The score is rounded to 4 decimals and clamped to [0.05, 1]; a citation is
 * only ever emitted when the grammar succeeded, so 0 never occurs here (0 is
 * the reference-parse failure marker, T05).
 */

/** Structural features observed by the grammar for one occurrence. */
export interface CitationFeatures {
  /** Narrative `Author (year)` form (authors before the paren). */
  narrative: boolean;
  /** Harvard no-comma parenthetical "(Nguyen 2021)". */
  noComma: boolean;
  /** Number of REAL authors (excluding the "et al." pseudo-author). */
  authorCount: number;
  /** The citation uses an "et al." abbreviated author list. */
  hasEtAl: boolean;
  /** Number of distinct cited years (multi-year → > 1). */
  years: number;
  /** At least one year carries a suffix ("2021a"). */
  hasSuffix: boolean;
  /** Semicolon-separated multi-citation "(A, 2020; B, 2019)". */
  multiCitation: boolean;
  /** A page number was parsed ("p. 12"). */
  hasPage: boolean;
  /** The date is n.d. (no year). */
  noYear: boolean;
  /** No author name at all ("(n.d.)" missing-author edge case). */
  noAuthor: boolean;
}

/** The canonical feature set for a clean single "(Smith, 2024)" citation. */
export const BASE_FEATURES: CitationFeatures = {
  narrative: false,
  noComma: false,
  authorCount: 1,
  hasEtAl: false,
  years: 1,
  hasSuffix: false,
  multiCitation: false,
  hasPage: false,
  noYear: false,
  noAuthor: false,
};

/**
 * Deterministic [0, 1] confidence for one citation occurrence.
 * Pure function of the features — same input, same output (R008).
 */
export function citationConfidence(f: CitationFeatures): number {
  let c = 1;
  if (f.narrative) c *= 0.9;
  if (f.noComma) c *= 0.85;
  if (f.authorCount > 1) c *= 0.93;
  if (f.hasEtAl) c *= 0.9;
  if (f.years > 1) c *= 0.92;
  if (f.hasSuffix) c *= 0.95;
  if (f.multiCitation) c *= 0.9;
  if (f.hasPage) c *= 0.97;
  if (f.noYear) c *= 0.7;
  if (f.noAuthor) c *= 0.55;
  const rounded = Math.round(c * 10000) / 10000;
  return Math.min(1, Math.max(0.05, rounded));
}
