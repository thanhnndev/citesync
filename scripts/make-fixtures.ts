#!/usr/bin/env node
/**
 * scripts/make-fixtures.ts — S01-T7: deterministic .docx fixture authoring.
 *
 * Authors the committed .docx binaries under `fixtures/` (research §74/§76)
 * used by the S01 reader integration proof and the T8 fixture/determinism/
 * security tests.
 *
 * AUTHORING NEVER DEPENDS ON THE READER: fixtures are produced with fflate
 * (`zipSync` for the valid packages; a small hand-rolled ZIP writer for the
 * security samples so we can declare hostile sizes) plus hand-authored OOXML
 * strings. A reader bug can therefore never be masked by the authoring path.
 *
 * DETERMINISM (R008/R017) — output is a pure function of the constants below:
 *   - fflate's zipSync embeds a DOS timestamp per entry; we pin `mtime` to a
 *     fixed LOCAL noon (2024-01-01 12:00) so the DOS time/date fields are
 *     identical on every machine and in every timezone.
 *   - Entry order is fixed (object literal insertion order), levels and
 *     deflate output are deterministic, and no Date.now()/Math.random()/fs
 *     timestamps influence the bytes.
 *   - The script self-checks: every package fixture is built twice in memory
 *     and must be byte-identical, and the security samples are re-opened with
 *     a plain fflate filter (never the reader) to prove the declared sizes
 *     and truncation behave as intended.
 *
 * Output: fixtures/minimal.docx, fixtures/author-date/** + documents/docx/** +
 * bibliography/** (corpus), and fixtures/security/** (bomb / truncated /
 * not-a-docx / garbage / vba).
 * Every fixture path is also enumerated in fixtures/README.md (authored
 * here, byte-stable).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { deflateSync, unzipSync, zipSync } from 'fflate';

const MIB = 1024 * 1024;
/** Reader bound we author against (mirrors packages/docx/src/zip/limits.ts). */
const DOCX_ENTRY_MAX = 50 * MIB;

/**
 * Fixed local-noon timestamp. `new Date('2024-01-01T12:00:00')` is parsed as
 * LOCAL time per the ES spec, so the DOS time/date fields derived from it
 * (hours/minutes/seconds via local getters) are identical in every timezone.
 */
const FIXED_MTIME = new Date('2024-01-01T12:00:00');
const DOS_TIME =
  (FIXED_MTIME.getHours() << 11) |
  (FIXED_MTIME.getMinutes() << 5) |
  (FIXED_MTIME.getSeconds() >> 1);
const DOS_DATE =
  ((FIXED_MTIME.getFullYear() - 1980) << 9) |
  ((FIXED_MTIME.getMonth() + 1) << 5) |
  FIXED_MTIME.getDate();

const PROJECT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FIXTURES_DIR = join(PROJECT_ROOT, 'fixtures');

const enc = new TextEncoder();
const u8 = (s: string): Uint8Array => enc.encode(s);

// ---------------------------------------------------------------------------
// CRC-32 (fflate does not export crc32; this is the standard IEEE table
// implementation — pure + deterministic).
// ---------------------------------------------------------------------------

const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// XML escaping (text content: & < >; controlled attribute values never carry
// quotes, so attribute escaping is a no-op by construction).
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Preserve-significant-space attribute when a run carries edge whitespace. */
function spaceAttr(s: string): string {
  return s !== s.trim() ? ' xml:space="preserve"' : '';
}

// ---------------------------------------------------------------------------
// OOXML part templates (hand-authored, byte-stable).
// ---------------------------------------------------------------------------

const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

interface ContentTypesOpts {
  styles?: boolean;
  footnotes?: boolean;
  vba?: boolean;
}

function contentTypesXml(opts: ContentTypesOpts = {}): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '  <Default Extension="xml" ContentType="application/xml"/>',
  ];
  if (opts.vba) {
    lines.push(
      '  <Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/>',
    );
  }
  lines.push(
    '  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
  );
  if (opts.styles) {
    lines.push(
      '  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
    );
  }
  if (opts.footnotes) {
    lines.push(
      '  <Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>',
    );
  }
  lines.push(
    '  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
    '  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
    '</Types>',
  );
  return lines.join('\n');
}

function packageRelsXml(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
    '  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>',
    '  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>',
    '</Relationships>',
  ].join('\n');
}

function corePropsXml(title: string, creator: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"',
    ' xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"',
    ' xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    `  <dc:title>${esc(title)}</dc:title>`,
    `  <dc:creator>${esc(creator)}</dc:creator>`,
    '  <dcterms:created xsi:type="dcterms:W3CDTF">2024-01-15T10:30:00Z</dcterms:created>',
    '  <dcterms:modified xsi:type="dcterms:W3CDTF">2024-02-20T08:00:00Z</dcterms:modified>',
    '</cp:coreProperties>',
  ].join('\n');
}

function appXml(title: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"',
    ' xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">',
    `  <Title>${esc(title)}</Title>`,
    '  <Application>CiteSync fixture author</Application>',
    '  <AppVersion>16.0000</AppVersion>',
    '</Properties>',
  ].join('\n');
}

function stylesXml(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    `<w:styles xmlns:w="${NS_W}">`,
    '  <w:style w:type="paragraph" w:styleId="Heading1">',
    '    <w:name w:val="heading 1"/>',
    '    <w:pPr><w:outlineLvl w:val="0"/></w:pPr>',
    '  </w:style>',
    '  <w:style w:type="paragraph" w:styleId="Normal">',
    '    <w:name w:val="Normal"/>',
    '  </w:style>',
    '</w:styles>',
  ].join('\n');
}

