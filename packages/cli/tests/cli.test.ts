/**
 * @citesync/cli — end-to-end CLI tests (T1: exit codes + output modes, R010).
 *
 * Exercises the REAL surface end to end:
 *   - `runCli` (imported from src) performs real fs reads + real
 *     `@citesync/core` lintDocument + real rendering — no mocks;
 *   - one spawned `node dist/index.js` run proves the built bin wiring
 *     (shebang, main-guard, process exit code);
 *   - a no-DOM / no-parser / dependency audit on the CLI source proves core
 *     portability (CLI consumes @citesync/core only — never @citesync/docx).
 *
 * Fixtures are git-tracked files under fixtures/ (existing corpus); the
 * unsupported-document sample is built inline in this test (a real DOCX zip
 * with the compression method patched to 99 so the reader raises
 * UnsupportedFormatError — exit 3).
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';

import { runCli, classifyError, exitCodeForFailure } from '../src/index.js';
import { REPORT_VERSION } from '../src/report.js';
import { renderDetailed, renderDefault, renderUsage } from '../src/render.js';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const FIXTURES = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
const CLI_DIST = fileURLToPath(new URL('../dist/index.js', import.meta.url));

const MINIMAL = join(FIXTURES, 'minimal.docx'); // 1 ERROR (CS001 missing reference)
const CLEAN = join(FIXTURES, 'bibliography/en-references.docx'); // 0 issues
const GARBAGE = join(FIXTURES, 'security/garbage.docx'); // NotADocxError -> 2
const TRUNCATED = join(FIXTURES, 'security/truncated.docx'); // NotADocxError -> 2
const ZIP_BOMB = join(FIXTURES, 'security/zip-bomb.docx'); // ZipBombError -> 2

/** Assert every issue in a parsed JSON report satisfies the frozen S02 shape. */
function expectIssueShape(issue: Record<string, unknown>): void {
  expect(typeof issue.id).toBe('string');
  expect(typeof issue.ruleId).toBe('string');
  expect(['ERROR', 'WARNING', 'AMBIGUOUS', 'INFO']).toContain(issue.severity);
  expect(typeof issue.message).toBe('string');
  expect(Array.isArray(issue.evidence)).toBe(true);
  expect(issue.sourceLoc).toMatchObject({ blockId: expect.any(String) });
}

