/**
 * M002-S01-T3 — numeric extraction + mapping pipeline wiring (D016, R008).
 *
 * Proves the T3 done-when contract through the PUBLIC surfaces:
 *   - `extractCitations` (S03) now emits the bracketed numeric family
 *     (family:'numeric', NumericCitationItem { numbers }) alongside the
 *     author-date stream, merged in offset order with CONTIGUOUS ids c0..cN
 *     in document order; a numeric bracket never double-claims a region
 *     owned by a structured or author-date occurrence (regions distinct,
 *     §20) and a malformed bracket like `[1, x]` is never half-emitted
 *     (invalid-numeric surface belongs to CS007 in S2);
 *   - `buildModel` wires `doc.numericIndexMap = buildNumericIndexMap(doc)`
 *     as a LATER build step — only when the doc carries numeric citations
 *     (M001 additive pattern, D013) — binding each bracket index value to
 *     `entries[index-1]` with resolved/out-of-range/unmatched surfaced
 *     explicitly (D016, §79: never silently guessed);
 *   - determinism (R008): same bytes → byte-identical map and document.
 *
 * End-to-end proof uses a hand-built `ZipParts` map through the public
 * `buildModel` (a real numeric body + a detected References section with 4
 * entries), plus the committed `documents/docx/plain-text.docx` fixture via
 * `parseDocument` for the no-bibliography conservative path. No gitignored
 * paths — everything is inline strings or committed fixtures.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type {
  AcademicDocument,
  DocumentBlock,
} from '@citesync/document-model';

import { buildModel, extractCitations, parseDocument } from '../src/index.js';
import type { ZipParts } from '../src/index.js';

const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/', import.meta.url));

// ---------------------------------------------------------------------------
// Inline document builders.
// ---------------------------------------------------------------------------

function inlineDoc(blocks: DocumentBlock[]): AcademicDocument {
  return {
    metadata: {},
    blocks,
    citations: [],
    sourceMap: { version: 1, blocks: {} },
  };
}

function block(id: string, text: string, paragraphIndex = 0): DocumentBlock {
  return {
    id,
    type: 'paragraph',
    text,
    source: { blockId: id, paragraphIndex, startOffset: 0, endOffset: text.length },
  };
}

// ---------------------------------------------------------------------------
// Hand-built OOXML parts for the buildModel end-to-end proof (mirrors the
// fixture-authoring templates — authoring never depends on the reader).
// ---------------------------------------------------------------------------

const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const enc = new TextEncoder();
const u8 = (s: string): Uint8Array => enc.encode(s);

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function paragraphXml(text: string, style?: string): string {
  const ppr = style !== undefined ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
  return `<w:p>${ppr}<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
}

function documentXml(body: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    `<w:document xmlns:w="${NS_W}">`,
    '<w:body>',
    body,
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>',
    '</w:body>',
    '</w:document>',
  ].join('\n');
}

function stylesXml(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    `<w:styles xmlns:w="${NS_W}">`,
    '  <w:style w:type="paragraph" w:styleId="Heading1">',
    '    <w:name w:val="heading 1"/>',
    '    <w:pPr><w:outlineLvl w:val="0"/></w:pPr>',
    '  </w:style>',
    '</w:styles>',
  ].join('\n');
}

function partsOf(paragraphs: Array<{ text: string; style?: string }>): ZipParts {
  const body = paragraphs
    .map((p) => paragraphXml(p.text, p.style))
    .join('');
  const parts: ZipParts = new Map();
  parts.set('word/document.xml', u8(documentXml(body)));
  parts.set('word/styles.xml', u8(stylesXml()));
  return parts;
}

/**
 * The T3 end-to-end numeric document: body numeric brackets ([1], [1,2],
 * [1-4], [5] out-of-range, [0] unmatched) + one author-date citation +
 * a detected References section with FOUR entries (r0..r3) so every
 * in-range index resolves by ORDERED INDEX to `entries[index-1]`.
 */
function numericParts(): ZipParts {
  return partsOf([
    { text: 'See [1], [1,2] and [1-4] for the claims.' },
    { text: 'An author-date (Smith, 2024) sits beside an out-of-range [5] and an unmatched [0].' },
    { text: 'References', style: 'Heading1' },
    { text: 'Doe, J. (2017). Citation practice.' },
    { text: 'Roe, M. (2018). Evidence synthesis.' },
    { text: 'Lee, K. (2019). Methodological notes.' },
    { text: 'Tran, B. (2020). Case studies.' },
  ]);
}

