/**
 * @citesync/docx — typed security/failure error classes (R002, R019, R022).
 *
 * The reader/parser contract distinguishes *why* an untrusted or malformed
 * buffer was rejected. Every failure path throws one of these subclasses of
 * {@link DocxReaderError} so callers can branch on intent (zip bomb vs "not a
 * DOCX" vs unsupported feature) without string-matching error messages.
 *
 * Each class reuses a shared, stable discriminator (`name`) and carries an
 * optional human-readable `detail` message in addition to the standard
 * `message`. `name` is the canonical programmatic signal (stable across
 * packaging); `message` is diagnostic.
 */

/** Base class for all bounds/format failures raised by the reader/parser. */
export abstract class DocxReaderError extends Error {
  readonly detail: string;

  constructor(message: string, detail?: string) {
    super(message);
    this.name = new.target.name;
    this.detail = detail ?? message;
  }
}

/**
 * The buffer is not a DOCX at all: not a zip, truncated/corrupt zip, an
 * archive that is empty or missing the required DOCX parts, or a directory.
 *
 * Raised for R019/R022 — never silently accept a non-DOCX. Truncated or
 * garbage input is classified here (not as a parse error) because it is not a
 * well-formed OOXML package at the structural layer.
 */
export class NotADocxError extends DocxReaderError {
  constructor(detail?: string) {
    super('Not a DOCX/OOXML package', detail);
  }
}

/**
 * The archive exceeds one of the documented resource bounds (S01-T3 limits)
 * — an oversized entry, an aggregate decompressed total over budget, too many
 * entries, an over-limit XML string, or a breach of the processing budget.
 *
 * This is the zip-bomb family (R016). A caller that catches this can reject
 * the upload with a "file too large / suspicious archive" message.
 */
export class ZipBombError extends DocxReaderError {
  constructor(detail?: string) {
    super('Archive exceeds resource bounds (possible zip bomb)', detail);
  }
}

/**
 * The archive is structurally a zip/DOCX but uses a feature or compression
 * this reader does not support (e.g. a compression method other than store
 * (0) or deflate (8), or encryption).
 *
 * Distinct from ZipBombError: the input is well-formed, just not something we
 * can read — callers can report "unsupported format" rather than "malicious".
 */
export class UnsupportedFormatError extends DocxReaderError {
  constructor(detail?: string) {
    super('Unsupported DOCX format/feature', detail);
  }
}

/**
 * The package structure is intact but a part failed to decode or parse
 * (decompression failure, invalid XML content, unexpected structure).
 *
 * Raised by later parser stages as well as the reader when a part that passed
 * the bounds filter still fails to decompress cleanly.
 */
export class ParseFailureError extends DocxReaderError {
  constructor(detail?: string) {
    super('DOCX part failed to parse', detail);
  }
}
