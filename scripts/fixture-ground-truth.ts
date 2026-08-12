/**
 * S03-T06 — fixture extraction ground truth (KNOWN_CITATIONS/KNOWN_REFERENCES).
 *
 * Single source of truth for the S03 end-to-end extraction assertions:
 * the exact §20 citation occurrences and §21 reference entries the pipeline
 * MUST produce for each committed fixture. Authored by hand from the fixture
 * corpus in `scripts/make-fixtures.ts` and verified against the real pipeline;
 * consumed by:
 *
 *   - `packages/docx/tests/extraction.test.ts` — deep-equal assertions
 *     (drift guard: any change to the model shape, fixture bytes, grammar or
 *     normalization breaks these tables);
 *   - `scripts/make-fixtures.ts` — renders the same tables into
 *     `fixtures/README.md` so the manifest documents the ground truth.
 *
 * Pure data — no imports, no side effects — so both tsx (scripts) and vitest
 * (packages) can load it directly. All values are byte-stable (R008): offsets
 * are UTF-16 char offsets into block text (end-exclusive, `slice` semantics),
 * ids are `c{n}` / `r{n}` in document order, confidences are the pinned
 * deterministic scores of T03/T05.
 */

/** Expected §20 occurrence projection (as asserted by extraction.test.ts). */
export interface KnownCitationOccurrence {
  id: string;
  raw: string;
  family: 'author-date';
  items: Array<{
    firstAuthor?: string;
    authors?: string[];
    year?: number;
    yearSuffix?: string;
    page?: string;
  }>;
  source: { blockId: string; startOffset: number; endOffset: number };
  confidence: number;
}

/** Expected §21 entry projection (as asserted by extraction.test.ts). */
export interface KnownReferenceEntry {
  id: string;
  raw: string;
  index: number;
  authors?: Array<{
    originalName: string;
    family: string;
    given?: string;
    key: { exact: string; diacriticInsensitive: string; initials: string };
  }>;
  year?: number;
  yearSuffix?: string;
  title?: string;
  containerTitle?: string;
  doi?: string;
  identifiers?: Record<string, string>;
  source: { blockId: string; startOffset: number; endOffset: number };
  parseConfidence: number;
}

/** Compact item builder for the citation tables (keeps the file readable). */
const item = (o: KnownCitationOccurrence['items'][number]): KnownCitationOccurrence['items'][number] => o;

const O = (o: KnownCitationOccurrence): KnownCitationOccurrence => o;

/**
 * Expected §20 citation occurrences per fixture, in document order (ids c0..).
 * `source` = { blockId, startOffset, endOffset } — the occurrence's raw region
 * inside that block's text (`text.slice(startOffset, endOffset) === raw`).
 */
