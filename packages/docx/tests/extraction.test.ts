/**
 * S03-T06 — fixture-driven end-to-end extraction tests (R005/R006).
 *
 * Asserts the committed fixture corpus (authored by
 * `scripts/make-fixtures.ts`) through the PUBLIC `parseDocument` entry —
 * never internal helpers — against the KNOWN_CITATIONS / KNOWN_REFERENCES
 * ground truth in `scripts/fixture-ground-truth.ts`:
 *
 *   - every §20 citation occurrence (id/raw/items/source offsets/confidence)
 *     deep-equals the ground truth table, in document order with contiguous
 *     ids c0..cN;
 *   - every §21 reference entry of the detected bibliography sections
 *     deep-equals the ground truth table (r0.., §88 isolation preserved);
 *   - offset round-trip (R009): each occurrence's raw region slices back to
 *     its exact raw text inside the source block;
 *   - the no-false-positive guards: numeric "[1]" is ignored, a bare
 *     "Smith 2024." is never a citation, footnote citations are captured,
 *     Zotero structured identity (Nguyen H./Tran L.) survives the plain-text
 *     overlay, Vietnamese family-first surnames (Nguyễn/Trần/Phạm) parse,
 *     year-suffixes 2020a/2020b and semicolon multi-citations produce the
 *     documented items;
 *   - §88 failure isolation end-to-end on an inline document (a malformed
 *     bibliography entry never throws — parseConfidence 0 + issue recorded),
 *     and `parseReferences` returns empty for below-threshold/none sections.
 *
 * Ground truth is byte-stable (R008): any change to fixture bytes, the model
 * shape, the grammar or the normalization drifts these tables and fails.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type {
  AcademicDocument,
  CitationOccurrence,
  ReferenceEntry,
} from '@citesync/document-model';

import { parseDocument, extractCitations, parseReferences } from '../src/index.js';
import {
  KNOWN_OCCURRENCES,
} from '../../../scripts/fixture-ground-truth.js';
import { KNOWN_REFERENCES } from '../../../scripts/fixture-ground-truth-references.js';

const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/', import.meta.url));

/** Fixtures whose S02 outcome is NOT 'detected' (no entries may exist). */
const NO_ENTRY_FIXTURES = Object.keys(KNOWN_OCCURRENCES).filter(
  (rel) => KNOWN_REFERENCES[rel] === undefined,
);

/** Fixtures that must produce at least one citation occurrence. */
const FIXTURES_WITH_CITATIONS = Object.keys(KNOWN_OCCURRENCES).filter(
  (rel) => KNOWN_OCCURRENCES[rel]!.length > 0,
);

// ---------------------------------------------------------------------------
// Projections: the ground truth tables are the projected shapes.
// ---------------------------------------------------------------------------

function projectOccurrence(o: CitationOccurrence) {
  return {
    id: o.id,
    raw: o.raw,
    family: o.family,
    items: o.items,
    source: {
      blockId: o.source.blockId,
      startOffset: o.source.startOffset,
      endOffset: o.source.endOffset,
    },
    confidence: o.confidence,
  };
}

function projectEntry(e: ReferenceEntry) {
  return {
    id: e.id,
    raw: e.raw,
    index: e.index,
    authors: e.authors?.map((a) => ({
      originalName: a.originalName,
      family: a.family,
      given: a.given,
      key: a.key,
    })),
    year: e.year,
    yearSuffix: e.yearSuffix,
    title: e.title,
    containerTitle: e.containerTitle,
    doi: e.doi,
    identifiers: e.identifiers,
    source: {
      blockId: e.source.blockId,
      startOffset: e.source.startOffset,
      endOffset: e.source.endOffset,
    },
    parseConfidence: e.parseConfidence,
  };
}

// ---------------------------------------------------------------------------
// Inline document builder for negative/edge tests (never a gitignored path).
// ---------------------------------------------------------------------------

function inlineDoc(blocks: AcademicDocument['blocks'], bib?: AcademicDocument['bibliography']): AcademicDocument {
  return {
    metadata: {},
    blocks,
    citations: [],
    ...(bib !== undefined ? { bibliography: bib } : {}),
    sourceMap: { version: 1, blocks: {} },
  };
}

function block(id: string, text: string, paragraphIndex = 0): AcademicDocument['blocks'][number] {
  return {
    id,
    type: 'paragraph',
    text,
    source: { blockId: id, paragraphIndex, startOffset: 0, endOffset: text.length },
  };
}

