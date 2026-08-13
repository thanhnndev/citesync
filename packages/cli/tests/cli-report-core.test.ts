/**
 * M003-T2 — buildCliReport: the @citesync/core shared report builder (R014,
 * D024) must produce the frozen canonical report on real fixtures, and the
 * CLI's `buildReport` delegation must be byte-identical to calling the
 * shared builder directly — CLI JSON and app JSON can never drift.
 *
 * Placed in packages/cli (not core) so the byte-compat guard runs against
 * the CLI's own `serializeReport`/`validateReport` without creating a
 * reverse test-edge (core → cli).
 *
 * Fixtures are git-tracked files under fixtures/.
 */

import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  REPORT_VERSION,
  buildCliReport,
  countIssues,
  emptyCounts,
  lintDocument,
} from '@citesync/core';
import type { AcademicDocument, CliReport } from '@citesync/core';

import { buildReport, serializeReport } from '../src/report.js';
import { validateReport } from '../src/json-schema.js';

const FIXTURES = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
const MINIMAL = join(FIXTURES, 'minimal.docx'); // 1 ERROR (CS001)
const CLEAN = join(FIXTURES, 'bibliography/en-references.docx'); // 0 issues
const OUT_OF_RANGE = join(FIXTURES, 'numeric/out-of-range.docx'); // 2 CS008 issues

const FIXTURE_CASES = [
  ['minimal.docx', MINIMAL],
  ['bibliography/en-references.docx (clean)', CLEAN],
  ['numeric/out-of-range.docx', OUT_OF_RANGE],
] as const;

/** Build the core report for a fixture exactly as the CLI delegate would. */
function coreReport(fixture: string): CliReport {
  const lint = lintDocument(readFileSync(fixture));
  return buildCliReport(lint.doc, lint.issues, lint.ruleIds, {
    fileName: basename(fixture),
    version: REPORT_VERSION,
  });
}

/** Assert a report passes the frozen schema validator (R014). */
function expectValid(report: CliReport): void {
  const result = validateReport(serializeReport(report));
  if (!result.valid) {
    throw new Error(`report failed schema validation:\n${result.errors.join('\n')}`);
  }
  expect(result.valid).toBe(true);
}

describe('buildCliReport output validates against the frozen schema (R014)', () => {
  for (const [name, fixture] of FIXTURE_CASES) {
    it(name, () => {
      expectValid(coreReport(fixture));
    });
  }
});

describe('byte-compat: CLI buildReport delegation === core buildCliReport (D024)', () => {
  for (const [name, fixture] of FIXTURE_CASES) {
    it(`${name} serializes to identical bytes`, () => {
      const bytes = readFileSync(fixture);
      const lint = lintDocument(bytes);
      const viaCli = serializeReport(buildReport(lint, fixture));
      const viaCore = serializeReport(
        buildCliReport(lint.doc, lint.issues, lint.ruleIds, {
          fileName: basename(fixture),
          version: REPORT_VERSION,
        }),
      );
      expect(viaCore).toBe(viaCli);
    });
  }
});

describe('buildCliReport meta/counts shape assertions', () => {
  it('references falls back to blockIds when the section has no parsed entries', () => {
    // S02 fills blockIds on detection; S03 fills entries later. Until entries
    // exist, the count must fall back to the detected span's blockIds.
    const doc = {
      citations: [],
      bibliography: { outcome: 'detected', blockIds: ['r1', 'r2'] },
    } as unknown as AcademicDocument;
    const report = buildCliReport(doc, [], [], {
      fileName: 'fallback.docx',
      version: REPORT_VERSION,
    });
    expect(report.meta).toEqual({
      file: 'fallback.docx',
      citations: 0,
      references: 2,
      ruleIds: [],
    });
    expect(report.counts).toEqual(emptyCounts());
    expectValid(report);
  });

  it('counts recount the issues per severity with all four keys in order', () => {
    const lint = lintDocument(readFileSync(MINIMAL));
    const report = buildCliReport(lint.doc, lint.issues, lint.ruleIds, {
      fileName: basename(MINIMAL),
      version: REPORT_VERSION,
    });
    expect(report.counts).toEqual(countIssues(lint.issues));
    expect(Object.keys(report.counts)).toEqual(['ERROR', 'WARNING', 'AMBIGUOUS', 'INFO']);
    expect(report.meta.citations).toBe(lint.doc.citations.length);
    expect(report.meta.ruleIds).toEqual([...lint.ruleIds]);
  });

  it('meta.references equals the parsed entries count on a bibliography fixture', () => {
    const lint = lintDocument(readFileSync(CLEAN));
    const report = buildCliReport(lint.doc, lint.issues, lint.ruleIds, {
      fileName: 'en-references.docx',
      version: REPORT_VERSION,
    });
    expect(report.meta.references).toBe(lint.doc.bibliography?.entries?.length ?? 0);
    expect(report.meta.references).toBeGreaterThan(0);
    expect(report.issues).toEqual(lint.issues); // issues pass through verbatim
  });
});
