/**
 * M002-S03-T2 — determinism verification (R008) through the PUBLIC API:
 * same bytes → byte-identical issue report, always.
 *
 * "Byte-identical" here means the strictest observable claim available to a
 * consumer: `JSON.stringify(report)` (issues + doc + ruleIds, insertion
 * order included) is `===` across runs — in-process AND across separate
 * `node` processes. No randomness, no clock, no global state, no Map/Set
 * serialization traps (the report is plain data).
 *
 * Scenarios:
 *   - the plain pass over several fixtures (minimal, author-date/simple,
 *     numeric/out-of-range) — full report byte-identical across 3 runs;
 *   - pass options (segment enabled + severityOverrides + customRules) —
 *     byte-identical;
 *   - input representation (Uint8Array vs ArrayBuffer view of the same
 *     bytes) and doc-path vs bytes-path — identical issue JSON;
 *   - CROSS-PROCESS: two separate `node` processes running the same script
 *     emit byte-identical stdout;
 *   - failure determinism: garbage bytes throw the same typed error on every
 *     run (deterministic error family + message, never a raw crash).
 *
 * Fixtures are git-tracked committed files under fixtures/.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { NotADocxError } from '@citesync/docx';
import { createRule, lintDocument } from '@citesync/core';
import type { LintDocumentOptions, Rule } from '@citesync/core';

const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const MINIMAL = readFileSync(`${FIXTURES_DIR}minimal.docx`);
const SIMPLE = readFileSync(`${FIXTURES_DIR}author-date/simple.docx`);
const OUT_OF_RANGE = readFileSync(`${FIXTURES_DIR}numeric/out-of-range.docx`);
const GARBAGE = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

/** A custom rule that participates in the determinism scenarios. */
const customProbe: Rule = createRule({
  id: 'CS900',
  severity: 'INFO',
  run: (ctx) =>
    ctx.doc.blocks.map((block, i) => ({
      id: `CS900:${i}`,
      ruleId: 'CS900',
      severity: 'INFO' as const,
      message: `probe ${block.id}`,
      evidence: [],
      sourceLoc: { blockId: block.id },
    })),
});

/** Run the public API three times and assert every serialization is byte-identical. */
function expectByteIdenticalRuns(fn: () => unknown): void {
  const serialized = [fn(), fn(), fn()].map((result) => JSON.stringify(result));
  expect(serialized[1]).toBe(serialized[0]);
  expect(serialized[2]).toBe(serialized[0]);
}

describe('determinism — plain pass over fixtures (full report, byte-identical)', () => {
  it('minimal.docx: full report byte-identical across runs', () => {
    expectByteIdenticalRuns(() => lintDocument(MINIMAL));
  });

  it('author-date/simple.docx (4 built-in issues): full report byte-identical', () => {
    expectByteIdenticalRuns(() => lintDocument(SIMPLE));
    expect(lintDocument(SIMPLE).issues).toHaveLength(4);
  });

  it('numeric/out-of-range.docx (2 CS008 issues): full report byte-identical', () => {
    expectByteIdenticalRuns(() => lintDocument(OUT_OF_RANGE));
    const issues = lintDocument(OUT_OF_RANGE).issues;
    expect(issues.every((issue) => issue.ruleId === 'CS008')).toBe(true);
  });

  it('ruleIds are stable and sorted (inspectable determinism surface)', () => {
    const first = lintDocument(MINIMAL);
    const second = lintDocument(MINIMAL);
    expect([...first.ruleIds]).toEqual([...second.ruleIds]);
    expect([...first.ruleIds]).toEqual([...first.ruleIds].sort());
  });
});

describe('determinism — pass options and input representations', () => {
  it('enabled segments + severityOverrides: byte-identical', () => {
    const options: LintDocumentOptions = {
      enabled: ['author-date', 'numeric'],
      severityOverrides: { CS001: 'info', CS008: 'warning' },
    };
    expectByteIdenticalRuns(() => lintDocument(SIMPLE, options));
    expectByteIdenticalRuns(() => lintDocument(OUT_OF_RANGE, options));
  });

  it('custom rules + overrides: byte-identical merged report', () => {
    const options: LintDocumentOptions = {
      customRules: [customProbe],
      severityOverrides: { CS900: 'error' },
    };
    expectByteIdenticalRuns(() => lintDocument(SIMPLE, options));
    const report = lintDocument(SIMPLE, options);
    expect(report.issues.find((issue) => issue.ruleId === 'CS900')?.severity).toBe('ERROR');
  });

  it('Uint8Array vs ArrayBuffer view of the same bytes: identical issue JSON', () => {
    const buffer = MINIMAL.buffer.slice(MINIMAL.byteOffset, MINIMAL.byteOffset + MINIMAL.byteLength);
    expect(JSON.stringify(lintDocument(MINIMAL).issues)).toBe(
      JSON.stringify(lintDocument(buffer).issues),
    );
  });

  it('doc-path vs bytes-path: identical issue JSON (parse is not re-run differently)', () => {
    const fromBytes = lintDocument(MINIMAL);
    const fromDoc = lintDocument(fromBytes.doc);
    expect(JSON.stringify(fromBytes.issues)).toBe(JSON.stringify(fromDoc.issues));
    expect(JSON.stringify(fromBytes.ruleIds)).toBe(JSON.stringify(fromDoc.ruleIds));
  });
});

describe('determinism — cross-process (two independent node processes)', () => {
  it('emit byte-identical stdout for the same input bytes', () => {
    const script = `
      import { readFileSync } from 'node:fs';
      import { lintDocument } from '@citesync/core';
      const report = lintDocument(readFileSync('fixtures/author-date/simple.docx'));
      process.stdout.write(JSON.stringify(report));
    `;
    const run = () =>
      execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
      });
    const first = run();
    const second = run();
    expect(first).toBe(second);
    expect(first.length).toBeGreaterThan(1000); // the report is real, not empty
  });
});

describe('determinism — failure paths throw identically every run', () => {
  it('garbage bytes throw the same typed NotADocxError every time (never a raw crash)', () => {
    const capture = () => {
      try {
        lintDocument(GARBAGE);
        return { threw: false as const };
      } catch (error) {
        return {
          threw: true as const,
          name: error instanceof Error ? error.constructor.name : typeof error,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    };
    const first = capture();
    const second = capture();
    expect(first.threw).toBe(true);
    expect(first.name).toBe(NotADocxError.name);
    expect(second).toEqual(first); // same error family + same message
  });
});
