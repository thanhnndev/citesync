/**
 * S01-T5 — paragraph/table/style parser tests.
 *
 * Covers the S01-T5 contract:
 *  - run coalescing: a visible phrase fragmented across several `<w:r>/<w:t>`
 *    with revision markers (`w:ins`/`w:del`) yields `block.text` as the
 *    correctly coalesced phrase, with slice-exact run offsets (R009 evidence:
 *    `block.text.slice(startOffset, endOffset) === run.text`);
 *  - `w:delText` (revision deletions) and field codes (`w:instrText`/
 *    `w:fldChar`) are excluded — the cached field RESULT in `w:t` stays;
 *  - `w:br`/`w:cr`/`w:tab` insert `\n`/`\t` separators at exact offsets;
 *  - blank paragraphs dropped unless headings; style id passthrough;
 *  - `w:tbl` -> single table block with flattened cell text + covering span
 *    (nested tables absorbed);
 *  - styles.xml -> style map with heading detection (outlineLvl / name /
 *    styleId heuristics; character styles excluded; latent styles ignored);
 *  - consistency with the S01-T4 scanner for break/tab-free paragraphs;
 *  - failure isolation (§88): malformed markup is recorded, never thrown;
 *  - determinism (R008).
 */

import { describe, expect, it } from 'vitest';

import type { DocumentBlock, RunSpan } from '@citesync/document-model';

import { classifyParagraph, paragraphToBlock, scanParagraphs } from '../src/parser/paragraph.js';
import { scanTables, tableToBlock } from '../src/parser/table.js';
import { headingAnalysis, loadStyleMap } from '../src/parser/style.js';
import { scanWtOffsets } from '../src/xml/source-position.js';

/** Assert every run slices back to its exact text within `paraText`. */
function expectSliceExact(paraText: string, runs: RunSpan[]): void {
  for (const r of runs) {
    expect(paraText.slice(r.startOffset, r.endOffset), `run ${r.runIndex} slices back`).toBe(
      r.text,
    );
  }
}

/** Coalesced text + runs for the FIRST paragraph of `xml`. */
function firstParagraph(xml: string) {
  const paras = scanParagraphs(xml);
  expect(paras.length).toBeGreaterThan(0);
  return paras[0]!;
}

const HEADING_STYLES = loadStyleMap(
  '<w:styles>' +
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>' +
    '<w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>' +
    '</w:styles>',
);

