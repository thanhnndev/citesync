#!/usr/bin/env node
/**
 * scripts/make-perf-fixture.ts — M004-S01-T1: deterministic 100-page fixture.
 *
 * Authors the committed `fixtures/perf/100-page.docx` load artifact consumed
 * by the M004-S01 performance proof (the benchmark:perf harness, the Playwright
 * large-doc spec, and the S03 corpus sizing). Mirrors `scripts/make-fixtures.ts`
 * authoring discipline exactly:
 *
 *   - AUTHORING NEVER DEPENDS ON THE READER (R008): fflate `zipSync` + hand-
 *     authored OOXML strings. A reader bug can never be masked by the
 *     authoring path.
 *   - DETERMINISM (R017): the DOS timestamp is pinned to a fixed LOCAL noon
 *     (2024-01-01 12:00) so the DOS time/date fields are identical on every
 *     machine/timezone; entry order is fixed (object literal insertion);
 *     content is drawn from a fixed-seed PRNG (mulberry32) — no clock, no
 *     Math.random, no fs timestamps. The script self-checks by building the
 *     package twice in memory and requiring byte-identical output, and a
 *     re-run after commit rewrites byte-identical bytes (git diff empty).
 *
 * CONTENT TARGET (an auditable "100 pages" at ~500 words/page):
 *   - 900 body paragraphs x ~50 words (~45-55K words) across 10 chapters,
 *     each opened by a `Chapter N: ...` Heading1 paragraph (styles.xml
 *     style-map path);
 *   - 2-3 author-date citations per paragraph, drawn from the same 260-author
 *     pool as the reference list (~2.5-3K citations in total);
 *   - 260 reference entries under a `References` Heading1 (references path);
 *     each entry's "Author, X. (YYYY)." tail is itself an author-date
 *     citation, exactly like the existing bibliography/numeric corpora;
 *   - ~30 footnotes (note-scanning path) and 3 tables (table-flattening
 *     path) and occasional Zotero CSL fields (structured-field path);
 *   - `word/document.xml` ~300K chars — well under the 1M design bound and
 *     the reader caps in packages/docx/src/zip/limits.ts (DOCX_ENTRY_MAX
 *     50 MiB, XML_STRING_MAX 64 MiB).
 *
 * METADATA pins the SAME docProps dates as make-fixtures (created
 * 2024-01-15T10:30:00Z, modified 2024-02-20T08:00:00Z, truthy title/author)
 * so the metadata assertions in packages/docx/tests/fixture.test.ts hold for
 * this fixture too. The KNOWN_CITATIONS strings ('Smith (2020)' and
 * '(Nguyen & Tran, 2021)') are authored verbatim in Chapter 1's first body
 * paragraph.
 *
 * This is a LOAD ARTIFACT, not a quality-corpus case: it deliberately joins
 * VALID_FIXTURES / fixture.test.ts generic per-fixture assertions only, and
 * is intentionally absent from scripts/fixture-ground-truth*.ts (MEM065
 * atomicity applies to the quality corpus only).
 *
 * Output: fixtures/perf/100-page.docx (single byte-stable file).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { zipSync, unzipSync } from 'fflate';

const MIB = 1024 * 1024;
/** Mirror of the reader's per-entry bound (packages/docx/src/zip/limits.ts). */
const DOCX_ENTRY_MAX = 50 * MIB;

/**
 * Fixed local-noon timestamp — identical DOS time/date fields in every
 * timezone (same constant as make-fixtures.ts).
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
const OUTPUT_PATH = join(FIXTURES_DIR, 'perf', '100-page.docx');

/** Fixed PRNG seed — content is a pure function of this constant. */
const SEED = 0xc1e59a11;

/** Content budget constants (tuned so document.xml lands near ~300K chars). */
const CHAPTERS = 10;
const PARAGRAPHS_PER_CHAPTER = 90; // 10 x 90 = 900 body paragraphs
const REFERENCE_ENTRIES = 260;
const FOOTNOTE_COUNT = 30;
const TABLE_COUNT = 3;

const enc = new TextEncoder();
const u8 = (s: string): Uint8Array => enc.encode(s);

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) — a pure function of its seed.
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(rand: () => number, arr: readonly T[]): T =>
  arr[Math.floor(rand() * arr.length)]!;

const cap = (s: string): string => (s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s);

// ---------------------------------------------------------------------------
// XML escaping + run/paragraph builders (same shapes as make-fixtures.ts).
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