function footnotesXml(notes: string[]): string {
  const items: string[] = [
    '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>',
    '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>',
  ];
  notes.forEach((text, i) => {
    items.push(`<w:footnote w:id="${i + 1}"><w:p><w:r><w:t>${esc(text)}</w:t></w:r></w:p></w:footnote>`);
  });
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    `<w:footnotes xmlns:w="${NS_W}">`,
    ...items.map((s) => `  ${s}`),
    '</w:footnotes>',
  ].join('\n');
}

function documentRelsXml(vba: boolean): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '  <Relationship Id="rIdStyle" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
  ];
  if (vba) {
    lines.push(
      '  <Relationship Id="rIdVba" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/>',
      '  <Relationship Id="rIdExt" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="https://evil.example/macro.dotm" TargetMode="External"/>',
      '  <Relationship Id="rIdUnc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="\\\\nas.example\\share\\template.dotx" TargetMode="External"/>',
    );
  }
  lines.push('</Relationships>');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// word/document.xml builder — small paragraph DSL.
// ---------------------------------------------------------------------------

type RunSpec =
  | { kind: 'text'; text: string }
  | { kind: 'field'; instr: string; display: string }
  | { kind: 'note'; id: string };

interface ParaSpec {
  /** Ordered run content: plain text, structured-citation fields, note refs. */
  runs: RunSpec[];
  /** Apply the Heading1 paragraph style (requires styles.xml in the part). */
  heading?: boolean;
  /** Explicit pStyle id (overrides `heading`). */
  style?: string;
  /** Numbered paragraph (w:numPr) — list block signal. */
  list?: boolean;
}

/** Run builder helpers — keep fixture tables readable. */
const t = (text: string): RunSpec => ({ kind: 'text', text });
const f = (instr: string, display: string): RunSpec => ({ kind: 'field', instr, display });
const n = (id: string): RunSpec => ({ kind: 'note', id });

function runXml(r: RunSpec): string {
  switch (r.kind) {
    case 'text':
      return `<w:r><w:t${spaceAttr(r.text)}>${esc(r.text)}</w:t></w:r>`;
    case 'field':
      // Zotero/Mendeley-style structured citation field (research §5c): the
      // visible display text lives in w:t; the raw instruction is preserved
      // as a field marker for S03, never executed or decoded here.
      return (
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
        `<w:r><w:instrText xml:space="preserve">${esc(r.instr)}</w:instrText></w:r>` +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        `<w:r><w:t>${esc(r.display)}</w:t></w:r>` +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
      );
    case 'note':
      return (
        '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr>' +
        `<w:footnoteReference w:id="${esc(r.id)}"/></w:r>`
      );
  }
}

function paragraphXml(p: ParaSpec): string {
  const pPr: string[] = [];
  const styleId = p.heading ? 'Heading1' : p.style;
  if (styleId !== undefined) pPr.push(`<w:pStyle w:val="${esc(styleId)}"/>`);
  if (p.list) pPr.push('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>');
  const ppr = pPr.length > 0 ? `<w:pPr>${pPr.join('')}</w:pPr>` : '';
  const body = p.runs.map(runXml).join('');
  return `<w:p>${ppr}${body}</w:p>`;
}

