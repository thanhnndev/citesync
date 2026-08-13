/**
 * M002-S03-T1 — @citesync/core public surface tests.
 *
 * Covers the T1 contract:
 *   - `lintDocument(bytes)` parses raw .docx end-to-end (via @citesync/docx
 *     parseDocument) and returns a typed report `{ issues, doc, ruleIds }`;
 *   - `lintDocument(doc)` accepts an already-parsed AcademicDocument and
 *     yields the SAME report as the bytes path (parse is not double-run,
 *     output is identical);
 *   - the report shape: typed LintIssue entries (id/ruleId/severity/message/
 *     evidence/sourceLoc), inspectable ruleIds (CS001–CS009), parsed doc
 *     with blocks;
 *   - the contributor surface: `createRule` + `options.customRules` run a
 *     custom rule alongside built-ins in one pass, severityOverrides apply
 *     to custom rules, and malformed/colliding custom rules fail fast;
 *   - the public package re-exports the frozen S02 contract (Rule/LintIssue
 *     types + registry surface) so contributors import from @citesync/core,
 *     never internals;
 *   - the zero-deps smoke: package.json dependencies contain no
 *     React/DOM/server/UI libraries (T2 adds the import-graph audit).
 *
 * Fixtures are git-tracked committed files (fixtures/minimal.docx — a
 * "Smith (2024)" author-date citation with no bibliography entry, so the
 * built-in pass deterministically emits CS001:0 ERROR missing-reference).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { NotADocxError, parseDocument } from '@citesync/docx';
import type {
  LintDocumentInput,
  LintIssue,
  LintReport,
  Rule,
  RuleConfig,
  RuleSeverity,
} from '@citesync/core';
import {
  REGISTERED_RULES,
  RULE_BY_ID,
  RULE_SEGMENTS,
  RULE_SEVERITIES,
  createRule,
  lintDocument,
} from '@citesync/core';

const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
const MINIMAL = readFileSync(`${FIXTURES_DIR}minimal.docx`);

/** The built-in pass over minimal.docx is stable: one CS001 ERROR (missing reference). */
const EXPECTED_BUILTIN_ISSUE_COUNT = 1;
const EXPECTED_RULE_IDS = REGISTERED_RULES.map((rule) => rule.id).sort();

/** Every report issue must satisfy the frozen LintIssue shape. */
function expectIssueShape(issue: LintIssue): void {
  expect(typeof issue.id).toBe('string');
  expect(typeof issue.ruleId).toBe('string');
  expect(RULE_SEVERITIES).toContain(issue.severity);
  expect(typeof issue.message).toBe('string');
  expect(Array.isArray(issue.evidence)).toBe(true);
  expect(issue.sourceLoc).toBeDefined();
  expect(typeof issue.sourceLoc.blockId).toBe('string');
}

describe('lintDocument — bytes input (parse + lint end-to-end)', () => {
  it('parses raw .docx bytes and returns a typed report', () => {
    const report = lintDocument(MINIMAL);
    expect(report).toBeDefined();
    expect(Array.isArray(report.issues)).toBe(true);
    expect(report.issues.length).toBe(EXPECTED_BUILTIN_ISSUE_COUNT);
    report.issues.forEach(expectIssueShape);

    // The doc was parsed end-to-end through @citesync/docx parseDocument.
    expect(report.doc.blocks.length).toBeGreaterThan(0);
    expect(report.doc.blocks.map((b) => b.id)).toEqual(
      parseDocument(MINIMAL).blocks.map((b) => b.id),
    );
  });

  it('reports the built-in CS001-CS009 registry in ruleIds (inspectable surface)', () => {
    const report = lintDocument(MINIMAL);
    expect([...report.ruleIds].sort()).toEqual(EXPECTED_RULE_IDS);
  });

  it('emits the deterministic CS001 missing-reference issue on minimal.docx', () => {
    const report = lintDocument(MINIMAL);
    const cs001 = report.issues.filter((issue) => issue.ruleId === 'CS001');
    expect(cs001).toHaveLength(1);
    expect(cs001[0]?.severity).toBe('ERROR');
    expect(cs001[0]?.evidence.length).toBeGreaterThan(0);
  });

  it('accepts an ArrayBuffer input too (parseDocument contract)', () => {
    const buffer = MINIMAL.buffer.slice(
      MINIMAL.byteOffset,
      MINIMAL.byteOffset + MINIMAL.byteLength,
    );
    const report = lintDocument(buffer);
    expect(report.issues).toEqual(lintDocument(MINIMAL).issues);
  });
});

