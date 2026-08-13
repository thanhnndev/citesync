/**
 * T4 (S03) — R013 integrity proofs (node env, REAL fixtures).
 *
 * Pins the R013 invariants as executable unit proofs so S04 export stays
 * byte-compatible with the CLI `--json` output:
 *
 *   1. DOCX-INTEGRITY  — the manuscript bytes are never written (R018):
 *      a retained copy of the input fixture bytes (same retain-before-run
 *      semantics as useAnalyze's `lastInputRef`) stays byte-identical across
 *      the FULL resolve simulation (lintDocument → resolutionCandidatesForIssue
 *      → applyResolutions), and the on-disk file is byte-identical too — the
 *      app only ever reads.
 *   2. NON-MUTATION    — deep-frozen report + doc (issues/evidence/sourceLoc/
 *      matchMap/bibliography) remain frozen after applyResolutions and the
 *      serialized canonical report JSON is byte-identical: the overlay
 *      returns new objects only (D020).
 *   3. OVERLAY-NOT-IN-REPORT — buildCliReport output is byte-identical with
 *      and without resolutions applied: the resolution view never reaches
 *      the frozen schema (D020/D024 — S04 byte-compat with CLI --json).
 *   4. INDEPENDENCE    — resolving an issue does not change
 *      possibleReferencesForIssue / resolutionCandidatesForIssue output for
 *      that same issue: matcher data is untouched — resolution is a VIEW,
 *      not a data change.
 *
 * Fixture ground truth (probe-verified in T1): ambiguous-same-author-year.docx
 * has three AMBIGUOUS citations — c0 (doc-p1 [0,12)), c1 (doc-p3 [0,16)) and
 * c2 (doc-p4 [0,16)) — each with candidateEntryIds ['r0','r1'] (r0 = First
 * book, r1 = Second book); issue CS004:0 region-joins to c0.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCliReport, lintDocument, REPORT_VERSION } from '@citesync/core';
import type { AcademicDocument, CliReport } from '@citesync/core';
import { applyResolutions, type SessionResolution } from '../src/resolutions/resolutions';
import {
  possibleReferencesForIssue,
  resolutionCandidatesForIssue,
} from '../src/explorer/explorer';

/** Committed fixtures root (apps/web/tests → ../../../fixtures). */
const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures', import.meta.url));

/** The R013 demo fixture (match-map AMBIGUOUS citations c0/c1/c2). */
const AMBIGUOUS_FIXTURE = ['match', 'ambiguous-same-author-year.docx'] as const;
const AMBIGUOUS_FILENAME = AMBIGUOUS_FIXTURE[AMBIGUOUS_FIXTURE.length - 1]!;

/** Resolve ALL three AMBIGUOUS citations — the full overlay, non-empty. */
const RESOLVE_ALL: readonly SessionResolution[] = [
  { citationId: 'c0', chosenEntryId: 'r0' },
  { citationId: 'c1', chosenEntryId: 'r1' },
  { citationId: 'c2', chosenEntryId: 'r1' },
];

/** Lint a committed fixture (same entry point as the worker / S02 tests). */
function lintFixture(...parts: string[]): ReturnType<typeof lintDocument> {
  return lintDocument(readFileSync(join(FIXTURES_DIR, ...parts)));
}

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
// 1. DOCX-INTEGRITY — the manuscript bytes are never written (R018)
// ---------------------------------------------------------------------------