function documentXml(paragraphs: ParaSpec[]): string {
  const body = paragraphs.map(paragraphXml).join('\n    ');
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    `<w:document xmlns:w="${NS_W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`,
    '  <w:body>',
    `    ${body}`,
    '  </w:body>',
    '</w:document>',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Package assembly (fflate zipSync with a pinned mtime — deterministic).
// ---------------------------------------------------------------------------

interface DocxSpec {
  /** Relative path under fixtures/, e.g. "author-date/simple.docx". */
  name: string;
  title: string;
  creator: string;
  paragraphs: ParaSpec[];
  /** Real footnote texts (word/footnotes.xml). */
  notes?: string[];
  /** Emit word/styles.xml (needed whenever a heading style is referenced). */
  withStyles?: boolean;
  /** Extra parts (e.g. word/vbaProject.bin, rels overrides). */
  extraParts?: Array<{ name: string; content: string | Uint8Array }>;
}

function buildDocx(spec: DocxSpec): Uint8Array {
  const parts: Record<string, string | Uint8Array> = {
    '[Content_Types].xml': contentTypesXml({
      styles: spec.withStyles,
      footnotes: spec.notes !== undefined && spec.notes.length > 0,
    }),
    '_rels/.rels': packageRelsXml(),
    'word/document.xml': documentXml(spec.paragraphs),
    'docProps/core.xml': corePropsXml(spec.title, spec.creator),
    'docProps/app.xml': appXml(spec.title),
    'word/_rels/document.xml.rels': documentRelsXml(false),
  };
  if (spec.withStyles) parts['word/styles.xml'] = stylesXml();
  if (spec.notes !== undefined && spec.notes.length > 0) {
    parts['word/footnotes.xml'] = footnotesXml(spec.notes);
  }
  for (const extra of spec.extraParts ?? []) parts[extra.name] = extra.content;
  return zipSync(normalizeParts(parts), { mtime: FIXED_MTIME });
}

/** fflate zipSync only accepts Uint8Array values (a string would be treated as a nested directory). */
function normalizeParts(parts: Record<string, string | Uint8Array>): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(parts)) {
    out[name] = typeof content === 'string' ? u8(content) : content;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Hand-rolled ZIP writer for security samples (declared sizes are under our
// control; used to author the zip bomb without materialising 60 MiB).
// ---------------------------------------------------------------------------

interface ZipEntrySpec {
  name: string;
  data: Uint8Array;
  /** Declared uncompressed size in the headers; defaults to real size. */
  declaredOriginalSize?: number;
  /** Store uncompressed (method 0) instead of deflate. */
  store?: boolean;
}

function handZip(entries: ZipEntrySpec[]): Uint8Array {
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;
  let cdSize = 0;

  for (const e of entries) {
    const nameBytes = u8(e.name);
    const body = e.store ? e.data : deflateSync(e.data);
    const declared = e.declaredOriginalSize ?? e.data.length;
    const method = e.store ? 0 : 8;
    const crc = crc32(e.data);

    // Local file header: PK\x03\x04 + fixed fields + filename.
    const lh = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0, true); // flags
    lv.setUint16(8, method, true);
    lv.setUint16(10, DOS_TIME, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true); // compressed size
    lv.setUint32(22, declared, true); // uncompressed size (may be hostile)
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true); // extra len
    lh.set(nameBytes, 30);
    localChunks.push(lh, body);

    // Central directory entry: PK\x01\x02 + fixed fields + filename.
    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // version made by (OS byte stays 0)
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0, true); // flags
    cv.setUint16(10, method, true);
    cv.setUint16(12, DOS_TIME, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true); // compressed size
    cv.setUint32(24, declared, true); // uncompressed size (may be hostile)
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true); // extra len
    cv.setUint16(32, 0, true); // comment len
    cv.setUint16(34, 0, true); // disk number start
    cv.setUint16(36, 0, true); // internal attrs
    cv.setUint32(42, offset, true); // local header offset
    cd.set(nameBytes, 46);
    centralChunks.push(cd);
    cdSize += cd.length;
    offset += lh.length + body.length;
  }

  // End of central directory: PK\x05\x06.
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true); // comment len

  const out = new Uint8Array(offset + cdSize + 22);
  let p = 0;
  for (const c of localChunks) {
    out.set(c, p);
    p += c.length;
  }
  for (const c of centralChunks) {
    out.set(c, p);
    p += c.length;
  }
  out.set(eocd, p);
  return out;
}

// ---------------------------------------------------------------------------
// Fixture corpus definitions.
// ---------------------------------------------------------------------------

/** Zotero CSL_CITATION instruction payload (realistic, inert). */
function zoteroInstr(jsonBody: string): string {
  return ` ADDIN ZOTERO_ITEM CSL_CITATION ${jsonBody} `;
}

const ZOTERO_NGUYEN2019 = zoteroInstr(
  '{"citationItems":[{"id":7,"itemData":{"id":7,"type":"article-journal","title":"Field persistence in extracted documents","author":[{"family":"Nguyen","given":"H."},{"family":"Tran","given":"L."}]}}],"properties":{"noteIndex":0,"formattedCitation":"(Nguyen et al., 2019)"},"schema":"https://github.com/citation-style-language/schema/raw/master/csl-citation.json"}',
);

