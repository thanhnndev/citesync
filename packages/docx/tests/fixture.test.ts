/**
 * S01-T8 — committed-fixture integration proof (research §8 integration test).
 *
 * Every committed .docx under `fixtures/` (authored by
 * `scripts/make-fixtures.ts`, byte-stable) is parsed through the PUBLIC
 * `parseDocument` entry — the real reader end to end: zip bounds -> xml ->
 * blocks -> source map. Never through internal helpers.
 *
 * Covers the T8 contract:
 *  - every valid fixture parses WITHOUT throwing and yields blocks[] > 0;
 *  - the five explicitly "bad" security samples throw the expected TYPED
 *    errors (ZipBombError / NotADocxError) — never a raw crash;
 *  - offset round-trip (R009): the known citation strings of each fixture
 *    select exactly via `block.text.slice(startOffset, endOffset)`;
 *  - run-level slice-exact evidence: every block's source-map runs slice back
 *    to their exact text;
 *  - footnote blocks are produced where the fixtures carry notes;
 *  - entity-encoded fixture text decodes (harvard.docx "Research & Development").
 *
 * Fixtures are git-tracked committed files (never .gsd/ or any gitignored
 * path), read via `node:fs` relative to this test file.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { DocumentBlock } from '@citesync/document-model';

import { parseDocument } from '../src/index.js';
import { NotADocxError, ZipBombError } from '../src/zip/errors.js';

const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/', import.meta.url));

/** Recursively list all files under fixtures/ as repo-relative paths. */
function listFixtureFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name);
      const relPath = rel === '' ? name : `${rel}/${name}`;
      if (statSync(abs).isDirectory()) walk(abs, relPath);
      else out.push(relPath);
    }
  };
  walk(FIXTURES_DIR, '');
  return out;
}

const ALL_FILES = listFixtureFiles();

/** The five explicitly "bad" samples: typed error expected, never a hang. */
const BAD_SAMPLES: ReadonlyArray<{ file: string; error: new (...args: never[]) => Error }> = [
  { file: 'security/zip-bomb.docx', error: ZipBombError },
  { file: 'security/lying-bomb.docx', error: ZipBombError },
  { file: 'security/truncated.docx', error: NotADocxError },
  { file: 'security/not-a-docx.zip', error: NotADocxError },
  { file: 'security/garbage.docx', error: NotADocxError },
];

/** security/vba-sample.docx is a VALID package (macros note-and-skip). */
const VALID_FIXTURES = ALL_FILES.filter((f) => f.endsWith('.docx')).filter(
  (f) => !BAD_SAMPLES.some((b) => b.file === f),
);

/** Known citation strings per fixture (from scripts/make-fixtures.ts). */
const KNOWN_CITATIONS: Record<string, string[]> = {
  'minimal.docx': ['Smith (2024)'],
  'author-date/simple.docx': ['Smith (2020)', '(Nguyen & Tran, 2021)', '(Lee, 2019)'],
  'author-date/et-al.docx': ['(Nguyen et al., 2019)', 'Anderson, Brown, and Clark (2018)', '(Williams et al., 2022)'],
  'author-date/multiple-authors.docx': ['(Duong, Tran, & Le, 2020)', 'Pham and Nguyen (2017)', 'Ngo, Vu, Hoang, and Bui (2016)'],
  'author-date/same-author-year.docx': ['Smith (2020a)', 'Smith (2020b)', '(Smith, 2020a; Smith, 2020b)'],
  'author-date/missing.docx': ['(n.d.)', '(Author unknown, n.d.)'],
  'author-date/ambiguous.docx': ['(Smith, 2020)', 'Smith (2021)'],
  'author-date/vietnamese.docx': ['Nguyễn Văn A (2015)', 'Trần Thị B (2018)', 'Phạm Quốc C (2020)'],
  'documents/docx/apa-like.docx': ['Johnson (2018)', '(Doe, 2017; Roe, 2019)', 'Doe, J. (2017).'],
  'documents/docx/harvard.docx': ['(Smith, 2024, p. 12)', '(Nguyen 2021)', 'Le (2023)'],
  'documents/docx/plain-text.docx': ['(Johnson 2018)', '[1]', 'Smith 2024'],
  'security/vba-sample.docx': [], // macro carriage text only — no citations
};

/** Fixtures expected to carry at least one footnote block. */
const FIXTURES_WITH_FOOTNOTES = new Set([
  'author-date/simple.docx',
  'author-date/et-al.docx',
  'author-date/vietnamese.docx',
]);