describe('parser/paragraph.ts — run coalescing + offsets', () => {
  it('coalesces a phrase fragmented across runs with revision markers', () => {
    const xml =
      '<w:document><w:body>' +
      '<w:p>' +
      '<w:del w:id="1"><w:r><w:delText>obsolete</w:delText></w:r></w:del>' +
      '<w:ins w:id="2"><w:r><w:t>Smith</w:t></w:r></w:ins>' +
      '<w:r><w:t> (</w:t></w:r>' +
      '<w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t>2024</w:t></w:r>' +
      '<w:r><w:t>) proposed a theory</w:t></w:r>' +
      '</w:p>' +
      '</w:body></w:document>';

    const p = firstParagraph(xml);
    // Deleted text (w:delText) is excluded; every w:t survives its wrapper.
    expect(p.text).toBe('Smith (2024) proposed a theory');
    expect(p.runs.map((r) => r.text)).toEqual(['Smith', ' (', '2024', ') proposed a theory']);
    expect(p.runs.map((r) => [r.startOffset, r.endOffset])).toEqual([
      [0, 5],
      [5, 7],
      [7, 11],
      [11, 30],
    ]);
    expectSliceExact(p.text, p.runs);

    // Done-when: block.text is the phrase; block offsets slice back to it.
    const block = paragraphToBlock(p, { part: 'doc' })!;
    expect(block.text).toBe('Smith (2024) proposed a theory');
    expect(block.text.slice(block.source.startOffset!, block.source.endOffset!)).toBe(block.text);
  });

  it('excludes field codes (w:instrText/w:fldChar) but keeps the cached result', () => {
    const xml =
      '<w:p>' +
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText xml:space="preserve"> ADDIN ZOTERO_ITEM CSL_CITATION {"citationID":"x"} </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      '<w:r><w:t>(Smith, 2024)</w:t></w:r>' +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
      '</w:p>';

    const p = firstParagraph(xml);
    expect(p.text).toBe('(Smith, 2024)');
    expect(p.runs).toHaveLength(1);
    expectSliceExact(p.text, p.runs);
  });

  it('inserts w:br/w:cr -> "\\n" and w:tab -> "\\t" separators at exact offsets', () => {
    const xml =
      '<w:p><w:r><w:t>A</w:t><w:tab/><w:t>B</w:t></w:r>' +
      '<w:r><w:br/><w:t>C</w:t></w:r></w:p>';

    const p = firstParagraph(xml);
    expect(p.text).toBe('A\tB\nC');
    expect(p.runs.map((r) => [r.text, r.startOffset, r.endOffset])).toEqual([
      ['A', 0, 1],
      ['B', 2, 3],
      ['C', 4, 5],
    ]);
    expect(p.text.slice(1, 2)).toBe('\t');
    expect(p.text.slice(3, 4)).toBe('\n');
    expectSliceExact(p.text, p.runs);
  });

  it('does not treat pPr-level w:br (textWrapping control) as visible text', () => {
    const xml =
      '<w:p><w:pPr><w:br w:type="textWrapping"/></w:pPr>' +
      '<w:r><w:t>Clean</w:t></w:r></w:p>';
    const p = firstParagraph(xml);
    expect(p.text).toBe('Clean');
  });

  it('keeps xml:space="preserve" leading/trailing spaces verbatim', () => {
    const xml = '<w:p><w:r><w:t xml:space="preserve">  padded  </w:t></w:r></w:p>';
    const p = firstParagraph(xml);
    expect(p.text).toBe('  padded  ');
    expectSliceExact(p.text, p.runs);
  });

  it('advances offsets by entity-decoded length (nbsp/amp/numeric)', () => {
    const xml = '<w:p><w:r><w:t>A&amp;B</w:t></w:r><w:r><w:t>&nbsp;C</w:t></w:r></w:p>';
    const p = firstParagraph(xml);
    expect(p.text).toBe('A&B\u00A0C');
    expect(p.runs.map((r) => [r.startOffset, r.endOffset])).toEqual([
      [0, 3],
      [3, 5],
    ]);
    expectSliceExact(p.text, p.runs);
  });

  it('is consistent with the S01-T4 scanner for break/tab-free paragraphs', () => {
    const xml =
      '<w:document><w:body>' +
      '<w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t xml:space="preserve"> world</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Nguy&#7877;n &amp; Ho</w:t></w:r></w:p>' +
      '</w:body></w:document>';

    const paras = scanParagraphs(xml);
    const scanned = scanWtOffsets(xml);
    expect(paras).toHaveLength(scanned.paragraphs.length);
    scanned.paragraphs.forEach((sp, idx) => {
      const pp = paras[idx]!;
      expect(pp.text).toBe(sp.text);
      expect(pp.runs).toHaveLength(sp.runs.length);
      sp.runs.forEach((sr, ri) => {
        expect(pp.runs[ri]!.text).toBe(sr.text);
        expect(pp.runs[ri]!.startOffset).toBe(sr.startOffset);
        expect(pp.runs[ri]!.endOffset).toBe(sr.endOffset);
      });
    });
  });
});

