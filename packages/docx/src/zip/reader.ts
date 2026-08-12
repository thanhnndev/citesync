/**
 * @citesync/docx — bounds-guarded ZIP reader for untrusted .docx bytes.
 *
 * Turns an untrusted .docx into a bounded set of ZIP parts (as a Map) before
 * any XML is parsed. This is the highest-risk unblocker (research §7): it is
 * what prevents OOM/hang on a zip bomb and underpins R002/R016.
 *
 * S01-T9 hardening — the lying-declaration gap:
 *   fflate's `unzipSync` pre-allocates exactly the DECLARED uncompressed size
 *   (`new u8(originalSize)` with `resize` disabled) and silently TRUNCATES
 *   any deflate stream that actually expands further (verified empirically:
 *   a stream that really inflates to 60 MiB comes back as the declared 100
 *   bytes with no error). A post-hoc check on unzipSync's output therefore
 *   CANNOT see the lie — the truncation hides it. So the declared sizes in
 *   the central directory are treated as attacker-controlled hints ONLY:
 *   this reader parses the ZIP structure itself (mirroring fflate's own
 *   `unzipSync` semantics: EOCD scan, zip64, UTF-8 names, store/deflate) and
 *   decompresses each deflate entry with fflate's streaming `Inflate`, fed
 *   in small chunks, so the ACTUAL inflated byte count is observed as it is
 *   produced and the reader aborts with ZipBombError the moment a real byte
 *   exceeds any cap — before the bomb's true size is ever materialised.
 *
 * Guards (all enforced on ACTUAL bytes, not declared ones):
 *   - per-entry actual output  > DOCX_ENTRY_MAX          -> ZipBombError
 *   - actual output > declared uncompressed size (a lying
 *     declaration; honest archives always match exactly) -> ZipBombError
 *   - aggregate actual output > TOTAL_DECOMPRESSED_MAX   -> ZipBombError
 *   - entry count (EOCD-declared AND accepted) > MAX_ENTRY_COUNT -> ZipBombError
 *   - processing time > PROCESSING_TIME_BUDGET_MS (checked between entries
 *     and between every feed chunk)                     -> ZipBombError
 * The old declared-size filter is kept as a cheap pre-extraction fast path
 * (reject declared-oversized entries before any inflate work).
 *
 * Determinism (R008): the walk and the streaming inflate are pure functions
 * of the input bytes — no clocks/randomness enter the output, and the chunk
 * boundaries never change the inflated bytes (the inflate stream state is
 * carried across pushes). DOM/server-free; sync API preserved.
 */

import { Inflate } from 'fflate';
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

// ---------------------------------------------------------------------------
// ZIP structure constants
// ---------------------------------------------------------------------------

const LOCAL_HEADER_SIG = 0x04034b50; // PK\x03\x04
const CD_ENTRY_SIG = 0x02014b50; // PK\x01\x02
const EOCD_SIG = 0x06054b50; // PK\x05\x06
const ZIP64_LOCATOR_SIG = 0x07064b50; // PK\x06\x07
const ZIP64_EOCD_SIG = 0x06064b50; // PK\x06\x06
const ZIP64_EXTRA_ID = 0x0001; // zip64 extended information extra field
const ZIP64_SENTINEL = 0xffffffff; // "real value lives in the zip64 extra"
const MAX_EOCD_SCAN = 65558; // fflate's trailing-comment scan window
const INFLATE_FEED_CHUNK = 8192; // compressed bytes fed per inflate push
const MIN_ZIP_LEN = 22; // smallest possible EOCD record
const LOCAL_HEADER_HI = 0x50; // 'P' (fast non-ZIP rejection)
const LOCAL_HEADER_LO = 0x4b; // 'K'
const UTF8_NAME_FLAG = 0x800; // bit 11: filename is UTF-8

/** Parts required for a DOCX to be acceptable (R019/R022). */
const REQUIRED_PARTS: readonly string[] = ['[Content_Types].xml', 'word/document.xml'];

/**
 * One central-directory entry. `compressedSize` / `originalSize` are the
 * ATTACKER-DECLARED values — used only for the cheap pre-filter; all real
 * enforcement happens on actual extracted bytes.
 */
interface ZipEntryInfo {
  name: string;
  /** 0 = store, 8 = deflate, anything else = unsupported. */
  method: number;
  /** Declared compressed size (attacker-controlled). */
  compressedSize: number;
  /** Declared uncompressed size (attacker-controlled). */
  originalSize: number;
  /** Offset of the entry's local file header. */
  localHeaderOffset: number;
}

