/**
 * M002-S02-T1 — LintIssue + Rule contract test (frozen for S3).
 *
 * Contract tests (T1 done-when): a downstream consumer can import the
 * `LintIssue` / `Rule` shapes from the public `@citesync/docx` barrel, the
 * R008 severity union is EXACTLY ERROR/WARNING/AMBIGUOUS/INFO, `Rule.run`
 * returns `LintIssue[]`, and running a rule is deterministic (R008).
 *
 * The type-only imports and the type-level assignments below are the actual
 * contract checks — they fail at typecheck time if the barrel stops
 * exporting a name or a shape drifts (the in-src compile-time checks in
 * `src/rules/types.ts` enforce the same invariants under `tsc -b`). The
 * runtime assertions prove the package boundary resolves end-to-end and
 * spot-check the structural shapes S3/CLI depend on.
 */
import { describe, expect, it } from 'vitest';

import type { AcademicDocument, SourceLocation } from '@citesync/document-model';

import { RULE_SEVERITIES } from '../src/index.js';
import type {
  LintEvidence,
  LintIssue,
  Rule,
  RuleContext,
  RuleEvidenceCode,
  RuleSeverity,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// Type-level contract checks (erased at runtime; enforced when this file is
// typechecked — mirrored in src/rules/types.ts under `tsc -b`).
// ---------------------------------------------------------------------------

/** Severity union must be EXACTLY the R008 four (missing/extra/renamed breaks). */
const _severityExact: Record<RuleSeverity, true> = {
  ERROR: true,
  WARNING: true,
  AMBIGUOUS: true,
  INFO: true,
};

/** Rule.run must return LintIssue[] and read the full frozen context. */
const _ruleShape: Rule = {
  id: 'CS000',
  severity: 'INFO',
  run: (ctx: RuleContext): LintIssue[] => {
    const _fields: [
      typeof ctx.doc,
      typeof ctx.matchMap,
      typeof ctx.numericIndexMap,
      typeof ctx.bibliography,
      typeof ctx.citations,
    ] = [ctx.doc, ctx.matchMap, ctx.numericIndexMap, ctx.bibliography, ctx.citations];
    void _fields;
    return [];
  },
};

/** LintIssue must carry exactly id/ruleId/severity/message/evidence/sourceLoc. */
const _issueShape: LintIssue = {
  id: 'CS000:0',
  ruleId: 'CS000',
  severity: 'INFO',
  message: 'contract check',
  evidence: [{ code: 'no-entry', message: 'contract check', source: { blockId: 'b0' } }],
  sourceLoc: { blockId: 'b0' },
};

/** Evidence codes are the deterministic union (MatchReason | RuleEvidenceCode). */
const _evidenceShape: LintEvidence = {
  code: 'no-entry',
  message: 'contract check',
  source: { blockId: 'b0' },
};
const _evidenceCodeCheck: MatchReasonOrRuleCode = _evidenceShape.code;

// Alias so the union membership is exercised without importing MatchReason.
type MatchReasonOrRuleCode = RuleEvidenceCode | MatchReasonLike;
type MatchReasonLike = 'exact' | 'ambiguous' | 'no-entry';

void _severityExact;
void _ruleShape;
void _issueShape;
void _evidenceCodeCheck;

// ---------------------------------------------------------------------------
// Runtime contract checks.
// ---------------------------------------------------------------------------

/** Minimal §15 document: no blocks/citations — enough for a contract ctx. */
function minimalDoc(): AcademicDocument {
  return {
    metadata: {},
    blocks: [],
    citations: [],
    sourceMap: { version: 1, blocks: {} },
  };
}

/** The frozen ctx shape with every explicit field present. */
function emptyCtx(): RuleContext {
  const doc = minimalDoc();
  return {
    doc,
    matchMap: undefined,
    numericIndexMap: undefined,
    bibliography: undefined,
    citations: doc.citations,
  };
}

/** A sample rule that emits one typed issue per ctx citation (deterministic). */
const sampleRule: Rule = {
  id: 'CS000',
  severity: 'WARNING',
  run: (ctx) =>
    ctx.citations.map((citation, n) => ({
      id: `CS000:${n}`,
      ruleId: 'CS000',
      severity: 'WARNING',
      message: `contract check on ${citation.id}`,
      evidence: [
        { code: 'no-entry', message: 'no bibliography target', source: citation.source },
      ],
      sourceLoc: citation.source,
    })),
};

describe('rules contract (T1)', () => {
  it('exposes RULE_SEVERITIES exactly as the R008 union in report order', () => {
    expect(RULE_SEVERITIES).toEqual(['ERROR', 'WARNING', 'AMBIGUOUS', 'INFO']);
    expect(RULE_SEVERITIES.length).toBe(4);
  });

  it('Rule.run returns LintIssue[] with the frozen shape', () => {
    const source: SourceLocation = { blockId: 'b0', paragraphIndex: 0, startOffset: 0, endOffset: 4 };
    const ctx: RuleContext = {
      ...emptyCtx(),
      citations: [{ id: 'c0', raw: 'Doe (2018)', family: 'author-date', items: [], source, confidence: 0.9 }],
    };
    const issues: LintIssue[] = sampleRule.run(ctx);
    expect(issues).toHaveLength(1);
    const issue = issues[0]!;
    expect(issue.id).toBe('CS000:0');
    expect(issue.ruleId).toBe('CS000');
    expect(issue.severity).toBe('WARNING');
    expect(issue.message).toContain('c0');
    expect(issue.sourceLoc).toEqual(source);
    expect(issue.evidence).toHaveLength(1);
    expect(issue.evidence[0]!.code).toBe('no-entry');
    expect(issue.evidence[0]!.source).toEqual(source);
  });

  it('is deterministic — a re-run is byte-identical (R008)', () => {
    const source: SourceLocation = { blockId: 'b0', startOffset: 0, endOffset: 4 };
    const ctx: RuleContext = {
      ...emptyCtx(),
      citations: [
        { id: 'c0', raw: 'Doe (2018)', family: 'author-date', items: [], source, confidence: 0.9 },
        { id: 'c1', raw: '[1]', family: 'numeric', items: [{ numbers: [1] }], source, confidence: 0.9 },
      ],
    };
    const first = JSON.stringify(sampleRule.run(ctx));
    const second = JSON.stringify(sampleRule.run(ctx));
    expect(second).toBe(first);
  });

  it('rules stay pure when the context has no match/numeric/bibliography state', () => {
    // Absent maps are a signal, not an error: a rule must handle the frozen
    // ctx with everything undefined and still return a typed array.
    const issues: LintIssue[] = sampleRule.run(emptyCtx());
    expect(Array.isArray(issues)).toBe(true);
    expect(issues).toHaveLength(0);
  });
});
