/**
 * M002-S01-T1 — bracketed numeric citation detector + grammar proof
 * (R007/§20, numeric family).
 *
 * Locks the done-when contract: `[1]`, `[1,2]`, `[1-4]`, `[1,2,4-5]` and
 * multiple adjacent brackets parse into family:'numeric' occurrences with
 * the §20 NumericCitationItem `{ numbers }`, deterministic `c{n}` ids in
 * document order (R008), source offsets that round-trip via `text.slice`
 * (R009), and pinned confidence values (R008).
 *
 * Conservative surface (Q7 negative coverage): `[1, x]` and `[4-1]` are
 * NEVER half-emitted — they surface as typed invalid-numeric candidates
 * (reason 'mixed' / 'malformed', CS007 in S2). Prose brackets like
 * `[Figure 2]`, empty `[]`, and unbalanced `[` are ignored outright.
 */

import { describe, expect, it } from 'vitest';

import type { DocumentBlock } from '@citesync/document-model';

import {
  BASE_NUMERIC_FEATURES,
  detectNumericCitationsInBlock,
  findBracketRegions,
  findNumericCandidates,
  MAX_RANGE_SPAN,
  numericConfidence,
} from '../src/citations/numeric/index.js';
import { parseNumericBracket } from '../src/citations/numeric/index.js';

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

/** Convenience: detect numeric citations in a bare text (single block). */
function detect(text: string) {
  return detectNumericCitationsInBlock(block(text));
}

// ---------------------------------------------------------------------------
// 1) Supported forms.
// ---------------------------------------------------------------------------

describe('numeric bracket forms (R007)', () => {
  it('[1] → one clean occurrence, family numeric, confidence 1', () => {
    const r = detect('[1]');
    expect(r.occurrences).toHaveLength(1);
    expect(r.occurrences[0]).toMatchObject({
      id: 'c0',
      raw: '[1]',
      family: 'numeric',
      confidence: 1,
    });
    expect(r.occurrences[0]!.items).toEqual([{ numbers: [1] }]);
    expect(r.occurrences[0]!.source).toMatchObject({
      blockId: 'b1',
      startOffset: 0,
      endOffset: 3,
    });
    expect(r.invalid).toHaveLength(0);
  });

  it('[1,2] → numbers [1,2], confidence 0.97', () => {
    const r = detect('[1,2]');
    expect(r.occurrences[0]!.items).toEqual([{ numbers: [1, 2] }]);
    expect(r.occurrences[0]!.confidence).toBe(0.97);
  });

  it('[1-4] → inclusive expansion [1,2,3,4], confidence 0.95', () => {
    const r = detect('[1-4]');
    expect(r.occurrences[0]!.items).toEqual([{ numbers: [1, 2, 3, 4] }]);
    expect(r.occurrences[0]!.confidence).toBe(0.95);
  });

  it('[1,2,4-5] → mixed list + range, confidence 0.9215', () => {
    const r = detect('[1,2,4-5]');
    expect(r.occurrences[0]!.items).toEqual([{ numbers: [1, 2, 4, 5] }]);
    expect(r.occurrences[0]!.confidence).toBe(0.9215);
  });

  it('multiple ADJACENT brackets [1][2,3] → separate occurrences, contiguous ids', () => {
    const r = detect('Evidence [1][2,3] supports this.');
    expect(r.occurrences).toHaveLength(2);
    expect(r.occurrences.map((o) => o.id)).toEqual(['c0', 'c1']);
    expect(r.occurrences[0]!.items).toEqual([{ numbers: [1] }]);
    expect(r.occurrences[1]!.items).toEqual([{ numbers: [2, 3] }]);
  });

  it('whitespace-tolerant: [1, 2], [1 - 4], en-dash [1–4]', () => {
    const spaced = detect('[1, 2]');
    expect(spaced.occurrences[0]!.items).toEqual([{ numbers: [1, 2] }]);
    const range = detect('[1 - 4]');
    expect(range.occurrences[0]!.items).toEqual([{ numbers: [1, 2, 3, 4] }]);
    const endash = detect('[1–4]');
    expect(endash.occurrences[0]!.items).toEqual([{ numbers: [1, 2, 3, 4] }]);
  });

  it('trailing/duplicate commas are tolerated: [1,2,] → numbers [1,2]', () => {
    const r = detect('[1,2,]');
    expect(r.occurrences).toHaveLength(1);
    expect(r.occurrences[0]!.items).toEqual([{ numbers: [1, 2] }]);
  });

  it('[0] parses as an occurrence (index validity is the T2 mapping pass)', () => {
    const r = detect('[0]');
    expect(r.occurrences[0]!.items).toEqual([{ numbers: [0] }]);
  });

  it('inline prose context: offsets round-trip via text.slice (R009)', () => {
    const text = 'Recent work [3] and earlier [1, 2] agree on the offset semantics.';
    const r = detectNumericCitationsInBlock(block(text));
    expect(r.occurrences).toHaveLength(2);
    for (const o of r.occurrences) {
      const { startOffset, endOffset } = o.source;
      expect(text.slice(startOffset!, endOffset!)).toBe(o.raw);
    }
  });
});