// ---------------------------------------------------------------------------
// Little-endian readers (explicit bounds guards -> NotADocxError, not a raw
// RangeError from an attacker-controlled offset).
// ---------------------------------------------------------------------------

function u16At(buf: Uint8Array, off: number): number {
  if (off < 0 || off + 2 > buf.length) {
    throw new NotADocxError('truncated or corrupt ZIP: header read out of bounds');
  }
  return buf[off]! | (buf[off + 1]! << 8);
}

function u32At(buf: Uint8Array, off: number): number {
  if (off < 0 || off + 4 > buf.length) {
    throw new NotADocxError('truncated or corrupt ZIP: header read out of bounds');
  }
  return (
    (buf[off]! | (buf[off + 1]! << 8) | (buf[off + 2]! << 16) | (buf[off + 3]! << 24)) >>>
    0
  );
}

function u64At(buf: Uint8Array, off: number): number {
  return u32At(buf, off) + u32At(buf, off + 4) * 4294967296;
}

/** Latin-1 (CP437-ish) decode for non-UTF-8 flagged names — mirrors fflate. */
function latin1(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return s;
}

// ---------------------------------------------------------------------------
// Central-directory walk (mirrors fflate unzipSync's structure parsing, with
// explicit bounds guards and the entry-count cap applied BEFORE the scan so a
// lying EOCD cannot force a billion-iteration loop).
// ---------------------------------------------------------------------------

function findEocd(buf: Uint8Array): number {
  const len = buf.length;
  for (let e = len - MIN_ZIP_LEN; e >= 0 && len - e <= MAX_EOCD_SCAN; e--) {
    if (u32At(buf, e) === EOCD_SIG) return e;
  }
  throw new NotADocxError('truncated or corrupt ZIP: no end-of-central-directory record');
}