type RunSpec =
  | { kind: 'text'; text: string }
  | { kind: 'field'; instr: string; display: string }
  | { kind: 'note'; id: string };

interface ParaSpec {
  runs: RunSpec[];
  heading?: boolean;
}

const t = (text: string): RunSpec => ({ kind: 'text', text });
const f = (instr: string, display: string): RunSpec => ({ kind: 'field', instr, display });
const n = (id: string): RunSpec => ({ kind: 'note', id });

function runXml(r: RunSpec): string {
  switch (r.kind) {
    case 'text':
      return `<w:r><w:t>${esc(r.text)}</w:t></w:r>`;
    case 'field':
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
  const pPr = p.heading ? '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' : '';
  const body = p.runs.map(runXml).join('');
  return `<w:p>${pPr}${body}</w:p>`;
}

function documentXml(paragraphs: ParaSpec[], tables: string[]): string {
  // Tables are spliced into the body at deterministic positions (see
  // buildBody — the plan records the paragraph indices here).
  const bodyParts: string[] = [];
  const tableAt = new Set(TABLE_INSERT_AFTER_PARAGRAPH);
  paragraphs.forEach((p, i) => {
    bodyParts.push(paragraphXml(p));
    if (tableAt.has(i)) {
      bodyParts.push(tables[TABLE_INSERT_AFTER_PARAGRAPH.indexOf(i)]!);
    }
  });
  const body = bodyParts.join('\n    ');
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
// OOXML part templates (byte-identical shapes to make-fixtures.ts).
// ---------------------------------------------------------------------------

function contentTypesXml(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '  <Default Extension="xml" ContentType="application/xml"/>',
    '  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
    '  <Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>',
    '  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
    '  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
    '</Types>',
  ].join('\n');
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

function documentRelsXml(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '  <Relationship Id="rIdStyle" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    '</Relationships>',
  ].join('\n');
}

/** fflate zipSync only accepts Uint8Array values (a string would be a dir). */
function normalizeParts(parts: Record<string, string | Uint8Array>): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(parts)) {
    out[name] = typeof content === 'string' ? u8(content) : content;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Content generation (deterministic — every value flows from the seed).
// ---------------------------------------------------------------------------

interface AuthorEntry {
  surname: string;
  initials: string;
  year: number;
  title: string;
  container: string;
  volume: string;
  issue: string;
  pages: string;
}

/** Fixed pools — realistic names/topics; no clock or randomness involved. */
const SURNAMES: readonly string[] = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
  'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson',
  'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker',
  'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores',
  'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell',
  'Carter', 'Roberts', 'Gomez', 'Phillips', 'Evans', 'Turner', 'Diaz', 'Parker',
  'Cruz', 'Edwards', 'Collins', 'Reyes', 'Stewart', 'Morris', 'Morales', 'Murphy',
  'Cook', 'Rogers', 'Gutierrez', 'Ortiz', 'Morgan', 'Cooper', 'Peterson', 'Bailey',
  'Reed', 'Kelly', 'Howard', 'Ramos', 'Kim', 'Cox', 'Ward', 'Richardson', 'Watson',
  'Brooks', 'Chavez', 'Wood', 'James', 'Bennett', 'Gray', 'Mendoza', 'Ruiz',
  'Hughes', 'Price', 'Alvarez', 'Castillo', 'Sanders', 'Patel', 'Myers', 'Long',
  'Ross', 'Foster', 'Jimenez', 'Powell', 'Jenkins', 'Perry', 'Russell', 'Sullivan',
  'Bell', 'Coleman', 'Butler', 'Henderson', 'Barnes', 'Gonzales', 'Fisher',
  'Vasquez', 'Simmons', 'Romero', 'Jordan', 'Patterson', 'Alexander', 'Hamilton',
  'Graham', 'Reynolds', 'Griffin', 'Wallace', 'Moreno', 'West', 'Cole', 'Hayes',
  'Bryant', 'Herrera', 'Gibson', 'Ellis', 'Tran', 'Medina', 'Aguilar', 'Stevens',
  'Murray', 'Ford', 'Castro', 'Marshall', 'Owens', 'Harrison', 'Fernandez',
  'McDonald', 'Woods', 'Washington', 'Kennedy', 'Wells', 'Vargas', 'Henry', 'Chen',
  'Freeman', 'Webb', 'Tucker', 'Guzman', 'Burns', 'Crawford', 'Olson', 'Simpson',
  'Porter', 'Hunter', 'Gordon', 'Mendez', 'Silva', 'Shaw', 'Snyder', 'Mason',
  'Dixon', 'Munoz', 'Hunt', 'Hicks', 'Palmer', 'Le', 'Pham', 'Vu', 'Do', 'Hoang',
  'Duong', 'Dang', 'Bui',
];

