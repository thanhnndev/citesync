/**
 * R013 (S03-T1) — pure unit tests for the resolution view model (node env,
 * REAL fixtures).
 *
 * Runs `lintDocument` + `buildCliReport` (from @citesync/core) over committed
 * fixture bytes (fixtures/** — git-tracked, never .gsd/), then asserts
 * `applyResolutions` against the real parse output:
 *
 *   - resolved flag + chosen entry (byIssue joins issue → citationId →
 *     chosenEntry);
 *   - per-severity resolved counts + totalResolved (UI-derived, D034 — the
 *     frozen report.counts is never touched);
 *   - unknown chosenEntryId / foreign citationId → issue stays unresolved
 *     (§79 — never guess);
 *   - deep-frozen report + doc inputs remain frozen and byte-identical after
 *     applyResolutions (the overlay returns new objects only).
 *
 * Fixture ground truth (probe-verified): ambiguous-same-author-year.docx has
 * three AMBIGUOUS citations — c0 (doc-p1 [0,12)) and c1 (doc-p3 [0,16)) and
 * c2 (doc-p4 [0,16)) — each with candidateEntryIds ['r0','r1'] (r0 = First
 * book, r1 = Second book); CS005 issues are entry-scoped (blockId only) and
 * can never be resolved; the bibliography/ambiguous.docx CS001 row is
 * MISSING_REFERENCE.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCliReport, lintDocument, REPORT_VERSION } from '@citesync/core';
import type { AcademicDocument, CliReport } from '@citesync/core';
import { applyResolutions, type SessionResolution } from '../src/resolutions/resolutions';

/** Committed fixtures root (apps/web/tests → ../../../fixtures). */
const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures', import.meta.url));

/** Lint + build the canonical report for a fixture (same as the worker). */
function lintReport(...parts: string[]): { report: CliReport; doc: AcademicDocument } {
  const { issues, doc, ruleIds } = lintDocument(readFileSync(join(FIXTURES_DIR, ...parts)));
  const report = buildCliReport(doc, issues, ruleIds, {
    fileName: parts[parts.length - 1]!,
    version: REPORT_VERSION,
  });
  return { report, doc };
}

/** Recursively freeze an object graph (test helper — proves non-mutation). */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

// ---------------------------------------------------------------------------
// applyResolutions
// ---------------------------------------------------------------------------

