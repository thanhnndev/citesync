/**
 * S01-T8 — source-position scanner tests (offset backbone, S01-T4 module).
 *
 * The slice contract (document-model offset semantics): `startOffset`/
 * `endOffset` are CHARACTER offsets within the paragraph TEXT (entity-decoded,
 * UTF-16 code-unit indices), end EXCLUSIVE, so
 * `paragraph.text.slice(startOffset, endOffset) === run.text` exactly.
 *
 * Covers the T8 contract for this module:
 *  - char-offset accuracy on hand-authored XML strings: every `xmlStartOffset`
 *    / `xmlEndOffset` / `startOffset` / `endOffset` is asserted against a
 *    hand-computed index (not derived from the implementation);
 *  - entity-decoded length accounting: `&amp;`, `&nbsp;`, numeric refs
 *    (`&#8212;`, `&#x2014;`, astral `&#x1F600;`) shrink the decoded span and
 *    the running offset advances by DECODED length (never raw length);
 *  - `xml:space="preserve"` (double- and single-quoted) flag + raw
 *    whitespace kept verbatim;
 *  - multi-paragraph / multi-run bookkeeping, self-closing `<w:t/>` /
 *    `<w:p/>`, paragraph xml spans;
 *  - determinism (R008): identical input -> identical scan.
 */

import { describe, expect, it } from 'vitest';

import { scanWtOffsets } from '../src/xml/source-position.js';
import { decodeEntities } from '../src/xml/entities.js';

/** Assert every run of a scan slices back to its own text (slice contract). */
function expectSliceExact(scan: ReturnType<typeof scanWtOffsets>): void {
  for (const p of scan.paragraphs) {
    for (const r of p.runs) {
      expect(p.text.slice(r.startOffset, r.endOffset), `paragraph ${p.paragraphIndex} run ${r.runIndex}`).toBe(
        r.text,
      );
    }
  }
}

describe('xml/source-position.ts — char-offset accuracy (hand-computed)', () => {
  it('reports exact absolute xml offsets and paragraph-text offsets', () => {
    // Hand-computed indexes for this exact string (verified char-by-char):
    //   "<w:document>"  [0,12)  "<w:body>" [12,20)  "<w:p>" [20,25)
    //   "<w:r>" [25,30)  "<w:t>" [30,35)  "Hi" [35,37)
    //   "</w:t>" [37,43)  "</w:r>" [43,49)  "</w:p>" [49,55)
    //   "</w:body>" [55,63)  "</w:document>" [64,77)
    const xml =
      '<w:document><w:body><w:p><w:r><w:t>Hi</w:t></w:r></w:p></w:body></w:document>';
    const scan = scanWtOffsets(xml);

    expect(scan.paragraphs).toHaveLength(1);
    const p = scan.paragraphs[0]!;
    expect(p.paragraphIndex).toBe(0);
    expect(p.xmlStartOffset).toBe(20); // the '<' of "<w:p"
    expect(p.xmlEndOffset).toBe(55); // just past '>' of "</w:p>"
    expect(p.text).toBe('Hi');

    expect(p.runs).toHaveLength(1);
    const r = p.runs[0]!;
    expect(r.paragraphIndex).toBe(0);
    expect(r.runIndex).toBe(0);
    expect(r.text).toBe('Hi');
    expect(r.xmlStartOffset).toBe(35); // just past '>' of "<w:t>"
    expect(r.xmlEndOffset).toBe(37); // the '<' of "</w:t>"
    expect(r.startOffset).toBe(0);
    expect(r.endOffset).toBe(2);
    expect(p.text.slice(r.startOffset, r.endOffset)).toBe('Hi');
  });

  it('keeps the slice contract for a multi-run paragraph with attributes', () => {
    const xml =
      '<w:document><w:body>' +
      '<w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t xml:space="preserve"> world</w:t></w:r></w:p>' +
      '</w:body></w:document>';
    const scan = scanWtOffsets(xml);

    expect(scan.paragraphs).toHaveLength(1);
    const p = scan.paragraphs[0]!;
    expect(p.text).toBe('Hello world');
    expect(p.runs.map((r) => r.text)).toEqual(['Hello', ' world']);
    expect(p.runs.map((r) => [r.startOffset, r.endOffset])).toEqual([
      [0, 5],
      [5, 11],
    ]);
    // The second run declared xml:space preserve; the first did not.
    expect(p.runs[0]!.preserveSpace).toBe(false);
    expect(p.runs[1]!.preserveSpace).toBe(true);
    expectSliceExact(scan);
  });
});