describe('parser/paragraph.ts — props, classification, blank drop, ids', () => {
  it('extracts pStyle / numPr / numId / outlineLvl from w:pPr', () => {
    const xml =
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/>' +
      '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr>' +
      '<w:outlineLvl w:val="1"/></w:pPr><w:r><w:t>X</w:t></w:r></w:p>';
    const p = firstParagraph(xml);
    expect(p.props).toMatchObject({
      styleId: 'Heading1',
      isList: true,
      numberingId: '7',
      outlineLevel: 1,
    });
  });

  it('numId="0" cancels numbering (not a list)', () => {
    const xml =
      '<w:p><w:pPr><w:numPr><w:numId w:val="0"/></w:numPr></w:pPr>' +
      '<w:r><w:t>Plain</w:t></w:r></w:p>';
    const p = firstParagraph(xml);
    expect(p.props.isList).toBe(false);
    expect(classifyParagraph(p.props)).toBe('paragraph');
  });

  it('classifies heading via style map, direct outlineLvl, and list via numPr', () => {
    expect(classifyParagraph({ isList: true, numberingId: '1' })).toBe('list');
    expect(classifyParagraph({ isList: false })).toBe('paragraph');
    expect(classifyParagraph({ isList: false, styleId: 'Heading1' }, HEADING_STYLES)).toBe(
      'heading',
    );
    // Unknown style id -> no heading signal.
    expect(classifyParagraph({ isList: false, styleId: 'Nope' }, HEADING_STYLES)).toBe(
      'paragraph',
    );
    // Direct pPr outlineLvl -> heading without any style map.
    expect(classifyParagraph({ isList: false, outlineLevel: 0 })).toBe('heading');
    // Precedence: a numbered heading paragraph is still a heading.
    expect(classifyParagraph({ isList: true, styleId: 'Heading1' }, HEADING_STYLES)).toBe(
      'heading',
    );
  });

  it('drops blank paragraphs but keeps blank headings', () => {
    const paras = scanParagraphs(
      '<w:document><w:body>' +
        '<w:p/>' +
        '<w:p><w:r><w:t>  </w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Real text</w:t></w:r></w:p>' +
        '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve"> </w:t></w:r></w:p>' +
        '</w:body></w:document>',
    );

    expect(paragraphToBlock(paras[0]!, { part: 'doc' })).toBeNull();
    expect(paragraphToBlock(paras[1]!, { part: 'doc' })).toBeNull();
    const body = paragraphToBlock(paras[2]!, { part: 'doc' })!;
    expect(body.text).toBe('Real text');
    expect(body.type).toBe('paragraph');
    // Blank HEADING is kept (heading structure survives).
    const heading = paragraphToBlock(paras[3]!, { part: 'doc', styles: HEADING_STYLES })!;
    expect(heading.type).toBe('heading');
    expect(heading.text.trim()).toBe('');
  });

  it('builds deterministic ids, style passthrough and source locations', () => {
    const paras = scanParagraphs(
      '<w:document><w:body>' +
        '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Intro</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Body</w:t></w:r></w:p>' +
        '</w:body></w:document>',
    );
    const blocks: DocumentBlock[] = paras
      .map((p) => paragraphToBlock(p, { part: 'doc', styles: HEADING_STYLES }))
      .filter((b): b is DocumentBlock => b !== null);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.id).toBe('doc-p0');
    expect(blocks[0]!.type).toBe('heading');
    expect(blocks[0]!.style).toBe('Heading1'); // style id passthrough for S02
    expect(blocks[0]!.source).toEqual({
      blockId: 'doc-p0',
      paragraphIndex: 0,
      startOffset: 0,
      endOffset: 5,
    });
    expect(blocks[1]!.id).toBe('doc-p1');
    expect(blocks[1]!.style).toBeUndefined();
    expect(blocks[1]!.source.paragraphIndex).toBe(1);
  });
});

describe('parser/table.ts — table blocks with covering source span', () => {
  it('flattens cell paragraphs into one table block', () => {
    const xml =
      '<w:tbl>' +
      '<w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr>' +
      '<w:tr><w:tc><w:p><w:r><w:t>Cell1</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:p><w:r><w:t>Cell2</w:t></w:r></w:p></w:tc></w:tr>' +
      '<w:tr><w:tc><w:p><w:r><w:t>Cell3</w:t></w:r></w:p></w:tc></w:tr>' +
      '</w:tbl>';

    const tables = scanTables(xml);
    expect(tables).toHaveLength(1);
    const t = tables[0]!;
    expect(t.text).toBe('Cell1\nCell2\nCell3');
    // Covering source span: one run over [0, text.length).
    expect(t.runs).toEqual([
      { runIndex: 0, text: 'Cell1\nCell2\nCell3', startOffset: 0, endOffset: 17 },
    ]);

    const block = tableToBlock(t, { part: 'doc' });
    expect(block.id).toBe('doc-t0');
    expect(block.type).toBe('table');
    expect(block.text).toBe('Cell1\nCell2\nCell3');
    expect(block.source).toEqual({ blockId: 'doc-t0', startOffset: 0, endOffset: 17 });
    expect(block.source.paragraphIndex).toBeUndefined();
  });

  it('absorbs nested tables into the outer table region (one block)', () => {
    const xml =
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Outer</w:t></w:r></w:p>' +
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Inner</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
      '</w:tc></w:tr></w:tbl>';

    const tables = scanTables(xml);
    expect(tables).toHaveLength(1);
    expect(tables[0]!.text).toBe('Outer\nInner');
  });

  it('keeps table-internal paragraphs in the part ordinal sequence (build layer filters)', () => {
    const xml =
      '<w:document><w:body>' +
      '<w:p><w:r><w:t>Before</w:t></w:r></w:p>' +
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>CellA</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
      '<w:p><w:r><w:t>After</w:t></w:r></w:p>' +
      '</w:body></w:document>';

    const paras = scanParagraphs(xml);
    expect(paras.map((p) => p.text)).toEqual(['Before', 'CellA', 'After']);
    expect(paras.map((p) => p.paragraphIndex)).toEqual([0, 1, 2]);
    expect(scanTables(xml)).toHaveLength(1);
  });
});