// ---------------------------------------------------------------------------
// 2) Source location + ids.
// ---------------------------------------------------------------------------

describe('source location and deterministic ids (R008/R009)', () => {
  it('carries blockId + paragraphIndex into each occurrence source', () => {
    const r = detectNumericCitationsInBlock(block('[1] then [2]', 'doc-p7', 3));
    expect(r.occurrences[0]!.source).toMatchObject({
      blockId: 'doc-p7',
      paragraphIndex: 3,
      startOffset: 0,
      endOffset: 3,
    });
    expect(r.occurrences[1]!.source).toMatchObject({
      blockId: 'doc-p7',
      paragraphIndex: 3,
      startOffset: 9,
      endOffset: 12,
    });
  });

  it('startIndex continuation → contiguous c{n} ids from the running counter', () => {
    const r = detectNumericCitationsInBlock(block('[1][2]'), 5);
    expect(r.occurrences.map((o) => o.id)).toEqual(['c5', 'c6']);
  });

  it('detection is deterministic: re-run yields deep-equal, byte-identical output', () => {
    const text = 'Mixed [1,2] ranges [1-4] and lists [1,2,4-5] plus junk [1, x] [4-1].';
    const a = detect(text);
    const b = detect(text);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // Invalid surface order follows document order (deterministic).
    expect(a.invalid.map((i) => i.raw)).toEqual(['[1, x]', '[4-1]']);
  });
});

// ---------------------------------------------------------------------------
// 3) Per-token sources (T2 mapping input).
// ---------------------------------------------------------------------------

describe('per-token sources (grammar)', () => {
  it('[1,2,4-5] yields tokens with absolute offsets and kinds', () => {
    const text = 'See [1,2,4-5] here.';
    const cand = findNumericCandidates(text)[0]!;
    const parsed = parseNumericBracket(text, cand);
    expect(parsed.outcome).toBe('valid');
    if (parsed.outcome !== 'valid') return;
    expect(parsed.citation.tokens).toEqual([
      { index: 1, kind: 'single', startOffset: 5, endOffset: 6 },
      { index: 2, kind: 'single', startOffset: 7, endOffset: 8 },
      { index: 4, end: 5, kind: 'range', startOffset: 9, endOffset: 12 },
    ]);
    // Token spans round-trip (R009).
    for (const t of parsed.citation.tokens) {
      const span = text.slice(t.startOffset, t.endOffset);
      if (t.kind === 'single') expect(span).toBe(String(t.index));
      else expect(span).toBe(`${t.index}-${t.end}`);
    }
  });

  it('[1 - 4] token span covers the trimmed range text', () => {
    const text = 'A [1 - 4] span.';
    const cand = findNumericCandidates(text)[0]!;
    const parsed = parseNumericBracket(text, cand);
    expect(parsed.outcome).toBe('valid');
    if (parsed.outcome !== 'valid') return;
    const t = parsed.citation.tokens[0]!;
    expect(t.kind).toBe('range');
    expect(text.slice(t.startOffset, t.endOffset)).toBe('1 - 4');
  });
});

// ---------------------------------------------------------------------------
// 4) Conservative invalid surface (never half-emitted, CS007 in S2).
// ---------------------------------------------------------------------------

