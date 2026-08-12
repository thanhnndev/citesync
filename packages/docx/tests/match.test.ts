/**
 * S04-T3 — unit tests pinning the matching engine calibration (R007/R008,
 * §25–§27/§79): §26 weights (sum via toBeCloseTo(1, 10), MEM032); §25 tier
 * ladder exact-decisive with non-overriding fallbacks (Nguyễn/Nguyen stays
 * tier 3; Đỗ/Do never MATCHED — Đ/đ survive stripping, MEM002/MEM037);
 * §27/§79 threshold boundaries (MATCHED / AMBIGUOUS / POSSIBLE_MISMATCH /
 * MISSING_REFERENCE); et-al stripping (MEM038); determinism (R008);
 * missing-bibliography no-guess policy. All fixtures are inline
 * AcademicDocument/ReferenceEntry literals — no I/O, no locale calls.
 */

import { describe, expect, it } from 'vitest';

import type {
  AcademicDocument,
  AuthorDateCitationItem,
  CitationOccurrence,
  ReferenceEntry,
} from '@citesync/document-model';

import {
  MATCH_THRESHOLD,
  MATCH_WEIGHTS,
  buildMatchMap,
  buildNameKey,
  scoreCitationAgainstEntry,
} from '../src/index.js';

// Helpers — realistic literals (same shapes the S03/S04 pipeline produces).

/** One §21 reference entry with a tiered name key built over the full name. */
function ref(
  id: string,
  family: string,
  given: string | undefined,
  year: number,
): ReferenceEntry {
  const originalName = given === undefined ? family : `${family}, ${given}`;
  return {
    id,
    raw: `${originalName} (${year}). Title. Journal.`,
    authors: [
      {
        originalName,
        family,
        ...(given !== undefined ? { given } : {}),
        key: buildNameKey(originalName),
      },
    ],
    year,
    source: { blockId: `ref-${id}` },
    parseConfidence: 1,
  };
}

/** One §20 author-date citation occurrence literal. */
function occurrence(id: string, item: AuthorDateCitationItem): CitationOccurrence {
  return {
    id,
    raw: '(cited)',
    family: 'author-date',
    items: [item],
    source: { blockId: 'doc-p1', startOffset: 0, endOffset: 8 },
    confidence: 0.9,
  };
}

/** Minimal AcademicDocument literal; entries omitted → no bibliography. */
function doc(
  citations: CitationOccurrence[],
  entries?: ReferenceEntry[],
): AcademicDocument {
  const bibliography =
    entries === undefined
      ? undefined
      : {
          outcome: 'detected' as const,
          heading: 'References',
          blockIds: entries.map((e) => `ref-${e.id}`),
          entries,
        };
  return {
    metadata: {},
    blocks: [],
    citations,
    ...(bibliography !== undefined ? { bibliography } : {}),
    sourceMap: { version: 1, blocks: {} },
  };
}

// ---------------------------------------------------------------------------
// 1. §26 weights pinned.
// ---------------------------------------------------------------------------

describe('MATCH_WEIGHTS — §26 calibration surface', () => {
  it('pins each weight to its §26 value individually (toBe literals)', () => {
    expect(MATCH_WEIGHTS.firstAuthor).toBe(0.4);
    expect(MATCH_WEIGHTS.year).toBe(0.35);
    expect(MATCH_WEIGHTS.additionalAuthors).toBe(0.15);
    expect(MATCH_WEIGHTS.yearSuffix).toBe(0.05);
    expect(MATCH_WEIGHTS.other).toBe(0.05);
  });

  it('pins the total to 1.0 within float tolerance (MEM032)', () => {
    const sum =
      MATCH_WEIGHTS.firstAuthor +
      MATCH_WEIGHTS.year +
      MATCH_WEIGHTS.additionalAuthors +
      MATCH_WEIGHTS.yearSuffix +
      MATCH_WEIGHTS.other;
    expect(sum).toBeCloseTo(1, 10);
  });
});

