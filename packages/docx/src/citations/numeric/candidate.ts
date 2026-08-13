/**
 * M002-S01-T1 — bracketed numeric citation candidate detection (R007).
 *
 * Structural half of the numeric-family detector (M001's `candidate.ts`
 * pattern, square-bracket edition). Scans a block's text for every balanced
 * `[ ... ]` region and hands each to the grammar (`grammar.ts`), which
 * decides whether it is a clean numeric citation, a malformed numeric
 * attempt (surfaced for CS007), or not a citation at all.
 *
 * Only ONE structural shape is looked for: a balanced `[ ... ]` region,
 * nesting-aware, using a bracket stack (mirrors `findParentheticalRegions`).
 * An unbalanced `[` with no matching `]` yields no region (conservative).
 * Region emission order is by OPEN offset (document order), so occurrence
 * ids stay deterministic (R008).
 *
 * Over-match is the grammar's job: `[Figure 2]`, `[Appendix A]`,
 * `[Smith, 2024]` and `[1, x]` are all balanced regions here — the grammar
 * classifies each as non-numeric / invalid-numeric and never half-emits.
 *
 * All offsets are CHARACTER offsets into `block.text` (S01 offset semantics:
 * end-exclusive, UTF-16 code units), so `text.slice(startOffset, endOffset)`
 * round-trips exactly (R009).
 */

/** A balanced `[ ... ]` region with its text-relative offsets. */
export interface BracketRegion {
  /** Character offset of the opening `[`. */
  openOffset: number;
  /** Character offset one PAST the closing `]` (exclusive). */
  closeOffset: number;
  /** Character offset of the first content char (openOffset + 1). */
  innerStart: number;
  /** Character offset one past the last content char (closeOffset - 1). */
  innerEnd: number;
  /** The text between the brackets: `text.slice(innerStart, innerEnd)`. */
  inner: string;
}

/**
 * One detected candidate: a balanced bracket region. The grammar decides
 * whether it is a real numeric citation (conservative — never guess).
 */
export interface NumericCandidate {
  region: BracketRegion;
}

/**
 * Find every balanced `[ ... ]` region, nesting-aware, using a bracket
 * stack. Emission order is by OPEN offset (document order) — regions are
 * sorted after collection so ids stay deterministic (R008). An unbalanced
 * `[` with no matching `]` yields no region (conservative).
 */
export function findBracketRegions(text: string): BracketRegion[] {
  const regions: BracketRegion[] = [];
  const stack: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '[') {
      stack.push(i);
    } else if (ch === ']') {
      const open = stack.pop();
      if (open !== undefined) {
        regions.push({
          openOffset: open,
          closeOffset: i + 1,
          innerStart: open + 1,
          innerEnd: i,
          inner: text.slice(open + 1, i),
        });
      }
    }
  }
  return regions.sort((a, b) => a.openOffset - b.openOffset);
}

/**
 * Enumerate all numeric citation candidates of a block text: every balanced
 * bracket region. The grammar decides which are real numeric citations and
 * which are invalid-numeric attempts. Deterministic (R008).
 */
export function findNumericCandidates(text: string): NumericCandidate[] {
  return findBracketRegions(text).map((region) => ({ region }));
}
