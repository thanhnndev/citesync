/**
 * S03-T03 — citation extraction public surface (plain-text tier 4 of §23).
 *
 * Exposes the candidate detector, the author-date grammar, the deterministic
 * confidence scorer, and the block-level orchestration entry point that T06's
 * `extractCitations(doc)` calls per block:
 *
 *   detectCitationsInBlock(block, startIndex) -> CitationOccurrence[]
 *
 * Occurrence ids are `c{n}` in DOCUMENT order (R008): the caller passes the
 * running counter (`startIndex`) and each emitted occurrence takes the next
 * ordinal, so a full-document pass yields contiguous, deterministic ids.
 *
 * Structured-field identity (Zotero CSL_CITATION / Word CITATION codes) is
 * handled by T04 (`citations/fields.ts`), which overlays tier-1/2 identity
 * on top of this plain-text fallback.
 */

import type {
  CitationOccurrence,
  DocumentBlock,
} from '@citesync/document-model';

import { findCitationCandidates } from './candidate.js';
import { parseCandidate } from './grammar.js';
import { citationConfidence } from './confidence.js';

export { findParentheticalRegions, scanNamePrefix, findCitationCandidates } from './candidate.js';
export type { ParentheticalRegion, CitationCandidate } from './candidate.js';
export { parseCandidate } from './grammar.js';
export type { ParsedCitation } from './grammar.js';
export { parseAuthorPrefix, familyToken } from './authors.js';
export { citationConfidence, BASE_FEATURES } from './confidence.js';
export type { CitationFeatures } from './confidence.js';

// S03-T04 — structured citation fields (Zotero CSL_CITATION / Word CITATION)
// as the tier-1/2 identity backbone, keyed to the field's display region.
export {
  parseStructuredField,
  detectStructuredCitationsInBlock,
  structuredFieldConfidence,
} from './fields.js';
export type {
  StructuredAuthor,
  StructuredFieldItem,
  StructuredFieldKind,
  StructuredFieldIdentity,
  StructuredFieldCitation,
} from './fields.js';

/**
 * Detect all author-date citation occurrences in one block's text, in
 * document order (parenthetical + narrative forms; plain-text tier 4).
 *
 * @param block      the DocumentBlock whose `text` is scanned;
 *                   `source.blockId`/`paragraphIndex` are carried into each
 *                   occurrence's `SourceLocation` (R009 evidence).
 * @param startIndex running occurrence ordinal for deterministic `c{n}` ids.
 */
export function detectCitationsInBlock(
  block: DocumentBlock,
  startIndex = 0,
): CitationOccurrence[] {
  const text = block.text;
  const occurrences: CitationOccurrence[] = [];
  for (const candidate of findCitationCandidates(text)) {
    const parsed = parseCandidate(text, candidate);
    if (parsed === null) continue;
    const source: CitationOccurrence['source'] = {
      blockId: block.id,
      ...(block.source.paragraphIndex !== undefined
        ? { paragraphIndex: block.source.paragraphIndex }
        : {}),
      startOffset: parsed.startOffset,
      endOffset: parsed.endOffset,
    };
    occurrences.push({
      id: `c${startIndex + occurrences.length}`,
      raw: parsed.raw,
      family: 'author-date',
      items: parsed.items,
      source,
      confidence: citationConfidence(parsed.features),
    });
  }
  return occurrences;
}