describe('xml/source-position.ts — entity-decoded length accounting', () => {
  it('advances offsets by DECODED length for &amp; (predefined entity)', () => {
    const xml = '<w:p><w:r><w:t>Smith &amp; Lee</w:t></w:r></w:p>';
    const scan = scanWtOffsets(xml);
    const p = scan.paragraphs[0]!;
    const r = p.runs[0]!;

    // Raw content is 15 chars, decoded is 11 -> delta -4.
    expect(decodeEntities('Smith &amp; Lee').decoded).toBe('Smith & Lee');
    expect(decodeEntities('Smith &amp; Lee').delta).toBe(-4);
    expect(r.text).toBe('Smith & Lee');
    expect(r.entityDelta).toBe(-4);
    expect(r.startOffset).toBe(0);
    expect(r.endOffset).toBe(11);
    expect(p.text.slice(r.startOffset, r.endOffset)).toBe('Smith & Lee');
  });

  it('accounts for nbsp + numeric (decimal and hex) entities', () => {
    // raw "a&nbsp;b&#8212;c&#x2014;d" is 25 chars; decoded is 7 chars.
    const xml = '<w:p><w:r><w:t>a&nbsp;b&#8212;c&#x2014;d</w:t></w:r></w:p>';
    const scan = scanWtOffsets(xml);
    const p = scan.paragraphs[0]!;
    const r = p.runs[0]!;

    expect(r.text).toBe('a\u00A0b\u2014c\u2014d');
    expect(r.entityDelta).toBe(-18);
    expect(r.startOffset).toBe(0);
    expect(r.endOffset).toBe(7);
    expect(p.text).toBe('a\u00A0b\u2014c\u2014d');
    expectSliceExact(scan);
  });

  it('keeps the running offset aligned ACROSS runs containing entities', () => {
    // Run 0 raw "a&nbsp;" (7 raw chars) -> "a\u00A0" (2 decoded).
    // Run 1 raw " b&#8212;c" (9 raw chars) -> " b\u2014c" (4 decoded).
    const xml = '<w:p><w:r><w:t>a&nbsp;</w:t></w:r><w:r><w:t> b&#8212;c</w:t></w:r></w:p>';
    const scan = scanWtOffsets(xml);
    const p = scan.paragraphs[0]!;

    expect(p.text).toBe('a\u00A0 b\u2014c');
    expect(p.runs.map((r) => r.text)).toEqual(['a\u00A0', ' b\u2014c']);
    expect(p.runs.map((r) => [r.startOffset, r.endOffset])).toEqual([
      [0, 2],
      [2, 6],
    ]);
    // entityDelta is per-run and only ever <= 0.
    for (const r of p.runs) {
      expect(r.entityDelta).toBeLessThanOrEqual(0);
    }
    expectSliceExact(scan);
  });

  it('counts astral numeric refs as UTF-16 code units (slice semantics)', () => {
    // "&#x1F600;" decodes to 😀 which is TWO UTF-16 code units.
    const xml = '<w:p><w:r><w:t>&#x1F600;x</w:t></w:r></w:p>';
    const scan = scanWtOffsets(xml);
    const p = scan.paragraphs[0]!;
    const r = p.runs[0]!;

    expect(r.text).toBe('\u{1F600}x');
    expect(r.endOffset).toBe(3); // 2 for the astral char + 1 for 'x'
    expect(p.text.slice(r.startOffset, r.endOffset)).toBe('\u{1F600}x');
    expect(p.text.length).toBe(3);
  });
});

