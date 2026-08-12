/**
 * @citesync/docx — w:p paragraph parsing: run coalescing + source offsets (S01-T5).
 *
 * Turns raw `w:p` XML into {@link DocumentBlock} primitives with coalesced
 * text and exact source offsets — the layer where run fragmentation
 * (research §5c) is resolved so S03's citation regex can match across runs.
 *
 * OFFSET BACKBONE: paragraph boundaries (which `w:p` exists, its absolute XML
 * char span, its ordinal) come from the S01-T4 source-position scanner
 * (`scanWtOffsets`) — the tested offset backbone (approach A, research §5b).
 * Each paragraph region is then re-walked by this module to produce the
 * COALESCED TEXT + per-run {@link RunSpan}s, because the T4 scanner only sees
 * `<w:t>` and the block contract needs more:
 *
 *   - `w:br` / `w:cr`   -> a `\n` separator in `block.text`
 *   - `w:tab`           -> a `\t` separator
 *   - `w:instrText` / `w:fldChar` -> skipped (field codes are not visible
 *     text; the cached field RESULT lives in `w:t` and is kept)
 *   - `w:delText` (revision deletions) -> skipped (not part of final text)
 *   - `w:ins`/`w:del` wrappers are transparent: contained `w:t` is kept
 *
 * Separators are inserted AT the exact running offset, so the slice contract
 * holds for every run: `block.text.slice(startOffset, endOffset) === text`.
 * For a paragraph with no break/tab elements the output is byte-identical to
 * the T4 scanner's (asserted in tests) — `scanWtOffsets` is the authoritative
 * boundary source, this module the authoritative content source.
 *
 * Paragraph properties (`w:pPr`): `w:pStyle/@w:val` (styleId passthrough for
 * S02 heading detection), `w:numPr` presence (+ `w:numId`; `numId="0"`
 * explicitly cancels numbering), and `w:outlineLvl` (direct heading signal).
 *
 * FAILURE ISOLATION (§88): every function here is pure, deterministic (R008)
 * and never throws. Malformed markup is recorded via `ParsedParagraph.malformed`
 * / partial text — a broken paragraph never crashes document parsing.
 *
 * BLANK PARAGRAPHS: `paragraphToBlock` drops paragraphs whose text is blank
 * (research §5c) UNLESS they classify as headings (blank headings are kept so
 * heading structure survives).
 */

import type {
  DocumentBlock,
  DocumentBlockType,
  RunSpan,
  SourceLocation,
} from '@citesync/document-model';

import { decodeEntities } from '../xml/entities.js';
import { localName } from '../xml/ns.js';
import { scanWtOffsets } from '../xml/source-position.js';
import { attrVal, readOpenTag, scanTagEnd, tagName } from '../xml/tag-scan.js';
import type { StyleMap } from './style.js';

/** Paragraph-level properties extracted from `w:pPr` (deterministic). */
export interface ParagraphProps {
  /** `w:pStyle/@w:val` — style id passthrough for S02 heading detection. */
  styleId?: string;
  /** True when the paragraph is numbered/bulleted (`w:numPr`, `numId != "0"`). */
  isList: boolean;
  /** `w:numId/@w:val` when the paragraph carries numbering. */
  numberingId?: string;
  /** `w:outlineLvl/@w:val` from `w:pPr` (direct heading signal). */
  outlineLevel?: number;
}

/** A parsed paragraph: coalesced text, slice-exact runs, props, XML span. */
export interface ParsedParagraph {
  /**
   * 0-based ordinal of this `w:p` within the scanned input (includes
   * table-internal paragraphs, so it is the paragraph's true ordinal in the
   * source part — the build layer filters table regions, keeping ordinals).
   */
  paragraphIndex: number;
  /** Coalesced visible text (entity-decoded, `\n`/`\t` separators inserted). */
  text: string;
  /** Per-`w:t` runs with slice-exact offsets into `text`. */
  runs: RunSpan[];
  /** Paragraph properties from `w:pPr`. */
  props: ParagraphProps;
  /** Absolute char index of this paragraph's `<w:p` tag in the input. */
  xmlStartOffset: number;
  /** Absolute char index past `>` of `</w:p>`; `-1` when unterminated. */
  xmlEndOffset: number;
  /** True when malformed markup was encountered (isolated, never thrown). */
  malformed: boolean;
}

