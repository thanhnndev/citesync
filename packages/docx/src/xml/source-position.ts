/**
 * @citesync/docx — lightweight source-position scanner for `<w:t>` offsets (S01-T4).
 *
 * fast-xml-parser exposes structure but NO byte/char positions of nodes
 * (MEM008), yet R009 evidence requires exact offsets. This module is the
 * offset backbone (approach A from research §5b): a small pure function that
 * walks the RAW `document.xml` string and, for each `<w:t>`, records
 *   (a) its absolute start char index in the XML string, and
 *   (b) the RUNNING accumulated character offset into the current paragraph's
 *       decoded text as text is appended.
 *
 * Offset convention (packages/document-model): `startOffset`/`endOffset` are
 * CHARACTER offsets within the paragraph/block TEXT (entity-decoded), NOT raw
 * XML byte offsets, and `endOffset` is EXCLUSIVE so that
 * `paragraph.text.slice(startOffset, endOffset)` equals the run's decoded text
 * exactly. The scanner therefore advances the running offset by the
 * entity-DECODED length of each `<w:t>` — never the raw length.
 *
 * The scanner is deliberately independent of fast-xml-parser; it relies only
 * on the raw string and deterministic {@link decodeEntities}. A quoted-aware
 * tag parser keeps it exact in the face of attributes containing '>' inside
 * quoted values, comments, CDATA and processing instructions.
 */

import { decodeEntities } from './entities.js';

/** Prefix of the WordprocessingML main namespace (document.xml root binding). */
const W = 'w';

/** A single scanned `<w:t>` occurrence. */
export interface WtRunScan {
  /** 0-based paragraph ordinal (0 = first `w:p` containing this scan). */
  paragraphIndex: number;
  /** 0-based ordinal of this run within its paragraph, in document order. */
  runIndex: number;
  /** Entity-decoded text of this `<w:t>` as it appears in the paragraph text. */
  text: string;
  /**
   * Absolute char index in the raw XML string where this run's text content
   * begins (immediately after the opening tag's `>`).
   */
  xmlStartOffset: number;
  /**
   * Absolute char index in the raw XML string of the opening `<` of this
   * run's closing `</w:t>` tag (exclusive of the text content).
   */
  xmlEndOffset: number;
  /**
   * Running char offset into the accumulated paragraph text where this run
   * begins. Guarantee: `paragraph.text.slice(startOffset, endOffset) === text`.
   */
  startOffset: number;
  /** Exclusive char offset into the accumulated paragraph text where this run ends. */
  endOffset: number;
  /** True when this `<w:t>` declared `xml:space="preserve"`. */
  preserveSpace: boolean;
  /**
   * Entity char-length delta of this run's raw content (`text.length` minus
   * raw content length). Always `<= 0` (decoding only shrinks). Lets callers
   * reconcile the XML span with the decoded span.
   */
  entityDelta: number;
}

/** A scanned paragraph (contiguous `w:p` region) and its runs. */
export interface ParagraphScan {
  paragraphIndex: number;
  /**
   * Accumulated entity-decoded text of all `<w:t>` runs in this paragraph, in
   * document order. This is what a consumer slices with the run offsets.
   */
  text: string;
  /** Absolute char index in the raw XML string of this paragraph's `<w:p` tag. */
  xmlStartOffset: number;
  /**
   * Absolute char index just PAST the `>` of the paragraph's closing `</w:p>`
   * tag; `-1` if the paragraph was still unterminated at end of input.
   */
  xmlEndOffset: number;
  /** The runs of this paragraph, in document order. */
  runs: WtRunScan[];
}

/** Result of {@link scanWtOffsets}: paragraphs plus a flattened run list. */
export interface SourceScanResult {
  /** All paragraphs, in document order. */
  paragraphs: ParagraphScan[];
  /** All runs flattened across paragraphs, in document order. */
  runs: WtRunScan[];
}

/**
 * Find the index of the `>` that closes the tag beginning at `lt`, treating
 * `"` and `'` quoted attribute values so a literal `>` inside quotes is not
 * mistaken for the tag end. Returns `-1` when unterminated. For closing tags
 * (no attributes) the first `>` closes them.
 */