const TOPIC_WORDS: readonly string[] = [
  'citation', 'analysis', 'document', 'pipeline', 'evidence', 'offset',
  'structure', 'extraction', 'reference', 'matching', 'corpus', 'study',
  'method', 'approach', 'model', 'result', 'finding', 'data', 'process',
  'system', 'index', 'pattern', 'field', 'block', 'source', 'quality',
  'accuracy', 'precision', 'recall', 'consistency', 'determinism',
  'reproducibility', 'annotation', 'normalization', 'segmentation',
  'alignment', 'verification', 'validation', 'inference', 'classification',
  'coverage', 'granularity', 'metadata', 'identifier', 'author', 'year',
  'title', 'publisher', 'journal', 'volume', 'issue', 'edition', 'chapter',
  'bibliography', 'footnote', 'table', 'figure', 'appendix', 'corpus',
];

const FUNCTION_WORDS: readonly string[] = [
  'the', 'of', 'and', 'in', 'a', 'to', 'for', 'with', 'on', 'as', 'by',
  'at', 'from', 'this', 'that', 'these', 'those', 'such', 'each', 'every',
  'several', 'multiple', 'various', 'between', 'within', 'across', 'through',
  'among', 'about', 'after', 'before', 'during', 'over', 'under', 'while',
  'since', 'despite', 'however', 'therefore', 'moreover', 'furthermore',
  'consequently', 'although', 'because', 'whereas', 'indeed', 'notably',
  'specifically', 'generally', 'typically', 'often', 'rarely', 'frequently',
  'increasingly', 'significantly', 'substantially', 'considerably',
  'particularly', 'especially', 'usually', 'commonly', 'widely', 'recently',
];

const ADJECTIVE_WORDS: readonly string[] = [
  'precise', 'structured', 'deterministic', 'reliable', 'robust', 'scalable',
  'efficient', 'comprehensive', 'systematic', 'rigorous', 'reproducible',
  'accurate', 'consistent', 'granular', 'incremental', 'semantic', 'syntactic',
  'temporal', 'spatial', 'contextual', 'empirical', 'theoretical',
  'quantitative', 'qualitative', 'comparative', 'large-scale', 'small-scale',
  'high-quality', 'fine-grained', 'coarse-grained', 'well-established',
  'peer-reviewed',
];

const ARGUE_PHRASES: readonly string[] = [
  'argued that', 'demonstrated that', 'showed that', 'established that',
  'found that', 'reported that', 'proposed that', 'claimed that', 'noted that',
  'observed that', 'suggested that', 'confirmed that', 'emphasized that',
  'illustrated that', 'described how', 'examined how', 'analyzed how',
  'evaluated how',
];

const CONTAINERS: readonly string[] = [
  'Journal of Citation Science',
  'ACM Computing Surveys',
  'IEEE Transactions on Documentation',
  'Journal of Documentation',
  'Information Processing and Management',
  'Journal of the Association for Information Science and Technology',
  'International Journal on Digital Libraries',
  'Research Evaluation',
  'Scientometrics',
  'Digital Scholarship in the Humanities',
  'College and Research Libraries',
  'Cambridge University Press',
];

const CHAPTER_TOPICS: readonly string[] = [
  'Introduction', 'Literature Review', 'Methodology', 'Experimental Setup',
  'Results', 'Discussion', 'Related Work', 'Evaluation', 'Limitations',
  'Conclusion',
];

/** Body-paragraph index (0-based within the 900) after which a table is spliced. */
const TABLE_INSERT_AFTER_PARAGRAPH: readonly number[] = [269, 539, 809];

/** Body-paragraph indices carrying the occasional Zotero CSL fields. */
const FIELD_PARAGRAPH_INDICES: ReadonlySet<number> = new Set([5, 100, 250, 450, 650, 850]);

/**
 * Generate the 260-entry author pool. The pool doubles as the reference list
 * AND the body-citation target pool, so citations find real matching entries
 * during the benchmark (the matcher still scores every entry x citation pair,
 * which is the measured hot path).
 */
