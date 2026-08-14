#!/usr/bin/env node
/**
 * scripts/make-quality-fixture.ts — M004-S03-T4: generated R017 quality
 * fixture (60 single-author entries, ~280 body citations, zero expected
 * issues).
 *
 * Authors the committed `fixtures/quality/medium.docx` AND its own committed
 * pure-data manifest `scripts/fixture-ground-truth-quality.ts` (which
 * REPLACES the T1 stub byte-for-byte). Mirrors `scripts/make-perf-fixture.ts`
 * authoring discipline exactly:
 *
 *   - AUTHORING NEVER DEPENDS ON THE READER (R008): fflate `zipSync` + hand-
 *     authored OOXML strings. A reader bug can never be masked by the
 *     authoring path.
 *   - DETERMINISM (R017): the DOS timestamp is pinned to a fixed LOCAL noon
 *     (2024-01-01 12:00 — the shared constant); entry order is fixed; content
 *     is drawn from a fixed-seed PRNG (mulberry32) — no clock, no
 *     Math.random, no fs timestamps. The script self-checks by building the
 *     package AND the manifest content twice in memory and requiring
 *     byte-identical output, and a re-run after commit rewrites both
 *     byte-identical (git diff empty).
 *
 * CONTENT CONTRACT (the R017 statistical-weight corpus case, D046):
 *   - 60 SINGLE-AUTHOR reference entries with UNIQUE (family, year) keys —
 *     unique keys mean no CS004 AMBIGUOUS rows and no CS005 suffix clusters;
 *   - 40 body paragraphs x 7 citations each = 280 body citations mixing
 *     narrative `Family (Year)` and parenthetical `(Family, Year)` single-
 *     author forms, drawn round-robin + randomly from the 60-entry pool so
 *     EVERY entry is cited >= 1x (no CS001 MISSING / CS002 UNUSED / CS009);
 *   - every entry is §21-parseable (the en-references r0/r2 shape
 *     `Family, I. (Year). Title. Container, V(I), P-P.` → parseConfidence 1
 *     → no CS006); NO numeric content (no CS007/CS008);
 *   - prose filler contains NO digits and no family-like tokens, so no
 *     accidental citation can form; narrative citations are always bounded
 *     by a scan-stopword prefix ("According to", "The findings of", "by")
 *     or sentence start so the name-prefix scan (candidate.ts) yields the
 *     exact expected raw (the T4 probe proves emission == manifest);
 *   - the two KNOWN_CITATIONS anchor strings ('Smith (2020)' narrative,
 *     '(Nguyen, 2021)' parenthetical) are authored verbatim in body
 *     paragraph 1 so the fixture.test.ts offset round-trip holds;
 *   - docProps pins the same dates as every other fixture (created
 *     2024-01-15T10:30:00Z / modified 2024-02-20T08:00:00Z, truthy
 *     title/author) so the metadata assertions hold here too.
 *
 * DEVIATION from the S03 research (documented): the KNOWN_CITATIONS anchors
 * are 'Smith (2020)' + '(Nguyen, 2021)' (single-author), NOT the perf
 * fixture's '(Nguyen & Tran, 2021)'. Multi-author entry tails
 * ('Family, X., & Y. (Year)') have no corpus precedent and their detection is
 * unverified; single-author tails keep the emitted manifest exact.
 *
 * MANIFEST discipline (MEM065 carve-out): fixtures/quality/medium.docx
 * carries its OWN manifest (scripts/fixture-ground-truth-quality.ts) and
 * joins NO ground-truth manifests (KNOWN_OCCURRENCES / KNOWN_REFERENCES /
 * KNOWN_MATCHES / KNOWN_NUMERIC_INDEX_MAP) and NO numeric locks.
 *
 * NEVER imported by other scripts (MEM152): self-contained, runs main() on
 * load, exports nothing. In particular make-fixtures.ts / make-perf-fixture.ts
 * are NEVER imported here — both run main() on import (MEM043); the OOXML
 * templates are duplicated per the make-perf-fixture precedent.
 *
 * Outputs:
 *   fixtures/quality/medium.docx                    (byte-stable fixture)
 *   scripts/fixture-ground-truth-quality.ts         (byte-stable manifest)
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
const OUTPUT_PATH = join(FIXTURES_DIR, 'quality', 'medium.docx');
const MANIFEST_PATH = join(PROJECT_ROOT, 'scripts', 'fixture-ground-truth-quality.ts');

/** Fixed PRNG seed — content is a pure function of this constant. */
const SEED = 0x51a7c0de;

