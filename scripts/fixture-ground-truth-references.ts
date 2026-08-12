/**
 * S03-T06 — §21 KNOWN_REFERENCES ground truth (split from the occurrences
 * table so every ground-truth file stays < 400 lines).
 *
 * Expected §21 reference entries per fixture, in section order (ids r0..).
 * Only fixtures whose S02 detection produced a section with entry blocks
 * carry entries here; a `'detected'` section whose blockIds span contains no
 * entry blocks (e.g. apa-like.docx — prose separates the heading from the
 * entries, so S02's run gate keeps only the heading) yields `[]` — the
 * parsing scope is exactly `doc.bibliography.blockIds` (T05 contract).
 *
 * Consumed by `packages/docx/tests/extraction.test.ts` (deep-equal drift
 * guard) and `scripts/make-fixtures.ts` (README manifest rendering).
 * Pure data — no imports, no side effects.
 */

import type { KnownReferenceEntry } from './fixture-ground-truth.js';

/** Compact author builder for the reference tables. */
const author = (o: NonNullable<KnownReferenceEntry['authors']>[number]): NonNullable<KnownReferenceEntry['authors']>[number] => o;

const E = (o: KnownReferenceEntry): KnownReferenceEntry => o;

export const KNOWN_REFERENCES: Record<string, KnownReferenceEntry[]> = {
  'documents/docx/apa-like.docx': [],
  'bibliography/en-references.docx': [
    E({
      id: 'r0',
      raw: 'Doe, J. (2017). Citation practice in digital documents. Journal of Citation Science, 12(3), 45-60.',
      index: 0,
      authors: [author({ originalName: 'Doe, J.', family: 'Doe', given: 'J.', key: { exact: 'doe j', diacriticInsensitive: 'doe j', initials: 'dj' } })],
      year: 2017,
      title: 'Citation practice in digital documents',
      containerTitle: 'Journal of Citation Science',
      identifiers: { volume: '12', issue: '3', pages: '45-60' },
      source: { blockId: 'doc-p5', startOffset: 0, endOffset: 98 },
      parseConfidence: 1,
    }),
    E({
      id: 'r1',
      raw: 'Johnson, A. (2018). Structured citations. Cambridge University Press.',
      index: 1,
      authors: [author({ originalName: 'Johnson, A.', family: 'Johnson', given: 'A.', key: { exact: 'johnson a', diacriticInsensitive: 'johnson a', initials: 'ja' } })],
      year: 2018,
      title: 'Structured citations',
      containerTitle: 'Cambridge University Press',
      source: { blockId: 'doc-p6', startOffset: 0, endOffset: 69 },
      parseConfidence: 0.9412,
    }),
    E({
      id: 'r2',
      raw: 'Roe, M. (2019). Offsets and evidence. ACM Computing Surveys, 51(2), 1-30.',
      index: 2,
      authors: [author({ originalName: 'Roe, M.', family: 'Roe', given: 'M.', key: { exact: 'roe m', diacriticInsensitive: 'roe m', initials: 'rm' } })],
      year: 2019,
      title: 'Offsets and evidence',
      containerTitle: 'ACM Computing Surveys',
      identifiers: { volume: '51', issue: '2', pages: '1-30' },
      source: { blockId: 'doc-p7', startOffset: 0, endOffset: 73 },
      parseConfidence: 1,
    }),
  ],
  'bibliography/vi-tai-lieu.docx': [
    E({
      id: 'r0',
      raw: 'Nguyễn, V. A. (2015). Phương pháp trích dẫn tự động trong văn bản khoa học. Nhà xuất bản Đại học Quốc gia Hà Nội.',
      index: 0,
      authors: [author({ originalName: 'Nguyễn, V. A.', family: 'Nguyễn', given: 'V. A.', key: { exact: 'nguyễn v a', diacriticInsensitive: 'nguyen v a', initials: 'nva' } })],
      year: 2015,
      title: 'Phương pháp trích dẫn tự động trong văn bản khoa học',
      containerTitle: 'Nhà xuất bản Đại học Quốc gia Hà Nội',
      source: { blockId: 'doc-p1', startOffset: 0, endOffset: 113 },
      parseConfidence: 0.9412,
    }),
    E({
      id: 'r1',
      raw: 'Trần, T. B. (2018). Cấu trúc trường trích dẫn trong tài liệu số. Tạp chí Khoa học và Công nghệ, 12(2), 33-47.',
      index: 1,
      authors: [author({ originalName: 'Trần, T. B.', family: 'Trần', given: 'T. B.', key: { exact: 'trần t b', diacriticInsensitive: 'tran t b', initials: 'ttb' } })],
      year: 2018,
      title: 'Cấu trúc trường trích dẫn trong tài liệu số',
      containerTitle: 'Tạp chí Khoa học và Công nghệ',
      identifiers: { volume: '12', issue: '2', pages: '33-47' },
      source: { blockId: 'doc-p2', startOffset: 0, endOffset: 109 },
      parseConfidence: 1,
    }),
    E({
      id: 'r2',
      raw: 'Phạm, Q. C. (2020). Nhận dạng danh mục tài liệu tham khảo trong văn bản. Đại học Bách khoa Hà Nội.',
      index: 2,
      authors: [author({ originalName: 'Phạm, Q. C.', family: 'Phạm', given: 'Q. C.', key: { exact: 'phạm q c', diacriticInsensitive: 'pham q c', initials: 'pqc' } })],
      year: 2020,
      title: 'Nhận dạng danh mục tài liệu tham khảo trong văn bản',
      containerTitle: 'Đại học Bách khoa Hà Nội',
      source: { blockId: 'doc-p3', startOffset: 0, endOffset: 98 },
      parseConfidence: 0.9412,
    }),
  ],
  'bibliography/style-position.docx': [
    E({
      id: 'r0',
      raw: 'Doe, J. (2017). Citation practice in digital documents. Journal of Citation Science, 12(3), 45-60.',
      index: 0,
      authors: [author({ originalName: 'Doe, J.', family: 'Doe', given: 'J.', key: { exact: 'doe j', diacriticInsensitive: 'doe j', initials: 'dj' } })],
      year: 2017,
      title: 'Citation practice in digital documents',
      containerTitle: 'Journal of Citation Science',
      identifiers: { volume: '12', issue: '3', pages: '45-60' },
      source: { blockId: 'doc-p6', startOffset: 0, endOffset: 98 },
      parseConfidence: 1,
    }),
    E({
      id: 'r1',
      raw: 'Johnson, A. (2018). Structured citations. Cambridge University Press.',
      index: 1,
      authors: [author({ originalName: 'Johnson, A.', family: 'Johnson', given: 'A.', key: { exact: 'johnson a', diacriticInsensitive: 'johnson a', initials: 'ja' } })],
      year: 2018,
      title: 'Structured citations',
      containerTitle: 'Cambridge University Press',
      source: { blockId: 'doc-p7', startOffset: 0, endOffset: 69 },
      parseConfidence: 0.9412,
    }),
    E({
      id: 'r2',
      raw: 'Roe, M. (2019). Offsets and evidence. ACM Computing Surveys, 51(2), 1-30.',
      index: 2,
      authors: [author({ originalName: 'Roe, M.', family: 'Roe', given: 'M.', key: { exact: 'roe m', diacriticInsensitive: 'roe m', initials: 'rm' } })],
      year: 2019,
      title: 'Offsets and evidence',
      containerTitle: 'ACM Computing Surveys',
      identifiers: { volume: '51', issue: '2', pages: '1-30' },
      source: { blockId: 'doc-p8', startOffset: 0, endOffset: 73 },
      parseConfidence: 1,
    }),
  ],
  // S04-T1: same author, two years — year-weight calibration fixture (two
  // entries by the SAME author in DIFFERENT years).
  'match/same-author-two-years.docx': [
    E({
      id: 'r0',
      raw: 'Doe, J. (2018). Citation practices in digital archives. Journal of Citation Science, 9(1), 10-22.',
      index: 0,
      authors: [author({ originalName: 'Doe, J.', family: 'Doe', given: 'J.', key: { exact: 'doe j', diacriticInsensitive: 'doe j', initials: 'dj' } })],
      year: 2018,
      title: 'Citation practices in digital archives',
      containerTitle: 'Journal of Citation Science',
      identifiers: { volume: '9', issue: '1', pages: '10-22' },
      source: { blockId: 'doc-p4', startOffset: 0, endOffset: 97 },
      parseConfidence: 1,
    }),
    E({
      id: 'r1',
      raw: 'Doe, J. (2021). Advances in digital citation analysis. Journal of Citation Science, 12(4), 100-115.',
      index: 1,
      authors: [author({ originalName: 'Doe, J.', family: 'Doe', given: 'J.', key: { exact: 'doe j', diacriticInsensitive: 'doe j', initials: 'dj' } })],
      year: 2021,
      title: 'Advances in digital citation analysis',
      containerTitle: 'Journal of Citation Science',
      identifiers: { volume: '12', issue: '4', pages: '100-115' },
      source: { blockId: 'doc-p5', startOffset: 0, endOffset: 99 },
      parseConfidence: 1,
    }),
  ],
};