/**
 * Build a REAL minimal DOCX zip whose compression method is patched to 99
 * (neither store 0 nor deflate 8) in both the central directory and the
 * local file header — the reader must raise UnsupportedFormatError (exit 3).
 * Written to a fresh temp dir (generated input, never a committed fixture).
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
  // EOCD scan (PK\x05\x06) backward from the end.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
      eocd = i;
      break;
    }
  }
  expect(eocd).toBeGreaterThanOrEqual(0);
  const cdOffset = buf[eocd + 16]! | (buf[eocd + 17]! << 8) | (buf[eocd + 18]! << 16) | (buf[eocd + 19]! << 24);
  // Central-directory entry method at +10; local header method at +8.
  expect(buf[cdOffset + 10]).toBe(8); // deflate before patch
  buf[cdOffset + 10] = 99;
  buf[cdOffset + 11] = 0;
  expect(buf[8]).toBe(8);
  buf[8] = 99;
  buf[9] = 0;

  const dir = mkdtempSync(join(tmpdir(), 'citesync-unsupported-'));
  const path = join(dir, 'unsupported.docx');
  writeFileSync(path, buf);
  return path;
}

describe('classifyError — TimeBudgetExceededError (T3, R016 budget abort)', () => {
  it('classifies the whole-analysis time-budget abort as parse-failure (exit 2)', () => {
    // A real TimeBudgetExceededError thrown by lintDocument (D039/D043)
    // surfaces here as an Error whose name is the D021 discriminator — the
    // CLI branches on the stable name, never on instanceof.
    const err = Object.assign(new Error('budget hit'), { name: 'TimeBudgetExceededError' });
    expect(classifyError(err)).toEqual({ code: 'parse-failure', message: 'budget hit' });
    expect(exitCodeForFailure('parse-failure')).toBe(2);
  });

  it('keeps the generic fallthrough byte-identical for unknown Error names', () => {
    const err = Object.assign(new Error('mystery'), { name: 'SomeFutureError' });
    expect(classifyError(err)).toEqual({ code: 'parse-failure', message: 'mystery' });
  });
});

describe('exit code 0 — clean document (no consistency errors)', () => {
  it('default mode: exit 0 + "No consistency issues found."', () => {
    const out = runCli([CLEAN]);
    expect(out.exitCode).toBe(0);
    expect(out.stderr).toBe('');
    expect(out.stdout).toContain('No consistency issues found.');
    expect(out.stdout).toContain(`Citations: 6    References: 3`);
  });

  it('json mode: exit 0 + zero counts + empty issues + no error key', () => {
    const out = runCli([CLEAN, '--json']);
    expect(out.exitCode).toBe(0);
    const report = JSON.parse(out.stdout) as Record<string, unknown>;
    expect(report).not.toHaveProperty('error');
    expect(report).toMatchObject({
      version: REPORT_VERSION,
      meta: { file: 'en-references.docx', citations: 6, references: 3 },
      counts: { ERROR: 0, WARNING: 0, AMBIGUOUS: 0, INFO: 0 },
      issues: [],
    });
  });
});

describe('exit code 1 — consistency errors found', () => {
  it('default mode: exit 1 + severity summary table with ERROR count', () => {
    const out = runCli([MINIMAL]);
    expect(out.exitCode).toBe(1);
    expect(out.stdout).toContain('Severity   Count');
    expect(out.stdout).toContain('ERROR          1');
    expect(out.stdout).toContain('1 issue found (ERROR: 1)');
  });

  it('json mode: exit 1 + canonical report (version/meta/issues/counts)', () => {
    const out = runCli([MINIMAL, '-j']);
    expect(out.exitCode).toBe(1);
    const report = JSON.parse(out.stdout) as {
      version: number;
      meta: { file: string };
      issues: Array<Record<string, unknown>>;
      counts: Record<string, number>;
    };
    expect(report.version).toBe(REPORT_VERSION);
    expect(report.meta.file).toBe('minimal.docx');
    expect(report.counts).toEqual({ ERROR: 1, WARNING: 0, AMBIGUOUS: 0, INFO: 0 });
    expect(report.issues).toHaveLength(1);
    report.issues.forEach(expectIssueShape);
    expect(report.issues[0]).toMatchObject({
      id: 'CS001:0',
      ruleId: 'CS001',
      severity: 'ERROR',
    });
    // Source evidence is embedded in the issue (frozen S02 LintIssue shape).
    expect(report.issues[0]!.evidence).toHaveLength(1);
    expect(report.issues[0]!.evidence![0]).toMatchObject({ code: 'no-entry' });
  });

  it('detailed mode: per-issue list with source evidence', () => {
    const out = runCli([MINIMAL, '--detailed']);
    expect(out.exitCode).toBe(1);
    expect(out.stdout).toContain('1. [ERROR] CS001:0');
    expect(out.stdout).toContain('Source: doc-p1 (paragraph 1, chars 0-12)');
    expect(out.stdout).toContain('no-entry: No bibliography entry exists to match this citation.');
  });
});

describe('exit code 2 — document could not be parsed', () => {
  it('garbage bytes (NotADocxError) -> 2, diagnostic on stderr', () => {
    const out = runCli([GARBAGE]);
    expect(out.exitCode).toBe(2);
    expect(out.stdout).toBe('');
    expect(out.stderr).toContain('citesync:');
    expect(out.stderr).toContain('Not a DOCX/OOXML package');
  });

  it('truncated zip (NotADocxError) -> 2', () => {
    expect(runCli([TRUNCATED]).exitCode).toBe(2);
  });

  it('zip bomb (ZipBombError) -> 2', () => {
    expect(runCli([ZIP_BOMB]).exitCode).toBe(2);
  });

  it('missing file -> 2 with file-not-found diagnostic', () => {
    const out = runCli([join(FIXTURES, 'does-not-exist.docx')]);
    expect(out.exitCode).toBe(2);
    expect(out.stderr).toContain('file not found');
  });

  it('json mode still emits the canonical schema with error.code', () => {
    const out = runCli([GARBAGE, '-j']);
    expect(out.exitCode).toBe(2);
    const report = JSON.parse(out.stdout) as {
      issues: unknown[];
      counts: Record<string, number>;
      error: { code: string };
    };
    expect(report).toMatchObject({ issues: [], counts: { ERROR: 0, WARNING: 0, AMBIGUOUS: 0, INFO: 0 } });
    expect(report.error).toMatchObject({ code: 'parse-failure' });
    expect(out.stderr).toContain('citesync:');
  });
});

describe('exit code 3 — unsupported document', () => {
  it('unsupported compression method -> 3, diagnostic on stderr', () => {
    const path = buildUnsupportedDocx();
    const out = runCli([path]);
    expect(out.exitCode).toBe(3);
    expect(out.stdout).toBe('');
    expect(out.stderr).toContain('Unsupported DOCX format/feature');
  });

  it('json mode -> 3 with error.code unsupported-document', () => {
    const path = buildUnsupportedDocx();
    const out = runCli([path, '-j']);
    expect(out.exitCode).toBe(3);
    const report = JSON.parse(out.stdout) as { error: { code: string } };
    expect(report.error).toMatchObject({ code: 'unsupported-document' });
  });
});

describe('usage / help / version', () => {
  it('no argument -> exit 2 + usage on stderr', () => {
    const out = runCli([]);
    expect(out.exitCode).toBe(2);
    expect(out.stdout).toBe('');
    expect(out.stderr).toContain('missing required argument');
    expect(out.stderr).toContain(renderUsage());
  });

  it('conflicting flags -> exit 2', () => {
    const out = runCli([MINIMAL, '-d', '-j']);
    expect(out.exitCode).toBe(2);
    expect(out.stderr).toContain('conflicting output mode flags');
  });

  it('unknown flag -> exit 2', () => {
    expect(runCli([MINIMAL, '--bogus']).exitCode).toBe(2);
  });

  it('--help -> exit 0 + usage on stdout', () => {
    const out = runCli(['--help']);
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toBe(renderUsage());
  });

  it('--version -> exit 0 + version line', () => {
    const out = runCli(['--version']);
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toMatch(/^citesync v\d+\.\d+\.\d+\n$/);
  });
});

describe('JSON is the single source of truth (R010/R014)', () => {
  it('default renderer output is exactly derivable from the JSON report', () => {
    const jsonOut = runCli([MINIMAL, '-j']);
    const defaultOut = runCli([MINIMAL]);
    const report = JSON.parse(jsonOut.stdout) as {
      counts: Record<string, number>;
      meta: { file: string; citations: number; references: number };
    };
    const rendered = renderDefault(
      JSON.parse(jsonOut.stdout) as Parameters<typeof renderDefault>[0],
      '0.1.0',
    );
    expect(defaultOut.stdout).toBe(rendered);
    // The summary line embeds the JSON severity counts.
    expect(defaultOut.stdout).toContain(`1 issue found (ERROR: ${report.counts.ERROR})`);
  });

  it('detailed renderer output is exactly derivable from the JSON report', () => {
    const jsonOut = runCli([MINIMAL, '-j']);
    const detailedOut = runCli([MINIMAL, '-d']);
    const report = JSON.parse(jsonOut.stdout) as Parameters<typeof renderDetailed>[0];
    const rendered = renderDetailed(report, '0.1.0');
    expect(detailedOut.stdout).toBe(rendered);
    // Detailed list renders the same issues the JSON carries, in order.
    expect(detailedOut.stdout).toContain(`1. [${report.issues[0]?.severity}] ${report.issues[0]?.id}`);
  });

  it('JSON output is byte-stable across re-runs (determinism, R008)', () => {
    const a = runCli([MINIMAL, '-j']).stdout;
    const b = runCli([MINIMAL, '-j']).stdout;
    const c = runCli([CLEAN, '-j']).stdout;
    const d = runCli([CLEAN, '-j']).stdout;
    expect(a).toBe(b);
    expect(c).toBe(d);
  });
});

describe('built bin (npx citesync equivalent)', () => {
  it('spawns dist/index.js with the shebang and propagates exit code 1 + JSON', () => {
    const res = spawnSync(process.execPath, [CLI_DIST, MINIMAL, '-j'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(res.status).toBe(1); // consistency errors found (R010)
    expect(res.stderr).toBe('');
    const report = JSON.parse(res.stdout) as { counts: Record<string, number>; issues: unknown[] };
    expect(report.counts.ERROR).toBe(1);
    expect(report.issues).toHaveLength(1);
  });

  it('spawns clean document with exit code 0', () => {
    const res = spawnSync(process.execPath, [CLI_DIST, CLEAN], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(res.status).toBe(0);
    expect(res.stderr).toBe('');
    expect(res.stdout).toContain('No consistency issues found.');
  });
});

describe('core portability audit (zero DOM; @citesync/core only)', () => {
  it('package.json declares only @citesync/core as a dependency', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'packages/cli/package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      bin: Record<string, string>;
    };
    expect(pkg.dependencies).toEqual({ '@citesync/core': '0.1.0' });
    expect(pkg.bin).toEqual({ citesync: './dist/index.js' });
  });

  it('CLI source never imports the parser/reader package and has no DOM usage', () => {
    const srcDir = join(REPO_ROOT, 'packages/cli/src');
    const files = readdirSync(srcDir).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(join(srcDir, file), 'utf8');
      // Parser encapsulation (PRD §92/§93): only @citesync/core may be imported.
      expect(source).not.toMatch(/from\s+['"]@citesync\/docx['"]/);
      expect(source).not.toMatch(/from\s+['"]@citesync\/document-model['"]/);
      // Zero DOM/server/UI (R009) — comments stripped first so prose words
      // like "document." in JSDoc cannot trip the identifier check.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      expect(code).not.toMatch(/from\s+['"](react|react-dom|express|fastify|hono|jsdom|playwright)/);
      expect(code).not.toMatch(/\b(document|window|navigator|localStorage)\b\./);
    }
  });
});