/** Content budget constants (the auditable "medium" corpus claim). */
const PARAGRAPHS = 40;
const ENTRIES = 60;
const CITATIONS_PER_PARAGRAPH = 7;
const BODY_CITATIONS = PARAGRAPHS * CITATIONS_PER_PARAGRAPH; // 280
const TOTAL_RAWS = BODY_CITATIONS + ENTRIES; // 340 (body raws + entry-tail raws)

const TITLE = 'Medium synthetic quality fixture';
const CREATOR = 'CiteSync Fixtures';

/** docProps pins asserted by fixture.test.ts for EVERY valid fixture. */
const CREATED_PIN = '2024-01-15T10:30:00Z';
const MODIFIED_PIN = '2024-02-20T08:00:00Z';

/**
 * KNOWN_CITATIONS anchors (fixture.test.ts offset round-trip): entry r0 is
 * Smith (2020), entry r37 is Nguyen (2021) — the ANCHOR_TEXT below authors
 * both strings verbatim in body paragraph 1.
 */
const ANCHOR_NARRATIVE_ENTRY = 0; // Smith (2020)
const ANCHOR_PAREN_ENTRY = 37; // Nguyen (2021)
const ANCHOR_TEXT =
  'Smith (2020) argued that citation analysis improves with precise offsets; ' +
  'recent evidence (Nguyen, 2021) confirms the pattern across corpora.';

/**
 * 60 distinct single-word families (first 60 of the make-perf-fixture pool,
 * already proven to detect + match in the corpus). Smith is index 0,
 * Nguyen index 37 — both anchor citations.
 */
const FAMILIES: readonly string[] = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller',
  'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez',
  'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin',
  'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark',
  'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young', 'Allen', 'King',
  'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores', 'Green', 'Adams',
  'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell', 'Carter',
  'Roberts', 'Gomez', 'Phillips', 'Evans', 'Turner', 'Diaz', 'Parker',
  'Cruz', 'Edwards', 'Collins', 'Reyes',
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

const TITLE_WORDS: readonly string[] = [
  'citation', 'analysis', 'document', 'pipeline', 'evidence', 'offset',
  'structure', 'extraction', 'reference', 'matching', 'corpus', 'study',
  'method', 'approach', 'model', 'result', 'finding', 'data', 'process',
  'system', 'index', 'pattern', 'field', 'block', 'source', 'quality',
  'accuracy', 'precision', 'recall', 'consistency', 'determinism',
  'reproducibility', 'annotation', 'normalization', 'segmentation',
  'alignment', 'verification', 'validation', 'inference', 'classification',
  'coverage', 'granularity', 'metadata', 'identifier', 'author', 'year',
  'title', 'publisher', 'journal', 'volume', 'issue', 'edition', 'chapter',
  'bibliography', 'footnote', 'table', 'figure', 'appendix',
];

const TITLE_ADJECTIVES: readonly string[] = [
  'precise', 'structured', 'deterministic', 'reliable', 'robust', 'scalable',
  'efficient', 'comprehensive', 'systematic', 'rigorous', 'reproducible',
  'accurate', 'consistent', 'granular', 'incremental', 'semantic',
  'syntactic', 'temporal', 'spatial', 'contextual', 'empirical',
  'theoretical', 'quantitative', 'qualitative', 'comparative',
  'fine-grained', 'high-quality', 'well-established', 'peer-reviewed',
];