/** All package fixtures. Order is insertion order = authoring order. */
const PACKAGE_FIXTURES: DocxSpec[] = [
  // ── minimal.docx: the golden/determinism anchor (hand-known offsets) ──────
  {
    name: 'minimal.docx',
    title: 'Minimal golden fixture',
    creator: 'CiteSync Fixtures',
    withStyles: true, // Heading1 style map path exercised here
    paragraphs: [
      { heading: true, runs: [t('Introduction')] },
      { runs: [t('Smith (2024) proposed a theory')] },
      // Fragmented-run paragraph: coalesced text "Fragmented run text here."
      // with runs [0,11) / [11,20) / [20,25) in the paragraph text.
      { runs: [t('Fragmented '), t('run text '), t('here.')] },
    ],
  },

  // ── author-date corpus (research §74/§76) ─────────────────────────────────
  {
    name: 'author-date/simple.docx',
    title: 'Author-date simple citations',
    creator: 'CiteSync Fixtures',
    withStyles: true,
    notes: ['Smith (2020) elaborates on this claim in a footnote.'],
    paragraphs: [
      { heading: true, runs: [t('Literature Review')] },
      { runs: [t('Smith (2020) argued that citation analysis improves with precise offsets.')] },
      { runs: [t('Recent work (Nguyen & Tran, 2021) confirms the pattern across corpora.')] },
      { runs: [t('A later study (Lee, 2019) reached similar conclusions.')] },
      { runs: [t('See footnote 1 for the supporting argument.'), n('1')] },
    ],
  },

  {
    name: 'author-date/et-al.docx',
    title: 'Author-date et-al citations with Zotero field',
    creator: 'CiteSync Fixtures',
    withStyles: true,
    notes: ["Nguyen et al. (2019) define 'field persistence' formally."],
    paragraphs: [
      { heading: true, runs: [t('Related Work')] },
      {
        // Structured Zotero field: visible display text (Nguyen et al., 2019)
        // plus a preserved ADDIN instruction marker for S03.
        runs: [t('Recent work '), f(ZOTERO_NGUYEN2019, '(Nguyen et al., 2019)'), t(' demonstrated the effect.')],
      },
      { runs: [t('Anderson, Brown, and Clark (2018) showed that fragmentation affects extraction.')] },
      { runs: [t('Some authors (Williams et al., 2022) disagree with that reading.')] },
    ],
  },

  {
    name: 'author-date/multiple-authors.docx',
    title: 'Author-date multiple-author citations',
    creator: 'CiteSync Fixtures',
    paragraphs: [
      { runs: [t('(Duong, Tran, & Le, 2020) compared three extraction pipelines.')] },
      { runs: [t('Pham and Nguyen (2017) first noted the offset problem.')] },
      { runs: [t('Ngo, Vu, Hoang, and Bui (2016) traced the issue to run splitting.')] },
    ],
  },

  {
    name: 'author-date/same-author-year.docx',
    title: 'Author-date same author, same year',
    creator: 'CiteSync Fixtures',
    paragraphs: [
      { runs: [t('Smith (2020a) described the model; Smith (2020b) extended it with run tracking.')] },
      { runs: [t('(Smith, 2020a; Smith, 2020b) together define the approach.')] },
    ],
  },

  {
    name: 'author-date/missing.docx',
    title: 'Author-date missing year/author edge cases',
    creator: 'CiteSync Fixtures',
    paragraphs: [
      { runs: [t('An anonymous reviewer (n.d.) flagged the unresolved ambiguity.')] },
      { runs: [t('(Author unknown, n.d.) remains an edge case for the extractor.')] },
      { runs: [t('Unattributed claims appear throughout the draft.')] },
    ],
  },

  {
    name: 'author-date/ambiguous.docx',
    title: 'Author-date ambiguous citations',
    creator: 'CiteSync Fixtures',
    paragraphs: [
      { runs: [t('(Smith, 2020) appears twice with different meanings.')] },
      { runs: [t('Smith (2020) first proposed the idea; later, Smith (2021) revised it.')] },
      { runs: [t('Multiple Smith citations (2020; 2021) create ambiguity without context.')] },
    ],
  },

  {
    name: 'author-date/vietnamese.docx',
    title: 'Luận án tiếng Việt — trích dẫn tác giả-năm',
    creator: 'Nguyễn Văn A',
    withStyles: true,
    notes: ['Xem thêm Nguyễn Văn A (2015), chương 2.'],
    paragraphs: [
      { heading: true, runs: [t('Tóm tắt luận án')] },
      { runs: [t('Theo Nguyễn Văn A (2015), việc trích dẫn cần được xử lý một cách tự động.')] },
      { runs: [t('Nghiên cứu của Trần Thị B (2018) chỉ ra rằng các trường trích dẫn thường bị phân mảnh.')] },
      { runs: [t('Luận án tiến sĩ của Phạm Quốc C (2020) nhấn mạnh tính xác định của quá trình phân tích.')] },
    ],
  },

  // ── documents/docx corpus mirrors (research §74 full-DOCX list) ───────────
  {
    name: 'documents/docx/apa-like.docx',
    title: 'APA-like paper with reference list',
    creator: 'CiteSync Fixtures',
    withStyles: true,
    paragraphs: [
      { heading: true, runs: [t('References')] },
      { runs: [t('According to Johnson (2018), structured citation data improves reproducibility.')] },
      { runs: [t('Multiple studies (Doe, 2017; Roe, 2019) reached the same conclusion.')] },
      { runs: [t('Doe, J. (2017). Citation practice in digital documents. Journal of Citation Science, 12(3), 45-60.')] },
      { runs: [t('Johnson, A. (2018). Structured citations. Cambridge University Press.')] },
      { runs: [t('Roe, M. (2019). Offsets and evidence. ACM Computing Surveys, 51(2), 1-30.')] },
    ],
  },

  {
    name: 'documents/docx/harvard.docx',
    title: 'Harvard-style citations',
    creator: 'CiteSync Fixtures',
    paragraphs: [
      { runs: [t('In-text citation (Smith, 2024, p. 12) with a page number.')] },
      { runs: [t('Harvard style (Nguyen 2021) omits the comma in some variants.')] },
      { runs: [t('Research & Development cited in Le (2023) follows alphabetical order.')] },
    ],
  },

  {
    name: 'documents/docx/plain-text.docx',
    title: 'Plain-text citations without structured fields',
    creator: 'CiteSync Fixtures',
    paragraphs: [
      { runs: [t('Plain-text citation: (Johnson 2018) without any structured field.')] },
      { runs: [t('Another: [1] numeric-style inline reference.')] },
      { runs: [t('And a bare mention: Smith 2024.')] },
    ],
  },

  // ── bibliography corpus (S02 detection fixtures) ─────────────────────────
  // S02-T2: dedicated fixtures for bilingual detection + the below-threshold
  // and absent paths (S02-RESEARCH.md major risk). Each exercises a distinct
  // signal combination the S02 weighted detector must score:
  //   en-references   — exact heading text + reference-like paragraphs
  //                     (English true-positive, high confidence)
  //   vi-tai-lieu     — exact Vietnamese heading + reference entries
  //                     (diacritics, true-positive)
  //   style-position  — custom heading text via Heading1 style + late position
  //                     + reference-like following paragraphs (weighted combo,
  //                     no exact text match)
  //   no-bibliography — narrative only -> outcome 'none'
  //   ambiguous       — 'References' heading but non-reference-like short
  //                     paragraphs following -> below-threshold/ask-user path
  {
    name: 'bibliography/en-references.docx',
    title: 'English paper with reference list',
    creator: 'CiteSync Fixtures',
    withStyles: true,
    paragraphs: [
      { heading: true, runs: [t('Literature Review')] },
      { runs: [t('Doe (2017) examined citation practices across digital libraries.')] },
      { runs: [t('Johnson (2018) proposed structured citation models for reproducibility.')] },
      { runs: [t('Roe (2019) connected citation offsets to extraction accuracy.')] },
      { heading: true, runs: [t('References')] },
      { runs: [t('Doe, J. (2017). Citation practice in digital documents. Journal of Citation Science, 12(3), 45-60.')] },
      { runs: [t('Johnson, A. (2018). Structured citations. Cambridge University Press.')] },
      { runs: [t('Roe, M. (2019). Offsets and evidence. ACM Computing Surveys, 51(2), 1-30.')] },
    ],
  },

  {
    name: 'bibliography/vi-tai-lieu.docx',
    title: 'Luận án tiếng Việt — danh mục tài liệu tham khảo',
    creator: 'Nguyễn Văn A',
    withStyles: true,
    paragraphs: [
      { heading: true, runs: [t('Danh mục tài liệu tham khảo')] },
      { runs: [t('Nguyễn, V. A. (2015). Phương pháp trích dẫn tự động trong văn bản khoa học. Nhà xuất bản Đại học Quốc gia Hà Nội.')] },
      { runs: [t('Trần, T. B. (2018). Cấu trúc trường trích dẫn trong tài liệu số. Tạp chí Khoa học và Công nghệ, 12(2), 33-47.')] },
      { runs: [t('Phạm, Q. C. (2020). Nhận dạng danh mục tài liệu tham khảo trong văn bản. Đại học Bách khoa Hà Nội.')] },
    ],
  },

  {
    name: 'bibliography/style-position.docx',
    title: 'Custom bibliography heading via heading style',
    creator: 'CiteSync Fixtures',
    withStyles: true,
    paragraphs: [
      { heading: true, runs: [t('Introduction')] },
      { runs: [t('Trích dẫn khoa học cần được xác định chính xác trong tài liệu.')] },
      { runs: [t('Theo Nguyễn (2019), việc trích dẫn phải đảm bảo tính xác định.')] },
      { runs: [t('Phương pháp này dựa trên các tín hiệu có trọng số trong văn bản.')] },
      { runs: [t('Kết quả được trình bày chi tiết ở các phần sau.')] },
      { heading: true, runs: [t('Danh mục trích dẫn')] },
      { runs: [t('Doe, J. (2017). Citation practice in digital documents. Journal of Citation Science, 12(3), 45-60.')] },
      { runs: [t('Johnson, A. (2018). Structured citations. Cambridge University Press.')] },
      { runs: [t('Roe, M. (2019). Offsets and evidence. ACM Computing Surveys, 51(2), 1-30.')] },
    ],
  },

  {
    name: 'bibliography/no-bibliography.docx',
    title: 'Narrative draft without a bibliography',
    creator: 'CiteSync Fixtures',
    paragraphs: [
      { runs: [t('This draft discusses extraction quality without any reference list.')] },
      { runs: [t('Smith (2020) noted that offset precision drives extraction quality.')] },
      { runs: [t('Recent work (Nguyen & Tran, 2021) extended the approach to structured fields.')] },
      { runs: [t('The authors plan to add a bibliography in a future revision.')] },
    ],
  },

  {
    name: 'bibliography/ambiguous.docx',
    title: 'References heading with non-reference content',
    creator: 'CiteSync Fixtures',
    withStyles: true,
    paragraphs: [
      { heading: true, runs: [t('Introduction')] },
      { runs: [t('This paper explores citation extraction in academic documents.')] },
      { runs: [t('Recent work (Doe, 2017) highlights the role of weighted signals.')] },
      { heading: true, runs: [t('References')] },
      { runs: [t('See the appendix for further discussion.')] },
      { runs: [t('The authors welcome feedback on the extraction pipeline.')] },
      { runs: [t('Acknowledgments: funded by the research council.')] },
    ],
  },
];