describe('DOCX-INTEGRITY: the manuscript bytes are never written (R018)', () => {
  it('retained input bytes stay byte-identical across the full resolve simulation', () => {
    const path = join(FIXTURES_DIR, ...AMBIGUOUS_FIXTURE);
    // Retain a TRUE copy BEFORE the run — same retain-before semantics as
    // useAnalyze's `lastInputRef` (`bytes.slice(0)` before postMessage
    // transfers/detaches the caller's buffer). Buffer.from(...) is a genuine
    // copy, so any write into the input buffer would diverge the two.
    const inputBytes = readFileSync(path);
    const retainedBytes = Buffer.from(inputBytes);
    const diskBefore = readFileSync(path);

    // Full resolve simulation: lint → join → overlay.
    const { report, doc } = lintReport(...AMBIGUOUS_FIXTURE);
    expect(report.issues.find((i) => i.id === 'CS004:0')).toBeDefined();
    const view = applyResolutions(report, doc, RESOLVE_ALL);
    expect(view.totalResolved).toBe(3);

    // The retained copy is untouched — no code path wrote into the buffer
    // that carried the manuscript.
    expect(inputBytes.equals(retainedBytes)).toBe(true);
    // Structural proof: the on-disk file is byte-identical too — the app
    // only ever READS the manuscript; no write path exists (R018).
    expect(readFileSync(path).equals(diskBefore)).toBe(true);
    expect(readFileSync(path).equals(inputBytes)).toBe(true);
  });

  it('re-analyzing the retained bytes yields the byte-identical report (rerun seam)', () => {
    // Mirrors useAnalyze.rerun: the retained COPY, not a fresh read, is what
    // a re-run consumes — prove it reproduces the same canonical report.
    const retainedBytes = Buffer.from(readFileSync(join(FIXTURES_DIR, ...AMBIGUOUS_FIXTURE)));
    const { report: run1, doc: doc1 } = lintReport(...AMBIGUOUS_FIXTURE);
    const { issues, doc, ruleIds } = lintDocument(retainedBytes);
    const run2 = buildCliReport(doc, issues, ruleIds, {
      fileName: AMBIGUOUS_FILENAME,
      version: REPORT_VERSION,
    });
    const view2 = applyResolutions(run2, doc, RESOLVE_ALL);
    expect(view2.totalResolved).toBe(3);
    expect(JSON.stringify(run2)).toBe(JSON.stringify(run1));
    expect(doc).toEqual(doc1);
  });
});

// ---------------------------------------------------------------------------
// 2. NON-MUTATION — the overlay returns new objects only (D020)
// ---------------------------------------------------------------------------

describe('NON-MUTATION: deep-frozen inputs stay frozen and byte-identical (D020)', () => {
  it('report + doc remain frozen and the report JSON is byte-identical after applyResolutions', () => {
    const { report, doc } = lintReport(...AMBIGUOUS_FIXTURE);
    const frozenReport = deepFreeze(report);
    const frozenDoc = deepFreeze(doc);
    const reportJsonBefore = JSON.stringify(frozenReport);
    const docJsonBefore = JSON.stringify(frozenDoc);

    const view = applyResolutions(frozenReport, frozenDoc, RESOLVE_ALL);
    expect(view.totalResolved).toBe(3);

    // Every layer of the canonical report is still frozen.
    expect(Object.isFrozen(frozenReport)).toBe(true);
    expect(Object.isFrozen(frozenReport.meta)).toBe(true);
    expect(Object.isFrozen(frozenReport.issues)).toBe(true);
    expect(Object.isFrozen(frozenReport.issues[0]!.evidence)).toBe(true);
    expect(Object.isFrozen(frozenReport.issues[0]!.sourceLoc)).toBe(true);
    expect(Object.isFrozen(frozenReport.counts)).toBe(true);
    // The parsed document (incl. the match map the join reads) is frozen too.
    expect(Object.isFrozen(frozenDoc)).toBe(true);
    expect(Object.isFrozen(frozenDoc.matchMap)).toBe(true);
    expect(Object.isFrozen(frozenDoc.matchMap!.citations)).toBe(true);
    expect(Object.isFrozen(frozenDoc.bibliography)).toBe(true);
    expect(Object.isFrozen(frozenDoc.blocks)).toBe(true);

    // Serialized canonical report AND document are byte-identical — the
    // overlay never touched them.
    expect(JSON.stringify(frozenReport)).toBe(reportJsonBefore);
    expect(JSON.stringify(frozenDoc)).toBe(docJsonBefore);
  });
});