describe('lintDocument — parsed-document input', () => {
  it('accepts an AcademicDocument and yields the same report as the bytes path', () => {
    const doc = parseDocument(MINIMAL);
    const reportFromDoc = lintDocument(doc);
    const reportFromBytes = lintDocument(MINIMAL);
    expect(reportFromDoc.issues).toEqual(reportFromBytes.issues);
    expect(reportFromDoc.doc).toBe(doc); // passed-through, not re-parsed
  });

  it('returns a deep-equal doc via both paths (parse determinism)', () => {
    const reportFromBytes = lintDocument(MINIMAL);
    expect(reportFromBytes.doc).toEqual(parseDocument(MINIMAL));
  });
});

describe('lintDocument — pass options', () => {
  it('honors segment enable/disable via ruleIds and issues', () => {
    const report = lintDocument(MINIMAL, { enabled: ['numeric'] });
    expect(report.ruleIds).toEqual(['CS006', 'CS007', 'CS008', 'CS009']);
    // minimal.docx is author-date; the numeric segment emits nothing.
    expect(report.issues).toEqual([]);
  });

  it('enabled: [] runs no rules (empty report surface, deterministic)', () => {
    const report = lintDocument(MINIMAL, { enabled: [] });
    expect(report.issues).toEqual([]);
    expect(report.ruleIds).toEqual([]);
    expect(report.doc.blocks.length).toBeGreaterThan(0); // parse still happened
  });

  it('honors severity overrides (case-insensitive config values)', () => {
    const report = lintDocument(MINIMAL, { severityOverrides: { CS001: 'info' } });
    const cs001 = report.issues.find((issue) => issue.ruleId === 'CS001');
    expect(cs001?.severity).toBe('INFO');
  });

  it('ignores invalid severity overrides deterministically (never crashes)', () => {
    const report = lintDocument(MINIMAL, {
      severityOverrides: { CS001: 'totally-wrong', CS999: 'ERROR' },
    });
    const cs001 = report.issues.find((issue) => issue.ruleId === 'CS001');
    expect(cs001?.severity).toBe('ERROR'); // untouched
    expect(report.issues).toEqual(lintDocument(MINIMAL).issues);
  });
});

describe('contributor surface — createRule + customRules (T1 smoke; T2 deepens)', () => {
  /** A contributor-style custom rule: deterministic, typed through the public Rule interface. */
  const customRule = (id: string, severity: RuleSeverity = 'INFO'): Rule =>
    createRule({
      id,
      severity,
      run: (ctx) => [
        {
          id: `${id}:0`,
          ruleId: id,
          severity,
          message: `${id} scanned ${ctx.doc.blocks.length} blocks`,
          evidence: [],
          sourceLoc: { blockId: ctx.doc.blocks[0]!.id },
        },
      ],
    });

  it('createRule returns a usable Rule and validates its shape', () => {
    const rule = createRule({ id: 'CS900', severity: 'INFO', run: () => [] });
    expect(rule.id).toBe('CS900');
    expect(rule.severity).toBe('INFO');
    expect(typeof rule.run).toBe('function');

    // Fail-fast contributor errors — deterministic TypeError, named field.
    expect(() => createRule({ id: '', severity: 'INFO', run: () => [] })).toThrow(TypeError);
    expect(() =>
      createRule({ id: 'CS901', severity: 'BOGUS' as RuleSeverity, run: () => [] }),
    ).toThrow(/severity/);
    expect(() =>
      createRule({ id: 'CS901', severity: 'INFO', run: undefined as unknown as Rule['run'] }),
    ).toThrow(/run/);
  });

  it('registers a custom rule via lintDocument customRules and runs it alongside built-ins', () => {
    const report = lintDocument(MINIMAL, { customRules: [customRule('CS900')] });

    // Built-in issues untouched, custom issue present in the same pass.
    expect(report.issues.filter((i) => i.ruleId === 'CS001')).toHaveLength(1);
    const custom = report.issues.filter((i) => i.ruleId === 'CS900');
    expect(custom).toHaveLength(1);
    expect(custom[0]?.id).toBe('CS900:0');
    expect(custom[0]?.message).toContain('3 blocks');

    // Both rule sets reported.
    expect(report.ruleIds).toContain('CS900');
    expect(report.ruleIds).toEqual(expect.arrayContaining(EXPECTED_RULE_IDS));
  });

  it('applies severity overrides to custom rules (post-map, case-insensitive)', () => {
    const report = lintDocument(MINIMAL, {
      customRules: [customRule('CS900', 'WARNING')],
      severityOverrides: { CS900: 'error' },
    });
    const custom = report.issues.find((i) => i.ruleId === 'CS900');
    expect(custom?.severity).toBe('ERROR');
  });

  it('fails fast on a custom rule id colliding with a built-in', () => {
    expect(() =>
      lintDocument(MINIMAL, { customRules: [customRule('CS001', 'INFO')] }),
    ).toThrow(/collides with a built-in/);
  });

  it('fails fast on duplicate custom rule ids', () => {
    expect(() =>
      lintDocument(MINIMAL, { customRules: [customRule('CS900'), customRule('CS900')] }),
    ).toThrow(/duplicate custom rule id/);
  });

  it('never mutates the built-in registry when custom rules run', () => {
    const before = REGISTERED_RULES.map((r) => r.id).join(',');
    lintDocument(MINIMAL, { customRules: [customRule('CS900')] });
    expect(REGISTERED_RULES.map((r) => r.id).join(',')).toBe(before);
    expect(RULE_BY_ID.has('CS900')).toBe(false);
  });
});

