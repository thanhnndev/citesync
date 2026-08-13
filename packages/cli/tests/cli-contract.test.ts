/**
 * @citesync/cli — CLI CONTRACT tests (T2): the frozen canonical JSON schema
 * (R014) + the R010 exit-code matrix, all verified through the REAL surface
 * (`runCli`: real fs + real @citesync/core lintDocument + real rendering).
 *
 * What this suite freezes:
 *   - The schema DOCUMENT itself (`cliReportSchema`): plain JSON-serializable,
 *     `additionalProperties: false` at every object level, `required` arrays
 *     in canonical order, severity enum bound to SEVERITY_ORDER, version const
 *     bound to REPORT_VERSION.
 *   - The exit-code matrix 0/1/2/3: every emitted JSON (success AND failure)
 *     validates against the schema; `error.code` maps to the fixture class.
 *   - The emitted JSON property ORDER matches the schema's canonical order.
 *   - `issues` in the JSON are the S03 `lintDocument` output VERBATIM (deep
 *     equality) — M003 export consumes the report as-is, no reshaping (R014).
 *   - Byte-stability across re-runs at contract level (R008).
 *
 * Fixtures are git-tracked files under fixtures/; the unsupported-document
 * sample is built inline (real DOCX zip with compression method patched to
 * 99 → UnsupportedFormatError, exit 3).
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';

import { lintDocument } from '@citesync/core';

import { runCli } from '../src/index.js';
import type { CliOutcome } from '../src/index.js';
import {
  CLI_REPORT_SCHEMA_ID,
  REPORT_ERROR_CODES,
  cliReportSchema,
  validateReport,
} from '../src/json-schema.js';
import type { CliJsonSchemaNode, CliJsonSchemaObject } from '../src/json-schema.js';
import { REPORT_VERSION, SEVERITY_ORDER } from '../src/report.js';

const FIXTURES = fileURLToPath(new URL('../../../fixtures/', import.meta.url));

const MINIMAL = join(FIXTURES, 'minimal.docx'); // 1 ERROR (CS001 missing reference)
const CLEAN = join(FIXTURES, 'bibliography/en-references.docx'); // 0 issues
const GARBAGE = join(FIXTURES, 'security/garbage.docx'); // NotADocxError -> 2
const TRUNCATED = join(FIXTURES, 'security/truncated.docx'); // NotADocxError -> 2
const ZIP_BOMB = join(FIXTURES, 'security/zip-bomb.docx'); // ZipBombError -> 2
const MISSING = join(FIXTURES, 'does-not-exist.docx'); // ENOENT -> 2

/** Run the CLI in --json mode and return the report ONLY after schema validation. */
function validatedReport(out: CliOutcome): ReturnType<typeof JSON.parse> {
  const result = validateReport(out.stdout);
  if (!result.valid) {
    throw new Error(`report failed schema validation:\n${result.errors.join('\n')}`);
  }
  return result.report as ReturnType<typeof JSON.parse>;
}

/**
 * Build a REAL minimal DOCX zip whose compression method is patched to 99 in
 * both the central directory and the local file header — the reader must
 * raise UnsupportedFormatError (exit 3). Written to a fresh temp dir
 * (generated input, never a committed fixture).
 */
function buildUnsupportedDocx(): string {
  const bytes = zipSync(
    {
      '[Content_Types].xml': strToU8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
      'word/document.xml': strToU8(
        '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>',
      ),
      '_rels/.rels': strToU8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
    },
    { level: 6 },
  );
  const buf = new Uint8Array(bytes);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
      eocd = i;
      break;
    }
  }
  expect(eocd).toBeGreaterThanOrEqual(0);
  const cdOffset = buf[eocd + 16]! | (buf[eocd + 17]! << 8) | (buf[eocd + 18]! << 16) | (buf[eocd + 19]! << 24);
  expect(buf[cdOffset + 10]).toBe(8); // deflate before patch
  buf[cdOffset + 10] = 99;
  buf[cdOffset + 11] = 0;
  expect(buf[8]).toBe(8);
  buf[8] = 99;
  buf[9] = 0;
  const dir = mkdtempSync(join(tmpdir(), 'citesync-contract-unsupported-'));
  const path = join(dir, 'unsupported.docx');
  writeFileSync(path, buf);
  return path;
}

/** Recursively collect every object node in the schema (for the freeze audit). */
function collectObjectNodes(node: CliJsonSchemaNode, out: CliJsonSchemaObject[]): void {
  if (node.type === 'object') {
    out.push(node);
    for (const sub of Object.values(node.properties ?? {})) collectObjectNodes(sub, out);
  } else if (node.type === 'array' && node.items !== undefined) {
    collectObjectNodes(node.items, out);
  }
}