export const KNOWN_OCCURRENCES: Record<string, KnownCitationOccurrence[]> = {
  'minimal.docx': [
    O({
      id: 'c0', raw: 'Smith (2024)', family: 'author-date',
      items: [item({ firstAuthor: 'Smith', authors: ['Smith'], year: 2024 })],
      source: { blockId: 'doc-p1', startOffset: 0, endOffset: 12 }, confidence: 0.9,
    }),
  ],

  'author-date/simple.docx': [
    O({
      id: 'c0', raw: 'Smith (2020)', family: 'author-date',
      items: [item({ firstAuthor: 'Smith', authors: ['Smith'], year: 2020 })],
      source: { blockId: 'doc-p1', startOffset: 0, endOffset: 12 }, confidence: 0.9,
    }),
    O({
      id: 'c1', raw: '(Nguyen & Tran, 2021)', family: 'author-date',
      items: [item({ firstAuthor: 'Nguyen', authors: ['Nguyen', 'Tran'], year: 2021 })],
      source: { blockId: 'doc-p2', startOffset: 12, endOffset: 33 }, confidence: 0.93,
    }),
    O({
      id: 'c2', raw: '(Lee, 2019)', family: 'author-date',
      items: [item({ firstAuthor: 'Lee', authors: ['Lee'], year: 2019 })],
      source: { blockId: 'doc-p3', startOffset: 14, endOffset: 25 }, confidence: 1,
    }),
    // Footnote block fn-fn0: "Smith (2020) elaborates ... in a footnote."
    O({
      id: 'c3', raw: 'Smith (2020)', family: 'author-date',
      items: [item({ firstAuthor: 'Smith', authors: ['Smith'], year: 2020 })],
      source: { blockId: 'fn-fn0', startOffset: 0, endOffset: 12 }, confidence: 0.9,
    }),
  ],

  'author-date/et-al.docx': [
    // Structured Zotero field (CSL_CITATION): identity authors from itemData
    // (Nguyen H., Tran L.), display region "(Nguyen et al., 2019)" round-trips.
    O({
      id: 'c0', raw: '(Nguyen et al., 2019)', family: 'author-date',
      items: [item({ firstAuthor: 'Nguyen', authors: ['Nguyen H.', 'Tran L.'], year: 2019 })],
      source: { blockId: 'doc-p1', startOffset: 12, endOffset: 33 }, confidence: 1,
    }),
    O({
      id: 'c1', raw: 'Anderson, Brown, and Clark (2018)', family: 'author-date',
      items: [item({ firstAuthor: 'Anderson', authors: ['Anderson', 'Brown', 'Clark'], year: 2018 })],
      source: { blockId: 'doc-p2', startOffset: 0, endOffset: 33 }, confidence: 0.837,
    }),
    O({
      id: 'c2', raw: '(Williams et al., 2022)', family: 'author-date',
      items: [item({ firstAuthor: 'Williams', authors: ['Williams', 'et al.'], year: 2022 })],
      source: { blockId: 'doc-p3', startOffset: 13, endOffset: 36 }, confidence: 0.9,
    }),
    // Footnote fn-fn0: narrative et-al with trailing period.
    O({
      id: 'c3', raw: 'Nguyen et al. (2019)', family: 'author-date',
      items: [item({ firstAuthor: 'Nguyen', authors: ['Nguyen et al.'], year: 2019 })],
      source: { blockId: 'fn-fn0', startOffset: 0, endOffset: 20 }, confidence: 0.81,
    }),
  ],

  'author-date/multiple-authors.docx': [
    O({
      id: 'c0', raw: '(Duong, Tran, & Le, 2020)', family: 'author-date',
      items: [item({ firstAuthor: 'Duong', authors: ['Duong', 'Tran', 'Le'], year: 2020 })],
      source: { blockId: 'doc-p0', startOffset: 0, endOffset: 25 }, confidence: 0.93,
    }),
    O({
      id: 'c1', raw: 'Pham and Nguyen (2017)', family: 'author-date',
      items: [item({ firstAuthor: 'Pham', authors: ['Pham', 'Nguyen'], year: 2017 })],
      source: { blockId: 'doc-p1', startOffset: 0, endOffset: 22 }, confidence: 0.837,
    }),
    O({
      id: 'c2', raw: 'Ngo, Vu, Hoang, and Bui (2016)', family: 'author-date',
      items: [item({ firstAuthor: 'Ngo', authors: ['Ngo', 'Vu', 'Hoang', 'Bui'], year: 2016 })],
      source: { blockId: 'doc-p2', startOffset: 0, endOffset: 30 }, confidence: 0.837,
    }),
  ],

  'author-date/same-author-year.docx': [
    O({
      id: 'c0', raw: 'Smith (2020a)', family: 'author-date',
      items: [item({ firstAuthor: 'Smith', authors: ['Smith'], year: 2020, yearSuffix: 'a' })],
      source: { blockId: 'doc-p0', startOffset: 0, endOffset: 13 }, confidence: 0.855,
    }),
    O({
      id: 'c1', raw: 'Smith (2020b)', family: 'author-date',
      items: [item({ firstAuthor: 'Smith', authors: ['Smith'], year: 2020, yearSuffix: 'b' })],
      source: { blockId: 'doc-p0', startOffset: 35, endOffset: 48 }, confidence: 0.855,
    }),
    // Multi-citation semicolon: two year-suffixed items in one occurrence.
    O({
      id: 'c2', raw: '(Smith, 2020a; Smith, 2020b)', family: 'author-date',
      items: [
        item({ firstAuthor: 'Smith', authors: ['Smith'], year: 2020, yearSuffix: 'a' }),
        item({ firstAuthor: 'Smith', authors: ['Smith'], year: 2020, yearSuffix: 'b' }),
      ],
      source: { blockId: 'doc-p1', startOffset: 0, endOffset: 28 }, confidence: 0.855,
    }),
  ],

  'author-date/missing.docx': [
    // "An anonymous reviewer (n.d.)" collapses to the bare missing-author
    // "(n.d.)" item (T03 documented behavior — reviewer/anonymous backtrack).
    O({
      id: 'c0', raw: '(n.d.)', family: 'author-date',
      items: [item({})],
      source: { blockId: 'doc-p0', startOffset: 22, endOffset: 28 }, confidence: 0.385,
    }),
    O({
      id: 'c1', raw: '(Author unknown, n.d.)', family: 'author-date',
      items: [item({ firstAuthor: 'Author', authors: ['Author', 'unknown'] })],
      source: { blockId: 'doc-p1', startOffset: 0, endOffset: 22 }, confidence: 0.651,
    }),
  ],

  'author-date/ambiguous.docx': [
    O({
      id: 'c0', raw: '(Smith, 2020)', family: 'author-date',
      items: [item({ firstAuthor: 'Smith', authors: ['Smith'], year: 2020 })],
      source: { blockId: 'doc-p0', startOffset: 0, endOffset: 13 }, confidence: 1,
    }),
    O({
      id: 'c1', raw: 'Smith (2020)', family: 'author-date',
      items: [item({ firstAuthor: 'Smith', authors: ['Smith'], year: 2020 })],
      source: { blockId: 'doc-p1', startOffset: 0, endOffset: 12 }, confidence: 0.9,
    }),
    // "(2020; 2021)" (no author) is NOT a citation — conservative guard.
  ],

  'author-date/vietnamese.docx': [
    // "Theo Nguyễn Văn A (2015)" — first author is the family-first Nguyễn.
    O({
      id: 'c0', raw: 'Nguyễn Văn A (2015)', family: 'author-date',
      items: [item({ firstAuthor: 'Nguyễn', authors: ['Nguyễn Văn A'], year: 2015 })],
      source: { blockId: 'doc-p1', startOffset: 5, endOffset: 24 }, confidence: 0.9,
    }),
    O({
      id: 'c1', raw: 'Trần Thị B (2018)', family: 'author-date',
      items: [item({ firstAuthor: 'Trần', authors: ['Trần Thị B'], year: 2018 })],
      source: { blockId: 'doc-p2', startOffset: 15, endOffset: 32 }, confidence: 0.9,
    }),
    O({
      id: 'c2', raw: 'Phạm Quốc C (2020)', family: 'author-date',
      items: [item({ firstAuthor: 'Phạm', authors: ['Phạm Quốc C'], year: 2020 })],
      source: { blockId: 'doc-p3', startOffset: 20, endOffset: 38 }, confidence: 0.9,
    }),
    // Footnote fn-fn0: "Xem thêm Nguyễn Văn A (2015), chương 2."
    O({
      id: 'c3', raw: 'Nguyễn Văn A (2015)', family: 'author-date',
      items: [item({ firstAuthor: 'Nguyễn', authors: ['Nguyễn Văn A'], year: 2015 })],
      source: { blockId: 'fn-fn0', startOffset: 9, endOffset: 28 }, confidence: 0.9,
    }),
  ],

  'documents/docx/apa-like.docx': [
    O({
      id: 'c0', raw: 'Johnson (2018)', family: 'author-date',
      items: [item({ firstAuthor: 'Johnson', authors: ['Johnson'], year: 2018 })],
      source: { blockId: 'doc-p1', startOffset: 13, endOffset: 27 }, confidence: 0.9,
    }),
    O({
      id: 'c1', raw: '(Doe, 2017; Roe, 2019)', family: 'author-date',
      items: [
        item({ firstAuthor: 'Doe', authors: ['Doe'], year: 2017 }),
        item({ firstAuthor: 'Roe', authors: ['Roe'], year: 2019 }),
      ],
      source: { blockId: 'doc-p2', startOffset: 17, endOffset: 39 }, confidence: 0.9,
    }),
    // The reference-entry blocks' "(YYYY)" also parses as narrative citations.
    O({
      id: 'c2', raw: 'Doe, J. (2017)', family: 'author-date',
      items: [item({ firstAuthor: 'Doe', authors: ['Doe', 'J.'], year: 2017 })],
      source: { blockId: 'doc-p3', startOffset: 0, endOffset: 14 }, confidence: 0.837,
    }),
    O({
      id: 'c3', raw: 'Johnson, A. (2018)', family: 'author-date',
      items: [item({ firstAuthor: 'Johnson', authors: ['Johnson'], year: 2018 })],
      source: { blockId: 'doc-p4', startOffset: 0, endOffset: 18 }, confidence: 0.9,
    }),
    O({
      id: 'c4', raw: 'Roe, M. (2019)', family: 'author-date',
      items: [item({ firstAuthor: 'Roe', authors: ['Roe', 'M.'], year: 2019 })],
      source: { blockId: 'doc-p5', startOffset: 0, endOffset: 14 }, confidence: 0.837,
    }),
  ],

  'documents/docx/harvard.docx': [
    O({
      id: 'c0', raw: '(Smith, 2024, p. 12)', family: 'author-date',
      items: [item({ firstAuthor: 'Smith', authors: ['Smith'], year: 2024, page: '12' })],
      source: { blockId: 'doc-p0', startOffset: 17, endOffset: 37 }, confidence: 0.97,
    }),
    O({
      id: 'c1', raw: '(Nguyen 2021)', family: 'author-date',
      items: [item({ firstAuthor: 'Nguyen', authors: ['Nguyen'], year: 2021 })],
      source: { blockId: 'doc-p1', startOffset: 14, endOffset: 27 }, confidence: 0.85,
    }),
    O({
      id: 'c2', raw: 'Le (2023)', family: 'author-date',
      items: [item({ firstAuthor: 'Le', authors: ['Le'], year: 2023 })],
      source: { blockId: 'doc-p2', startOffset: 32, endOffset: 41 }, confidence: 0.9,
    }),
  ],

  'documents/docx/plain-text.docx': [
    // "Smith 2024." (bare) and "[1]" (numeric) are NEVER citations — guards.
    O({
      id: 'c0', raw: '(Johnson 2018)', family: 'author-date',
      items: [item({ firstAuthor: 'Johnson', authors: ['Johnson'], year: 2018 })],
      source: { blockId: 'doc-p0', startOffset: 21, endOffset: 35 }, confidence: 0.85,
    }),
  ],

  'bibliography/en-references.docx': [
    O({
      id: 'c0', raw: 'Doe (2017)', family: 'author-date',
      items: [item({ firstAuthor: 'Doe', authors: ['Doe'], year: 2017 })],
      source: { blockId: 'doc-p1', startOffset: 0, endOffset: 10 }, confidence: 0.9,
    }),
    O({
      id: 'c1', raw: 'Johnson (2018)', family: 'author-date',
      items: [item({ firstAuthor: 'Johnson', authors: ['Johnson'], year: 2018 })],
      source: { blockId: 'doc-p2', startOffset: 0, endOffset: 14 }, confidence: 0.9,
    }),
    O({
      id: 'c2', raw: 'Roe (2019)', family: 'author-date',
      items: [item({ firstAuthor: 'Roe', authors: ['Roe'], year: 2019 })],
      source: { blockId: 'doc-p3', startOffset: 0, endOffset: 10 }, confidence: 0.9,
    }),
    O({
      id: 'c3', raw: 'Doe, J. (2017)', family: 'author-date',
      items: [item({ firstAuthor: 'Doe', authors: ['Doe', 'J.'], year: 2017 })],
      source: { blockId: 'doc-p5', startOffset: 0, endOffset: 14 }, confidence: 0.837,
    }),
    O({
      id: 'c4', raw: 'Johnson, A. (2018)', family: 'author-date',
      items: [item({ firstAuthor: 'Johnson', authors: ['Johnson'], year: 2018 })],
      source: { blockId: 'doc-p6', startOffset: 0, endOffset: 18 }, confidence: 0.9,
    }),
    O({
      id: 'c5', raw: 'Roe, M. (2019)', family: 'author-date',
      items: [item({ firstAuthor: 'Roe', authors: ['Roe', 'M.'], year: 2019 })],
      source: { blockId: 'doc-p7', startOffset: 0, endOffset: 14 }, confidence: 0.837,
    }),
  ],

  'bibliography/vi-tai-lieu.docx': [
    O({
      id: 'c0', raw: 'Nguyễn, V. A. (2015)', family: 'author-date',
      items: [item({ firstAuthor: 'Nguyễn', authors: ['Nguyễn', 'V. A.'], year: 2015 })],
      source: { blockId: 'doc-p1', startOffset: 0, endOffset: 20 }, confidence: 0.837,
    }),
    O({
      id: 'c1', raw: 'Trần, T. B. (2018)', family: 'author-date',
      items: [item({ firstAuthor: 'Trần', authors: ['Trần', 'T. B.'], year: 2018 })],
      source: { blockId: 'doc-p2', startOffset: 0, endOffset: 18 }, confidence: 0.837,
    }),
    O({
      id: 'c2', raw: 'Phạm, Q. C. (2020)', family: 'author-date',
      items: [item({ firstAuthor: 'Phạm', authors: ['Phạm', 'Q. C.'], year: 2020 })],
      source: { blockId: 'doc-p3', startOffset: 0, endOffset: 18 }, confidence: 0.837,
    }),
  ],

  'bibliography/style-position.docx': [
    O({
      id: 'c0', raw: 'Nguyễn (2019)', family: 'author-date',
      items: [item({ firstAuthor: 'Nguyễn', authors: ['Nguyễn'], year: 2019 })],
      source: { blockId: 'doc-p2', startOffset: 5, endOffset: 18 }, confidence: 0.9,
    }),
    O({
      id: 'c1', raw: 'Doe, J. (2017)', family: 'author-date',
      items: [item({ firstAuthor: 'Doe', authors: ['Doe', 'J.'], year: 2017 })],
      source: { blockId: 'doc-p6', startOffset: 0, endOffset: 14 }, confidence: 0.837,
    }),
    O({
      id: 'c2', raw: 'Johnson, A. (2018)', family: 'author-date',
      items: [item({ firstAuthor: 'Johnson', authors: ['Johnson'], year: 2018 })],
      source: { blockId: 'doc-p7', startOffset: 0, endOffset: 18 }, confidence: 0.9,
    }),
    O({
      id: 'c3', raw: 'Roe, M. (2019)', family: 'author-date',
      items: [item({ firstAuthor: 'Roe', authors: ['Roe', 'M.'], year: 2019 })],
      source: { blockId: 'doc-p8', startOffset: 0, endOffset: 14 }, confidence: 0.837,
    }),
  ],

  'bibliography/no-bibliography.docx': [
    O({
      id: 'c0', raw: 'Smith (2020)', family: 'author-date',
      items: [item({ firstAuthor: 'Smith', authors: ['Smith'], year: 2020 })],
      source: { blockId: 'doc-p1', startOffset: 0, endOffset: 12 }, confidence: 0.9,
    }),
    O({
      id: 'c1', raw: '(Nguyen & Tran, 2021)', family: 'author-date',
      items: [item({ firstAuthor: 'Nguyen', authors: ['Nguyen', 'Tran'], year: 2021 })],
      source: { blockId: 'doc-p2', startOffset: 12, endOffset: 33 }, confidence: 0.93,
    }),
  ],

  'bibliography/ambiguous.docx': [
    O({
      id: 'c0', raw: '(Doe, 2017)', family: 'author-date',
      items: [item({ firstAuthor: 'Doe', authors: ['Doe'], year: 2017 })],
      source: { blockId: 'doc-p2', startOffset: 12, endOffset: 23 }, confidence: 1,
    }),
  ],

  // S04-T1: same author, two years — year-weight calibration fixture. The
  // entry blocks' "Doe, J. (2018)" narrative tails are themselves citations.
  'match/same-author-two-years.docx': [
    O({
      id: 'c0', raw: 'Doe (2018)', family: 'author-date',
      items: [item({ firstAuthor: 'Doe', authors: ['Doe'], year: 2018 })],
      source: { blockId: 'doc-p1', startOffset: 0, endOffset: 10 }, confidence: 0.9,
    }),
    O({
      id: 'c1', raw: '(Doe, 2021)', family: 'author-date',
      items: [item({ firstAuthor: 'Doe', authors: ['Doe'], year: 2021 })],
      source: { blockId: 'doc-p2', startOffset: 0, endOffset: 11 }, confidence: 1,
    }),
    O({
      id: 'c2', raw: 'Doe, J. (2018)', family: 'author-date',
      items: [item({ firstAuthor: 'Doe', authors: ['Doe', 'J.'], year: 2018 })],
      source: { blockId: 'doc-p4', startOffset: 0, endOffset: 14 }, confidence: 0.837,
    }),
    O({
      id: 'c3', raw: 'Doe, J. (2021)', family: 'author-date',
      items: [item({ firstAuthor: 'Doe', authors: ['Doe', 'J.'], year: 2021 })],
      source: { blockId: 'doc-p5', startOffset: 0, endOffset: 14 }, confidence: 0.837,
    }),
  ],

  // S04-T2: one citation, TWO entries sharing author AND year (two distinct
  // Smith, J. 2020 works) -> the orchestration must emit AMBIGUOUS, never
  // auto-pick (§27/§31 CS004). The entry tails are citations too.
  'match/ambiguous-same-author-year.docx': [
    O({
      id: 'c0', raw: 'Smith (2020)', family: 'author-date',
      items: [item({ firstAuthor: 'Smith', authors: ['Smith'], year: 2020 })],
      source: { blockId: 'doc-p1', startOffset: 0, endOffset: 12 }, confidence: 0.9,
    }),
    O({
      id: 'c1', raw: 'Smith, J. (2020)', family: 'author-date',
      items: [item({ firstAuthor: 'Smith', authors: ['Smith', 'J.'], year: 2020 })],
      source: { blockId: 'doc-p3', startOffset: 0, endOffset: 16 }, confidence: 0.837,
    }),
    O({
      id: 'c2', raw: 'Smith, J. (2020)', family: 'author-date',
      items: [item({ firstAuthor: 'Smith', authors: ['Smith', 'J.'], year: 2020 })],
      source: { blockId: 'doc-p4', startOffset: 0, endOffset: 16 }, confidence: 0.837,
    }),
  ],

  // S04-T2: near-miss author — citation "Smith, J." vs entry "Smith, P."
  // (same surname, CONTRADICTING given initial, same year): POSSIBLE_MISMATCH
  // via the given-initial guard, never a confident MATCHED (§79).
  'match/near-miss-author.docx': [
    O({
      id: 'c0', raw: 'Smith, J. (2019)', family: 'author-date',
      items: [item({ firstAuthor: 'Smith', authors: ['Smith', 'J.'], year: 2019 })],
      source: { blockId: 'doc-p1', startOffset: 0, endOffset: 16 }, confidence: 0.837,
    }),
    O({
      id: 'c1', raw: 'Smith, P. (2019)', family: 'author-date',
      items: [item({ firstAuthor: 'Smith', authors: ['Smith', 'P.'], year: 2019 })],
      source: { blockId: 'doc-p3', startOffset: 0, endOffset: 16 }, confidence: 0.837,
    }),
    O({
      id: 'c2', raw: 'Roe, M. (2017)', family: 'author-date',
      items: [item({ firstAuthor: 'Roe', authors: ['Roe', 'M.'], year: 2017 })],
      source: { blockId: 'doc-p4', startOffset: 0, endOffset: 14 }, confidence: 0.837,
    }),
  ],

  // S04-T2: Vietnamese near-miss pair — Nguyễn/Nguyen crosses the §25
  // diacritic-insensitive tier (tier-3 signal reported, never promoted over
  // exact) while Đỗ/Do stays DISTINCT (Đ/đ survive stripping, MEM037).
  'match/near-miss-vietnamese.docx': [
    O({
      id: 'c0', raw: 'Nguyễn, V. A. (2015)', family: 'author-date',
      items: [item({ firstAuthor: 'Nguyễn', authors: ['Nguyễn', 'V. A.'], year: 2015 })],
      source: { blockId: 'doc-p1', startOffset: 5, endOffset: 25 }, confidence: 0.837,
    }),
    O({
      id: 'c1', raw: 'Đỗ (2018)', family: 'author-date',
      items: [item({ firstAuthor: 'Đỗ', authors: ['Đỗ'], year: 2018 })],
      source: { blockId: 'doc-p2', startOffset: 0, endOffset: 9 }, confidence: 0.9,
    }),
    O({
      id: 'c2', raw: 'Nguyen, V. A. (2015)', family: 'author-date',
      items: [item({ firstAuthor: 'Nguyen', authors: ['Nguyen', 'V. A.'], year: 2015 })],
      source: { blockId: 'doc-p4', startOffset: 0, endOffset: 20 }, confidence: 0.837,
    }),
    O({
      id: 'c3', raw: 'Do, Q. (2018)', family: 'author-date',
      items: [item({ firstAuthor: 'Do', authors: ['Do', 'Q.'], year: 2018 })],
      source: { blockId: 'doc-p5', startOffset: 0, endOffset: 13 }, confidence: 0.837,
    }),
  ],

  // Macro-carriage sample: no citations.
  'security/vba-sample.docx': [],
};