function buildAuthorPool(rand: () => number): AuthorEntry[] {
  const pool: AuthorEntry[] = [];
  for (let i = 0; i < REFERENCE_ENTRIES; i++) {
    const surname = SURNAMES[(i * 7 + 3) % SURNAMES.length]!;
    const initials =
      String.fromCharCode(65 + Math.floor(rand() * 26)) +
      (rand() < 0.35 ? '.' + String.fromCharCode(65 + Math.floor(rand() * 26)) : '');
    const year = 2008 + Math.floor(rand() * 16); // 2008..2023
    const title = `${cap(pick(rand, ADJECTIVE_WORDS))} ${pick(rand, TOPIC_WORDS)} ${pick(rand, FUNCTION_WORDS)} ${pick(rand, TOPIC_WORDS)} ${pick(rand, TOPIC_WORDS)}`;
    const container = pick(rand, CONTAINERS);
    const volume = String(1 + Math.floor(rand() * 30));
    const issue = String(1 + Math.floor(rand() * 8));
    const pages = `${10 + Math.floor(rand() * 90)}-${100 + Math.floor(rand() * 900)}`;
    pool.push({ surname, initials, year, title, container, volume, issue, pages });
  }
  return pool;
}

function entryText(e: AuthorEntry): string {
  return `${e.surname}, ${e.initials}. (${e.year}). ${e.title}. ${e.container}, ${e.volume}(${e.issue}), ${e.pages}.`;
}

/** 2-3 realistic author-date citation strings (styles mirror the quality corpus). */
function citationsFor(rand: () => number, authors: AuthorEntry[]): string[] {
  const count = rand() < 0.3 ? 2 : 3; // avg ~2.7 citations per paragraph
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const a = pick(rand, authors);
    const b = pick(rand, authors);
    const style = rand();
    if (style < 0.3) out.push(`${a.surname} (${a.year})`); // narrative
    else if (style < 0.55) out.push(`(${a.surname}, ${a.year})`); // single parenthetical
    else if (style < 0.72) out.push(`(${a.surname} & ${b.surname}, ${a.year})`); // pair
    else if (style < 0.88) out.push(`(${a.surname} et al., ${a.year})`); // et al.
    else out.push(`(${a.surname}, ${a.year}; ${b.surname}, ${b.year})`); // multi
  }
  return out;
}

/** A prose sentence of 9-10 words — deterministic, corpus-flavoured. */
function proseSentence(rand: () => number): string {
  const words: string[] = [];
  const len = 9 + Math.floor(rand() * 2); // 9..10
  for (let i = 0; i < len; i++) {
    const r = rand();
    if (i % 3 === 0 || r < 0.4) words.push(pick(rand, TOPIC_WORDS));
    else if (r < 0.8) words.push(pick(rand, FUNCTION_WORDS));
    else words.push(pick(rand, ADJECTIVE_WORDS));
  }
  return cap(words.join(' ')) + '.';
}

function zoteroInstr(entry: AuthorEntry, display: string): string {
  const json = JSON.stringify({
    citationItems: [
      {
        id: 1,
        itemData: {
          id: 1,
          type: 'article-journal',
          title: entry.title,
          author: [{ family: entry.surname, given: entry.initials }],
        },
      },
    ],
    properties: { noteIndex: 0, formattedCitation: display },
    schema:
      'https://github.com/citation-style-language/schema/raw/master/csl-citation.json',
  });
  return ` ADDIN ZOTERO_ITEM CSL_CITATION ${json} `;
}

/**
 * Build the 900 body paragraphs + 10 chapter headings + the References
 * heading + 260 reference entries. Deterministic: one rand stream, fixed
 * chapter/paragraph structure, fixed footnote/field/table placements.
 */