describe('the frozen schema document itself (R014)', () => {
  it('is plain JSON-serializable — M003 can embed/cache it directly', () => {
    expect(JSON.parse(JSON.stringify(cliReportSchema))).toEqual(cliReportSchema);
  });

  it('carries a stable schema id + draft 2020-12 annotation', () => {
    expect(cliReportSchema.$id).toBe(CLI_REPORT_SCHEMA_ID);
    expect(cliReportSchema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
  });

  it('freezes the canonical property ORDER (report → meta → issues → counts → error)', () => {
    expect(cliReportSchema.required).toEqual(['version', 'meta', 'issues', 'counts']);
    expect(cliReportSchema.properties.meta.required).toEqual(['file', 'citations', 'references', 'ruleIds']);
    expect(cliReportSchema.properties.counts.required).toEqual([...SEVERITY_ORDER]);
    expect(cliReportSchema.properties.issues.items.required).toEqual([
      'id',
      'ruleId',
      'severity',
      'message',
      'evidence',
      'sourceLoc',
    ]);
    expect(cliReportSchema.properties.issues.items.properties.evidence.items.required).toEqual([
      'code',
      'message',
      'source',
    ]);
    expect(cliReportSchema.properties.issues.items.properties.sourceLoc.required).toEqual(['blockId']);
    expect(cliReportSchema.properties.error.required).toEqual(['code', 'message']);
  });

  it('locks version const, severity enum and error-code enum to the TS contract', () => {
    expect(cliReportSchema.properties.version.const).toBe(REPORT_VERSION);
    expect(cliReportSchema.properties.issues.items.properties.severity.enum).toEqual([...SEVERITY_ORDER]);
    expect(cliReportSchema.properties.counts.required).toEqual([...SEVERITY_ORDER]);
    expect(cliReportSchema.properties.error.properties.code.enum).toEqual(REPORT_ERROR_CODES);
    expect(REPORT_ERROR_CODES).toEqual(['parse-failure', 'unsupported-document', 'file-not-found', 'usage']);
  });

  it('freezes every object level with additionalProperties: false and non-empty required', () => {
    const objects: CliJsonSchemaObject[] = [];
    collectObjectNodes(cliReportSchema, objects);
    expect(objects.length).toBeGreaterThanOrEqual(6); // report/meta/counts/issue/evidence/sourceLoc/error
    for (const node of objects) {
      expect(node.additionalProperties, `additionalProperties:false at ${node.title ?? 'object node'}`).toBe(false);
      expect(node.required?.length ?? 0, 'every object node declares required keys').toBeGreaterThan(0);
    }
  });
});

describe('exit-code matrix 0/1/2/3 — emitted JSON always validates (R010/R014)', () => {
  it('exit 0 (clean): no error key, zero counts, empty issues', () => {
    const out = runCli([CLEAN, '--json']);
    expect(out.exitCode).toBe(0);
    const report = validatedReport(out);
    expect(report).not.toHaveProperty('error');
    expect(report.version).toBe(REPORT_VERSION);
    expect(report.meta).toEqual({ file: 'en-references.docx', citations: 6, references: 3, ruleIds: expect.any(Array) });
    expect(report.counts).toEqual({ ERROR: 0, WARNING: 0, AMBIGUOUS: 0, INFO: 0 });
    expect(report.issues).toEqual([]);
  });

  it('exit 1 (consistency errors): counts reflect the issues; issue carries source evidence', () => {
    const out = runCli([MINIMAL, '-j']);
    expect(out.exitCode).toBe(1);
    const report = validatedReport(out);
    expect(report.counts).toEqual({ ERROR: 1, WARNING: 0, AMBIGUOUS: 0, INFO: 0 });
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]).toMatchObject({
      id: 'CS001:0',
      ruleId: 'CS001',
      severity: 'ERROR',
    });
    expect(report.issues[0].evidence).toHaveLength(1);
    expect(report.issues[0].evidence[0]).toMatchObject({ code: 'no-entry' });
    expect(report.issues[0].sourceLoc.blockId).toEqual(expect.any(String));
  });

  it('exit 2 (parse failure): same schema, issues empty, error.code parse-failure', () => {
    for (const fixture of [GARBAGE, TRUNCATED, ZIP_BOMB]) {
      const out = runCli([fixture, '-j']);
      expect(out.exitCode).toBe(2);
      const report = validatedReport(out);
      expect(report).toMatchObject({
        version: REPORT_VERSION,
        issues: [],
        counts: { ERROR: 0, WARNING: 0, AMBIGUOUS: 0, INFO: 0 },
        error: { code: 'parse-failure' },
      });
      expect(typeof report.error.message).toBe('string');
    }
  });

  it('exit 2 (file not found): error.code file-not-found', () => {
    const out = runCli([MISSING, '-j']);
    expect(out.exitCode).toBe(2);
    const report = validatedReport(out);
    expect(report.error).toMatchObject({ code: 'file-not-found' });
  });

  it('exit 3 (unsupported document): error.code unsupported-document', () => {
    const path = buildUnsupportedDocx();
    const out = runCli([path, '-j']);
    expect(out.exitCode).toBe(3);
    const report = validatedReport(out);
    expect(report).toMatchObject({ issues: [], counts: { ERROR: 0, WARNING: 0, AMBIGUOUS: 0, INFO: 0 } });
    expect(report.error).toMatchObject({ code: 'unsupported-document' });
  });

  it('usage is stderr-only today — conflicting flags in json mode emit NO JSON', () => {
    const out = runCli([MINIMAL, '-d', '-j']);
    expect(out.exitCode).toBe(2);
    expect(out.stdout).toBe('');
    expect(out.stderr).toContain('conflicting output mode flags');
  });
});

