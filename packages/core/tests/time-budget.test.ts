/**
 * M004/S02-T3 — whole-analysis time budget semantics through the PUBLIC
 * lintDocument surface (D039 additive option; T2 engine; D021/D029
 * err.name discriminator family).
 *
 * The budget is a SAFETY VALVE ONLY (D039): a pathological input aborts with
 * the typed TimeBudgetExceededError instead of hanging the caller; in-budget
 * inputs stay byte-identical (R008 — the clock is never part of the output).
 * These tests drive lintDocument exactly as a consumer would and assert:
 *
 *   a. bytes input + timeBudgetMs: -1 → throws TimeBudgetExceededError
 *      (deadline already past — the FIRST coarse checkpoint aborts);
 *   b. doc input + timeBudgetMs: -1 → throws (the lint-level checkpoint
 *      before lintDocumentRules aborts — no parse runs for doc input);
 *   c. no option (default 30 s) on minimal.docx → no throw, CS001 present;
 *   d. explicit generous (30_000) → canonical report byte-identical to the
 *      default (serializeReport, D024 — budget untripped does not perturb);
 *   e. determinism: two runs with timeBudgetMs: 30_000 → byte-identical
 *      serialized reports.
 *
 * The NAME (the D021 discriminator) is asserted, not only instanceof — the
 * CLI (classifyError) and the worker (describeWorkerError) branch on the
 * string name, so it is the canonical programmatic signal.
 *
 * Fixtures are git-tracked committed files under fixtures/.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { TimeBudgetExceededError } from '@citesync/docx';
import {
  REPORT_VERSION,
  buildCliReport,
  lintDocument,
  serializeReport,
} from '@citesync/core';
import type { LintReport } from '@citesync/core';

const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
const MINIMAL = readFileSync(`${FIXTURES_DIR}minimal.docx`);

/** Capture the thrown value (asserting name on the raw error, not a matcher). */
function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected the call to throw');
}

/** Canonical report serialization (D024) — the byte contract consumers see. */
function serialize(lint: LintReport): string {
  return serializeReport(
    buildCliReport(lint.doc, lint.issues, lint.ruleIds, {
      fileName: 'minimal.docx',
      version: REPORT_VERSION,
    }),
  );
}

describe('whole-analysis time budget — bytes input (parse + lint)', () => {
  it('aborts with the typed TimeBudgetExceededError when the deadline is already past', () => {
    const err = thrownBy(() => lintDocument(MINIMAL, { timeBudgetMs: -1 }));
    expect(err).toBeInstanceOf(TimeBudgetExceededError);
    // The D021 discriminator the CLI/worker branch on — never only instanceof.
    expect((err as Error).name).toBe('TimeBudgetExceededError');
    // DocxReaderError.detail carries the checkpoint label: the FIRST coarse
    // buildModel boundary aborts for bytes input (deadline already past).
    expect((err as { detail?: string }).detail).toContain('at reading-document');
  });
});

describe('whole-analysis time budget — doc input (lint checkpoints only)', () => {
  it('aborts at the lint-level checkpoint before lintDocumentRules', () => {
    const doc = lintDocument(MINIMAL).doc;
    const err = thrownBy(() => lintDocument(doc, { timeBudgetMs: -1 }));
    expect(err).toBeInstanceOf(TimeBudgetExceededError);
    expect((err as Error).name).toBe('TimeBudgetExceededError');
    expect((err as { detail?: string }).detail).toContain('at lint rules pass');
  });
});

describe('whole-analysis time budget — in-budget runs are untouched (R008)', () => {
  it('default option (no timeBudgetMs) on minimal.docx: no throw, CS001 present', () => {
    const report = lintDocument(MINIMAL);
    expect(report.issues.length).toBeGreaterThan(0);
    expect(report.issues.some((issue) => issue.ruleId === 'CS001')).toBe(true);
  });

  it('explicit generous budget (30_000) → report byte-identical to the default', () => {
    const defaults = serialize(lintDocument(MINIMAL));
    const generous = serialize(lintDocument(MINIMAL, { timeBudgetMs: 30_000 }));
    expect(generous).toBe(defaults);
  });

  it('determinism: two runs with timeBudgetMs 30_000 are byte-identical', () => {
    const a = serialize(lintDocument(MINIMAL, { timeBudgetMs: 30_000 }));
    const b = serialize(lintDocument(MINIMAL, { timeBudgetMs: 30_000 }));
    expect(a).toBe(b);
  });
});