// ---------------------------------------------------------------------------
// Security fixtures (authored by script; NEVER parsed by the reader here).
// ---------------------------------------------------------------------------

/** Fake OLE compound-file magic + payload for word/vbaProject.bin. */
function vbaProjectBin(): Uint8Array {
  const magic = new Uint8Array([
    0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, // OLE CFB magic
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x3e, 0x00, 0x03, 0x00, 0xfe, 0xff, 0x09, 0x00, // header fields
  ]);
  const payload = u8('VBAProject (dummy) — never executed by the reader.');
  const out = new Uint8Array(magic.length + payload.length);
  out.set(magic, 0);
  out.set(payload, magic.length);
  return out;
}

/** zip-bomb.docx: valid package + one entry declaring 60 MiB uncompressed. */
function buildZipBomb(): Uint8Array {
  const parts: Record<string, string | Uint8Array> = {
    '[Content_Types].xml': contentTypesXml({}),
    'word/document.xml': documentXml([{ runs: [t('Bomb carrier document')] }]),
  };
  const docxEntries: ZipEntrySpec[] = Object.entries(parts).map(([name, content]) => ({
    name,
    data: typeof content === 'string' ? u8(content) : content,
  }));
  return handZip([
    ...docxEntries,
    // Declared 60 MiB (> DOCX_ENTRY_MAX = 50 MiB) but a ~2 KiB real payload:
    // the reader's filter rejects the entry BEFORE decompression, so nothing
    // is ever materialised — a true declaration-style zip bomb.
    {
      name: 'word/bomb.bin',
      data: u8('x'.repeat(2048)),
      declaredOriginalSize: 60 * MIB,
    },
  ]);
}

