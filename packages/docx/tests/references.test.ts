/**
 * S03-T05 — reference-entry parsing + bibliography splitting proof
 * (R006/§21, D012 identifiers folding, §88 failure isolation).
 *
 * Locks the exact done-when contract: `Doe, J. (2017). Citation practice…`
 * and `Johnson, A. (2018a). …` parse into the right authors / year /
 * yearSuffix / title / container / identifiers, and a malformed entry is
 * ISOLATED (raw + parseConfidence 0, never throws). Also pins:
 *   - author-group splitting on `;` / `,` / `&` / `and` (+ Vietnamese `và`),
 *     APA `Family, Given` alternating pairs vs family-first full names;
 *   - Vietnamese family-first segmentation (Nguyễn/Trần/Lê) with tiered
 *     PersonNameKey from the T02 normalizer (Nguyễn ≠ Nguyen at exact,
 *     equal at diacriticInsensitive);
 *   - year-suffix 2018a → year 2018 + suffix 'a'; n.d. → year undefined;
 *   - volume/issue/pages folding into identifiers (D012);
 *   - DOI (`doi:` and `https://doi.org/`);
 *   - splitEntryBlocks heading handling (skip pure heading, keep entry-shaped
 *     heading), unresolved-id skipping, empty spans;
 *   - deterministic ids `r{index}`, byte-stable re-parses (R008).
 *
 * Negative coverage (Q7): prose without a year marker, author-less `(2017).`
 * entries, empty text, and confidence-0 failure reasons — all non-throwing.
 */

import { describe, expect, it } from 'vitest';

import type { DocumentBlock, SourceLocation } from '@citesync/document-model';

import {
  describeReferenceParseFailure,
  isReferenceEntryBlock,
  parseReferenceEntry,
  personName,
  referenceConfidence,
  BASE_REFERENCE_FEATURES,
  splitAuthorGroups,
  splitEntryBlocks,
} from '../src/references/index.js';

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

/** Convenience: parse a bare entry text (single block, index 0). */
function entry(
  text: string,
  index = 0,
  source: SourceLocation = { blockId: 'e0', startOffset: 0, endOffset: text.length },
): ReturnType<typeof parseReferenceEntry> {
  return parseReferenceEntry(text, index, source);
}

/** Convenience: enumerate entries from blockIds over an ordered block list. */
function split(blockIds: string[], blocks: DocumentBlock[]): DocumentBlock[] {
  return splitEntryBlocks(blockIds, blocks);
}

// ---------------------------------------------------------------------------
// 1) Done-when: the two canonical APA entries.
// ---------------------------------------------------------------------------

describe('canonical APA entries (§21 done-when)', () => {
  it('Doe, J. (2017) → authors/year/title/container/identifiers', () => {
    const text =
      'Doe, J. (2017). Citation practice in digital documents. Journal of Citation Science, 12(3), 45-60.';
    const e = entry(text);
    expect(e).toMatchObject({
      id: 'r0',
      index: 0,
      raw: text,
      parseConfidence: 1,
      year: 2017,
      title: 'Citation practice in digital documents',
      containerTitle: 'Journal of Citation Science',
      identifiers: { volume: '12', issue: '3', pages: '45-60' },
      source: { blockId: 'e0', startOffset: 0, endOffset: text.length },
    });
    expect(e.yearSuffix).toBeUndefined();
    expect(e.authors).toEqual([
      {
        originalName: 'Doe, J.',
        family: 'Doe',
        given: 'J.',
        key: {
          exact: 'doe j',
          diacriticInsensitive: 'doe j',
          initials: 'dj',
        },
      },
    ]);
  });

  it('Johnson, A. (2018a) → year 2018 + suffix a, book container', () => {
    const e = entry(
      'Johnson, A. (2018a). Structured citations. Cambridge University Press.',
    );
    expect(e).toMatchObject({
      id: 'r0',
      year: 2018,
      yearSuffix: 'a',
      title: 'Structured citations',
      containerTitle: 'Cambridge University Press',
      parseConfidence: 0.9224, // suffix × no vol/issue/pages
    });
    expect(e.identifiers).toBeUndefined();
  });

  it('id is the deterministic r{index} in section order (R008)', () => {
    expect(entry('Doe, J. (2017). Title. Journal of X.', 2).id).toBe('r2');
    expect(entry('Smith, A. (2020). Other. Journal of Y.', 7).id).toBe('r7');
  });

  it('re-parsing the same text yields a deep-equal entry (determinism)', () => {
    const text =
      'Doe, J. (2017). Citation practice in digital documents. Journal of Citation Science, 12(3), 45-60.';
    expect(entry(text)).toEqual(entry(text));
  });
});

