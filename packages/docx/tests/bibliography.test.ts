/**
 * S02-T5 — bibliography detection proof (bilingual / below-threshold / absent)
 * + weighted-scorer unit coverage.
 *
 * Two layers:
 *  1. The PUBLIC `parseDocument` on the five committed `bibliography/`
 *     fixtures (T02 corpus, byte-stable, authored by `scripts/make-fixtures.ts`)
 *     proves the end-to-end wiring from T04: `AcademicDocument.bibliography` is
 *     filled by the real reader → detector path. Asserted per fixture:
 *     - en-references.docx    — English true-positive: 'References' heading,
 *       confidence 1.0, blockIds span heading + reference-like run;
 *     - vi-tai-lieu.docx      — Vietnamese true-positive: diacritic heading
 *       'Danh mục tài liệu tham khảo', confidence 0.8;
 *     - style-position.docx   — custom (non-known) heading text via Heading1
 *       style + late position + reference-like follow: weighted-signal combo
 *       (0.65), no exact-text match;
 *     - no-bibliography.docx  — narrative only -> outcome 'none',
 *       `doc.bibliography` stays undefined;
 *     - ambiguous.docx        — 'References' heading but non-reference-like
 *       follow -> 'below-threshold' (NEVER a silent 'detected'), with
 *       candidates[] carrying blockId/startIndex/headingType/confidence for
 *       the M003 pick-a-section UI (R004 / PRD §17).
 *  2. Direct unit tests of `detectBibliography` on synthetic DocumentBlock
 *     arrays pin the weighted scorer signal-by-signal (headingText 0.35,
 *     headingStyle 0.15, position 0.2, followingRefs 0.3) and the threshold
 *     boundary at BIBLIOGRAPHY_THRESHOLD = 0.6, plus the notes-excluded and
 *     empty/blank inputs.
 *
 * All fixture reads go through node:fs on committed files (never .gsd/ paths).
 * Expected scores are the empirically confirmed float sums of the exported
 * weights (see detect.ts); float-exact assertions are used only where the sum
 * is exactly representable (0.35, 0.5, 0.6, 0.7, 0.8, 1.0).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { DocumentBlock, DocumentBlockType } from '@citesync/document-model';

import { parseDocument } from '../src/index.js';
import { BIBLIOGRAPHY_THRESHOLD, detectBibliography } from '../src/bibliography/detect.js';

const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/', import.meta.url));

/** Committed bibliography fixtures (T02 corpus). */
const BIB_FIXTURES = {
  enReferences: 'bibliography/en-references.docx',
  viTaiLieu: 'bibliography/vi-tai-lieu.docx',
  stylePosition: 'bibliography/style-position.docx',
  noBibliography: 'bibliography/no-bibliography.docx',
  ambiguous: 'bibliography/ambiguous.docx',
} as const;

// ---------------------------------------------------------------------------
// Synthetic block helpers (unit-test inputs — DocumentBlock with a minimal
// SourceLocation; the detector only reads id/type/text).
// ---------------------------------------------------------------------------

function block(id: string, text: string, type: DocumentBlockType = 'paragraph'): DocumentBlock {
  return { id, type, text, source: { blockId: id } };
}

const heading = (id: string, text: string): DocumentBlock => block(id, text, 'heading');
const footnote = (id: string, text: string): DocumentBlock => block(id, text, 'footnote');

/** A reference-entry-shaped block: "Doe, J. (YYYY). Title." */
function entry(id: string, year: string, title: string): DocumentBlock {
  return block(id, `Doe, J. (${year}). ${title}.`);
}

// ---------------------------------------------------------------------------
// 1) End-to-end fixture proof via the public parseDocument (T04 wiring).
// ---------------------------------------------------------------------------