/**
 * Scan the input string for `w:p` paragraphs.
 *
 * Pure + deterministic. Paragraph boundaries come from the T4
 * `scanWtOffsets` scanner; content (coalesced text + runs + props) comes from
 * this module's region walker. Table-internal paragraphs are included so
 * ordinals stay true to the source part.
 */
export function scanParagraphs(xml: string): ParsedParagraph[] {
  const scanned = scanWtOffsets(xml);
  const out: ParsedParagraph[] = [];
  for (const p of scanned.paragraphs) {
    if (p.xmlStartOffset < 0) continue; // defensive: no usable region
    const end = p.xmlEndOffset === -1 ? xml.length : p.xmlEndOffset;
    const region = xml.slice(p.xmlStartOffset, end);
    const w = walkParagraphRegion(region);
    out.push({
      paragraphIndex: p.paragraphIndex,
      text: w.text,
      runs: w.runs,
      props: w.props,
      xmlStartOffset: p.xmlStartOffset,
      xmlEndOffset: p.xmlEndOffset,
      // Unterminated-at-EOF paragraphs are soft malformed: isolated, kept.
      malformed: w.malformed || p.xmlEndOffset === -1,
    });
  }
  return out;
}

/**
 * Classify a paragraph's block type from its props (heading signal from the
 * style map or a direct `w:outlineLvl`; list via `w:numPr`).
 *
 * Precedence (documented): heading > list > paragraph — a numbered heading
 * paragraph is still a heading.
 */
export function classifyParagraph(
  props: ParagraphProps,
  styles?: StyleMap,
): DocumentBlockType {
  const style = props.styleId === undefined ? undefined : styles?.get(props.styleId);
  if (style?.isHeading === true || props.outlineLevel !== undefined) return 'heading';
  if (props.isList) return 'list';
  return 'paragraph';
}

/**
 * Build the {@link DocumentBlock} for a parsed paragraph.
 *
 * Returns `null` for blank paragraphs (research §5c) unless they classify as
 * headings. The id is deterministic: `{part}-p{paragraphIndex}` (globally
 * unique across parts because of the part prefix). `block.style` carries the
 * style id passthrough; `block.source` carries the block-level min/max
 * paragraph-text offsets `[0, text.length)`.
 */
export function paragraphToBlock(
  p: ParsedParagraph,
  opts: { part: string; styles?: StyleMap },
): DocumentBlock | null {
  const type = classifyParagraph(p.props, opts.styles);
  const text = p.text;
  if (text.trim() === '' && type !== 'heading') return null; // blank drop

  const id = `${opts.part}-p${p.paragraphIndex}`;
  const source: SourceLocation = {
    blockId: id,
    paragraphIndex: p.paragraphIndex,
    startOffset: 0,
    endOffset: text.length,
  };
  const block: DocumentBlock = {
    id,
    type,
    text,
    source,
  };
  if (p.props.styleId !== undefined) block.style = p.props.styleId;
  return block;
}

// ---------------------------------------------------------------------------
// Region walker: one paragraph's raw XML -> text + runs + props
// ---------------------------------------------------------------------------

interface RegionWalk {
  text: string;
  runs: RunSpan[];
  props: ParagraphProps;
  malformed: boolean;
}

/**
 * Walk one paragraph's raw XML region (from `<w:p` through `</w:p>`),
 * producing the coalesced text, slice-exact runs and `w:pPr` props.
 *
 * Tag mechanics mirror the T4 scanner (quoted-aware, comments/PI/CDATA
 * skipped). Only `w:t`, `w:br`, `w:cr`, `w:tab` contribute to text; every
 * other element (including `w:instrText`, `w:delText`, `w:fldChar`, revision
 * wrappers) contributes nothing. Never throws.
 */
