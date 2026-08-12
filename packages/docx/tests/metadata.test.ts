/**
 * S01-T8 — core-properties metadata tests (S01-T6 module).
 *
 * `extractCoreProperties` turns raw docProps/core.xml into the §15
 * `DocumentMetadata` shape with a safe-default contract: it NEVER throws on
 * missing/malformed metadata (R002/R019/R022 — a broken metadata part must
 * not crash a valid document), is prefix-agnostic (local-name matching), and
 * is pure + deterministic (R008).
 *
 * Covers the T8 contract for this module:
 *  - full extraction (title / author / created / modified) from a realistic
 *    core.xml with arbitrary prefix bindings;
 *  - safe defaults: undefined / empty / no-markup / broken parts;
 *  - whitespace-only values absent, values entity-decoded + trimmed;
 *  - repeated elements last-wins; self-closing elements absent;
 *  - unterminated tail content still captured; determinism.
 */

import { describe, expect, it } from 'vitest';

import { extractCoreProperties } from '../src/metadata.js';

const CORE_WRAP = (body: string): string =>
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"' +
  ' xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"' +
  ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
  body +
  '</cp:coreProperties>';

describe('metadata.ts — full extraction (prefix-agnostic)', () => {
  it('extracts title/author/created/modified from a realistic core.xml', () => {
    const coreXml = CORE_WRAP(
      '  <dc:title>Minimal golden fixture</dc:title>' +
        '  <dc:creator>CiteSync Fixtures</dc:creator>' +
        '  <dcterms:created xsi:type="dcterms:W3CDTF">2024-01-15T10:30:00Z</dcterms:created>' +
        '  <dcterms:modified xsi:type="dcterms:W3CDTF">2024-02-20T08:00:00Z</dcterms:modified>',
    );
    expect(extractCoreProperties(coreXml)).toEqual({
      title: 'Minimal golden fixture',
      author: 'CiteSync Fixtures',
      created: '2024-01-15T10:30:00Z',
      modified: '2024-02-20T08:00:00Z',
    });
  });

  it('matches on the LOCAL element name regardless of prefix binding', () => {
    // A different producer might bind "m:" instead of "dc:" — extraction must
    // not care (the local name is "title"/"creator"/"created"/"modified").
    const coreXml =
      '<coreProperties xmlns:m="urn:example:meta">' +
      '<m:title>Custom prefix</m:title>' +
      '<m:creator>Someone</m:creator>' +
      '<m:created>2023-05-01T00:00:00Z</m:created>' +
      '<m:modified>2023-06-01T00:00:00Z</m:modified>' +
      '</coreProperties>';
    expect(extractCoreProperties(coreXml)).toEqual({
      title: 'Custom prefix',
      author: 'Someone',
      created: '2023-05-01T00:00:00Z',
      modified: '2023-06-01T00:00:00Z',
    });
  });

  it('ignores non-metadata elements and attribute noise', () => {
    const coreXml = CORE_WRAP(
      '<cp:lastPrinted>2023-01-01T00:00:00Z</cp:lastPrinted>' +
        '<dc:title>Only title here</dc:title>' +
        '<cp:revision>3</cp:revision>',
    );
    expect(extractCoreProperties(coreXml)).toEqual({ title: 'Only title here' });
  });
});

describe('metadata.ts — safe defaults on missing/malformed metadata', () => {
  it('returns {} for a missing part (undefined) — never throws', () => {
    expect(extractCoreProperties(undefined)).toEqual({});
  });

  it('returns {} for an empty part', () => {
    expect(extractCoreProperties('')).toEqual({});
  });

  it('returns {} for a part with no markup at all', () => {
    expect(extractCoreProperties('just plain text, no tags')).toEqual({});
  });

  it('isolates a broken part: partial fields kept, never throws', () => {
    // A closed title plus an unterminated creator tail: extraction must keep
    // what is presentable (title + partial creator) and stop safely.
    const coreXml =
      '<cp:coreProperties><dc:title>Closed title</dc:title><dc:creator>Broken tail';
    expect(() => extractCoreProperties(coreXml)).not.toThrow();
    expect(extractCoreProperties(coreXml)).toEqual({
      title: 'Closed title',
      author: 'Broken tail',
    });
  });

  it('treats a self-closing metadata element as absent', () => {
    const coreXml = CORE_WRAP('<dc:title/><dc:creator>Author</dc:creator>');
    expect(extractCoreProperties(coreXml)).toEqual({ author: 'Author' });
  });
});

describe('metadata.ts — value hygiene', () => {
  it('treats whitespace-only values as absent', () => {
    const coreXml = CORE_WRAP('<dc:title>   </dc:title><dc:creator>X</dc:creator>');
    expect(extractCoreProperties(coreXml)).toEqual({ author: 'X' });
  });

  it('entity-decodes and trims values', () => {
    const coreXml = CORE_WRAP(
      '<dc:title>  Tom &amp; Jerry &#8212; the movie  </dc:title>' +
        '<dc:creator>Nguyễn &amp; Trần</dc:creator>',
    );
    expect(extractCoreProperties(coreXml)).toEqual({
      title: 'Tom & Jerry \u2014 the movie',
      author: 'Nguyễn & Trần',
    });
  });

  it('resolves repeated elements last-wins', () => {
    const coreXml = CORE_WRAP(
      '<dc:title>First</dc:title><dc:title>Second</dc:title><dc:creator>A</dc:creator>',
    );
    expect(extractCoreProperties(coreXml)).toEqual({ title: 'Second', author: 'A' });
  });
});

describe('metadata.ts — determinism (R008)', () => {
  it('is a pure function of the input string', () => {
    const coreXml = CORE_WRAP(
      '<dc:title>Stable</dc:title><dc:creator>Pure</dc:creator>' +
        '<dcterms:created>2024-01-15T10:30:00Z</dcterms:created>',
    );
    expect(extractCoreProperties(coreXml)).toEqual(extractCoreProperties(coreXml));
  });
});
