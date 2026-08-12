import { describe, expect, it } from 'vitest';

import { NS, localName, namespaceUri, prefix, splitName } from '../src/xml/ns.js';
import { decodeEntities, decodeEntityReference } from '../src/xml/entities.js';
import { scanWtOffsets } from '../src/xml/source-position.js';
import type { WtRunScan } from '../src/xml/source-position.js';

describe('xml/ns.ts — OOXML namespace constants + local-name helpers', () => {
  it('exposes canonical URIs for the convention prefixes', () => {
    expect(NS.w).toBe('http://schemas.openxmlformats.org/wordprocessingml/2006/main');
    expect(namespaceUri('w')).toBe(NS.w);
    expect(namespaceUri('r')).toContain('/officeDocument/2006/relationships');
    expect(namespaceUri('cp')).toContain('/metadata/core-properties');
    expect(namespaceUri('dc')).toBe('http://purl.org/dc/elements/1.1/');
    expect(namespaceUri('dcterms')).toBe('http://purl.org/dc/terms/');
  });

  it('localName strips the prefix from w:t / w:p / xml:space', () => {
    expect(localName('w:t')).toBe('t');
    expect(localName('w:p')).toBe('p');
    expect(localName('w:document')).toBe('document');
    expect(localName('xml:space')).toBe('space');
    expect(localName('t')).toBe('t');
    expect(localName('pStyle')).toBe('pStyle');
  });

  it('prefix extracts the leading prefix and returns undefined when unqualified', () => {
    expect(prefix('w:t')).toBe('w');
    expect(prefix('xml:lang')).toBe('xml');
    expect(prefix('p')).toBe(undefined);
    expect(prefix(':bad')).toBe(undefined);
    expect(prefix('a:b:c')).toBe(undefined); // malformed qualified name
  });

  it('splitName returns both parts', () => {
    expect(splitName('w:t')).toEqual({ prefix: 'w', local: 't' });
    expect(splitName('para')).toEqual({ local: 'para' });
  });

  it('namespaceUri never fabricates a URI for unknown prefixes', () => {
    expect(namespaceUri('zzz')).toBe(undefined);
  });
});

describe('xml/entities.ts — deterministic entity decoder', () => {
  it('decodes the five XML predefined entities', () => {
    expect(decodeEntities('a&amp;b').decoded).toBe('a&b');
    expect(decodeEntities('&lt;x&gt;').decoded).toBe('<x>');
    expect(decodeEntities('&quot;q&quot;&apos;').decoded).toBe('"q"\'');
  });

  it('decodes nbsp to U+00A0', () => {
    const r = decodeEntities('Nguyễn&nbsp;Văn');
    expect(r.decoded).toBe('Nguyễn\u00A0Văn');
    expect(r.delta).toBe(1 - 6); // nbsp is 6 raw chars -> 1 decoded char
    expect(decodeEntityReference('nbsp')).toBe('\u00A0');
  });

  it('decodes numeric decimal and hex references', () => {
    expect(decodeEntities('&#65;').decoded).toBe('A');
    expect(decodeEntities('&#x41;').decoded).toBe('A');
    expect(decodeEntities('&#8364;').decoded).toBe('€');
    expect(decodeEntityReference('#x1F600')).toBe('\u{1F600}');
    expect(decodeEntityReference('#X1F600')).toBe('\u{1F600}');
  });

  it('leaves unknown named and malformed numeric references verbatim', () => {
    expect(decodeEntities('&zzz;').decoded).toBe('&zzz;');
    expect(decodeEntities('&#;').decoded).toBe('&#;');
    expect(decodeEntities('&#xZZ;').decoded).toBe('&#xZZ;');
    expect(decodeEntityReference('')).toBe(undefined);
    expect(decodeEntityReference('x')).toBe(undefined); // hex marker with empty digits
  });

  it('rejects out-of-range and surrogate code points', () => {
    expect(decodeEntityReference('x110000')).toBe(undefined);
    expect(decodeEntityReference('xD800')).toBe(undefined); // lone high surrogate
    expect(decodeEntityReference('#0')).toBe('\u0000');
  });

  it('reports the char-length delta (offset/accounting contract)', () => {
    // Two entities -> decoded shrinks by (4-1)+(5-1) = 7 chars.
    const r = decodeEntities('&lt;&amp;');
    expect(r.decoded).toBe('<&');
    expect(r.decoded.length).toBe(2);
    expect(r.delta).toBe(2 - 9);
    // No entities -> delta 0, decoded === raw (same instance semantics).
    const clean = decodeEntities('plain text');
    expect(clean.delta).toBe(0);
    expect(clean.decoded).toBe('plain text');
  });

  it('handles mixed plain text + entities in one pass', () => {
    const r = decodeEntities('a &amp; b &#x2014; c');
    expect(r.decoded).toBe('a & b \u2014 c');
  });

  it('is deterministic across calls (R008)', () => {
    const raw = '&amp;&nbsp;&#201;&#x3B8;';
    const r1 = decodeEntities(raw);
    const r2 = decodeEntities(raw);
    expect(r1).toEqual(r2);
  });
});

