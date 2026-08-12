/**
 * S01-T3 — bounds-guarded fflate ZIP reader tests.
 *
 * Covers the reader's security contract (R002/R016/R019/R022):
 *  - a valid .docx yields a bounded parts Map, byte-faithful per part;
 *  - typed errors, not crashes: NotADocxError (not a zip / truncated /
 *    non-DOCX), ZipBombError (per-entry, aggregate, entry-count bounds),
 *    UnsupportedFormatError (unknown compression method);
 *  - the fflate filter rejects oversized entries BEFORE decompression —
 *    proven here by crafting entries whose *declared* sizes are huge while
 *    the payload is tiny/garbage: only a pre-decompression rejection can
 *    produce ZipBombError for such an archive (a decompressed attempt would
 *    throw a corrupt-data error instead);
 *  - determinism (R008): the reader is a pure function of the input bytes.
 *
 * Fixture strategy: fflate `zipSync` builds real archives; `craftZip` builds
 * hand-rolled archives with intentionally lying size fields (documented in
 * the limits contract as the attack surface the filter must defend). No
 * gitignored paths or on-disk fixtures — everything is inlined bytes.
 */

import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';

import {
  DOCX_ENTRY_MAX,
  TOTAL_DECOMPRESSED_MAX,
  XML_STRING_MAX,
  MAX_ENTRY_COUNT,
  PROCESSING_TIME_BUDGET_MS,
} from '../src/zip/limits.js';
import {
  NotADocxError,
  UnsupportedFormatError,
  ZipBombError,
} from '../src/zip/errors.js';
import { safeZipRead, type ZipReader } from '../src/zip/reader.js';

const enc = new TextEncoder();

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Real ZIP (deflate) via fflate, as a valid .docx would be produced. */
function realZip(files: Record<string, string>): Uint8Array {
  return zipSync(
    Object.fromEntries(
      Object.entries(files).map(([name, content]) => [
        name,
        enc.encode(content),
      ]),
    ),
  );
}

/** A minimal, valid .docx: the two parts the reader requires (R019/R022). */
function minimalDocx(): Uint8Array {
  return realZip({
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>',
    'word/document.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:body><w:p><w:r><w:t>Hello CiteSync</w:t></w:r></w:p></w:body></w:document>',
  });
}

/** Small big-endian-free little-endian writers for the hand-rolled ZIP. */
function u16(v: number, b: Uint8Array, o: number): void {
  b[o] = v & 0xff;
  b[o + 1] = (v >>> 8) & 0xff;
}
function u32(v: number, b: Uint8Array, o: number): void {
  b[o] = v & 0xff;
  b[o + 1] = (v >>> 8) & 0xff;
  b[o + 2] = (v >>> 16) & 0xff;
  b[o + 3] = (v >>> 24) & 0xff;
}

interface CraftEntry {
  name: string;
  /** 0 = store, 8 = deflate, anything else = unsupported method. */
  method: number;
  /**
   * Declared compressed AND uncompressed size (store). May lie about the
   * actual payload — this is the attack surface the reader's filter guards.
   */
  declaredSize: number;
  /** Actual payload bytes written to the archive (tiny for bomb fixtures). */
  data: Uint8Array;
}

/**
 * Hand-roll a ZIP whose central directory may declare sizes far larger than
 * the actual payload. fflate's unzipSync trusts these declared sizes only
 * after the filter has approved the entry, so a lying size + tiny payload is
 * exactly what proves the filter runs before any allocation/decompression.
 */
