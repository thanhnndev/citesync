/**
 * @citesync/docx — parts → AcademicDocument assembly (S01-T6).
 *
 * The S01 deliverable assembler: takes the bounded {@link ZipParts} map from
 * the S01-T3 bounds-guarded reader and produces the §15
 * {@link AcademicDocument} that S02–S04 consume — `metadata`, `blocks`,
 * `sourceMap` owned here. S02 detection fills `bibliography` and S03 (T06)
 * fills `doc.citations` (§20 occurrences via `extractCitations`) and
 * `doc.bibliography.entries` (§21 reference records via `parseReferences`,
 * with §88 failures isolated into `doc.referenceParseIssues`).
 *
 * PARTS READ: word/document.xml (required — the reader already enforces it),
 * word/styles.xml, word/footnotes.xml, word/endnotes.xml (optional style map /
 * note blocks), docProps/core.xml (optional metadata), and
 * word/_rels/document.xml.rels (optional — security scan only).
 *
 * SECURITY (R002/R019/R022, §87): macros and remote content are note-and-skip,
 * never executed or followed. A macro-bearing part (word/vbaProject.bin or any
 * part whose path contains "vba" or "macro") is flagged via
 * `security.macrosPresent` — its bytes are
 * never decoded, decompressed beyond the reader's bounds, or evaluated.
 * External relationship targets (TargetMode="External" or an absolute
 * scheme/UNC target in word/_rels/document.xml.rels) are recorded in
 * `security.remoteTargets` first-seen and never fetched. No eval, no network,
 * no code paths — only tag scanning.
 *
 * BOUNDS: every decoded part string is checked against XML_STRING_MAX and
 * rejected with {@link ZipBombError} before any parsing (defense in depth on
 * top of the reader's per-entry/aggregate caps).
 *
 * FAILURE ISOLATION (§88): a malformed paragraph/table/note is isolated and
 * recorded in `parseIssues` (per part, with counts) — never thrown. A part
 * that is present but contains no XML markup at all is likewise recorded.
 *
 * DETERMINISM (R008): pure functions of the input bytes — no clock, no random,
 * no platform dependence; TextDecoder('utf-8') is deterministic and Map
 * iteration order follows archive order, so the same .docx bytes always yield
 * a deep-equal AcademicDocument.
 */

import type {
  AcademicDocument,
  BlockSourceMap,
  DocumentBlock,
  DocumentMetadata,
  DocumentSecurityInfo,
  ParseIssue,
} from '@citesync/document-model';

import { decodeEntities } from './xml/entities.js';
import { localName } from './xml/ns.js';
import { attrVal, readOpenTag, scanTagEnd, tagName } from './xml/tag-scan.js';
import { NotADocxError, ZipBombError } from './zip/errors.js';
import { XML_STRING_MAX } from './zip/limits.js';
import type { ZipParts } from './zip/reader.js';
import { extractCoreProperties } from './metadata.js';
import { parseBody } from './parser/document.js';
import { noteToBlock, scanNotePart } from './parser/footnotes.js';
import { loadStyleMap } from './parser/style.js';
import { detectBibliography } from './bibliography/detect.js';
import { extractCitations, parseReferences } from './extract.js';
import { buildMatchMap } from './match/index.js';

const PART_DOCUMENT = 'word/document.xml';
const PART_STYLES = 'word/styles.xml';
const PART_FOOTNOTES = 'word/footnotes.xml';
const PART_ENDNOTES = 'word/endnotes.xml';
const PART_CORE = 'docProps/core.xml';
const PART_RELS = 'word/_rels/document.xml.rels';

/** Part path signals a macro-bearing part (never decoded/executed). */
const MACRO_PART_RE = /(^|\/)(vba|macro)|\.bin$/i;

/**
 * Assemble a bounded parts map into an {@link AcademicDocument}.
 *
 * @throws {@link ZipBombError} if any decoded part exceeds XML_STRING_MAX.
 *   Structurally invalid archives are already rejected by the reader.
 */
