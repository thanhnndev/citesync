/**
 * M002-S03-T2 — contributor extensibility proof (R009).
 *
 * A CONTRIBUTOR (not a CiteSync maintainer) writes a custom rule against the
 * PUBLIC @citesync/core surface only — the re-exported `Rule` interface,
 * `createRule`, and `lintDocument({ customRules })` — and this test proves
 * the custom rule runs alongside the built-in CS001–CS009 registry in the
 * SAME deterministic pass WITHOUT touching the matcher, the built-in
 * registry, or any built-in rule implementation (slice demo contract).
 *
 * Everything here imports from '@citesync/core' — never package internals.
 * That is the contributor contract (R009): the public package is the one
 * import point; the built-in registry stays opaque and frozen.
 *
 * Fixtures: `fixtures/author-date/simple.docx` (4 author-date citations, no
 * bibliography entries → built-in pass deterministically emits four CS001
 * ERROR missing-reference issues and a populated matchMap with empty
 * entryStatus).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { LintIssue, Rule, RuleContext, RuleSeverity } from '@citesync/core';
import {
  REGISTERED_RULES,
  RULE_BY_ID,
  RULE_SEVERITIES,
  createRule,
  lintDocument,
} from '@citesync/core';

const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
const SIMPLE = readFileSync(`${FIXTURES_DIR}author-date/simple.docx`);

/** The built-in pass on simple.docx is stable: four CS001 ERROR missing-reference issues. */
const BUILTIN_CS001_COUNT = 4;

// ---------------------------------------------------------------------------
// The contributor's custom rules — written exactly as a contributor would:
// typed through the public Rule interface, wrapped with createRule.
// ---------------------------------------------------------------------------

/**
 * Contributor rule #1 — a deterministic "block auditor": one INFO issue per
 * block. Proves a custom rule reads the frozen `RuleContext` (`ctx.doc`)
 * and emits multiple typed `LintIssue`s.
 */
const blockAuditor: Rule = createRule({
  id: 'CS900',
  severity: 'INFO',
  run: (ctx: RuleContext): LintIssue[] =>
    ctx.doc.blocks.map((block, i) => ({
      id: `CS900:${i}`,
      ruleId: 'CS900',
      severity: 'INFO' as RuleSeverity,
      message: `block ${block.id} (${block.type}) audited`,
      evidence: [],
      sourceLoc: { blockId: block.id },
    })),
});

/**
 * Contributor rule #2 — a "citation advisor": reads the frozen S02 context
 * (`ctx.citations`, `ctx.matchMap`, `ctx.bibliography`) — the same data the
 * built-ins see — and warns when the document has citations but the matcher
 * bound no bibliography entries. On simple.docx this fires once (WARNING)
 * and tells the same story as the four CS001 issues.
 */
const citationAdvisor: Rule = createRule({
  id: 'CS901',
  severity: 'WARNING',
  run: (ctx: RuleContext): LintIssue[] => {
    const matched = ctx.matchMap?.entryStatus.length ?? 0;
    if (ctx.citations.length > 0 && matched === 0) {
      const first = ctx.citations[0]!;
      return [
        {
          id: 'CS901:0',
          ruleId: 'CS901',
          severity: 'WARNING' as RuleSeverity,
          message: `${ctx.citations.length} citations but no bibliography entries matched — check the bibliography section`,
          evidence: [
            {
              code: 'no-entry',
              message: 'matcher bound no bibliography entry to any citation',
              source: first.source,
            },
          ],
          sourceLoc: first.source,
        },
      ];
    }
    return [];
  },
});

