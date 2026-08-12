/**
 * @citesync/document-model — PRD §15 internal document model contract.
 *
 * Byte-exact handoff shape, verified against "CiteSync.dev — Product
 * Requirements Document.md" §15/§16:
 *   - `AcademicDocument`, `DocumentBlock`, `SourceLocation` match the PRD
 *     verbatim (field names, types and optionality identical).
 *   - `DocumentMetadata` is the minimal §15 shape (author/title/created/modified).
 *   - `SourceMap` + `RunSpan` carry the run-level coalescing detail required by
 *     research §5c ("record the min/max (or a run list) offsets for the span").
 *   - `bibliography` (owned by S02) and `citations` (owned by S03) are contract
 *     stubs only: the shapes below compile and are PRD-aligned, but S01 never
 *     fills them. S01 owns `metadata`, `blocks` and `sourceMap`.
 *
 * OFFSET SEMANTICS DECISION (documented on `SourceLocation`, `RunSpan`,
 * `SourceMap` and repeated here for discoverability):
 * `startOffset`/`endOffset` are CHARACTER offsets within the paragraph/block
 * TEXT (the extracted, entity-decoded, run-coalesced text used for
 * highlighting) — NOT byte offsets into the raw OOXML/XML source. `endOffset`
 * is EXCLUSIVE, so `block.text.slice(startOffset, endOffset)` selects exactly
 * the referenced text. Offsets are UTF-16 code-unit indices (JS string
 * indices), matching `String.prototype.slice` semantics exactly. The S01-T4
 * source-position scanner must therefore advance offsets by the
 * entity-decoded length of each `<w:t>`, never by raw XML byte positions.
 */

/** §15 — block kind union (verbatim from PRD §15). */
export type DocumentBlockType =
  | 'paragraph'
  | 'heading'
  | 'list'
  | 'table'
  | 'footnote'
  | 'endnote';

/**
 * §16 — original location of an extracted citation/reference (verbatim).
 *
 * Enables: click issue → jump to citation → highlight exact text (R009).
 *
 * Offset semantics: `startOffset`/`endOffset` are CHARACTER offsets within the
 * block/paragraph TEXT, NOT byte offsets into raw XML. `endOffset` is
 * exclusive (slice semantics). When both are present,
 * `block.text.slice(startOffset, endOffset)` selects the referenced text.
 */
export interface SourceLocation {
  /** The `DocumentBlock.id` this location refers to. */
  blockId: string;
  /**
   * 0-based ordinal of the paragraph within its source part (document.xml,
   * footnotes.xml or endnotes.xml), in document order. Present when the
   * location is paragraph-scoped.
   */
  paragraphIndex?: number;
  /**
   * 0-based ordinal of the run within its paragraph (among the coalesced runs
   * in `BlockSourceMap.runs`). Present when the location is run-scoped.
   */
  runIndex?: number;
  /**
   * Character offset (inclusive) into the block/paragraph text marking the
   * start of the referenced text. Character offsets, not XML byte offsets.
   */
  startOffset?: number;
  /**
   * Character offset (EXCLUSIVE) into the block/paragraph text marking the
   * end of the referenced text. Character offsets, not XML byte offsets.
   */
  endOffset?: number;
}

/** §15 — a block of document content (verbatim). */
export interface DocumentBlock {
  /** Stable, deterministic block identifier (unique within the document). */
  id: string;
  /** Block kind. §15 union verbatim. */
  type: DocumentBlockType;
  /**
   * The visible text of the block: entity-decoded, run-coalesced (adjacent
   * `w:t` text merged), paragraph-text-relative. This is the text S03 matches
   * citations against, so a visible phrase must appear contiguously even when
   * Word fragmented it across multiple runs (research §5c).
   */
  text: string;
  /** Style id / label passthrough (e.g. heading style id) for S02 detection. */
  style?: string;
  /** Source location of this block. */
  source: SourceLocation;
  /**
   * S01 extension (additive — §15 fields unchanged): raw field-instruction
   * markers preserved from the block's runs, one entry per field, in document
   * order (research §5c). Word/Zotero/Mendeley structured citations are
   * carried as `w:instrText`/`w:fldSimple/@w:instr` codes (e.g.
   * `ADDIN ZOTERO_ITEM CSL_CITATION {...}`, `CITATION Smith22 \l 1033`); S03
   * uses these to detect field-backed citations (identity backbone) while the
   * cached field RESULT stays in `text`. Absent when the block has no fields.
   */
  fields?: string[];
}

/**
 * Minimal §15 metadata (docProps/core.xml extraction target).
 * All fields optional — the reader never throws on missing metadata.
 * `created`/`modified` are ISO-8601 strings (UTC) when present.
 */
export interface DocumentMetadata {
  /** Document title (`dc:title`). */
  title?: string;
  /** Document author/creator (`dc:creator`). */
  author?: string;
  /** Creation timestamp, ISO-8601 UTC (`dcterms:created`). */
  created?: string;
  /** Last-modified timestamp, ISO-8601 UTC (`dcterms:modified`). */
  modified?: string;
}

