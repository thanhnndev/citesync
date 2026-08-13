/**
 * M002-S01-T4 — numeric fixture corpus: golden, determinism + integration
 * tests through the PUBLIC `parseDocument` entry (D016, R008).
 *
 * Asserts the committed `fixtures/numeric/*` corpus (authored by
 * `scripts/make-fixtures.ts` — byte-stable) end to end:
 *
 *   - every numeric fixture parses into typed family:'numeric' citations
 *     (NumericCitationItem { numbers }) plus a `doc.numericIndexMap` whose
 *     per-index token bindings deep-equal the KNOWN_NUMERIC_INDEX_MAP ground
 *     truth in `scripts/fixture-ground-truth-numeric.ts` (resolved ->
 *     entries[index-1] by ORDERED INDEX / out-of-range / unmatched — the
 *     conservative D016 surface, never silently guessed);
 *   - byte-identical determinism (R008): re-parsing any numeric fixture
 *     twice yields deep-equal documents AND byte-identical JSON, including
 *     `numericIndexMap` and the whole `citations` stream;
 *   - a committed golden anchor `tests/golden/numeric-basic.golden.json`
 *     locks the full `numeric/basic.docx` shape (citations + entries +
 *     numericIndexMap + matchMap) against any model-shape drift;
 *   - the malformed `[1, x]` bracket is NEVER half-emitted (R007): only the
 *     clean `[3]` appears in the citations stream and index map.
 *
 * Fixtures are git-tracked committed files read via node:fs (never .gsd/ or
 * any gitignored path). Ground truth is byte-stable (R008): any change to
 * fixture bytes, the model shape, the grammar or the mapping pass drifts the
 * tables below and fails.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { AcademicDocument } from '@citesync/document-model';

import { parseDocument } from '../src/index.js';
import { KNOWN_NUMERIC_INDEX_MAP } from '../../../scripts/fixture-ground-truth-numeric.js';

const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
const GOLDEN_DIR = fileURLToPath(new URL('./golden/', import.meta.url));

/** The committed numeric corpus (mirrors scripts/make-fixtures.ts). */
const NUMERIC_FIXTURES = [
  'numeric/basic.docx',
  'numeric/ranges.docx',
  'numeric/multiple-brackets.docx',
  'numeric/out-of-range.docx',
  'numeric/malformed.docx',
];

/** One numeric fixture's expected map row count (numeric citations only). */
const EXPECTED_NUMERIC_ROWS: Record<string, number> = {
  'numeric/basic.docx': 2,
  'numeric/ranges.docx': 2,
  'numeric/multiple-brackets.docx': 3,
  'numeric/out-of-range.docx': 3,
  'numeric/malformed.docx': 1,
};

// ---------------------------------------------------------------------------
// Projection: the ground-truth table is the projected shape.
// ---------------------------------------------------------------------------

function projectMap(doc: AcademicDocument) {
  return {
    version: doc.numericIndexMap!.version,
    citations: doc.numericIndexMap!.citations.map((row) => ({
      citationId: row.citationId,
      tokens: row.tokens.map((t) => ({
        index: t.index,
        status: t.status,
        ...(t.resolvedEntryId !== undefined ? { resolvedEntryId: t.resolvedEntryId } : {}),
      })),
    })),
  };
}

