/**
 * S03-T04 — structured citation fields proof (R005/§22, tier 1/2 identity
 * backbone).
 *
 * Locks the exact done-when contract: a Zotero `ADDIN ZOTERO_ITEM
 * CSL_CITATION <json>` marker and a Word `CITATION <key> \l <lang>` code are
 * parsed into a structured identity, keyed to the field's display region in
 * `block.text`, with deterministic ids (R008) and offsets that round-trip
 * exactly (R009).
 *
 * Key assertions:
 *   - Zotero identity authors come from `itemData.author[]` (Nguyen H.,
 *     Tran L.) — NOT the display's abbreviated "et al." list;
 *   - display region offsets point at the cached field result in `block.text`
 *     (raw round-trips), incl. narrative and whitespace-differing displays;
 *   - year precedence: `itemData.issued` > display text; year-suffixes
 *     (2021a) parsed from the display;
 *   - Word key → year heuristic (2-digit tail → 20xx/19xx, embedded 4-digit
 *     wins); a Word code with no derivable year is recorded (0.6) but never
 *     emitted — plain-text fallback (§88);
 *   - structured tier confidence never lowers an occurrence (max with the
 *     plain-text equivalent);
 *   - never throws: malformed CSL JSON, unknown markers, unalignable codes.
 *
 * Negative coverage (Q7): malformed JSON, empty/non-citation markers,
 * non-string input, unparseable Word codes, no-match Word keys, fields
 * without alignable display regions, blocks without fields.
 */

import { describe, expect, it } from 'vitest';

import type { DocumentBlock } from '@citesync/document-model';

import {
  detectStructuredCitationsInBlock,
  parseStructuredField,
  structuredFieldConfidence,
} from '../src/citations/fields.js';

// ---------------------------------------------------------------------------
// Test helpers + inline fixtures.
// ---------------------------------------------------------------------------

/** The et-al fixture's exact Zotero CSL_CITATION marker (mirrors make-fixtures). */
const ZOTERO_NGUYEN2019 =
  'ADDIN ZOTERO_ITEM CSL_CITATION {"citationItems":[{"id":7,"itemData":{"id":7,"type":"article-journal","title":"Field persistence in extracted documents","author":[{"family":"Nguyen","given":"H."},{"family":"Tran","given":"L."}]}}],"properties":{"noteIndex":0,"formattedCitation":"(Nguyen et al., 2019)"},"schema":"https://github.com/citation-style-language/schema/raw/master/csl-citation.json"}';

/** A minimal synthetic block (unit-test inputs — only id/text/fields/source read). */
function block(text: string, fields?: string[], id = 'b1', paragraphIndex = 0): DocumentBlock {
  return {
    id,
    type: 'paragraph',
    text,
    source: { blockId: id, paragraphIndex },
    ...(fields !== undefined ? { fields } : {}),
  };
}

/** Detect structured citations in a bare text (single block). */
function occs(text: string, fields: string[]): ReturnType<typeof detectStructuredCitationsInBlock> {
  return detectStructuredCitationsInBlock(block(text, fields));
}

// ---------------------------------------------------------------------------
// 1) Zotero CSL_CITATION — identity backbone + display alignment.
// ---------------------------------------------------------------------------