describe('fixture corpus — real .docx files parse end to end', () => {
  it('covers the full committed fixture corpus (manifest drift guard)', () => {
    // Lock the fixture inventory: README.md + minimal(1) + author-date(7) +
    // documents(3) + security(6 incl. not-a-docx.zip + lying-bomb) = 18 files.
    expect(ALL_FILES).toHaveLength(18);
    expect(VALID_FIXTURES).toHaveLength(12);
    expect(BAD_SAMPLES).toHaveLength(5);
  });

  it('parses every valid fixture through the public API without throwing', () => {
    for (const rel of VALID_FIXTURES) {
      const bytes = readFileSync(join(FIXTURES_DIR, rel));
      let doc: ReturnType<typeof parseDocument>;
      expect(() => {
        doc = parseDocument(bytes);
      }, rel).not.toThrow();
      expect(doc!.blocks.length, `${rel} yields blocks`).toBeGreaterThan(0);
    }
  });

  it('produces the expected metadata for every valid fixture', () => {
    for (const rel of VALID_FIXTURES) {
      const doc = parseDocument(readFileSync(join(FIXTURES_DIR, rel)));
      expect(doc.metadata.title, `${rel} title`).toBeTruthy();
      expect(doc.metadata.author, `${rel} author`).toBeTruthy();
      expect(doc.metadata.created, `${rel} created`).toBe('2024-01-15T10:30:00Z');
      expect(doc.metadata.modified, `${rel} modified`).toBe('2024-02-20T08:00:00Z');
    }
  });

  it('yields footnote blocks where the fixtures carry notes', () => {
    for (const rel of FIXTURES_WITH_FOOTNOTES) {
      const doc = parseDocument(readFileSync(join(FIXTURES_DIR, rel)));
      const notes = doc.blocks.filter((b) => b.type === 'footnote');
      expect(notes.length, `${rel} footnote count`).toBe(1);
      expect(notes[0]!.id).toBe('fn-fn0');
    }
  });
});

describe('fixture corpus — offset round-trip (R009)', () => {
  it('selects each known citation exactly via text.slice(startOffset, endOffset)', () => {
    for (const rel of VALID_FIXTURES) {
      const citations = KNOWN_CITATIONS[rel];
      if (citations.length === 0) continue;
      const doc = parseDocument(readFileSync(join(FIXTURES_DIR, rel)));

      for (const citation of citations) {
        const block = doc.blocks.find((b) => b.text.includes(citation));
        expect(block, `${rel} contains citation "${citation}"`).toBeDefined();
        const b = block!;
        const idx = b.text.indexOf(citation);
        // The block-level source span plus the run offsets both round-trip.
        expect(b.text.slice(idx, idx + citation.length)).toBe(citation);
        expect(b.source.blockId).toBe(b.id);
        expect(b.text.slice(b.source.startOffset!, b.source.endOffset!)).toBe(b.text);
      }
    }
  });

  it('keeps run-level slice-exact evidence for every block (source map)', () => {
    for (const rel of VALID_FIXTURES) {
      const doc = parseDocument(readFileSync(join(FIXTURES_DIR, rel)));
      for (const block of doc.blocks) {
        const entry = doc.sourceMap.blocks[block.id];
        expect(entry, `${rel} sourceMap entry for ${block.id}`).toBeDefined();
        for (const run of entry!.runs) {
          expect(
            block.text.slice(run.startOffset, run.endOffset),
            `${rel} ${block.id} run ${run.runIndex}`,
          ).toBe(run.text);
        }
      }
    }
  });

  it('matches the golden anchor texts and offsets for minimal.docx', () => {
    // Hand-known from fixtures/README.md.
    const doc = parseDocument(readFileSync(join(FIXTURES_DIR, 'minimal.docx')));
    const [h, p, f] = doc.blocks as [DocumentBlock, DocumentBlock, DocumentBlock];

    expect(h.type).toBe('heading');
    expect(h.text).toBe('Introduction');
    expect(h.style).toBe('Heading1');
    expect(p.type).toBe('paragraph');
    expect(p.text).toBe('Smith (2024) proposed a theory');
    expect(p.text.slice(0, 12)).toBe('Smith (2024)'); // citation at [0,12)
    expect(f.text).toBe('Fragmented run text here.');

    const fragRuns = doc.sourceMap.blocks[f.id]!.runs;
    expect(fragRuns.map((r) => [r.startOffset, r.endOffset])).toEqual([
      [0, 11],
      [11, 20],
      [20, 25],
    ]);
    for (const [i, run] of fragRuns.entries()) {
      expect(f.text.slice(run.startOffset, run.endOffset)).toBe(fragRuns[i]!.text);
    }
  });

  it('decodes entity-encoded fixture text (harvard.docx "&amp;")', () => {
    const doc = parseDocument(readFileSync(join(FIXTURES_DIR, 'documents/docx/harvard.docx')));
    const block = doc.blocks.find((b) => b.text.includes('Research & Development'));
    expect(block).toBeDefined();
    expect(block!.text).toContain('Research & Development cited in Le (2023)');
  });
});

describe('fixture corpus — security samples produce typed errors, never hangs', () => {
  it('throws the expected typed error for each bad sample', () => {
    for (const { file, error } of BAD_SAMPLES) {
      const bytes = readFileSync(join(FIXTURES_DIR, file));
      expect(() => parseDocument(bytes), file).toThrow(error);
      // Typed-error family sanity: it must NOT be a different typed error.
      const other = error === ZipBombError ? NotADocxError : ZipBombError;
      expect(() => parseDocument(bytes), file).not.toThrow(other);
    }
  });

  it('parses the macro-bearing vba-sample.docx as a VALID document', () => {
    const doc = parseDocument(readFileSync(join(FIXTURES_DIR, 'security/vba-sample.docx')));
    expect(doc.blocks.length).toBeGreaterThan(0);
    expect(doc.security?.macrosPresent).toBe(true);
  });
});