// ---------------------------------------------------------------------------
// 2. §25 tier ladder — exact-decisive, non-overriding fallbacks.
// ---------------------------------------------------------------------------

describe('§25 tier ladder — exact-decisive, fallbacks never promoted', () => {
  it('exact surname + year pairing scores tier 1 (full credit)', () => {
    const s = scoreCitationAgainstEntry(
      { firstAuthor: 'Doe', authors: ['Doe'], year: 2017 },
      ref('r0', 'Doe', 'J.', 2017),
    );
    expect(s.tier).toBe(1);
    expect(s.authorExact).toBe(true);
    expect(s.reasons).toContain('exact');
    expect(s.reasons).toContain('year-match');
    expect(s.score).toBeCloseTo(1, 6);
  });

  it('Nguyễn vs Nguyen is diacritic-insensitive-only: tier 3, never promoted to exact', () => {
    const s = scoreCitationAgainstEntry(
      { firstAuthor: 'Nguyễn', authors: ['Nguyễn'], year: 2015 },
      ref('r0', 'Nguyen', 'V. A.', 2015),
    );
    // exact keys differ ('nguyễn' vs 'nguyen'); the diacritic-stripped keys
    // agree — the tier stays 3 and is REPORTED, not promoted (§24).
    expect(s.tier).toBe(3);
    expect(s.authorExact).toBe(false);
    expect(s.reasons).toContain('diacritic-insensitive');
    expect(s.reasons).not.toContain('exact');
    expect(s.score).toBeCloseTo(0.92, 6);
  });

  it('Đỗ vs Do never MATCHED — Đ/đ survive stripping, initials cannot collide (MEM002/MEM037)', () => {
    // Citation Đỗ against the diacritic-less "Do, Q." entry: exact and
    // diacritic-insensitive families both differ ('đỗ' vs 'do'), and the
    // initials tier cannot falsely fire because 'đ' (U+0111) ≠ 'd'.
    const map = buildMatchMap(
      doc(
        [occurrence('c0', { firstAuthor: 'Đỗ', authors: ['Đỗ'], year: 2018 })],
        [ref('r0', 'Do', 'Q.', 2018)],
      ),
    );
    const r = map.citations[0]!;
    expect(r.relationship).not.toBe('MATCHED');
    expect(r.relationship).toBe('POSSIBLE_MISMATCH');
    expect(r.tier).toBe(5);
    expect(r.reasons).toContain('author-mismatch');
    expect(r.score).toBeCloseTo(0.6, 6);

    // Reverse direction (citation "Do" vs entry "Đỗ"): initials 'd' vs 'đva'
    // stay distinct — the đ survivor keeps them apart, so tier stays 5.
    const s = scoreCitationAgainstEntry(
      { firstAuthor: 'Do', authors: ['Do'], year: 2018 },
      ref('r0', 'Đỗ', 'V. A.', 2018),
    );
    expect(s.tier).toBe(5);
    expect(s.score).toBeCloseTo(0.6, 6);
  });
});

// ---------------------------------------------------------------------------
// 3. §27/§79 threshold boundaries (match-map level).
// ---------------------------------------------------------------------------