describe('M002-S01-T4 — KNOWN_NUMERIC_INDEX_MAP ground truth (per fixture)', () => {
  it('produces exactly the documented D016 index bindings for every numeric fixture', () => {
    for (const rel of Object.keys(KNOWN_NUMERIC_INDEX_MAP)) {
      const doc = parseDocument(readFileSync(join(FIXTURES_DIR, rel)));
      expect(doc.numericIndexMap, `${rel} numericIndexMap present`).toBeDefined();
      expect(projectMap(doc), `${rel} numeric index map`).toEqual(
        KNOWN_NUMERIC_INDEX_MAP[rel],
      );
    }
  });

  it('keeps one map row per numeric citation, in document order (join by citationId)', () => {
    for (const rel of NUMERIC_FIXTURES) {
      const doc = parseDocument(readFileSync(join(FIXTURES_DIR, rel)));
      const numeric = doc.citations.filter((c) => c.family === 'numeric');
      expect(numeric.length, rel).toBe(EXPECTED_NUMERIC_ROWS[rel]);
      // Map rows mirror the numeric subset of doc.citations 1:1, in order.
      expect(doc.numericIndexMap!.citations.map((r) => r.citationId), rel).toEqual(
        numeric.map((c) => c.id),
      );
      // Join back: every token's source block exists in doc.blocks.
      const byId = new Map(doc.blocks.map((b) => [b.id, b]));
      for (const row of doc.numericIndexMap!.citations) {
        for (const t of row.tokens) {
          expect(byId.get(t.source.blockId), `${rel} ${row.citationId} token source block`).toBeDefined();
          // R009 anchor semantics: a single index anchors to its exact digit
          // text ("1"); a range-EXPANDED token anchors to the WHOLE range
          // segment ("1-4") whose bounds must span the index value (T3
          // documented behavior — ranges are expanded per index, all anchored
          // to the same source segment).
          const text = byId.get(t.source.blockId)!.text;
          const seg = text.slice(t.source.startOffset, t.source.endOffset);
          const range = /^(\d+)-(\d+)$/.exec(seg);
          if (range !== null) {
            expect(Number(range[1]!), `${rel} ${row.citationId} range lower`).toBeLessThanOrEqual(t.index);
            expect(Number(range[2]!), `${rel} ${row.citationId} range upper`).toBeGreaterThanOrEqual(t.index);
          } else {
            expect(seg, `${rel} ${row.citationId} token slice`).toBe(String(t.index));
          }
        }
      }
    }
  });

  it('surfaces every signal class exactly once across the corpus (integration probe)', () => {
    const doc = parseDocument(readFileSync(join(FIXTURES_DIR, 'numeric/out-of-range.docx')));
    const rows = doc.numericIndexMap!.citations;
    const signals = rows.flatMap((r) => r.tokens.map((t) => `${t.index}:${t.status}`));
    // The out-of-range fixture exercises resolved + out-of-range + unmatched
    // in ONE document: [1]->resolved, [5]->out-of-range, [0]->unmatched.
    expect(signals).toEqual(['1:resolved', '5:out-of-range', '0:unmatched']);
    expect(rows[0]!.tokens[0]!.resolvedEntryId).toBe('r0');
    expect(rows[1]!.tokens[0]!.resolvedEntryId).toBeUndefined();
    expect(rows[2]!.tokens[0]!.resolvedEntryId).toBeUndefined();
  });
});

describe('M002-S01-T4 — typed numeric citations through the public API', () => {
  it('emits family numeric citations with NumericCitationItem { numbers } per fixture', () => {
    const expected: Record<string, Array<{ raw: string; numbers: number[] }>> = {
      'numeric/basic.docx': [
        { raw: '[1]', numbers: [1] },
        { raw: '[1,2]', numbers: [1, 2] },
      ],
      'numeric/ranges.docx': [
        { raw: '[1-4]', numbers: [1, 2, 3, 4] },
        { raw: '[1,2,4-5]', numbers: [1, 2, 4, 5] },
      ],
      'numeric/multiple-brackets.docx': [
        { raw: '[1]', numbers: [1] },
        { raw: '[2,3]', numbers: [2, 3] },
        { raw: '[4]', numbers: [4] },
      ],
      'numeric/out-of-range.docx': [
        { raw: '[1]', numbers: [1] },
        { raw: '[5]', numbers: [5] },
        { raw: '[0]', numbers: [0] },
      ],
      'numeric/malformed.docx': [{ raw: '[3]', numbers: [3] }],
    };
    for (const rel of NUMERIC_FIXTURES) {
      const doc = parseDocument(readFileSync(join(FIXTURES_DIR, rel)));
      const numeric = doc.citations.filter((c) => c.family === 'numeric');
      expect(
        numeric.map((c) => ({ raw: c.raw, numbers: (c.items[0] as { numbers: number[] }).numbers })),
        rel,
      ).toEqual(expected[rel]);
    }
  });

  it('never half-emits the malformed [1, x] bracket (R007)', () => {
    const doc = parseDocument(readFileSync(join(FIXTURES_DIR, 'numeric/malformed.docx')));
    // Only the clean [3] plus the entry tails — the malformed bracket stays a
    // CS007 invalid-numeric surface for S2, never a (half) citation.
    expect(doc.citations.map((c) => c.raw)).toEqual([
      '[3]',
      'Doe, J. (2017)',
      'Roe, M. (2018)',
      'Lee, K. (2019)',
    ]);
    expect(doc.numericIndexMap!.citations).toHaveLength(1);
    expect(doc.numericIndexMap!.citations[0]!.tokens).toMatchObject([
      { index: 3, status: 'resolved', resolvedEntryId: 'r2' },
    ]);
  });

  it('keeps numeric + author-date families coexisting without region collision', () => {
    for (const rel of NUMERIC_FIXTURES) {
      const doc = parseDocument(readFileSync(join(FIXTURES_DIR, rel)));
      // Both families present: body brackets numeric, entry tails author-date.
      expect(doc.citations.some((c) => c.family === 'numeric'), rel).toBe(true);
      expect(doc.citations.some((c) => c.family === 'author-date'), rel).toBe(true);
      // No two occurrences overlap inside the same block (regions distinct, §20).
      for (let i = 0; i < doc.citations.length; i++) {
        for (let j = i + 1; j < doc.citations.length; j++) {
          const a = doc.citations[i]!.source;
          const b = doc.citations[j]!.source;
          if (a.blockId !== b.blockId) continue;
          expect(
            a.startOffset! >= b.endOffset! || b.startOffset! >= a.endOffset!,
            `${rel} overlap ${doc.citations[i]!.id}/${doc.citations[j]!.id}`,
          ).toBe(true);
        }
      }
    }
  });
});

