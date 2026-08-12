/**
 * S01-T6 — document parse / footnotes+endnotes / metadata / build-model /
 * public parseDocument API tests.
 *
 * Covers the T6 contract end to end:
 *  - `parseDocument(buffer)` returns a complete §15 AcademicDocument for a
 *    real minimal .docx built inline (heading + paragraphs + fragmented runs
 *    + table + footnote + endnote + styles + core.xml): block order, true
 *    part ordinals, metadata, sourceMap, offset round-trip (R009);
 *  - typed errors on invalid input: NotADocxError (garbage / non-DOCX zip),
 *    ZipBombError (oversized lying entry — R016);
 *  - structured-citation field markers preserved on the model for S03
 *    (Zotero ADDIN, Word CITATION incl. split instrText, fldSimple) while the
 *    cached field RESULT stays in `text`;
 *  - failure isolation (§88): malformed content is recorded in
 *    `parseIssues`, never thrown;
 *  - security (R002/R019/R022): vbaProject.bin flagged (macrosPresent, never
 *    decoded), external relationship targets recorded and never followed;
 *  - determinism (R008): the same bytes parse deep-equal twice.
 *
 * Fixture strategy: every archive is built inline with fflate `zipSync`
 * (authoring side only) or the hand-rolled `craftZip` for lying-size bomb
 * fixtures — no gitignored paths, no on-disk files (T7 owns committed
 * fixtures). Deterministic byte content throughout.
 */

import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';

import type { AcademicDocument, DocumentBlock, RunSpan } from '@citesync/document-model';

import { parseDocument } from '../src/index.js';
import { extractCoreProperties } from '../src/metadata.js';
import { scanNotePart } from '../src/parser/footnotes.js';
import { DOCX_ENTRY_MAX } from '../src/zip/limits.js';
import { NotADocxError, ZipBombError } from '../src/zip/errors.js';

const enc = new TextEncoder();

// ---------------------------------------------------------------------------
// Inline fixture helpers (deterministic, no on-disk files)
// ---------------------------------------------------------------------------

