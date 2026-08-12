/**
 * @citesync/docx — w:footnotes.xml / w:endnotes.xml note parsing (S01-T6).
 *
 * Turns each real footnote/endnote in the notes parts into a single
 * {@link DocumentBlock} of type "footnote" | "endnote" with the note's body
 * paragraphs flattened to text (same flattening rule as tables: cell/body
 * paragraph texts joined with `\n`) and a covering source span. Offsets are
 * preserved WITHIN the note's own part: each note block's text is
 * self-contained, so `block.text.slice(0, text.length)` selects the whole
 * note, and S03 can match citation text inside footnotes the same way it
 * matches body paragraphs (R009 evidence works for note blocks too).
 *
 * Special notes are skipped (never become blocks): Word emits separator /
 * continuationSeparator / continuationNotice notes (`w:type` attribute, or
 * the conventional `w:id="-1"` / `w:id="0"`) whose content is the "____"
 * separator line — not document content.
 *
 * Block ids are deterministic: `{part}-fn{ordinal}` where `part` is `fn`
 * (footnotes) or `en` (endnotes) and `ordinal` counts only the kept (real)
 * notes, 0-based, in document order.
 *
 * FAILURE ISOLATION (§88): pure + deterministic (R008), never throws.
 * Unterminated notes/tags are recorded via `ParsedNote.malformed` and the
 * partial region, not exceptions; blank notes are dropped like blank
 * paragraphs (research §5c).
 */

import type { DocumentBlock, RunSpan, SourceLocation } from '@citesync/document-model';

import { localName } from '../xml/ns.js';
import { attrVal, readOpenTag, scanTagEnd, tagName } from '../xml/tag-scan.js';
import { scanParagraphs } from './paragraph.js';

/** Block kinds produced from the two notes parts. */
export type NoteKind = 'footnote' | 'endnote';

/** `w:type` values marking a non-content note (separator lines etc.). */
const SPECIAL_NOTE_TYPES: ReadonlySet<string> = new Set([
  'separator',
  'continuationSeparator',
  'continuationNotice',
]);

/** Conventional `w:id` values Word uses for the separator/continuation notes. */
const SPECIAL_NOTE_IDS: ReadonlySet<string> = new Set(['-1', '0']);

/** A parsed note: flattened text, covering run, XML span. */
export interface ParsedNote {
  /** 0-based ordinal among the kept (real) notes in the part. */
  noteIndex: number;
  /** Flattened text: the note's body paragraph texts joined with `'\n'`. */
  text: string;
  /** Covering source span: one run covering `[0, text.length)`. */
  runs: RunSpan[];
  /** Absolute char index of this note's `<w:footnote ...>`/`<w:endnote ...>` tag. */
  xmlStartOffset: number;
  /** Absolute char index past `>` of the note's closing tag; `-1` when unterminated. */
  xmlEndOffset: number;
  /** The note's original `w:id` attribute when present (informational). */
  sourceId?: string;
  /** True when malformed markup was encountered (isolated, never thrown). */
  malformed: boolean;
}

/**
 * Scan a notes part for its real notes. Pure + deterministic; special notes
 * and blank notes are skipped. `elementLocal` selects the note element: the
 * footnotes part uses `w:footnote`, the endnotes part uses `w:endnote`.
 */
