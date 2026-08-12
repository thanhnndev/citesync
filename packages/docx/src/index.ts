/**
 * @citesync/docx — public package surface.
 *
 * Exposes the bounds-guarded ZIP reader (S01-T3), its resource limits and its
 * typed security/failure errors. Higher-level parseDocument() -> AcademicDocument
 * lands in S01-T4..T6.
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
