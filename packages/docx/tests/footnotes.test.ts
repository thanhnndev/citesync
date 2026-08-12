/**
 * S01-T8 — footnotes/endnotes note-parser tests (S01-T6 module).
 *
 * `scanNotePart` + `noteToBlock` turn each REAL footnote/endnote into a
 * `DocumentBlock` ("footnote" | "endnote") with the note body flattened to
 * text and a covering source span `[0, text.length)` — so R009 evidence
 * (slice back to exact text) works for note blocks too.
 *
 * Covers the T8 contract for this module:
 *  - real notes become blocks with deterministic ids (fn-fn0, en-fn0, ...)
 *    and covering spans;
 *  - special notes are skipped: `w:type` separator/continuationSeparator/
 *    continuationNotice, and the conventional `w:id="-1"` / `w:id="0"`;
 *  - blank notes are dropped; multi-paragraph notes flatten with '\n';
 *  - sourceId passthrough; malformed (unterminated) notes are isolated and
 *    recorded, never thrown;
 *  - determinism (R008).
 */

import { describe, expect, it } from 'vitest';

import { scanNotePart, noteToBlock } from '../src/parser/footnotes.js';

const NS_W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function footnotesPart(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes ${NS_W}>${inner}</w:footnotes>`;
}

describe('parser/footnotes.ts — real notes become blocks', () => {
  it('skips special notes and returns only real notes, in order', () => {
    const xml = footnotesPart(
      '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
        '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
        '<w:footnote w:id="1"><w:p><w:r><w:t>First note</w:t></w:r></w:p></w:footnote>' +
        '<w:footnote w:id="2"><w:p><w:r><w:t>Multi</w:t></w:r></w:p><w:p><w:r><w:t>paragraph note</w:t></w:r></w:p></w:footnote>' +
        '<w:footnote w:type="continuationNotice" w:id="3"><w:p><w:r><w:t>notice</w:t></w:r></w:p></w:footnote>',
    );
    const notes = scanNotePart(xml, 'footnote');

    expect(notes).toHaveLength(2);
    expect(notes[0]!.noteIndex).toBe(0);
    expect(notes[0]!.text).toBe('First note');
    expect(notes[0]!.sourceId).toBe('1');
    expect(notes[1]!.noteIndex).toBe(1);
    expect(notes[1]!.text).toBe('Multi\nparagraph note'); // flattened with '\n'
    expect(notes[1]!.sourceId).toBe('2');
  });

  it('builds blocks with deterministic ids and covering spans (R009)', () => {
    const xml = footnotesPart(
      '<w:footnote w:id="1"><w:p><w:r><w:t>First note</w:t></w:r></w:p></w:footnote>' +
        '<w:footnote w:id="2"><w:p><w:r><w:t>Second note</w:t></w:r></w:p></w:footnote>',
    );
    const notes = scanNotePart(xml, 'footnote');
    const blocks = notes.map((n) => noteToBlock(n, { part: 'fn', type: 'footnote' }));

    expect(blocks.map((b) => b.id)).toEqual(['fn-fn0', 'fn-fn1']);
    expect(blocks.map((b) => b.type)).toEqual(['footnote', 'footnote']);
    for (const [i, b] of blocks.entries()) {
      // Covering span selects the WHOLE note text.
      expect(b.source.blockId).toBe(b.id);
      expect(b.source.startOffset).toBe(0);
      expect(b.source.endOffset).toBe(b.text.length);
      expect(b.text.slice(b.source.startOffset!, b.source.endOffset!)).toBe(b.text);
      expect(b.text).toBe(notes[i]!.text);
    }
  });

  it('handles the endnotes part (w:endnote elements, en- ids)', () => {
    const xml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<w:endnotes ${NS_W}>` +
      '<w:endnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:endnote>' +
      '<w:endnote w:id="7"><w:p><w:r><w:t>An endnote body</w:t></w:r></w:p></w:endnote>' +
      '</w:endnotes>';
    const notes = scanNotePart(xml, 'endnote');
    const blocks = notes.map((n) => noteToBlock(n, { part: 'en', type: 'endnote' }));

    expect(notes).toHaveLength(1);
    expect(notes[0]!.sourceId).toBe('7');
    expect(blocks[0]!.id).toBe('en-fn0');
    expect(blocks[0]!.type).toBe('endnote');
    expect(blocks[0]!.text).toBe('An endnote body');
  });
});

