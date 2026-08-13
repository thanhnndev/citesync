/**
 * M003-T2 — `bibliographyBlockIds` recovery path (PRD §63 ask-user, D005/D009).
 *
 * The below-threshold outcome (ambiguous.docx) surfaces `candidates[]` for the
 * pick-a-section UI. This suite proves the recovery contract end-to-end via
 * the PUBLIC `parseDocument`: when the app re-runs with the user's chosen
 * section block ids, the model builds the section DIRECTLY from those ids —
 * the human's explicit pick replaces the engine's threshold decision, the
 * detector is SKIPPED (R004: the engine never silently guesses, but the
 * ask-user flow lets the user direct) — and then runs the SAME detected-path
 * tail: §21 reference parsing, the numeric index map and the §27 match map.
 *
 * Contract cases (committed fixtures via node:fs, never .gsd paths):
 *   (a) single id → detected section, heading from the block text, span
 *       extended with the consecutive reference-like run; the parse tail runs
 *       over the recovered span (ambiguous.docx → ['doc-p3'], 0 entries — the
 *       honest outcome: prose after "References" is not reference-like);
 *   (b) determinism (R008): two recovery parses deep-equal;
 *   (c) multi-id input used as-is (heading first — no reorder, no extension);
 *   (d) option absent/undefined → previous detection behavior byte-identical
 *       (ambiguous.docx still below-threshold);
 *   (e) unresolvable first id (and empty list) → deterministic EMPTY section,
 *       no throw, no silent guess;
 *   (f) en-references.docx re-parsed with its own detected span → the
 *       recovery path reproduces the detected path's span + §21 entries +
 *       §27 match map for the same section (recovery == detected; confidence
 *       is intentionally absent on a user-directed section — no detector
 *       score).
 * Plus direct unit coverage of the shared span helper
 * `sectionBlockIdsFromHeading` (the one implementation behind both paths).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { DocumentBlock, DocumentBlockType } from '@citesync/document-model';

import { parseDocument } from '../src/index.js';
import { sectionBlockIdsFromHeading } from '../src/bibliography/detect.js';

const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/', import.meta.url));

const ambiguous = readFileSync(join(FIXTURES_DIR, 'bibliography/ambiguous.docx'));
const enReferences = readFileSync(join(FIXTURES_DIR, 'bibliography/en-references.docx'));

/** Synthetic block helper (unit inputs — the span helper reads id/type/text). */
function block(id: string, text: string, type: DocumentBlockType = 'paragraph'): DocumentBlock {
  return { id, type, text, source: { blockId: id } };
}
const heading = (id: string, text: string): DocumentBlock => block(id, text, 'heading');
const entry = (id: string, year: string, title: string): DocumentBlock =>
  block(id, `Doe, J. (${year}). ${title}.`);

