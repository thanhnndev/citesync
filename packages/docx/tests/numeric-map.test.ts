/**
 * M002-S01-T2 — numeric bracket→bibliography index-order mapping proof
 * (D016/R008).
 *
 * Locks the done-when contract for the mapping pass:
 *   - `[1..N]` resolve by ORDERED INDEX to `entries[index-1]` (never
 *     author/year scoring — the S04 scorer is untouched);
 *   - index > entries.length → 'out-of-range', index < 1 (e.g. `[0]`) →
 *     'unmatched' — both surfaced explicitly, never silently dropped;
 *   - ranges are expanded `[1-4]` → one binding per index value;
 *   - every token carries an R009-accurate token-level source that
 *     round-trips via `block.text.slice(...)`;
 *   - author-date citations never appear in the map;
 *   - the map is a pure, deterministic function of the doc (byte-identical
 *     on re-run, R008).
 */

import { describe, expect, it } from 'vitest';

import type {
  AcademicDocument,
  CitationOccurrence,
  DocumentBlock,
  NumericIndexMap,
  ReferenceEntry,
} from '@citesync/document-model';

import { detectNumericCitationsInBlock } from '../src/citations/numeric/index.js';
import { buildNumericIndexMap } from '../src/citations/numeric/map.js';

// ---------------------------------------------------------------------------
// Test helpers.
// ---------------------------------------------------------------------------

