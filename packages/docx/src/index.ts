/**
 * @citesync/docx — public package surface.
 *
 * Exposes the bounds-guarded ZIP reader (S01-T3), its resource limits, its
 * typed security/failure errors, and the S01-T5 block parsers (paragraph /
 * table / styles.xml style map). Higher-level parseDocument() ->
 * AcademicDocument lands in S01-T6.
 */

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