/**
 * One coalesced run contributing to a block's text.
 *
 * Runs are frequently fragmented by Word (spell-check markers, revision ids,
 * field codes — research §5c). S01 coalesces adjacent runs into `block.text`
 * while preserving this per-run detail so S03 can map a citation match back to
 * its exact runs for evidence (R009).
 */
export interface RunSpan {
  /** 0-based index of this run within its paragraph (document order). */
  runIndex: number;
  /** The run's entity-decoded text as it appears inside `block.text`. */
  text: string;
  /**
   * Character offset (inclusive) of this run into `block.text`. Character
   * offsets, NOT byte offsets into raw XML.
   */
  startOffset: number;
  /**
   * Character offset (EXCLUSIVE) of this run into `block.text`. Guarantee:
   * `block.text.slice(startOffset, endOffset) === text`.
   */
  endOffset: number;
}

/**
 * Run-level source detail for one block.
 *
 * The block-level analog of the min/max offset span: `runs` lists every
 * coalesced run with its text-relative offsets, so a span's min/max offsets
 * can be derived as `runs[0].startOffset` .. `runs[last].endOffset`.
 */
export interface BlockSourceMap {
  /** The block this entry describes (mirrors `SourceLocation.blockId`). */
  blockId: string;
  /**
   * 0-based ordinal of the paragraph within its source part (document.xml,
   * footnotes.xml or endnotes.xml), in document order. Absent for table
   * blocks, whose text is flattened from multiple cell paragraphs.
   */
  paragraphIndex?: number;
  /** Coalesced runs forming `block.text`, in document order. */
  runs: RunSpan[];
}

/**
 * Document-wide source map: blockId → run-level source detail.
 *
 * Consumed by S03 to translate a citation match at character offsets in
 * `block.text` into run-level evidence. Offsets are CHARACTER offsets within
 * block text, never byte offsets into raw XML.
 */
export interface SourceMap {
  /** Schema version — bump only on a breaking shape change. Currently 1. */
  version: 1;
  /** Per-block source detail, keyed by `DocumentBlock.id`. */
  blocks: Record<string, BlockSourceMap>;
}

/**
 * §17 — bibliography section (concrete shape, owned by S02; D009).
 *
 * S01 never fills this (AcademicDocument.bibliography stays undefined until
 * S02 detection runs). The section is populated only when detection produced
 * a confident result (`outcome === 'detected'`); otherwise the ask-user flow
 * communicates via `BibliographyDetectionResult` and this stays undefined.
 *
 * All fields are ADDITIVE extensions of the §17 stub (`heading`/`confidence`
 * mirror the §17 bibliography-detection output); `entries` is preserved and
 * reserved for S03's parsed reference entries — it stays unspecified until
 * S03 fills it.
 *
 * Span semantics: `blockIds` is an ORDERED list of `DocumentBlock.id` values
 * forming the section, heading block first, followed by the reference-like
 * blocks in document order. The section text span is therefore
 * `blocks[firstIndex]` … `blocks[lastIndex]` where the ids resolve in
 * `AcademicDocument.blocks`; S03's entry-parsing scope is exactly this list.
 */
export interface BibliographySection {
  /**
   * Detection outcome. `'detected'` → confident section found (blockIds
   * present); `'below-threshold'` → heading candidates exist but no single
   * one cleared the conservative threshold (candidates present, blockIds
   * absent); `'none'` → no bibliography signal present at all.
   */
  outcome: 'detected' | 'below-threshold' | 'none';
  /** Detected bibliography heading text (§17), e.g. "Tài liệu tham khảo". */
  heading?: string;
  /**
   * Detection confidence in [0, 1] (§17). Present when `outcome !== 'none'`;
   * for `'detected'` it is the winning candidate's score, for
   * `'below-threshold'` the best candidate's score (below the conservative
   * threshold — the engine NEVER guesses below it, R004 / PRD §17).
   */
  confidence?: number;
  /**
   * Ordered ids of the blocks forming the section: heading block first, then
   * the following reference-like blocks in document order. This is S03's
   * entry-parsing scope. Present when `outcome === 'detected'`; absent
   * otherwise.
   */
  blockIds?: string[];
  /**
   * Scored candidate bibliography headings for the pick-a-section ask-user
   * flow (M003). Only meaningful when `outcome === 'below-threshold'`;
   * undefined otherwise.
   */
  candidates?: BibliographyCandidate[];
  /**
   * Reserved: reference entries. S03 (reference-entry parsing) defines and
   * fills this; S02 leaves it unspecified/undefined.
   */
  entries?: unknown[];
}

/**
 * §17 — one candidate bibliography heading for the ask-user flow.
 *
 * Produced when no single heading candidate clears the conservative
 * threshold; the M003 "select the bibliography section" UI lets the user pick
 * among these instead of the engine guessing.
 */
