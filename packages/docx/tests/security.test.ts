/**
 * S01-T8 — security contract tests (R002/R016/R019/R022, §87 note-and-skip).
 *
 * The reader is fed UNTRUSTED bytes. These tests prove the security posture
 * with real committed fixtures + a direct buildModel cap check:
 *  - macros are flagged, never executed or decoded: `vba-sample.docx` parses
 *    as a VALID document, `security.macrosPresent` is true, and the
 *    vbaProject.bin payload bytes appear NOWHERE in the produced model;
 *  - external relationship targets are recorded first-seen and never
 *    followed: the two remote targets of vba-sample.docx are present in
 *    `security.remoteTargets` and parsing completes with no fetch/eval
 *    (the reader has no network code path — the model is the only output);
 *  - the XML string cap (XML_STRING_MAX) is enforced by the model builder:
 *    an oversized decoded part -> typed ZipBombError naming the limit;
 *  - every bad sample fails with its exact typed error and no hang (the
 *    zip bomb is rejected BEFORE decompression);
 *  - benign documents carry no security section at all (clean model).
 *
 * Fixtures are git-tracked committed files read via node:fs (never .gsd/ or
 * any gitignored path).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildModel } from '../src/build-model.js';
import { parseDocument } from '../src/index.js';
import { NotADocxError, ZipBombError } from '../src/zip/errors.js';
import { XML_STRING_MAX } from '../src/zip/limits.js';

const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/', import.meta.url));

function fixture(rel: string): Uint8Array {
  return readFileSync(join(FIXTURES_DIR, rel));
}

/** The dummy payload byte sequence authored into security/vba-sample.docx. */
const VBA_PAYLOAD = 'VBAProject (dummy)';

describe('security — macros are note-and-skip, never executed or decoded', () => {
  it('parses the macro-bearing vba-sample.docx as a valid document', () => {
    const doc = parseDocument(fixture('security/vba-sample.docx'));
    expect(doc.blocks.length).toBeGreaterThan(0);
    expect(doc.security).toBeDefined();
    expect(doc.security!.macrosPresent).toBe(true);
  });

  it('never decodes the vbaProject.bin bytes into the model', () => {
    const doc = parseDocument(fixture('security/vba-sample.docx'));
    const serialized = JSON.stringify(doc);
    // The payload byte sequence must not appear anywhere — no block text, no
    // metadata, no source map. If the reader ever "executed" (decoded) the
    // macro part, its bytes would leak into the model. (The word "vbaProject"
    // itself DOES appear — it is part of the fixture's own visible body text
    // and of the part path used for flagging; only the binary payload must
    // stay opaque.)
    expect(serialized).not.toContain(VBA_PAYLOAD);
    expect(doc.metadata.title).toBe('Macro-bearing sample (note-and-skip)');
  });

  it('flags a vba part by path for ANY valid package', () => {
    // Re-confirm path-based detection on the real fixture bytes: the part
    // name word/vbaProject.bin triggers the flag even though nothing reads it.
    const doc = parseDocument(fixture('security/vba-sample.docx'));
    expect(doc.security!.macrosPresent).toBe(true);
    expect(doc.security!.remoteTargets).toBeDefined();
  });
});

describe('security — external relationship targets recorded, never followed', () => {
  it('records the two remote targets of vba-sample.docx first-seen', () => {
    const doc = parseDocument(fixture('security/vba-sample.docx'));
    expect(doc.security!.remoteTargets).toEqual([
      'https://evil.example/macro.dotm',
      '\\\\nas.example\\share\\template.dotx',
    ]);
  });

  it('parses to completion (no fetch/eval code path exists)', () => {
    // The only outputs of parseDocument are the model fields; there is no
    // network client, no eval, no dynamic import in the reader stack. This
    // test locks that parsing the hostile-rels fixture terminates with the
    // expected model and nothing else.
    const doc = parseDocument(fixture('security/vba-sample.docx'));
    expect(doc.citations).toEqual([]);
    expect(doc.sourceMap.version).toBe(1);
  });

  it('records no remote targets for a benign document (clean model)', () => {
    const doc = parseDocument(fixture('minimal.docx'));
    expect(doc.security).toBeUndefined(); // nothing flagged -> section absent
  });
});

