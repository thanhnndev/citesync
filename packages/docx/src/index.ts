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

// The shared §15 model contract (re-exported for one-import convenience).
export type {
  AcademicDocument,
  AuthorDateCitationItem,
  BibliographySection,
  BlockSourceMap,
  CitationItem,
  CitationOccurrence,
  DocumentBlock,
  DocumentBlockType,
  DocumentMetadata,
  DocumentSecurityInfo,
  NumericCitationItem,
  ParseIssue,
  RunSpan,
  SourceLocation,
  SourceMap,
} from '@citesync/document-model';