describe('bibliography detection — committed fixtures via public parseDocument', () => {
  it('en-references.docx: English true-positive, heading first, span covers the run', () => {
    const doc = parseDocument(readFileSync(join(FIXTURES_DIR, BIB_FIXTURES.enReferences)));
    const bib = doc.bibliography;

    expect(bib).toBeDefined();
    expect(bib?.outcome).toBe('detected'); // not below-threshold, not none
    if (bib?.outcome === 'detected') {
      expect(bib.confidence).toBe(1); // exact + style + position + 3/3 refs
      expect(bib.heading).toBe('References');
      // Ordered span: heading block first, then the consecutive reference-like
      // blocks in document order (S03's entry-parsing scope).
      expect(bib.blockIds).toEqual(['doc-p4', 'doc-p5', 'doc-p6', 'doc-p7']);

      // blockIds[0] is the heading block itself.
      const headingBlock = doc.blocks.find((b) => b.id === bib.blockIds![0]);
      expect(headingBlock?.type).toBe('heading');
      expect(headingBlock?.text).toBe('References');
      expect(headingBlock?.style).toBe('Heading1');

      // The rest of the span are the following reference-like paragraphs.
      const entryBlocks = bib.blockIds!.slice(1).map((id) => doc.blocks.find((b) => b.id === id));
      expect(entryBlocks.map((b) => b?.type)).toEqual(['paragraph', 'paragraph', 'paragraph']);
      for (const b of entryBlocks) {
        expect(b?.text).toMatch(/\(\d{4}\)\./); // reference-entry year shape
      }
    }
  });

  it('vi-tai-lieu.docx: Vietnamese true-positive with diacritics, high confidence', () => {
    const doc = parseDocument(readFileSync(join(FIXTURES_DIR, BIB_FIXTURES.viTaiLieu)));
    const bib = doc.bibliography;

    expect(bib).toBeDefined();
    expect(bib?.outcome).toBe('detected');
    if (bib?.outcome === 'detected') {
      expect(bib.heading).toBe('Danh mục tài liệu tham khảo'); // diacritics preserved
      expect(bib.confidence).toBe(0.8); // exact + style + 3/3 refs, heading first (no position)
      expect(bib.blockIds).toEqual(['doc-p0', 'doc-p1', 'doc-p2', 'doc-p3']);
    }
  });

  it('style-position.docx: weighted-signal combo without exact heading text', () => {
    const doc = parseDocument(readFileSync(join(FIXTURES_DIR, BIB_FIXTURES.stylePosition)));
    const bib = doc.bibliography;

    expect(bib).toBeDefined();
    expect(bib?.outcome).toBe('detected');
    if (bib?.outcome === 'detected') {
      // 'Danh mục trích dẫn' is NOT one of the 7 known headings — the section
      // was found from style + position + following-refs alone (0.15+0.2+0.3).
      expect(bib.heading).toBe('Danh mục trích dẫn');
      expect(bib.confidence).toBeGreaterThanOrEqual(BIBLIOGRAPHY_THRESHOLD);
      expect(bib.confidence).toBeLessThan(1); // a combo, not the text+refs max
      expect(bib.confidence).toBeCloseTo(0.65, 10); // 0.15+0.2+0.3 = 0.6499999999999999
      expect(bib.blockIds).toEqual(['doc-p5', 'doc-p6', 'doc-p7', 'doc-p8']);
    }
  });

  it('no-bibliography.docx: absent bibliography -> outcome none, bibliography undefined', () => {
    const doc = parseDocument(readFileSync(join(FIXTURES_DIR, BIB_FIXTURES.noBibliography)));

    // buildModel leaves doc.bibliography undefined for 'none' (model-first-class
    // absence — the ask-user flow has nothing to ask about).
    expect(doc.bibliography).toBeUndefined();
    // The detector itself reports the explicit 'none' outcome.
    expect(detectBibliography(doc.blocks).outcome).toBe('none');
  });

  it('ambiguous.docx: below-threshold with candidates — never a silent detected', () => {
    const doc = parseDocument(readFileSync(join(FIXTURES_DIR, BIB_FIXTURES.ambiguous)));
    const bib = doc.bibliography;

    // Model-first-class: the ask-user outcome is present on the document even
    // though no section was confidently found (R004).
    expect(bib).toBeDefined();
    expect(bib?.outcome).toBe('below-threshold'); // NOT 'detected'
    if (bib?.outcome === 'below-threshold') {
      expect(bib.confidence).toBe(0.5); // exact + style, no position, no refs
      // The D009 below-threshold shape carries no guessed section.
      expect(bib.heading).toBeUndefined();
      expect(bib.blockIds).toBeUndefined();

      // candidates for the M003 pick-a-section UI, best first (0.5 then 0.15).
      expect(bib.candidates).toHaveLength(2);
      const [best, second] = bib.candidates!;
      expect(best).toMatchObject({
        blockId: 'doc-p3',
        heading: 'References',
        headingType: 'exact',
        startIndex: 3,
        confidence: 0.5,
      });
      expect(second).toMatchObject({
        blockId: 'doc-p0',
        heading: 'Introduction',
        headingType: 'style',
        startIndex: 0,
        confidence: 0.15,
      });
      // Every candidate resolves to a real heading block in doc.blocks.
      for (const c of bib.candidates!) {
        const b = doc.blocks.find((x) => x.id === c.blockId);
        expect(b?.type).toBe('heading');
        expect(b?.text).toBe(c.heading);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 2) Weighted-scorer unit tests on synthetic blocks (each signal, threshold
//    boundary, negative inputs).
// ---------------------------------------------------------------------------

describe('bibliography detection — weighted scorer unit tests (synthetic blocks)', () => {
  it('headingText signal alone: exact known heading on a plain paragraph scores 0.35', () => {
    // The heading lost its style -> plain paragraph whose text is exactly a
    // known heading. Not late, no reference-like follow.
    const res = detectBibliography([
      block('p0', 'References'),
      block('p1', 'Introductory text about extraction.'),
      block('p2', 'More narrative content here.'),
    ]);

    expect(res.outcome).toBe('below-threshold');
    if (res.outcome === 'below-threshold') {
      expect(res.confidence).toBe(0.35);
      expect(res.candidates).toHaveLength(1);
      expect(res.candidates[0]).toMatchObject({
        blockId: 'p0',
        heading: 'References',
        headingType: 'exact',
        startIndex: 0,
        confidence: 0.35,
      });
    }
  });

  it('headingStyle signal alone: heading with unknown text scores 0.15', () => {
    const res = detectBibliography([
      heading('p0', 'Findings Summary'),
      block('p1', 'First narrative paragraph.'),
      block('p2', 'Second narrative paragraph.'),
    ]);

    expect(res.outcome).toBe('below-threshold');
    if (res.outcome === 'below-threshold') {
      expect(res.candidates[0]!.headingType).toBe('style');
      expect(res.candidates[0]!.confidence).toBe(0.15);
      expect(res.confidence).toBe(0.15);
    }
  });

  it('position signal alone: late heading with unknown text scores 0.35 (style 0.15 + position 0.2)', () => {
    const res = detectBibliography([
      block('p0', 'First narrative paragraph.'),
      block('p1', 'Second narrative paragraph.'),
      block('p2', 'Third narrative paragraph.'),
      block('p3', 'Fourth narrative paragraph.'),
      heading('p4', 'End Matter'),
      block('p5', 'Fifth narrative paragraph.'),
    ]);

    expect(res.outcome).toBe('below-threshold');
    if (res.outcome === 'below-threshold') {
      expect(res.candidates).toHaveLength(1); // narrative paragraphs are not candidates
      expect(res.candidates[0]).toMatchObject({
        blockId: 'p4',
        headingType: 'position',
        startIndex: 4,
      });
      expect(res.candidates[0]!.confidence).toBe(0.35); // 0.15 + 0.2 exact
    }
  });

  it('followingRefs signal alone: non-exact heading before 3 reference entries scores 0.45', () => {
    const res = detectBibliography([
      heading('p0', 'Danh mục trích dẫn'), // not one of the 7 known headings
      entry('p1', '2017', 'Citation practice in digital documents'),
      entry('p2', '2018', 'Structured citations'),
      entry('p3', '2019', 'Offsets and evidence'),
    ]);

    expect(res.outcome).toBe('below-threshold');
    if (res.outcome === 'below-threshold') {
      expect(res.candidates[0]).toMatchObject({
        blockId: 'p0',
        headingType: 'reference-segment',
        startIndex: 0,
      });
      expect(res.candidates[0]!.confidence).toBeCloseTo(0.45, 10); // 0.15 + 0.3*(3/3)
      expect(res.confidence).toBeCloseTo(0.45, 10);
    }
  });

  it('threshold boundary: exact+style grades from 0.5 (below) through 0.6 (at) to 0.7 (above)', () => {
    // 0.5: exact + style, no position, no refs -> below-threshold (this is the
    // ambiguous.docx path — heading text alone must NOT cross).
    const below = detectBibliography([
      block('p0', 'Introductory text.'),
      heading('p1', 'References'),
      block('p2', 'See the appendix for details.'),
    ]);
    expect(below.outcome).toBe('below-threshold');
    if (below.outcome === 'below-threshold') {
      expect(below.confidence).toBe(0.5);
    }

    // 0.6: exact + style + 1/3 refs — exactly AT the conservative threshold ->
    // detected (mirrors the real apa-like.docx boundary case: 0.35+0.15+0.3/3).
    const at = detectBibliography([
      heading('p0', 'References'),
      block('p1', 'Narrative without a year.'),
      block('p2', 'Another narrative line here.'),
      entry('p3', '2017', 'One entry'),
    ]);
    expect(at.outcome).toBe('detected');
    if (at.outcome === 'detected') {
      expect(at.section.confidence).toBe(BIBLIOGRAPHY_THRESHOLD); // 0.6 exact
      expect(at.section.heading).toBe('References');
      // Year-less lines in the LEADING gap (p1/p2 carry no '(YYYY)' in-text
      // citation) join the span as candidate entries once the entry at p3
      // resolves the gap (M004-S02 year-less-entry contract) — the span is
      // the heading + the gap + the run, not the heading alone. Only lines
      // with in-text citations '(YYYY)' (real prose, apa-like.docx) still
      // terminate the span.
      expect(at.section.blockIds).toEqual(['p0', 'p1', 'p2', 'p3']);
    }

    // 0.7: exact + style + position -> detected.
    const position = detectBibliography([
      block('p0', 'First narrative paragraph.'),
      block('p1', 'Second narrative paragraph.'),
      block('p2', 'Third narrative paragraph.'),
      heading('p3', 'References'),
    ]);
    expect(position.outcome).toBe('detected');
    if (position.outcome === 'detected') {
      expect(position.section.confidence).toBe(0.7); // 0.35 + 0.15 + 0.2 exact
    }

    // 0.7: exact + style + 2/3 refs -> detected (crossing above the 1/3 case).
    const twoThirds = detectBibliography([
      heading('p0', 'References'),
      entry('p1', '2017', 'One entry'),
      entry('p2', '2018', 'Two entries'),
      block('p3', 'A plain closing paragraph.'),
    ]);
    expect(twoThirds.outcome).toBe('detected');
    if (twoThirds.outcome === 'detected') {
      expect(twoThirds.section.confidence).toBe(0.7); // 0.35 + 0.15 + 0.3*(2/3) exact
      expect(twoThirds.section.blockIds).toEqual(['p0', 'p1', 'p2']);
    }
  });

  it('detected span: the reference-like run breaks at the first non-entry block', () => {
    const res = detectBibliography([
      heading('p0', 'References'),
      entry('p1', '2017', 'One entry'),
      entry('p2', '2018', 'Two entries'),
      block('p3', 'Non-entry paragraph interrupts the run.'),
      entry('p4', '2019', 'Three entries'),
    ]);

    expect(res.outcome).toBe('detected');
    if (res.outcome === 'detected') {
      // p4 is reference-like but the consecutive run already broke at p3 —
      // S03's entry-parsing scope is exactly [p0, p1, p2].
      expect(res.section.blockIds).toEqual(['p0', 'p1', 'p2']);
    }
  });

  it('notes are excluded: a footnote "References" is never a candidate', () => {
    // Footnote-only input -> empty body -> 'none'.
    expect(detectBibliography([footnote('n0', 'References')]).outcome).toBe('none');
    // Mixed: the footnote heading must not join the body candidates.
    expect(
      detectBibliography([
        block('p0', 'Body paragraph first.'),
        footnote('n0', 'References'),
      ]).outcome,
    ).toBe('none');
    // A real body heading still scores; the footnote term is ignored.
    const res = detectBibliography([
      heading('p0', 'Findings'),
      footnote('n0', 'Tài liệu tham khảo'),
    ]);
    expect(res.outcome).toBe('below-threshold');
    if (res.outcome === 'below-threshold') {
      expect(res.candidates).toHaveLength(1);
      expect(res.candidates[0]!.blockId).toBe('p0');
    }
  });

  it('empty input and blank headings produce a clean outcome none', () => {
    expect(detectBibliography([]).outcome).toBe('none');
    expect(detectBibliography([heading('p0', '   ')]).outcome).toBe('none');
    expect(
      detectBibliography([block('p0', ''), heading('p1', '\t')]).outcome,
    ).toBe('none');
  });

  it('candidate ordering is deterministic: confidence desc, then body index asc', () => {
    // Three style-only headings, none late -> equal scores, index-ascending.
    const res = detectBibliography([
      heading('p0', 'Alpha'),
      heading('p1', 'Beta'),
      heading('p2', 'Gamma'),
      block('p3', 'First narrative paragraph.'),
      block('p4', 'Second narrative paragraph.'),
      block('p5', 'Third narrative paragraph.'),
    ]);

    expect(res.outcome).toBe('below-threshold');
    if (res.outcome === 'below-threshold') {
      expect(res.candidates.map((c) => c.blockId)).toEqual(['p0', 'p1', 'p2']);
      expect(res.candidates.map((c) => c.confidence)).toEqual([0.15, 0.15, 0.15]);
      // Total order also holds with distinct scores: higher confidence first.
      const mixed = detectBibliography([
        heading('p0', 'Introduction'),
        heading('p1', 'References'),
        block('p2', 'See the appendix for details.'),
      ]);
      expect(mixed.outcome).toBe('below-threshold');
      if (mixed.outcome === 'below-threshold') {
        expect(mixed.candidates.map((c) => c.blockId)).toEqual(['p1', 'p0']);
        expect(mixed.candidates.map((c) => c.confidence)).toEqual([0.5, 0.15]);
      }
    }
  });
});