describe('security — XML string cap (XML_STRING_MAX) enforced', () => {
  it('throws a typed ZipBombError for an oversized decoded part', () => {
    // Build the parts map directly (bypassing the zip layer, which has its
    // own DOCX_ENTRY_MAX guard) so the XML cap is the ONLY limit in play.
    // 64 MiB + 1 chars of 'a' — a string that would OOM naive parsers.
    const oversized = new Uint8Array(XML_STRING_MAX + 1).fill(0x61); // 'a'
    const parts = new Map<string, Uint8Array>([
      ['[Content_Types].xml', new TextEncoder().encode('<Types/>')],
      ['word/document.xml', oversized],
    ]);

    let detail = '';
    try {
      buildModel(parts);
      expect.unreachable('buildModel should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ZipBombError);
      detail = (err as ZipBombError).detail;
    }
    expect(detail).toContain('word/document.xml');
    expect(detail).toContain('XML_STRING_MAX');
  });

  it('accepts a part exactly at the cap (exclusive bound semantics)', () => {
    // XML_STRING_MAX chars is NOT > XML_STRING_MAX, so a pathological but
    // exactly-at-cap part must not be rejected by the cap. The part is not
    // valid OOXML markup (all 'a's), so the model still parses it via the
    // failure-isolated path — the point is the cap itself does not false-trip.
    const atCap = new Uint8Array(XML_STRING_MAX).fill(0x61); // 'a'
    const parts = new Map<string, Uint8Array>([
      ['[Content_Types].xml', new TextEncoder().encode('<Types/>')],
      ['word/document.xml', atCap],
    ]);
    expect(() => buildModel(parts)).not.toThrow(ZipBombError);
  });
});

describe('security — bad samples fail with typed errors, never hang', () => {
  it('rejects the zip bomb before any decompression (ZipBombError)', () => {
    // The committed bomb declares 60 MiB > DOCX_ENTRY_MAX with a ~2 KiB real
    // payload. A decompress-first reader would OOM or choke on corrupt data;
    // the filter must reject the entry up front. Vitest's default test
    // timeout is the hang guard.
    expect(() => parseDocument(fixture('security/zip-bomb.docx'))).toThrow(ZipBombError);
  });

  it('rejects truncated / not-a-docx / garbage input with NotADocxError', () => {
    expect(() => parseDocument(fixture('security/truncated.docx'))).toThrow(NotADocxError);
    expect(() => parseDocument(fixture('security/not-a-docx.zip'))).toThrow(NotADocxError);
    expect(() => parseDocument(fixture('security/garbage.docx'))).toThrow(NotADocxError);
  });

  it('never crashes with an untyped error on hostile input', () => {
    for (const rel of [
      'security/zip-bomb.docx',
      'security/lying-bomb.docx',
      'security/truncated.docx',
      'security/not-a-docx.zip',
      'security/garbage.docx',
    ]) {
      let threwTyped = false;
      try {
        parseDocument(fixture(rel));
      } catch (err) {
        threwTyped =
          err instanceof ZipBombError ||
          err instanceof NotADocxError;
        expect(err, rel).toBeInstanceOf(Error);
      }
      expect(threwTyped, rel).toBe(true);
    }
  });
});

describe('security — lying-declaration decompression bombs (S01-T9)', () => {
  it('rejects the committed lying bomb (declared 100 B, inflates to 60 MiB) with ZipBombError', () => {
    // The entry's central-directory record declares 100 bytes uncompressed
    // while its real deflate stream expands to 60 MiB — fflate's sync unzip
    // would silently truncate to the declared 100 bytes (MEM007), so only
    // actual-output enforcement can reject it. The fixture file itself is
    // ~62 KiB (a true bomb, not a large file).
    expect(() => parseDocument(fixture('security/lying-bomb.docx'))).toThrow(ZipBombError);
  });

  it('rejects within a bounded wall-clock budget (no hang, no OOM)', () => {
    const started = performance.now();
    expect(() => parseDocument(fixture('security/lying-bomb.docx'))).toThrow(ZipBombError);
    // The reader aborts as soon as ACTUAL bytes breach a cap (here the
    // declared-vs-actual mismatch trips on the first feed chunk, well below
    // the 60 MiB expansion). 10 s is a generous no-hang bound — a naive
    // decompress-first reader would materialise 60 MiB+ and run far longer.
    expect(performance.now() - started).toBeLessThan(10_000);
  });

  it('carries a diagnostic detail naming the lying entry and the breach', () => {
    try {
      parseDocument(fixture('security/lying-bomb.docx'));
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ZipBombError);
      const e = err as ZipBombError;
      expect(e.detail).toContain('word/lying.bin');
      expect(e.detail).toMatch(/DOCX_ENTRY_MAX|declared-vs-actual mismatch/);
    }
  });
});

describe('security — determinism of security notes (R008)', () => {
  it('produces identical security info for identical bytes', () => {
    const bytes = fixture('security/vba-sample.docx');
    const a = parseDocument(bytes).security;
    const b = parseDocument(bytes).security;
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