// ---------------------------------------------------------------------------
// 2) Author lists (§21 splitting).
// ---------------------------------------------------------------------------

describe('author splitting (§21)', () => {
  it('APA multi-author with & → three authors', () => {
    const e = entry(
      'Doe, J., Smith, A., & Johnson, B. (2019). Team writing. Journal of X, 1(1), 2-3.',
    );
    expect(e.authors!.map((a) => `${a.family}/${a.given}`)).toEqual([
      'Doe/J.',
      'Smith/A.',
      'Johnson/B.',
    ]);
    expect(e.parseConfidence).toBe(0.96); // > 1 author
  });

  it('semicolon-separated groups', () => {
    const e = entry('Doe, J.; Smith, A. (2017). Title. Journal of X.');
    expect(e.authors!.map((a) => a.family)).toEqual(['Doe', 'Smith']);
  });

  it('"and"-separated groups', () => {
    const e = entry('Doe, J. and Smith, A. (2017). Title. Journal of X.');
    expect(e.authors!.map((a) => a.family)).toEqual(['Doe', 'Smith']);
  });

  it('comma-separated family-first full names (no Family, Given shape)', () => {
    const e = entry(
      'Nguyễn Văn A, Trần Thị B (2015) Tên bài báo. Tạp chí Khoa học, 10(2), 15-20.',
    );
    expect(e.authors!.map((a) => `${a.family}/${a.given}`)).toEqual([
      'Nguyễn/Văn A',
      'Trần/Thị B',
    ]);
  });

  it('given-name-first Western name → family = last token', () => {
    const e = entry('John Smith (2017). Title. Journal of X.');
    expect(e.authors).toEqual([
      {
        originalName: 'John Smith',
        family: 'Smith',
        given: 'John',
        key: {
          exact: 'john smith',
          diacriticInsensitive: 'john smith',
          initials: 'js',
        },
      },
    ]);
  });

  it('splitAuthorGroups unit surface', () => {
    expect(splitAuthorGroups('Doe, J., Smith, A., & Johnson, B.')).toEqual([
      'Doe, J.',
      'Smith, A.',
      'Johnson, B.',
    ]);
    expect(splitAuthorGroups('Nguyễn Văn A, Trần Thị B')).toEqual([
      'Nguyễn Văn A',
      'Trần Thị B',
    ]);
    expect(splitAuthorGroups('Doe, J.')).toEqual(['Doe, J.']);
    expect(splitAuthorGroups('Smith')).toEqual(['Smith']);
  });
});

// ---------------------------------------------------------------------------
// 3) Vietnamese names + diacritic tiers (§24).
// ---------------------------------------------------------------------------

describe('Vietnamese names + diacritic tiers (§24)', () => {
  it('family-first segmentation with diacritics preserved in exact key', () => {
    const p = personName('Nguyễn Văn A');
    expect(p.family).toBe('Nguyễn');
    expect(p.given).toBe('Văn A');
    expect(p.key.exact).toBe('nguyễn văn a');
    expect(p.key.diacriticInsensitive).toBe('nguyen van a');
    expect(p.key.initials).toBe('nva');
  });

  it('Nguyễn (NFC) ≠ Nguyen at exact, equal at diacriticInsensitive', () => {
    const a = personName('Nguyễn Văn A');
    const b = personName('Nguyen Van A');
    expect(a.key.exact).not.toBe(b.key.exact);
    expect(a.key.diacriticInsensitive).toBe(b.key.diacriticInsensitive);
    expect(a.key.initials).toBe(b.key.initials);
  });

  it('Vietnamese APA list (Nguyễn, Trần, Lê) parses families correctly', () => {
    const e = entry(
      'Nguyễn, V. A., Trần, T. B., & Lê, C. (2020). Nghiên cứu về X. Tạp chí Y, 5(1), 1-9.',
    );
    expect(e.authors!.map((a) => `${a.family}/${a.given}`)).toEqual([
      'Nguyễn/V. A.',
      'Trần/T. B.',
      'Lê/C.',
    ]);
    expect(e.parseConfidence).toBe(0.96);
  });
});