/**
 * lying-bomb.docx (S01-T9): valid package + one entry that DECLARES 100 bytes
 * uncompressed but whose real deflate stream expands to 60 MiB (far beyond
 * DOCX_ENTRY_MAX). The file itself stays tiny (~60 KiB compressed) — the
 * classic lying-declaration bomb. fflate's sync unzip would silently truncate
 * this to the declared 100 bytes (MEM007); the hardened reader counts the
 * ACTUAL inflated output and must raise ZipBombError.
 */
function buildLyingBomb(): Uint8Array {
  const parts: Record<string, string | Uint8Array> = {
    '[Content_Types].xml': contentTypesXml({}),
    'word/document.xml': documentXml([{ runs: [t('Lying-bomb carrier document')] }]),
  };
  const docxEntries: ZipEntrySpec[] = Object.entries(parts).map(([name, content]) => ({
    name,
    data: typeof content === 'string' ? u8(content) : content,
  }));
  // 60 MiB of a single repeated byte — deflates to ~60 KiB, inflates to 60 MiB.
  const inflated = new Uint8Array(60 * MIB);
  inflated.fill(0x41); // 'A'
  return handZip([
    ...docxEntries,
    {
      name: 'word/lying.bin',
      data: inflated,
      declaredOriginalSize: 100, // lies: 100 B declared, 60 MiB actual
    },
  ]);
}

/** truncated.docx: local headers + data only, central directory + EOCD cut. */
function buildTruncated(): Uint8Array {
  const parts: Record<string, string | Uint8Array> = {
    '[Content_Types].xml': contentTypesXml({}),
    'word/document.xml': documentXml([{ runs: [t('Will be truncated')] }]),
  };
  const full = handZip(
    Object.entries(parts).map(([name, content]) => ({
      name,
      data: typeof content === 'string' ? u8(content) : content,
      store: true, // stored ASCII data can never contain the EOCD magic
    })),
  );
  const ev = new DataView(full.buffer, full.byteOffset, full.byteLength);
  const cdOffset = ev.getUint32(full.length - 6, true); // EOCD @ len-22, cdOffset @ +16
  return full.slice(0, cdOffset);
}

/** not-a-docx.zip: a well-formed ZIP that is not a DOCX package. */
function buildNotADocx(): Uint8Array {
  return zipSync(
    { 'hello.txt': u8('this is a plain zip, not a docx') },
    { mtime: FIXED_MTIME },
  );
}

/** garbage.docx: raw bytes that are not a ZIP at all. */
function buildGarbage(): Uint8Array {
  return u8('this is definitely not a zip archive, just plain text bytes');
}

/** vba-sample.docx: valid package + macro part + external rel targets. */
function buildVbaSample(): Uint8Array {
  const spec: DocxSpec = {
    name: 'security/vba-sample.docx',
    title: 'Macro-bearing sample (note-and-skip)',
    creator: 'CiteSync Fixtures',
    withStyles: true,
    paragraphs: [
      { heading: true, runs: [t('Macro Carriage')] },
      { runs: [t('This document carries a vbaProject part that the reader must never execute.')] },
    ],
  };
  const parts: Record<string, string | Uint8Array> = {
    '[Content_Types].xml': contentTypesXml({ styles: true, vba: true }),
    '_rels/.rels': packageRelsXml(),
    'word/document.xml': documentXml(spec.paragraphs),
    'docProps/core.xml': corePropsXml(spec.title, spec.creator),
    'docProps/app.xml': appXml(spec.title),
    'word/styles.xml': stylesXml(),
    'word/_rels/document.xml.rels': documentRelsXml(true),
    'word/vbaProject.bin': vbaProjectBin(),
  };
  return zipSync(normalizeParts(parts), { mtime: FIXED_MTIME });
}

// ---------------------------------------------------------------------------
// Determinism + structure self-checks (never via the reader).
// ---------------------------------------------------------------------------

function assertByteEqual(a: Uint8Array, b: Uint8Array, what: string): void {
  if (a.length !== b.length) {
    throw new Error(`determinism check failed for ${what}: length ${a.length} != ${b.length}`);
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      throw new Error(`determinism check failed for ${what}: byte ${i} differs`);
    }
  }
}

/** Re-open a package fixture with a plain fflate filter (bounded, no reader). */
function selfCheckValidPackage(bytes: Uint8Array, name: string): void {
  const out = unzipSync(bytes, {
    filter: (f) => f.originalSize <= DOCX_ENTRY_MAX,
  });
  const hasRequired = '[Content_Types].xml' in out && 'word/document.xml' in out;
  if (!hasRequired) {
    throw new Error(`self-check: ${name} is missing required parts`);
  }
  if (out['word/document.xml']!.length === 0) {
    throw new Error(`self-check: ${name} word/document.xml is empty`);
  }
}

