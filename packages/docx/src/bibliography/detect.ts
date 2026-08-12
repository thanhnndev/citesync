/**
 * @citesync/docx — S02 weighted-signal bibliography detector (D009 contract).
 *
 * The pure core of S02: turns S01's already-classified {@link DocumentBlock}s
 * into a {@link BibliographyDetectionResult} (detected / below-threshold /
 * none) with a confidence score in [0, 1]. It operates on the S01 blocks where
 * `block.type === 'heading'` is the primary heading signal and `block.style`
 * is the styleId passthrough (S01 already classifies style-based headings as
 * `type: 'heading'` via `classifyParagraph`).
 *
 * SIGNALS + WEIGHTS (PRD §17 detection signals; documented constants below):
 *   - headingText   (0.35): the block text fold-matches one of the 7 known
 *     bilingual bibliography headings (case/diacritic-insensitive exact fold).
 *   - headingStyle  (0.15): `block.type === 'heading'` from S01 heading
 *     classification (style map / outline level).
 *   - position      (0.20): the candidate sits in the second half of the
 *     document body — a bibliography is document-final.
 *   - followingRefs (0.30): the next 1–3 body paragraphs look like reference
 *     entries ('Author, A. (Year). Title …' shape); graded 0..1 by the
 *     fraction of the 3-block lookahead that matches.
 *   Confidence = weighted sum (weights sum to 1.0). Compare against the
 *   conservative exported `BIBLIOGRAPHY_THRESHOLD = 0.6`:
 *   at/above -> 'detected'; below -> 'below-threshold' with per-candidate
 *   scores for the M003 ask-user flow. The engine NEVER silently guesses a
 *   section below threshold (R004 / PRD §17); the D009 discriminated union
 *   makes that impossible at the type level.
 *
 * WEIGHT DERIVATION (why not the 0.55/0.15/0.15/0.15 example in T03-PLAN):
 * the T02 fixture `bibliography/ambiguous.docx` is a heading-text + style
 * positive ('References' Heading1, mid-document, no reference-like follow) and
 * MUST stay below threshold ("combined signals, not heading text alone" —
 * T02-SUMMARY). With headingText 0.55 + headingStyle 0.15 = 0.70 it would be
 * silently detected, so the text weight is capped below 0.4. The chosen set
 * keeps headingText the strongest single signal while leaving comfortable
 * margins on every fixture path:
 *   en-references / vi-tai-lieu   0.80–1.00 -> detected (high confidence)
 *   style-position (no exact text) 0.65     -> detected (weighted-signal combo)
 *   ambiguous (exact text, no refs) 0.50    -> below-threshold (ask user)
 *   no-bibliography                no candidate -> 'none'
 *
 * DETERMINISM (R008): pure function of the input — no clock, no random, no
 * I/O. String.normalize('NFD') folding and the /u regexes are deterministic;
 * candidate ordering is a total order (confidence desc, body index asc) so
 * equal scores never depend on iteration order.
 */

import type {
  BibliographyCandidate,
  BibliographyDetectionResult,
  BibliographySection,
  DocumentBlock,
} from '@citesync/document-model';

/** Conservative detection threshold (PRD §17 / R004): below it -> ask-user. */
export const BIBLIOGRAPHY_THRESHOLD = 0.6;

// Signal weights (sum to 1.0 -> confidence is naturally in [0, 1]).
const HEADING_TEXT_WEIGHT = 0.35;
const HEADING_STYLE_WEIGHT = 0.15;
const POSITION_WEIGHT = 0.2;
const FOLLOWING_REFERENCE_LIKE_WEIGHT = 0.3;

/** The 7 known bilingual bibliography headings (PRD §17). */
const KNOWN_HEADINGS: readonly string[] = [
  'References',
  'Reference',
  'Bibliography',
  'Works Cited',
  'Literature Cited',
  'Tài liệu tham khảo',
  'Danh mục tài liệu tham khảo',
];

/** Folded forms (case/diacritic/whitespace-insensitive) for exact matching. */
const KNOWN_HEADINGS_FOLDED: ReadonlySet<string> = new Set(KNOWN_HEADINGS.map(fold));

/** Lookahead window: the next 1–3 body paragraphs may be reference entries. */
const REFERENCE_LIKE_LOOKAHEAD = 3;

/**
 * Reference-entry shape: `Author, A. (Year). Title …` — a line that STARTS
 * with a name run then a 4-digit year in parentheses closed by '.' or ':'
 * (e.g. "Doe, J. (2017). Citation practice …", "Nguyễn, V. A. (2015). …").
 * Conservative by design: narrative in-text citations ("Smith (2020) noted …",
 * "(Doe, 2017) highlights …") do not match because the year paren is not
 * line-final (followed by a period/colon) or the line contains characters
 * outside the name run. Missing shapes (numeric "[1] Doe …", "Doe, J., 2017.")
 * simply score lower and fall to the ask-user path — never a silent guess.
 */