describe('S03 extraction — KNOWN_CITATIONS ground truth (per fixture)', () => {
  it('produces exactly the documented citation occurrences for every fixture', () => {
    for (const rel of FIXTURES_WITH_CITATIONS) {
      const doc = parseDocument(readFileSync(join(FIXTURES_DIR, rel)));
      expect(
        doc.citations.map(projectOccurrence),
        `${rel} citations`,
      ).toEqual(KNOWN_OCCURRENCES[rel]);
    }
  });

  it('produces no citations for the macro-carriage sample', () => {
    const doc = parseDocument(readFileSync(join(FIXTURES_DIR, 'security/vba-sample.docx')));
    expect(doc.citations).toEqual([]);
  });

  it('numbers citations contiguously c0..cN in document order', () => {
    for (const rel of FIXTURES_WITH_CITATIONS) {
      const doc = parseDocument(readFileSync(join(FIXTURES_DIR, rel)));
      expect(doc.citations.map((c) => c.id), rel).toEqual(
        doc.citations.map((_, i) => `c${i}`),
      );
    }
  });

  it('round-trips every occurrence raw region via block.text.slice (R009)', () => {
    for (const rel of FIXTURES_WITH_CITATIONS) {
      const doc = parseDocument(readFileSync(join(FIXTURES_DIR, rel)));
      const byId = new Map(doc.blocks.map((b) => [b.id, b]));
      for (const o of doc.citations) {
        const text = byId.get(o.source.blockId)?.text;
        expect(text, `${rel} ${o.id} block ${o.source.blockId}`).toBeDefined();
        expect(
          text!.slice(o.source.startOffset, o.source.endOffset),
          `${rel} ${o.id} raw round-trip`,
        ).toBe(o.raw);
      }
    }
  });
});

