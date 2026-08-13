/**
 * @citesync/cli — DETERMINISM tests (T2, R008): same input → byte-identical
 * output, every time, through the REAL CLI pipeline.
 *
 * What this suite proves:
 *   - JSON output is byte-identical across many consecutive runs for every
 *     fixture class (clean, consistency errors, parse failure, missing file,
 *     unsupported document) — including failure reports, whose error text
 *     must also be deterministic.
 *   - The rendered default/detailed modes (derived from the JSON single
 *     source of truth) are byte-stable too.
 *   - Cross-process determinism: spawning the built bin twice yields
 *     byte-identical stdout — no per-process state, locale, or timing can
 *     leak into the report.
 *   - Deterministic internals: counts always carry all four severity keys in
 *     SEVERITY_ORDER; issue ids are stable across runs; `meta.ruleIds` is
 *     sorted.
 *   - Source audit: the CLI source uses no nondeterministic primitives
 *     (clocks, randomness, locale formatting, uuid) after comment stripping.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';

import { runCli } from '../src/index.js';
import { SEVERITY_ORDER } from '../src/report.js';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const FIXTURES = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
const CLI_DIST = fileURLToPath(new URL('../dist/index.js', import.meta.url));

const MINIMAL = join(FIXTURES, 'minimal.docx'); // 1 ERROR -> exit 1
const CLEAN = join(FIXTURES, 'bibliography/en-references.docx'); // 0 issues -> exit 0
const GARBAGE = join(FIXTURES, 'security/garbage.docx'); // NotADocxError -> exit 2
const TRUNCATED = join(FIXTURES, 'security/truncated.docx'); // NotADocxError -> exit 2
const ZIP_BOMB = join(FIXTURES, 'security/zip-bomb.docx'); // ZipBombError -> exit 2
const MISSING = join(FIXTURES, 'does-not-exist.docx'); // ENOENT -> exit 2

/** All success+failure fixture classes the determinism suite exercises. */
const FIXTURE_CLASSES = [CLEAN, MINIMAL, GARBAGE, TRUNCATED, ZIP_BOMB, MISSING] as const;

/** Build a real DOCX whose zip method is patched to 99 → UnsupportedFormatError (exit 3). */
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
  const cdOffset = buf[eocd + 16]! | (buf[eocd + 17]! << 8) | (buf[eocd + 18]! << 16) | (buf[eocd + 19]! << 24);
  buf[cdOffset + 10] = 99;
  buf[cdOffset + 11] = 0;
  buf[8] = 99;
  buf[9] = 0;
  const dir = mkdtempSync(join(tmpdir(), 'citesync-determinism-unsupported-'));
  const path = join(dir, 'unsupported.docx');
  writeFileSync(path, buf);
  return path;
}

describe('JSON byte-stability — many consecutive runs, every fixture class (R008)', () => {
  it('5 consecutive runs produce byte-identical JSON for each class', () => {
    const unsupported = buildUnsupportedDocx();
    for (const fixture of [...FIXTURE_CLASSES, unsupported]) {
      const first = runCli([fixture, '-j']).stdout;
      for (let i = 1; i < 5; i++) {
        expect(runCli([fixture, '-j']).stdout, `run ${i + 1} of ${fixture}`).toBe(first);
      }
    }
  });

  it('failure JSON error text is deterministic (parse-failure, file-not-found, unsupported)', () => {
    const unsupported = buildUnsupportedDocx();
    for (const fixture of [GARBAGE, MISSING, unsupported]) {
      const a = runCli([fixture, '-j']).stdout;
      const b = runCli([fixture, '-j']).stdout;
      expect(a).toBe(b);
      expect(a).toContain('"error"');
    }
  });
});

describe('rendered modes are byte-stable (derived from the JSON source of truth)', () => {
  it('default and detailed outputs are byte-identical across re-runs', () => {
    for (const fixture of [CLEAN, MINIMAL]) {
      const firstDefault = runCli([fixture]).stdout;
      const firstDetailed = runCli([fixture, '-d']).stdout;
      for (let i = 1; i < 4; i++) {
        expect(runCli([fixture]).stdout, `default run ${i + 1} of ${fixture}`).toBe(firstDefault);
        expect(runCli([fixture, '-d']).stdout, `detailed run ${i + 1} of ${fixture}`).toBe(firstDetailed);
      }
    }
  });
});

describe('cross-process determinism — the built bin yields identical bytes every process', () => {
  it('two spawned processes produce byte-identical JSON for success and failure runs', () => {
    for (const fixture of [CLEAN, MINIMAL, GARBAGE]) {
      const args = [CLI_DIST, fixture, '-j'];
      const first = spawnSync(process.execPath, args, { encoding: 'utf8' });
      const second = spawnSync(process.execPath, args, { encoding: 'utf8' });
      expect(first.status).toBe(second.status);
      expect(first.stdout, `spawned stdout for ${fixture}`).toBe(second.stdout);
      expect(first.stderr).toBe(second.stderr);
      expect(first.stdout.length).toBeGreaterThan(0);
    }
  });
});

describe('deterministic internals across runs', () => {
  it('counts always carry all four severity keys in SEVERITY_ORDER', () => {
    for (const fixture of [CLEAN, MINIMAL]) {
      for (let i = 0; i < 3; i++) {
        const report = JSON.parse(runCli([fixture, '-j']).stdout) as {
          counts: Record<string, number>;
          issues: Array<{ id: string; severity: string }>;
        };
        expect(Object.keys(report.counts)).toEqual([...SEVERITY_ORDER]);
        for (const value of Object.values(report.counts)) expect(value).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('issue ids are stable across runs (same ids, same order)', () => {
    const idsOf = (fixture: string): string[] =>
      (JSON.parse(runCli([fixture, '-j']).stdout) as { issues: Array<{ id: string }> }).issues.map(
        (issue) => issue.id,
      );
    const first = idsOf(MINIMAL);
    expect(first).toEqual(['CS001:0']);
    for (let i = 1; i < 4; i++) expect(idsOf(MINIMAL)).toEqual(first);
  });

  it('meta.ruleIds is sorted and identical across runs', () => {
    const ruleIdsOf = (fixture: string): string[] =>
      (JSON.parse(runCli([fixture, '-j']).stdout) as { meta: { ruleIds: string[] } }).meta.ruleIds;
    for (const fixture of [CLEAN, MINIMAL]) {
      const ids = ruleIdsOf(fixture);
      expect([...ids].sort()).toEqual(ids);
      for (let i = 1; i < 3; i++) expect(ruleIdsOf(fixture)).toEqual(ids);
    }
  });
});

describe('source audit — no nondeterministic primitives in CLI src (R008)', () => {
  it('CLI source uses no clocks, randomness, locale formatting or uuid after comment stripping', () => {
    const srcDir = join(REPO_ROOT, 'packages/cli/src');
    const files = readdirSync(srcDir).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(join(srcDir, file), 'utf8');
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      expect(code, `${file}: no Date.now`).not.toMatch(/Date\.now\s*\(/);
      expect(code, `${file}: no Math.random`).not.toMatch(/Math\.random\s*\(/);
      expect(code, `${file}: no new Date`).not.toMatch(/new\s+Date\s*\(/);
      expect(code, `${file}: no locale formatting`).not.toMatch(/\.toLocale(Time)?String\s*\(/);
      expect(code, `${file}: no crypto/hrtime/performance clocks`).not.toMatch(
        /(crypto\.|process\.hrtime|performance\.now)/,
      );
      expect(code, `${file}: no uuid/nanoid`).not.toMatch(/\b(uuid|nanoid|crypto\.randomUUID)\b/);
    }
  });
});
