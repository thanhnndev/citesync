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
 */
export const DOCX_ENTRY_MAX = 50 * MIB;

/**
 * Aggregate uncompressed-size cap across all accepted entries (MiB).
 *
 * Because the reader's filter rejects an entry as soon as the running sum of
 * accepted entries would exceed this, unzipSync never materialises more than
 * ~200 MiB of decompressed data in total — this is what actually stops a
 * multi-entry zip bomb (many small-`originalSize` entries summing to gigabytes)
 * before any of them is decompressed.
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
 * iteration and the resulting parts map size. The reader rejects any entry
 * past this count in its filter, so nothing beyond the cap is decompressed.
 */
export const MAX_ENTRY_COUNT = 2000;

/**
 * Processing time budget (ms) — a best-effort, cross-entry guard.
 *
 * `fflate.unzipSync` is synchronous and cannot be preempted mid-inflate, so
 * this budget is enforced *between* entries: the reader records a start time
 * and its filter refuses further entries once the elapsed budget is spent.
 * Combined with DOCX_ENTRY_MAX + TOTAL_DECOMPRESSED_MAX (which bound the per-
 * entry and aggregate inflate work), this caps a single call to a bounded,
 * sub-second-to-~seconds worst case rather than a hang.
 */
export const PROCESSING_TIME_BUDGET_MS = 1500;