function walkParagraphRegion(region: string): RegionWalk {
  const props: ParagraphProps = { isList: false };
  const runs: RunSpan[] = [];
  let text = '';
  let runIndex = 0;
  let offset = 0; // running char offset into `text`
  let malformed = false;

  let inPPr = false;
  let pPrDepth = 0;
  let numPrSeen = false;
  let numIdVal: string | undefined;

  // Open `<w:t>` accumulation state.
  let openText = false;
  let textStart = -1; // char index just past '>' of the open w:t tag

  const emitRun = (raw: string): void => {
    const { decoded } = decodeEntities(raw);
    runs.push({
      runIndex,
      text: decoded,
      startOffset: offset,
      endOffset: offset + decoded.length,
    });
    text += decoded;
    offset += decoded.length;
    runIndex += 1;
    openText = false;
    textStart = -1;
  };

  const n = region.length;
  let i = 0;
  while (i < n) {
    const lt = region.indexOf('<', i);
    if (lt === -1) {
      // Trailing plain text: only legal inside an open `<w:t>`.
      if (openText && textStart >= 0) emitRun(region.slice(textStart));
      break;
    }
    const next = region[lt + 1];

    // Processing instruction / comment / CDATA / declaration: skip.
    if (next === '?') {
      const end = region.indexOf('?>', lt + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (next === '!' && region.startsWith('!--', lt + 1)) {
      const end = region.indexOf('-->', lt + 3);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (next === '!' && region.startsWith('![CDATA[', lt + 1)) {
      if (openText) emitRun(region.slice(textStart, lt));
      const end = region.indexOf(']]>', lt + 9);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (next === '!') {
      const end = scanTagEnd(region, lt);
      i = end === -1 ? n : end + 1;
      continue;
    }

    // Closing tag.
    if (next === '/') {
      if (openText) emitRun(region.slice(textStart, lt));
      const gt = region.indexOf('>', lt + 2);
      const closeInner = (gt === -1 ? region.slice(lt + 2) : region.slice(lt + 2, gt)).trim();
      const closeLocal = localName(closeInner);
      if (closeLocal === 'pPr') {
        if (pPrDepth > 0) pPrDepth -= 1;
        if (pPrDepth === 0) inPPr = false;
      } else if (closeLocal === 'p') {
        // Region end — stop walking (nothing after `</w:p>` matters).
        i = gt === -1 ? n : gt + 1;
        break;
      }
      i = gt === -1 ? n : gt + 1;
      continue;
    }

    // Opening tag.
    const tag = readOpenTag(region, lt);
    if (tag === null) {
      malformed = true;
      break; // unterminated tag — tail of a broken paragraph, isolated
    }

    // Defensive: a new element opening while `<w:t>` is open closes the run.
    if (openText && !isW(tagName(tag.inner), 't')) {
      emitRun(region.slice(textStart, lt));
    }

    const name = localName(tagName(tag.inner));

    if (isW(name, 'pPr') && !tag.selfClosing) {
      inPPr = true;
      pPrDepth = 1;
    } else if (inPPr && isW(name, 'pStyle')) {
      props.styleId = attrVal(tag.inner, 'w:val');
    } else if (inPPr && isW(name, 'numPr') && !tag.selfClosing) {
      numPrSeen = true;
    } else if (inPPr && isW(name, 'numId')) {
      numIdVal = attrVal(tag.inner, 'w:val');
    } else if (inPPr && isW(name, 'outlineLvl')) {
      const v = attrVal(tag.inner, 'w:val');
      if (v !== undefined) {
        const lvl = Number.parseInt(v, 10);
        if (Number.isFinite(lvl)) props.outlineLevel = lvl;
      }
    } else if (isW(name, 't') && !tag.selfClosing) {
      openText = true;
      textStart = lt + tag.inner.length + 2; // +1 '<' +1 '>'
    } else if (isW(name, 't') && tag.selfClosing) {
      emitRun(''); // empty `<w:t/>`: zero-length run keeps runIndex aligned
    } else if (!inPPr && (isW(name, 'br') || isW(name, 'cr'))) {
      // Line/paragraph break -> '\n' in block text (pPr-level `w:br
      // w:type="textWrapping"` is a wrap control, NOT visible text — skipped).
      text += '\n';
      offset += 1;
    } else if (!inPPr && isW(name, 'tab')) {
      text += '\t';
      offset += 1;
    }

    i = lt + tag.inner.length + 2;
  }

  // Unterminated trailing text inside an open `<w:t>`.
  if (openText && textStart >= 0) emitRun(region.slice(textStart));

  if (numPrSeen) {
    props.isList = numIdVal === undefined || numIdVal !== '0';
    props.numberingId = numIdVal;
  }

  return { text, runs, props, malformed };
}

/** Local-name equality (prefix-agnostic, e.g. "w:t" or "t" both match "t"). */
function isW(name: string, wanted: string): boolean {
  return name === wanted;
}