describe('parser/footnotes.ts — note hygiene', () => {
  it('drops blank notes (whitespace-only bodies)', () => {
    const xml = footnotesPart(
      '<w:footnote w:id="1"><w:p><w:r><w:t xml:space="preserve"> </w:t></w:r></w:p></w:footnote>' +
        '<w:footnote w:id="2"><w:p><w:r><w:t>Real text</w:t></w:r></w:p></w:footnote>',
    );
    const notes = scanNotePart(xml, 'footnote');
    expect(notes).toHaveLength(1);
    expect(notes[0]!.text).toBe('Real text');
    expect(notes[0]!.noteIndex).toBe(0); // index counts KEPT notes only
  });

  it('treats the conventional separator ids (-1, 0) as special even without w:type', () => {
    const xml = footnotesPart(
      '<w:footnote w:id="-1"><w:p><w:r><w:t>separator line</w:t></w:r></w:p></w:footnote>' +
        '<w:footnote w:id="0"><w:p><w:r><w:t>continuation line</w:t></w:r></w:p></w:footnote>' +
        '<w:footnote w:id="1"><w:p><w:r><w:t>Real note</w:t></w:r></w:p></w:footnote>',
    );
    const notes = scanNotePart(xml, 'footnote');
    expect(notes).toHaveLength(1);
    expect(notes[0]!.text).toBe('Real note');
  });

  it('isolates an unterminated note: partial text kept, marked malformed', () => {
    // The last note never closes — the parser records the partial region as
    // malformed instead of throwing (§88 failure isolation).
    const xml = footnotesPart(
      '<w:footnote w:id="1"><w:p><w:r><w:t>Good note</w:t></w:r></w:p></w:footnote>' +
        '<w:footnote w:id="2"><w:p><w:r><w:t>Never closed',
    );
    let notes: ReturnType<typeof scanNotePart>;
    expect(() => {
      notes = scanNotePart(xml, 'footnote');
    }).not.toThrow();
    const list = notes!;

    expect(list).toHaveLength(2);
    expect(list[0]!.malformed).toBe(false);
    expect(list[1]!.malformed).toBe(true);
    expect(list[1]!.text).toBe('Never closed'); // partial text kept
    expect(list[1]!.xmlEndOffset).toBe(-1);
    expect(list[1]!.sourceId).toBe('2');
  });

  it('skips malformed markup INSIDE a note without losing the note', () => {
    // A broken inner tag is isolated by the paragraph layer; the note still
    // yields its usable text.
    const xml = footnotesPart(
      '<w:footnote w:id="1"><w:p><w:r><w:t>Broken <w:r><w:t> but text kept</w:t></w:r></w:p></w:footnote>',
    );
    const notes = scanNotePart(xml, 'footnote');
    expect(notes).toHaveLength(1);
    expect(notes[0]!.text.length).toBeGreaterThan(0);
  });
});

describe('parser/footnotes.ts — determinism (R008)', () => {
  it('produces identical note scans for identical input', () => {
    const xml = footnotesPart(
      '<w:footnote w:id="1"><w:p><w:r><w:t>A</w:t></w:r></w:p></w:footnote>' +
        '<w:footnote w:id="2"><w:p><w:r><w:t>B</w:t></w:r></w:p></w:footnote>',
    );
    expect(scanNotePart(xml, 'footnote')).toEqual(scanNotePart(xml, 'footnote'));
  });
});
