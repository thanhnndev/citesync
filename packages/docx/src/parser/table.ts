/**
 * @citesync/docx — w:tbl table parsing (S01-T5).
 *
 * Turns raw `w:tbl` XML into a single {@link DocumentBlock} of type "table"
 * with minimal cell-text flattening and a covering source span. Per the S01
 * plan, deep table structure (rows/cells/grid spans/merges) is OUT OF SCOPE:
 * the block is a faithful, representable table primitive that S03 can search
 * (citations in table cells are common in results tables) without S01
 * modelling the grid.
 *
 * Flattening rule (documented, deterministic): every `w:p` inside the table
 * contributes its coalesced paragraph text (same walker as paragraph.ts,
 * including `\n`/`\t` separators for `w:br`/`w:tab`); paragraph texts are
 * joined with `'\n'`. Cells are not tracked separately — "join cell
 * paragraphs" per the plan. Nested tables are absorbed into the outer table's
 * region (one block per TOP-LEVEL table); `mc:AlternateContent` duplication
 * is not deduplicated in S01 (rare for tables — noted as a known limitation).
 *
 * Covering source span: `runs` holds a single {@link RunSpan} covering
 * `[0, text.length)` and `block.source` mirrors it (no `paragraphIndex` —
 * per the model, table text is flattened from multiple paragraphs).
 *
 * FAILURE ISOLATION (§88): pure + deterministic (R008), never throws.
 * Unterminated tables / tags are recorded via `ParsedTable.malformed` and the
 * partial region, not exceptions.
 */

import type { DocumentBlock, RunSpan, SourceLocation } from '@citesync/document-model';

import { localName } from '../xml/ns.js';
import { readOpenTag, scanTagEnd, tagName } from '../xml/tag-scan.js';
import { scanParagraphs } from './paragraph.js';

/** A parsed table: flattened text, covering run, XML span. */
export interface ParsedTable {
  /** 0-based ordinal of this top-level `w:tbl` in the scanned input. */
  tableIndex: number;
  /** Flattened text: cell paragraph texts joined with `'\n'`. */
  text: string;
  /** Covering source span: one run covering `[0, text.length)`. */
  runs: RunSpan[];
  /** Absolute char index of this table's `<w:tbl` tag in the input. */
  xmlStartOffset: number;
  /** Absolute char index past `>` of `</w:tbl>`; `-1` when unterminated. */
  xmlEndOffset: number;
  /** True when malformed markup was encountered (isolated, never thrown). */
  malformed: boolean;
  /**
   * Count of cell paragraphs inside this table flagged malformed (unterminated
   * tags etc.), surfaced for §88 failure isolation in the build layer.
   */
  malformedParagraphCount: number;
}

/**
 * Scan the input string for top-level `w:tbl` tables.
 *
 * Tracks `w:tbl` nesting so an inner table (a table inside a cell) is absorbed
 * into its outer table's region rather than mis-terminated at the first
 * `</w:tbl>`. Pure + deterministic; never throws.
 */
export function scanTables(xml: string): ParsedTable[] {
  const out: ParsedTable[] = [];
  let tableIndex = 0;
  let depth = 0;
  let curStart = -1;

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
      if (localName(closeInner) === 'tbl' && depth > 0) {
        depth -= 1;
        if (depth === 0) {
          out.push(buildTable(xml, tableIndex, curStart, gt === -1 ? -1 : gt + 1));
          tableIndex += 1;
          curStart = -1;
        }
      }
      i = gt === -1 ? n : gt + 1;
      continue;
    }

    // Opening tag.
    const tag = readOpenTag(xml, lt);
    if (tag === null) {
      // Unterminated tag: mark the open table (if any) malformed and stop —
      // the tail of a broken part is not trustworthy; isolated, not thrown.
      if (curStart >= 0) {
        out.push(buildTable(xml, tableIndex, curStart, -1, true));
        tableIndex += 1;
      }
      break;
    }
    const name = localName(tagName(tag.inner));

    if (name === 'tbl' && !tag.selfClosing) {
      if (depth === 0) curStart = lt;
      depth += 1;
    }

    i = lt + tag.inner.length + 2;
  }

  // Unterminated table at end of input: keep the partial region, mark malformed.
  if (depth > 0 && curStart >= 0) {
    out.push(buildTable(xml, tableIndex, curStart, -1, true));
  }

  return out;
}

/**
 * Build the {@link DocumentBlock} for a parsed table. Id is deterministic:
 * `{part}-t{tableIndex}`. The source location carries the covering span
 * `[0, text.length)` with no paragraph index (flattened text).
 */
export function tableToBlock(t: ParsedTable, opts: { part: string }): DocumentBlock {
  const id = `${opts.part}-t${t.tableIndex}`;
  const source: SourceLocation = {
    blockId: id,
    startOffset: 0,
    endOffset: t.text.length,
  };
  return {
    id,
    type: 'table',
    text: t.text,
    source,
  };
}

/** Flatten a table region into text + covering run (see module docs). */
function buildTable(
  xml: string,
  tableIndex: number,
  start: number,
  endOrMinusOne: number,
  malformed = false,
): ParsedTable {
  const end = endOrMinusOne === -1 ? xml.length : endOrMinusOne;
  const region = xml.slice(start, end);
  // Reuse the paragraph scanner: cell paragraphs are ordinary `w:p`s inside
  // the table region (nested tables included).
  const paragraphs = scanParagraphs(region);
  const text = paragraphs.map((p) => p.text).join('\n');
  const runs: RunSpan[] = [{ runIndex: 0, text, startOffset: 0, endOffset: text.length }];
  return {
    tableIndex,
    text,
    runs,
    xmlStartOffset: start,
    xmlEndOffset: endOrMinusOne,
    malformed,
    malformedParagraphCount: paragraphs.filter((p) => p.malformed).length,
  };
}