export function buildModel(parts: ZipParts): AcademicDocument {
  // Decode the parts we read, enforcing the XML string cap per part.
  const documentXml = decodePart(parts, PART_DOCUMENT);
  if (documentXml === undefined) {
    // Defensive: the reader already rejects archives missing this part, so
    // this is unreachable in practice — typed error keeps the contract.
    throw new NotADocxError(`missing required part "${PART_DOCUMENT}"`);
  }
  const stylesXml = decodePart(parts, PART_STYLES);
  const footnotesXml = decodePart(parts, PART_FOOTNOTES);
  const endnotesXml = decodePart(parts, PART_ENDNOTES);
  const coreXml = decodePart(parts, PART_CORE);

  const styles = stylesXml === undefined ? undefined : loadStyleMap(stylesXml);

  // Body blocks (paragraphs + tables) in document order, with source-map runs.
  const body = parseBody(documentXml, { part: 'doc', styles });

  // Note blocks appended after the body (footnotes then endnotes), each with a
  // covering span within its own part. The footnotes part uses `w:footnote`
  // elements; the endnotes part uses `w:endnote`.
  const footnoteNotes = footnotesXml === undefined ? [] : scanNotePart(footnotesXml, 'footnote');
  const endnoteNotes = endnotesXml === undefined ? [] : scanNotePart(endnotesXml, 'endnote');
  const footnoteBlocks = footnoteNotes
    .map((n) => noteToBlock(n, { part: 'fn', type: 'footnote' }));
  const endnoteBlocks = endnoteNotes.map((n) => noteToBlock(n, { part: 'en', type: 'endnote' }));

  const blocks: DocumentBlock[] = [
    ...body.entries.map((e) => e.block),
    ...footnoteBlocks,
    ...endnoteBlocks,
  ];

  // Document-wide source map (blockId -> run-level detail).
  const sourceMapBlocks: Record<string, BlockSourceMap> = {};
  for (const e of body.entries) sourceMapBlocks[e.block.id] = e.sourceMapEntry;
  for (const n of footnoteNotes) {
    sourceMapBlocks[`fn-fn${n.noteIndex}`] = { blockId: `fn-fn${n.noteIndex}`, runs: n.runs };
  }
  for (const n of endnoteNotes) {
    sourceMapBlocks[`en-fn${n.noteIndex}`] = { blockId: `en-fn${n.noteIndex}`, runs: n.runs };
  }

  const metadata: DocumentMetadata = extractCoreProperties(coreXml);
  const parseIssues = collectParseIssues(documentXml, body, footnoteNotes, endnoteNotes);
  const security = scanSecurity(parts);

  // S02 (bibliography detection, D009): run the weighted-signal detector over
  // the BODY blocks only — bibliographies live in the document part, never in
  // notes. `detected` fills doc.bibliography with the section; `below-threshold`
  // still fills it (candidates + best confidence) so the ask-user path is
  // model-first-class (R004 / PRD §17 — the engine never silently guesses a
  // section); `none` leaves it undefined (absent bibliography). detectBibliography
  // is pure, so this preserves buildModel determinism (R008).
  const bibResult = detectBibliography(body.entries.map((e) => e.block));

  const doc: AcademicDocument = {
    metadata,
    blocks,
    citations: [],
    sourceMap: { version: 1, blocks: sourceMapBlocks },
  };
  if (bibResult.outcome === 'detected') {
    doc.bibliography = bibResult.section;
    // S03 (T06): parse the detected section's blockIds span into §21 entries
    // (heading skipped unless it carries an entry; §88 failures isolated).
    const { entries, issues } = parseReferences(doc);
    doc.bibliography.entries = entries;
    if (issues.length > 0) doc.referenceParseIssues = issues;
  } else if (bibResult.outcome === 'below-threshold') {
    // Ask-user path: no confident section, but candidates exist. blockIds and
    // heading stay undefined until the user picks a candidate (M003) — no
    // entries are parsed until a section is chosen.
    doc.bibliography = {
      outcome: 'below-threshold',
      confidence: bibResult.confidence,
      candidates: bibResult.candidates,
    };
  }
  // S03 (T06): fill §20 citation occurrences — plain-text detection (T03) over
  // every block (body + footnotes + endnotes) with structured-field identity
  // (T04, Zotero/Word) overlaid. Pure + deterministic (R008); the citation pass
  // is independent of the bibliography outcome.
  doc.citations = extractCitations(doc);
  if (parseIssues.length > 0) doc.parseIssues = parseIssues;
  if (security !== undefined) doc.security = security;
  // S04 (T2): fill the §27 match-state map LAST — after `citations` and
  // `bibliography.entries` are both populated by the extraction tail above.
  // The map is meaningful only when there is something to match: at least one
  // citation occurrence OR a detected bibliography with parsed entries
  // (entries present with zero citations still yields the bibliography-side
  // UNUSED rows). Pure + deterministic (R008): same bytes → same map.
  if (
    doc.citations.length > 0 ||
    (doc.bibliography?.entries?.length ?? 0) > 0
  ) {
    doc.matchMap = buildMatchMap(doc);
  }
  return doc;
}

/**
 * Decode one part to a string, enforcing XML_STRING_MAX (chars) before any
 * parsing. Absent parts decode to `undefined`. Never throws on decode (utf-8
 * with replacement is deterministic); only the size cap throws.
 */
function decodePart(parts: ZipParts, path: string): string | undefined {
  const bytes = parts.get(path);
  if (bytes === undefined) return undefined;
  const text = new TextDecoder('utf-8').decode(bytes);
  if (text.length > XML_STRING_MAX) {
    throw new ZipBombError(
      `part "${path}" decodes to ${text.length} chars (> XML_STRING_MAX ${XML_STRING_MAX})`,
    );
  }
  return text;
}

