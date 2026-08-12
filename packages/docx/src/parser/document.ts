/**
 * @citesync/docx — w:document body parsing: ordered blocks + source map (S01-T6).
 *
 * Parses `word/document.xml` `w:body` content into the ordered block list
 * (paragraphs and tables in document order; `w:sectPr` and any other body
 * element is ignored) and builds the per-block {@link BlockSourceMap} entries
 * that feed `AcademicDocument.sourceMap`.
 *
 * ORDERING: block order is source order. Top-level paragraphs and tables are
 * merged by their absolute XML char offset, so a paragraph after a table
 * follows the table block regardless of which scanner reported it first.
 * Paragraphs INSIDE a table region belong to the table block (its flattened
 * cell text) and are excluded from the body list — but their `paragraphIndex`
 * remains their true ordinal in the part (research: table-internal paragraphs
 * keep part-true ordinals; see MEM019).
 *
 * SOURCE MAP: for paragraph blocks the entry carries `paragraphIndex` (true
 * part ordinal) + the paragraph's coalesced runs with slice-exact offsets
 * (`block.text.slice(startOffset, endOffset) === run.text`); for table blocks
 * a single covering run and no paragraph index (flattened multi-paragraph
 * text). S03 translates a citation match at character offsets in `block.text`
 * into run-level evidence via this map (R009).
 *
 * SECURITY: nothing here executes or decodes content — only tag scanning.
 * Macro parts and remote relationship targets are handled (note-and-skip) by
 * the build-model layer, never here.
 *
 * FAILURE ISOLATION (§88): pure + deterministic (R008), never throws.
 * Malformed top-level paragraphs / tables are counted (and still yield their
 * partial blocks); the build layer records the counts as {@link ParseIssue}s.
 */

import type {
  BlockSourceMap,
  DocumentBlock,
} from '@citesync/document-model';

import { paragraphToBlock, scanParagraphs } from './paragraph.js';
import { scanTables, tableToBlock } from './table.js';
import type { StyleMap } from './style.js';

/** A `DocumentBlock` plus the source-map entry that describes it. */
export interface BlockWithSourceMap {
  block: DocumentBlock;
  sourceMapEntry: BlockSourceMap;
}

/** Result of parsing a document.xml body. */
export interface BodyParseResult {
  /** Body blocks (paragraphs + tables) in document order, with entries. */
  entries: BlockWithSourceMap[];
  /** Count of top-level (non-table-internal) paragraphs flagged malformed. */
  malformedParagraphs: number;
  /**
   * Count of tables flagged malformed (unterminated table region, or at least
   * one malformed cell paragraph inside it).
   */
  malformedTables: number;
}

/**
 * Parse a document.xml body string into ordered blocks + source-map entries.
 *
 * @param xml - the raw word/document.xml string.
 * @param opts - `part` block-id prefix (e.g. "doc") and optional style map
 *   for heading classification.
 */
export function parseBody(
  xml: string,
  opts: { part: string; styles?: StyleMap },
): BodyParseResult {
  const paragraphs = scanParagraphs(xml);
  const tables = scanTables(xml);

  // Table regions: a paragraph whose start falls inside one belongs to the
  // table's flattened text, not the body list. Unterminated tables extend to
  // end of input.
  const tableRegions = tables.map((t) => ({
    start: t.xmlStartOffset,
    end: t.xmlEndOffset === -1 ? xml.length : t.xmlEndOffset,
  }));
  const inTable = (xmlOffset: number): boolean =>
    tableRegions.some((r) => xmlOffset >= r.start && xmlOffset < r.end);

  // Merge paragraphs (outside tables) and tables by absolute source offset.
  type Item =
    | { kind: 'p'; offset: number; p: (typeof paragraphs)[number] }
    | { kind: 't'; offset: number; t: (typeof tables)[number] };
  const items: Item[] = [];
  for (const p of paragraphs) {
    if (inTable(p.xmlStartOffset)) continue; // belongs to the table block
    items.push({ kind: 'p', offset: p.xmlStartOffset, p });
  }
  for (const t of tables) {
    items.push({ kind: 't', offset: t.xmlStartOffset, t });
  }
  items.sort((a, b) => a.offset - b.offset); // stable: source order

  const entries: BlockWithSourceMap[] = [];
  for (const item of items) {
    if (item.kind === 'p') {
      const block = paragraphToBlock(item.p, { part: opts.part, styles: opts.styles });
      if (block === null) continue; // blank paragraph dropped
      entries.push({
        block,
        sourceMapEntry: {
          blockId: block.id,
          paragraphIndex: item.p.paragraphIndex,
          runs: item.p.runs,
        },
      });
    } else {
      const block = tableToBlock(item.t, { part: opts.part });
      entries.push({
        block,
        sourceMapEntry: { blockId: block.id, runs: item.t.runs },
      });
    }
  }

  return {
    entries,
    malformedParagraphs: paragraphs.filter((p) => p.malformed && !inTable(p.xmlStartOffset))
      .length,
    malformedTables: tables.filter(
      (t) => t.malformed || t.malformedParagraphCount > 0,
    ).length,
  };
}