const TITLE_FUNCTION_WORDS: readonly string[] = [
  'for', 'in', 'of', 'with', 'from', 'across', 'within', 'during', 'under',
  'after', 'before', 'beyond', 'between', 'toward', 'through', 'around',
];

/** Sentence-start leads for parenthetical citations — safe everywhere. */
const PAREN_LEADS: readonly string[] = [
  'The analysis in a recent study',
  'Evidence across multiple corpora',
  'A systematic review',
  'Recent work in the field',
  'The reported results',
  'This approach',
  'The overall pattern',
  'The relevant literature',
  'A related investigation',
  'The empirical evidence',
  'The results of a systematic review',
  'A detailed comparison',
];

/** Verb tails after "(Family, Year)" — mid-sentence parentheticals. */
const PAREN_TAILS: readonly string[] = [
  'showed consistent results',
  'revealed a clear pattern',
  'confirmed the earlier observations',
  'provided strong evidence',
  'produced reliable measurements',
  'supported the main hypothesis',
];

/** Sentence endings for "(Family, Year)." — parenthetical at sentence end. */
const PAREN_ENDINGS: readonly string[] = [
  'This pattern appears in related work',
  'A similar approach appears in the literature',
  'The same effect appears in recent studies',
  'The topic receives attention in several fields',
  'The evidence aligns with earlier findings',
  'The method remains common in practice',
];

/**
 * Narrative leads whose LAST token is a scan-stopword (candidate.ts
 * SCAN_STOPWORDS: 'by', 'of', 'according'/'to') so the name-prefix scan
 * yields exactly "Family (Year)" as the raw.
 */
const NARRATIVE_LEADS: readonly string[] = [
  'According to',
  'As reported by',
  'The work of',
  'The findings of',
  'The study by',
  'The evidence of',
];

/** Verb tails after "The findings of Family (Year) ___". */
const FINDINGS_TAILS: readonly string[] = [
  'showed consistent results across the corpus',
  'revealed a clear pattern in the data',
  'confirmed the earlier observations',
  'supported the main hypothesis',
  'established a reliable baseline',
  'indicated a meaningful improvement',
];

/** Clauses after "According to Family (Year), ___". */
const ACCORDING_CLAUSES: readonly string[] = [
  'the method improves precision in practice',
  'the results remain consistent across corpora',
  'the approach reduces ambiguity in practice',
  'the evidence supports a cautious conclusion',
  'the pattern holds across multiple domains',
  'the framework scales to larger collections',
];

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

function runXml(text: string): string {
  return `<w:r><w:t>${esc(text)}</w:t></w:r>`;
}

function paragraphXml(text: string, heading = false): string {
  const pPr = heading ? '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' : '';
  return `<w:p>${pPr}${runXml(text)}</w:p>`;
}