function craftZip(entries: CraftEntry[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = enc.encode(e.name);

    // Local file header (30 bytes) + name + payload.
    const local = new Uint8Array(30 + name.length + e.data.length);
    u32(0x04034b50, local, 0); // PK\x03\x04
    u16(20, local, 4); // version needed
    u16(0x0800, local, 6); // flags: UTF-8 filename
    u16(e.method, local, 8);
    u16(0, local, 10); // mod time
    u16(0, local, 12); // mod date
    u32(0, local, 14); // crc (sync path never verifies)
    u32(e.declaredSize, local, 18); // compressed size (may lie)
    u32(e.declaredSize, local, 22); // uncompressed size (may lie)
    u16(name.length, local, 26);
    u16(0, local, 28); // extra length
    local.set(name, 30);
    local.set(e.data, 30 + name.length);
    locals.push(local);

    // Central directory entry (46 bytes) + name.
    const central = new Uint8Array(46 + name.length);
    u32(0x02014b50, central, 0); // PK\x01\x02
    u16(20, central, 4); // version made by
    u16(20, central, 6); // version needed
    u16(0x0800, central, 8); // flags: UTF-8 filename
    u16(e.method, central, 10);
    u16(0, central, 12); // mod time
    u16(0, central, 14); // mod date
    u32(0, central, 16); // crc
    u32(e.declaredSize, central, 20); // compressed size (may lie)
    u32(e.declaredSize, central, 24); // uncompressed size (may lie)
    u16(name.length, central, 28);
    u16(0, central, 30); // extra length
    u16(0, central, 32); // comment length
    u16(0, central, 34); // disk number
    u16(0, central, 36); // internal attrs
    u32(0, central, 38); // external attrs
    u32(offset, central, 42); // local header offset
    central.set(name, 46);
    centrals.push(central);

    offset += local.length;
  }

  const cdOffset = offset;
  const cdLen = centrals.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(cdOffset + cdLen + 22);
  let p = 0;
  for (const l of locals) {
    out.set(l, p);
    p += l.length;
  }
  for (const c of centrals) {
    out.set(c, p);
    p += c.length;
  }
  // End-of-central-directory record (22 bytes).
  u32(0x06054b50, out, p); // PK\x05\x06
  u16(0, out, p + 4); // disk number
  u16(0, out, p + 6); // disk with central dir
  u16(entries.length, out, p + 8); // entries on this disk
  u16(entries.length, out, p + 10); // total entries
  u32(cdLen, out, p + 12);
  u32(cdOffset, out, p + 16);
  u16(0, out, p + 20); // comment length
  return out;
}

/** Human-readable MiB helpers for assertions. */
const MIB = 1024 * 1024;
const mb = (n: number): number => n * MIB;

/**
 * Run `fn`, assert it throws a `DocxReaderError` of `expectedClass`, and
 * return its `detail` field — the diagnostic half of the typed errors
 * (`message` is the stable short discriminator; `detail` carries context).
 */
function thrownDetail(
  fn: () => unknown,
  expectedClass: new (...args: never[]) => Error,
): string {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(expectedClass);
    expect(err).toHaveProperty('detail');
    return (err as { detail: string }).detail;
  }
  throw new Error('expected safeZipRead to throw');
}

// ---------------------------------------------------------------------------
// Limits contract
// ---------------------------------------------------------------------------

