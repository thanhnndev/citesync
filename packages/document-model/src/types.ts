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
 * §17 — bibliography section placeholder. S02 owns the concrete shape; S01
 * never fills this (AcademicDocument.bibliography stays undefined until S02).
 * `heading`/`confidence` mirror the §17 bibliography-detection output.
 */
export interface BibliographySection {
  /** Detected bibliography heading text (§17), e.g. "Tài liệu tham khảo". */
  heading?: string;
  /** Detection confidence in [0, 1] (§17). */
  confidence?: number;
  /** Reserved: reference entries. S02 defines the entry shape. */
  entries?: unknown[];
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
}
