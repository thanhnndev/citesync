/**
 * S03-T05 — deterministic reference-entry parse confidence (§21 `parseConfidence`
 * in [0, 1], R008).
 *
 * Pure, locale-free scoring over the structural features `parse.ts` observed
 * while parsing one bibliography entry. Multiplicative penalties for missing /
 * ambiguous parts, so the score stays in (0, 1] and more complete APA-shaped
 * entries score higher — S04 consumes this as a matching-priority signal.
 * Exact values are pinned here and in the unit tests (`references.test.ts`) so
 * the pipeline is byte-stable.
 *
 * Base 1.0 and penalties (documented policy):
 *   no year (n.d.)          × 0.7   (missing date signal)
 *   year-suffix 2018a       × 0.98  (disambiguated same-author-year form)
 *   no given name           × 0.95  (bare surname entry)
 *   > 1 author              × 0.96
 *   no title                × 0.6   (title is the core §21 field)
 *   no container            × 0.9   (book/short entry without a venue)
 *   no volume               × 0.98  (book entries carry none)
 *   no issue                × 0.98
 *   no pages                × 0.98
 *
 * The score is rounded to 4 decimals and clamped to [0.05, 1]. 0 is reserved
 * EXCLUSIVELY for grammar failure (§88): `parse.ts` emits `parseConfidence: 0`
 * with `raw` preserved verbatim when the entry does not match the reference
 * grammar at all (no year marker / no author segment) — it never flows through
 * `referenceConfidence`, which only ever receives a successful parse.
 */

/** Structural features observed by the grammar for one reference entry. */
export interface ReferenceFeatures {
  /** Number of parsed author groups (0 only for degenerate entries). */
  authorCount: number;
  /** At least one author carries a given/fore-name part. */
  hasGivenName: boolean;
  /** A numeric year was parsed (false for n.d.). */
  hasYear: boolean;
  /** The year carries a same-author disambiguation suffix ("2018a"). */
  hasYearSuffix: boolean;
  /** A title was extracted. */
  hasTitle: boolean;
  /** A container (journal/book/venue) was extracted. */
  hasContainer: boolean;
  /** Volume identifier parsed from the container tail. */
  hasVolume: boolean;
  /** Issue identifier parsed from the container tail. */
  hasIssue: boolean;
  /** Pages parsed from the container tail. */
  hasPages: boolean;
  /** A DOI was found (doi:/https://doi.org/). */
  hasDoi: boolean;
}

/** The canonical feature set for a clean full APA entry (confidence 1). */
export const BASE_REFERENCE_FEATURES: ReferenceFeatures = {
  authorCount: 1,
  hasGivenName: true,
  hasYear: true,
  hasYearSuffix: false,
  hasTitle: true,
  hasContainer: true,
  hasVolume: true,
  hasIssue: true,
  hasPages: true,
  hasDoi: false,
};

/**
 * Deterministic [0, 1] parse confidence for a successfully parsed entry.
 * Pure function of the features — same input, same output (R008).
 */
export function referenceConfidence(f: ReferenceFeatures): number {
  let c = 1;
  if (!f.hasYear) c *= 0.7;
  if (f.hasYearSuffix) c *= 0.98;
  if (!f.hasGivenName) c *= 0.95;
  if (f.authorCount > 1) c *= 0.96;
  if (!f.hasTitle) c *= 0.6;
  if (!f.hasContainer) c *= 0.9;
  if (!f.hasVolume) c *= 0.98;
  if (!f.hasIssue) c *= 0.98;
  if (!f.hasPages) c *= 0.98;
  if (f.hasDoi) c *= 1;
  const rounded = Math.round(c * 10000) / 10000;
  return Math.min(1, Math.max(0.05, rounded));
}