describe('§27/§79 threshold boundaries', () => {
  it('single candidate at/above MATCH_THRESHOLD above the next-best → MATCHED', () => {
    const map = buildMatchMap(
      doc(
        [occurrence('c0', { firstAuthor: 'Doe', authors: ['Doe'], year: 2018 })],
        [ref('r0', 'Doe', 'J.', 2018), ref('r1', 'Smith', 'J.', 2021)],
      ),
    );
    const r = map.citations[0]!;
    expect(r.relationship).toBe('MATCHED');
    expect(r.matchedEntryId).toBe('r0');
    expect(r.tier).toBe(1);
    expect(r.score).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
    expect(map.entryStatus).toEqual([
      { entryId: 'r0', status: 'CITED' },
      { entryId: 'r1', status: 'UNUSED' },
    ]);
  });

  it('two candidates both at/above threshold within the margin → AMBIGUOUS, never auto-picked', () => {
    const map = buildMatchMap(
      doc(
        [occurrence('c0', { firstAuthor: 'Smith', authors: ['Smith'], year: 2020 })],
        [ref('r0', 'Smith', 'J.', 2020), ref('r1', 'Smith', 'J.', 2020)],
      ),
    );
    const r = map.citations[0]!;
    expect(r.relationship).toBe('AMBIGUOUS');
    expect(r.matchedEntryId).toBeUndefined();
    expect(r.score).toBeCloseTo(1, 6);
    expect(r.reasons).toContain('ambiguous');
    expect(map.entryStatus).toEqual([
      { entryId: 'r0', status: 'AMBIGUOUS_USAGE' },
      { entryId: 'r1', status: 'AMBIGUOUS_USAGE' },
    ]);
  });

  it('wrong-year near-miss stays below MATCH_THRESHOLD → POSSIBLE_MISMATCH (§79 false-positive class)', () => {
    const map = buildMatchMap(
      doc(
        [occurrence('c0', { firstAuthor: 'Doe', authors: ['Doe'], year: 2018 })],
        [ref('r0', 'Doe', 'J.', 2021)],
      ),
    );
    const r = map.citations[0]!;
    expect(r.relationship).toBe('POSSIBLE_MISMATCH');
    expect(r.matchedEntryId).toBeUndefined();
    // exact 0.4 + additional 0.15 + other 0.05; the year axis (0.35 + 0.05
    // suffix) is zeroed on mismatch → 0.6 < MATCH_THRESHOLD 0.7 — a
    // wrong-year pairing can never MATCHED (§79).
    expect(r.score).toBeCloseTo(0.6, 6);
    expect(r.score).toBeLessThan(MATCH_THRESHOLD);
    expect(r.reasons).toContain('exact');
    expect(r.reasons).toContain('year-mismatch');
  });

  it('contradicting given initial zeroes first-author credit → POSSIBLE_MISMATCH, never MATCHED', () => {
    // "Smith, J. (2019)" vs the Smith, P. entry: same family + year, but the
    // given initials 'j'/'p' contradict → 0.525, in the near-miss band.
    const map = buildMatchMap(
      doc(
        [
          occurrence('c0', {
            firstAuthor: 'Smith',
            authors: ['Smith', 'J.'],
            year: 2019,
          }),
        ],
        [ref('r0', 'Smith', 'P.', 2019)],
      ),
    );
    const r = map.citations[0]!;
    expect(r.relationship).toBe('POSSIBLE_MISMATCH');
    expect(r.tier).toBe(1); // surname tier is still reported...
    expect(r.reasons).toContain('given-initial-mismatch'); // ...but credit zeroed
    expect(r.score).toBeCloseTo(0.525, 6);
    expect(r.score).toBeLessThan(MATCH_THRESHOLD);
  });

  it('no candidate above the near-miss band → MISSING_REFERENCE', () => {
    const map = buildMatchMap(
      doc(
        [occurrence('c0', { firstAuthor: 'Doe', authors: ['Doe'], year: 2018 })],
        [ref('r0', 'Smith', 'J.', 2021)],
      ),
    );
    const r = map.citations[0]!;
    expect(r.relationship).toBe('MISSING_REFERENCE');
    expect(r.score).toBeCloseTo(0.2, 6);
    expect(r.confidence).toBe(0);
    expect(r.reasons).toEqual(['no-entry']);
  });
});

// ---------------------------------------------------------------------------
// 4. et-al stripping (MEM038).
// ---------------------------------------------------------------------------

