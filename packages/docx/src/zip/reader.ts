/**
 * @citesync/docx — bounds-guarded ZIP reader for untrusted .docx bytes.
 *
 * Turns an untrusted .docx into a bounded set of ZIP parts (as a Map) before
 * any XML is parsed. This is the highest-risk unblocker (research §7): it is
 * what prevents OOM/hang on a zip bomb and underpins R002/R016.
 *
 * Design (all documented in {@link ../zip/limits}):
 *  - fflate `unzipSync(data, { filter })` rejects entries whose uncompressed
 *    size exceeds DOCX_ENTRY_MAX *before* they are decompressed. fflate has no
 *    max-bytes parameter and `unzipSync` truncates silently without the filter
 *    (MEM007), so the filter is mandatory, not optional.
 *  - The filter is stateful: it also accumulates a running decompressed total
 *    and refuses further entries past TOTAL_DECOMPRESSED_MAX / MAX_ENTRY_COUNT
 *    / PROCESSING_TIME_BUDGET_MS, stopping a multi-entry zip bomb before the
 *    archive's entries ever materialise.
 *  - Sync unzip is used deliberately. The async streaming path (UnzipFile +
 *    start()) is rejected (MEM007) because it breaks byte-accurate
 *    run->offset source mapping the parser needs.
 *  - No other zip part is read or evaluated here beyond the bounded extract.
 */

import { unzipSync, type UnzipFileInfo } from 'fflate';
import {
  DOCX_ENTRY_MAX,
  MAX_ENTRY_COUNT,
  PROCESSING_TIME_BUDGET_MS,
  TOTAL_DECOMPRESSED_MAX,
} from './limits.js';
import {
  NotADocxError,
  UnsupportedFormatError,
  ZipBombError,
} from './errors.js';

/** Decompressed ZIP parts, keyed by the part's exact path in the archive. */
export type ZipParts = Map<string, Uint8Array>;

/**
 * A bounds-guarded package reader exposing its extracted parts as a Map.
 * `parts` is keyed by part path and is bounded per the limits contract.
 */
export interface ZipReader {
  /** Bounded decompressed parts, keyed by exact archive path. */
  parts: ZipParts;
}

/** Header magic of a local ZIP file record: `PK\x03\x04`. */
const LOCAL_HEADER_HI = 0x50; // 'P'
const LOCAL_HEADER_LO = 0x4b; // 'K'

/** Minimum bytes a ZIP end-of-central-directory record can occupy. */
const MIN_ZIP_LEN = 22;

/** Parts required for a DOCX to be acceptable (R019/R022). */
const REQUIRED_PARTS: readonly string[] = ['[Content_Types].xml', 'word/document.xml'];

/** Marker string fflate's $err() prefixes for an unknown compression method. */
const UNKNOWN_COMPRESSION = 'unknown compression type';

/**
 * Safely decompress an untrusted .docx buffer into a bounded parts Map.
 *
 * @param buffer - raw bytes of the .docx/zip.
 * @returns a {@link ZipReader} whose `.parts` is a Map of part-path -> bytes,
 *   bounded by the limits in {@link ../zip/limits}.
 * @throws {@link NotADocxError} if `buffer` is not a zip / is truncated or
 *   garbage / is a non-DOCX archive (no required parts).
 * @throws {@link ZipBombError} if any resource bound is exceeded (one entry
 *   too large, aggregate decompressed total too large, too many entries, or
 *   the processing budget is spent) — before the oversized work happens.
 * @throws {@link UnsupportedFormatError} for a well-formed archive this reader
 *   cannot decode (encryption or a non-store/non-deflate compression method).
 */
export function safeZipRead(buffer: Uint8Array): ZipReader {
  // Fast structural rejection: too short to hold a ZIP EOCD, or not a ZIP at
  // all (missing the leading "PK" local-header signature). Garbage and totally
  // non-zip input land here as NotADocxError instead of a raw fflate throw.
  if (
    buffer.length < MIN_ZIP_LEN ||
    buffer[0] !== LOCAL_HEADER_HI ||
    buffer[1] !== LOCAL_HEADER_LO
  ) {
    throw new NotADocxError(
      `input is not a ZIP archive (${buffer.length} bytes, missing PK magic)`,
    );
  }

  const startedAt = performance.now();
  let breached = false;
  let breachDetail = 'an archive resource bound';
  let runningTotal = 0;
  let acceptedCount = 0;

  // Stateful filter. Runs once per entry, BEFORE that entry is decompressed,
  // so no entry over any bound is ever materialised (the zip-bomb stopper).
  const filter = (f: UnzipFileInfo): boolean => {
    if (f.originalSize > DOCX_ENTRY_MAX) {
      breached = true;
      breachDetail = `entry "${f.name}" declares ${f.originalSize} bytes uncompressed (> DOCX_ENTRY_MAX)`;
      return false;
    }
    if (acceptedCount >= MAX_ENTRY_COUNT) {
      breached = true;
      breachDetail = `entry count exceeds MAX_ENTRY_COUNT (${MAX_ENTRY_COUNT})`;
      return false;
    }
    if (performance.now() - startedAt > PROCESSING_TIME_BUDGET_MS) {
      breached = true;
      breachDetail = `processing time exceeds PROCESSING_TIME_BUDGET_MS (${PROCESSING_TIME_BUDGET_MS}ms)`;
      return false;
    }
    if (runningTotal + f.originalSize > TOTAL_DECOMPRESSED_MAX) {
      breached = true;
      breachDetail = `aggregate decompressed size exceeds TOTAL_DECOMPRESSED_MAX (${TOTAL_DECOMPRESSED_MAX} bytes)`;
      return false;
    }
    runningTotal += f.originalSize;
    acceptedCount += 1;
    return true;
  };

  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(buffer, { filter });
  } catch (err) {
    throw classifyDecompressError(err);
  }

  // A bound was breached during extraction — surface it as the typed bomb
  // error (checked before the required-part check so partial/filtered-out
  // archives are not mislabelled as "not a DOCX").
  if (breached) {
    throw new ZipBombError(breachDetail);
  }

  const parts: ZipParts = new Map<string, Uint8Array>();
  for (const [name, bytes] of Object.entries(unzipped)) {
    parts.set(name, bytes);
  }

  // Never silently accept a non-DOCX (R019/R022): require the package parts
  // a real DOCX must contain.
  for (const required of REQUIRED_PARTS) {
    if (!parts.has(required)) {
      throw new NotADocxError(`archive is not a DOCX: missing required part "${required}"`);
    }
  }

  return { parts };
}

/** Rewrite an fflate decompression failure into our typed error family. */
function classifyDecompressError(err: unknown): DocxError {
  const detail =
    err instanceof Error ? err.message : `fflate unzip failed: ${String(err)}`;
  if (detail.includes(UNKNOWN_COMPRESSION)) {
    return new UnsupportedFormatError(detail);
  }
  // Encrypted archives report via the unsupported/invalid family; classify
  // anything that isn't a known supported path as unsupported or malformed.
  if (/encrypted/i.test(detail)) {
    return new UnsupportedFormatError(detail);
  }
  return new NotADocxError(`truncated or corrupt ZIP: ${detail}`);
}

/** Narrow alias for the union this module raises. */
type DocxError = NotADocxError | ZipBombError | UnsupportedFormatError;