function scanTagEnd(xml: string, lt: number): number {
  const n = xml.length;
  let i = lt + 1;
  let quote: '"' | "'" | null = null;
  for (; i < n; i++) {
    const c = xml[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === '>') return i;
  }
  return -1;
}

/** Parse an opening tag at `lt` (index of `<`). Null when unterminated. */
function readOpenTag(xml: string, lt: number): { inner: string; selfClosing: boolean } | null {
  const tagEnd = scanTagEnd(xml, lt);
  if (tagEnd === -1) return null;
  const inner = xml.slice(lt + 1, tagEnd);
  let endIdx = inner.length - 1;
  while (endIdx >= 0 && /\s/.test(inner[endIdx]!)) endIdx -= 1;
  const selfClosing = endIdx >= 0 && inner[endIdx] === '/';
  return { inner, selfClosing };
}

/** Element name from an opening tag's inner text (up to whitespace or `/`). */
function tagName(inner: string): string {
  let i = 0;
  const n = inner.length;
  for (; i < n; i++) {
    const c = inner[i]!;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '/') break;
  }
  return inner.slice(0, i);
}

function local(name: string): string {
  const idx = name.indexOf(':');
  return idx === -1 ? name : name.slice(idx + 1);
}

function pfx(name: string): string {
  const idx = name.indexOf(':');
  return idx === -1 ? '' : name.slice(0, idx);
}

function isW(name: string, wanted: string): boolean {
  return pfx(name) === W && local(name) === wanted;
}

/** Value of `xml:space` in an opening tag's inner text; null when absent. */
function xmlSpaceAttr(inner: string): 'preserve' | 'default' | null {
  const m = /xml:space\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(inner);
  if (!m) return null;
  const v = (m[1] ?? m[2]) as string;
  return v === 'preserve' || v === 'default' ? v : null;
}

/**
 * Scan the raw `document.xml` string for `<w:t>` text elements.
 *
 * Pure, deterministic, independent of fast-xml-parser. Tracks paragraph
 * boundaries by `w:p` open/close tags (text and run offsets restart at each
 * paragraph). Entity-decodes each `<w:t>` content and advances the running
 * paragraph-text offset by the DECODED length, so returned offsets obey the
 * slice contract: `paragraph.text.slice(startOffset, endOffset) === text`.
 */