function buildContent(
  rand: () => number,
  authors: AuthorEntry[],
): {
  paragraphs: ParaSpec[];
  tables: string[];
  counts: {
    bodyParagraphs: number;
    bodyCitations: number;
    footnotes: number;
    tables: number;
    referenceEntries: number;
    fields: number;
  };
} {
  const paragraphs: ParaSpec[] = [];
  const tables: string[] = [];
  const footnoteRefs = FOOTNOTE_COUNT; // one body ref per footnote, evenly spread
  let footnoteOrdinal = 0;
  let bodyCitations = 0;

  for (let ch = 1; ch <= CHAPTERS; ch++) {
    paragraphs.push({ heading: true, runs: [t(`Chapter ${ch}: ${CHAPTER_TOPICS[ch - 1]}`)] });
    for (let p = 0; p < PARAGRAPHS_PER_CHAPTER; p++) {
      const global = (ch - 1) * PARAGRAPHS_PER_CHAPTER + p;
      const cits = citationsFor(rand, authors);
      bodyCitations += cits.length;

      const runs: RunSpec[] = [];
      let text: string;
      if (global === 0) {
        // KNOWN_CITATIONS anchor: the exact strings fixture.test.ts round-
        // trips ('Smith (2020)', '(Nguyen & Tran, 2021)') — authored verbatim
        // so the perf fixture satisfies the same per-fixture assertions.
        text =
          'Smith (2020) argued that citation analysis improves with precise ' +
          'offsets; recent work (Nguyen & Tran, 2021) confirms the pattern ' +
          'across corpora.';
      } else {
        const lead = `${cits[0]} ${pick(rand, ARGUE_PHRASES)} ${proseSentence(rand)}`;
        const mid = proseSentence(rand);
        const mid2 = proseSentence(rand);
        const tail = `${proseSentence(rand)} ${cits[1]}.`;
        const extra = cits[2] ? `${proseSentence(rand)} ${cits[2]}.` : '';
        text = [lead, mid, mid2, tail, extra].filter(Boolean).join(' ');
      }
      runs.push(t(text));

      // Every 30th paragraph carries a footnote reference (30 refs total).
      if (global % 30 === 7) {
        runs.push(n(String(footnoteOrdinal + 1)));
        footnoteOrdinal += 1;
      }

      // Occasional Zotero CSL field (structured-field path, S03).
      if (FIELD_PARAGRAPH_INDICES.has(global)) {
        const target = pick(rand, authors);
        const display = `(${target.surname} et al., ${target.year})`;
        runs.push(f(zoteroInstr(target, display), display));
      }

      paragraphs.push({ runs });
    }
    // Splice tables after chapters 3, 6, 9 (see TABLE_INSERT_AFTER_PARAGRAPH).
    if (ch === 3 || ch === 6 || ch === 9) {
      tables.push(buildTable(rand, authors, ch));
    }
  }

  paragraphs.push({ heading: true, runs: [t('References')] });
  for (const entry of authors) {
    paragraphs.push({ runs: [t(entryText(entry))] });
  }

  return {
    paragraphs,
    tables,
    counts: {
      bodyParagraphs: CHAPTERS * PARAGRAPHS_PER_CHAPTER,
      bodyCitations,
      footnotes: FOOTNOTE_COUNT,
      tables: tables.length,
      referenceEntries: REFERENCE_ENTRIES,
      fields: FIELD_PARAGRAPH_INDICES.size,
    },
  };
}

function buildTable(rand: () => number, authors: AuthorEntry[], chapter: number): string {
  const headers = ['Method', 'Coverage', 'Precision', 'Notes'];
  const rows: string[][] = [];
  for (let r = 0; r < 4; r++) {
    const cited = pick(rand, authors);
    rows.push([
      `${cap(pick(rand, ADJECTIVE_WORDS))} ${pick(rand, TOPIC_WORDS)}`,
      `${pick(rand, TOPIC_WORDS)} ${pick(rand, FUNCTION_WORDS)} ${pick(rand, TOPIC_WORDS)}`,
      `0.${1 + Math.floor(rand() * 8)}${Math.floor(rand() * 10)}`,
      `after ${cited.surname} (${cited.year})`,
    ]);
  }
  const cell = (text: string): string =>
    `<w:tc><w:p><w:r><w:t>${esc(text)}</w:t></w:r></w:p></w:tc>`;
  const tr = (cells: string[]): string => `<w:tr>${cells.map(cell).join('')}</w:tr>`;
  const body = [tr(headers), ...rows.map(tr)].join('');
  return `<w:tbl>${body}</w:tbl>`;
}

function footnoteTexts(rand: () => number): string[] {
  return Array.from({ length: FOOTNOTE_COUNT }, (_, i) => {
    const body = `${proseSentence(rand)} ${pick(rand, FUNCTION_WORDS)} ${pick(rand, TOPIC_WORDS)} ${proseSentence(rand)}`;
    return `Footnote ${i + 1}: ${body}`;
  });
}

// ---------------------------------------------------------------------------
// Package assembly + self-checks.
// ---------------------------------------------------------------------------

const TITLE = 'Deterministic 100-page performance fixture';
const CREATOR = 'CiteSync Fixtures';