// ---------------------------------------------------------------------------
// 4) Year variants: suffix, n.d., volume-only, pp-pages, DOI.
// ---------------------------------------------------------------------------

describe('year / tail / DOI variants (§21)', () => {
  it('n.d. → year undefined, still parsed (low confidence)', () => {
    const e = entry('Smith, J. (n.d.). Untitled. Publisher.');
    expect(e.year).toBeUndefined();
    expect(e.yearSuffix).toBeUndefined();
    expect(e.title).toBe('Untitled');
    expect(e.containerTitle).toBe('Publisher');
    expect(e.parseConfidence).toBe(0.6588); // no year × no vol/issue/pages
  });

  it('volume without issue folds to identifiers.volume', () => {
    const e = entry('Doe, J. (2017). Title. Nature, 12, 45-60.');
    expect(e.containerTitle).toBe('Nature');
    expect(e.identifiers).toEqual({ volume: '12', pages: '45-60' });
  });

  it('volume + issue without pages', () => {
    const e = entry('Doe, J. (2017). Title. Journal of X, 12(3).');
    expect(e.identifiers).toEqual({ volume: '12', issue: '3' });
  });

  it('pp.-prefixed page range', () => {
    const e = entry('Doe, J. (2017). Title. Journal of X, 12(3), pp. 45-60.');
    expect(e.identifiers!.pages).toBe('45-60');
  });

  it('en-dash page range', () => {
    const e = entry('Doe, J. (2017). Title. Journal of X, 12(3), 45–60.');
    expect(e.identifiers!.pages).toBe('45–60');
  });

  it('DOI via https://doi.org/', () => {
    const e = entry(
      'Smith, J. (2020). Digital workflows. Journal of X, 4(2), 100-110. https://doi.org/10.1234/abc.def',
    );
    expect(e.doi).toBe('10.1234/abc.def');
    expect(e.containerTitle).toBe('Journal of X');
    expect(e.identifiers).toEqual({ volume: '4', issue: '2', pages: '100-110' });
  });

  it('DOI via doi: prefix (sentence period stripped)', () => {
    const e = entry(
      'Smith, J. (2020). Digital workflows. Journal of X, 4(2), 100-110. doi: 10.5678/xyz.',
    );
    expect(e.doi).toBe('10.5678/xyz');
    // The DOI must not leak into the title or container.
    expect(e.title).toBe('Digital workflows');
    expect(e.containerTitle).toBe('Journal of X');
  });

  it('abbreviation inside title survives (U.S.) — last-`. ` container split', () => {
    const e = entry(
      'Smith, J. (2020). On the U.S. economy. Journal of X, 1(1), 2-3.',
    );
    expect(e.title).toBe('On the U.S. economy');
    expect(e.containerTitle).toBe('Journal of X');
  });

  it('no container / no title degrade confidence but still parse', () => {
    const noContainer = entry('Doe, J. (2017). Citation practice in digital documents.');
    expect(noContainer.containerTitle).toBeUndefined();
    expect(noContainer.parseConfidence).toBe(0.8471); // no container × no tail
    const noTitle = entry('Doe, J. (2017)');
    expect(noTitle.title).toBeUndefined();
    expect(noTitle.parseConfidence).toBe(0.5082); // no title × no container × no tail
  });
});

// ---------------------------------------------------------------------------
// 5) Failure isolation (§88) — malformed entries NEVER throw.
// ---------------------------------------------------------------------------