/**
 * Collect the isolated (non-fatal) parse issues across parts (§88), in a
 * deterministic part order. Malformed counts per part collapse into one issue
 * each so the list stays bounded.
 */
function collectParseIssues(
  documentXml: string,
  body: ReturnType<typeof parseBody>,
  footnoteNotes: ReturnType<typeof scanNotePart>,
  endnoteNotes: ReturnType<typeof scanNotePart>,
): ParseIssue[] {
  const issues: ParseIssue[] = [];
  if (!documentXml.includes('<')) {
    issues.push({
      part: PART_DOCUMENT,
      code: 'not-xml',
      message: 'part contains no XML markup; produced an empty document',
    });
  }
  if (body.malformedParagraphs > 0 || body.malformedTables > 0) {
    issues.push({
      part: PART_DOCUMENT,
      code: 'malformed-content',
      message:
        `${body.malformedParagraphs} malformed paragraph(s), ` +
        `${body.malformedTables} malformed table(s) — isolated, partial text kept`,
    });
  }
  for (const [part, notes] of [
    [PART_FOOTNOTES, footnoteNotes],
    [PART_ENDNOTES, endnoteNotes],
  ] as const) {
    const malformed = notes.filter((n) => n.malformed).length;
    if (malformed > 0) {
      issues.push({
        part,
        code: 'malformed-content',
        message: `${malformed} malformed note(s) — isolated, partial text kept`,
      });
    }
  }
  return issues;
}

/**
 * Security scan (note-and-skip): macro parts are flagged by part path (bytes
 * never decoded); external relationship targets in word/_rels/document.xml.rels
 * are recorded first-seen and never followed. Returns `undefined` when nothing
 * was flagged so the model stays clean for benign documents.
 */
function scanSecurity(parts: ZipParts): DocumentSecurityInfo | undefined {
  let macrosPresent = false;
  for (const name of parts.keys()) {
    if (MACRO_PART_RE.test(name)) {
      macrosPresent = true;
      break;
    }
  }
  const rels = parts.get(PART_RELS);
  const remoteTargets = rels === undefined ? undefined : scanRemoteTargets(decodeForScan(rels));
  if (!macrosPresent && (remoteTargets === undefined || remoteTargets.length === 0)) {
    return undefined;
  }
  const info: DocumentSecurityInfo = { macrosPresent };
  if (remoteTargets !== undefined && remoteTargets.length > 0) {
    info.remoteTargets = remoteTargets;
  }
  return info;
}

/** Decode the (small) rels part for scanning; size-capped like every part. */
function decodeForScan(bytes: Uint8Array): string {
  const text = new TextDecoder('utf-8').decode(bytes);
  if (text.length > XML_STRING_MAX) {
    throw new ZipBombError(
      `part "${PART_RELS}" decodes to ${text.length} chars (> XML_STRING_MAX ${XML_STRING_MAX})`,
    );
  }
  return text;
}

/**
 * Collect external relationship targets (TargetMode="External" or an absolute
 * scheme/UNC target) from a package rels part, first-seen order. Only tag
 * scanning — targets are recorded, never fetched or followed.
 */
function scanRemoteTargets(relsXml: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const n = relsXml.length;
  let i = 0;
  while (i < n) {
    const lt = relsXml.indexOf('<', i);
    if (lt === -1) break;
    const next = relsXml[lt + 1];
    if (next === '?') {
      const end = relsXml.indexOf('?>', lt + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (next === '!' && relsXml.startsWith('!--', lt + 1)) {
      const end = relsXml.indexOf('-->', lt + 3);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (next === '!') {
      const end = scanTagEnd(relsXml, lt);
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (next === '/') {
      const gt = relsXml.indexOf('>', lt + 2);
      i = gt === -1 ? n : gt + 1;
      continue;
    }
    const tag = readOpenTag(relsXml, lt);
    if (tag === null) break; // unterminated tail — stop safely
    if (localName(tagName(tag.inner)) === 'Relationship') {
      const target = attrVal(tag.inner, 'Target');
      const targetMode = attrVal(tag.inner, 'TargetMode');
      if (target !== undefined && isExternalTarget(target, targetMode) && !seen.has(target)) {
        seen.add(target);
        out.push(decodeEntities(target).decoded);
      }
    }
    i = lt + tag.inner.length + 2;
  }
  return out;
}

/** An absolute scheme URI (http:, file:, ...), a UNC path, or TargetMode="External". */
function isExternalTarget(target: string, targetMode: string | undefined): boolean {
  if (targetMode === 'External') return true;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) return true;
  if (target.startsWith('\\\\')) return true;
  return false;
}