/** A minimal synthetic block (only id/text/source are read). */
function makeBlock(
  text: string,
  id = 'b1',
  paragraphIndex?: number,
): DocumentBlock {
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

/** A minimal bibliography entry with a stable id. */
function makeEntry(id: string): ReferenceEntry {
  return { id, raw: `raw ${id}`, source: { blockId: 'bib' }, parseConfidence: 1 };
}

/**
 * Emit numeric occurrences for every block the way T3's extractCitations
 * will (deterministic c{n} ids, document order) — the map's inputs.
 */
function numericCitationsFrom(
  blocks: DocumentBlock[],
  startIndex = 0,
): CitationOccurrence[] {
  const out: CitationOccurrence[] = [];
  for (const b of blocks) {
    const r = detectNumericCitationsInBlock(b, startIndex + out.length);
    out.push(...r.occurrences);
  }
  return out;
}

/** Build a doc whose citations come from real numeric detection. */
function makeDoc(
  blocks: DocumentBlock[],
  entries: ReferenceEntry[],
  extraCitations: CitationOccurrence[] = [],
): AcademicDocument {
  return {
    metadata: {},
    blocks,
    citations: [...numericCitationsFrom(blocks), ...extraCitations],
    bibliography:
      entries.length > 0
        ? { outcome: 'detected', entries }
        : undefined,
    sourceMap: { version: 1, blocks: {} },
  };
}

// ---------------------------------------------------------------------------
// 1) Ordered-index resolution ([1..N] → entries[index-1]).
// ---------------------------------------------------------------------------

describe('numeric index mapping — resolution (D016)', () => {
  it('[1] → resolved to entries[0], token-level source round-trips', () => {
    const entries = [makeEntry('r1'), makeEntry('r2')];
    const doc = makeDoc([makeBlock('[1]')], entries);
    const map = buildNumericIndexMap(doc);
    expect(map.version).toBe(1);
    expect(map.citations).toHaveLength(1);
    expect(map.citations[0]!.citationId).toBe('c0');
    expect(map.citations[0]!.tokens).toEqual([
      {
        index: 1,
        resolvedEntryId: 'r1',
        status: 'resolved',
        source: { blockId: 'b1', startOffset: 1, endOffset: 2 },
      },
    ]);
    // R009 round-trip: the token's span selects exactly "1" in block text.
    expect(doc.blocks[0]!.text.slice(1, 2)).toBe('1');
  });

  it('[1,2] → two resolved bindings in source order', () => {
    const entries = [makeEntry('r1'), makeEntry('r2'), makeEntry('r3')];
    const doc = makeDoc([makeBlock('[1,2]')], entries);
    const map = buildNumericIndexMap(doc);
    expect(map.citations[0]!.tokens.map((t) => [t.index, t.status, t.resolvedEntryId])).toEqual([
      [1, 'resolved', 'r1'],
      [2, 'resolved', 'r2'],
    ]);
    // Per-token offsets: "1" at 1..2, "2" at 3..4 in "[1,2]".
    expect(doc.blocks[0]!.text.slice(3, 4)).toBe('2');
  });

  it('[1-4] → range expanded to four resolved bindings (entries[0..3])', () => {
    const entries = [makeEntry('r1'), makeEntry('r2'), makeEntry('r3'), makeEntry('r4')];
    const doc = makeDoc([makeBlock('[1-4]')], entries);
    const map = buildNumericIndexMap(doc);
    expect(map.citations[0]!.tokens.map((t) => [t.index, t.status, t.resolvedEntryId])).toEqual([
      [1, 'resolved', 'r1'],
      [2, 'resolved', 'r2'],
      [3, 'resolved', 'r3'],
      [4, 'resolved', 'r4'],
    ]);
    // Every expanded token anchors to the same range segment (R009).
    const text = doc.blocks[0]!.text;
    for (const t of map.citations[0]!.tokens) {
      expect(t.source).toEqual({
        blockId: 'b1',
        startOffset: 1,
        endOffset: 4,
      });
      expect(text.slice(t.source.startOffset!, t.source.endOffset!)).toBe('1-4');
    }
  });

  it('multiple brackets [1][2] → one row per occurrence, document order', () => {
    const entries = [makeEntry('r1'), makeEntry('r2')];
    const doc = makeDoc([makeBlock('text [1] [2]')], entries);
    const map = buildNumericIndexMap(doc);
    expect(map.citations.map((c) => c.citationId)).toEqual(['c0', 'c1']);
    expect(map.citations[0]!.tokens[0]!.resolvedEntryId).toBe('r1');
    expect(map.citations[1]!.tokens[0]!.resolvedEntryId).toBe('r2');
  });

  it('prose brackets ([Figure 2]) produce no rows and do not disturb offsets', () => {
    const entries = [makeEntry('r1'), makeEntry('r2')];
    const doc = makeDoc([makeBlock('[1] [Figure 2] [2]')], entries);
    const map = buildNumericIndexMap(doc);
    expect(map.citations.map((c) => c.citationId)).toEqual(['c0', 'c1']);
    expect(map.citations.map((c) => c.tokens[0]!.resolvedEntryId)).toEqual(['r1', 'r2']);
  });
});

// ---------------------------------------------------------------------------
// 2) Conservative surface: out-of-range / unmatched, never silently dropped.
// ---------------------------------------------------------------------------

describe('numeric index mapping — conservative surface (D016)', () => {
  it('index > entries.length → out-of-range (surfaced, not dropped)', () => {
    const entries = [makeEntry('r1'), makeEntry('r2'), makeEntry('r3'), makeEntry('r4')];
    const doc = makeDoc([makeBlock('[5]')], entries);
    const map = buildNumericIndexMap(doc);
    expect(map.citations[0]!.tokens).toEqual([
      { index: 5, status: 'out-of-range', source: { blockId: 'b1', startOffset: 1, endOffset: 2 } },
    ]);
  });

  it('[0] → unmatched (not a valid 1-based position), never guessed', () => {
    const entries = [makeEntry('r1')];
    const doc = makeDoc([makeBlock('[0]')], entries);
    const map = buildNumericIndexMap(doc);
    expect(map.citations[0]!.tokens).toEqual([
      { index: 0, status: 'unmatched', source: { blockId: 'b1', startOffset: 1, endOffset: 2 } },
    ]);
  });

  it('[1,5] → resolved + out-of-range coexist in one bracket', () => {
    const entries = [makeEntry('r1'), makeEntry('r2'), makeEntry('r3'), makeEntry('r4')];
    const doc = makeDoc([makeBlock('[1,5]')], entries);
    const map = buildNumericIndexMap(doc);
    expect(map.citations[0]!.tokens.map((t) => [t.index, t.status, t.resolvedEntryId])).toEqual([
      [1, 'resolved', 'r1'],
      [5, 'out-of-range', undefined],
    ]);
  });

  it('[1-5] → four resolved + one out-of-range (range overflow surfaced)', () => {
    const entries = [makeEntry('r1'), makeEntry('r2'), makeEntry('r3'), makeEntry('r4')];
    const doc = makeDoc([makeBlock('[1-5]')], entries);
    const map = buildNumericIndexMap(doc);
    expect(map.citations[0]!.tokens.map((t) => [t.index, t.status, t.resolvedEntryId])).toEqual([
      [1, 'resolved', 'r1'],
      [2, 'resolved', 'r2'],
      [3, 'resolved', 'r3'],
      [4, 'resolved', 'r4'],
      [5, 'out-of-range', undefined],
    ]);
  });

  it('no bibliography present → every index ≥ 1 surfaces as out-of-range', () => {
    const doc = makeDoc([makeBlock('[1] [2]')], []);
    const map = buildNumericIndexMap(doc);
    expect(map.citations[0]!.tokens[0]!.status).toBe('out-of-range');
    expect(map.citations[1]!.tokens[0]!.status).toBe('out-of-range');
    expect(map.citations[0]!.tokens[0]!.resolvedEntryId).toBeUndefined();
  });

  it('author-date citations never appear in the map', () => {
    const entries = [makeEntry('r1')];
    const authorDate: CitationOccurrence = {
      id: 'c9',
      raw: '(Smith, 2024)',
      family: 'author-date',
      items: [{ firstAuthor: 'Smith', year: 2024 }],
      source: { blockId: 'b1', startOffset: 0, endOffset: 13 },
      confidence: 0.9,
    };
    const doc = makeDoc([makeBlock('[1]')], entries, [authorDate]);
    const map = buildNumericIndexMap(doc);
    expect(map.citations.map((c) => c.citationId)).toEqual(['c0']);
  });
});

// ---------------------------------------------------------------------------
// 3) Fallback completeness + source fidelity.
// ---------------------------------------------------------------------------

describe('numeric index mapping — fallback & source fidelity', () => {
  it('citation whose block is missing still maps (numbers fallback, never dropped)', () => {
    const entries = [makeEntry('r1'), makeEntry('r2')];
    const orphan: CitationOccurrence = {
      id: 'c7',
      raw: '[1,2]',
      family: 'numeric',
      items: [{ numbers: [1, 2] }],
      source: { blockId: 'missing-block', startOffset: 0, endOffset: 5 },
      confidence: 0.97,
    };
    const doc = makeDoc([makeBlock('[1]')], entries, [orphan]);
    const map = buildNumericIndexMap(doc);
    expect(map.citations.map((c) => c.citationId)).toEqual(['c0', 'c7']);
    // Fallback rows use the citation's bracket-level source.
    expect(map.citations[1]!.tokens).toEqual([
      { index: 1, resolvedEntryId: 'r1', status: 'resolved', source: { blockId: 'missing-block', startOffset: 0, endOffset: 5 } },
      { index: 2, resolvedEntryId: 'r2', status: 'resolved', source: { blockId: 'missing-block', startOffset: 0, endOffset: 5 } },
    ]);
  });

  it('token sources carry the block paragraphIndex (R009)', () => {
    const entries = [makeEntry('r1')];
    const doc = makeDoc([makeBlock('[1]', 'b1', 3)], entries);
    const map = buildNumericIndexMap(doc);
    expect(map.citations[0]!.tokens[0]!.source).toEqual({
      blockId: 'b1',
      paragraphIndex: 3,
      startOffset: 1,
      endOffset: 2,
    });
  });
});

// ---------------------------------------------------------------------------
// 4) Determinism (R008): pure function of the doc, byte-identical re-run.
// ---------------------------------------------------------------------------

describe('numeric index mapping — determinism (R008)', () => {
  it('re-running on the same doc yields a byte-identical map', () => {
    const entries = [
      makeEntry('r1'),
      makeEntry('r2'),
      makeEntry('r3'),
      makeEntry('r4'),
    ];
    const doc = makeDoc(
      [makeBlock('[1,2] note [3-4] [5] [0]')],
      entries,
    );
    const first = buildNumericIndexMap(doc);
    const second = buildNumericIndexMap(doc);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('no numeric citations → empty map (still deterministic)', () => {
    const doc: AcademicDocument = {
      metadata: {},
      blocks: [makeBlock('plain prose, no brackets')],
      citations: [],
      sourceMap: { version: 1, blocks: {} },
    };
    const map = buildNumericIndexMap(doc);
    expect(map).toEqual<NumericIndexMap>({ version: 1, citations: [] });
  });
});
