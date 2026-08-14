/**
 * M004/S02-T6 — failure-isolation e2e proof through the PUBLIC `lintDocument`
 * surface (R009) on the committed demo fixture
 * `fixtures/isolation/garbage-and-malformed.docx` (T4; drift-guarded in T5).
 *
 * The R016 hardening claim this test proves is the S02 slice demo: a document
 * carrying ONE garbage bibliography entry ('Junk without a year.') and ONE
 * malformed bracket ('[1, x]') analyzes END TO END through the same public
 * entry the PWA worker and the benchmark harness use — producing a complete
 * typed report, never a crash:
 *
 *   a. lintDocument(bytes) does not throw; the report carries the typed
 *      CS006:0 ERROR (evidence 'reference-parse', §88 — the garbage entry is
 *      emitted with parseConfidence 0 and surfaced, never dropped) and the
 *      typed CS007:0 WARNING (evidence 'invalid-numeric', reason 'mixed' —
 *      the malformed bracket surfaces as a typed issue);
 *   b. doc.referenceParseIssues is populated (one entry, code
 *      'reference-parse') and the bibliography is still detected with the
 *      garbage entry as entries[0] (parseConfidence 0, raw verbatim);
 *   c. the clean '[1]' resolves POSITIONALLY to r0 (D016 status 'resolved',
 *      resolvedEntryId 'r0') — even a garbage entry never crashes the D016
 *      mapping pass; the malformed '[1, x]' is NEVER half-emitted into the
 *      citations stream (R007/MEM092, through the public surface);
 *   d. R009 round-trip: issue sourceLocs select the exact block text
 *      (block.text.slice(startOffset, endOffset) === the referenced raw);
 *   e. deterministic byte-identical re-run (R008): two default runs
 *      serialize to identical bytes;
 *   f. the whole-analysis time budget (T2/T3) composes with isolation: an
 *      explicit generous timeBudgetMs (30_000) yields the byte-identical
 *      report — budget untripped never perturbs the output, and the
 *      pathological input here is handled by TYPED issues (CS006/CS007), not
 *      by an abort (the budget is a safety valve, D039).
 *
 * Fixtures are git-tracked committed files under fixtures/ (never .gsd/ or
 * any gitignored path).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  REPORT_VERSION,
  buildCliReport,
  lintDocument,
  serializeReport,
} from '@citesync/core';
import type { LintIssue, LintReport } from '@citesync/core';

const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
const ISOLATION = readFileSync(`${FIXTURES_DIR}isolation/garbage-and-malformed.docx`);

/** One typed issue selected from the report, or undefined. */
function issueByRule(report: LintReport, ruleId: string): LintIssue | undefined {
  return report.issues.find((issue) => issue.ruleId === ruleId);
}

/** Canonical report serialization (D024) — the byte contract consumers see. */
function serialize(lint: LintReport): string {
  return serializeReport(
    buildCliReport(lint.doc, lint.issues, lint.ruleIds, {
      fileName: 'isolation/garbage-and-malformed.docx',
      version: REPORT_VERSION,
    }),
  );
}