describe('S03 extraction — semantic guards from the slice contract', () => {
  it('ignores numeric "[1]" and never emits a bare "Smith 2024."', () => {
    const doc = parseDocument(readFileSync(join(FIXTURES_DIR, 'documents/docx/plain-text.docx')));
    expect(doc.citations).toHaveLength(1); // only "(Johnson 2018)"
    expect(doc.citations.some((c) => c.raw.includes('['))).toBe(false);
    expect(doc.citations.some((c) => c.raw.includes('Smith'))).toBe(false);
    expect(doc.citations.some((c) => c.family === 'numeric')).toBe(false);
  });

  it('captures footnote citations (simple.docx footnote Smith (2020))', () => {
    const doc = parseDocument(readFileSync(join(FIXTURES_DIR, 'author-date/simple.docx')));
    const fn = doc.citations.find((c) => c.source.blockId.startsWith('fn-'));
    expect(fn).toBeDefined();
    expect(fn!.raw).toBe('Smith (2020)');
    expect(fn!.items[0]).toMatchObject({ firstAuthor: 'Smith', year: 2020 });
  });

  it('keeps Zotero structured identity authors (et-al.docx Nguyen H./Tran L.)', () => {
    const doc = parseDocument(readFileSync(join(FIXTURES_DIR, 'author-date/et-al.docx')));
    const structured = doc.citations.find((c) => c.raw === '(Nguyen et al., 2019)');
    expect(structured).toBeDefined();
    // Identity backbone (§22 tier 1): itemData authors, not the display "et al."
    expect(structured!.items[0]!.authors).toEqual(['Nguyen H.', 'Tran L.']);
    expect(structured!.items[0]!.firstAuthor).toBe('Nguyen');
    expect(structured!.items[0]!.year).toBe(2019);
    // Structured tier outranks the plain-text equivalent.
    expect(structured!.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('parses Vietnamese family-first surnames Nguyễn/Trần/Phạm', () => {
    const doc = parseDocument(readFileSync(join(FIXTURES_DIR, 'author-date/vietnamese.docx')));
    const families = doc.citations.map((c) => c.items[0]!.firstAuthor);
    expect(families).toEqual(['Nguyễn', 'Trần', 'Phạm', 'Nguyễn']);
    expect(doc.citations[0]!.items[0]!.authors).toEqual(['Nguyễn Văn A']);
  });

  it('preserves year-suffixes 2020a/2020b and semicolon multi-citations', () => {
    const doc = parseDocument(readFileSync(join(FIXTURES_DIR, 'author-date/same-author-year.docx')));
    const multi = doc.citations.find((c) => c.raw === '(Smith, 2020a; Smith, 2020b)');
    expect(multi).toBeDefined();
    expect(multi!.items).toEqual([
      { firstAuthor: 'Smith', authors: ['Smith'], year: 2020, yearSuffix: 'a' },
      { firstAuthor: 'Smith', authors: ['Smith'], year: 2020, yearSuffix: 'b' },
    ]);
  });

  it('keeps multi-citation semicolon items separate (apa-like Doe; Roe)', () => {
    const doc = parseDocument(readFileSync(join(FIXTURES_DIR, 'documents/docx/apa-like.docx')));
    const multi = doc.citations.find((c) => c.raw === '(Doe, 2017; Roe, 2019)');
    expect(multi!.items).toEqual([
      { firstAuthor: 'Doe', authors: ['Doe'], year: 2017 },
      { firstAuthor: 'Roe', authors: ['Roe'], year: 2019 },
    ]);
  });
});

describe('S03 extraction — KNOWN_REFERENCES ground truth (per fixture)', () => {
  it('produces exactly the documented §21 entries for detected sections', () => {
    for (const rel of Object.keys(KNOWN_REFERENCES)) {
      const doc = parseDocument(readFileSync(join(FIXTURES_DIR, rel)));
      expect(doc.bibliography?.outcome, rel).toBe('detected');
      expect(
        (doc.bibliography!.entries ?? []).map(projectEntry),
        `${rel} entries`,
      ).toEqual(KNOWN_REFERENCES[rel]);
    }
  });

  it('emits no entries for non-detected sections (below-threshold/none)', () => {
    for (const rel of NO_ENTRY_FIXTURES) {
      const doc = parseDocument(readFileSync(join(FIXTURES_DIR, rel)));
      expect(doc.bibliography?.entries, rel).toBeUndefined();
      expect(doc.referenceParseIssues, rel).toBeUndefined();
    }
  });

  it('reports no referenceParseIssues for fixtures whose entries all parse', () => {
    for (const rel of Object.keys(KNOWN_REFERENCES)) {
      const doc = parseDocument(readFileSync(join(FIXTURES_DIR, rel)));
      expect(doc.referenceParseIssues, rel).toBeUndefined();
    }
  });

  it('round-trips every entry source via block.text.slice (R009)', () => {
    for (const rel of Object.keys(KNOWN_REFERENCES)) {
      const doc = parseDocument(readFileSync(join(FIXTURES_DIR, rel)));
      const byId = new Map(doc.blocks.map((b) => [b.id, b]));
      for (const e of doc.bibliography!.entries ?? []) {
        const text = byId.get(e.source.blockId)?.text;
        expect(text, `${rel} ${e.id}`).toBeDefined();
        expect(
          text!.slice(e.source.startOffset, e.source.endOffset),
          `${rel} ${e.id} raw round-trip`,
        ).toBe(e.raw);
      }
    }
  });
});

describe('S03 extraction — §88 failure isolation + boundary outcomes', () => {
  it('isolates a malformed bibliography entry (parseConfidence 0 + issue, no throw)', () => {
    const doc = inlineDoc(
      [
        block('doc-p0', 'References'),
        block('doc-p1', 'This entry has no year marker at all'),
      ],
      { outcome: 'detected', heading: 'References', confidence: 0.9, blockIds: ['doc-p0', 'doc-p1'] },
    );
    const { entries, issues } = parseReferences(doc);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.parseConfidence).toBe(0);
    expect(entries[0]!.raw).toBe('This entry has no year marker at all');
    expect(entries[0]!.index).toBe(0);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      blockId: 'doc-p1',
      index: 0,
      code: 'reference-parse',
      raw: 'This entry has no year marker at all',
    });
  });

  it('skips a pure heading block when splitting entries', () => {
    const doc = inlineDoc(
      [block('doc-p0', 'References'), block('doc-p1', 'Doe, J. (2017). Citation practice.')],
      { outcome: 'detected', heading: 'References', confidence: 0.9, blockIds: ['doc-p0', 'doc-p1'] },
    );
    const { entries, issues } = parseReferences(doc);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.year).toBe(2017);
    expect(issues).toHaveLength(0);
  });

  it('returns empty references for below-threshold and none outcomes', () => {
    const below = inlineDoc([block('doc-p0', 'References'), block('doc-p1', 'Some prose.')], {
      outcome: 'below-threshold',
      confidence: 0.4,
      candidates: [{ blockId: 'doc-p0', heading: 'References', headingType: 'exact', startIndex: 0, confidence: 0.4 }],
    });
    expect(parseReferences(below)).toEqual({ entries: [], issues: [] });
    expect(parseReferences(inlineDoc([block('doc-p0', 'No bibliography here.')]))).toEqual({
      entries: [],
      issues: [],
    });
  });

  it('extractCitations never throws and stays conservative on hostile text', () => {
    const doc = inlineDoc([
      block('doc-p0', '(2020) is not a citation without an author'),
      block('doc-p1', 'Bare mention: Smith 2024.'),
      block('doc-p2', 'Numeric style [1] and (Smith, 2024, p. 12) with page.'),
      block('doc-p3', ''),
    ]);
    const occs = extractCitations(doc);
    expect(occs).toHaveLength(1);
    expect(occs[0]!.raw).toBe('(Smith, 2024, p. 12)');
    expect(occs[0]!.items[0]!.page).toBe('12');
  });
});