describe('failure isolation (§88, Q7 negatives)', () => {
  it('prose without a year marker → confidence 0, raw preserved, no throw', () => {
    const text = 'This is not a reference at all.';
    const e = entry(text);
    expect(e.parseConfidence).toBe(0);
    expect(e.raw).toBe(text);
    expect(e.authors).toBeUndefined();
    expect(e.year).toBeUndefined();
    expect(e.title).toBeUndefined();
    expect(describeReferenceParseFailure(text)).toBe('no (YYYY) year marker');
  });

  it('author-less "(2017). Missing author." → confidence 0', () => {
    const text = '(2017). Missing author.';
    expect(entry(text).parseConfidence).toBe(0);
    expect(describeReferenceParseFailure(text)).toBe(
      'no author segment before the year',
    );
  });

  it('empty text → confidence 0, no throw', () => {
    expect(entry('   ').parseConfidence).toBe(0);
    expect(describeReferenceParseFailure('   ')).toBe('empty entry text');
  });

  it('failed entries keep deterministic ids and index', () => {
    const e = entry('junk without a year', 4);
    expect(e.id).toBe('r4');
    expect(e.index).toBe(4);
  });

  it('editor marker "(Ed.)" before the year does not confuse the year', () => {
    const e = entry('Doe, J. (Ed.) (2017). Title. Journal of X, 1(1), 2-3.');
    expect(e.year).toBe(2017);
    expect(e.authors!.map((a) => `${a.family}/${a.given}`)).toEqual(['Doe/J.']);
  });
});

// ---------------------------------------------------------------------------
// 6) splitEntryBlocks — S02 blockIds span → entry blocks.
// ---------------------------------------------------------------------------

describe('splitEntryBlocks (S02 span)', () => {
  const heading = block('References', 'h', 0);
  const e1 = block(
    'Doe, J. (2017). Citation practice. Journal of Citation Science, 12(3), 45-60.',
    'e1',
    1,
  );
  const e2 = block('Johnson, A. (2018a). Structured citations. Cambridge University Press.', 'e2', 2);
  const all = [heading, e1, e2];

  it('skips a pure heading block', () => {
    const entries = split(['h', 'e1', 'e2'], all);
    expect(entries.map((b) => b.id)).toEqual(['e1', 'e2']);
  });

  it('keeps a heading block that itself carries an entry', () => {
    const entryHeading = block(
      'Doe, J. (2017). Citation practice. Journal of Citation Science, 12(3), 45-60.',
      'h0',
      0,
    );
    const entries = split(['h0'], [entryHeading]);
    expect(entries.map((b) => b.id)).toEqual(['h0']);
  });

  it('empty blockIds → no entries', () => {
    expect(split([], all)).toEqual([]);
  });

  it('heading-only section → no entries', () => {
    expect(split(['h'], all)).toEqual([]);
  });

  it('unresolved ids are skipped (defensive)', () => {
    const entries = split(['h', 'zz', 'e1'], all);
    expect(entries.map((b) => b.id)).toEqual(['e1']);
  });

  it('isReferenceEntryBlock distinguishes heading vs entry text', () => {
    expect(isReferenceEntryBlock(heading)).toBe(false);
    expect(isReferenceEntryBlock(e1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7) Confidence scoring is pinned and deterministic.
// ---------------------------------------------------------------------------

describe('referenceConfidence (pinned, R008)', () => {
  it('clean full APA entry scores 1', () => {
    expect(referenceConfidence(BASE_REFERENCE_FEATURES)).toBe(1);
  });

  it('missing tail parts multiply down deterministically', () => {
    expect(
      referenceConfidence({
        ...BASE_REFERENCE_FEATURES,
        hasVolume: false,
        hasIssue: false,
        hasPages: false,
      }),
    ).toBe(0.9412);
    expect(
      referenceConfidence({
        ...BASE_REFERENCE_FEATURES,
        hasYear: false,
        hasVolume: false,
        hasIssue: false,
        hasPages: false,
      }),
    ).toBe(0.6588);
  });
});