function documentXml(bodyParagraphs: string[], entries: string[]): string {
  const body = [
    ...bodyParagraphs.map((p) => paragraphXml(p)),
    paragraphXml('References', true),
    ...entries.map((e) => paragraphXml(e)),
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
// Content generation (deterministic — every value flows from the seed).
// ---------------------------------------------------------------------------

interface QualityEntry {
  family: string;
  initials: string;
  year: number;
  title: string;
  container: string;
  volume: string;
  issue: string;
  pages: string;
}

/**
 * Build the 60-entry pool. Families are FIXED (FAMILIES[i], no rand) so the
 * set is exactly the auditable 60; years are pinned for the two anchor
 * entries (r0 Smith 2020, r37 Nguyen 2021) and drawn from the seeded stream
 * otherwise — every (family, year) key is unique because families are.
 */
function buildEntries(rand: () => number): QualityEntry[] {
  const entries: QualityEntry[] = [];
  for (let i = 0; i < ENTRIES; i++) {
    const family = FAMILIES[i]!;
    const year =
      i === ANCHOR_NARRATIVE_ENTRY
        ? 2020
        : i === ANCHOR_PAREN_ENTRY
          ? 2021
          : 2008 + Math.floor(rand() * 16); // 2008..2023
    const title =
      `${cap(pick(rand, TITLE_ADJECTIVES))} ${pick(rand, TITLE_WORDS)} ` +
      `${pick(rand, TITLE_FUNCTION_WORDS)} ${pick(rand, TITLE_WORDS)} ${pick(rand, TITLE_WORDS)}`;
    const container = pick(rand, CONTAINERS);
    const volume = String(1 + Math.floor(rand() * 30));
    const issue = String(1 + Math.floor(rand() * 8));
    const pages = `${10 + Math.floor(rand() * 90)}-${100 + Math.floor(rand() * 900)}`;
    entries.push({
      family,
      initials: String.fromCharCode(65 + (i % 26)) + '.',
      year,
      title,
      container,
      volume,
      issue,
      pages,
    });
  }
  return entries;
}

function entryText(e: QualityEntry): string {
  return `${e.family}, ${e.initials} (${e.year}). ${e.title}. ${e.container}, ${e.volume}(${e.issue}), ${e.pages}.`;
}

/** Tail citation raw of an entry — the leading 'Family, I. (Year)' prefix. */
function tailRaw(e: QualityEntry): string {
  return `${e.family}, ${e.initials} (${e.year})`;
}

/** Narrative raw of a body citation. */
function narrativeRaw(e: QualityEntry): string {
  return `${e.family} (${e.year})`;
}

/** Parenthetical raw of a body citation. */
function parentheticalRaw(e: QualityEntry): string {
  return `(${e.family}, ${e.year})`;
}

/**
 * One sentence carrying exactly ONE citation. The narrative templates are
 * SAFE by construction: their last token before the name is a scan-stopword
 * ('by', 'of', 'according', 'to' — candidate.ts SCAN_STOPWORDS), so the
 * name-prefix scan keeps exactly `Family` and the emitted raw equals the
 * manifest raw. Parenthetical templates are safe anywhere (the paren is the
 * structural boundary). Filler contains no digits and no capitalized
 * mid-sentence tokens, so no accidental citation can form.
 */
function clauseFor(
  rand: () => number,
  e: QualityEntry,
): { sentence: string; raw: string } {
  const narrative = rand() < 0.5;
  if (narrative) {
    const raw = narrativeRaw(e);
    if (rand() < 0.5) {
      // "According to Smith (2020), ..."
      return {
        sentence: `${pick(rand, NARRATIVE_LEADS)} ${e.family} (${e.year}), ${pick(rand, ACCORDING_CLAUSES)}.`,
        raw,
      };
    }
    // "The findings of Smith (2020) showed consistent results across the corpus."
    return {
      sentence: `The findings of ${e.family} (${e.year}) ${pick(rand, FINDINGS_TAILS)}.`,
      raw,
    };
  }
  const raw = parentheticalRaw(e);
  if (rand() < 0.5) {
    // "The analysis in a recent study (Smith, 2020) showed consistent results."
    return {
      sentence: `${pick(rand, PAREN_LEADS)} (${e.family}, ${e.year}) ${pick(rand, PAREN_TAILS)}.`,
      raw,
    };
  }
  // "This pattern appears in related work (Smith, 2020)."
  return {
    sentence: `${pick(rand, PAREN_ENDINGS)} (${e.family}, ${e.year}).`,
    raw,
  };
}

/**
 * The citation plan: a deterministic sequence of entry indexes, 7 per
 * paragraph. The first two slots are the ANCHOR citations (Smith r0 +
 * Nguyen r37, authored verbatim in paragraph 1); the next 60 cycle every
 * entry once (guaranteeing coverage — no CS001/CS002/CS009); the remainder
 * is seeded-random. Total = 280 body citations.
 */
function buildCitationPlan(rand: () => number): number[] {
  const seq: number[] = [ANCHOR_NARRATIVE_ENTRY, ANCHOR_PAREN_ENTRY];
  for (let i = 0; i < ENTRIES; i++) seq.push(i);
  while (seq.length < BODY_CITATIONS) seq.push(Math.floor(rand() * ENTRIES));
  return seq;
}

/**
 * Build the 40 body paragraphs. Paragraph 0 (index 0) carries the fixed
 * ANCHOR_TEXT (2 verbatim citations) followed by the remaining clause slots.
 * Returns per-paragraph text AND the per-paragraph raw plan (document order,
 * paragraph 0 first), so the manifest's expectedRaws/expectedMatches are the
 * exact authored strings.
 */
function buildBody(
  rand: () => number,
  entries: QualityEntry[],
  plan: number[],
): { paragraphs: string[]; rawsByParagraph: string[][] } {
  const paragraphs: string[] = [];
  const rawsByParagraph: string[][] = [];
  let slot = 0;
  for (let p = 0; p < PARAGRAPHS; p++) {
    const raws: string[] = [];
    const sentences: string[] = [];
    if (p === 0) {
      // Paragraph 1: the fixed ANCHOR_TEXT carries TWO verbatim citations
      // (narrative 'Smith (2020)' + parenthetical '(Nguyen, 2021)') and
      // consumes exactly two plan slots (r0 + r37), then 5 clause slots.
      const e0 = entries[plan[slot]!]!;
      slot += 1;
      const e1 = entries[plan[slot]!]!;
      slot += 1;
      if (e0.family !== 'Smith' || e1.family !== 'Nguyen') {
        throw new Error('self-check: anchor slots are not Smith/Nguyen');
      }
      sentences.push(ANCHOR_TEXT);
      raws.push(narrativeRaw(e0), parentheticalRaw(e1));
      for (let c = 2; c < CITATIONS_PER_PARAGRAPH; c++) {
        const e = entries[plan[slot]!]!;
        slot += 1;
        const { sentence, raw } = clauseFor(rand, e);
        sentences.push(sentence);
        raws.push(raw);
      }
    } else {
      for (let c = 0; c < CITATIONS_PER_PARAGRAPH; c++) {
        const e = entries[plan[slot]!]!;
        slot += 1;
        const { sentence, raw } = clauseFor(rand, e);
        sentences.push(sentence);
        raws.push(raw);
      }
    }
    paragraphs.push(sentences.join(' '));
    rawsByParagraph.push(raws);
  }
  return { paragraphs, rawsByParagraph };
}

// ---------------------------------------------------------------------------
// Manifest (scripts/fixture-ground-truth-quality.ts) — emitted byte-for-byte.
// ---------------------------------------------------------------------------

function jsonArray(items: readonly string[]): string {
  const body = items.map((s) => `    ${JSON.stringify(s)},`).join('\n');
  return `[\n${body}\n  ]`;
}

function jsonRecord(rec: Record<string, string>): string {
  const body = Object.entries(rec)
    .map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
    .join('\n');
  return `{\n${body}\n  }`;
}

/**
 * The full manifest source (pure function of the generated content — the
 * byte-identity self-check builds it twice).
 */
function manifestSource(
  raws: string[],
  matches: Record<string, string>,
  bodyCitations: number,
): string {
  return [
    '/**',
    ' * M004-S03 (T4) — quality fixture ground truth (generated).',
    ' *',
    ' * generated output of scripts/make-quality-fixture.ts — re-running the',
    ' * generator rewrites this file byte-identically (R017); do NOT edit by hand.',
    ' *',
    ' * Real manifest for fixtures/quality/medium.docx: expectedRaws in document',
    ' * order (body citation raws then entry-tail raws); raw-keyed',
    ' * expectedMatches (a raw uniquely identifies its entry because every',
    ' * (family, year) key is unique); all-zero expectedIssues; counts. The',
    ' * quality corpus carries its OWN manifest and joins NO ground-truth',
    ' * manifests (MEM065 carve-out).',
    ' */',
    '',
    '/** One quality fixture\'s authored ground truth (emitted by the generator). */',
    'export interface QualityFixtureGroundTruth {',
    "  /** Fixture path relative to fixtures/, e.g. 'quality/medium.docx'. */",
    '  fixture: string;',
    '  /** Expected emitted citation raws, in document order. */',
    '  expectedRaws: string[];',
    '  /** Raw-keyed expected matched entry id (raw uniquely identifies an entry). */',
    '  expectedMatches: Record<string, string>;',
    '  /** Expected issue counts per rule id ({} = all-zero). */',
    '  expectedIssues: Record<string, number>;',
    '  /** Optional content budget (paragraphs/entries/bodyCitations/totalRaws). */',
    '  counts?: Record<string, number>;',
    '}',
    '',
    '/**',
    ' * Quality corpus manifest — the generated fixtures/quality/medium.docx. Each',
    ' * generated fixture carries its OWN manifest and joins NO ground-truth',
    ' * manifests (MEM065 carve-out).',
    ' */',
    'export const QUALITY_CORPUS: QualityFixtureGroundTruth[] = [',
    '  {',
    "    fixture: 'quality/medium.docx',",
    `    expectedRaws: ${jsonArray(raws)},`,
    `    expectedMatches: ${jsonRecord(matches)},`,
    '    expectedIssues: {},',
    `    counts: { paragraphs: ${PARAGRAPHS}, entries: ${ENTRIES}, bodyCitations: ${bodyCitations}, totalRaws: ${raws.length} },`,
    '  },',
    '];',
    '',
  ].join('\n');
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
function buildPackage(bodyParagraphs: string[], entries: QualityEntry[]): Uint8Array {
  const parts: Record<string, string | Uint8Array> = {
    '[Content_Types].xml': contentTypesXml(),
    '_rels/.rels': packageRelsXml(),
    'word/document.xml': documentXml(bodyParagraphs, entries.map(entryText)),
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

function assertStringEqual(a: string, b: string, what: string): void {
  if (a !== b) {
    throw new Error(`determinism check failed for ${what}: string differs (length ${a.length} != ${b.length})`);
  }
}

function main(): void {
  // 1. Generate content from ONE deterministic rand stream.
  const rand = mulberry32(SEED);
  const entries = buildEntries(rand);
  const plan = buildCitationPlan(rand);
  const { paragraphs, rawsByParagraph } = buildBody(rand, entries, plan);

  // Body raws in document order, then tail raws in entry order (the manifest
  // order contract). expectedMatches maps every body raw to its cited entry
  // and every tail raw to its own entry (raws are unique — unique keys).
  const bodyRaws: string[] = [];
  const matches: Record<string, string> = {};
  let slot = 0;
  for (let p = 0; p < PARAGRAPHS; p++) {
    for (const raw of rawsByParagraph[p]!) {
      bodyRaws.push(raw);
      const entryIdx = plan[slot]!;
      matches[raw] = `r${entryIdx}`;
      slot += 1;
    }
  }
  for (let i = 0; i < ENTRIES; i++) {
    const raw = tailRaw(entries[i]!);
    bodyRaws.push(raw);
    matches[raw] = `r${i}`;
  }
  const raws = bodyRaws;

  // 2. Self-check (R017): build the package twice in memory, byte-identical.
  const bytes = buildPackage(paragraphs, entries);
  assertByteEqual(bytes, buildPackage(paragraphs, entries), 'fixtures/quality/medium.docx');

  // 3. Self-check: the manifest source is a pure function — build twice.
  const manifestA = manifestSource(raws, matches, BODY_CITATIONS);
  const manifestB = manifestSource(raws, matches, BODY_CITATIONS);
  assertStringEqual(manifestA, manifestB, 'scripts/fixture-ground-truth-quality.ts');

  // 4. Structural self-check via plain fflate (never the reader).
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

  // 5. docProps pins (fixture.test.ts asserts these for EVERY valid fixture).
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

  // 6. Content-contract self-checks (the auditable "medium corpus" claim).
  //    a. Anchor strings verbatim in paragraph 0.
  const bodyText = paragraphs.join(' ');
  if (!bodyText.includes(ANCHOR_TEXT)) {
    throw new Error('self-check: anchor text not authored verbatim');
  }
  //    b. Unique (family, year) keys.
  const seenKeys = new Set<string>();
  for (const e of entries) {
    const key = `${e.family}::${e.year}`;
    if (seenKeys.has(key)) throw new Error(`self-check: duplicate (family, year) key ${key}`);
    seenKeys.add(key);
  }
  //    c. Every entry cited >= 1x in the body.
  const cited = new Set<number>(plan.slice(0, BODY_CITATIONS));
  if (cited.size !== ENTRIES) {
    throw new Error(`self-check: only ${cited.size}/${ENTRIES} entries cited in the body`);
  }
  //    d. No digits in body prose OUTSIDE the authored citations (filler
  //       rule — a 4-digit year is required for a citation to form, so
  //       filler with no digits can never accidentally cite). Strip every
  //       authored raw from its paragraph and assert the remainder is clean.
  for (let p = 0; p < PARAGRAPHS; p++) {
    let remainder = paragraphs[p]!;
    for (const raw of rawsByParagraph[p]!) remainder = remainder.replaceAll(raw, '');
    if (/[0-9]/.test(remainder)) {
      throw new Error(`self-check: paragraph ${p + 1} filler contains a digit — accidental citation risk`);
    }
  }
  //    e. Content-budget windows.
  if (paragraphs.length !== PARAGRAPHS) {
    throw new Error(`self-check: ${paragraphs.length} paragraphs — expected ${PARAGRAPHS}`);
  }
  if (entries.length !== ENTRIES) {
    throw new Error(`self-check: ${entries.length} entries — expected ${ENTRIES}`);
  }
  if (bodyRaws.length !== BODY_CITATIONS + ENTRIES) {
    throw new Error(`self-check: ${bodyRaws.length} raws — expected ${BODY_CITATIONS + ENTRIES}`);
  }
  if (BODY_CITATIONS < 240 || BODY_CITATIONS > 320) {
    throw new Error(`self-check: ${BODY_CITATIONS} body citations — outside 240..320`);
  }
  //    f. Every raw maps to an entry, and every tail raw is present once.
  const tailSet = new Set<string>();
  for (const e of entries) tailSet.add(tailRaw(e));
  if (tailSet.size !== ENTRIES) throw new Error('self-check: tail raws not unique');
  for (const raw of Object.keys(matches)) {
    if (!raws.includes(raw)) throw new Error(`self-check: matches key "${raw}" missing from raws`);
  }

  // 7. Write the committed fixture + manifest.
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, bytes);
  writeFileSync(MANIFEST_PATH, manifestA);

  // 8. Report (deterministic facts for fixtures/README.md).
  const paragraphBlocks = documentXmlText.match(/<w:p(?=[\s>])/g)?.length ?? 0;
  const totalWords = bodyText.split(/\s+/).filter(Boolean).length;
  console.log(`Wrote fixtures/quality/medium.docx (${bytes.length} bytes, ${documentXmlText.length} document.xml chars)`);
  console.log(`Wrote scripts/fixture-ground-truth-quality.ts (${manifestA.length} chars)`);
  console.log(`  body paragraphs   ${paragraphs.length} x ${CITATIONS_PER_PARAGRAPH} citations = ${BODY_CITATIONS} body citations (contract 240..320)`);
  console.log(`  blocks            ${paragraphBlocks} (40 body + 1 'References' Heading1 + ${ENTRIES} reference entries)`);
  console.log(`  words             ${totalWords}`);
  console.log(`  reference entries ${entries.length} (unique (family, year) keys, all §21-parseable)`);
  console.log(`  total raws        ${raws.length} (${BODY_CITATIONS} body + ${ENTRIES} entry tails)`);
  console.log(`  anchors           '${narrativeRaw(entries[ANCHOR_NARRATIVE_ENTRY]!)}' + '${parentheticalRaw(entries[ANCHOR_PAREN_ENTRY]!)}' verbatim in paragraph 1`);
  console.log(`  expected issues   {} (all-zero — unique keys, full coverage, clean parse, no numeric)`);
  console.log('  self-checks       byte-identity (R017, fixture + manifest) + parts + docProps pins + budgets + coverage — OK');
}

main();