describe('Zotero CSL_CITATION fields (§22 tier 1)', () => {
  it('identity authors from itemData, display region aligned, tier confidence 1', () => {
    const text = 'Recent work (Nguyen et al., 2019) demonstrated the effect.';
    const o = occs(text, [ZOTERO_NGUYEN2019]);
    expect(o).toHaveLength(1);
    const occ = o[0]!;
    expect(occ.id).toBe('c0');
    // Identity backbone: full CSL itemData authors — NOT the display's "et al."
    expect(occ.items).toEqual([
      { firstAuthor: 'Nguyen', authors: ['Nguyen H.', 'Tran L.'], year: 2019 },
    ]);
    expect(occ.identity.items[0]!.authors).toEqual([
      { family: 'Nguyen', given: 'H.' },
      { family: 'Tran', given: 'L.' },
    ]);
    // Display region points at the cached field result in block.text (R009).
    const start = text.indexOf('(Nguyen et al., 2019)');
    expect(occ.source).toMatchObject({ blockId: 'b1', paragraphIndex: 0 });
    expect(occ.source.startOffset).toBe(start);
    expect(occ.source.endOffset).toBe(start + '(Nguyen et al., 2019)'.length);
    expect(occ.raw).toBe('(Nguyen et al., 2019)');
    expect(text.slice(occ.source.startOffset!, occ.source.endOffset!)).toBe(occ.raw);
    // Structured tier ≥ plain equivalent (plain et-al = 0.9).
    expect(occ.confidence).toBe(1);
    expect(occ.identity.kind).toBe('zotero');
    expect(occ.identity.display).toBe('(Nguyen et al., 2019)');
  });

  it('itemData.issued (date-parts) year is authoritative over the display year', () => {
    const marker =
      'ADDIN ZOTERO_ITEM CSL_CITATION {"citationItems":[{"itemData":{"type":"article-journal","title":"T","issued":{"date-parts":[["2020"]]},"author":[{"family":"Doe","given":"J."}]}}],"properties":{"formattedCitation":"(Doe, 2019)"}}';
    const o = occs('(Doe, 2019)', [marker]);
    expect(o[0]!.items[0]).toMatchObject({
      firstAuthor: 'Doe',
      authors: ['Doe J.'],
      year: 2020, // issued wins over the display's 2019
    });
  });

  it('numeric date-parts ([[2020, 5, 1]]) and issued.raw both resolve', () => {
    const numeric =
      'ADDIN ZOTERO_ITEM CSL_CITATION {"citationItems":[{"itemData":{"issued":{"date-parts":[[2020,5,1]]},"author":[{"family":"A","given":"B."}]}}],"properties":{"formattedCitation":"(A, 2020)"}}';
    expect(parseStructuredField(numeric)!.items[0]!.year).toBe(2020);
    const raw =
      'ADDIN ZOTERO_ITEM CSL_CITATION {"citationItems":[{"itemData":{"issued":{"raw":"June 2019"},"author":[{"family":"A","given":"B."}]}}],"properties":{"formattedCitation":"(A, 2019)"}}';
    expect(parseStructuredField(raw)!.items[0]!.year).toBe(2019);
  });

  it('narrative display "Nguyen et al. (2019)" aligns via the plain occurrence', () => {
    const text = 'Nguyen et al. (2019) define the term formally.';
    const o = occs(text, [ZOTERO_NGUYEN2019]);
    expect(o).toHaveLength(1);
    const occ = o[0]!;
    // The display differs from the fixture's formattedCitation (comma form),
    // so alignment falls back to the family+year plain occurrence — whose
    // region covers the full narrative name + paren.
    expect(occ.raw).toBe('Nguyen et al. (2019)');
    expect(text.slice(occ.source.startOffset!, occ.source.endOffset!)).toBe(occ.raw);
    expect(occ.items[0]).toMatchObject({ firstAuthor: 'Nguyen', year: 2019 });
  });

  it('whitespace-differing display still aligns (regex search)', () => {
    const text = '(Nguyen  et al., 2019)'; // double space inside the paren
    const o = occs(text, [ZOTERO_NGUYEN2019]);
    expect(o).toHaveLength(1);
    expect(o[0]!.raw).toBe(text);
    expect(text.slice(o[0]!.source.startOffset!, o[0]!.source.endOffset!)).toBe(text);
  });

  it('year-suffix (2021a) parsed from the display', () => {
    const marker =
      'ADDIN ZOTERO_ITEM CSL_CITATION {"citationItems":[{"itemData":{"type":"article-journal","title":"T","author":[{"family":"Smith","given":"J."}]}}],"properties":{"formattedCitation":"(Smith, 2021a)"}}';
    const o = occs('(Smith, 2021a)', [marker]);
    expect(o[0]!.items[0]).toMatchObject({
      firstAuthor: 'Smith',
      authors: ['Smith J.'],
      year: 2021,
      yearSuffix: 'a',
    });
  });

  it('multi-item field → one §20 item per CSL citationItem', () => {
    const marker =
      'ADDIN ZOTERO_ITEM CSL_CITATION {"citationItems":[{"itemData":{"type":"article-journal","title":"A","author":[{"family":"Nguyen","given":"H."}]}},{"itemData":{"type":"book","title":"B","author":[{"family":"Tran","given":"L."}]}}],"properties":{"formattedCitation":"(Nguyen, 2019; Tran, 2020)"}}';
    const o = occs('(Nguyen, 2019; Tran, 2020)', [marker]);
    expect(o[0]!.items).toEqual([
      { firstAuthor: 'Nguyen', authors: ['Nguyen H.'], year: 2019 },
      { firstAuthor: 'Tran', authors: ['Tran L.'], year: 2020 },
    ]);
  });

  it('literal (corporate) author is carried as the name', () => {
    const marker =
      'ADDIN ZOTERO_ITEM CSL_CITATION {"citationItems":[{"itemData":{"type":"webpage","title":"WHO report","author":[{"literal":"World Health Organization"}]}}],"properties":{"formattedCitation":"(WHO, 2023)"}}';
    const id = parseStructuredField(marker)!;
    expect(id.items[0]!.authors).toEqual([{ literal: 'World Health Organization' }]);
    expect(id.items[0]!.year).toBe(2023);
    expect(id.confidence).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2) Word CITATION codes — key→year heuristic (tier 2, best-effort).
// ---------------------------------------------------------------------------

describe('Word CITATION codes (§22 tier 2)', () => {
  it('trailing 2-digit key year: (Smith, 2022) aligned + confidence maxed', () => {
    const text = 'Prior work (Smith, 2022) supports this claim.';
    const o = occs(text, ['CITATION Smith22 \\l 1033']);
    expect(o).toHaveLength(1);
    const occ = o[0]!;
    expect(occ.identity.kind).toBe('word');
    expect(occ.identity.items[0]!.year).toBe(2022);
    expect(occ.items[0]).toMatchObject({ firstAuthor: 'Smith', authors: ['Smith'], year: 2022 });
    expect(occ.raw).toBe('(Smith, 2022)');
    expect(text.slice(occ.source.startOffset!, occ.source.endOffset!)).toBe(occ.raw);
    // Plain "(Smith, 2022)" = 1.0 → occurrence stays 1.0 (field never lowers).
    expect(occ.identity.confidence).toBe(0.92);
    expect(occ.confidence).toBe(1);
  });

  it('embedded 4-digit year wins over the 2-digit tail', () => {
    const id = parseStructuredField('CITATION Smith2022 \\l 1033')!;
    expect(id.kind).toBe('word');
    expect(id.items[0]!.year).toBe(2022);
    const tail = parseStructuredField('CITATION Doe95 \\l 1033')!;
    expect(tail.items[0]!.year).toBe(1995); // 30–99 → 19xx
  });

  it('no derivable year → identity recorded (0.6), no occurrence emitted', () => {
    const id = parseStructuredField('CITATION Smith \\l 1033')!;
    expect(id.confidence).toBe(0.6);
    expect(id.items[0]!.year).toBeUndefined();
    // The display is visible text but the code carries no identity year —
    // the occurrence falls back to the plain-text pass (§88).
    expect(occs('(Smith, 2024)', ['CITATION Smith \\l 1033'])).toHaveLength(0);
  });

  it('key whose family guess does not match the display → no overlay', () => {
    // "Smi22" guesses family "Smi" — never aligned to "(Smith, 2022)".
    expect(occs('(Smith, 2022)', ['CITATION Smi22 \\l 1033'])).toHaveLength(0);
  });

  it('switches after the language id are tolerated', () => {
    const id = parseStructuredField('CITATION Nguyen22 \\l 1033 \\s')!;
    expect(id.items[0]!.year).toBe(2022);
  });
});

// ---------------------------------------------------------------------------
// 3) Multi-field blocks, ids, determinism.
// ---------------------------------------------------------------------------

describe('orchestration (ids, multi-field, determinism)', () => {
  it('two fields in one block → separate occurrences in field order, c0/c1', () => {
    const f2 =
      'ADDIN ZOTERO_ITEM CSL_CITATION {"citationItems":[{"itemData":{"type":"article-journal","title":"Later work","author":[{"family":"Tran","given":"L."}]}}],"properties":{"formattedCitation":"(Tran, 2020)"}}';
    const text = '(Nguyen et al., 2019) and (Tran, 2020) are both relevant.';
    const o = occs(text, [ZOTERO_NGUYEN2019, f2]);
    expect(o.map((c) => c.id)).toEqual(['c0', 'c1']);
    expect(o[0]!.items[0]).toMatchObject({ firstAuthor: 'Nguyen', year: 2019 });
    expect(o[1]!.items[0]).toMatchObject({ firstAuthor: 'Tran', year: 2020 });
  });

  it('startIndex shifts deterministic ids (R008)', () => {
    const o = detectStructuredCitationsInBlock(
      block('(Nguyen et al., 2019)', [ZOTERO_NGUYEN2019]),
      5,
    );
    expect(o[0]!.id).toBe('c5');
  });

  it('repeated runs are deep-equal (deterministic, R008)', () => {
    const b = block('(Nguyen et al., 2019)', [ZOTERO_NGUYEN2019]);
    expect(detectStructuredCitationsInBlock(b)).toEqual(detectStructuredCitationsInBlock(b));
  });

  it('blocks without fields emit nothing', () => {
    expect(detectStructuredCitationsInBlock(block('(Smith, 2024)'))).toHaveLength(0);
    expect(detectStructuredCitationsInBlock(block('(Smith, 2024)', []))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4) Negative surface (Q7) — never throws, isolated.
// ---------------------------------------------------------------------------

describe('negative surface (Q7)', () => {
  it('malformed CSL JSON → weak identity, no occurrence, no throw', () => {
    const marker = 'ADDIN ZOTERO_ITEM CSL_CITATION {not json';
    const id = parseStructuredField(marker);
    expect(id).not.toBeNull();
    expect(id!.kind).toBe('zotero');
    expect(id!.confidence).toBe(0.7);
    expect(id!.items).toEqual([]);
    expect(occs('(Nguyen et al., 2019)', [marker])).toHaveLength(0);
  });

  it('Zotero instruction without a JSON payload → weak identity', () => {
    const id = parseStructuredField('ADDIN ZOTERO_ITEM CSL_CITATION')!;
    expect(id.confidence).toBe(0.7);
    expect(id.items).toEqual([]);
  });

  it('unknown markers (HYPERLINK, REF, Mendeley) → null', () => {
    expect(parseStructuredField(' HYPERLINK "https://example.com" \\l _top ')).toBeNull();
    expect(parseStructuredField('REF _Ref123 \\h')).toBeNull();
    expect(parseStructuredField('ADDIN MENDELY_CITATION {"x":1}')).toBeNull();
    expect(parseStructuredField('')).toBeNull();
    expect(parseStructuredField('   ')).toBeNull();
  });

  it('non-string input → null (never throws)', () => {
    expect(parseStructuredField(undefined as unknown as string)).toBeNull();
    expect(parseStructuredField(42 as unknown as string)).toBeNull();
  });

  it('uris-only citationItem (no itemData) → confidence 0.85, display year kept', () => {
    const marker =
      'ADDIN ZOTERO_ITEM CSL_CITATION {"citationItems":[{"uris":["http://zotero.org/users/1/items/ABC"]}],"properties":{"formattedCitation":"(Nguyen, 2019)"}}';
    const id = parseStructuredField(marker)!;
    expect(id.confidence).toBe(0.85);
    expect(id.items[0]).toMatchObject({ year: 2019 });
    expect(id.items[0]!.authors).toEqual([]);
  });

  it('display not present in text → no occurrence (plain pass owns it)', () => {
    // The marker cites Tran 2020 but the block text never shows that work.
    const marker =
      'ADDIN ZOTERO_ITEM CSL_CITATION {"citationItems":[{"itemData":{"type":"book","title":"B","author":[{"family":"Tran","given":"L."}]}}],"properties":{"formattedCitation":"(Tran, 2020)"}}';
    expect(occs('(Smith, 2019) only.', [marker])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 5) Deterministic confidence tier function.
// ---------------------------------------------------------------------------

describe('structuredFieldConfidence (R008)', () => {
  it('pins every documented tier', () => {
    expect(structuredFieldConfidence('zotero', { payloadPresent: true, hasAuthors: true, hasYear: true })).toBe(1);
    expect(structuredFieldConfidence('zotero', { payloadPresent: true, hasAuthors: false, hasYear: true })).toBe(0.85);
    expect(structuredFieldConfidence('zotero', { payloadPresent: false, hasAuthors: false, hasYear: false })).toBe(0.7);
    expect(structuredFieldConfidence('word', { payloadPresent: true, hasAuthors: true, hasYear: true })).toBe(0.92);
    expect(structuredFieldConfidence('word', { payloadPresent: true, hasAuthors: true, hasYear: false })).toBe(0.6);
  });
});
