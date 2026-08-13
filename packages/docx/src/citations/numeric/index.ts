/**
 * M002-S01-T1 — bracketed numeric citation public surface (R007, §20).
 *
 * Exposes the bracket candidate detector, the numeric grammar, the
 * deterministic confidence scorer, and the block-level orchestration entry
 * point that T3's `extractCitations(doc)` will call per block:
 *
 *   detectNumericCitationsInBlock(block, startIndex) -> NumericBlockResult
 *
 * Occurrence ids are `c{n}` in DOCUMENT order (R008): the caller passes the
 * running counter (`startIndex`) and each emitted occurrence takes the next
 * ordinal, so a full-document pass yields contiguous, deterministic ids.
 *
 * CONSERVATIVE SURFACE (R007): a bracket that is not a clean numeric token
 * (e.g. `[1, x]`) is NEVER half-emitted as a citation — it is returned in
 * `result.invalid` as a typed invalid-numeric candidate, deterministic and
 * offset-anchored, for CS007 in S2 to consume. `[Figure 2]`-style prose
 * brackets are ignored outright (not a citation attempt).
 */

import type {
  CitationOccurrence,
  DocumentBlock,
} from '@citesync/document-model';

import { findNumericCandidates } from './candidate.js';
import { numericConfidence } from './confidence.js';
import { parseNumericBracket } from './grammar.js';
import type { InvalidNumericCandidate } from './grammar.js';

export {
  findBracketRegions,
  findNumericCandidates,
} from './candidate.js';
export type { BracketRegion, NumericCandidate } from './candidate.js';
export {
  MAX_RANGE_SPAN,
  parseNumericBracket,
} from './grammar.js';
export type {
  InvalidNumericCandidate,
  NumericBracketParse,
  NumericIndexToken,
  ParsedNumericCitation,
} from './grammar.js';
export {
  BASE_NUMERIC_FEATURES,
  numericConfidence,
} from './confidence.js';
export type { NumericFeatures } from './confidence.js';

// M002-S01-T2 — the D016 index-order mapping pass (bound here so the whole
// numeric family surfaces through one module; `NumericIndexToken` stays the
// grammar's parse-level token — the map's OUTPUT token type is deliberately
// NOT re-exported here to avoid the name clash with the document-model one).
export { buildNumericIndexMap } from './map.js';
export type { NumericIndexMap, NumericTokenMap } from './map.js';

/** The block-level detection result: valid occurrences + invalid surfaces. */
export interface NumericBlockResult {
  /** Clean numeric citations in document order, ids `c{n}` (R008). */
  occurrences: CitationOccurrence[];
  /**
   * Bracket regions that look like numeric citations but do not parse
   * cleanly (e.g. `[1, x]`, `[4-1]`) — surfaced for CS007, never emitted
   * as (half) citations. Deterministic order (document order).
   */
  invalid: InvalidNumericCandidate[];
}

/**
 * Detect all bracketed numeric citation occurrences in one block's text, in
 * document order, plus the invalid-numeric surface.
 *
 * @param block      the DocumentBlock whose `text` is scanned;
 *                   `source.blockId`/`paragraphIndex` are carried into each
 *                   occurrence's `SourceLocation` (R009 evidence).
 * @param startIndex running occurrence ordinal for deterministic `c{n}` ids.
 */
export function detectNumericCitationsInBlock(
  block: DocumentBlock,
  startIndex = 0,
): NumericBlockResult {
  const text = block.text;
  const occurrences: CitationOccurrence[] = [];
  const invalid: InvalidNumericCandidate[] = [];
  for (const candidate of findNumericCandidates(text)) {
    const parsed = parseNumericBracket(text, candidate);
    if (parsed.outcome === 'ignored') continue;
    if (parsed.outcome === 'invalid') {
      invalid.push(parsed.invalid);
      continue;
    }
    const { citation } = parsed;
    const source: CitationOccurrence['source'] = {
      blockId: block.id,
      ...(block.source.paragraphIndex !== undefined
        ? { paragraphIndex: block.source.paragraphIndex }
        : {}),
      startOffset: citation.startOffset,
      endOffset: citation.endOffset,
    };
    occurrences.push({
      id: `c${startIndex + occurrences.length}`,
      raw: citation.raw,
      family: 'numeric',
      items: [citation.item],
      source,
      confidence: numericConfidence(citation.features),
    });
  }
  return { occurrences, invalid };
}