/** A numeric-free document (only an author-date narrative citation). */
function minimalParts(): ZipParts {
  return partsOf([{ text: 'Smith (2024) proposed a theory.' }]);
}

// ---------------------------------------------------------------------------
// T3 tests.
// ---------------------------------------------------------------------------

describe('M002-S01-T3 — extractCitations numeric wiring (S03 merge)', () => {
  it('merges numeric + author-date in document order with contiguous ids and distinct regions', () => {
    const doc = inlineDoc([
      block('doc-p0', 'Mixed: [1] and (Smith, 2024) together.'),
      block(
        'doc-p1',
        'Two adjacent [2][3] and prose [Figure 2] is ignored; malformed [1, x] never half-emits.',
      ),
      block('doc-p2', ''),
    ]);
    const occs = extractCitations(doc);
    // Contiguous ids in document order (R008) across both families.
    expect(occs.map((o) => o.id)).toEqual(['c0', 'c1', 'c2', 'c3']);
    expect(occs.map((o) => o.family)).toEqual([
      'numeric', 'author-date', 'numeric', 'numeric',
    ]);
    expect(occs.map((o) => o.raw)).toEqual(['[1]', '(Smith, 2024)', '[2]', '[3]']);
    expect(occs[0]!.items).toEqual([{ numbers: [1] }]);
    expect(occs[2]!.items).toEqual([{ numbers: [2] }]);
    expect(occs[3]!.items).toEqual([{ numbers: [3] }]);

    // Region distinctness: within a block, no two occurrences share an
    // overlapping span (a numeric bracket never collides with an author-date
    // occurrence — regions distinct, §20). Blocks are compared independently.
    for (let i = 0; i < occs.length; i++) {
      for (let j = i + 1; j < occs.length; j++) {
        const a = occs[i]!.source;
        const b = occs[j]!.source;
        if (a.blockId !== b.blockId) continue;
        expect(
          a.startOffset! >= b.endOffset! || b.startOffset! >= a.endOffset!,
          `overlap between ${occs[i]!.id} and ${occs[j]!.id}`, 
        ).toBe(true);
      }
    }

    // R009 round-trip of every occurrence raw region.
    const byId = new Map(doc.blocks.map((b) => [b.id, b]));
    for (const o of occs) {
      expect(
        byId.get(o.source.blockId)!.text.slice(o.source.startOffset!, o.source.endOffset!),
      ).toBe(o.raw);
    }
  });

  it('never half-emits a malformed bracket ([1, x] stays out of the stream)', () => {
    const doc = inlineDoc([
      block('doc-p0', 'A clean [3] and a malformed [1, x] in the same block.'),
    ]);
    const occs = extractCitations(doc);
    // Only the clean bracket is emitted — [1, x] is a CS007 invalid-numeric
    // surface, never a (half) citation (R007).
    expect(occs).toHaveLength(1);
    expect(occs[0]!.raw).toBe('[3]');
    expect(occs[0]!.family).toBe('numeric');
  });

  it('structured display region subsumes an overlapping numeric bracket (priority)', () => {
    // A Zotero field whose DISPLAY "(2020) [1]" covers both the parenthetical
    // AND the bracket: the structured identity owns the whole display region,
    // so the numeric bracket inside it is conservatively dropped — the same
    // text is never double-claimed by two families (regions distinct, §20;
    // priority structured > author-date > numeric is deterministic).
    const zotero =
      'ADDIN ZOTERO_ITEM CSL_CITATION {"citationItems":[{"id":1,"itemData":{"id":1,"type":"article-journal","title":"T","author":[{"family":"Nguyen","given":"A."}],"issued":{"date-parts":[[2020,1,1]]}}}],"properties":{"formattedCitation":"(2020) [1]"},"schema":"https://github.com/citation-style-language/schema/raw/master/csl-citation.json"}';
    const doc = inlineDoc([
      {
        id: 'doc-p0',
        type: 'paragraph',
        text: 'See (2020) [1] for details.',
        source: { blockId: 'doc-p0', paragraphIndex: 0, startOffset: 0, endOffset: 30 },
        fields: [zotero],
      },
    ]);
    const occs = extractCitations(doc);
    expect(occs).toHaveLength(1);
    expect(occs[0]!.raw).toBe('(2020) [1]');
    expect(occs[0]!.family).toBe('author-date');
    expect(occs[0]!.source.startOffset).toBe(4);
    expect(occs[0]!.source.endOffset).toBe(14);
  });

  it('structured + numeric coexist when their regions are distinct (no double-claim)', () => {
    // When the bracket sits OUTSIDE the structured display's paren region,
    // both families are kept — the numeric bracket is a separate region.
    const zotero =
      'ADDIN ZOTERO_ITEM CSL_CITATION {"citationItems":[{"id":1,"itemData":{"id":1,"type":"article-journal","title":"T","author":[{"family":"Nguyen","given":"A."}],"issued":{"date-parts":[[2020,1,1]]}}}],"properties":{"formattedCitation":"(Nguyen, 2020) [1]"},"schema":"https://github.com/citation-style-language/schema/raw/master/csl-citation.json"}';
    const doc = inlineDoc([
      {
        id: 'doc-p0',
        type: 'paragraph',
        text: 'See (Nguyen, 2020) [1] for details.',
        source: { blockId: 'doc-p0', paragraphIndex: 0, startOffset: 0, endOffset: 30 },
        fields: [zotero],
      },
    ]);
    const occs = extractCitations(doc);
    expect(occs).toHaveLength(2);
    expect(occs[0]!.raw).toBe('(Nguyen, 2020)');
    expect(occs[0]!.family).toBe('author-date');
    expect(occs[0]!.confidence).toBeGreaterThanOrEqual(0.9); // structured tier
    expect(occs[1]!.raw).toBe('[1]');
    expect(occs[1]!.family).toBe('numeric');
    expect(occs[1]!.source.startOffset!).toBeGreaterThanOrEqual(
      occs[0]!.source.endOffset!,
    );
  });
});