describe('applyResolutions', () => {
  it('resolves an issue when a SessionResolution matches its citationId', () => {
    const { report, doc } = lintReport('match', 'ambiguous-same-author-year.docx');
    const view = applyResolutions(report, doc, [{ citationId: 'c0', chosenEntryId: 'r1' }]);
    expect(view.totalResolved).toBe(1);
    const resolved = view.byIssue['CS004:0'];
    expect(resolved).toBeDefined();
    expect(resolved!.citationId).toBe('c0');
    expect(resolved!.chosenEntry.id).toBe('r1');
    expect(resolved!.chosenEntry.raw).toContain('Second book');
    // The other AMBIGUOUS issues are NOT resolved — their citationIds have
    // no resolution.
    expect(view.byIssue['CS004:1']).toBeUndefined();
    expect(view.byIssue['CS004:2']).toBeUndefined();
    // Entry-scoped CS005 issues can never be resolved (no join surface).
    expect(view.byIssue['CS005:0']).toBeUndefined();
    expect(view.byIssue['CS005:1']).toBeUndefined();
  });

  it('resolves each citation independently (two resolutions → two resolved issues)', () => {
    const { report, doc } = lintReport('match', 'ambiguous-same-author-year.docx');
    const view = applyResolutions(report, doc, [
      { citationId: 'c0', chosenEntryId: 'r0' },
      { citationId: 'c1', chosenEntryId: 'r1' },
    ]);
    expect(view.totalResolved).toBe(2);
    expect(view.byIssue['CS004:0']!.chosenEntry.id).toBe('r0');
    expect(view.byIssue['CS004:1']!.chosenEntry.id).toBe('r1');
    expect(view.byIssue['CS004:2']).toBeUndefined();
  });

  it('per-severity resolved counts + total are UI-derived (never report.counts)', () => {
    const { report, doc } = lintReport('match', 'ambiguous-same-author-year.docx');
    const reportCounts = JSON.stringify(report.counts);
    const view = applyResolutions(report, doc, [
      { citationId: 'c0', chosenEntryId: 'r0' },
      { citationId: 'c1', chosenEntryId: 'r1' },
      { citationId: 'c2', chosenEntryId: 'r1' },
    ]);
    expect(view.resolvedCounts).toEqual({ AMBIGUOUS: 3 });
    expect(view.totalResolved).toBe(3);
    // The canonical report counts are untouched — byte-identical.
    expect(JSON.stringify(report.counts)).toBe(reportCounts);
    expect(report.counts.AMBIGUOUS).toBe(3);
  });

  it('unknown chosenEntryId → the issue stays unresolved (never guessed)', () => {
    const { report, doc } = lintReport('match', 'ambiguous-same-author-year.docx');
    const view = applyResolutions(report, doc, [{ citationId: 'c0', chosenEntryId: 'r-nope' }]);
    expect(view.totalResolved).toBe(0);
    expect(view.byIssue['CS004:0']).toBeUndefined();
    expect(view.resolvedCounts).toEqual({});
  });

  it('a resolution for a citationId the document does not contain is inert', () => {
    const { report, doc } = lintReport('match', 'ambiguous-same-author-year.docx');
    const view = applyResolutions(report, doc, [{ citationId: 'c99', chosenEntryId: 'r0' }]);
    expect(view.totalResolved).toBe(0);
    expect(view.byIssue['CS004:0']).toBeUndefined();
  });

  it('duplicate resolutions for one citationId → the LAST one wins (upsert semantics)', () => {
    const { report, doc } = lintReport('match', 'ambiguous-same-author-year.docx');
    const view = applyResolutions(report, doc, [
      { citationId: 'c0', chosenEntryId: 'r0' },
      { citationId: 'c0', chosenEntryId: 'r1' },
    ]);
    expect(view.totalResolved).toBe(1);
    expect(view.byIssue['CS004:0']!.chosenEntry.id).toBe('r1');
  });

  it('no resolutions → empty view (every issue unresolved)', () => {
    const { report, doc } = lintReport('match', 'ambiguous-same-author-year.docx');
    const view = applyResolutions(report, doc, []);
    expect(view.totalResolved).toBe(0);
    expect(view.byIssue['CS004:0']).toBeUndefined();
    expect(view.resolvedCounts).toEqual({});
  });

  it('CS001 (MISSING_REFERENCE) issues can never be resolved — even with a matching citationId', () => {
    const { report, doc } = lintReport('bibliography', 'ambiguous.docx');
    const view = applyResolutions(report, doc, [{ citationId: 'c0', chosenEntryId: 'r0' }]);
    // CS001 region-joins to the c0 row, but the row is MISSING_REFERENCE —
    // resolutionCandidatesForIssue returns null → no candidate surface.
    expect(report.issues.find((i) => i.id === 'CS001:0')).toBeDefined();
    expect(view.totalResolved).toBe(0);
    expect(view.byIssue['CS001:0']).toBeUndefined();
  });

  it('deep-frozen report + doc inputs stay frozen and byte-identical (overlay returns new objects only)', () => {
    const { report, doc } = lintReport('match', 'ambiguous-same-author-year.docx');
    const frozenReport = deepFreeze(report);
    const frozenDoc = deepFreeze(doc);
    const reportJsonBefore = JSON.stringify(frozenReport);

    const view = applyResolutions(frozenReport, frozenDoc, [
      { citationId: 'c0', chosenEntryId: 'r0' },
      { citationId: 'c1', chosenEntryId: 'r1' },
    ]);

    expect(view.totalResolved).toBe(2);
    // Inputs are still frozen — nothing mutated them.
    expect(Object.isFrozen(frozenReport)).toBe(true);
    expect(Object.isFrozen(frozenReport.issues)).toBe(true);
    expect(Object.isFrozen(frozenDoc)).toBe(true);
    expect(Object.isFrozen(frozenDoc.matchMap)).toBe(true);
    // The serialized canonical report is byte-identical before/after.
    expect(JSON.stringify(frozenReport)).toBe(reportJsonBefore);
  });
});