export function scanWtOffsets(xml: string): SourceScanResult {
  const paragraphs: ParagraphScan[] = [];
  const allRuns: WtRunScan[] = [];

  const n = xml.length;

  // Current paragraph accumulation.
  let paragraphIndex = 0;
  let paraText = '';
  let runOffset = 0;
  let runIndex = 0;
  let paraXmlStart = -1;
  let paraXmlEnd = -1;

  // Current open `<w:t>` state.
  let openText = false;
  let textInnerXmlStart = -1; // char index just past `>` of the open w:t tag
  let pendingPreserve = false;

  // Mutable run builder shared by every emit site.
  const emitRun = (raw: string, start: number, end: number): void => {
    const { decoded, delta } = decodeEntities(raw);
    const record: WtRunScan = {
      paragraphIndex,
      runIndex,
      text: decoded,
      xmlStartOffset: start,
      xmlEndOffset: end,
      startOffset: runOffset,
      endOffset: runOffset + decoded.length,
      preserveSpace: pendingPreserve,
      entityDelta: delta,
    };
    allRuns.push(record);
    paraText += decoded;
    runOffset += decoded.length;
    runIndex += 1;
    openText = false;
    textInnerXmlStart = -1;
    pendingPreserve = false;
  };

  let i = 0;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) break; // trailing plain text — nothing structural left

    const next = xml[lt + 1];

    // Processing instruction `<? ... ?>`.
    if (next === '?') {
      const end = xml.indexOf('?>', lt + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }

    // Comment `<!-- ... -->` (may legally contain '<' chars inside).
    if (next === '!' && xml.startsWith('!--', lt + 1)) {
      const end = xml.indexOf('-->', lt + 3);
      i = end === -1 ? n : end + 3;
      continue;
    }

    // CDATA `<![CDATA[ ... ]]>`.
    if (next === '!' && xml.startsWith('![CDATA[', lt + 1)) {
      // Rare inside w:t, but treat content transparently: if we are inside an
      // open w:t, the CDATA body is literal text (no entities decoded).
      if (openText) {
        emitRun(xml.slice(textInnerXmlStart, lt), textInnerXmlStart, lt);
      }
      const end = xml.indexOf(']]>', lt + 9);
      i = end === -1 ? n : end + 3;
      continue;
    }

    // Other `<!...>` (DOCTYPE / declaration). Skip to its '>'.
    if (next === '!') {
      const end = scanTagEnd(xml, lt);
      i = end === -1 ? n : end + 1;
      continue;
    }

    // Closing tag `</name>`.
    if (next === '/') {
      if (openText) {
        // Close the current `<w:t>`: slice between the opening tag's `>` and this '<'.
        emitRun(xml.slice(textInnerXmlStart, lt), textInnerXmlStart, lt);
      }
      const gt = xml.indexOf('>', lt + 2);
      const closeInner = (gt === -1 ? xml.slice(lt + 2) : xml.slice(lt + 2, gt)).trim();
      if (isW(closeInner, 'p')) {
        // End of paragraph.
        paraXmlEnd = gt === -1 ? n : gt + 1;
        flush();
        paragraphIndex += 1;
        paraText = '';
        runOffset = 0;
        runIndex = 0;
        paraXmlStart = -1;
      }
      i = gt === -1 ? n : gt + 1;
      continue;
    }

    // Opening tag `<name ...>`.
    const tag = readOpenTag(xml, lt);
    if (tag === null) break; // unterminated tag — bail safely

    // Defensive: if a non-`w:t`/`w:p` element opens while we hold an open
    // `w:t` (malformed nesting), finalize the partial run first.
    if (openText && !(isW(tagName(tag.inner), 't') || isW(tagName(tag.inner), 'p'))) {
      emitRun(xml.slice(textInnerXmlStart, lt), textInnerXmlStart, lt);
    }

    const name = tagName(tag.inner);

    if (isW(name, 'p')) {
      // New paragraph.
      paraXmlStart = lt;
      paraText = '';
      runOffset = 0;
      runIndex = 0;
      openText = false;
      textInnerXmlStart = -1;
      pendingPreserve = false;
      if (tag.selfClosing) {
        // Empty `<w:p/>`: record a paragraph with no runs.
        paraXmlEnd = lt + tag.inner.length + 2;
        flush();
        paragraphIndex += 1;
        paraXmlStart = -1;
      }
    } else if (isW(name, 't') && !tag.selfClosing) {
      openText = true;
      // Content starts right after `<w:t ...>`.
      textInnerXmlStart = lt + tag.inner.length + 2; // +1 '<' +1 '>'
      pendingPreserve = xmlSpaceAttr(tag.inner) === 'preserve';
    } else if (isW(name, 't') && tag.selfClosing) {
      // Empty `<w:t/>`: record a zero-length run.
      pendingPreserve = xmlSpaceAttr(tag.inner) === 'preserve';
      emitRun('', lt, lt + tag.inner.length + 2);
    }

    i = lt + tag.inner.length + 2; // +1 '<' +1 '>'
  }

  // Unterminated trailing text inside an open `<w:t>`.
  if (openText && textInnerXmlStart >= 0) {
    emitRun(xml.slice(textInnerXmlStart), textInnerXmlStart, n);
  }

  // Final partially- or fully-open paragraph.
  if (paraXmlStart !== -1 || paragraphs.length === 0) {
    if (paraXmlStart === -1) paraXmlStart = 0;
    flush();
  }

  return { paragraphs, runs: allRuns };

  /** Flush the current paragraph into `paragraphs` (slices the run list). */
  function flush(): void {
    paragraphs.push({
      paragraphIndex,
      text: paraText,
      xmlStartOffset: paraXmlStart,
      xmlEndOffset: paraXmlEnd,
      runs: allRuns.filter((r) => r.paragraphIndex === paragraphIndex),
    });
  }
}