describe('emitted JSON property ORDER matches the frozen schema order', () => {
  it('success report: version → meta → issues → counts (no error key)', () => {
    const report = validatedReport(runCli([MINIMAL, '-j']));
    expect(Object.keys(report)).toEqual(['version', 'meta', 'issues', 'counts']);
    expect(Object.keys(report.meta)).toEqual(['file', 'citations', 'references', 'ruleIds']);
    expect(Object.keys(report.counts)).toEqual([...SEVERITY_ORDER]);
  });

  it('failure report: same order with error appended last', () => {
    const report = validatedReport(runCli([GARBAGE, '-j']));
    expect(Object.keys(report)).toEqual(['version', 'meta', 'issues', 'counts', 'error']);
  });

  it('issue: id → ruleId → severity → message → evidence → sourceLoc (frozen S02 shape)', () => {
    const report = validatedReport(runCli([MINIMAL, '-j']));
    expect(Object.keys(report.issues[0])).toEqual([
      'id',
      'ruleId',
      'severity',
      'message',
      'evidence',
      'sourceLoc',
    ]);
    expect(Object.keys(report.issues[0].evidence[0])).toEqual(['code', 'message', 'source']);
  });
});

describe('JSON issues are the S03 lintDocument output VERBATIM (M003 as-is reuse)', () => {
  it('clean document: empty JSON issues equal empty lintDocument issues', () => {
    const report = validatedReport(runCli([CLEAN, '-j']));
    const lint = lintDocument(readFileSync(CLEAN));
    expect(report.issues).toEqual(lint.issues);
  });

  it('minimal document: JSON issues deep-equal lintDocument(bytes).issues — no enrichment, no reshaping', () => {
    const report = validatedReport(runCli([MINIMAL, '-j']));
    const lint = lintDocument(readFileSync(MINIMAL));
    expect(report.issues).toEqual(lint.issues);
    // ruleIds in the JSON meta must equal the S03 ruleIds (inspectable set).
    expect(report.meta.ruleIds).toEqual([...lint.ruleIds]);
  });

  it('counts are exactly recountable from the JSON issues', () => {
    const report = validatedReport(runCli([MINIMAL, '-j']));
    const recount: Record<string, number> = { ERROR: 0, WARNING: 0, AMBIGUOUS: 0, INFO: 0 };
    for (const issue of report.issues) recount[issue.severity] += 1;
    expect(report.counts).toEqual(recount);
  });
});

describe('byte-stability across re-runs — contract level (R008)', () => {
  it('identical JSON bytes for every fixture class on repeated runs', () => {
    for (const fixture of [CLEAN, MINIMAL, GARBAGE, TRUNCATED, ZIP_BOMB]) {
      const a = runCli([fixture, '-j']).stdout;
      const b = runCli([fixture, '-j']).stdout;
      expect(a, `byte-stable for ${fixture}`).toBe(b);
    }
  });
});

describe('the validator enforces the freeze (rejects tampered reports)', () => {
  const good = () => validatedReport(runCli([MINIMAL, '-j']));

  it('rejects an extra top-level property', () => {
    expect(validateReport({ ...good(), extra: 1 })).toMatchObject({ valid: false });
  });

  it('rejects a missing counts block', () => {
    const { counts, ...rest } = good();
    void counts;
    expect(validateReport(rest)).toMatchObject({ valid: false });
  });

  it('rejects a severity outside the frozen enum', () => {
    const bad = JSON.parse(JSON.stringify(good())) as { issues: Array<Record<string, unknown>> };
    bad.issues[0]!.severity = 'CRITICAL';
    expect(validateReport(bad)).toMatchObject({ valid: false });
  });

  it('rejects a version bump', () => {
    expect(validateReport({ ...good(), version: 2 })).toMatchObject({ valid: false });
  });

  it('rejects an unknown error code', () => {
    expect(validateReport({ ...good(), error: { code: 'exploded', message: 'x' } })).toMatchObject({
      valid: false,
    });
  });

  it('rejects an extra issue field (shape freeze)', () => {
    const bad = JSON.parse(JSON.stringify(good())) as { issues: Array<Record<string, unknown>> };
    bad.issues[0]!.llmNote = 'not part of the contract';
    expect(validateReport(bad)).toMatchObject({ valid: false });
  });

  it('rejects malformed JSON text and non-object roots', () => {
    expect(validateReport('{not json')).toMatchObject({ valid: false });
    expect(validateReport('42')).toMatchObject({ valid: false });
    expect(validateReport(null)).toMatchObject({ valid: false });
  });
});
