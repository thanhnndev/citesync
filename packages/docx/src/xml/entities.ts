/**
 * @citesync/docx — deterministic XML/HTML entity decoder (S01-T4).
 *
 * Offsets in the source-position scanner are accumulated by entity-DECODED
 * length (see `packages/document-model` offset semantics). This module turns a
 * raw `<w:t>` content string into its decoded form and reports the char-length
 * delta so offset accounting stays aligned with what text-slicing actually
 * sees.
 *
 * Determinism (R008): a pure function, no platform/random/time dependence —
 * the same input bytes always map to the same decoded string.
 *
 * Scope: the five XML predefined entities, `&nbsp;` and friends used in
 * wordprocessingML text, and numeric references `&#123;` / `&#x1F;`. Unknown
 * named entities are returned verbatim (we never guess a replacement).
 */

/** Curated named entities likely to appear in real OOXML `w:t` text. */
const NAMED: Readonly<Record<string, string>> = {
  // XML predefined (always present)
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  // Word processing text whitespace / dashes / punctuation
  nbsp: '\u00A0',
  iexcl: '\u00A1',
  'not': '\u00AC',
  shy: '\u00AD',
  ndash: '\u2013',
  mdash: '\u2014',
  hellip: '\u2026',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201C',
  rdquo: '\u201D',
  laquo: '\u00AB',
  raquo: '\u00BB',
  bull: '\u2022',
  middot: '\u00B7',
  copy: '\u00A9',
  reg: '\u00AE',
  trade: '\u2122',
  deg: '\u00B0',
  plusmn: '\u00B1',
  times: '\u00D7',
  divide: '\u00F7',
  micro: '\u00B5',
  sect: '\u00A7',
  para: '\u00B6',
  euro: '\u20AC',
  pound: '\u00A3',
  yen: '\u00A5',
  cent: '\u00A2',
  // Common accented letters (uppercase then lowercase; acute then grave/circumflex/tilde/umlaut)
  Aacute: '\u00C1', aacute: '\u00E1',
  Agrave: '\u00C0', agrave: '\u00E0',
  Acirc: '\u00C2', acirc: '\u00E2',
  Atilde: '\u00C3', atilde: '\u00E3',
  Auml: '\u00C4', auml: '\u00E4',
  Eacute: '\u00C9', eacute: '\u00E9',
  Egrave: '\u00C8', egrave: '\u00E8',
  Ecirc: '\u00CA', ecirc: '\u00EA',
  Euml: '\u00CB', euml: '\u00EB',
  Iacute: '\u00CD', iacute: '\u00ED',
  Igrave: '\u00CC', igrave: '\u00EC',
  Icirc: '\u00CE', icirc: '\u00EE',
  Iuml: '\u00CF', iuml: '\u00EF',
  Oacute: '\u00D3', oacute: '\u00F3',
  Ograve: '\u00D2', ograve: '\u00F2',
  Ocirc: '\u00D4', ocirc: '\u00F4',
  Otilde: '\u00D5', otilde: '\u00F5',
  Ouml: '\u00D6', ouml: '\u00F6',
  Uacute: '\u00DA', uacute: '\u00FA',
  Ugrave: '\u00D9', ugrave: '\u00F9',
  Ucirc: '\u00DB', ucirc: '\u00FB',
  Uuml: '\u00DC', uuml: '\u00FC',
  Ntilde: '\u00D1', ntilde: '\u00F1',
  Ccedil: '\u00C7', ccedil: '\u00E7',
  szlig: '\u00DF',
};

/**
 * Decode a single entity *body* (the characters between `&` and `;`, without
 * either delimiter), e.g. "amp", "nbsp", "x1F", "8364". Returns `undefined`
 * when the body is not a recognized entity (caller keeps it verbatim).
 * Deterministic and dependency-free.
 */
export function decodeEntityReference(body: string): string | undefined {
  if (body.length === 0) return undefined;
  if (body[0] === '#') {
    // Numeric reference: &#dd; or &#xhh;. Must contain at least one digit.
    const isHex = body.length > 1 && (body[1] === 'x' || body[1] === 'X');
    const digits = isHex ? body.slice(2) : body.slice(1);
    // Strictly validate the digits — never let parseInt silently accept a
    // leading subset of a malformed body (e.g. "#1j").
    if (digits.length === 0) return undefined;
    if (isHex && !/^[0-9a-fA-F]+$/.test(digits)) return undefined;
    if (!isHex && !/^[0-9]+$/.test(digits)) return undefined;
    const radix = isHex ? 16 : 10;
    const cp = Number.parseInt(digits, radix);
    if (!Number.isFinite(cp)) return undefined;
    // Reject out-of-range code points (incl. lone surrogates, which JS strings
    // cannot represent faithfully).
    if (cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
      return undefined;
    }
    return String.fromCodePoint(cp);
  }
  // Named decimal-decimal lookup.
  return NAMED[body];
}

/** Result of decoding a block of raw XML character data. */
export interface EntityDecodeResult {
  /** The decoded string (all recognized entity refs replaced). */
  decoded: string;
  /**
   * `decoded.length - raw.length`. Negative is impossible here (decoding only
   * ever shrinks or leaves length unchanged), zero when no entities were
   * replaced. Lets offset accounting reconcile raw spans against decoded
   * spans.
   */
  delta: number;
}

/**
 * Decode all XML/HTML entity references in `raw`. Unknown named entities are
 * left as-is. Pure and deterministic (R008).
 */
export function decodeEntities(raw: string): EntityDecodeResult {
  const ampCount = raw.indexOf('&');
  if (ampCount === -1) {
    return { decoded: raw, delta: 0 };
  }

  let out = '';
  let last = 0;
  let i = 0;
  const n = raw.length;

  while (i < n) {
    const c = raw.charCodeAt(i);
    if (c === 38 /* & */) {
      const semi = raw.indexOf(';', i + 1);
      if (semi === -1) {
        // Unterminated entity: emit the rest verbatim.
        out += raw.slice(last, n);
        last = n;
        i = n;
        break;
      }
      const body = raw.slice(i + 1, semi);
      const decoded = decodeEntityReference(body);
      if (decoded !== undefined) {
        out += raw.slice(last, i);
        out += decoded;
        last = semi + 1;
        i = semi + 1;
        continue;
      }
      // Not a recognized entity — keep scanning for a later '&' but include
      // this '&' in the as-is span.
      i += 1;
      continue;
    }
    i += 1;
  }

  if (last < n) out += raw.slice(last, n);

  if (out === '') {
    // Everything was consumed but out only equals raw when no entity replaced.
    return { decoded: raw, delta: 0 };
  }
  return { decoded: out, delta: out.length - raw.length };
}