describe('contributor rule runs alongside the built-in CS001–CS009 registry', () => {
  it('emits custom issues AND the untouched built-in issues in one pass', () => {
    const report = lintDocument(SIMPLE, { customRules: [blockAuditor, citationAdvisor] });

    // Built-ins still fired (the built-in pass is independent of custom rules).
    const cs001 = report.issues.filter((issue) => issue.ruleId === 'CS001');
    expect(cs001).toHaveLength(BUILTIN_CS001_COUNT);
    expect(cs001.every((issue) => issue.severity === 'ERROR')).toBe(true);

    // Custom rules fired in the same report.
    const cs900 = report.issues.filter((issue) => issue.ruleId === 'CS900');
    expect(cs900).toHaveLength(6); // one per block on simple.docx
    expect(cs900[0]?.message).toContain('doc-p0');
    const cs901 = report.issues.filter((issue) => issue.ruleId === 'CS901');
    expect(cs901).toHaveLength(1);
    expect(cs901[0]?.message).toContain('4 citations');
  });

  it('leaves the built-in issue list byte-identical whether or not custom rules run', () => {
    const withCustom = lintDocument(SIMPLE, { customRules: [blockAuditor, citationAdvisor] });
    const withoutCustom = lintDocument(SIMPLE);
    const builtInOnly = (report: { issues: LintIssue[] }) =>
      report.issues.filter((issue) => RULE_BY_ID.has(issue.ruleId));
    expect(JSON.stringify(builtInOnly(withCustom))).toBe(JSON.stringify(builtInOnly(withoutCustom)));
  });

  it('never mutates the matcher / built-in registry (R009 frozen surface)', () => {
    const idsBefore = REGISTERED_RULES.map((rule) => rule.id).join(',');
    const byIdBefore = RULE_BY_ID.size;

    lintDocument(SIMPLE, { customRules: [blockAuditor, citationAdvisor] });
    lintDocument(SIMPLE, { customRules: [blockAuditor] });

    expect(REGISTERED_RULES.map((rule) => rule.id).join(',')).toBe(idsBefore);
    expect(RULE_BY_ID.size).toBe(byIdBefore);
    expect(RULE_BY_ID.has('CS900')).toBe(false);
    expect(RULE_BY_ID.has('CS901')).toBe(false);
    expect(REGISTERED_RULES.map((r) => r.id)).toEqual([
      'CS001', 'CS002', 'CS003', 'CS004', 'CS005',
      'CS006', 'CS007', 'CS008', 'CS009',
    ]);
  });

  it('reports the custom rule ids in ruleIds (inspectable contributor surface, R009)', () => {
    const report = lintDocument(SIMPLE, { customRules: [citationAdvisor, blockAuditor] });
    expect(report.ruleIds).toContain('CS900');
    expect(report.ruleIds).toContain('CS901');
    // Rule ids are sorted, and the built-in registry ids are all present.
    expect([...report.ruleIds]).toEqual([...report.ruleIds].sort());
    for (const rule of REGISTERED_RULES) expect(report.ruleIds).toContain(rule.id);
  });
});

describe('custom rules and pass options compose (deterministic, no matcher involvement)', () => {
  it('custom rules still run when built-in segments are disabled', () => {
    const report = lintDocument(SIMPLE, {
      enabled: ['numeric'], // author-date segment off → zero built-in issues on this fixture
      customRules: [blockAuditor],
    });
    const custom = report.issues.filter((issue) => issue.ruleId === 'CS900');
    expect(custom).toHaveLength(6); // custom rules are per-call, not segment-scoped
    expect(report.issues.filter((issue) => RULE_BY_ID.has(issue.ruleId))).toEqual([]);
  });

  it('severityOverrides re-grade custom rules post-run (case-insensitive)', () => {
    const report = lintDocument(SIMPLE, {
      customRules: [citationAdvisor],
      severityOverrides: { CS901: 'error' },
    });
    const cs901 = report.issues.find((issue) => issue.ruleId === 'CS901');
    expect(cs901?.severity).toBe('ERROR');
  });

  it('merges built-in + custom issues in one deterministic severity → source → ruleId order', () => {
    const report = lintDocument(SIMPLE, { customRules: [blockAuditor, citationAdvisor] });
    const severities = report.issues.map((issue) => issue.severity);
    const precedence = RULE_SEVERITIES; // ERROR < WARNING < AMBIGUOUS < INFO
    for (let i = 1; i < severities.length; i++) {
      const prev = precedence.indexOf(severities[i - 1]!);
      const curr = precedence.indexOf(severities[i]!);
      expect(curr).toBeGreaterThanOrEqual(prev);
    }
    // Same input + same options → same order, byte-identically.
    expect(JSON.stringify(report.issues)).toBe(
      JSON.stringify(lintDocument(SIMPLE, { customRules: [blockAuditor, citationAdvisor] }).issues),
    );
  });
});

describe('contributor contract: typed through the public package, never internals', () => {
  it('RuleConfig → Rule → lintDocument compiles and runs from @citesync/core types only', () => {
    // Compile-time proof: the public Rule/LintIssue/RuleContext types flow
    // through the contributor code above; here we re-check the runtime side.
    const contributorRule: Rule = createRule({
      id: 'CS902',
      severity: 'AMBIGUOUS',
      run: (ctx) =>
        ctx.citations.length === 0
          ? []
          : [
              {
                id: 'CS902:0',
                ruleId: 'CS902',
                severity: 'AMBIGUOUS' as RuleSeverity,
                message: 'contributor rule typed through the public contract',
                evidence: [],
                sourceLoc: { blockId: ctx.doc.blocks[0]!.id },
              },
            ],
    });
    const report = lintDocument(SIMPLE, { customRules: [contributorRule] });
    expect(report.issues.find((issue) => issue.ruleId === 'CS902')?.severity).toBe('AMBIGUOUS');
    expect(report.ruleIds).toContain('CS902');
  });

  it('a broken custom rule implementation fails loudly and deterministically (never a silent skip)', () => {
    const broken = createRule({
      id: 'CS903',
      severity: 'INFO',
      run: () => {
        throw new Error('contributor bug: bad lookup table');
      },
    });
    expect(() => lintDocument(SIMPLE, { customRules: [broken] })).toThrow(
      'contributor bug: bad lookup table',
    );
    // Same failure on re-run — deterministic, no state accumulated between passes.
    expect(() => lintDocument(SIMPLE, { customRules: [broken] })).toThrow(
      'contributor bug: bad lookup table',
    );
  });
});
