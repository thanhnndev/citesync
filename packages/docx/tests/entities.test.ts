/**
 * S01-T8 — entity decoder tests (S01-T4 module).
 *
 * `decodeEntities` / `decodeEntityReference` are the offset-accounting
 * backbone: the source-position scanner advances paragraph-text offsets by
 * DECODED length, so decoding must be exact, deterministic (R008) and
 * conservative — unknown or malformed references are kept verbatim, never
 * guessed.
 *
 * Covers the T8 contract for this module:
 *  - the five XML predefined entities + the curated wordprocessing set
 *    (`&nbsp;` and friends);
 *  - numeric references: decimal `&#8212;`, hex `&#x2014;`, uppercase `&#X...`,
 *    astral code points; malformed/out-of-range/surrogate refs rejected;
 *  - unknown named entities and unterminated refs kept verbatim;
 *  - `delta` accounting (decoded.length - raw.length <= 0, exact values);
 *  - determinism (R008): pure function, identical input -> identical output.
 */

import { describe, expect, it } from 'vitest';

import { decodeEntities, decodeEntityReference } from '../src/xml/entities.js';

describe('xml/entities.ts — predefined + curated named entities', () => {
  it('decodes the five XML predefined entities', () => {
    expect(decodeEntityReference('amp')).toBe('&');
    expect(decodeEntityReference('lt')).toBe('<');
    expect(decodeEntityReference('gt')).toBe('>');
    expect(decodeEntityReference('quot')).toBe('"');
    expect(decodeEntityReference('apos')).toBe("'");
  });

  it('decodes the curated wordprocessing whitespace/dash/punct set', () => {
    expect(decodeEntityReference('nbsp')).toBe('\u00A0');
    expect(decodeEntityReference('shy')).toBe('\u00AD');
    expect(decodeEntityReference('ndash')).toBe('\u2013');
    expect(decodeEntityReference('mdash')).toBe('\u2014');
    expect(decodeEntityReference('hellip')).toBe('\u2026');
    expect(decodeEntityReference('lsquo')).toBe('\u2018');
    expect(decodeEntityReference('rsquo')).toBe('\u2019');
    expect(decodeEntityReference('ldquo')).toBe('\u201C');
    expect(decodeEntityReference('rdquo')).toBe('\u201D');
    expect(decodeEntityReference('euro')).toBe('\u20AC');
    expect(decodeEntityReference('aacute')).toBe('\u00E1');
    expect(decodeEntityReference('Ntilde')).toBe('\u00D1');
    expect(decodeEntityReference('szlig')).toBe('\u00DF');
  });

  it('decodes entities embedded in text via decodeEntities', () => {
    const { decoded, delta } = decodeEntities('a&amp;b &lt;c&gt; &quot;q&quot; &apos;x&apos;');
    expect(decoded).toBe('a&b <c> "q" \'x\'');
    expect(delta).toBe(decoded.length - 'a&amp;b &lt;c&gt; &quot;q&quot; &apos;x&apos;'.length);
  });
});