describe('M002-S01-T4 — determinism (R008): byte-identical re-run', () => {
  it('re-parses every numeric fixture into deep-equal documents + byte-identical JSON', () => {
    for (const rel of NUMERIC_FIXTURES) {
      const bytes = readFileSync(join(FIXTURES_DIR, rel));
      const a = parseDocument(bytes);
      const b = parseDocument(bytes);
      expect(b, rel).toEqual(a);
      expect(JSON.stringify(b), rel).toBe(JSON.stringify(a));
      // The map and the merged citation stream are byte-stable on their own.
      expect(JSON.stringify(b.numericIndexMap), rel).toBe(JSON.stringify(a.numericIndexMap));
      expect(JSON.stringify(b.citations), rel).toBe(JSON.stringify(a.citations));
    }
  });

  it('keeps numeric citation ids contiguous c0..cN in document order (R008)', () => {
    for (const rel of NUMERIC_FIXTURES) {
      const doc = parseDocument(readFileSync(join(FIXTURES_DIR, rel)));
      expect(doc.citations.map((c) => c.id), rel).toEqual(
        doc.citations.map((_, i) => `c${i}`),
      );
    }
  });
});

describe('M002-S01-T4 — committed golden anchor', () => {
  it('locks the numeric/basic.docx shape against tests/golden/numeric-basic.golden.json', () => {
    const bytes = readFileSync(join(FIXTURES_DIR, 'numeric/basic.docx'));
    const golden = JSON.parse(
      readFileSync(join(GOLDEN_DIR, 'numeric-basic.golden.json'), 'utf8'),
    );
    // Serialize through JSON the same way the golden was authored so optional
    // (undefined) fields drop identically on both sides.
    const fresh = JSON.parse(JSON.stringify(parseDocument(bytes)));
    expect(fresh).toEqual(golden);
  });

  it('golden anchor carries the hand-known numeric structure (sanity + drift guard)', () => {
    const golden = JSON.parse(
      readFileSync(join(GOLDEN_DIR, 'numeric-basic.golden.json'), 'utf8'),
    ) as {
      citations: Array<{ id: string; raw: string; family: string; items: Array<{ numbers?: number[] }> }>;
      bibliography?: { outcome: string; entries: Array<{ id: string }> };
      numericIndexMap?: { version: number; citations: Array<{ citationId: string; tokens: Array<{ index: number; status: string; resolvedEntryId?: string }> }> };
    };

    expect(golden.citations.map((c) => c.raw)).toEqual([
      '[1]', '[1,2]', 'Doe, J. (2017)', 'Roe, M. (2018)', 'Lee, K. (2019)',
    ]);
    expect(golden.citations.filter((c) => c.family === 'numeric').map((c) => c.items[0]!.numbers)).toEqual([
      [1], [1, 2],
    ]);
    expect(golden.bibliography?.outcome).toBe('detected');
    expect(golden.bibliography!.entries.map((e) => e.id)).toEqual(['r0', 'r1', 'r2']);
    // The D016 map binds [1] -> r0 and [1,2] -> r0,r1 by ordered index.
    // (source is stripped — the full token shape is asserted via the deep
    // golden lock above.)
    expect(golden.numericIndexMap?.version).toBe(1);
    expect(
      golden.numericIndexMap!.citations.map((row) => ({
        citationId: row.citationId,
        tokens: row.tokens.map((t) => ({
          index: t.index,
          status: t.status,
          ...(t.resolvedEntryId !== undefined ? { resolvedEntryId: t.resolvedEntryId } : {}),
        })),
      })),
    ).toEqual([
      { citationId: 'c0', tokens: [{ index: 1, status: 'resolved', resolvedEntryId: 'r0' }] },
      { citationId: 'c1', tokens: [{ index: 1, status: 'resolved', resolvedEntryId: 'r0' }, { index: 2, status: 'resolved', resolvedEntryId: 'r1' }] },
    ]);
  });
});