describe('M002-S01-T3 — buildModel numericIndexMap wiring (D013 additive)', () => {
  it('builds numeric citations + numericIndexMap end-to-end through buildModel', () => {
    const doc = buildModel(numericParts());
    const numeric = doc.citations.filter((c) => c.family === 'numeric');
    const authorDate = doc.citations.filter((c) => c.family === 'author-date');

    // Both families coexist; ids contiguous c0..cN in document order (R008).
    expect(doc.citations.map((c) => c.id)).toEqual(
      doc.citations.map((_, i) => `c${i}`),
    );
    expect(numeric.map((c) => c.raw)).toEqual(['[1]', '[1,2]', '[1-4]', '[5]', '[0]']);
    expect(numeric.map((c) => c.items[0]!)).toEqual([
      { numbers: [1] },
      { numbers: [1, 2] },
      { numbers: [1, 2, 3, 4] },
      { numbers: [5] },
      { numbers: [0] },
    ]);
    expect(authorDate.map((c) => c.raw)).toContain('(Smith, 2024)');

    // The bibliography is detected with FOUR entries (r0..r3).
    expect(doc.bibliography?.outcome).toBe('detected');
    expect(doc.bibliography!.entries).toHaveLength(4);

    // numericIndexMap: one row per numeric citation, in document order.
    const map = doc.numericIndexMap;
    expect(map).toBeDefined();
    expect(map!.version).toBe(1);
    expect(map!.citations.map((r) => r.citationId)).toEqual(
      numeric.map((c) => c.id),
    );

    const tokens = (citationId: string) =>
      map!.citations.find((r) => r.citationId === citationId)!.tokens;

    // [1] → entries[0] = r0 (resolved by ordered index, never scored).
    expect(tokens('c0').map((t) => ({ index: t.index, status: t.status, id: t.resolvedEntryId }))).toEqual([
      { index: 1, status: 'resolved', id: 'r0' },
    ]);
    // [1,2] → r0, r1.
    expect(tokens('c1').map((t) => ({ index: t.index, status: t.status, id: t.resolvedEntryId }))).toEqual([
      { index: 1, status: 'resolved', id: 'r0' },
      { index: 2, status: 'resolved', id: 'r1' },
    ]);
    // [1-4] → range EXPANDED: one binding per index value (D016), all resolved.
    expect(tokens('c2').map((t) => ({ index: t.index, status: t.status, id: t.resolvedEntryId }))).toEqual([
      { index: 1, status: 'resolved', id: 'r0' },
      { index: 2, status: 'resolved', id: 'r1' },
      { index: 3, status: 'resolved', id: 'r2' },
      { index: 4, status: 'resolved', id: 'r3' },
    ]);
    // [5] → out-of-range (index > entries.length) — surfaced, never dropped.
    // Note: the numeric ids here are c0,c1,c2,c4,c5 — c3 is the author-date
    // "(Smith, 2024)" that sits between the body brackets in document order.
    expect(tokens('c4').map((t) => ({ index: t.index, status: t.status }))).toEqual([
      { index: 5, status: 'out-of-range' },
    ]);
    // [0] → unmatched (index < 1, not a valid 1-based position) — surfaced.
    expect(tokens('c5').map((t) => ({ index: t.index, status: t.status }))).toEqual([
      { index: 0, status: 'unmatched' },
    ]);

    // R009: every token's source round-trips inside its block text.
    const byId = new Map(doc.blocks.map((b) => [b.id, b]));
    const slice = (t: ReturnType<typeof tokens>[number]): string =>
      byId.get(t.source.blockId)!.text.slice(t.source.startOffset!, t.source.endOffset!);
    expect(tokens('c0').map(slice)).toEqual(['1']);
    expect(tokens('c1').map(slice)).toEqual(['1', '2']);
    // Range tokens all anchor to the SAME source segment "1-4".
    expect(tokens('c2').map(slice)).toEqual(['1-4', '1-4', '1-4', '1-4']);
    expect(tokens('c4').map(slice)).toEqual(['5']);
    expect(tokens('c5').map(slice)).toEqual(['0']);
  });

  it('keeps numericIndexMap undefined when no numeric citations exist (D013 additive)', () => {
    const doc = buildModel(minimalParts());
    expect(doc.citations).toHaveLength(1);
    expect(doc.citations[0]!.family).toBe('author-date');
    expect(doc.numericIndexMap).toBeUndefined();
  });

  it('leaves the S04 matchMap intact for numeric-only occurrences (no silent guess)', () => {
    const doc = buildModel(numericParts());
    expect(doc.matchMap).toBeDefined();
    // Every numeric citation has no scoreable author-date item → the §79
    // no-silent-guess row: MISSING_REFERENCE, no target.
    const numericRows = doc.matchMap!.citations.filter((r) => {
      const occ = doc.citations.find((c) => c.id === r.citationId);
      return occ !== undefined && occ.family === 'numeric';
    });
    expect(numericRows).toHaveLength(5);
    for (const r of numericRows) {
      expect(r.relationship).toBe('MISSING_REFERENCE');
      expect(r.reasons).toEqual(['no-entry']);
    }
  });

  it('is deterministic: the numeric doc re-parses byte-identically (R008)', () => {
    const a = buildModel(numericParts());
    const b = buildModel(numericParts());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a.numericIndexMap)).toBe(JSON.stringify(b.numericIndexMap));
  });
});