describe('xml/source-position.ts — <w:t> offset scanner', () => {
  it('reports start/end char offsets such that paragraph.text.slice equals the run text', () => {
    const xml =
      '<w:document><w:body>' +
      '<w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t xml:space="preserve"> world</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Second</w:t></w:r></w:p>' +
      '</w:body></w:document>';

    const { paragraphs, runs } = scanWtOffsets(xml);

    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]!.text).toBe('Hello world');
    expect(paragraphs[0]!.runs).toHaveLength(2);
    expect(paragraphs[1]!.text).toBe('Second');

    expect(runs).toHaveLength(3);

    const [r0, r1, r2] = runs as [WtRunScan, WtRunScan, WtRunScan];
    expect(r0.text).toBe('Hello');
    expect(paragraphs[0]!.text.slice(r0.startOffset, r0.endOffset)).toBe('Hello');
    expect(r1.text).toBe(' world');
    expect(paragraphs[0]!.text.slice(r1.startOffset, r1.endOffset)).toBe(' world');
    expect(r1.startOffset).toBe(5); // accumulated offset after "Hello"
    expect(r1.endOffset).toBe(11);
    expect(r2.text).toBe('Second');
    expect(paragraphs[1]!.text.slice(r2.startOffset, r2.endOffset)).toBe('Second');
    expect(r2.startOffset).toBe(0);
  });

  it('advances offsets by entity-DECODED length, not raw length', () => {
    const xml =
      '<w:p><w:r><w:t>A&amp;B</w:t></w:r><w:r><w:t>&nbsp;C</w:t></w:r></w:p>';
    const { paragraphs, runs } = scanWtOffsets(xml);

    const para = paragraphs[0]!;
    expect(para.text).toBe('A&B\u00A0C');
    const r0 = runs[0]!;
    const r1 = runs[1]!;
    // "A&amp;B" raw is 6 chars but decoded is 3: the next run must start at 3,
    // NOT at 6.
    expect(r0.startOffset).toBe(0);
    expect(r0.endOffset).toBe(3);
    expect(r1.startOffset).toBe(3);
    expect(r1.endOffset).toBe(5);
    expect(para.text.slice(r0.startOffset, r0.endOffset)).toBe('A&B');
    expect(para.text.slice(r1.startOffset, r1.endOffset)).toBe('\u00A0C');
  });

  it('retains leading/trailing spaces under xml:space="preserve" with correct offsets', () => {
    const xml =
      '<w:p><w:r><w:t xml:space="preserve">  leading</w:t></w:r><w:r><w:t xml:space="preserve">trailing  </w:t></w:r></w:p>';
    const { paragraphs, runs } = scanWtOffsets(xml);

    const para = paragraphs[0]!;
    expect(para.text).toBe('  leadingtrailing  ');
    for (const r of runs) expect(r.preserveSpace).toBe(true);
    expect(runs[0]!.startOffset).toBe(0);
    expect(runs[0]!.endOffset).toBe(9); // '  leading' == 9 chars
    expect(runs[1]!.startOffset).toBe(9);
    expect(runs[1]!.endOffset).toBe(19); // + 'trailing  ' == 10 chars
    expect(para.text.slice(runs[0]!.startOffset, runs[0]!.endOffset)).toBe('  leading');
    expect(para.text.slice(runs[1]!.startOffset, runs[1]!.endOffset)).toBe('trailing  ');
  });

  it('absolutely indexes each <w:t> content within the raw XML string', () => {
    const xml = '<w:document><w:body><w:p><w:r><w:t>AB</w:t></w:r></w:p></w:body></w:document>';
    const { runs } = scanWtOffsets(xml);
    const r = runs[0]!;
    // xml slice between the two markers must be exactly "AB".
    expect(xml.slice(r.xmlStartOffset, r.xmlEndOffset)).toBe('AB');
    // The '>' preceding the content and '<' of the closing tag surround it.
    expect(xml[r.xmlStartOffset - 1]).toBe('>');
    expect(xml[r.xmlEndOffset]).toBe('<');
  });

  it('tracks paragraph boundaries across multiple <w:p>', () => {
    const xml =
      '<w:body>' +
      '<w:p><w:r><w:t>one</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>two</w:t></w:r><w:r><w:t>!two</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>three</w:t></w:r></w:p>' +
      '</w:body>';
    const { paragraphs, runs } = scanWtOffsets(xml);

    expect(paragraphs.map((p) => p.text)).toEqual(['one', 'two!two', 'three']);
    // Each paragraph restarts run offsets at 0.
    expect(runs.map((r) => [r.paragraphIndex, r.startOffset, r.text])).toEqual([
      [0, 0, 'one'],
      [1, 0, 'two'],
      [1, 3, '!two'],
      [2, 0, 'three'],
    ]);
  });

  it('records xml:space only as preserve when declared', () => {
    const xml =
      '<w:p><w:r><w:t xml:space="preserve">x</w:t></w:r><w:r><w:t xml:space="default">y</w:t></w:r><w:r><w:t>z</w:t></w:r></w:p>';
    const { runs } = scanWtOffsets(xml);
    expect(runs[0]!.preserveSpace).toBe(true);
    expect(runs[1]!.preserveSpace).toBe(false);
    expect(runs[2]!.preserveSpace).toBe(false);
  });

  it('handles quotes containing ">" in attributes (quoted-aware tag scan)', () => {
    const xml =
      '<w:p><w:r><w:t xml:space="preserve" w:att="a > b">Z</w:t></w:r></w:p>';
    const { paragraphs, runs } = scanWtOffsets(xml);
    expect(paragraphs[0]!.text).toBe('Z');
    expect(runs[0]!.text).toBe('Z');
  });

  it('skips comments and processing instructions without distorting offsets', () => {
    const xml =
      '<w:p><!-- a comment with <w:t>nested</w:t> markup --><w:r><w:t>A</w:t></w:r></w:p>';
    const { paragraphs, runs } = scanWtOffsets(xml);
    expect(paragraphs[0]!.text).toBe('A');
    expect(runs).toHaveLength(1);
    expect(runs[0]!.text).toBe('A');
  });

  it('handles an empty document / empty paragraph gracefully', () => {
    expect(scanWtOffsets('').runs).toHaveLength(0);
    expect(scanWtOffsets('  ').paragraphs).toHaveLength(1);
    const { paragraphs } = scanWtOffsets('<w:p/>');
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]!.runs).toHaveLength(0);
    expect(paragraphs[0]!.text).toBe('');
  });

  it('is deterministic (R008) across repeated scans', () => {
    const xml =
      '<w:p><w:r><w:t xml:space="preserve">Nguy&#7877;n &amp; Ho</w:t></w:r></w:p>';
    expect(scanWtOffsets(xml)).toEqual(scanWtOffsets(xml));
    // &#7877; == U+1EC5 (ễ).
    expect(scanWtOffsets(xml).paragraphs[0]!.text).toBe('Nguy\u1ec5n & Ho');
  });
});