describe('xml/entities.ts — numeric references', () => {
  it('decodes decimal numeric refs', () => {
    expect(decodeEntityReference('#65')).toBe('A');
    expect(decodeEntityReference('#8212')).toBe('\u2014');
    expect(decodeEntities('x&#8212;y').decoded).toBe('x\u2014y');
  });

  it('decodes hex numeric refs (lower- and uppercase X)', () => {
    expect(decodeEntityReference('#x41')).toBe('A');
    expect(decodeEntityReference('#X41')).toBe('A');
    expect(decodeEntityReference('#x2014')).toBe('\u2014');
    expect(decodeEntityReference('#x1F600')).toBe('\u{1F600}'); // astral
  });

  it('rejects malformed or out-of-range numeric refs (kept verbatim)', () => {
    // No digits at all.
    expect(decodeEntityReference('#')).toBe(undefined);
    expect(decodeEntityReference('#x')).toBe(undefined);
    expect(decodeEntityReference('#X')).toBe(undefined);
    // Non-digit characters in the numeric body.
    expect(decodeEntityReference('#1j')).toBe(undefined);
    expect(decodeEntityReference('#12x')).toBe(undefined);
    expect(decodeEntityReference('#x1g')).toBe(undefined);
    // Out of the Unicode range / lone surrogates (not representable).
    expect(decodeEntityReference('#1114112')).toBe(undefined); // 0x10FFFF + 1
    expect(decodeEntityReference('#x110000')).toBe(undefined);
    expect(decodeEntityReference('#xFFFFFFFF')).toBe(undefined);
    expect(decodeEntityReference('#xD800')).toBe(undefined);
    expect(decodeEntityReference('#xDFFF')).toBe(undefined);
    // A negative-looking body is not valid decimal digits either.
    expect(decodeEntityReference('#-1')).toBe(undefined);
  });

  it('keeps an invalid numeric ref verbatim inside text', () => {
    const raw = 'a&#x110000;b';
    const { decoded, delta } = decodeEntities(raw);
    expect(decoded).toBe(raw); // unchanged
    expect(delta).toBe(0);
  });
});

describe('xml/entities.ts — conservative verbatim handling', () => {
  it('keeps unknown named entities verbatim (never guesses)', () => {
    expect(decodeEntityReference('foo')).toBe(undefined);
    expect(decodeEntityReference('unknown')).toBe(undefined);
    expect(decodeEntities('&foo; &bar;').decoded).toBe('&foo; &bar;');
  });

  it('keeps an empty entity body verbatim', () => {
    expect(decodeEntityReference('')).toBe(undefined);
    expect(decodeEntities('a&;b').decoded).toBe('a&;b');
  });

  it('keeps unterminated references verbatim (no trailing ;)', () => {
    expect(decodeEntities('a&ampb').decoded).toBe('a&ampb');
    expect(decodeEntities('a&nbspb').decoded).toBe('a&nbspb');
  });

  it('decodes only one level (a decoded & is not re-scanned)', () => {
    // "&amp;amp;" -> first "&amp;" decodes to '&', the remainder "amp;" is
    // literal text, giving "&amp;" — one level of decoding, never recursive.
    expect(decodeEntities('&amp;amp;').decoded).toBe('&amp;');
  });

  it('keeps plain text without entities byte-identical', () => {
    const raw = 'No entities here at all.';
    const { decoded, delta } = decodeEntities(raw);
    expect(decoded).toBe(raw);
    expect(delta).toBe(0);
  });
});

describe('xml/entities.ts — delta accounting (offset contract)', () => {
  it('reports the exact decoded-minus-raw char delta', () => {
    // 'a&nbsp;b&#8212;c&#x2014;d' raw 25 chars -> decoded 7 chars.
    const raw = 'a&nbsp;b&#8212;c&#x2014;d';
    const { decoded, delta } = decodeEntities(raw);
    expect(decoded).toBe('a\u00A0b\u2014c\u2014d');
    expect(decoded.length).toBe(7);
    expect(raw.length).toBe(25);
    expect(delta).toBe(7 - 25);
  });

  it('never reports a positive delta (decoding only shrinks)', () => {
    for (const raw of [
      'plain',
      '&amp;',
      'a&nbsp;b',
      '&#x1F600;',
      '&unknown;',
      '&amp;amp;',
      'mixed &amp; &nbsp; &#8212; end',
    ]) {
      expect(decodeEntities(raw).delta, raw).toBeLessThanOrEqual(0);
    }
  });
});

describe('xml/entities.ts — determinism (R008)', () => {
  it('is a pure function: identical input -> identical output', () => {
    const raw = 'Nguyễn &amp; Trần — a&nbsp;b&#8212;c&#x2014;d &unknown; tail';
    expect(decodeEntities(raw)).toEqual(decodeEntities(raw));
    expect(decodeEntityReference('nbsp')).toBe(decodeEntityReference('nbsp'));
  });
});
