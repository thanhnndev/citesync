/**
 * S01-T8 — determinism suite (R008): the same bytes must always yield a
 * deep-equal, byte-identical `AcademicDocument`.
 *
 * Three layers of proof:
 *  - same-input-twice: parsing any valid committed fixture twice produces
 *    deep-equal in-memory documents AND byte-identical JSON serializations
 *    (JSON.stringify order is insertion order — deterministic here because
 *    every part of the model is built in fixed order from fixed bytes);
 *  - golden anchor: `tests/golden/minimal.golden.json` is the committed,
 *    byte-stable shape lock for `fixtures/minimal.docx` — a fresh parse must
 *    deep-equal it exactly. Any change to the model shape, block order,
 *    offsets, or fixture bytes breaks the golden (deliberate change -> update
 *    the golden with a reviewed diff);
 *  - cross-parse stability of the source map (run offsets, block ids).
 *
 * Fixtures are git-tracked committed files read via node:fs (never .gsd/ or
 * any gitignored path).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseDocument } from '../src/index.js';

const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
const GOLDEN_DIR = fileURLToPath(new URL('./golden/', import.meta.url));

/**
 * Expected S02 bibliography outcome per valid fixture (T03 detector ground
 * truth; T02 authored the 5 `bibliography/` fixtures to exercise each path):
 *   - 'detected'         — doc.bibliography present with a confident section;
 *   - 'below-threshold'  — present with candidates[] for the M003 ask-user
 *     flow (R004 — never a silent guess);
 *   - 'absent'           — outcome 'none', doc.bibliography undefined.
 * Documents with no heading at all yield 'absent'; documents whose only
 * headings are non-bibliography ones still yield 'below-threshold' with the
 * scored candidates (the engine reports, it never guesses). apa-like.docx is
 * a real boundary case: 'References' Heading1 at document start + 1/3
 * reference-like follow scores exactly 0.6 (BIBLIOGRAPHY_THRESHOLD) -> detected.
 */
const EXPECTED_BIBLIOGRAPHY: Record<string, 'detected' | 'below-threshold' | 'absent'> = {
  'minimal.docx': 'below-threshold',
  'author-date/simple.docx': 'below-threshold',
  'author-date/et-al.docx': 'below-threshold',
  'author-date/multiple-authors.docx': 'absent',
  'author-date/same-author-year.docx': 'absent',
  'author-date/missing.docx': 'absent',
  'author-date/ambiguous.docx': 'absent',
  'author-date/vietnamese.docx': 'below-threshold',
  'documents/docx/apa-like.docx': 'detected',
  'documents/docx/harvard.docx': 'absent',
  'documents/docx/plain-text.docx': 'absent',
  'bibliography/en-references.docx': 'detected',
  'bibliography/vi-tai-lieu.docx': 'detected',
  'bibliography/style-position.docx': 'detected',
  'bibliography/no-bibliography.docx': 'absent',
  'bibliography/ambiguous.docx': 'below-threshold',
  'match/same-author-two-years.docx': 'detected',
  'match/ambiguous-same-author-year.docx': 'detected',
  'match/near-miss-author.docx': 'detected',
  'match/near-miss-vietnamese.docx': 'detected',
  'security/vba-sample.docx': 'below-threshold',
};

/** Every valid committed fixture (mirrors fixture.test.ts inventory). */
const VALID_FIXTURES = [
  'minimal.docx',
  'author-date/simple.docx',
  'author-date/et-al.docx',
  'author-date/multiple-authors.docx',
  'author-date/same-author-year.docx',
  'author-date/missing.docx',
  'author-date/ambiguous.docx',
  'author-date/vietnamese.docx',
  'documents/docx/apa-like.docx',
  'documents/docx/harvard.docx',
  'documents/docx/plain-text.docx',
  'bibliography/en-references.docx',
  'bibliography/vi-tai-lieu.docx',
  'bibliography/style-position.docx',
  'bibliography/no-bibliography.docx',
  'bibliography/ambiguous.docx',
  'match/same-author-two-years.docx',
  'match/ambiguous-same-author-year.docx',
  'match/near-miss-author.docx',
  'match/near-miss-vietnamese.docx',
  'security/vba-sample.docx',
];

describe('determinism (R008) — same bytes, same document', () => {
  it('parses the same fixture twice into deep-equal documents (all fixtures)', () => {
    for (const rel of VALID_FIXTURES) {
      const bytes = readFileSync(join(FIXTURES_DIR, rel));
      const first = parseDocument(bytes);
      const second = parseDocument(bytes);
      expect(second, rel).toEqual(first);
    }
  });

  it('produces byte-identical JSON serializations (re-run reproducibility)', () => {
    for (const rel of VALID_FIXTURES) {
      const bytes = readFileSync(join(FIXTURES_DIR, rel));
      const a = JSON.stringify(parseDocument(bytes));
      const b = JSON.stringify(parseDocument(bytes));
      expect(a, rel).toBe(b);
    }
  });

  it('keeps block ids, block order and source-map keys stable across parses', () => {
    const bytes = readFileSync(join(FIXTURES_DIR, 'minimal.docx'));
    const a = parseDocument(bytes);
    const b = parseDocument(bytes);

    expect(a.blocks.map((x) => x.id)).toEqual(b.blocks.map((x) => x.id));
    expect(Object.keys(a.sourceMap.blocks)).toEqual(Object.keys(b.sourceMap.blocks));
    // Run offsets are identical byte-for-byte.
    expect(JSON.stringify(a.sourceMap)).toBe(JSON.stringify(b.sourceMap));
  });
});