// The §21 KNOWN_REFERENCES table lives in the sibling data module
// `fixture-ground-truth-references.ts` (keeps every file < 400 lines);
// `KnownReferenceEntry` stays here so both modules share one type.

// ---------------------------------------------------------------------------
// S04-T2 — §27 KNOWN_MATCHES ground truth (match-state map).
// ---------------------------------------------------------------------------

/** Expected §27 per-citation match result (as asserted by matching.test.ts). */
export interface KnownMatchRow {
  citationId: string;
  relationship: 'MATCHED' | 'MISSING_REFERENCE' | 'AMBIGUOUS' | 'POSSIBLE_MISMATCH';
  matchedEntryId?: string;
  score: number;
  tier: number;
  confidence: number;
  reasons: string[];
}

/** Expected §27 bibliography-side status row. */
export interface KnownEntryStatusRow {
  entryId: string;
  status: 'CITED' | 'UNUSED' | 'AMBIGUOUS_USAGE';
}

/** Expected full match map for one fixture. */
export interface KnownMatchMap {
  citations: KnownMatchRow[];
  entryStatus: KnownEntryStatusRow[];
}

const MR = (o: KnownMatchRow): KnownMatchRow => o;
const ES = (o: KnownEntryStatusRow): KnownEntryStatusRow => o;
const MM = (o: KnownMatchMap): KnownMatchMap => o;

