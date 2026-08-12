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
 *   - S03-T01 added the §21 reference-record contract to the shared model:
 *     `ReferenceEntry` (verbatim PRD §21), `PersonName` with its tiered
 *     `PersonNameKey` (preserves the §24/§25 matching tiers) and
 *     `ReferenceParseIssue` (§88 failure isolation). `BibliographySection.entries`
 *     is typed `ReferenceEntry[]`; S03 fills it from S02's detected `blockIds`
 *     span. Because §21 has no page field, volume/issue/pages fold into
 *     `identifiers` — locked in D012.
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
   * Parsed reference entries (§21). Filled by S03 reference-entry parsing
   * from the S02-detected `blockIds` span (entry blocks only — the heading
   * block is skipped unless it carries an entry); S02 leaves it
   * unspecified/undefined. An unparseable entry is still emitted here with
   * `parseConfidence: 0` and recorded in
   * `AcademicDocument.referenceParseIssues` (§88 isolation).
   */
  entries?: ReferenceEntry[];
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
 * §24/§25 — tiered normalized-name key (S03 produces, S04 consumes).
 *
 * Preserves the §25 matching tiers so downstream matching applies them
 * without re-normalizing:
 *   - `exact` — §25 tiers 1–2 (exact + normalized surname): case-folded
 *     (plain `toLowerCase`), Unicode NFC, punctuation removed, whitespace
 *     collapsed, diacritics PRESERVED. `Nguyễn` ≠ `Nguyen` here.
 *   - `diacriticInsensitive` — §25 tier 3: `exact` with all combining marks
 *     stripped (NFD → remove `\p{M}` → NFC), `Đ`/`đ` NOT collapsed to `d`.
 *     Secondary candidate signal only — MUST NOT override `exact` (§24).
 *   - `initials` — §25 tier 4 initial-compatible key (e.g. `j d` from
 *     "John Doe").
 * The §25 tier 5 (fuzzy) is S04's matching concern and needs no stored key.
 */
export interface PersonNameKey {
  /** Tier 1–2 key: normalized, diacritic-preserving (Nguyễn ≠ Nguyen). */
  exact: string;
  /** Tier 3 key: diacritic-stripped secondary signal (Nguyễn = Nguyen). */
  diacriticInsensitive: string;
  /** Tier 4 key: initial-compatible. */
  initials: string;
}

/**
 * §21 — one author name with its tiered normalized key.
 *
 * Family-first segmentation matches Vietnamese name order (surname is the
 * FIRST token, e.g. `Nguyễn` in `Nguyễn Văn A`). `key` preserves the
 * §24/§25 tiers so S04's matcher compares without re-normalizing.
 */
export interface PersonName {
  /** The name exactly as it appears in the source text. */
  originalName: string;
  /** Family/surname segment (first token for Vietnamese names). */
  family: string;
  /** Given (fore) name segment(s), when segmentable. */
  given?: string;
  /** Tiered normalized key (§24/§25) — see `PersonNameKey`. */
  key: PersonNameKey;
}

/**
 * §21 — one parsed bibliography entry (verbatim PRD §21 shape).
 *
 * The PRD §21 model has NO page field: the journal volume/issue/pages tail
 * folds into `identifiers` (e.g. `{ volume: '12', issue: '3', pages: '45-60' }`)
 * — locked in D012; `raw` always preserves the lossless source text.
 * `parseConfidence: 0` means the reference grammar failed and `raw` is kept
 * verbatim (§88 failure isolation — analysis continues, the issue is recorded
 * in `AcademicDocument.referenceParseIssues`).
 */
export interface ReferenceEntry {
  /** Stable, deterministic reference identifier. */
  id: string;
  /** Raw entry text exactly as it appeared in the bibliography block. */
  raw: string;
  /** Zero-based position of the entry within the bibliography section. */
  index?: number;
  /** Parsed authors, normalized (§21/§24). */
  authors?: PersonName[];
  /** Publication year. */
  year?: number;
  /** Same-author-same-year disambiguation suffix (2018a → 'a'). */
  yearSuffix?: string;
  /** Title of the cited work. */
  title?: string;
  /** Container title (journal/book/venue). */
  containerTitle?: string;
  /** Digital Object Identifier when present. */
  doi?: string;
  /**
   * Volume/issue/pages and other identifiers folded here (no §21 page
   * field), e.g. `{ volume, issue, pages }` — D012.
   */
  identifiers?: Record<string, string>;
  /** Source location of the entry (R009 evidence: block + char offsets). */
  source: SourceLocation;
  /** Parse confidence in [0, 1]; 0 = grammar failed, raw preserved. */
  parseConfidence: number;
}

/**
 * S03 extension (additive): one isolated, non-fatal reference-parsing issue
 * (§88). Recorded when the reference grammar fails on a bibliography entry;
 * the entry is still emitted (`parseConfidence: 0`) so full-document
 * analysis continues. Carried on `AcademicDocument.referenceParseIssues`
 * (absent when every entry parsed cleanly). Entry-scoped, unlike the
 * part-scoped S01 `ParseIssue`.
 */
export interface ReferenceParseIssue {
  /** The `DocumentBlock.id` of the unparseable bibliography entry. */
  blockId: string;
  /** Zero-based entry index within the bibliography section. */
  index: number;
  /** The raw entry text exactly as it appeared in the block. */
  raw: string;
  /** Machine-readable code. */
  code: 'reference-parse';
  /** Human-readable reason the grammar failed. */
  message: string;
}