describe('M002-S01-T3 — public parseDocument on a committed numeric-bearing fixture', () => {
  it('yields a family numeric citation + numericIndexMap with out-of-range (no bibliography)', () => {
    // documents/docx/plain-text.docx carries "[1]" in its body and NO
    // bibliography: the bracket parses as numeric; with zero entries every
    // index surfaces 'out-of-range' (conservative, D016 — never guessed).
    const doc = parseDocument(
      readFileSync(join(FIXTURES_DIR, 'documents/docx/plain-text.docx')),
    );
    const numeric = doc.citations.filter((c) => c.family === 'numeric');
    expect(numeric).toHaveLength(1);
    expect(numeric[0]!.raw).toBe('[1]');
    expect(numeric[0]!.items).toEqual([{ numbers: [1] }]);
    expect(numeric[0]!.source).toMatchObject({ blockId: 'doc-p1', startOffset: 9, endOffset: 12 });

    const map = doc.numericIndexMap;
    expect(map).toBeDefined();
    expect(map!.version).toBe(1);
    expect(map!.citations).toHaveLength(1);
    expect(map!.citations[0]!.citationId).toBe(numeric[0]!.id);
    expect(map!.citations[0]!.tokens).toMatchObject([
      { index: 1, status: 'out-of-range' },
    ]);
    // The author-date stream still coexists without region collision.
    expect(doc.citations.some((c) => c.family === 'author-date' && c.raw === '(Johnson 2018)')).toBe(true);
  });
});