const REFERENCE_LIKE_RE =
  /^[\p{L}][\p{L}\s.,'’“”&–-]{1,80}\(\d{4}\)[.:]/u;

/**
 * Fold text for signal comparison: lowercase, strip combining diacritics
 * (NFD + remove U+0300–U+036F), collapse whitespace. "Tài liệu tham khảo",
 * "TAI LIEU THAM KHAO" and "Tài liệu   tham khảo" all fold to the same key.
 */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** A body paragraph shaped like a bibliography reference entry. */
function isReferenceLike(block: DocumentBlock): boolean {
  return REFERENCE_LIKE_RE.test(block.text);
}

/** Body blocks only — the bibliography lives in the body, never in notes. */
function bodyBlocks(blocks: DocumentBlock[]): DocumentBlock[] {
  return blocks.filter(
    (b) => b.type !== 'footnote' && b.type !== 'endnote',
  );
}

/** One scored heading candidate (internal scoring shape). */
interface ScoredCandidate {
  block: DocumentBlock;
  /** 0-based index within `AcademicDocument.blocks` (document order). */
  bodyIndex: number;
  /** Fired signals (for headingType labelling). */
  exact: boolean;
  isHeading: boolean;
  late: boolean;
  /** Fraction of the 3-block reference-like lookahead that matched [0..1]. */
  referenceLikeFraction: number;
  confidence: number;
}

/**
 * Detect the bibliography section against S01 blocks.
 *
 * Outcome branches (D009):
 *   - `detected`       — the best candidate cleared BIBLIOGRAPHY_THRESHOLD;
 *     section carries heading + confidence + ordered blockIds (heading first,
 *     then the consecutive reference-like run — S03's entry-parsing scope).
 *   - `below-threshold`— candidates exist but none cleared the threshold:
 *     returns the ask-user outcome (candidates + best confidence), NEVER a
 *     guessed section (R004 / PRD §17).
 *   - `none`           — no plausible bibliography heading at all.
 *
 * Pure and deterministic: no clock, no random, no I/O.
 */
export function detectBibliography(
  blocks: DocumentBlock[],
): BibliographyDetectionResult {
  const body = bodyBlocks(blocks);
  if (body.length === 0) return { outcome: 'none' };

  const scored: ScoredCandidate[] = [];

  for (let i = 0; i < body.length; i += 1) {
    const block = body[i];
    if (block === undefined) continue; // noUncheckedIndexedAccess guard
    if (block.text.trim() === '') continue; // blank headings are noise

    const exact = KNOWN_HEADINGS_FOLDED.has(fold(block.text));
    const isHeading = block.type === 'heading';
    // A plausible bibliography heading: S01 says it is a heading, or its text
    // is exactly one of the 7 known bibliography headings (covers documents
    // where the heading lost its style and is a plain paragraph).
    if (!isHeading && !exact) continue;

    const late = i >= body.length / 2; // second half of the body
    const referenceLikeFraction = referenceLikeFractionAfter(body, i);
    const confidence = Math.min(
      1,
      (exact ? HEADING_TEXT_WEIGHT : 0) +
        (isHeading ? HEADING_STYLE_WEIGHT : 0) +
        (late ? POSITION_WEIGHT : 0) +
        referenceLikeFraction * FOLLOWING_REFERENCE_LIKE_WEIGHT,
    );

    scored.push({ block, bodyIndex: i, exact, isHeading, late, referenceLikeFraction, confidence });
  }

  if (scored.length === 0) return { outcome: 'none' };

  // Total order: confidence desc, then body index asc (deterministic ties).
  scored.sort((a, b) => b.confidence - a.confidence || a.bodyIndex - b.bodyIndex);
  const best = scored[0];
  if (best === undefined) return { outcome: 'none' }; // unreachable (scored non-empty), typed guard

  if (best.confidence >= BIBLIOGRAPHY_THRESHOLD) {
    return { outcome: 'detected', section: buildSection(body, best) };
  }

  const candidates: BibliographyCandidate[] = scored.map((c) => ({
    blockId: c.block.id,
    heading: c.block.text,
    headingType: headingTypeOf(c),
    startIndex: c.bodyIndex,
    confidence: c.confidence,
  }));
  return {
    outcome: 'below-threshold',
    candidates,
    confidence: best.confidence,
  };
}

/** Fraction of the next `REFERENCE_LIKE_LOOKAHEAD` body blocks that are reference-like. */
function referenceLikeFractionAfter(body: DocumentBlock[], start: number): number {
  let hits = 0;
  const end = Math.min(body.length, start + 1 + REFERENCE_LIKE_LOOKAHEAD);
  for (let i = start + 1; i < end; i += 1) {
    const block = body[i];
    if (block === undefined) break; // noUncheckedIndexedAccess guard
    if (isReferenceLike(block)) hits += 1;
  }
  return hits / REFERENCE_LIKE_LOOKAHEAD;
}

/**
 * Build the detected section: the heading block first, then the consecutive
 * run of reference-like blocks (the S03 entry-parsing scope). The run breaks
 * at the first non-reference-like body block; a heading with no entries at all
 * yields `[headingBlockId]` (an empty section is still a section).
 */
function buildSection(body: DocumentBlock[], best: ScoredCandidate): BibliographySection {
  const blockIds: string[] = [best.block.id];
  for (let i = best.bodyIndex + 1; i < body.length; i += 1) {
    const block = body[i];
    if (block === undefined || !isReferenceLike(block)) break; // run ends at first non-entry
    blockIds.push(block.id);
  }
  return {
    outcome: 'detected',
    heading: best.block.text,
    confidence: best.confidence,
    blockIds,
  };
}

/**
 * Which signal most plausibly raised this candidate, for the M003 ask-user
 * UI. Priority: exact known heading text > followed by reference-like
 * paragraphs (content corroboration) > document-final position > S01 heading
 * style. 'none' is unreachable today (every candidate is heading-typed or
 * exact-text) but kept in the D009 union.
 */
function headingTypeOf(c: ScoredCandidate): BibliographyCandidate['headingType'] {
  if (c.exact) return 'exact';
  if (c.referenceLikeFraction > 0) return 'reference-segment';
  if (c.late) return 'position';
  if (c.isHeading) return 'style';
  return 'none';
}