/**
 * §27 — match state of a citation→reference relationship (S04 owns filling).
 *
 * S04 maps every §20 citation occurrence to a §21 bibliography entry or to a
 * "no-good-target" state. The four states are the verbatim §27 union; their
 * philosophy is §79's conservative bias — prefer "I am uncertain" over
 * "This is wrong" when evidence is insufficient, so a thin/ambiguous signal
 * yields AMBIGUOUS (or POSSIBLE_MISMATCH), never a confident wrong MATCHED.
 */
export type MatchState =
  | 'MATCHED'
  | 'MISSING_REFERENCE'
  | 'AMBIGUOUS'
  | 'POSSIBLE_MISMATCH';

/** §27 — bibliography-entry usage status (reverse of the citation map). */
export type EntryMatchStatus = 'CITED' | 'UNUSED' | 'AMBIGUOUS_USAGE';

/**
 * §25/§26 — short machine-readable evidence codes on a citation match result
 * (R009-style evidence for the M003 issue surface). The S04 scorer emits the
 * author/year/suffix/page codes; the orchestrator emits the state-level ones
 * ('no-entry' / 'ambiguous'). Extensible — codes are additive.
 */
export type MatchReason =
  /** Author matched on the exact (normalized) key tier. */
  | 'exact'
  /** Author matched on the normalized tier (subsumed by `exact` in this key scheme). */
  | 'normalized'
  /** Author matched only on the diacritic-stripped tier (§25 tier 3). */
  | 'diacritic-insensitive'
  /** Author matched only on the initial-compatible tier (§25 tier 4). */
  | 'initials'
  /** Author matched only on the fuzzy tier (§25 tier 5 — no stored key). */
  | 'fuzzy'
  /** Citation year equals entry year. */
  | 'year-match'
  /** Years present and different, or the same year with conflicting suffixes. */
  | 'year-mismatch'
  /** Citation or entry lacks a year signal (n.d.). */
  | 'no-year'
  /** Same-year disambiguation suffix agreed / partially present. */
  | 'year-suffix'
  /** No author tier matched at all. */
  | 'author-mismatch'
  /** Citation page found in the entry's page identifiers. */
  | 'page-match'
  /** At least one additional cited author matched an entry author. */
  | 'additional-authors'
  /** No bibliography target exists (→ MISSING_REFERENCE). */
  | 'no-entry'
  /** Multiple candidates tie above the threshold (→ AMBIGUOUS). */
  | 'ambiguous';

/**
 * §27 — one citation→reference match result (S04 fills; M003 consumes).
 *
 * `relationship` is the §27 state; `score` is the §26 deterministic [0,1]
 * match score; `tier` is the §25 author tier reached for the first author
 * (1 exact, 2 normalized, 3 diacritic-insensitive, 4 initials, 5 none);
 * `confidence` is the state confidence the orchestrator derives from
 * score/threshold evidence (R008 — same inputs, same value).
 */
export interface CitationMatchResult {
  /** The `CitationOccurrence.id` this result refers to. */
  citationId: string;
  /** The occurrence's source region (R009 evidence — jump to the text). */
  citationSource: SourceLocation;
  /** §27 relationship state. */
  relationship: MatchState;
  /** The matched `ReferenceEntry.id`, when the state resolves one. */
  matchedEntryId?: string;
  /** §26 deterministic match score in [0, 1] (4-decimal rounded). */
  score: number;
  /** §25 author tier reached for the first author (1..5). */
  tier: number;
  /** State confidence in [0, 1] (derived deterministically). */
  confidence: number;
  /** Short evidence codes explaining the decision. */
  reasons: MatchReason[];
}

/** §27 — one bibliography entry's usage status row. */
export interface EntryMatchStatusRow {
  /** The `ReferenceEntry.id` this row refers to. */
  entryId: string;
  /** §27 status: CITED / UNUSED / AMBIGUOUS_USAGE. */
  status: EntryMatchStatus;
}

/**
 * §27 — the match-state map S04 produces for one document.
 *
 * `citations` is ordered exactly like `AcademicDocument.citations` (c0..cN,
 * document order — R008); `entryStatus` mirrors `bibliography.entries` order
 * (r0..). Deterministic: same document bytes → same map, byte-identically
 * (R008). `version: 1` bumps only on a breaking shape change.
 */
export interface MatchMap {
  /** Schema version — bump only on a breaking shape change. Currently 1. */
  version: 1;
  /** One result per §20 citation occurrence, in document order. */
  citations: CitationMatchResult[];
  /** One usage-status row per §21 bibliography entry, in section order. */
  entryStatus: EntryMatchStatusRow[];
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
  /**
   * S04 extension (additive): the §27 match-state map — every citation
   * occurrence mapped to a reference entry or a no-good-target state, plus
   * the bibliography-side entry statuses. Filled by the S04 matcher, which
   * runs AFTER `citations` and `bibliography.entries` are populated (order
   * matters in buildModel). Absent until the matcher runs.
   */
  matchMap?: MatchMap;
  /**
   * S03 extension (additive): isolated non-fatal reference-parsing issues
   * (§88) — one per bibliography entry whose grammar parse failed. The entry
   * is still emitted with `parseConfidence: 0` so analysis continues. Absent
   * when every reference parsed cleanly.
   */
  referenceParseIssues?: ReferenceParseIssue[];
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
