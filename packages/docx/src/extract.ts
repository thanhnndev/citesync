/**
 * S03-T06 — end-to-end extraction pipeline (R005/R006, §18–§25).
 *
 * The S03 integration layer: pure functions that turn a parsed
 * {@link AcademicDocument} into the §20 citation occurrences and §21
 * reference entries the slice owns.
 *
 *   extractCitations(doc) -> CitationOccurrence[]
 *     Runs T03 plain-text detection (candidate + grammar + confidence) over
 *     EVERY block — body, footnotes and endnotes — in document order, then
 *     overlays T04's structured-field identity (Zotero CSL_CITATION / Word
 *     CITATION, §22 tier 1/2): a structured occurrence REPLACES the
 *     plain-text occurrence whose display region it overlaps (the identity
 *     backbone wins, §22 — the visible display still round-trips as the
 *     occurrence `raw`, R009). Ids are re-numbered `c0..cN` in document
 *     order over the merged stream (R008) — the merge makes the per-module
 *     counters provisional, so the final numbering happens here.
 *
 *   parseReferences(doc) -> { entries, issues }
 *     Uses S02's detected `doc.bibliography.blockIds` span (outcome
 *     'detected' only; below-threshold/none → empty) via the T05 splitter +
 *     §21 grammar. §88 failure isolation: an unparseable entry is still
 *     emitted with `parseConfidence: 0` and `raw` preserved, and recorded in
 *     `issues` (→ `AcademicDocument.referenceParseIssues`); nothing throws.
 *
 * Both are pure functions of the document (R008) — no I/O, no state — so
 * `buildModel` stays deterministic and re-runnable byte-identically.
 */

import type {
  AcademicDocument,
  CitationOccurrence,
  ReferenceEntry,
  ReferenceParseIssue,
  SourceLocation,
} from '@citesync/document-model';

import { detectCitationsInBlock, detectStructuredCitationsInBlock } from './citations/index.js';
import type { StructuredFieldCitation } from './citations/index.js';
import {
  describeReferenceParseFailure,
  parseReferenceEntry,
  splitEntryBlocks,
} from './references/index.js';

/** Reference extraction result: entries in section order + §88 issues. */
export interface ExtractedReferences {
  entries: ReferenceEntry[];
  issues: ReferenceParseIssue[];
}

/**
 * Extract every §20 citation occurrence of a document: body + footnote +
 * endnote blocks, plain-text detection (T03) with structured-field identity
 * (T04) overlaid, merged in document order with contiguous ids `c0..cN`.
 */
export function extractCitations(doc: AcademicDocument): CitationOccurrence[] {
  const out: CitationOccurrence[] = [];
  let counter = 0;
  for (const block of doc.blocks) {
    const structured = detectStructuredCitationsInBlock(block, counter);
    const plain = detectCitationsInBlock(block, counter + structured.length);
    for (const occ of mergeBlockOccurrences(structured, plain)) {
      // Re-number the merged stream: contiguous ids in document order (R008).
      out.push({ ...occ, id: `c${counter++}` });
    }
  }
  return out;
}

/**
 * Parse the §21 reference entries of a detected bibliography section.
 * Returns empty when the section is absent / below-threshold / none.
 * Unparseable entries are isolated (§88): emitted with parseConfidence 0 and
 * recorded in `issues` — never thrown.
 */
export function parseReferences(doc: AcademicDocument): ExtractedReferences {
  const bib = doc.bibliography;
  if (bib === undefined || bib.outcome !== 'detected' || bib.blockIds === undefined) {
    return { entries: [], issues: [] };
  }
  const entryBlocks = splitEntryBlocks(bib.blockIds, doc.blocks);
  const entries: ReferenceEntry[] = [];
  const issues: ReferenceParseIssue[] = [];
  entryBlocks.forEach((block, index) => {
    const source: SourceLocation = {
      blockId: block.id,
      ...(block.source.paragraphIndex !== undefined
        ? { paragraphIndex: block.source.paragraphIndex }
        : {}),
      startOffset: 0,
      endOffset: block.text.length,
    };
    entries.push(parseReferenceEntry(block.text, index, source));
    const failure = describeReferenceParseFailure(block.text.trim());
    if (failure !== null) {
      issues.push({
        blockId: block.id,
        index,
        raw: block.text,
        code: 'reference-parse',
        message: failure,
      });
    }
  });
  return { entries, issues };
}

/**
 * Merge one block's structured and plain-text occurrences: a structured
 * occurrence subsumes any plain occurrence overlapping its display region
 * (the field's identity wins, §22 tier 1/2 — the display still round-trips
 * via `raw`); remaining plain occurrences are kept. The result is in offset
 * order within the block (deterministic, R008).
 */
function mergeBlockOccurrences(
  structured: StructuredFieldCitation[],
  plain: CitationOccurrence[],
): CitationOccurrence[] {
  const out: CitationOccurrence[] = structured.map((s) => ({
    id: s.id,
    raw: s.raw,
    family: 'author-date' as const,
    items: s.items,
    source: s.source,
    confidence: s.confidence,
  }));
  for (const p of plain) {
    if (out.some((o) => regionsOverlap(o.source, p.source))) continue;
    out.push(p);
  }
  return out.sort((a, b) => (a.source.startOffset ?? 0) - (b.source.startOffset ?? 0));
}

/** Two source spans overlap when each starts before the other ends. */
function regionsOverlap(
  a: { startOffset?: number; endOffset?: number },
  b: { startOffset?: number; endOffset?: number },
): boolean {
  const as = a.startOffset ?? 0;
  const ae = a.endOffset ?? 0;
  const bs = b.startOffset ?? 0;
  const be = b.endOffset ?? 0;
  return as < be && bs < ae;
}