/** Re-open the bomb with a cap filter: bomb entry must be rejected, others in. */
function selfCheckZipBomb(bytes: Uint8Array): void {
  let sawDeclared = 0;
  const out = unzipSync(bytes, {
    filter: (f) => {
      if (f.name === 'word/bomb.bin') {
        sawDeclared = f.originalSize;
        return false; // rejected before decompression — nothing inflated
      }
      return true;
    },
  });
  if (sawDeclared !== 60 * MIB) {
    throw new Error(`self-check: bomb declared size mismatch: ${sawDeclared}`);
  }
  if ('word/bomb.bin' in out) {
    throw new Error('self-check: bomb entry was unexpectedly decompressed');
  }
  if (!('[Content_Types].xml' in out) || !('word/document.xml' in out)) {
    throw new Error('self-check: bomb required parts missing');
  }
}

/**
 * The lying bomb must (a) declare a tiny 100-byte size, (b) be truncated to
 * that declared size by fflate's sync unzip (MEM007 — proving the archive is
 * structured exactly as the lying-declaration attack), (c) still carry the
 * required DOCX parts, and (d) stay small on disk (a real bomb, not a large
 * file). The 60 MiB expansion is verified by construction: the authoring data
 * IS 60 MiB of 'A' and is stored as its genuine deflate stream.
 */
function selfCheckLyingBomb(bytes: Uint8Array): void {
  let declared = 0;
  unzipSync(bytes, {
    filter: (f) => {
      if (f.name === 'word/lying.bin') declared = f.originalSize;
      return true;
    },
  });
  if (declared !== 100) {
    throw new Error(`self-check: lying bomb declared size ${declared}, expected 100`);
  }
  const out = unzipSync(bytes, { filter: () => true });
  if (out['word/lying.bin']!.length !== 100) {
    throw new Error('self-check: lying entry was not truncated to declared size by sync unzip');
  }
  if (!('[Content_Types].xml' in out) || !('word/document.xml' in out)) {
    throw new Error('self-check: lying bomb missing required parts');
  }
  if (bytes.length > 1 * MIB) {
    throw new Error(`self-check: lying bomb is ${bytes.length} bytes — compression failed`);
  }
}

/** The truncated archive must make fflate itself fail (EOCD scan). */
function selfCheckTruncated(bytes: Uint8Array): void {
  if (bytes.length < 22) throw new Error('self-check: truncated fixture too small');
  let threw = false;
  try {
    unzipSync(bytes, { filter: () => true });
  } catch {
    threw = true;
  }
  if (!threw) {
    throw new Error('self-check: truncated fixture did not fail unzipSync');
  }
  // The kept bytes must not contain the EOCD signature (deterministic proof).
  for (let i = 0; i <= bytes.length - 4; i++) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
      throw new Error(`self-check: truncated fixture contains EOCD magic at byte ${i}`);
    }
  }
}

/** not-a-docx must unzip cleanly but contain no docx required parts. */
function selfCheckNotADocx(bytes: Uint8Array): void {
  const out = unzipSync(bytes);
  const bad =
    '[Content_Types].xml' in out ||
    'word/document.xml' in out;
  if (bad) throw new Error('self-check: not-a-docx unexpectedly has docx parts');
}

// ---------------------------------------------------------------------------
// Write fixtures + manifest.
// ---------------------------------------------------------------------------

interface ManifestRow {
  name: string;
  size: number;
  kind: string;
  purpose: string;
}

