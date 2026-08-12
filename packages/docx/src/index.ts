/**
 * @citesync/docx — public package surface.
 *
 * Exposes the S01 deliverable: `parseDocument(buffer) -> AcademicDocument`
 * (bounds-guarded zip + XML → blocks with precise source offsets + metadata +
 * source map), the typed security/failure errors, the resource limits, the
 * lower-level reader/parser modules, and the shared model contract types for
 * downstream consumers (S02–S04).
 */

// The public entry point: untrusted .docx bytes -> AcademicDocument.
export { parseDocument } from './parse-document.js';

// Resource bounds and the typed security-error family.
export {
  DOCX_ENTRY_MAX,
  TOTAL_DECOMPRESSED_MAX,
  XML_STRING_MAX,
  MAX_ENTRY_COUNT,
  PROCESSING_TIME_BUDGET_MS,
} from './zip/limits.js';

export {
  DocxReaderError,
  NotADocxError,
  ZipBombError,
  UnsupportedFormatError,
  ParseFailureError,
} from './zip/errors.js';

// Bounds-guarded decompression of an untrusted .docx.
export { safeZipRead } from './zip/reader.js';
export type { ZipParts, ZipReader } from './zip/reader.js';

// S01-T5 block parsers: w:p -> DocumentBlock, w:tbl -> table block,
// styles.xml -> style map. Pure + deterministic + failure-isolated.
export {
  scanParagraphs,
  classifyParagraph,
  paragraphToBlock,
} from './parser/paragraph.js';
export type {
  ParsedParagraph,
  ParagraphProps,
} from './parser/paragraph.js';

export { scanTables, tableToBlock } from './parser/table.js';
export type { ParsedTable } from './parser/table.js';

export { loadStyleMap, headingAnalysis } from './parser/style.js';
export type { StyleInfo, StyleMap } from './parser/style.js';

// S01-T6: body parse (ordered blocks + source map), footnotes/endnotes,
// core-properties metadata, and the parts -> model assembler.
export { parseBody } from './parser/document.js';
export type { BodyParseResult, BlockWithSourceMap } from './parser/document.js';

export { scanNotePart, noteToBlock } from './parser/footnotes.js';
export type { NoteKind, ParsedNote } from './parser/footnotes.js';

export { extractCoreProperties } from './metadata.js';

export { buildModel } from './build-model.js';

// S03 (T06): end-to-end extraction — §20 citation occurrences over every block
// (body + footnotes + endnotes, structured-field identity overlaid) and §21
// reference entries from the detected bibliography span.
export { extractCitations, parseReferences } from './extract.js';
export type { ExtractedReferences } from './extract.js';

// S03 (T02): diacritic-aware tiered name normalization (shared by citation
// extraction, reference parsing and the S04 §25 matcher).
export {
  normalizeIdentityName,
  stripDiacritics,
  initialsKey,
  buildNameKey,
  isVietnameseFamilyName,
} from './normalize/index.js';

// S03 (T03/T04): citation candidate detection, author-date grammar, confidence
// scoring and the structured-field identity backbone (Zotero/Word).
export {
  findParentheticalRegions,
  scanNamePrefix,
  findCitationCandidates,
  parseCandidate,
  parseAuthorPrefix,
  familyToken,
  citationConfidence,
  BASE_FEATURES,
  parseStructuredField,
  detectStructuredCitationsInBlock,
  structuredFieldConfidence,
  detectCitationsInBlock,
} from './citations/index.js';
export type {
  ParentheticalRegion,
  CitationCandidate,
  ParsedCitation,
  CitationFeatures,
  StructuredAuthor,
  StructuredFieldItem,
  StructuredFieldKind,
  StructuredFieldIdentity,
  StructuredFieldCitation,
} from './citations/index.js';

// S03 (T05): bibliography entry splitting + §21 reference grammar + confidence
// (§88 failure isolation — unparseable entries never throw).
export {
  splitEntryBlocks,
  isReferenceEntryBlock,
  parseReferenceEntry,
  splitAuthorGroups,
  personName,
  describeReferenceParseFailure,
  referenceConfidence,
  BASE_REFERENCE_FEATURES,
} from './references/index.js';
export type { ReferenceFeatures } from './references/index.js';

// S02 (bibliography detection, D009): the weighted-signal detector and its
// conservative threshold, exposed for direct reuse and the ask-user flow
// (M003) — the pure core behind AcademicDocument.bibliography.
export { detectBibliography, BIBLIOGRAPHY_THRESHOLD } from './bibliography/detect.js';

// S04 (T1): §26 tunable weights + §27/§79 thresholds + the §25 tier-ladder /
// §26 weighted per-citation×per-entry scorer (T2 adds the §27 match-map
// orchestration `buildMatchMap`).
export {
  MATCH_WEIGHTS,
  MATCH_THRESHOLD,
  POSSIBLE_MISMATCH_THRESHOLD,
  MATCH_MARGIN,
} from './match/index.js';
export type { MatchWeights } from './match/index.js';
export { scoreCitationAgainstEntry, AUTHOR_TIER } from './match/index.js';
export type { CitationScore } from './match/index.js';
export { buildMatchMap } from './match/index.js';

// The shared §15 model contract (re-exported for one-import convenience).
export type {
  AcademicDocument,
  AuthorDateCitationItem,
  BibliographyCandidate,
  BibliographyDetectionResult,
  BibliographySection,
  BlockSourceMap,
  CitationItem,
  CitationMatchResult,
  CitationOccurrence,
  DocumentBlock,
  DocumentBlockType,
  DocumentMetadata,
  DocumentSecurityInfo,
  EntryMatchStatus,
  EntryMatchStatusRow,
  MatchMap,
  MatchReason,
  MatchState,
  NumericCitationItem,
  ParseIssue,
  PersonName,
  PersonNameKey,
  ReferenceEntry,
  ReferenceParseIssue,
  RunSpan,
  SourceLocation,
  SourceMap,
} from '@citesync/document-model';
