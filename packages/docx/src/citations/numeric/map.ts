/**
 * M002-S01-T2 — numeric bracket→bibliography index-order mapping pass (D016).
 *
 * Binds every numeric citation's bracket index values to the document's
 * ordered bibliography entries by POSITIONAL INDEX (1-based discovery order:
 * index `i` → `entries[i-1]`), NEVER by author/year scoring — that is the
 * S04 author-date matcher's job and would be semantically wrong for the
 * numeric family.
 *
 * Pure + deterministic (R008): `buildNumericIndexMap(doc)` is a pure function
 * of the populated `doc.citations` + `doc.bibliography.entries` (+ the blocks
 * carrying the bracket text). Same document bytes → same map, byte-identical.
 *
 * CONSERVATIVE SURFACE (D016, §79): out-of-range and unmatched indices are
 * surfaced explicitly as per-token statuses — never silently dropped, never
 * guessed. Every numeric citation occurrence yields a `NumericTokenMap` row
 * (no row is skipped even when its bracket cannot be re-located: the
 * flattened `item.numbers` fallback keeps the binding complete).
 *
 * SOURCE OF TOKENS: the map re-runs bracket detection on the citation's block
 * text (the deterministic T1 grammar) and matches the parsed bracket to the
 * occurrence by character offsets, so each index value carries its own
 * R009-accurate token-level `SourceLocation` for the evidence UI. Ranges are
 * EXPANDED: `[1-4]` → four `NumericIndexToken` entries (index 1..4), each
 * with its own binding status, all anchored to the same source segment.
 *
 * Wire point (T3): `buildModel` calls this AFTER `doc.citations` and
 * `doc.bibliography.entries` are both populated, then assigns
 * `doc.numericIndexMap` (M001 additive pattern, D013/D016).
 */

import type {
  AcademicDocument,
  CitationOccurrence,
  DocumentBlock,
  NumericIndexMap,
  NumericIndexToken,
  NumericTokenMap,
  ReferenceEntry,
  SourceLocation,
} from '@citesync/document-model';

import { findNumericCandidates } from './candidate.js';
import { parseNumericBracket } from './grammar.js';
import type { ParsedNumericCitation } from './grammar.js';

export type {
  NumericIndexMap,
  NumericIndexToken,
  NumericTokenMap,
} from '@citesync/document-model';

/**
 * Bind every numeric citation in `doc` to the ordered bibliography entries.
 * Deterministic (R008): iteration follows `doc.citations` document order and
 * `doc.bibliography.entries` discovery order.
 */
export function buildNumericIndexMap(doc: AcademicDocument): NumericIndexMap {
  const entries = doc.bibliography?.entries ?? [];
  const rows: NumericTokenMap[] = [];
  // blockId → valid parsed brackets (re-run of the deterministic T1 grammar),
  // cached so multiple citations in one block scan the text once.
  const bracketCache = new Map<string, ParsedNumericCitation[]>();
  for (const citation of doc.citations) {
    if (citation.family !== 'numeric') continue;
    rows.push({
      citationId: citation.id,
      tokens: bindCitation(citation, entries, doc.blocks, bracketCache),
    });
  }
  return { version: 1, citations: rows };
}

/**
 * Bind one numeric citation's bracket tokens. Prefers the grammar's
 * per-token sources (offset-exact match against the occurrence's bracket
 * region); falls back to the flattened `item.numbers` (bracket-level source)
 * when the block is missing or no bracket region matches — the binding is
 * never dropped.
 */
function bindCitation(
  citation: CitationOccurrence,
  entries: ReferenceEntry[],
  blocks: DocumentBlock[],
  cache: Map<string, ParsedNumericCitation[]>,
): NumericIndexToken[] {
  const block = blocks.find((b) => b.id === citation.source.blockId);
  if (block !== undefined) {
    const bracket = findMatchingBracket(block, citation, cache);
    if (bracket !== undefined) {
      const tokens: NumericIndexToken[] = [];
      for (const tok of bracket.tokens) {
        const source = tokenSource(block, tok.startOffset, tok.endOffset);
        if (tok.kind === 'range') {
          for (let index = tok.index; index <= tok.end!; index++) {
            tokens.push(bindIndex(index, entries, source));
          }
        } else {
          tokens.push(bindIndex(tok.index, entries, source));
        }
      }
      return tokens;
    }
  }
  // Fallback: the occurrence carries no block-level token detail here — map
  // the flattened numbers with the citation's bracket-level source (R009).
  const item = citation.items[0];
  const numbers = item !== undefined && 'numbers' in item ? item.numbers : [];
  return numbers.map((index) => bindIndex(index, entries, citation.source));
}

/**
 * Re-run the deterministic T1 grammar on the block and return the parsed
 * bracket whose character offsets match the occurrence's bracket region.
 * `undefined` when the block has no such bracket (never guessed).
 */
function findMatchingBracket(
  block: DocumentBlock,
  citation: CitationOccurrence,
  cache: Map<string, ParsedNumericCitation[]>,
): ParsedNumericCitation | undefined {
  let brackets = cache.get(block.id);
  if (brackets === undefined) {
    brackets = [];
    for (const cand of findNumericCandidates(block.text)) {
      const parsed = parseNumericBracket(block.text, cand);
      if (parsed.outcome === 'valid') brackets.push(parsed.citation);
    }
    cache.set(block.id, brackets);
  }
  const { startOffset, endOffset } = citation.source;
  if (startOffset === undefined || endOffset === undefined) return undefined;
  return brackets.find(
    (b) => b.startOffset === startOffset && b.endOffset === endOffset,
  );
}

/**
 * One index value's binding by ORDERED INDEX: `entries[index-1]` for
 * 1 ≤ index ≤ entries.length; index > entries.length → 'out-of-range'
 * (surfaced, never dropped); index < 1 (e.g. `[0]`) → 'unmatched' (not a
 * valid 1-based position — surfaced, never guessed).
 */
function bindIndex(
  index: number,
  entries: ReferenceEntry[],
  source: SourceLocation,
): NumericIndexToken {
  if (index < 1) return { index, status: 'unmatched', source };
  if (index > entries.length) return { index, status: 'out-of-range', source };
  return {
    index,
    status: 'resolved',
    resolvedEntryId: entries[index - 1]!.id,
    source,
  };
}

/** Token-level SourceLocation: block-anchored, R009 exact character span. */
function tokenSource(
  block: DocumentBlock,
  startOffset: number,
  endOffset: number,
): SourceLocation {
  return {
    blockId: block.id,
    ...(block.source.paragraphIndex !== undefined
      ? { paragraphIndex: block.source.paragraphIndex }
      : {}),
    startOffset,
    endOffset,
  };
}