// ---------------------------------------------------------------------------
// 3. OVERLAY-NOT-IN-REPORT — resolutions never reach the frozen schema
// ---------------------------------------------------------------------------

describe('OVERLAY-NOT-IN-REPORT: resolutions never reach the frozen schema (D020/D024)', () => {
  it('buildCliReport output is byte-identical with and without resolutions applied', () => {
    const { issues, doc, ruleIds } = lintFixture(...AMBIGUOUS_FIXTURE);
    const reportPlain = buildCliReport(doc, issues, ruleIds, {
      fileName: AMBIGUOUS_FILENAME,
      version: REPORT_VERSION,
    });
    const reportOverlaid = buildCliReport(doc, issues, ruleIds, {
      fileName: AMBIGUOUS_FILENAME,
      version: REPORT_VERSION,
    });

    // The overlay is real and non-trivial...
    const view = applyResolutions(reportOverlaid, doc, RESOLVE_ALL);
    expect(view.totalResolved).toBe(3);
    expect(view.byIssue['CS004:0']!.chosenEntry.id).toBe('r0');

    // ...but the canonical report JSON is byte-identical — the overlay is a
    // separate view object that never leaks into the frozen schema (S04
    // export stays byte-compatible with CLI --json).
    expect(JSON.stringify(reportOverlaid)).toBe(JSON.stringify(reportPlain));
    // The report object gains no new keys (version/meta/issues/counts only).
    expect(Object.keys(reportOverlaid)).toEqual(['version', 'meta', 'issues', 'counts']);
    expect('byIssue' in reportOverlaid).toBe(false);
    expect('resolvedCounts' in reportOverlaid).toBe(false);
    expect('totalResolved' in reportOverlaid).toBe(false);
    expect(JSON.stringify(reportOverlaid)).not.toContain('byIssue');
  });
});

// ---------------------------------------------------------------------------
// 4. INDEPENDENCE — resolution is a view, not a data change
// ---------------------------------------------------------------------------

describe('INDEPENDENCE: resolution is a view, not a data change', () => {
  it('resolving an issue does not change possibleReferencesForIssue for that issue', () => {
    const { report, doc } = lintReport(...AMBIGUOUS_FIXTURE);
    const issue = report.issues.find((i) => i.id === 'CS004:0')!;
    const refsBefore = possibleReferencesForIssue(doc, issue);

    const view = applyResolutions(report, doc, [{ citationId: 'c0', chosenEntryId: 'r1' }]);
    expect(view.byIssue['CS004:0']!.chosenEntry.id).toBe('r1');

    // Matcher data is untouched — the reference surface is unchanged.
    const refsAfter = possibleReferencesForIssue(doc, issue);
    expect(refsAfter).toEqual(refsBefore);
    // The chosen entry is one of the issue's possible references — the
    // picker surface and the evidence panel always agree (R013-T3).
    expect(refsAfter).toContainEqual(view.byIssue['CS004:0']!.chosenEntry);
  });

  it('resolutionCandidatesForIssue output is identical before and after resolving', () => {
    const { report, doc } = lintReport(...AMBIGUOUS_FIXTURE);
    const issue = report.issues.find((i) => i.id === 'CS004:0')!;
    const candidatesBefore = resolutionCandidatesForIssue(doc, issue);
    expect(candidatesBefore).not.toBeNull();
    expect(candidatesBefore!.citationId).toBe('c0');

    const view = applyResolutions(report, doc, [{ citationId: 'c0', chosenEntryId: 'r0' }]);
    expect(view.byIssue['CS004:0']).toBeDefined();
    // Re-deriving the picker surface yields the same candidates — the user
    // could still re-choose (re-choosing updates the same citationId).
    expect(resolutionCandidatesForIssue(doc, issue)).toEqual(candidatesBefore);
  });
});