export interface BibliographyCandidate {
  /** The `DocumentBlock.id` of the candidate heading block. */
  blockId: string;
  /** The heading's visible text (block.text). */
  heading: string;
  /**
   * Which signal raised this candidate. `'exact'` — known bibliography term
   * match (References, Tài liệu tham khảo, …); `'style'` — heading style;
   * `'position'` — document-end position; `'reference-segment'` — followed by
   * reference-like paragraphs; `'none'` — no positive signal (scored low).
   */
  headingType:
    | 'exact'
    | 'style'
    | 'position'
    | 'reference-segment'
    | 'none';
  /**
   * 0-based index of the candidate block within `AcademicDocument.blocks`
   * (document order), so the UI can jump to / highlight it (R009-style
   * navigation).
   */
  startIndex: number;
  /** Candidate score in [0, 1] (below the conservative threshold). */
  confidence: number;
}

/**
 * §17 — pure detectBibliography() return contract (D009).
 *
 * A discriminated union so the caller can never mistake a below-threshold
 * result for a detection:
 *  - `{ outcome: 'detected'; section }` — confident section found.
 *  - `{ outcome: 'below-threshold'; candidates; confidence }` — heading
 *    candidates exist but none cleared the conservative threshold: return the
 *    ask-user outcome, NEVER silently guess (R004 / PRD §17).
 *  - `{ outcome: 'none' }` — no bibliography signal present.
 *
 * Threshold rule: a conservative constant threshold (BIBLIO_THRESHOLD = 0.6)
 * separates 'detected' from 'below-threshold'; below it the engine never
 * fills `AcademicDocument.bibliography` and never guesses a section.
 */
export type BibliographyDetectionResult =
  | { outcome: 'detected'; section: BibliographySection }
  | {
      outcome: 'below-threshold';
      candidates: BibliographyCandidate[];
      confidence: number;
    }
  | { outcome: 'none' };

/**
 * S01 extension (additive): one isolated, non-fatal parse issue (§88).
 *
 * Malformed parts/blocks are recorded here instead of thrown, so a broken
 * paragraph/table/note never crashes the full-document parse.
 */
export interface ParseIssue {
  /** The part the issue occurred in, e.g. "word/document.xml". */
  part: string;
  /** Machine-readable code, e.g. "malformed-content" | "not-xml". */
  code: string;
  /** Human-readable detail. */
  message: string;
}

/**
 * S01 extension (additive): security-relevant notes for parts this reader
 * deliberately does NOT execute or follow (R002/R019/R022, §87).
 */
export interface DocumentSecurityInfo {
  /**
   * True when the package contains a macro-bearing part (word/vbaProject.bin
   * or any part whose path contains "vba" or "macro"). The bytes are never
   * decoded or executed.
   */
  macrosPresent: boolean;
  /**
   * External/remote relationship targets found in the package rels
   * (TargetMode="External" or an absolute scheme/UNC target), recorded
   * first-seen. Never fetched or followed.
   */
  remoteTargets?: string[];
}

/**
 * §20 — a citation occurrence. S03 owns filling these; S01 leaves
 * `AcademicDocument.citations` as an empty array. Shape verbatim from PRD §20.
 */
export interface CitationOccurrence {
  /** Stable, deterministic citation identifier. */
  id: string;
  /** Raw citation text as it appears in the source block. */
  raw: string;
  /** Citation family. */
  family: 'author-date' | 'numeric';
  /** Parsed citation items (§20). */
  items: CitationItem[];
  /** Source location of the citation (R009 evidence). */
  source: SourceLocation;
  /** Extraction confidence in [0, 1]. */
  confidence: number;
}

/** §20 — union of supported citation item shapes. */
export type CitationItem = AuthorDateCitationItem | NumericCitationItem;

/** §20 — author-date citation item (verbatim). */
export interface AuthorDateCitationItem {
  firstAuthor?: string;
  authors?: string[];
  year?: number;
  yearSuffix?: string;
  page?: string;
}

/** §20 — numeric (bracketed) citation item (verbatim). */
export interface NumericCitationItem {
  numbers: number[];
}

/**
 * §15 — the AcademicDocument contract (verbatim), the fixed handoff shape for
 * S02–S04. S01 fills `metadata`, `blocks`, `sourceMap` only; `bibliography`
 * (S02) and `citations` (S03) are contract stubs left empty/undefined.
 */
export interface AcademicDocument {
  metadata: DocumentMetadata;
  blocks: DocumentBlock[];
  /** Filled by S02 (bibliography extraction). Undefined until then. */
  bibliography?: BibliographySection;
  /** Filled by S03 (citation extraction). Empty array until then. */
  citations: CitationOccurrence[];
  sourceMap: SourceMap;
  /**
   * S01 extension (additive): isolated non-fatal parse issues (§88). Absent
   * when every part parsed cleanly.
   */
  parseIssues?: ParseIssue[];
  /**
   * S01 extension (additive): security notes (macros/remote content present
   * but never executed or followed). Absent when nothing was flagged.
   */
  security?: DocumentSecurityInfo;
}