describe('zip/limits.ts — documented resource bounds', () => {
  it('pins the exact documented defaults (determinism, R008)', () => {
    expect(DOCX_ENTRY_MAX).toBe(mb(50));
    expect(TOTAL_DECOMPRESSED_MAX).toBe(mb(200));
    expect(XML_STRING_MAX).toBe(mb(64));
    expect(MAX_ENTRY_COUNT).toBe(2000);
    expect(PROCESSING_TIME_BUDGET_MS).toBe(1500);
  });

  it('keeps the caps sane relative to each other', () => {
    // The XML string cap must never exceed the aggregate decompressed cap
    // (one XML part is a subset of the archive's decompressed bytes).
    expect(XML_STRING_MAX).toBeLessThanOrEqual(TOTAL_DECOMPRESSED_MAX);
    expect(DOCX_ENTRY_MAX).toBeLessThan(TOTAL_DECOMPRESSED_MAX);
    expect(PROCESSING_TIME_BUDGET_MS).toBeGreaterThan(0);
    expect(MAX_ENTRY_COUNT).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('safeZipRead — valid .docx', () => {
  it('returns a bounded parts Map with the required parts byte-faithful', () => {
    const docx = minimalDocx();
    const reader: ZipReader = safeZipRead(docx);

    expect(reader.parts).toBeInstanceOf(Map);
    expect(reader.parts.has('[Content_Types].xml')).toBe(true);
    expect(reader.parts.has('word/document.xml')).toBe(true);

    const doc = reader.parts.get('word/document.xml')!;
    expect(new TextDecoder().decode(doc)).toContain('Hello CiteSync');
  });

  it('extracts every part, not just the required two, keyed by exact path', () => {
    const docx = realZip({
      '[Content_Types].xml': '<Types/>',
      'word/document.xml': '<w:document/>',
      'word/styles.xml': '<w:styles/>',
      'word/_rels/document.xml.rels': '<Relationships/>',
    });
    const reader = safeZipRead(docx);

    expect([...reader.parts.keys()]).toEqual([
      '[Content_Types].xml',
      'word/document.xml',
      'word/styles.xml',
      'word/_rels/document.xml.rels',
    ]);
    expect(new TextDecoder().decode(reader.parts.get('word/styles.xml')!)).toBe(
      '<w:styles/>',
    );
  });

  it('is deterministic: identical bytes in, byte-identical parts out (R008)', () => {
    const docx = minimalDocx();
    const first = safeZipRead(docx).parts;
    const second = safeZipRead(docx).parts;

    expect(first.size).toBe(second.size);
    for (const [name, bytes] of first) {
      expect(second.get(name)).toEqual(bytes);
    }
  });

  it('accepts a real multi-MiB entry well under the caps (caps are generous)', () => {
    // 5 MiB of real content, deflated — exercises the normal inflate path.
    const big = new Uint8Array(mb(5));
    for (let i = 0; i < big.length; i += 4096) big[i] = i & 0xff;
    const docx = zipSync({
      '[Content_Types].xml': enc.encode('<Types/>'),
      'word/document.xml': big,
    });
    const reader = safeZipRead(docx);
    expect(reader.parts.get('word/document.xml')!.length).toBe(mb(5));
  });
});

// ---------------------------------------------------------------------------
// NotADocxError family
// ---------------------------------------------------------------------------

describe('safeZipRead — NotADocxError (R019/R022: never accept a non-DOCX)', () => {
  it('rejects garbage that is not a ZIP at all', () => {
    const garbage = enc.encode('this is definitely not a zip file at all');
    expect(() => safeZipRead(garbage)).toThrow(NotADocxError);
  });

  it('rejects an empty buffer', () => {
    expect(() => safeZipRead(new Uint8Array(0))).toThrow(NotADocxError);
  });

  it('rejects a truncated ZIP (EOCD destroyed)', () => {
    const docx = minimalDocx();
    const truncated = docx.slice(0, docx.length - 30); // cut into the data
    expect(() => safeZipRead(truncated)).toThrow(NotADocxError);
  });

  it('rejects a truncated ZIP (EOCD gone entirely)', () => {
    const docx = minimalDocx();
    const half = docx.slice(0, Math.floor(docx.length / 2));
    expect(() => safeZipRead(half)).toThrow(NotADocxError);
  });

  it('rejects a valid ZIP with no DOCX parts at all', () => {
    const zip = realZip({ 'readme.txt': 'not a docx' });
    expect(() => safeZipRead(zip)).toThrow(NotADocxError);
  });

  it('rejects an empty ZIP (zero entries)', () => {
    expect(() => safeZipRead(zipSync({}))).toThrow(NotADocxError);
  });

  it('rejects an archive missing [Content_Types].xml', () => {
    const zip = realZip({ 'word/document.xml': '<w:document/>' });
    const detail = thrownDetail(() => safeZipRead(zip), NotADocxError);
    expect(detail).toMatch(/missing required part "\[Content_Types\]\.xml"/);
  });

  it('rejects an archive missing word/document.xml', () => {
    const zip = realZip({ '[Content_Types].xml': '<Types/>' });
    const detail = thrownDetail(() => safeZipRead(zip), NotADocxError);
    expect(detail).toMatch(/missing required part "word\/document\.xml"/);
  });
});

// ---------------------------------------------------------------------------
// ZipBombError family (R016)
// ---------------------------------------------------------------------------

describe('safeZipRead — ZipBombError (bounds guard, R016)', () => {
  it('rejects a single entry over DOCX_ENTRY_MAX before decompressing it', () => {
    // The entry *declares* 51 MiB (over the 50 MiB cap) but carries a tiny
    // garbage payload. Only a filter that runs BEFORE decompression can
    // produce ZipBombError here — a decompress-first reader would instead
    // fail on the corrupt deflate data (NotADocxError) or allocate 51 MiB.
    const bomb = craftZip([
      {
        name: 'word/document.xml',
        method: 8, // deflate, but payload is garbage
        declaredSize: DOCX_ENTRY_MAX + 1,
        data: enc.encode('tiny garbage that would never inflate'),
      },
    ]);
    expect(() => safeZipRead(bomb)).toThrow(ZipBombError);
  });

  it('accepts an entry at exactly DOCX_ENTRY_MAX (cap is an exclusive bound)', () => {
    // Declared size == cap is NOT > cap, so it is accepted (documented: caps
    // are exclusive upper bounds) and the required parts still pass — no
    // false bomb. The `[Content_Types].xml` entry declares its honest size
    // (8 bytes) so its extraction is byte-faithful; the at-cap entry is
    // asserted for presence (its store slice over-reads by fixture design).
    const atCap = craftZip([
      {
        name: '[Content_Types].xml',
        method: 0,
        declaredSize: 8,
        data: enc.encode('<Types/>'),
      },
      {
        name: 'word/document.xml',
        method: 0,
        declaredSize: DOCX_ENTRY_MAX,
        data: enc.encode('<w:document/>'),
      },
    ]);
    const reader = safeZipRead(atCap);
    expect(reader.parts.has('word/document.xml')).toBe(true);
    expect(new TextDecoder().decode(reader.parts.get('[Content_Types].xml')!)).toBe(
      '<Types/>',
    );
  });

  it('rejects an archive whose aggregate decompressed size exceeds TOTAL_DECOMPRESSED_MAX', () => {
    // 5 entries each declaring 45 MiB: the first four sum to 180 MiB
    // (accepted), the fifth would push the total past 200 MiB — the stateful
    // filter refuses it before any allocation of the declared sizes.
    const entries: CraftEntry[] = [];
    for (let i = 0; i < 5; i++) {
      entries.push({
        name: `part_${i}.bin`,
        method: 0, // store: if the filter did not stop it, this would "succeed"
        declaredSize: mb(45),
        data: enc.encode('tiny'),
      });
    }
    const detail = thrownDetail(() => safeZipRead(craftZip(entries)), ZipBombError);
    expect(detail).toMatch(/aggregate decompressed size/);
  });

  it('rejects an archive with more entries than MAX_ENTRY_COUNT', () => {
    // Real (not crafted) zip with 2001 tiny entries — the count cap must stop
    // it before the 2001st entry is decompressed.
    const files: Record<string, string> = {};
    for (let i = 0; i < MAX_ENTRY_COUNT + 1; i++) {
      files[`part_${String(i).padStart(4, '0')}.xml`] = '<x/>';
    }
    expect(() => safeZipRead(realZip(files))).toThrow(ZipBombError);
  });

  it('carries a diagnostic detail naming the breached limit', () => {
    const bomb = craftZip([
      {
        name: 'word/document.xml',
        method: 8,
        declaredSize: DOCX_ENTRY_MAX + 1,
        data: enc.encode('garbage'),
      },
    ]);
    try {
      safeZipRead(bomb);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ZipBombError);
      const e = err as ZipBombError;
      expect(e.name).toBe('ZipBombError');
      expect(e.detail).toContain('DOCX_ENTRY_MAX');
      expect(e.detail).toContain('word/document.xml');
    }
  });
});

// ---------------------------------------------------------------------------
// UnsupportedFormatError family
// ---------------------------------------------------------------------------

describe('safeZipRead — UnsupportedFormatError', () => {
  it('rejects an archive using an unknown compression method', () => {
    const zip = craftZip([
      {
        name: 'word/document.xml',
        method: 99, // neither store (0) nor deflate (8)
        declaredSize: 4,
        data: enc.encode('abcd'),
      },
    ]);
    expect(() => safeZipRead(zip)).toThrow(UnsupportedFormatError);
  });
});

// ---------------------------------------------------------------------------
// Error taxonomy sanity
// ---------------------------------------------------------------------------

describe('zip/errors.ts — typed error family', () => {
  it('distinguishes bomb / not-a-docx / unsupported without string matching', () => {
    const garbage = enc.encode('nope');
    const bomb = craftZip([
      {
        name: 'word/document.xml',
        method: 8,
        declaredSize: DOCX_ENTRY_MAX + 1,
        data: enc.encode('x'),
      },
    ]);
    const unsupported = craftZip([
      { name: 'word/document.xml', method: 99, declaredSize: 4, data: enc.encode('x') },
    ]);

    expect(() => safeZipRead(garbage)).toThrow(NotADocxError);
    expect(() => safeZipRead(garbage)).not.toThrow(ZipBombError);
    expect(() => safeZipRead(bomb)).toThrow(ZipBombError);
    expect(() => safeZipRead(bomb)).not.toThrow(NotADocxError);
    expect(() => safeZipRead(unsupported)).toThrow(UnsupportedFormatError);
    expect(() => safeZipRead(unsupported)).not.toThrow(ZipBombError);
  });

  it('keeps name discriminators stable and detail always populated', () => {
    const e = new ZipBombError('details here');
    expect(e.name).toBe('ZipBombError');
    expect(e.detail).toBe('details here');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(ZipBombError);
  });
});