function readCentralDirectory(buf: Uint8Array): ZipEntryInfo[] {
  const len = buf.length;
  const eocd = findEocd(buf);
  let count = u16At(buf, eocd + 8);
  let cdOffset = u32At(buf, eocd + 16);
  let zip64 = false;
  if (eocd >= 20 && u32At(buf, eocd - 20) === ZIP64_LOCATOR_SIG) {
    const ze = u32At(buf, eocd - 12); // zip64 EOCD offset (low 32 bits, mirroring fflate)
    if (ze + 56 <= len && u32At(buf, ze) === ZIP64_EOCD_SIG) {
      zip64 = true;
      count = u32At(buf, ze + 32);
      cdOffset = u32At(buf, ze + 48);
    }
  }

  // Entry-count cap BEFORE iterating: bounds the scan loop and the parts map
  // even against a lying EOCD declaring billions of entries.
  if (count > MAX_ENTRY_COUNT) {
    throw new ZipBombError(`entry count exceeds MAX_ENTRY_COUNT (${MAX_ENTRY_COUNT})`);
  }

  const entries: ZipEntryInfo[] = [];
  let off = cdOffset;
  for (let i = 0; i < count; i++) {
    if (off + 46 > len || u32At(buf, off) !== CD_ENTRY_SIG) {
      throw new NotADocxError('truncated or corrupt ZIP: bad central directory entry');
    }
    const flags = u16At(buf, off + 8);
    const method = u16At(buf, off + 10);
    const csize = u32At(buf, off + 20);
    const usize = u32At(buf, off + 24);
    const nameLen = u16At(buf, off + 28);
    const extraLen = u16At(buf, off + 30);
    const commentLen = u16At(buf, off + 32);
    const localOff = u32At(buf, off + 42);

    let sc = csize;
    let su = usize;
    let lo = localOff;
    const needZip64 =
      csize === ZIP64_SENTINEL || usize === ZIP64_SENTINEL || localOff === ZIP64_SENTINEL;
    if (needZip64) {
      if (!zip64) {
        throw new NotADocxError('truncated or corrupt ZIP: zip64 sentinel without zip64 archive');
      }
      // Scan the CD entry's extra field for the zip64 extended-information
      // record (id 0x0001); order inside it: uncompressed, compressed, offset.
      let eo = off + 46 + nameLen;
      const eoEnd = eo + extraLen;
      if (eoEnd > len) {
        throw new NotADocxError('truncated or corrupt ZIP: central directory extra field out of bounds');
      }
      let found = false;
      while (eo + 4 <= eoEnd) {
        const id = u16At(buf, eo);
        const size = u16At(buf, eo + 2);
        if (id === ZIP64_EXTRA_ID) {
          let p = eo + 4;
          if (usize === ZIP64_SENTINEL) {
            su = u64At(buf, p);
            p += 8;
          }
          if (csize === ZIP64_SENTINEL) {
            sc = u64At(buf, p);
            p += 8;
          }
          if (localOff === ZIP64_SENTINEL) {
            lo = u64At(buf, p);
          }
          found = true;
          break;
        }
        eo += 4 + size;
      }
      if (!found) {
        throw new NotADocxError('truncated or corrupt ZIP: missing zip64 extra field');
      }
    }

    const nameBytes = buf.subarray(off + 46, off + 46 + nameLen);
    const name = flags & UTF8_NAME_FLAG ? new TextDecoder().decode(nameBytes) : latin1(nameBytes);
    entries.push({ name, method, compressedSize: sc, originalSize: su, localHeaderOffset: lo });

    off += 46 + nameLen + extraLen + commentLen;
    if (off > len) {
      throw new NotADocxError('truncated or corrupt ZIP: central directory entry out of bounds');
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Entry extraction. Store entries are views into the input buffer (cheap);
// deflate entries go through the bounded streaming inflate so the ACTUAL
// output count is observed and capped as it is produced.
// ---------------------------------------------------------------------------

/** Absolute offset of an entry's compressed payload (local header walk). */
function dataStartOf(buf: Uint8Array, entry: ZipEntryInfo): number {
  const lh = entry.localHeaderOffset;
  if (lh + 30 > buf.length || u32At(buf, lh) !== LOCAL_HEADER_SIG) {
    throw new NotADocxError('truncated or corrupt ZIP: bad local file header');
  }
  const start = lh + 30 + u16At(buf, lh + 26) + u16At(buf, lh + 28);
  if (start > buf.length) {
    throw new NotADocxError('truncated or corrupt ZIP: entry data out of bounds');
  }
  return start;
}

/** Store (method 0): a clamped view of the raw bytes, actual-size enforced. */
function extractStore(buf: Uint8Array, dataStart: number, entry: ZipEntryInfo): Uint8Array {
  const end = Math.min(dataStart + entry.compressedSize, buf.length);
  const bytes = buf.subarray(dataStart, end);
  if (bytes.length > DOCX_ENTRY_MAX) {
    throw new ZipBombError(`entry "${entry.name}" stored ${bytes.length} bytes (> DOCX_ENTRY_MAX)`);
  }
  if (bytes.length > entry.originalSize) {
    throw new ZipBombError(
      `entry "${entry.name}" declared ${entry.originalSize} bytes but stored ${bytes.length} (declared-vs-actual mismatch)`,
    );
  }
  return bytes;
}

/**
 * Deflate (method 8): bounded streaming inflate.
 *
 * The compressed stream is fed to fflate's streaming `Inflate` in fixed-size
 * chunks. Every chunk's actual output is counted BEFORE it is kept, so the
 * moment the real inflated bytes exceed a cap (or exceed the declared size)
 * the reader throws ZipBombError and the inflate aborts mid-stream — a
 * multi-GB logical bomb is never materialised and never hangs the process.
 */
function extractDeflate(
  buf: Uint8Array,
  dataStart: number,
  entry: ZipEntryInfo,
  startedAt: number,
): Uint8Array {
  const compressed = buf.subarray(dataStart, Math.min(dataStart + entry.compressedSize, buf.length));
  const chunks: Uint8Array[] = [];
  let actual = 0;

  const inflater = new Inflate((dat: Uint8Array): void => {
    if (dat.length === 0) return;
    actual += dat.length;
    if (actual > DOCX_ENTRY_MAX) {
      throw new ZipBombError(`entry "${entry.name}" inflated to ${actual} bytes (> DOCX_ENTRY_MAX)`);
    }
    if (actual > entry.originalSize) {
      throw new ZipBombError(
        `entry "${entry.name}" declared ${entry.originalSize} bytes but inflated to ${actual} (declared-vs-actual mismatch)`,
      );
    }
    checkTimeBudget(startedAt);
    chunks.push(dat);
  });

  for (let i = 0; i < compressed.length; i += INFLATE_FEED_CHUNK) {
    checkTimeBudget(startedAt);
    inflater.push(
      compressed.subarray(i, Math.min(i + INFLATE_FEED_CHUNK, compressed.length)),
      i + INFLATE_FEED_CHUNK >= compressed.length,
    );
  }

  if (chunks.length === 0) return new Uint8Array(0);
  if (chunks.length === 1) return chunks[0]!;
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Safely decompress an untrusted .docx buffer into a bounded parts Map.
 *
 * @param buffer - raw bytes of the .docx/zip.
 * @returns a {@link ZipReader} whose `.parts` is a Map of part-path -> bytes,
 *   bounded by the limits in {@link ../zip/limits}. All limits are enforced
 *   on ACTUAL extracted bytes (not attacker-declared sizes).
 * @throws {@link NotADocxError} if `buffer` is not a zip / is truncated or
 *   garbage / is a non-DOCX archive (no required parts).
 * @throws {@link ZipBombError} if any resource bound is exceeded — per-entry
 *   actual size, actual-vs-declared mismatch (lying declaration), aggregate
 *   actual total, entry count, or the processing budget.
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
  const parts: ZipParts = new Map();
  let declaredTotal = 0; // running sum of DECLARED sizes (cheap pre-filter)
  let actualTotal = 0; // running sum of ACTUAL extracted sizes (real bound)
  let acceptedCount = 0;

  let entries: ZipEntryInfo[];
  try {
    entries = readCentralDirectory(buffer);
  } catch (err) {
    throw classifyDecompressError(err);
  }

  for (const entry of entries) {
    try {
      // --- Declared-size pre-filter (cheap; runs before any extraction, so
      // an entry that *declares* more than a cap is refused up front). ---
      if (entry.originalSize > DOCX_ENTRY_MAX) {
        throw new ZipBombError(
          `entry "${entry.name}" declares ${entry.originalSize} bytes uncompressed (> DOCX_ENTRY_MAX)`,
        );
      }
      if (acceptedCount >= MAX_ENTRY_COUNT) {
        throw new ZipBombError(`entry count exceeds MAX_ENTRY_COUNT (${MAX_ENTRY_COUNT})`);
      }
      checkTimeBudget(startedAt);
      if (declaredTotal + entry.originalSize > TOTAL_DECOMPRESSED_MAX) {
        throw new ZipBombError(
          `aggregate decompressed size exceeds TOTAL_DECOMPRESSED_MAX (${TOTAL_DECOMPRESSED_MAX} bytes)`,
        );
      }
      declaredTotal += entry.originalSize;
      acceptedCount += 1;

      // --- Extraction; every bound is re-checked on the ACTUAL bytes. ---
      if (entry.method === 0) {
        parts.set(entry.name, extractStore(buffer, dataStartOf(buffer, entry), entry));
      } else if (entry.method === 8) {
        parts.set(entry.name, extractDeflate(buffer, dataStartOf(buffer, entry), entry, startedAt));
      } else {
        throw new UnsupportedFormatError(`unknown compression type ${entry.method}`);
      }

      actualTotal += parts.get(entry.name)!.length;
      if (actualTotal > TOTAL_DECOMPRESSED_MAX) {
        throw new ZipBombError(
          `aggregate actual decompressed size exceeds TOTAL_DECOMPRESSED_MAX (${TOTAL_DECOMPRESSED_MAX} bytes)`,
        );
      }
    } catch (err) {
      throw classifyDecompressError(err);
    }
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

/** ZipBombError for a spent processing budget (shared by entry/chunk checks). */
function checkTimeBudget(startedAt: number): void {
  if (performance.now() - startedAt > PROCESSING_TIME_BUDGET_MS) {
    throw new ZipBombError(
      `processing time exceeds PROCESSING_TIME_BUDGET_MS (${PROCESSING_TIME_BUDGET_MS}ms)`,
    );
  }
}

/** Marker string fflate's $err() prefixes for an unknown compression method. */
const UNKNOWN_COMPRESSION = 'unknown compression type';

/**
 * Rewrite a decompression failure into our typed error family. Our own typed
 * errors (ZipBombError from the actual-size enforcement, etc.) pass through
 * untouched; raw fflate inflate failures (unexpected EOF, invalid distance,
 * corrupt deflate) map to NotADocxError.
 */
function classifyDecompressError(err: unknown): DocxError {
  if (
    err instanceof NotADocxError ||
    err instanceof ZipBombError ||
    err instanceof UnsupportedFormatError
  ) {
    return err;
  }
  const detail = err instanceof Error ? err.message : `fflate unzip failed: ${String(err)}`;
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
