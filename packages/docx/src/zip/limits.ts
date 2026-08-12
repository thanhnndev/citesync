/**
 * @citesync/docx — bounds for the untrusted-input reader (research §7, R016).
 *
 * A .docx is attacker-controlled bytes. Every number here turns an unbounded
 * decode into a bounded one so the reader can never OOM (massive allocation)
 * or hang (unbounded work). Values below are deliberate, documented defaults;
 * they are generous enough for real documents (even PDF-embedded, appendix-
 * heavy theses are far smaller) while still capping a zip bomb at a
 * predictable, safe footprint.
 *
 * All caps are exclusive upper bounds: a value strictly greater than the cap
 * is rejected; a value equal to the cap is accepted.
 *
 * S01-T9 hardening: the central-directory sizes of a ZIP are attacker-
 * declared, so every cap below is enforced TWICE — once as a cheap
 * declared-size pre-filter (reader.ts filter) and again on the ACTUAL
 * extracted bytes (the S01-T9 lying-declaration stopper: fflate's sync
 * unzip truncates silent, so the reader now drives fflate's streaming
 * `Inflate` in bounded chunks and counts real output as it is produced).
 */

/** Byte count of 1 MiB (for readability below). */
const MIB = 1024 * 1024;

/**
 * Per-entry uncompressed-size cap (MiB).
 *
 * Word `document.xml` for large/appendixed theses is typically a few MiB;
 * pages-embedded or image-dense files occasionally push tens of MiB. 50 MiB
 * covers those while keeping the single largest decompression allocation
 * (and therefore single-entry inflate time) small and bounded.
 *
 * Enforced on ACTUAL output: the reader rejects an entry whose real inflated
 * bytes exceed this (S01-T9), even if the central directory declared a tiny
 * size. Because the streaming inflate aborts at cap+1 bytes, the worst-case
 * allocation is ~cap plus one feed chunk of expansion, independent of how
 * large the true bomb is.
 */
export const DOCX_ENTRY_MAX = 50 * MIB;

/**
 * Aggregate uncompressed-size cap across all accepted entries (MiB).
 *
 * The reader's declared-size pre-filter refuses an entry as soon as the
 * running DECLARED sum would exceed this (a cheap multi-entry-bomb stopper),
 * and the S01-T9 actual-size reconciliation re-checks the running sum of
 * ACTUAL extracted bytes after every entry — so even a set of lying entries
 * whose declarations stay under the cap cannot bypass the real total.
 */
export const TOTAL_DECOMPRESSED_MAX = 200 * MIB;

/**
 * Chars cap applied to each extracted XML part once it is decoded to a string
 * (UTF-16 code units, matching JS string length).
 *
 * The reader returns raw bytes; the parser (S01-T4) decodes a part to text
 * and must abort with ZipBombError if the resulting string exceeds this cap.
 * 64M chars bounds worst-case XML string memory (~128 MB of UTF-16) and XML
 * parser work. Kept here (not in the parser) so all bounds live in one file.
 */
export const XML_STRING_MAX = 64 * MIB;

/**
 * Max number of entries accepted from a single archive.
 *
 * A real .docx has a handful of parts (usually well under 100). 2000 leaves
 * room for pathological-but-legitimate archives while bounding the entry-loop
 * iteration and the resulting parts map size. Enforced twice: the count
 * declared by the end-of-central-directory record is capped BEFORE the
 * central-directory scan (so a lying EOCD cannot force a billion-iteration
 * loop), and the per-entry filter refuses anything past the cap as well.
 */
export const MAX_ENTRY_COUNT = 2000;

/**
 * Processing time budget (ms) — a best-effort guard.
 *
 * Enforced between entries (the declared-size pre-filter) AND between every
 * feed chunk of the bounded streaming inflate (S01-T9), so a hostile stream
 * cannot run the inflate loop past the budget even mid-entry. Combined with
 * DOCX_ENTRY_MAX + TOTAL_DECOMPRESSED_MAX (which bound the per-entry and
 * aggregate inflate work), this caps a single call to a bounded,
 * sub-second-to-~seconds worst case rather than a hang.
 */
export const PROCESSING_TIME_BUDGET_MS = 1500;
