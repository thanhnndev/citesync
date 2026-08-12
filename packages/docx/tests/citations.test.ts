/**
 * S03-T03 — author-date citation grammar + candidate detection proof
 * (R005/§18/§23, plain-text tier 4).
 *
 * Locks the exact done-when contract: every §18 form listed in the task plan
 * parses into the right §20 `AuthorDateCitationItem[]`, and the two explicit
 * no-false-positive guards hold — a bare `Smith 2024.` is NEVER emitted and
 * the numeric family `[1]` is ignored (M002). Also pins:
 *   - narrative `Theo Nguyễn Văn A (2015)` → firstAuthor `Nguyễn` (family
 *     token; Vietnamese family-first), authors[] preserved;
 *   - deterministic `c{n}` ids in document order (R008);
 *   - source offsets that round-trip exactly via `text.slice` (R009);
 *   - deterministic confidence values (pinned in `confidence.ts`).
 *
 * Negative coverage (Q7): bare-name no-paren, numeric brackets, author-less
 * parentheticals, stopword prose prefixes, unbalanced parens, empty parens,
 * missing dates, non-4-digit years, and nested regions.
 */

import { describe, expect, it } from 'vitest';

import type { DocumentBlock } from '@citesync/document-model';

import {
  detectCitationsInBlock,
  familyToken,
  findCitationCandidates,
  findParentheticalRegions,
  parseAuthorPrefix,
  parseCandidate,
  scanNamePrefix,
} from '../src/citations/index.js';
import { BASE_FEATURES, citationConfidence } from '../src/citations/confidence.js';

// ---------------------------------------------------------------------------
// Test helpers.
// ---------------------------------------------------------------------------

/** A minimal synthetic block (unit-test inputs — only id/text/source read). */
function block(text: string, id = 'b1', paragraphIndex?: number): DocumentBlock {
  return {
    id,
    type: 'paragraph',
    text,
    source: {
      blockId: id,
      ...(paragraphIndex !== undefined ? { paragraphIndex } : {}),
    },
  };
}

/** Convenience: detect citations in a bare text (single block). */
function occs(text: string): ReturnType<typeof detectCitationsInBlock> {
  return detectCitationsInBlock(block(text));
}

// ---------------------------------------------------------------------------
// 1) Every §18 parenthetical form.
// ---------------------------------------------------------------------------