describe('xml/source-position.ts — xml:space preserve handling', () => {
  it('flags preserve and keeps raw whitespace verbatim (double quotes)', () => {
    const xml = '<w:p><w:r><w:t xml:space="preserve">  spaced  </w:t></w:r></w:p>';
    const scan = scanWtOffsets(xml);
    const r = scan.paragraphs[0]!.runs[0]!;

    expect(r.preserveSpace).toBe(true);
    expect(r.text).toBe('  spaced  ');
    expect([r.startOffset, r.endOffset]).toEqual([0, 10]);
  });

  it('flags preserve for the single-quoted attribute form too', () => {
    const xml = "<w:p><w:r><w:t xml:space='preserve'>Y</w:t></w:r></w:p>";
    const r = scanWtOffsets(xml).paragraphs[0]!.runs[0]!;
    expect(r.preserveSpace).toBe(true);
    expect(r.text).toBe('Y');
  });

  it('leaves preserve false when the attribute is absent', () => {
    const xml = '<w:p><w:r><w:t> X </w:t></w:r></w:p>';
    const r = scanWtOffsets(xml).paragraphs[0]!.runs[0]!;
    expect(r.preserveSpace).toBe(false);
    expect(r.text).toBe(' X ');
  });
});

describe('xml/source-position.ts — paragraph/run bookkeeping', () => {
  it('tracks paragraphIndex and resets runIndex per paragraph', () => {
    const xml =
      '<w:document><w:body>' +
      '<w:p><w:r><w:t>One</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Two</w:t></w:r></w:p>' +
      '</w:body></w:document>';
    const scan = scanWtOffsets(xml);

    expect(scan.paragraphs).toHaveLength(2);
    expect(scan.paragraphs[0]!.paragraphIndex).toBe(0);
    expect(scan.paragraphs[0]!.text).toBe('One');
    expect(scan.paragraphs[1]!.paragraphIndex).toBe(1);
    expect(scan.paragraphs[1]!.text).toBe('Two');
    expect(scan.paragraphs[1]!.xmlStartOffset).toBe(56); // hand-computed

    // Flattened run list is document-ordered with paragraphIndex attached.
    expect(scan.runs.map((r) => [r.paragraphIndex, r.runIndex, r.text])).toEqual([
      [0, 0, 'One'],
      [1, 0, 'Two'],
    ]);
    expectSliceExact(scan);
  });

  it('records a self-closing <w:p/> as a run-less paragraph', () => {
    const xml =
      '<w:document><w:body><w:p/><w:p><w:r><w:t>A</w:t></w:r></w:p></w:body></w:document>';
    const scan = scanWtOffsets(xml);

    expect(scan.paragraphs).toHaveLength(2);
    expect(scan.paragraphs[0]!.text).toBe('');
    expect(scan.paragraphs[0]!.runs).toHaveLength(0);
    expect(scan.paragraphs[1]!.text).toBe('A');
  });

  it('records a self-closing <w:t/> as a zero-length run at the current offset', () => {
    const xml = '<w:p><w:r><w:t/></w:r><w:r><w:t>A</w:t></w:r></w:p>';
    const scan = scanWtOffsets(xml);
    const p = scan.paragraphs[0]!;

    expect(p.runs).toHaveLength(2);
    expect(p.runs[0]!.text).toBe('');
    expect([p.runs[0]!.startOffset, p.runs[0]!.endOffset]).toEqual([0, 0]);
    expect(p.runs[1]!.text).toBe('A');
    expect([p.runs[1]!.startOffset, p.runs[1]!.endOffset]).toEqual([0, 1]);
    expect(p.text).toBe('A');
  });

  it("tolerates a '>' inside a quoted attribute value (quote-aware tag scan)", () => {
    // The attribute value contains '>' which must NOT end the tag; the '>'
    // inside the text content is escaped (&gt;) and decodes to '>'.
    const xml = '<w:p><w:r><w:t xml:space="preserve">x&gt;y</w:t></w:r></w:p>';
    const scan = scanWtOffsets(xml);
    const p = scan.paragraphs[0]!;
    const r = p.runs[0]!;

    expect(r.text).toBe('x>y');
    expect(r.preserveSpace).toBe(true);
    expect(p.text.slice(r.startOffset, r.endOffset)).toBe('x>y');
  });
});

describe('xml/source-position.ts — determinism (R008)', () => {
  it('produces a deep-equal scan for identical input', () => {
    const xml =
      '<w:document><w:body>' +
      '<w:p><w:r><w:t>Smith &amp; Lee</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t xml:space="preserve"> a&nbsp;b&#8212;c </w:t></w:r></w:p>' +
      '</w:body></w:document>';
    expect(scanWtOffsets(xml)).toEqual(scanWtOffsets(xml));
  });
});