describe('bibliographyBlockIds — recovery path (PRD §63 ask-user, D005/D009)', () => {
  it('(a) single id: detected section from the picked heading, run extended, parse tail runs', () => {
    // ambiguous.docx is below-threshold by default ('References' exact text +
    // heading style = 0.5, no position, no reference-like follow). Recovery
    // with the picked heading must NOT re-run the threshold decision.
    const doc = parseDocument(ambiguous, { bibliographyBlockIds: ['doc-p3'] });
    const bib = doc.bibliography;

    expect(bib).toBeDefined();
    expect(bib?.outcome).toBe('detected'); // user-directed, not thresholded
    if (bib?.outcome === 'detected') {
      expect(bib.heading).toBe('References'); // block text of the picked id
      // The prose after "References" is not reference-like -> the recovered
      // span is the heading alone (honest outcome — no fabricated section).
      expect(bib.blockIds).toEqual(['doc-p3']);
      expect(bib.candidates).toBeUndefined();
      expect(bib.confidence).toBeUndefined(); // no detector score on a user-directed section
    }
    // The detected-path tail still runs: §21 parsing over the recovered span
    // (heading-only span -> 0 entries, no crash, no parse issues).
    expect(bib?.entries).toEqual([]);
    expect(doc.referenceParseIssues).toBeUndefined();

    // The 'detecting-bibliography' stage still fires on the recovery path
    // (PIPELINE_STAGES 5-stage invariant — the UI progress checklist).
    const stages: string[] = [];
    parseDocument(ambiguous, {
      bibliographyBlockIds: ['doc-p3'],
      onStage: (s) => stages.push(s),
    });
    expect(stages).toContain('detecting-bibliography');
  });

  it('(b) determinism (R008): two recovery parses deep-equal', () => {
    const first = parseDocument(ambiguous, { bibliographyBlockIds: ['doc-p3'] });
    const second = parseDocument(ambiguous, { bibliographyBlockIds: ['doc-p3'] });
    expect(second).toEqual(first);
  });

  it('(c) multi-id input is used as-is: heading first, no reorder or extension', () => {
    const doc = parseDocument(enReferences, {
      bibliographyBlockIds: ['doc-p4', 'doc-p5', 'doc-p6', 'doc-p7'],
    });
    const bib = doc.bibliography;

    expect(bib?.outcome).toBe('detected');
    if (bib?.outcome === 'detected') {
      expect(bib.heading).toBe('References');
      // The exact given list wins — no run extension, no reorder.
      expect(bib.blockIds).toEqual(['doc-p4', 'doc-p5', 'doc-p6', 'doc-p7']);
      // Same span -> same §21 entries as the detected path.
      const detected = parseDocument(enReferences).bibliography;
      expect(bib.entries).toEqual(detected?.entries);
    }
  });

  it('(d) absent/undefined option: previous behavior unchanged, byte-identical (R008)', () => {
    const plain = parseDocument(ambiguous);
    const explicit = parseDocument(ambiguous, { bibliographyBlockIds: undefined });

    // The option is additive: undefined behaves exactly like no option.
    expect(explicit).toEqual(plain);

    const bib = plain.bibliography;
    expect(bib?.outcome).toBe('below-threshold');
    if (bib?.outcome === 'below-threshold') {
      expect(bib.confidence).toBe(0.5);
      expect(bib.candidates?.map((c) => c.blockId)).toEqual(['doc-p3', 'doc-p0']);
      expect(bib.heading).toBeUndefined();
      expect(bib.blockIds).toBeUndefined();
      expect(bib.entries).toBeUndefined(); // nothing parsed until a section is picked
    }
  });

  it('(e) unresolvable first id / empty list: deterministic empty section, no throw', () => {
    const doc = parseDocument(ambiguous, { bibliographyBlockIds: ['doc-nope'] });
    const bib = doc.bibliography;

    expect(bib?.outcome).toBe('detected');
    if (bib?.outcome === 'detected') {
      expect(bib.heading).toBe(''); // visibly empty — never a silent guess
      expect(bib.blockIds).toEqual([]);
    }
    expect(bib?.entries).toEqual([]); // the parse tail runs over an empty span

    const empty = parseDocument(ambiguous, { bibliographyBlockIds: [] });
    expect(empty.bibliography?.blockIds).toEqual([]);
  });

  it('(f) recovery == detected for the same section (en-references re-parse)', () => {
    const detected = parseDocument(enReferences);
    expect(detected.bibliography?.outcome).toBe('detected');
    const span = detected.bibliography?.blockIds ?? [];

    const recovered = parseDocument(enReferences, { bibliographyBlockIds: span });

    // Same span -> same heading, same §21 entries, same §27 match map: the
    // recovery path must reproduce the detected path when the section is
    // identical (confidence is intentionally absent on the recovery path — a
    // user-directed section carries no detector score).
    expect(recovered.bibliography?.blockIds).toEqual(span);
    expect(recovered.bibliography?.heading).toBe(detected.bibliography?.heading);
    expect(recovered.bibliography?.entries).toEqual(detected.bibliography?.entries);
    expect(recovered.matchMap).toEqual(detected.matchMap);
  });
});

describe('sectionBlockIdsFromHeading — shared span helper unit coverage', () => {
  it('returns [headingId, ...consecutive reference-like run], breaking at the first non-reference-like block', () => {
    const blocks = [
      block('p0', 'Introductory text.'),
      heading('p1', 'References'),
      entry('p2', '2017', 'One'),
      entry('p3', '2018', 'Two'),
      block('p4', 'Non-entry paragraph.'),
      entry('p5', '2019', 'Three'),
    ];
    // p5 is reference-like but the consecutive run already broke at p4 — the
    // span is exactly [p1, p2, p3] (S03's entry-parsing scope).
    expect(sectionBlockIdsFromHeading(blocks, 'p1')).toEqual(['p1', 'p2', 'p3']);
  });

  it('heading with no reference-like follow yields [headingId] alone', () => {
    const blocks = [
      block('p0', 'Introductory text.'),
      heading('p1', 'References'),
      block('p2', 'Prose, not an entry.'),
    ];
    expect(sectionBlockIdsFromHeading(blocks, 'p1')).toEqual(['p1']);
  });

  it('unresolvable heading id returns [] (never a guessed span)', () => {
    expect(sectionBlockIdsFromHeading([heading('p0', 'References')], 'missing')).toEqual([]);
  });

  it('notes never join the span: a footnote block id resolves to nothing', () => {
    const blocks = [
      heading('p0', 'References'),
      block('n0', 'Doe, J. (2017). A footnote entry.', 'footnote'),
    ];
    expect(sectionBlockIdsFromHeading(blocks, 'n0')).toEqual([]);
  });
});
