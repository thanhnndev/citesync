#!/usr/bin/env node
/**
 * scripts/make-isolation-fixture.ts — M004-S02-T4: failure-isolation demo
 * fixture.
 *
 * Authors the committed `fixtures/isolation/garbage-and-malformed.docx`
 * consumed by the R016 failure-isolation proof (the S02 slice demo, the T5
 * drift guards, and the T6 e2e lint through the PUBLIC `lintDocument`).
 * Mirrors `scripts/make-perf-fixture.ts` authoring discipline exactly:
 *
 *   - AUTHORING NEVER DEPENDS ON THE READER (R008): fflate `zipSync` + hand-
 *     authored OOXML strings. A reader bug can never be masked by the
 *     authoring path.
 *   - DETERMINISM (R017): the DOS timestamp is pinned to a fixed LOCAL noon
 *     (2024-01-01 12:00) so the DOS time/date fields are identical on every
 *     machine/timezone; entry order is fixed (object literal insertion);
 *     content is static — no clock, no Math.random, no fs timestamps. The
 *     script self-checks by building the package twice in memory and
 *     requiring byte-identical output, and a re-run after commit rewrites
 *     byte-identical bytes (git diff empty).
 *   - SMALL, STATIC DOC: no PRNG needed (unlike make-perf-fixture); every
 *     content string is a verbatim constant below.
 *
 * CONTENT CONTRACT (the R016 demo surface — BOTH typed issue classes in ONE
 * document, authored so the engine's existing isolation behavior is provable
 * through the public API, never a crash):
 *   - body paragraph p1: 'The clean citation [1] resolves against the
 *     reference list.' — '[1]' is a clean numeric bracket, so D016 binds it
 *     positionally to the first bibliography entry (r0) and matching runs.
 *   - body paragraph p2: 'The malformed bracket [1, x] must surface as a
 *     typed issue, never a crash.' — '[1, x]' hits the numeric grammar's
 *     `invalid` surface (reason 'mixed') → CS007, never half-emitted.
 *   - 'References' Heading1 (exact text + pStyle so S02 detection fires:
 *     headingText 0.35 + headingStyle 0.15 + 2/3 reference-like lookahead
 *     0.20 = 0.70 ≥ 0.6 threshold).
 *   - entries in order: 'Junk without a year.' (garbage → no (YYYY) year
 *     marker → parseConfidence 0 + §88 ReferenceParseIssue → CS006),
 *     'Doe, J. (2017).' (→ r1), 'Roe, M. (2018).' (→ r2). The 2 valid
 *     entries keep the bibliography detected and the D016 map actually
 *     running; '[1]' resolves to r0 (entries[0], the garbage entry —
 *     positional binding is exactly the isolation surface the demo proves:
 *     even a garbage entry never crashes the analysis).
 *   - KNOWN_CITATIONS strings ('[1]', '[1, x]', 'Doe, J. (2017).',
 *     'Roe, M. (2018).') authored verbatim in block text so fixture.test.ts
 *     offset round-trip selects them exactly.
 *   - docProps/core.xml pins created 2024-01-15T10:30:00Z / modified
 *     2024-02-20T08:00:00Z with truthy title + author — the metadata
 *     assertions in packages/docx/tests/fixture.test.ts hold for EVERY valid
 *     fixture, this one included.
 *
 * Self-checks (run on every execution): in-memory double-build byte identity
 * (R017), required parts present, docProps pins, and every content string
 * authored verbatim. The console report prints the auditable facts for the
 * fixtures/README.md section: file size, block count, entry count, expected
 * typed issues (CS006 + CS007).
 *
 * This is a DEMO + DRIFT-GUARD artifact, not a quality-corpus case: it joins
 * VALID_FIXTURES / fixture.test.ts generic per-fixture assertions AND the
 * numeric ground-truth locks (KNOWN_NUMERIC_INDEX_MAP — M004-S02 T5: the
 * isolation bracket map stays honest, so the malformed-bracket-never-
 * persisted invariant R007/MEM092 stays guarded; the MEM065 atomicity
 * carve-out applies to the S03 quality corpus only).
 *
 * NEVER imported by other scripts (MEM152): self-contained, runs main() on
 * load, exports nothing.
 *
 * Output: fixtures/isolation/garbage-and-malformed.docx (single byte-stable
 * file).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { zipSync, unzipSync } from 'fflate';

/**
 * Fixed local-noon timestamp — identical DOS time/date fields in every
 * timezone (same constant as make-fixtures.ts / make-perf-fixture.ts).
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
const OUTPUT_PATH = join(FIXTURES_DIR, 'isolation', 'garbage-and-malformed.docx');

const TITLE = 'Failure isolation demo: garbage entry and malformed bracket';
const CREATOR = 'CiteSync Fixtures';

/** docProps pins asserted by fixture.test.ts for EVERY valid fixture. */
const CREATED_PIN = '2024-01-15T10:30:00Z';
const MODIFIED_PIN = '2024-02-20T08:00:00Z';

// ---------------------------------------------------------------------------
// CONTENT CONTRACT — the verbatim constants (R017: byte-stable by design).
// ---------------------------------------------------------------------------

const BODY_P1 = 'The clean citation [1] resolves against the reference list.';
const BODY_P2 = 'The malformed bracket [1, x] must surface as a typed issue, never a crash.';
const REFERENCES_HEADING = 'References';
const ENTRY_GARBAGE = 'Junk without a year.';
const ENTRY_DOE = 'Doe, J. (2017).';
const ENTRY_ROE = 'Roe, M. (2018).';

