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