describe('parenthetical forms (§18)', () => {
  it('single (Smith, 2024) → one clean item, confidence 1', () => {
    const o = occs('(Smith, 2024)');
    expect(o).toHaveLength(1);
    expect(o[0]).toMatchObject({
      id: 'c0',
      raw: '(Smith, 2024)',
      family: 'author-date',
      confidence: 1,
    });
    expect(o[0]!.items).toEqual([
      { firstAuthor: 'Smith', authors: ['Smith'], year: 2024 },
    ]);
    expect(o[0]!.source).toMatchObject({ blockId: 'b1', startOffset: 0, endOffset: 13 });
  });

  it('multi-author (A, B, & C, year)', () => {
    const o = occs('(Duong, Tran, & Le, 2020) compared three extraction pipelines.');
    expect(o).toHaveLength(1);
    expect(o[0]!.raw).toBe('(Duong, Tran, & Le, 2020)');
    expect(o[0]!.items).toEqual([
      { firstAuthor: 'Duong', authors: ['Duong', 'Tran', 'Le'], year: 2020 },
    ]);
    expect(o[0]!.confidence).toBe(0.93);
  });

  it('two-author (A & B, year)', () => {
    const o = occs('Recent work (Nguyen & Tran, 2021) confirms the pattern across corpora.');
    expect(o).toHaveLength(1);
    expect(o[0]!.raw).toBe('(Nguyen & Tran, 2021)');
    expect(o[0]!.items).toEqual([
      { firstAuthor: 'Nguyen', authors: ['Nguyen', 'Tran'], year: 2021 },
    ]);
  });

  it('Oxford-comma (A, B, and C, year)', () => {
    const o = occs('(Smith, Brown, and Clark, 2022)');
    expect(o[0]!.items).toEqual([
      { firstAuthor: 'Smith', authors: ['Smith', 'Brown', 'Clark'], year: 2022 },
    ]);
  });

  it('et al. with trailing period AND without (et al)', () => {
    const withPeriod = occs('(Nguyen et al., 2019)');
    expect(withPeriod[0]!.items).toEqual([
      { firstAuthor: 'Nguyen', authors: ['Nguyen', 'et al.'], year: 2019 },
    ]);
    expect(withPeriod[0]!.confidence).toBe(0.9);
    const without = occs('(Nguyen et al, 2019)');
    expect(without[0]!.items).toEqual([
      { firstAuthor: 'Nguyen', authors: ['Nguyen', 'et al'], year: 2019 },
    ]);
  });

  it('multi-year (A, 2020, 2022) → one item per year', () => {
    const o = occs('(Smith, 2020, 2022)');
    expect(o[0]!.items).toEqual([
      { firstAuthor: 'Smith', authors: ['Smith'], year: 2020 },
      { firstAuthor: 'Smith', authors: ['Smith'], year: 2022 },
    ]);
    expect(o[0]!.confidence).toBe(0.92);
  });

  it('year-suffix (A, 2021a) and (A, 2021a, 2021b)', () => {
    const single = occs('(Smith, 2021a)');
    expect(single[0]!.items).toEqual([
      { firstAuthor: 'Smith', authors: ['Smith'], year: 2021, yearSuffix: 'a' },
    ]);
    expect(single[0]!.confidence).toBe(0.95);
    const multi = occs('(Smith, 2021a, 2021b)');
    expect(multi[0]!.items).toEqual([
      { firstAuthor: 'Smith', authors: ['Smith'], year: 2021, yearSuffix: 'a' },
      { firstAuthor: 'Smith', authors: ['Smith'], year: 2021, yearSuffix: 'b' },
    ]);
  });

  it('multi-citation semicolon: (A, 2020; B, 2019) and (Smith, 2020a; Smith, 2020b)', () => {
    const different = occs('Multiple studies (Doe, 2017; Roe, 2019) reached the same conclusion.');
    expect(different).toHaveLength(1);
    expect(different[0]!.items).toEqual([
      { firstAuthor: 'Doe', authors: ['Doe'], year: 2017 },
      { firstAuthor: 'Roe', authors: ['Roe'], year: 2019 },
    ]);
    expect(different[0]!.confidence).toBe(0.9);

    const sameAuthor = occs('(Smith, 2020a; Smith, 2020b) together define the approach.');
    expect(sameAuthor[0]!.items).toEqual([
      { firstAuthor: 'Smith', authors: ['Smith'], year: 2020, yearSuffix: 'a' },
      { firstAuthor: 'Smith', authors: ['Smith'], year: 2020, yearSuffix: 'b' },
    ]);
    expect(sameAuthor[0]!.confidence).toBe(0.855);
  });

  it('page (A, 2024, p. 12) and (Smith, 2024, pp. 12-14)', () => {
    const p = occs('In-text citation (Smith, 2024, p. 12) with a page number.');
    expect(p[0]!.items).toEqual([
      { firstAuthor: 'Smith', authors: ['Smith'], year: 2024, page: '12' },
    ]);
    expect(p[0]!.confidence).toBe(0.97);
    const pp = occs('(Smith, 2024, pp. 12-14)');
    expect(pp[0]!.items).toEqual([
      { firstAuthor: 'Smith', authors: ['Smith'], year: 2024, page: '12-14' },
    ]);
  });

  it('Harvard colon page (A 2024: 12)', () => {
    const o = occs('(Smith 2024: 12)');
    expect(o[0]!.items).toEqual([
      { firstAuthor: 'Smith', authors: ['Smith'], year: 2024, page: '12' },
    ]);
  });

  it('n.d. parenthetical: (Author unknown, n.d.) → year undefined', () => {
    const o = occs('(Author unknown, n.d.) remains an edge case for the extractor.');
    expect(o).toHaveLength(1);
    const item = o[0]!.items[0]! as Record<string, unknown>;
    expect(item.year).toBeUndefined();
    expect(item.yearSuffix).toBeUndefined();
    expect(item.authors).toEqual(['Author', 'unknown']);
    expect(o[0]!.confidence).toBe(0.651);
  });

  it('Harvard no-comma (Nguyen 2021)', () => {
    const o = occs('Harvard style (Nguyen 2021) omits the comma in some variants.');
    expect(o[0]!.items).toEqual([
      { firstAuthor: 'Nguyen', authors: ['Nguyen'], year: 2021 },
    ]);
    expect(o[0]!.confidence).toBe(0.85);
  });

  it('Vietnamese multi-author (Nguyen, Tran, & Le, 2024)', () => {
    const o = occs('(Nguyen, Tran, & Le, 2024)');
    expect(o[0]!.items).toEqual([
      { firstAuthor: 'Nguyen', authors: ['Nguyen', 'Tran', 'Le'], year: 2024 },
    ]);
  });

  it('cross-reference marker is dropped: (see Smith, 2024) → author Smith', () => {
    const o = occs('(see Smith, 2024)');
    expect(o[0]!.items).toEqual([
      { firstAuthor: 'Smith', authors: ['Smith'], year: 2024 },
    ]);
  });

  it('nested region: "(see Smith (2020))" yields the inner "Smith (2020)"', () => {
    const o = occs('(see Smith (2020))');
    expect(o).toHaveLength(1);
    expect(o[0]!.raw).toBe('Smith (2020)');
    expect(o[0]!.items).toEqual([
      { firstAuthor: 'Smith', authors: ['Smith'], year: 2020 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// 2) Every §18 narrative form.
// ---------------------------------------------------------------------------

describe('narrative forms (§18)', () => {
  it('single author: Smith (2020) — raw includes the name, offsets round-trip', () => {
    const text = 'Smith (2020) argued that citation analysis improves with precise offsets.';
    const o = occs(text);
    expect(o).toHaveLength(1);
    expect(o[0]!.raw).toBe('Smith (2020)');
    expect(o[0]!.items).toEqual([
      { firstAuthor: 'Smith', authors: ['Smith'], year: 2020 },
    ]);
    expect(o[0]!.confidence).toBe(0.9);
    const { startOffset, endOffset } = o[0]!.source;
    expect(text.slice(startOffset!, endOffset!)).toBe('Smith (2020)');
  });

  it('two authors: Pham and Nguyen (2017)', () => {
    const o = occs('Pham and Nguyen (2017) first noted the offset problem.');
    expect(o[0]!.raw).toBe('Pham and Nguyen (2017)');
    expect(o[0]!.items).toEqual([
      { firstAuthor: 'Pham', authors: ['Pham', 'Nguyen'], year: 2017 },
    ]);
    expect(o[0]!.confidence).toBe(0.837);
  });

  it('et al. narrative with and without period: Nguyen et al. (2019)', () => {
    const withPeriod = occs("Nguyen et al. (2019) define 'field persistence' formally.");
    expect(withPeriod[0]!.raw).toBe('Nguyen et al. (2019)');
    expect(withPeriod[0]!.items).toEqual([
      { firstAuthor: 'Nguyen', authors: ['Nguyen et al.'], year: 2019 },
    ]);
    expect(withPeriod[0]!.confidence).toBe(0.81);
    const without = occs('Nguyen et al (2019)');
    expect(without[0]!.items[0]!.authors).toEqual(['Nguyen et al']);
  });

  it('Oxford-comma narrative: Anderson, Brown, and Clark (2018)', () => {
    const o = occs('Anderson, Brown, and Clark (2018) showed that fragmentation affects extraction.');
    expect(o[0]!.raw).toBe('Anderson, Brown, and Clark (2018)');
    expect(o[0]!.items).toEqual([
      { firstAuthor: 'Anderson', authors: ['Anderson', 'Brown', 'Clark'], year: 2018 },
    ]);
  });

  it('4-author narrative: Ngo, Vu, Hoang, and Bui (2016)', () => {
    const o = occs('Ngo, Vu, Hoang, and Bui (2016) traced the issue to run splitting.');
    expect(o[0]!.items).toEqual([
      { firstAuthor: 'Ngo', authors: ['Ngo', 'Vu', 'Hoang', 'Bui'], year: 2016 },
    ]);
  });

  it('year-suffix narrative: Smith (2020a) / Smith (2020b) in one block', () => {
    const o = occs('Smith (2020a) described the model; Smith (2020b) extended it with run tracking.');
    expect(o).toHaveLength(2);
    expect(o[0]!.id).toBe('c0');
    expect(o[0]!.items).toEqual([
      { firstAuthor: 'Smith', authors: ['Smith'], year: 2020, yearSuffix: 'a' },
    ]);
    expect(o[1]!.id).toBe('c1');
    expect(o[1]!.items).toEqual([
      { firstAuthor: 'Smith', authors: ['Smith'], year: 2020, yearSuffix: 'b' },
    ]);
  });

  it('Vietnamese narrative: Theo Nguyễn Văn A (2015) → firstAuthor Nguyễn', () => {
    const o = occs('Theo Nguyễn Văn A (2015), việc trích dẫn cần được xử lý một cách tự động.');
    expect(o).toHaveLength(1);
    expect(o[0]!.raw).toBe('Nguyễn Văn A (2015)');
    expect(o[0]!.items).toEqual([
      { firstAuthor: 'Nguyễn', authors: ['Nguyễn Văn A'], year: 2015 },
    ]);
  });

  it('Vietnamese narrative: Nghiên cứu của Trần Thị B (2018) → firstAuthor Trần', () => {
    const o = occs('Nghiên cứu của Trần Thị B (2018) chỉ ra rằng các trường trích dẫn thường bị phân mảnh.');
    expect(o[0]!.items).toEqual([
      { firstAuthor: 'Trần', authors: ['Trần Thị B'], year: 2018 },
    ]);
  });

  it('prose stopword boundary: Research & Development cited in Le (2023) → Le', () => {
    const o = occs('Research & Development cited in Le (2023) follows alphabetical order.');
    expect(o).toHaveLength(1);
    expect(o[0]!.raw).toBe('Le (2023)');
    expect(o[0]!.items).toEqual([
      { firstAuthor: 'Le', authors: ['Le'], year: 2023 },
    ]);
  });

  it('prose stopword boundary: According to Johnson (2018) → Johnson', () => {
    const o = occs('According to Johnson (2018), structured citation data improves reproducibility.');
    expect(o).toHaveLength(1);
    expect(o[0]!.raw).toBe('Johnson (2018)');
  });

  it('n.d. narrative with author: Smith (n.d.) → author kept, no year', () => {
    const o = occs('Smith (n.d.) flagged the unresolved ambiguity.');
    expect(o).toHaveLength(1);
    expect(o[0]!.raw).toBe('Smith (n.d.)');
    expect(o[0]!.items).toEqual([
      { firstAuthor: 'Smith', authors: ['Smith'] },
    ]);
    expect(o[0]!.confidence).toBe(0.63);
  });

  it('n.d. narrative with anonymous prose: raw is the bare "(n.d.)" (missing author)', () => {
    const o = occs('An anonymous reviewer (n.d.) flagged the unresolved ambiguity.');
    expect(o).toHaveLength(1);
    expect(o[0]!.raw).toBe('(n.d.)');
    expect(o[0]!.items).toEqual([{}]);
    expect(o[0]!.confidence).toBe(0.385);
  });

  it('family-first initial name: Doe, J. (2017) → firstAuthor Doe', () => {
    const o = occs('Doe, J. (2017). Citation practice in digital documents.');
    expect(o[0]!.items[0]!.firstAuthor).toBe('Doe');
    expect(o[0]!.items[0]!.year).toBe(2017);
  });
});

// ---------------------------------------------------------------------------
// 3) Explicit no-false-positive guards (the crux of §18/§23 conservatism).
// ---------------------------------------------------------------------------

describe('no-false-positive guards', () => {
  it('bare "Smith 2024." (plain-text.docx) is NOT a citation', () => {
    expect(occs('And a bare mention: Smith 2024.')).toHaveLength(0);
    expect(occs('Smith 2024.')).toHaveLength(0);
  });

  it('numeric family "[1]" is ignored (M002)', () => {
    expect(occs('Another: [1] numeric-style inline reference.')).toHaveLength(0);
    expect(occs('[1] and [2, 3]')).toHaveLength(0);
  });

  it('author-less parenthetical "(2020)" / "(2020; 2021)" is NOT a citation', () => {
    expect(occs('Multiple Smith citations (2020; 2021) create ambiguity without context.')).toHaveLength(0);
    expect(occs('(2020)')).toHaveLength(0);
  });

  it('stopword prose prefixes are rejected: "The results (2020)", "An analysis (2020)"', () => {
    expect(occs('The results (2020)')).toHaveLength(0);
    expect(occs('An analysis (2020)')).toHaveLength(0);
    expect(occs('As discussed above. (2020)')).toHaveLength(0);
  });

  it('"(Smith)" with no date is NOT a citation', () => {
    expect(occs('(Smith)')).toHaveLength(0);
  });

  it('non-4-digit year "(Smith, 99)" is NOT a citation', () => {
    expect(occs('(Smith, 99)')).toHaveLength(0);
  });

  it('unbalanced paren "Smith (2020" yields nothing (conservative)', () => {
    expect(occs('Smith (2020')).toHaveLength(0);
  });

  it('empty paren "()" yields nothing', () => {
    expect(occs('()')).toHaveLength(0);
  });

  it('empty text yields nothing', () => {
    expect(occs('')).toHaveLength(0);
  });

  it('URL-ish paren with no year "(artificial_intelligence)" is NOT a citation', () => {
    expect(occs('See https://example.org/wiki/Artificial_(intelligence)')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4) Lower-level module boundaries.
// ---------------------------------------------------------------------------

describe('candidate detector (candidate.ts)', () => {
  it('finds balanced parenthetical regions in document order', () => {
    const regions = findParentheticalRegions('(a) b (c)');
    expect(regions.map((r) => [r.openOffset, r.closeOffset])).toEqual([
      [0, 3],
      [6, 9],
    ]);
    expect(regions[0]!.inner).toBe('a');
    expect(regions[1]!.inner).toBe('c');
  });

  it('is nesting-aware and sorted by open offset', () => {
    const regions = findParentheticalRegions('(a (b))');
    expect(regions.map((r) => [r.openOffset, r.closeOffset, r.inner])).toEqual([
      [0, 7, 'a (b)'],
      [3, 6, 'b'],
    ]);
  });

  it('scans the name prefix before the paren', () => {
    expect(scanNamePrefix('Le (2023)', 3)).toEqual({ prefix: 'Le', prefixStart: 0 });
    expect(scanNamePrefix('cited in Le (2023)', 12)).toEqual({ prefix: 'Le', prefixStart: 9 });
    expect(scanNamePrefix('(Smith, 2020)', 0)).toEqual({ prefix: '', prefixStart: 0 });
  });

  it('candidates enumerate regions with prefix decoration', () => {
    const cands = findCitationCandidates('Smith (2020) and (Lee, 2019)');
    expect(cands).toHaveLength(2);
    expect(cands[0]!.prefix).toBe('Smith');
    expect(cands[1]!.prefix).toBe(''); // parenthetical — no prefix needed
  });
});

describe('grammar primitives (grammar.ts)', () => {
  it('parseAuthorPrefix splits and validates author lists', () => {
    expect(parseAuthorPrefix('Anderson, Brown, and Clark')).toEqual([
      'Anderson', 'Brown', 'Clark',
    ]);
    expect(parseAuthorPrefix('Pham and Nguyen')).toEqual(['Pham', 'Nguyen']);
    expect(parseAuthorPrefix('Nguyễn Văn A')).toEqual(['Nguyễn Văn A']);
    expect(parseAuthorPrefix('Nguyen et al.')).toEqual(['Nguyen et al.']);
    expect(parseAuthorPrefix('The results')).toBeNull();
    expect(parseAuthorPrefix('An anonymous reviewer')).toBeNull();
  });

  it('familyToken: Vietnamese family-first, Western family-last, initials skipped', () => {
    expect(familyToken('Nguyễn Văn A')).toBe('Nguyễn');
    expect(familyToken('Trần Thị B')).toBe('Trần');
    expect(familyToken('Smith')).toBe('Smith');
    expect(familyToken('John Smith')).toBe('Smith');
    expect(familyToken('Doe, J.')).toBe('Doe');
    expect(familyToken('Johnson et al.')).toBe('Johnson');
    expect(familyToken('Le')).toBe('Le');
  });

  it('parseCandidate returns null for non-citations', () => {
    const text = 'plain prose (2020)';
    const cand = findCitationCandidates(text)[0]!;
    expect(parseCandidate(text, cand)).toBeNull();
  });
});

describe('confidence scorer (confidence.ts)', () => {
  it('base feature set scores exactly 1 and is clamped to [0.05, 1]', () => {
    expect(citationConfidence(BASE_FEATURES)).toBe(1);
    expect(
      citationConfidence({ ...BASE_FEATURES, noAuthor: true, noYear: true }),
    ).toBe(0.385);
    expect(
      citationConfidence({
        ...BASE_FEATURES, narrative: true, noComma: true, authorCount: 3,
        hasEtAl: true, years: 2, hasSuffix: true, multiCitation: true,
        hasPage: true, noYear: true, noAuthor: true,
      }),
    ).toBeGreaterThanOrEqual(0.05);
    expect(
      citationConfidence({
        ...BASE_FEATURES, narrative: true, noComma: true, authorCount: 3,
        hasEtAl: true, years: 2, hasSuffix: true, multiCitation: true,
        hasPage: true, noYear: true, noAuthor: true,
      }),
    ).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 5) Orchestration: ids, source carry, determinism, fixture-sentence shapes.
// ---------------------------------------------------------------------------

describe('orchestration (detectCitationsInBlock)', () => {
  it('assigns contiguous c{n} ids in document order', () => {
    const o = occs('Smith (2020) and (Lee, 2019) and Nguyen et al. (2018)');
    expect(o.map((c) => c.id)).toEqual(['c0', 'c1', 'c2']);
  });

  it('honors a running startIndex (document-order numbering across blocks)', () => {
    const b = block('Smith (2020) and (Lee, 2019)', 'b2');
    const o = detectCitationsInBlock(b, 5);
    expect(o.map((c) => c.id)).toEqual(['c5', 'c6']);
  });

  it('carries blockId and paragraphIndex into occurrence sources (R009)', () => {
    const b = block('Smith (2020) proposed a theory', 'p3', 3);
    const o = detectCitationsInBlock(b);
    expect(o[0]!.source.blockId).toBe('p3');
    expect(o[0]!.source.paragraphIndex).toBe(3);
    expect(o[0]!.source.startOffset).toBe(0);
    expect(o[0]!.source.endOffset).toBe(12);
  });

  it('every occurrence raw round-trips via text.slice (R009)', () => {
    const text = 'Smith (2020) argued that (Lee, 2019) matters; Ngo, Vu, Hoang, and Bui (2016) agree.';
    const o = occs(text);
    for (const c of o) {
      expect(text.slice(c.source.startOffset!, c.source.endOffset!)).toBe(c.raw);
    }
  });

  it('is deterministic: same block twice yields deep-equal occurrences (R008)', () => {
    const text = 'Smith (2020a) and Smith (2020b); (Nguyen et al., 2019)';
    const a = occs(text);
    const b = occs(text);
    expect(a).toEqual(b);
    for (let i = 0; i < 10; i++) expect(occs(text)).toEqual(a);
  });

  it('recognizes every author-date fixture sentence shape (§18 corpus)', () => {
    expect(occs('A later study (Lee, 2019) reached similar conclusions.')[0]!.raw).toBe('(Lee, 2019)');
    expect(occs('Some authors (Williams et al., 2022) disagree with that reading.')[0]!.items).toEqual([
      { firstAuthor: 'Williams', authors: ['Williams', 'et al.'], year: 2022 },
    ]);
    expect(occs('(Smith, 2020) appears twice with different meanings.')[0]!.items).toEqual([
      { firstAuthor: 'Smith', authors: ['Smith'], year: 2020 },
    ]);
    expect(occs('Luận án tiến sĩ của Phạm Quốc C (2020) nhấn mạnh tính xác định của quá trình phân tích.')[0]!.items).toEqual([
      { firstAuthor: 'Phạm', authors: ['Phạm Quốc C'], year: 2020 },
    ]);
    expect(occs('Plain-text citation: (Johnson 2018) without any structured field.')[0]!.items).toEqual([
      { firstAuthor: 'Johnson', authors: ['Johnson'], year: 2018 },
    ]);
  });
});