/** Every authored content string — the verbatim self-check manifest. */
const CONTENT_STRINGS: readonly string[] = [
  BODY_P1,
  BODY_P2,
  REFERENCES_HEADING,
  ENTRY_GARBAGE,
  ENTRY_DOE,
  ENTRY_ROE,
];

const enc = new TextEncoder();
const u8 = (s: string): Uint8Array => enc.encode(s);

// ---------------------------------------------------------------------------
// XML escaping + run/paragraph builders (same shapes as make-fixtures.ts).
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function runXml(text: string): string {
  return `<w:r><w:t>${esc(text)}</w:t></w:r>`;
}

function paragraphXml(text: string, heading = false): string {
  const pPr = heading ? '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' : '';
  return `<w:p>${pPr}${runXml(text)}</w:p>`;
}

function documentXml(): string {
  const body = [
    paragraphXml(BODY_P1),
    paragraphXml(BODY_P2),
    paragraphXml(REFERENCES_HEADING, true),
    paragraphXml(ENTRY_GARBAGE),
    paragraphXml(ENTRY_DOE),
    paragraphXml(ENTRY_ROE),
  ].join('\n    ');
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
    `  <dcterms:created xsi:type="dcterms:W3CDTF">${CREATED_PIN}</dcterms:created>`,
    `  <dcterms:modified xsi:type="dcterms:W3CDTF">${MODIFIED_PIN}</dcterms:modified>`,
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
// Package assembly + self-checks.
// ---------------------------------------------------------------------------

/**
 * Fixed entry order (object literal insertion — R017). No footnotes part:
 * the reader requires only '[Content_Types].xml' + 'word/document.xml'
 * (packages/docx/src/zip/reader.ts REQUIRED_PARTS) and this doc carries no
 * notes — mirror of minimal.docx / the numeric corpus.
 */
function buildPackage(): Uint8Array {
  const parts: Record<string, string | Uint8Array> = {
    '[Content_Types].xml': contentTypesXml(),
    '_rels/.rels': packageRelsXml(),
    'word/document.xml': documentXml(),
    'docProps/core.xml': corePropsXml(TITLE, CREATOR),
    'docProps/app.xml': appXml(TITLE),
    'word/_rels/document.xml.rels': documentRelsXml(),
    'word/styles.xml': stylesXml(),
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

function main(): void {
  // 1. Self-check (R017): build twice in memory, require byte-identical.
  const bytes = buildPackage();
  assertByteEqual(bytes, buildPackage(), 'fixtures/isolation/garbage-and-malformed.docx');

  // 2. Structural self-check via plain fflate (never the reader).
  const out = unzipSync(bytes);
  const requiredParts = [
    '[Content_Types].xml',
    '_rels/.rels',
    'word/document.xml',
    'word/_rels/document.xml.rels',
    'word/styles.xml',
    'docProps/core.xml',
    'docProps/app.xml',
  ];
  for (const part of requiredParts) {
    if (!(part in out)) throw new Error(`self-check: missing required part ${part}`);
  }
  const decode = new TextDecoder();
  const documentXmlText = decode.decode(out['word/document.xml']);

  // 3. docProps pins (fixture.test.ts asserts these for EVERY valid fixture).
  const coreXml = decode.decode(out['docProps/core.xml']);
  if (!coreXml.includes(CREATED_PIN)) {
    throw new Error(`self-check: docProps/core.xml missing created pin ${CREATED_PIN}`);
  }
  if (!coreXml.includes(MODIFIED_PIN)) {
    throw new Error(`self-check: docProps/core.xml missing modified pin ${MODIFIED_PIN}`);
  }
  if (!coreXml.includes(`<dc:title>${esc(TITLE)}</dc:title>`) || !coreXml.includes(`<dc:creator>${esc(CREATOR)}</dc:creator>`)) {
    throw new Error('self-check: docProps/core.xml missing truthy title/creator');
  }

  // 4. Content-contract self-checks: every authored string verbatim.
  for (const s of CONTENT_STRINGS) {
    if (!documentXmlText.includes(s)) {
      throw new Error(`self-check: document.xml missing verbatim string "${s}"`);
    }
  }

  // 5. Write the committed fixture.
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, bytes);

  // 6. Report (deterministic facts for fixtures/README.md).
  const blockCount = documentXmlText.match(/<w:p(?=[\s>])/g)?.length ?? 0;
  const entryCount = 3; // ENTRY_GARBAGE + ENTRY_DOE + ENTRY_ROE
  console.log(`Wrote fixtures/isolation/garbage-and-malformed.docx (${bytes.length} bytes, ${documentXmlText.length} document.xml chars)`);
  console.log(`  blocks            ${blockCount} (2 body paragraphs + 1 'References' Heading1 + ${entryCount} reference entries)`);
  console.log(`  reference entries ${entryCount} (1 garbage -> CS006, 2 valid -> bibliography detected + D016 matching runs)`);
  console.log(`  malformed bracket '[1, x]' -> CS007 (invalid-numeric, reason 'mixed') — never a crash`);
  console.log(`  clean bracket     '[1]' -> resolves positionally to r0 (D016 resolved status)`);
  console.log(`  expected issues   CS006 x1 (reference-parse) + CS007 x1 (invalid-numeric 'mixed')`);
  console.log('  self-checks       byte-identity (R017) + required parts + docProps pins + verbatim strings — OK');
}

main();