interface PackageInput {
  paragraphs: ParaSpec[];
  tables: string[];
  notes: string[];
}

/** Pure function of its inputs — the R017 byte-identity lock. */
function buildPackage(input: PackageInput): Uint8Array {
  const parts: Record<string, string | Uint8Array> = {
    '[Content_Types].xml': contentTypesXml(),
    '_rels/.rels': packageRelsXml(),
    'word/document.xml': documentXml(input.paragraphs, input.tables),
    'docProps/core.xml': corePropsXml(TITLE, CREATOR),
    'docProps/app.xml': appXml(TITLE),
    'word/_rels/document.xml.rels': documentRelsXml(),
    'word/styles.xml': stylesXml(),
    'word/footnotes.xml': footnotesXml(input.notes),
  };
  return zipSync(normalizeParts(parts), { mtime: FIXED_MTIME });
}

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

function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

function main(): void {
  // 1. Generate content from ONE deterministic rand stream.
  const rand = mulberry32(SEED);
  const authors = buildAuthorPool(rand);
  const content = buildContent(rand, authors);
  const notes = footnoteTexts(rand);

  const input: PackageInput = {
    paragraphs: content.paragraphs,
    tables: content.tables,
    notes,
  };

  // 2. Self-check (R017): build twice in memory, require byte-identical.
  const bytes = buildPackage(input);
  assertByteEqual(bytes, buildPackage(input), 'fixtures/perf/100-page.docx');

  // 3. Structural self-check via plain fflate (never the reader).
  const out = unzipSync(bytes, {
    filter: (f) => f.originalSize <= DOCX_ENTRY_MAX,
  });
  const hasRequired =
    '[Content_Types].xml' in out && 'word/document.xml' in out && 'word/footnotes.xml' in out && 'word/styles.xml' in out;
  if (!hasRequired) throw new Error('self-check: missing required parts');
  const documentXml = new TextDecoder().decode(out['word/document.xml']);
  // Well under the 1M design bound and the limits.ts caps (50 MiB / 64 MiB).
  if (documentXml.length < 250_000 || documentXml.length > 700_000) {
    throw new Error(`self-check: document.xml is ${documentXml.length} chars — outside the 250K..700K target`);
  }

  // 4. Content-budget self-checks (the auditable "100 pages" claim).
  const allText: string[] = [];
  for (const p of content.paragraphs) {
    for (const r of p.runs) if (r.kind === 'text' || r.kind === 'field') allText.push(r.text);
  }
  for (const t of notes) allText.push(t);
  for (const tbl of content.tables) {
    for (const m of tbl.matchAll(/<w:t>([^<]*)<\/w:t>/g)) allText.push(m[1]!);
  }
  const words = wordCount(allText.join(' '));
  if (words < 40_000 || words > 60_000) {
    throw new Error(`self-check: ${words} words — outside the 40K..60K audit window`);
  }
  // ~2-3 citations x 900 body paragraphs (entry tails add REFERENCE_ENTRIES).
  if (content.counts.bodyCitations < 2000 || content.counts.bodyCitations > 3300) {
    throw new Error(`self-check: ${content.counts.bodyCitations} body citations — outside 2000..3300`);
  }

  // 5. Write the committed fixture.
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, bytes);

  // 6. Report (deterministic facts for fixtures/README.md).
  const totalCitations = content.counts.bodyCitations + REFERENCE_ENTRIES;
  console.log(`Wrote fixtures/perf/100-page.docx (${bytes.length} bytes, ${documentXml.length} document.xml chars)`);
  console.log(`  body paragraphs   ${content.counts.bodyParagraphs} (${CHAPTERS} chapters x ${PARAGRAPHS_PER_CHAPTER})`);
  console.log(`  words             ${words} (~${Math.round(words / 500)} pages at 500 words/page)`);
  console.log(`  citations         ${content.counts.bodyCitations} body + ${REFERENCE_ENTRIES} entry tails = ${totalCitations} total`);
  console.log(`  reference entries ${content.counts.referenceEntries}`);
  console.log(`  footnotes         ${content.counts.footnotes} (${FOOTNOTE_COUNT} body refs)`);
  console.log(`  tables            ${content.counts.tables}`);
  console.log(`  zotero fields     ${content.counts.fields}`);
  console.log('  self-checks       byte-identity (R017) + parts + word/citation/document.xml bounds — OK');
}

main();