describe('et-al stripping (MEM038)', () => {
  it('the literal "et al." in the citation author never leaks into the family key', () => {
    const s = scoreCitationAgainstEntry(
      { firstAuthor: 'Johnson et al.', authors: ['Johnson et al.'], year: 2019 },
      ref('r0', 'Johnson', 'A.', 2019),
    );
    // If "et al." leaked, the family token would be 'al' (tier 5, 0.6) —
    // tier 1 exact proves ET_AL_TAIL_RE stripped it before keying.
    expect(s.tier).toBe(1);
    expect(s.authorExact).toBe(true);
    expect(s.reasons).toContain('exact');
    expect(s.score).toBeCloseTo(1, 6);
  });

  it('"et al." as a separate parenthetical token is dropped from additional authors', () => {
    const s = scoreCitationAgainstEntry(
      { firstAuthor: 'Williams', authors: ['Williams', 'et al.'], year: 2022 },
      ref('r0', 'Williams', undefined, 2022),
    );
    expect(s.tier).toBe(1);
    expect(s.score).toBeCloseTo(1, 6); // 'et al.' filtered → full additional credit
  });

  it('buildMatchMap resolves "Johnson et al. (2019)" → MATCHED on the family token', () => {
    const map = buildMatchMap(
      doc(
        [
          occurrence('c0', {
            firstAuthor: 'Johnson et al.',
            authors: ['Johnson et al.'],
            year: 2019,
          }),
        ],
        [ref('r0', 'Johnson', 'A.', 2019)],
      ),
    );
    const r = map.citations[0]!;
    expect(r.relationship).toBe('MATCHED');
    expect(r.matchedEntryId).toBe('r0');
    expect(r.tier).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 5. Determinism (R008).
// ---------------------------------------------------------------------------

describe('determinism (R008)', () => {
  it('buildMatchMap over the same document twice is deep-equal and byte-identical', () => {
    const d = doc(
      [
        occurrence('c0', { firstAuthor: 'Doe', authors: ['Doe'], year: 2018 }),
        occurrence('c1', { firstAuthor: 'Nguyễn', authors: ['Nguyễn'], year: 2015 }),
        occurrence('c2', {
          firstAuthor: 'Smith',
          authors: ['Smith', 'J.'],
          year: 2019,
        }),
      ],
      [
        ref('r0', 'Doe', 'J.', 2018),
        ref('r1', 'Nguyen', 'V. A.', 2015),
        ref('r2', 'Smith', 'P.', 2019),
      ],
    );
    const a = buildMatchMap(d);
    const b = buildMatchMap(d);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ---------------------------------------------------------------------------
// 6. Missing / no-bibliography policy (§79 — never a silent guess).
// ---------------------------------------------------------------------------

describe('missing / no-bibliography policy (§79 no-guess)', () => {
  it('document with no bibliography section → every citation MISSING_REFERENCE', () => {
    const map = buildMatchMap(
      doc([occurrence('c0', { firstAuthor: 'Doe', authors: ['Doe'], year: 2018 })]),
    );
    expect(map.citations).toHaveLength(1);
    expect(map.citations[0]!).toMatchObject({
      relationship: 'MISSING_REFERENCE',
      score: 0,
      tier: 5,
      confidence: 0,
      reasons: ['no-entry'],
    });
    expect(map.entryStatus).toEqual([]);
  });

  it('outcome "none" (no detected section) behaves identically', () => {
    const d: AcademicDocument = {
      ...doc([occurrence('c0', { firstAuthor: 'Doe', authors: ['Doe'], year: 2018 })]),
      bibliography: { outcome: 'none' },
    };
    const map = buildMatchMap(d);
    expect(map.citations[0]!.relationship).toBe('MISSING_REFERENCE');
    expect(map.citations[0]!.reasons).toEqual(['no-entry']);
  });

  it('a detected section with zero entries yields MISSING_REFERENCE too', () => {
    const map = buildMatchMap(
      doc([occurrence('c0', { firstAuthor: 'Doe', authors: ['Doe'], year: 2018 })], []),
    );
    expect(map.citations[0]!.relationship).toBe('MISSING_REFERENCE');
    expect(map.citations[0]!.reasons).toEqual(['no-entry']);
  });
});