describe('failure isolation e2e — garbage entry + malformed bracket through the public lintDocument', () => {
  it('analyzes to a complete report — never a crash (CS006 ERROR + CS007 WARNING present)', () => {
    const report = lintDocument(ISOLATION);

    // CS006: the garbage entry surfaces as a typed ERROR with the §88
    // evidence code 'reference-parse'.
    const cs006 = issueByRule(report, 'CS006');
    expect(cs006).toBeDefined();
    expect(cs006!.severity).toBe('ERROR');
    expect(cs006!.evidence.map((e) => e.code)).toContain('reference-parse');
    expect(cs006!.message).toContain('Junk without a year.');

    // CS007: the malformed bracket surfaces as a typed WARNING with the
    // evidence code 'invalid-numeric' (grammar `invalid` surface, R007).
    const cs007 = issueByRule(report, 'CS007');
    expect(cs007).toBeDefined();
    expect(cs007!.severity).toBe('WARNING');
    expect(cs007!.evidence.map((e) => e.code)).toContain('invalid-numeric');
    expect(cs007!.message).toContain('[1, x]');
  });

  it('populates doc.referenceParseIssues and keeps the bibliography detected (garbage entry emitted, not dropped)', () => {
    const doc = lintDocument(ISOLATION).doc;

    // §88: the failed entry is recorded, never silently dropped.
    expect(doc.referenceParseIssues).toHaveLength(1);
    const failure = doc.referenceParseIssues![0];
    expect(failure).toMatchObject({
      blockId: 'doc-p3',
      index: 0,
      raw: 'Junk without a year.',
      code: 'reference-parse',
    });

    // The section is still detected and the garbage entry stays in place as
    // entries[0] with parseConfidence 0 (raw preserved verbatim) — analysis
    // continues around the failure.
    expect(doc.bibliography?.outcome).toBe('detected');
    expect(doc.bibliography?.heading).toBe('References');
    expect(doc.bibliography?.entries).toHaveLength(3);
    const r0 = doc.bibliography!.entries![0];
    expect(r0).toMatchObject({ id: 'r0', raw: 'Junk without a year.', index: 0, parseConfidence: 0 });
    expect(doc.bibliography!.entries!.map((e) => e.id)).toEqual(['r0', 'r1', 'r2']);
  });

  it("resolves the clean '[1]' positionally to r0 and never half-emits the malformed '[1, x]' (D016 resolved + R007)", () => {
    const doc = lintDocument(ISOLATION).doc;

    // D016: the clean bracket binds to entries[0] = r0 (the garbage entry) —
    // positional binding runs even around a parse-failure entry.
    const mapRow = doc.numericIndexMap?.citations.find((row) => row.citationId === 'c0');
    expect(mapRow).toBeDefined();
    expect(mapRow!.tokens).toEqual([
      expect.objectContaining({ index: 1, status: 'resolved', resolvedEntryId: 'r0' }),
    ]);

    // R007/MEM092 through the public surface: the malformed '[1, x]' never
    // appears in the citations stream — only the clean '[1]' is emitted.
    const numericRaws = doc.citations
      .filter((c) => c.family === 'numeric')
      .map((c) => c.raw);
    expect(numericRaws).toEqual(['[1]']);
    expect(numericRaws).not.toContain('[1, x]');
  });

  it('issue sourceLocs round-trip to the exact block text (R009)', () => {
    const report = lintDocument(ISOLATION);
    const blockText = new Map(report.doc.blocks.map((b) => [b.id, b.text]));

    const cs006 = issueByRule(report, 'CS006')!;
    expect(blockText.get(cs006.sourceLoc.blockId)!.slice(
      cs006.sourceLoc.startOffset, cs006.sourceLoc.endOffset,
    )).toBe('Junk without a year.');

    const cs007 = issueByRule(report, 'CS007')!;
    expect(blockText.get(cs007.sourceLoc.blockId)!.slice(
      cs007.sourceLoc.startOffset, cs007.sourceLoc.endOffset,
    )).toBe('[1, x]');
  });

  it('is deterministic — two default runs serialize byte-identically (R008)', () => {
    const a = serialize(lintDocument(ISOLATION));
    const b = serialize(lintDocument(ISOLATION));
    expect(a).toBe(b);
    expect(JSON.stringify(lintDocument(ISOLATION).issues)).toBe(
      JSON.stringify(lintDocument(ISOLATION).issues),
    );
  });

  it('composes with an explicit generous timeBudgetMs — same report, no abort (D039 safety valve)', () => {
    const defaults = serialize(lintDocument(ISOLATION));
    const budgeted = serialize(lintDocument(ISOLATION, { timeBudgetMs: 30_000 }));
    expect(budgeted).toBe(defaults);
    // The typed issues are still there under the explicit budget — the
    // pathological input is handled by issues, not by an abort.
    const report = lintDocument(ISOLATION, { timeBudgetMs: 30_000 });
    expect(issueByRule(report, 'CS006')?.severity).toBe('ERROR');
    expect(issueByRule(report, 'CS007')?.severity).toBe('WARNING');
  });
});