describe('parser/style.ts — styles.xml style map', () => {
  const stylesXml =
    '<w:styles>' +
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>' +
    '<w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>' +
    '<w:style w:type="character" w:styleId="Heading1Char"><w:name w:val="Heading 1 Char"/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Outline3"><w:name w:val="Outline 3"/></w:style>' +
    '<w:style w:type="paragraph"><w:name w:val="NoId"/></w:style>' +
    '<w:latentStyles><w:lsdException w:name="Heading 9"/></w:latentStyles>' +
    '</w:styles>';

  it('loads the style map: heading via outlineLvl, name and styleId heuristics', () => {
    const map = loadStyleMap(stylesXml);
    expect(map.size).toBe(5); // NoId (no w:styleId) and latentStyles are skipped

    expect(map.get('Heading1')).toMatchObject({ isHeading: true, outlineLevel: 0 });
    expect(map.get('Heading2')).toMatchObject({ isHeading: true, outlineLevel: 1 });
    // Character style is never a block heading.
    expect(map.get('Heading1Char')).toMatchObject({ isHeading: false, outlineLevel: undefined });
    expect(map.get('Normal')).toMatchObject({ isHeading: false });
    expect(map.get('Outline3')).toMatchObject({ isHeading: true, outlineLevel: 2 });
  });

  it('headingAnalysis implements the documented heuristic', () => {
    expect(headingAnalysis('Title', 'paragraph', 'Title', undefined)).toEqual({
      isHeading: false,
    });
    expect(headingAnalysis('Heading9', 'paragraph', 'Heading 9', undefined)).toEqual({
      isHeading: true,
      outlineLevel: 8,
    });
    expect(headingAnalysis('Heading1Char', 'character', 'Heading 1 Char', undefined)).toEqual({
      isHeading: false,
    });
    // outlineLvl wins over everything else.
    expect(headingAnalysis('Whatever', 'paragraph', 'whatever', 3)).toEqual({
      isHeading: true,
      outlineLevel: 3,
    });
    // Name-based, no level derivable.
    expect(headingAnalysis('Custom', 'paragraph', 'Heading Quote', undefined)).toEqual({
      isHeading: true,
      outlineLevel: undefined,
    });
  });

  it('a heading style from the map drives paragraph classification', () => {
    const paras = scanParagraphs(
      '<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Sec</w:t></w:r></w:p>',
    );
    const block = paragraphToBlock(paras[0]!, { part: 'doc', styles: loadStyleMap(stylesXml) })!;
    expect(block.type).toBe('heading');
    expect(block.style).toBe('Heading2');
  });
});

describe('parser — failure isolation and determinism', () => {
  it('isolates unterminated paragraphs instead of throwing', () => {
    const paras = scanParagraphs('<w:p><w:r><w:t>abc');
    expect(paras).toHaveLength(1);
    expect(paras[0]!.text).toBe('abc');
    expect(paras[0]!.malformed).toBe(true);
    expect(paras[0]!.runs[0]!.text).toBe('abc');
  });

  it('isolates unterminated tags inside a paragraph instead of throwing', () => {
    const paras = scanParagraphs('<w:p><w:r w:att="unterminated>');
    expect(paras).toHaveLength(1);
    expect(paras[0]!.malformed).toBe(true);
  });

  it('isolates an unterminated table (partial region kept, marked malformed)', () => {
    const tables = scanTables('<w:tbl><w:tr><w:tc><w:p><w:r><w:t>x</w:t></w:r></w:p>');
    expect(tables).toHaveLength(1);
    expect(tables[0]!.text).toBe('x');
    expect(tables[0]!.malformed).toBe(true);
  });

  it('isolates a broken styles part (no throw, sane styles still load)', () => {
    const map = loadStyleMap(
      '<w:styles><w:style w:styleId="Broken"><w:name w:val="x">' +
        '<w:style w:type="paragraph" w:styleId="Good"><w:name w:val="Normal"/></w:style></w:styles>',
    );
    // "Broken" was unterminated; "Good" still parses.
    expect(map.get('Good')?.isHeading).toBe(false);
  });

  it('is deterministic (R008): identical output for identical input', () => {
    const xml =
      '<w:document><w:body>' +
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' +
      '<w:r><w:t>Nguy&#7877;n &amp; Ho</w:t></w:r><w:r><w:tab/><w:t>B</w:t></w:r></w:p>' +
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>C</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
      '</w:body></w:document>';
    expect(scanParagraphs(xml)).toEqual(scanParagraphs(xml));
    expect(scanTables(xml)).toEqual(scanTables(xml));
    expect(loadStyleMap(stylesXmlFixture())).toEqual(loadStyleMap(stylesXmlFixture()));
  });

  function stylesXmlFixture(): string {
    return (
      '<w:styles>' +
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>' +
      '<w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>' +
      '</w:styles>'
    );
  }
});