export function scanNotePart(xml: string, elementLocal: 'footnote' | 'endnote' = 'footnote'): ParsedNote[] {
  const out: ParsedNote[] = [];
  let noteIndex = 0;
  let depth = 0;
  let curStart = -1;
  let curId: string | undefined;
  let curType: string | undefined;
  let curSpecial = false;

  const n = xml.length;
  let i = 0;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) break; // trailing plain text — nothing structural left

    const next = xml[lt + 1];

    // Processing instruction / comment / CDATA / declaration: skip.
    if (next === '?') {
      const end = xml.indexOf('?>', lt + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (next === '!' && xml.startsWith('!--', lt + 1)) {
      const end = xml.indexOf('-->', lt + 3);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (next === '!' && xml.startsWith('![CDATA[', lt + 1)) {
      const end = xml.indexOf(']]>', lt + 9);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (next === '!') {
      const end = scanTagEnd(xml, lt);
      i = end === -1 ? n : end + 1;
      continue;
    }

    // Closing tag.
    if (next === '/') {
      const gt = xml.indexOf('>', lt + 2);
      const closeInner = (gt === -1 ? xml.slice(lt + 2) : xml.slice(lt + 2, gt)).trim();
      if (localName(closeInner) === elementLocal && depth > 0) {
        depth -= 1;
        if (depth === 0 && curStart >= 0) {
          if (!curSpecial) {
            const note = buildNote(xml, noteIndex, curStart, gt === -1 ? -1 : gt + 1, curId);
            if (note !== null) {
              out.push(note);
              noteIndex += 1;
            }
          }
          curStart = -1;
          curId = undefined;
          curType = undefined;
          curSpecial = false;
        }
      }
      i = gt === -1 ? n : gt + 1;
      continue;
    }

    // Opening tag.
    const tag = readOpenTag(xml, lt);
    if (tag === null) {
      // Unterminated tag: keep the open note (if any) as malformed and stop —
      // the tail of a broken part is not trustworthy; isolated, not thrown.
      if (curStart >= 0 && !curSpecial) {
        const note = buildNote(xml, noteIndex, curStart, -1, curId);
        if (note !== null) out.push(note);
      }
      break;
    }
    const name = localName(tagName(tag.inner));

    if (name === elementLocal && !tag.selfClosing) {
      if (depth === 0) {
        curStart = lt;
        curId = attrVal(tag.inner, 'w:id');
        curType = attrVal(tag.inner, 'w:type');
        curSpecial =
          (curType !== undefined && SPECIAL_NOTE_TYPES.has(curType)) ||
          (curId !== undefined && SPECIAL_NOTE_IDS.has(curId));
      }
      depth += 1;
    }

    i = lt + tag.inner.length + 2;
  }

  // Unterminated note at end of input: keep the partial region, mark malformed.
  if (depth > 0 && curStart >= 0 && !curSpecial) {
    const note = buildNote(xml, noteIndex, curStart, -1, curId);
    if (note !== null) out.push(note);
  }

  return out;
}

/**
 * Build the {@link DocumentBlock} for a parsed note. Id is deterministic:
 * `{part}-fn{noteIndex}` with `part` = `fn` | `en`. The source location
 * carries the covering span `[0, text.length)` with no paragraph index
 * (flattened multi-paragraph text, mirroring table blocks).
 */
export function noteToBlock(
  n: ParsedNote,
  opts: { part: 'fn' | 'en'; type: NoteKind },
): DocumentBlock {
  const id = `${opts.part}-fn${n.noteIndex}`;
  const source: SourceLocation = {
    blockId: id,
    startOffset: 0,
    endOffset: n.text.length,
  };
  return {
    id,
    type: opts.type,
    text: n.text,
    source,
  };
}

/**
 * Flatten a note region into text + covering run. Returns `null` for blank
 * notes (research §5c) so an empty note never becomes a block.
 */
function buildNote(
  xml: string,
  noteIndex: number,
  start: number,
  endOrMinusOne: number,
  sourceId: string | undefined,
): ParsedNote | null {
  const end = endOrMinusOne === -1 ? xml.length : endOrMinusOne;
  const region = xml.slice(start, end);
  // Reuse the paragraph scanner: a note body is ordinary `w:p`s (the note's
  // reference-mark paragraph included when the producer emits one).
  const paragraphs = scanParagraphs(region);
  const text = paragraphs.map((p) => p.text).join('\n');
  if (text.trim() === '') return null; // blank note drop
  const runs: RunSpan[] = [{ runIndex: 0, text, startOffset: 0, endOffset: text.length }];
  const note: ParsedNote = {
    noteIndex,
    text,
    runs,
    xmlStartOffset: start,
    xmlEndOffset: endOrMinusOne,
    malformed: endOrMinusOne === -1 || paragraphs.some((p) => p.malformed),
  };
  if (sourceId !== undefined) note.sourceId = sourceId;
  return note;
}