/** Compact builder: the uniform absent-targets MISSING_REFERENCE row. */
const missing = (citationId: string): KnownMatchRow =>
  MR({ citationId, relationship: 'MISSING_REFERENCE', score: 0, tier: 5, confidence: 0, reasons: ['no-entry'] });

/**
 * Expected §27 match states per fixture, in document order (c0.., r0..).
 * Authored from the real pipeline (verified against parseDocument) — any
 * change to the scorer, the orchestration policy, the thresholds, the
 * fixtures or the ground truth drifts these rows and matching.test.ts fails.
 */
export const KNOWN_MATCHES: Record<string, KnownMatchMap> = {
  // No detected bibliography (absent / below-threshold) -> every citation
  // MISSING_REFERENCE, score 0, tier 5, reasons ['no-entry'] (no silent
  // guess, §79/R004). Same for 'detected' sections whose parsing scope
  // produced no entries (apa-like: blockIds span keeps only the heading).
  'minimal.docx': MM({ citations: [missing('c0')], entryStatus: [] }),
  'author-date/simple.docx': MM({
    citations: [missing('c0'), missing('c1'), missing('c2'), missing('c3')],
    entryStatus: [],
  }),
  'author-date/et-al.docx': MM({
    citations: [missing('c0'), missing('c1'), missing('c2'), missing('c3')],
    entryStatus: [],
  }),
  'author-date/multiple-authors.docx': MM({
    citations: [missing('c0'), missing('c1'), missing('c2')],
    entryStatus: [],
  }),
  'author-date/same-author-year.docx': MM({
    citations: [missing('c0'), missing('c1'), missing('c2')],
    entryStatus: [],
  }),
  'author-date/missing.docx': MM({
    citations: [missing('c0'), missing('c1')],
    entryStatus: [],
  }),
  'author-date/ambiguous.docx': MM({
    citations: [missing('c0'), missing('c1')],
    entryStatus: [],
  }),
  'author-date/vietnamese.docx': MM({
    citations: [missing('c0'), missing('c1'), missing('c2'), missing('c3')],
    entryStatus: [],
  }),
  'documents/docx/apa-like.docx': MM({
    citations: [missing('c0'), missing('c1'), missing('c2'), missing('c3'), missing('c4')],
    entryStatus: [],
  }),
  'documents/docx/harvard.docx': MM({
    citations: [missing('c0'), missing('c1'), missing('c2')],
    entryStatus: [],
  }),
  'documents/docx/plain-text.docx': MM({ citations: [missing('c0')], entryStatus: [] }),
  'bibliography/no-bibliography.docx': MM({
    citations: [missing('c0'), missing('c1')],
    entryStatus: [],
  }),
  'bibliography/ambiguous.docx': MM({ citations: [missing('c0')], entryStatus: [] }),

  // en-references: every body + entry-tail citation resolves to its entry
  // (bare surnames score 1.0; "Last, Initial" tails 0.925 — the initial is
  // treated as additional-author evidence against a truncated entry).
  'bibliography/en-references.docx': MM({
    citations: [
      MR({ citationId: 'c0', relationship: 'MATCHED', matchedEntryId: 'r0', score: 1, tier: 1, confidence: 1, reasons: ['exact', 'year-match'] }),
      MR({ citationId: 'c1', relationship: 'MATCHED', matchedEntryId: 'r1', score: 1, tier: 1, confidence: 1, reasons: ['exact', 'year-match'] }),
      MR({ citationId: 'c2', relationship: 'MATCHED', matchedEntryId: 'r2', score: 1, tier: 1, confidence: 1, reasons: ['exact', 'year-match'] }),
      MR({ citationId: 'c3', relationship: 'MATCHED', matchedEntryId: 'r0', score: 0.925, tier: 1, confidence: 0.925, reasons: ['exact', 'year-match'] }),
      MR({ citationId: 'c4', relationship: 'MATCHED', matchedEntryId: 'r1', score: 1, tier: 1, confidence: 1, reasons: ['exact', 'year-match'] }),
      MR({ citationId: 'c5', relationship: 'MATCHED', matchedEntryId: 'r2', score: 0.925, tier: 1, confidence: 0.925, reasons: ['exact', 'year-match'] }),
    ],
    entryStatus: [ES({ entryId: 'r0', status: 'CITED' }), ES({ entryId: 'r1', status: 'CITED' }), ES({ entryId: 'r2', status: 'CITED' })],
  }),

  'bibliography/vi-tai-lieu.docx': MM({
    citations: [
      MR({ citationId: 'c0', relationship: 'MATCHED', matchedEntryId: 'r0', score: 0.925, tier: 1, confidence: 0.925, reasons: ['exact', 'year-match'] }),
      MR({ citationId: 'c1', relationship: 'MATCHED', matchedEntryId: 'r1', score: 0.925, tier: 1, confidence: 0.925, reasons: ['exact', 'year-match'] }),
      MR({ citationId: 'c2', relationship: 'MATCHED', matchedEntryId: 'r2', score: 0.925, tier: 1, confidence: 0.925, reasons: ['exact', 'year-match'] }),
    ],
    entryStatus: [ES({ entryId: 'r0', status: 'CITED' }), ES({ entryId: 'r1', status: 'CITED' }), ES({ entryId: 'r2', status: 'CITED' })],
  }),

  // style-position: c0 "Nguyễn (2019)" has NO entry for it — the best
  // candidate is the 2019 Roe entry on the year axis alone (0.6, tier 5) ->
  // POSSIBLE_MISMATCH in the near-miss band; the entry tails match cleanly.
  'bibliography/style-position.docx': MM({
    citations: [
      MR({ citationId: 'c0', relationship: 'POSSIBLE_MISMATCH', score: 0.6, tier: 5, confidence: 0.6, reasons: ['author-mismatch', 'year-match'] }),
      MR({ citationId: 'c1', relationship: 'MATCHED', matchedEntryId: 'r0', score: 0.925, tier: 1, confidence: 0.925, reasons: ['exact', 'year-match'] }),
      MR({ citationId: 'c2', relationship: 'MATCHED', matchedEntryId: 'r1', score: 1, tier: 1, confidence: 1, reasons: ['exact', 'year-match'] }),
      MR({ citationId: 'c3', relationship: 'MATCHED', matchedEntryId: 'r2', score: 0.925, tier: 1, confidence: 0.925, reasons: ['exact', 'year-match'] }),
    ],
    entryStatus: [ES({ entryId: 'r0', status: 'CITED' }), ES({ entryId: 'r1', status: 'CITED' }), ES({ entryId: 'r2', status: 'CITED' })],
  }),

  // S04-T1: correct-year pairings MATCHED (1.0 / 0.925); the wrong-year
  // pairing is never selected (§79 — max wrong-year score 0.65 < 0.7).
  'match/same-author-two-years.docx': MM({
    citations: [
      MR({ citationId: 'c0', relationship: 'MATCHED', matchedEntryId: 'r0', score: 1, tier: 1, confidence: 1, reasons: ['exact', 'year-match'] }),
      MR({ citationId: 'c1', relationship: 'MATCHED', matchedEntryId: 'r1', score: 1, tier: 1, confidence: 1, reasons: ['exact', 'year-match'] }),
      MR({ citationId: 'c2', relationship: 'MATCHED', matchedEntryId: 'r0', score: 0.925, tier: 1, confidence: 0.925, reasons: ['exact', 'year-match'] }),
      MR({ citationId: 'c3', relationship: 'MATCHED', matchedEntryId: 'r1', score: 0.925, tier: 1, confidence: 0.925, reasons: ['exact', 'year-match'] }),
    ],
    entryStatus: [ES({ entryId: 'r0', status: 'CITED' }), ES({ entryId: 'r1', status: 'CITED' })],
  }),

  // S04-T2: identical author+year entries -> AMBIGUOUS, no auto-pick (§27).
  'match/ambiguous-same-author-year.docx': MM({
    citations: [
      MR({ citationId: 'c0', relationship: 'AMBIGUOUS', score: 1, tier: 1, confidence: 1, reasons: ['exact', 'year-match', 'ambiguous'] }),
      MR({ citationId: 'c1', relationship: 'AMBIGUOUS', score: 0.925, tier: 1, confidence: 0.925, reasons: ['exact', 'year-match', 'ambiguous'] }),
      MR({ citationId: 'c2', relationship: 'AMBIGUOUS', score: 0.925, tier: 1, confidence: 0.925, reasons: ['exact', 'year-match', 'ambiguous'] }),
    ],
    entryStatus: [ES({ entryId: 'r0', status: 'AMBIGUOUS_USAGE' }), ES({ entryId: 'r1', status: 'AMBIGUOUS_USAGE' })],
  }),

  // S04-T2: "Smith, J." vs "Smith, P." — given-initial contradiction zeroes
  // the first-author credit (0.525, POSSIBLE_MISMATCH); never MATCHED (§79).
  'match/near-miss-author.docx': MM({
    citations: [
      MR({ citationId: 'c0', relationship: 'POSSIBLE_MISMATCH', score: 0.525, tier: 1, confidence: 0.525, reasons: ['exact', 'given-initial-mismatch', 'year-match'] }),
      MR({ citationId: 'c1', relationship: 'MATCHED', matchedEntryId: 'r0', score: 0.925, tier: 1, confidence: 0.925, reasons: ['exact', 'year-match'] }),
      MR({ citationId: 'c2', relationship: 'MATCHED', matchedEntryId: 'r1', score: 0.925, tier: 1, confidence: 0.925, reasons: ['exact', 'year-match'] }),
    ],
    entryStatus: [ES({ entryId: 'r0', status: 'CITED' }), ES({ entryId: 'r1', status: 'CITED' })],
  }),

  // S04-T2: Nguyễn vs Nguyen reaches tier 3 (diacritic-insensitive, reported —
  // never promoted to exact: tier stays 3) and still MATCHED on the strong
  // year axis; Đỗ vs Do stays distinct (tier 5, 0.6 -> POSSIBLE_MISMATCH).
  'match/near-miss-vietnamese.docx': MM({
    citations: [
      MR({ citationId: 'c0', relationship: 'MATCHED', matchedEntryId: 'r0', score: 0.845, tier: 3, confidence: 0.845, reasons: ['diacritic-insensitive', 'year-match'] }),
      MR({ citationId: 'c1', relationship: 'POSSIBLE_MISMATCH', score: 0.6, tier: 5, confidence: 0.6, reasons: ['author-mismatch', 'year-match'] }),
      MR({ citationId: 'c2', relationship: 'MATCHED', matchedEntryId: 'r0', score: 0.925, tier: 1, confidence: 0.925, reasons: ['exact', 'year-match'] }),
      MR({ citationId: 'c3', relationship: 'MATCHED', matchedEntryId: 'r1', score: 0.925, tier: 1, confidence: 0.925, reasons: ['exact', 'year-match'] }),
    ],
    entryStatus: [ES({ entryId: 'r0', status: 'CITED' }), ES({ entryId: 'r1', status: 'CITED' })],
  }),

  // Macro-carriage sample: no citations, no entries -> empty map.
  'security/vba-sample.docx': MM({ citations: [], entryStatus: [] }),
};