describe('determinism (R008) — S02 bibliography stability', () => {
  it('keeps the bibliography outcome present/absent exactly per fixture', () => {
    for (const rel of VALID_FIXTURES) {
      const doc = parseDocument(readFileSync(join(FIXTURES_DIR, rel)));
      const expected = EXPECTED_BIBLIOGRAPHY[rel];
      if (expected === 'absent') {
        expect(doc.bibliography, `${rel} bibliography absent`).toBeUndefined();
      } else {
        expect(doc.bibliography, `${rel} bibliography present`).toBeDefined();
        expect(doc.bibliography!.outcome, `${rel} bibliography outcome`).toBe(expected);
      }
    }
  });

  it('keeps the bibliography deep-stable across parses, candidates included', () => {
    for (const rel of VALID_FIXTURES) {
      const bytes = readFileSync(join(FIXTURES_DIR, rel));
      const a = parseDocument(bytes);
      const b = parseDocument(bytes);
      // Deep equality covers the whole bibliography: for 'detected' the ordered
      // blockIds span, for 'below-threshold' the candidates[] array (including
      // the ambiguous.docx 2-candidate array — lock-stable for the M003 UI).
      expect(b.bibliography, rel).toEqual(a.bibliography);
    }
  });
});

describe('determinism (R008) — S03 citations + bibliography entries stability', () => {
  it('keeps doc.citations and doc.bibliography.entries deep-equal across parses (all fixtures)', () => {
    for (const rel of VALID_FIXTURES) {
      const bytes = readFileSync(join(FIXTURES_DIR, rel));
      const a = parseDocument(bytes);
      const b = parseDocument(bytes);
      expect(b.citations, rel).toEqual(a.citations);
      expect(b.bibliography?.entries, rel).toEqual(a.bibliography?.entries);
      expect(b.referenceParseIssues, rel).toEqual(a.referenceParseIssues);
    }
  });

  it('re-numbers the merged structured+plain stream to contiguous c0..cN (et-al.docx)', () => {
    // et-al.docx's Zotero field overlaps its plain-text occurrence — the merged
    // stream must still be contiguous and byte-identical across parses (R008).
    const bytes = readFileSync(join(FIXTURES_DIR, 'author-date/et-al.docx'));
    const a = parseDocument(bytes);
    const b = parseDocument(bytes);
    expect(a.citations.map((c) => c.id)).toEqual(a.citations.map((_, i) => `c${i}`));
    expect(JSON.stringify(b.citations)).toBe(JSON.stringify(a.citations));
  });
});

describe('determinism (R008) — committed golden anchor', () => {
  it('locks the minimal.docx shape against tests/golden/minimal.golden.json', () => {
    const bytes = readFileSync(join(FIXTURES_DIR, 'minimal.docx'));
    const golden = JSON.parse(readFileSync(join(GOLDEN_DIR, 'minimal.golden.json'), 'utf8'));

    // Serialize through JSON the same way the golden was authored so optional
    // (undefined) fields drop identically on both sides.
    const fresh = JSON.parse(JSON.stringify(parseDocument(bytes)));
    expect(fresh).toEqual(golden);
  });

  it('golden anchor has the hand-known structure (sanity + drift guard)', () => {
    const golden = JSON.parse(readFileSync(join(GOLDEN_DIR, 'minimal.golden.json'), 'utf8')) as {
      blocks: Array<{ id: string; type: string; text: string; style?: string }>;
      sourceMap: { version: number; blocks: Record<string, { runs: Array<{ startOffset: number; endOffset: number }> }> };
      metadata: Record<string, string>;
    };

    expect(golden.sourceMap.version).toBe(1);
    expect(golden.blocks.map((b) => b.id)).toEqual(['doc-p0', 'doc-p1', 'doc-p2']);
    expect(golden.blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'paragraph']);
    expect(golden.blocks[0]!.style).toBe('Heading1');
    expect(golden.blocks[1]!.text).toBe('Smith (2024) proposed a theory');
    expect(golden.metadata.title).toBe('Minimal golden fixture');

    const frag = golden.sourceMap.blocks['doc-p2']!.runs;
    expect(frag.map((r) => [r.startOffset, r.endOffset])).toEqual([
      [0, 11],
      [11, 20],
      [20, 25],
    ]);
  });
});
