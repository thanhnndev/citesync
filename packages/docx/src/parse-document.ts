/**
 * @citesync/docx — the public `parseDocument` entry point (S01-T6).
 *
 * The S01 deliverable: untrusted .docx bytes -> {@link AcademicDocument}.
 * Wires the bounds-guarded zip reader (S01-T3), the block parsers (S01-T5),
 * the notes/metadata/security layers (S01-T6) and the source map into one
 * deterministic model that S02–S04 consume.
 *
 * Contract:
 *  - `Uint8Array` is used as-is; `ArrayBuffer` is wrapped in a fresh view.
 *  - Typed errors (R019/R022): {@link NotADocxError} for non-DOCX /
 *    truncated / garbage input, {@link ZipBombError} for any resource-bound
 *    breach (per-entry, aggregate, entry count, XML string cap, processing
 *    budget), {@link UnsupportedFormatError} for well-formed-but-unsupported
 *    archives (encryption / unknown compression). All from the S01-T3 family.
 *  - Failure isolation (§88): a malformed block/part inside an otherwise
 *    valid DOCX is recorded in `parseIssues`, never thrown.
 *  - Determinism (R008): no clock, no random, no platform dependence — the
 *    same bytes always yield a deep-equal AcademicDocument.
 */

import type { AcademicDocument } from '@citesync/document-model';

import { buildModel } from './build-model.js';
import type { BuildModelOptions } from './build-model.js';
import { safeZipRead } from './zip/reader.js';

/** Options for {@link parseDocument} — additive only, never changes the model. */
export type ParseDocumentOptions = BuildModelOptions;

/**
 * Parse a .docx buffer into the {@link AcademicDocument} model.
 *
 * @param buffer - raw .docx bytes (a `Uint8Array` or an `ArrayBuffer`).
 * @returns a complete model: metadata, ordered blocks with precise source
 *   locations, source map (run-level offsets), and citations left empty for
 *   S03.
 * @throws NotADocxError | ZipBombError | UnsupportedFormatError for invalid
 *   or unsafe input — typed, never a raw crash.
 */
export function parseDocument(
  buffer: Uint8Array | ArrayBuffer,
  options: ParseDocumentOptions = {},
): AcademicDocument {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const { parts } = safeZipRead(bytes);
  return buildModel(parts, options);
}