/** Real ZIP (store) via fflate, as a valid .docx would be produced. */
function realZip(files: Record<string, string>): Uint8Array {
  return zipSync(
    Object.fromEntries(
      Object.entries(files).map(([name, content]) => [name, enc.encode(content)]),
    ),
    { level: 0 },
  );
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '</Types>';

const DOC = (body: string): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:document ${W}><w:body>${body}</w:body></w:document>`;

/** A document.xml body exercising every block kind + run fragmentation. */
const FULL_BODY =
  // doc-p0: heading by style
  '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Introduction</w:t></w:r></w:p>' +
  // doc-p1: plain citation paragraph
  '<w:p><w:r><w:t>Smith (2024) proposed a theory about citation linters.</w:t></w:r></w:p>' +
  // doc-p2: one phrase fragmented across three runs
  '<w:p><w:r><w:t>See also </w:t></w:r><w:r><w:t>Doe</w:t></w:r><w:r><w:t> (2020).</w:t></w:r></w:p>' +
  // doc-t0: table with a citation in a cell
  '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell citation (Brown, 2019)</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
  // doc-p4 (part ordinal 4: the cell paragraph occupies ordinal 3)
  '<w:p><w:r><w:t>After the table.</w:t></w:r></w:p>' +
  // sectPr ignored (not a block)
  '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>';

const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  `<w:styles ${W}>` +
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>' +
  '</w:styles>';

const FOOTNOTES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  `<w:footnotes ${W}>` +
  // separator (id -1) + continuationSeparator (type attr): skipped
  '<w:footnote w:id="-1"><w:p><w:r><w:t>separator</w:t></w:r></w:p></w:footnote>' +
  '<w:footnote w:id="0" w:type="continuationSeparator"><w:p><w:r><w:t>cont</w:t></w:r></w:p></w:footnote>' +
  // real notes
  '<w:footnote w:id="1"><w:p><w:r><w:t>Footnote one: (Lee, 2021).</w:t></w:r></w:p></w:footnote>' +
  '<w:footnote w:id="2"><w:p><w:r><w:t>Footnote two</w:t></w:r></w:p><w:p><w:r><w:t>second paragraph</w:t></w:r></w:p></w:footnote>' +
  '</w:footnotes>';

const ENDNOTES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  `<w:endnotes ${W}>` +
  '<w:endnote w:id="1"><w:p><w:r><w:t>Endnote A (Wang, 2018).</w:t></w:r></w:p></w:endnote>' +
  '</w:endnotes>';

const CORE_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
  'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
  'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
  '<dc:title>Citation Linter Study</dc:title>' +
  '<dc:creator>Jane Doe</dc:creator>' +
  '<dcterms:created xsi:type="dcterms:W3CDTF">2024-01-15T10:30:00Z</dcterms:created>' +
  '<dcterms:modified xsi:type="dcterms:W3CDTF">2024-02-01T08:00:00Z</dcterms:modified>' +
  '</cp:coreProperties>';

/** The full-featured minimal .docx used by the golden end-to-end tests. */
function fullDocxBytes(): Uint8Array {
  return realZip({
    '[Content_Types].xml': CONTENT_TYPES,
    'word/document.xml': DOC(FULL_BODY),
    'word/styles.xml': STYLES_XML,
    'word/footnotes.xml': FOOTNOTES_XML,
    'word/endnotes.xml': ENDNOTES_XML,
    'docProps/core.xml': CORE_XML,
  });
}

/** Assert every run in every block's source-map entry is slice-exact (R009). */
function expectSliceExact(doc: AcademicDocument): void {
  for (const block of doc.blocks) {
    const entry = doc.sourceMap.blocks[block.id];
    expect(entry, `sourceMap has ${block.id}`).toBeDefined();
    expect(entry!.runs.length, `${block.id} has runs`).toBeGreaterThan(0);
    for (const r of entry!.runs) {
      expect(
        block.text.slice(r.startOffset, r.endOffset),
        `run ${r.runIndex} of ${block.id} slices back`,
      ).toBe(r.text);
    }
  }
}

// ---------------------------------------------------------------------------
// parseDocument end to end
// ---------------------------------------------------------------------------

describe('parseDocument — complete AcademicDocument (golden inline docx)', () => {
  const bytes = fullDocxBytes();
  const doc = parseDocument(bytes);

  it('returns blocks in document order with deterministic ids', () => {
    expect(doc.blocks.map((b) => b.id)).toEqual([
      'doc-p0',
      'doc-p1',
      'doc-p2',
      'doc-t0',
      'doc-p4',
      'fn-fn0',
      'fn-fn1',
      'en-fn0',
    ]);
  });

  it('classifies the heading by style and flattens the table + notes', () => {
    const byId = new Map(doc.blocks.map((b) => [b.id, b]));
    expect(byId.get('doc-p0')).toMatchObject({ type: 'heading', style: 'Heading1' });
    expect(byId.get('doc-p1')!.type).toBe('paragraph');
    expect(byId.get('doc-t0')).toMatchObject({ type: 'table', text: 'cell citation (Brown, 2019)' });
    expect(byId.get('fn-fn0')).toMatchObject({ type: 'footnote', text: 'Footnote one: (Lee, 2021).' });
    expect(byId.get('fn-fn1')).toMatchObject({
      type: 'footnote',
      text: 'Footnote two\nsecond paragraph',
    });
    expect(byId.get('en-fn0')).toMatchObject({ type: 'endnote', text: 'Endnote A (Wang, 2018).' });
  });

  it('coalesces fragmented runs into contiguous visible text', () => {
    const p2 = doc.blocks.find((b) => b.id === 'doc-p2')!;
    expect(p2.text).toBe('See also Doe (2020).');
  });

  it('keeps true part ordinals (table-internal paragraphs counted)', () => {
    const p4 = doc.blocks.find((b) => b.id === 'doc-p4')!;
    expect(p4.source.paragraphIndex).toBe(4); // the cell paragraph holds ordinal 3
    expect(doc.sourceMap.blocks['doc-p4']!.paragraphIndex).toBe(4);
  });

  it('records source locations per block (R009 evidence)', () => {
    for (const b of doc.blocks) {
      expect(b.source.blockId).toBe(b.id);
      expect(b.source.startOffset).toBe(0);
      expect(b.source.endOffset).toBe(b.text.length);
    }
  });

  it('source map has version 1 and slice-exact runs for every block', () => {
    expect(doc.sourceMap.version).toBe(1);
    expectSliceExact(doc);
  });

  it('extracts core-properties metadata', () => {
    expect(doc.metadata).toEqual({
      title: 'Citation Linter Study',
      author: 'Jane Doe',
      created: '2024-01-15T10:30:00Z',
      modified: '2024-02-01T08:00:00Z',
    });
  });

  it('leaves bibliography undefined and citations empty (S02/S03 stubs)', () => {
    expect(doc.bibliography).toBeUndefined();
    expect(doc.citations).toEqual([]);
    expect(doc.parseIssues).toBeUndefined(); // golden doc parses cleanly
    expect(doc.security).toBeUndefined();
  });

  it('accepts ArrayBuffer input as well as Uint8Array', () => {
    const copy = fullDocxBytes();
    const fromAb = parseDocument(copy.buffer.slice(0, copy.byteLength) as ArrayBuffer);
    expect(fromAb.blocks.map((b) => b.id)).toEqual(doc.blocks.map((b) => b.id));
  });

  it('is deterministic: the same bytes parse deep-equal twice (R008)', () => {
    expect(parseDocument(bytes)).toEqual(parseDocument(bytes));
  });
});

// ---------------------------------------------------------------------------
// Structured-citation field markers preserved for S03 (research §5c)
// ---------------------------------------------------------------------------

describe('parseDocument — field/structured-citation markers (S03 backbone)', () => {
  it('preserves a Zotero ADDIN field marker while text keeps the cached result', () => {
    const body =
      '<w:p>' +
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText xml:space="preserve"> ADDIN ZOTERO_ITEM CSL_CITATION {"citationID":"a1b2","formattedCitation":"(Smith, 2024)"}</w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      '<w:r><w:t>(Smith, 2024)</w:t></w:r>' +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
      '</w:p>';
    const doc = parseDocument(realZip({ '[Content_Types].xml': CONTENT_TYPES, 'word/document.xml': DOC(body) }));
    const block = doc.blocks[0]!;
    expect(block.text).toBe('(Smith, 2024)'); // cached result, not the code
    expect(block.fields).toHaveLength(1);
    expect(block.fields![0]).toContain('ADDIN ZOTERO_ITEM CSL_CITATION');
  });

  it('preserves a Word CITATION field with instrText split across runs (joined)', () => {
    const body =
      '<w:p>' +
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText> CITATION Smi22 </w:instrText></w:r>' +
      '<w:r><w:instrText> \\l 1033 </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      '<w:r><w:t>(Smith, 2022)</w:t></w:r>' +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
      '</w:p>';
    const doc = parseDocument(realZip({ '[Content_Types].xml': CONTENT_TYPES, 'word/document.xml': DOC(body) }));
    const block = doc.blocks[0]!;
    expect(block.text).toBe('(Smith, 2022)');
    expect(block.fields).toEqual([' CITATION Smi22  \\l 1033 ']);
  });

  it('preserves a fldSimple instruction (entity-decoded) as a marker', () => {
    const body =
      '<w:p><w:fldSimple w:instr=" HYPERLINK &quot;https://example.com/x&quot; ">' +
      '<w:r><w:t>link text</w:t></w:r></w:fldSimple></w:p>';
    const doc = parseDocument(realZip({ '[Content_Types].xml': CONTENT_TYPES, 'word/document.xml': DOC(body) }));
    const block = doc.blocks[0]!;
    expect(block.text).toBe('link text');
    expect(block.fields![0]).toBe(' HYPERLINK "https://example.com/x" ');
  });

  it('leaves blocks without fields marker-free', () => {
    const body = '<w:p><w:r><w:t>plain text</w:t></w:r></w:p>';
    const doc = parseDocument(realZip({ '[Content_Types].xml': CONTENT_TYPES, 'word/document.xml': DOC(body) }));
    expect(doc.blocks[0]!.fields).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Typed errors on invalid input (R019/R022/R016)
// ---------------------------------------------------------------------------

describe('parseDocument — typed security errors', () => {
  it('throws NotADocxError for a garbage (non-zip) buffer', () => {
    expect(() => parseDocument(new Uint8Array([1, 2, 3, 4]))).toThrow(NotADocxError);
    expect(() => parseDocument(new ArrayBuffer(4))).toThrow(NotADocxError);
  });

  it('throws NotADocxError for a zip that is not a DOCX (missing required parts)', () => {
    const notDocx = zipSync({ 'foo.txt': enc.encode('hi') }, { level: 0 });
    expect(() => parseDocument(notDocx)).toThrow(NotADocxError);
  });

  it('throws ZipBombError for an oversized lying entry (R016), no OOM/hang', () => {
    const bomb = craftZip([
      { name: '[Content_Types].xml', method: 0, declaredSize: CONTENT_TYPES.length, data: enc.encode(CONTENT_TYPES) },
      {
        name: 'word/document.xml',
        method: 0,
        declaredSize: DOCX_ENTRY_MAX + 1,
        data: enc.encode('<w:document/>'),
      },
    ]);
    expect(() => parseDocument(bomb)).toThrow(ZipBombError);
  });

  it('throws NotADocxError for a truncated zip buffer', () => {
    const full = fullDocxBytes();
    expect(() => parseDocument(full.slice(0, full.length - 12))).toThrow(NotADocxError);
  });
});

// ---------------------------------------------------------------------------
// Failure isolation (§88)
// ---------------------------------------------------------------------------

describe('parseDocument — failure isolation (never throws on malformed content)', () => {
  it('records an unterminated paragraph in parseIssues and keeps the rest', () => {
    const body =
      '<w:p><w:r><w:t>Good paragraph.</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Broken tail'; // unterminated at EOF
    const doc = parseDocument(realZip({ '[Content_Types].xml': CONTENT_TYPES, 'word/document.xml': DOC(body) }));
    expect(doc.blocks.length).toBeGreaterThan(0);
    expect(doc.blocks[0]!.text).toBe('Good paragraph.');
    expect(doc.parseIssues).toBeDefined();
    expect(doc.parseIssues!.some((i) => i.part === 'word/document.xml' && i.code === 'malformed-content')).toBe(true);
  });

  it('records a not-xml document part without throwing', () => {
    const doc = parseDocument(realZip({ '[Content_Types].xml': CONTENT_TYPES, 'word/document.xml': 'just text, no markup' }));
    expect(doc.blocks).toEqual([]);
    expect(doc.parseIssues!.some((i) => i.code === 'not-xml')).toBe(true);
  });

  it('records a malformed (unterminated) note without throwing', () => {
    const fnXml =
      '<?xml version="1.0"?>' +
      `<w:footnotes ${W}>` +
      '<w:footnote w:id="1"><w:p><w:r><w:t>Note A</w:t></w:r></w:p></w:footnote>' +
      '<w:footnote w:id="2"><w:p><w:r><w:t>unterminated'; // no close
    const doc = parseDocument(
      realZip({
        '[Content_Types].xml': CONTENT_TYPES,
        'word/document.xml': DOC('<w:p><w:r><w:t>Body.</w:t></w:r></w:p>'),
        'word/footnotes.xml': fnXml,
      }),
    );
    expect(doc.blocks.some((b) => b.id === 'fn-fn0')).toBe(true); // Note A kept
    expect(doc.parseIssues!.some((i) => i.part === 'word/footnotes.xml')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Security: macros + remote targets are note-and-skip, never executed/followed
// ---------------------------------------------------------------------------

describe('parseDocument — security notes (R002/R019/R022, §87)', () => {
  it('flags vbaProject.bin as macrosPresent without decoding or executing it', () => {
    const parts = realZip({
      '[Content_Types].xml': CONTENT_TYPES,
      'word/document.xml': DOC('<w:p><w:r><w:t>safe body</w:t></w:r></w:p>'),
      'word/vbaProject.bin': '\u0000\u0001\u0002FAKEVBA\u00ff', // never decoded
    });
    const doc = parseDocument(parts);
    expect(doc.security).toBeDefined();
    expect(doc.security!.macrosPresent).toBe(true);
    expect(doc.blocks[0]!.text).toBe('safe body'); // parse still succeeds
  });

  it('records external relationship targets but never follows them', () => {
    const rels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://evil.example/x" TargetMode="External"/>' +
      '<Relationship Id="rId3" Type=".../hyperlink" Target="file:///etc/passwd" TargetMode="External"/>' +
      '</Relationships>';
    const doc = parseDocument(
      realZip({
        '[Content_Types].xml': CONTENT_TYPES,
        'word/document.xml': DOC('<w:p><w:r><w:t>body</w:t></w:r></w:p>'),
        'word/_rels/document.xml.rels': rels,
      }),
    );
    expect(doc.security!.remoteTargets).toEqual([
      'https://evil.example/x',
      'file:///etc/passwd',
    ]);
    expect(doc.security!.macrosPresent).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// footnotes.xml / endnotes.xml unit surface
// ---------------------------------------------------------------------------

describe('scanNotePart — footnotes part', () => {
  it('skips separator/continuation notes and numbers only real notes', () => {
    const notes = scanNotePart(FOOTNOTES_XML);
    expect(notes.map((n) => n.sourceId)).toEqual(['1', '2']);
    expect(notes.map((n) => n.noteIndex)).toEqual([0, 1]);
    expect(notes[0]!.text).toBe('Footnote one: (Lee, 2021).');
  });

  it('drops blank notes', () => {
    const xml =
      '<?xml version="1.0"?>' +
      `<w:footnotes ${W}>` +
      '<w:footnote w:id="1"><w:p><w:r><w:t>real</w:t></w:r></w:p></w:footnote>' +
      '<w:footnote w:id="2"><w:p><w:r><w:t>   </w:t></w:r></w:p></w:footnote>' +
      '</w:footnotes>';
    expect(scanNotePart(xml).map((n) => n.sourceId)).toEqual(['1']);
  });

  it('flags an unterminated note as malformed without throwing', () => {
    const xml =
      '<?xml version="1.0"?>' +
      `<w:footnotes ${W}>` +
      '<w:footnote w:id="1"><w:p><w:r><w:t>Note A</w:t></w:r></w:p></w:footnote>' +
      '<w:footnote w:id="2"><w:p><w:r><w:t>unterminated';
    const notes = scanNotePart(xml);
    expect(notes.map((n) => n.sourceId)).toEqual(['1', '2']);
    expect(notes[1]!.malformed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// metadata unit surface
// ---------------------------------------------------------------------------

describe('extractCoreProperties — metadata', () => {
  it('extracts title/author/created/modified from core.xml', () => {
    expect(extractCoreProperties(CORE_XML)).toEqual({
      title: 'Citation Linter Study',
      author: 'Jane Doe',
      created: '2024-01-15T10:30:00Z',
      modified: '2024-02-01T08:00:00Z',
    });
  });

  it('returns safe defaults (empty) for a missing part', () => {
    expect(extractCoreProperties(undefined)).toEqual({});
    expect(extractCoreProperties('')).toEqual({});
  });

  it('entity-decodes values and treats whitespace-only as absent', () => {
    const xml =
      '<?xml version="1.0"?>' +
      '<cp:coreProperties xmlns:cp="x" xmlns:dc="y"><dc:title>Caf&#233; &amp; Tea</dc:title>' +
      '<dc:creator>   </dc:creator></cp:coreProperties>';
    expect(extractCoreProperties(xml)).toEqual({ title: 'Café & Tea' });
  });

  it('never throws on a broken part (unterminated tail)', () => {
    const xml = '<?xml version="1.0"?><cp:coreProperties xmlns:cp="x" xmlns:dc="y">' +
      '<dc:title>Partial title</dc:title><dc:creator>Jane';
    expect(extractCoreProperties(xml)).toEqual({ title: 'Partial title', author: 'Jane' });
  });
});

// ---------------------------------------------------------------------------
// Hand-rolled ZIP with lying sizes (bomb fixture, R016)
// ---------------------------------------------------------------------------

function u16(v: number, b: Uint8Array, o: number): void {
  b[o] = v & 0xff;
  b[o + 1] = (v >>> 8) & 0xff;
}
function u32(v: number, b: Uint8Array, o: number): void {
  b[o] = v & 0xff;
  b[o + 1] = (v >>> 8) & 0xff;
  b[o + 2] = (v >>> 16) & 0xff;
  b[o + 3] = (v >>> 24) & 0xff;
}

interface CraftEntry {
  name: string;
  method: number;
  declaredSize: number;
  data: Uint8Array;
}

/**
 * Hand-roll a ZIP whose central directory declares sizes far larger than the
 * payload. Only a filter that runs BEFORE decompression (S01-T3) can reject
 * this as ZipBombError — a decompress-first reader would hit corrupt data.
 */
function craftZip(entries: CraftEntry[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const local = new Uint8Array(30 + name.length + e.data.length);
    u32(0x04034b50, local, 0);
    u16(20, local, 4);
    u16(0x0800, local, 6);
    u16(e.method, local, 8);
    u16(0, local, 10);
    u16(0, local, 12);
    u32(0, local, 14);
    u32(e.declaredSize, local, 18);
    u32(e.declaredSize, local, 22);
    u16(name.length, local, 26);
    u16(0, local, 28);
    local.set(name, 30);
    local.set(e.data, 30 + name.length);
    locals.push(local);
    const central = new Uint8Array(46 + name.length);
    u32(0x02014b50, central, 0);
    u16(20, central, 4);
    u16(20, central, 6);
    u16(0x0800, central, 8);
    u16(e.method, central, 10);
    u16(0, central, 12);
    u16(0, central, 14);
    u32(0, central, 16);
    u32(e.declaredSize, central, 20);
    u32(e.declaredSize, central, 24);
    u16(name.length, central, 28);
    u16(0, central, 30);
    u16(0, central, 32);
    u16(0, central, 34);
    u16(0, central, 36);
    u32(0, central, 38);
    u32(offset, central, 42);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length;
  }
  const cdOffset = offset;
  const cdLen = centrals.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(cdOffset + cdLen + 22);
  let p = 0;
  for (const l of locals) {
    out.set(l, p);
    p += l.length;
  }
  for (const c of centrals) {
    out.set(c, p);
    p += c.length;
  }
  u32(0x06054b50, out, p);
  u16(0, out, p + 4);
  u16(0, out, p + 6);
  u16(entries.length, out, p + 8);
  u16(entries.length, out, p + 10);
  u32(cdLen, out, p + 12);
  u32(cdOffset, out, p + 16);
  u16(0, out, p + 20);
  return out;
}