function main(): void {
  // 1. Build every package fixture twice and require byte-identical output.
  const rows: ManifestRow[] = [];
  for (const spec of PACKAGE_FIXTURES) {
    const bytes = buildDocx(spec);
    assertByteEqual(bytes, buildDocx(spec), spec.name);
    selfCheckValidPackage(bytes, spec.name);
    rows.push({ name: spec.name, size: bytes.length, kind: 'valid docx', purpose: spec.title });
  }

  // 2. Security fixtures (built once; each self-checked above).
  const bomb = buildZipBomb();
  selfCheckZipBomb(bomb);
  rows.push({
    name: 'security/zip-bomb.docx',
    size: bomb.length,
    kind: 'security',
    purpose: 'entry declares 60 MiB (> DOCX_ENTRY_MAX) -> ZipBombError before inflate',
  });

  const lyingBomb = buildLyingBomb();
  selfCheckLyingBomb(lyingBomb);
  rows.push({
    name: 'security/lying-bomb.docx',
    size: lyingBomb.length,
    kind: 'security',
    purpose: 'entry declares 100 B but inflates to 60 MiB (lying declaration) -> ZipBombError on actual output',
  });

  const truncated = buildTruncated();
  selfCheckTruncated(truncated);
  rows.push({
    name: 'security/truncated.docx',
    size: truncated.length,
    kind: 'security',
    purpose: 'central directory + EOCD cut off -> NotADocxError (truncated ZIP)',
  });

  const notADocx = buildNotADocx();
  selfCheckNotADocx(notADocx);
  rows.push({
    name: 'security/not-a-docx.zip',
    size: notADocx.length,
    kind: 'security',
    purpose: 'well-formed ZIP without required parts -> NotADocxError',
  });

  const garbage = buildGarbage();
  rows.push({
    name: 'security/garbage.docx',
    size: garbage.length,
    kind: 'security',
    purpose: 'non-ZIP bytes -> NotADocxError (missing PK magic)',
  });

  const vba = buildVbaSample();
  assertByteEqual(vba, buildVbaSample(), 'security/vba-sample.docx');
  selfCheckValidPackage(vba, 'security/vba-sample.docx');
  rows.push({
    name: 'security/vba-sample.docx',
    size: vba.length,
    kind: 'valid docx + macro',
    purpose: 'word/vbaProject.bin + external rel targets -> security info, note-and-skip',
  });

  // 3. Write all fixtures under fixtures/ (never gitignored).
  const toWrite: Array<{ name: string; bytes: Uint8Array }> = [
    ...PACKAGE_FIXTURES.map((s) => ({ name: s.name, bytes: buildDocx(s) })),
    { name: 'security/zip-bomb.docx', bytes: bomb },
    { name: 'security/lying-bomb.docx', bytes: lyingBomb },
    { name: 'security/truncated.docx', bytes: truncated },
    { name: 'security/not-a-docx.zip', bytes: notADocx },
    { name: 'security/garbage.docx', bytes: garbage },
    { name: 'security/vba-sample.docx', bytes: vba },
  ];
  for (const f of toWrite) {
    const path = join(FIXTURES_DIR, f.name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, f.bytes);
  }

  // 4. Manifest README (authored here, byte-stable).
  const lines: string[] = [
    '# Fixtures (S01-T7)',
    '',
    'Committed .docx binaries authored by `scripts/make-fixtures.ts` (run via `npx tsx`).',
    'Authoring uses fflate + hand-authored OOXML — **never the reader** — and is fully',
    'deterministic (R008/R017): pinned DOS timestamps, fixed entry order, no clock/random.',
    'Re-running the script rewrites byte-identical files.',
    '',
    '## Golden anchor',
    '',
    '`minimal.docx` is the golden/determinism anchor with hand-known offsets:',
    '',
    '| block | text | note |',
    '|-------|------|------|',
    '| 0 (heading, style Heading1) | `Introduction` | exercises styles.xml style-map path |',
    '| 1 (paragraph) | `Smith (2024) proposed a theory` | citation `Smith (2024)` at `[0,12)` in paragraph text |',
    '| 2 (paragraph) | `Fragmented run text here.` | fragmented runs, coalesced; runs at `[0,11)` `[11,20)` `[20,25)` |',
    '',
    '## Corpus (author-date)',
    '',
    '| fixture | purpose |',
    '|---------|---------|',
    '| `author-date/simple.docx` | APA-like simple citations + footnote |',
    '| `author-date/et-al.docx` | et-al + multiple authors + Zotero CSL field marker |',
    '| `author-date/multiple-authors.docx` | 3+ author spellings |',
    '| `author-date/same-author-year.docx` | 2020a/2020b disambiguation |',
    '| `author-date/missing.docx` | missing year/author edge cases |',
    '| `author-date/ambiguous.docx` | ambiguous same-name citations |',
    '| `author-date/vietnamese.docx` | Vietnamese thesis with diacritics + footnote |',
    '',
    '## Corpus (documents/docx mirrors)',
    '',
    '| fixture | purpose |',
    '|---------|---------|',
    '| `documents/docx/apa-like.docx` | narrative + parenthetical citations + reference list |',
    '| `documents/docx/harvard.docx` | Harvard variants, page-number citation, entity-encoded text |',
    '| `documents/docx/plain-text.docx` | plain-text citations, no structured fields |',
    '',
    '## Corpus (bibliography)',
    '',
    '| fixture | purpose |',
    '|---------|---------|',
    '| `bibliography/en-references.docx` | English true-positive: `References` heading + reference-list entries (high confidence) |',
    '| `bibliography/vi-tai-lieu.docx` | Vietnamese true-positive: `Danh mục tài liệu tham khảo` heading + diacritic entries |',
    '| `bibliography/style-position.docx` | custom heading text via Heading1 style + late position + reference-like entries (weighted-signal path, no exact text) |',
    '| `bibliography/no-bibliography.docx` | narrative only, no heading/reference segment -> outcome `none` |',
    '| `bibliography/ambiguous.docx` | `References` heading but non-reference-like short paragraphs following -> below-threshold/ask-user path |',
    '',
    '## Security samples',
    '',
    '| fixture | expected reader behavior |',
    '|---------|--------------------------|',
    '| `security/zip-bomb.docx` | entry declares 60 MiB (> DOCX_ENTRY_MAX) -> `ZipBombError` before inflate |',
    '| `security/lying-bomb.docx` | entry declares 100 B but inflates to 60 MiB (lying declaration) -> `ZipBombError` on actual output (S01-T9) |',
    '| `security/truncated.docx` | central directory + EOCD removed -> `NotADocxError` (truncated ZIP) |',
    '| `security/not-a-docx.zip` | well-formed ZIP, missing required parts -> `NotADocxError` |',
    '| `security/garbage.docx` | non-ZIP bytes -> `NotADocxError` (no PK magic) |',
    '| `security/vba-sample.docx` | **valid** docx + `word/vbaProject.bin` + external rel targets; parses fine, macro/remote targets only noted |',
    '',
    '> `security/vba-sample.docx` is a VALID package (macro parts are note-and-skip, never',
    '> executed or decoded). Only the five explicitly "bad" samples are expected to throw',
    '> typed errors from the reader.',
  ];
  const readmePath = join(FIXTURES_DIR, 'README.md');
  mkdirSync(dirname(readmePath), { recursive: true });
  writeFileSync(readmePath, lines.join('\n') + '\n');

  // 5. Report.
  console.log(`Wrote ${toWrite.length} fixtures + README.md under fixtures/`);
  for (const r of rows) {
    console.log(`  ${r.name.padEnd(34)} ${String(r.size).padStart(7)} B  ${r.kind.padEnd(18)} ${r.purpose}`);
  }
}

main();