describe('negative inputs — typed errors, never a raw crash', () => {
  it('garbage bytes throw the typed NotADocxError family (not a raw crash)', () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(() => lintDocument(garbage)).toThrow(NotADocxError);
  });

  it('empty bytes throw the typed NotADocxError family', () => {
    expect(() => lintDocument(new Uint8Array(0))).toThrow(NotADocxError);
  });

  it('a malformed custom rule implementation bubbles its error deterministically', () => {
    const broken = createRule({
      id: 'CS901',
      severity: 'INFO',
      run: () => {
        throw new Error('contributor rule bug');
      },
    });
    expect(() => lintDocument(MINIMAL, { customRules: [broken] })).toThrow(
      'contributor rule bug',
    );
  });
});

describe('public package surface', () => {
  it('exposes the frozen S02 registry surface for contributors/debugging (R009)', () => {
    expect(REGISTERED_RULES.map((r) => r.id)).toEqual([
      'CS001', 'CS002', 'CS003', 'CS004', 'CS005',
      'CS006', 'CS007', 'CS008', 'CS009',
    ]);
    expect(RULE_BY_ID.size).toBe(9);
    expect(RULE_SEGMENTS['author-date']).toEqual(['CS001', 'CS002', 'CS003', 'CS004', 'CS005']);
    expect(RULE_SEGMENTS['numeric']).toEqual(['CS006', 'CS007', 'CS008', 'CS009']);
    expect(RULE_SEVERITIES).toEqual(['ERROR', 'WARNING', 'AMBIGUOUS', 'INFO']);
  });

  it('exports the contract types through @citesync/core (compile-time; runtime smoke below)', () => {
    // The following annotations are type-level proof that the public package
    // re-exports the S02 contract (Rule, LintIssue, RuleConfig, report shape).
    const ruleConfig: RuleConfig = { id: 'CS950', severity: 'INFO', run: () => [] };
    const rule: Rule = createRule(ruleConfig);
    const input: LintDocumentInput = MINIMAL;
    const report: LintReport = lintDocument(input);
    const first: LintIssue | undefined = report.issues[0];
    expect(rule.id).toBe('CS950');
    expect(report).toBeDefined();
    expect(first).toBeDefined();
  });
});

describe('zero-deps smoke (package.json level; T2 audits the import graph)', () => {
  it('declares no React/DOM/server/UI libraries in dependencies', async () => {
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    ) as { dependencies: Record<string, string> };
    const deps = Object.keys(pkg.dependencies);
    const forbidden = /\b(react|react-dom|next|express|fastify|koa|hono|svelte|vue|preact|solid-js|@angular)\b/i;
    expect(deps.some((dep) => forbidden.test(dep))).toBe(false);
    expect(deps).toEqual(
      expect.arrayContaining(['@citesync/docx', '@citesync/document-model']),
    );
  });
});