describe('invalid-numeric surface (conservative, never half-emitted)', () => {
  it('[1, x] → NOT in occurrences; surfaced as invalid reason "mixed"', () => {
    const r = detect('A bracket [1, x] is malformed.');
    expect(r.occurrences).toHaveLength(0);
    expect(r.invalid).toHaveLength(1);
    expect(r.invalid[0]).toMatchObject({
      raw: '[1, x]',
      startOffset: 10,
      endOffset: 16,
      reason: 'mixed',
      segments: ['1', 'x'],
    });
  });

  it('[x, 2] → surfaced as invalid "mixed" regardless of order', () => {
    const r = detect('[x, 2]');
    expect(r.occurrences).toHaveLength(0);
    expect(r.invalid[0]!.reason).toBe('mixed');
  });

  it('[4-1] reversed range → invalid "malformed"', () => {
    const r = detect('[4-1]');
    expect(r.occurrences).toHaveLength(0);
    expect(r.invalid).toHaveLength(1);
    expect(r.invalid[0]).toMatchObject({ raw: '[4-1]', reason: 'malformed' });
  });

  it('[1 2] space-separated → invalid "malformed" (digit-leading non-shaped)', () => {
    const r = detect('[1 2]');
    expect(r.occurrences).toHaveLength(0);
    expect(r.invalid[0]!.reason).toBe('malformed');
  });

  it('range span beyond MAX_RANGE_SPAN → invalid "malformed" (R019 guard)', () => {
    const over = detect(`[1-${MAX_RANGE_SPAN + 1}]`);
    expect(over.occurrences).toHaveLength(0);
    expect(over.invalid).toHaveLength(1);
    expect(over.invalid[0]!.reason).toBe('malformed');
    // Exactly at the bound is still clean.
    const at = detect(`[1-${MAX_RANGE_SPAN}]`);
    expect(at.occurrences).toHaveLength(1);
    expect(at.occurrences[0]!.items[0]!.numbers).toHaveLength(MAX_RANGE_SPAN);
  });

  it('valid and invalid brackets coexist without half-emission', () => {
    const r = detect('Good [2] bad [1, x] good [3].');
    expect(r.occurrences.map((o) => o.id)).toEqual(['c0', 'c1']);
    expect(r.occurrences.map((o) => o.raw)).toEqual(['[2]', '[3]']);
    expect(r.invalid.map((i) => i.raw)).toEqual(['[1, x]']);
  });
});

// ---------------------------------------------------------------------------
// 5) Not-a-citation brackets (ignored outright).
// ---------------------------------------------------------------------------

describe('prose brackets are ignored (not a citation attempt)', () => {
  it('[Figure 2], [Appendix A] → neither occurrence nor invalid', () => {
    const r = detect('See [Figure 2] and [Appendix A] for details.');
    expect(r.occurrences).toHaveLength(0);
    expect(r.invalid).toHaveLength(0);
  });

  it('empty [] and unbalanced "[" → nothing', () => {
    expect(detect('[]').occurrences).toHaveLength(0);
    expect(detect('[]').invalid).toHaveLength(0);
    expect(detect('unbalanced [1').occurrences).toHaveLength(0);
    expect(detect('unbalanced 1] here').occurrences).toHaveLength(0);
    expect(detect('unbalanced 1] here').invalid).toHaveLength(0);
  });

  it('author-date parens are not touched by the numeric detector', () => {
    const r = detect('(Smith, 2024) uses no brackets.');
    expect(r.occurrences).toHaveLength(0);
    expect(r.invalid).toHaveLength(0);
  });

  it('a bracket inside a paren is still its own numeric region: ([1])', () => {
    const r = detect('([1])');
    expect(r.occurrences).toHaveLength(1);
    expect(r.occurrences[0]!.raw).toBe('[1]');
  });

  it('nested [[1]] → only the inner [1] is a clean citation', () => {
    const r = detect('[[1]]');
    expect(r.occurrences).toHaveLength(1);
    expect(r.occurrences[0]!.raw).toBe('[1]');
    expect(r.occurrences[0]!.source.startOffset).toBe(1);
    expect(r.occurrences[0]!.source.endOffset).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// 6) Confidence pins + candidate enumeration primitives.
// ---------------------------------------------------------------------------

describe('confidence + low-level primitives', () => {
  it('pins the documented confidence values', () => {
    expect(numericConfidence({ tokenCount: 1, indexCount: 1, hasRange: false })).toBe(1);
    expect(numericConfidence({ tokenCount: 2, indexCount: 2, hasRange: false })).toBe(0.97);
    expect(numericConfidence({ tokenCount: 1, indexCount: 4, hasRange: true })).toBe(0.95);
    expect(numericConfidence({ tokenCount: 3, indexCount: 4, hasRange: true })).toBe(0.9215);
    expect(numericConfidence(BASE_NUMERIC_FEATURES)).toBe(1);
  });

  it('findBracketRegions enumerates balanced regions in open-offset order', () => {
    const regions = findBracketRegions('a [1] b [2,3] c');
    expect(regions.map((r) => r.inner)).toEqual(['1', '2,3']);
    expect(regions.map((r) => r.openOffset)).toEqual([2, 8]);
  });

  it('unbalanced brackets yield no regions (conservative)', () => {
    expect(findBracketRegions('[1')).toHaveLength(0);
    expect(findBracketRegions('1]')).toHaveLength(0);
    expect(findBracketRegions('[1][')).toHaveLength(1);
  });
});
