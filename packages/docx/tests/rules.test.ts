/**
 * M002-S02-T4 — rule registry + deterministic aggregator tests.
 *
 * Covers the T4 contract end-to-end:
 *   - registry surface: REGISTERED_RULES (CS001–CS009 in rule-id order),
 *     RULE_BY_ID lookup, RULE_SEGMENTS partition (PRD §53 families);
 *   - the full `lintDocumentRules` pass over a representative mixed
 *     author-date + numeric document (every defect surface CS001–CS009
 *     firing at once) with the deterministic severity → source → ruleId
 *     order (R008);
 *   - enable/disable (segment-scoped) and per-rule severity overrides
 *     (PRD §51 — case-insensitive config values, invalid values and unknown
 *     rule ids ignored deterministically, rules stay pure);
 *   - byte-identical re-run determinism (R008);
 *   - the committed golden issue report `tests/golden/numeric.golden.json`
 *     locking the mixed report shape against drift.
 *
 * The mixed document is built through the REAL pipeline pieces the rules
 * consume (`buildMatchMap`, `buildNumericIndexMap`) so the golden report
 * reflects engine output, not hand-asserted maps. All fixtures are inline
 * literals — no I/O except the golden read.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type {
  AcademicDocument,
  AuthorDateCitationItem,
  CitationOccurrence,
  DocumentBlock,
  ReferenceEntry,
  SourceLocation,
} from '@citesync/document-model';

import {
  buildMatchMap,
  buildNumericIndexMap,
  buildNameKey,
  lintDocumentRules,
  REGISTERED_RULES,
  RULE_BY_ID,
  RULE_SEGMENTS,
  ruleCS001,
} from '../src/index.js';
import type { LintIssue } from '../src/index.js';

const GOLDEN_DIR = fileURLToPath(new URL('./golden/', import.meta.url));

// ---------------------------------------------------------------------------
// Fixture — the representative mixed document (author-date + numeric).
// ---------------------------------------------------------------------------

/**
 * One §21 reference entry with a tiered name key (author-date entries) or a
 * §88 parse-failure entry (no authors, parseConfidence 0).
 */
function entry(
  id: string,
  family: string | undefined,
  given: string | undefined,
  year: number | undefined,
  opts: { yearSuffix?: string; rawOverride?: string } = {},
): ReferenceEntry {
  const originalName = family === undefined ? '' : given === undefined ? family : `${family}, ${given}`;
  const raw = opts.rawOverride ?? `${originalName} (${year}). Title. Journal.`;
  return {
    id,
    raw,
    index: Number(id.slice(1)), // e0 → 0, e5 → 5 (bibliography order)
    ...(family !== undefined
      ? {
          authors: [
            {
              originalName,
              family,
              ...(given !== undefined ? { given } : {}),
              key: buildNameKey(originalName),
            },
          ],
        }
      : {}),
    ...(year !== undefined ? { year } : {}),
    ...(opts.yearSuffix !== undefined ? { yearSuffix: opts.yearSuffix } : {}),
    source: { blockId: `ref-${id}` },
    parseConfidence: family === undefined ? 0 : 1,
  };
}

/** Source region of `needle` inside a block text (R009 round-trip). */
function srcOf(block: DocumentBlock, needle: string): SourceLocation {
  const startOffset = block.text.indexOf(needle);
  if (startOffset === -1) throw new Error(`needle not in block: ${needle}`);
  return {
    blockId: block.id,
    paragraphIndex: block.source.paragraphIndex,
    startOffset,
    endOffset: startOffset + needle.length,
  };
}

/** One §20 author-date citation occurrence literal. */
function occ(
  id: string,
  item: AuthorDateCitationItem,
  raw: string,
  source: SourceLocation,
): CitationOccurrence {
  return { id, raw, family: 'author-date', items: [item], source, confidence: 0.9 };
}

/** One §20 numeric-family citation occurrence literal. */
function numOcc(
  id: string,
  numbers: number[],
  source: SourceLocation,
): CitationOccurrence {
  return { id, raw: `[${numbers.join(',')}]`, family: 'numeric', items: [{ numbers }], source, confidence: 0.97 };
}

/**
 * The representative mixed document: every CS001–CS009 trigger surface in one
 * doc, offsets computed from the real block text (R009), match map +
 * numeric index map built by the real engines.
 *
 * Body: Doe (2018) and Xyz (1999) and Tran (2021) and Smith (2020);
 * see [1, x], [5], [9], [0].
 *
 *   c0 Doe (2018)   → MATCHED e0                       (clean)
 *   c1 Xyz (1999)   → MISSING_REFERENCE                (CS001)
 *   c2 Tran (2021)  → POSSIBLE_MISMATCH vs e2 (2024)   (CS003)
 *   c3 Smith (2020) → AMBIGUOUS vs e3/e4 (both 2020)   (CS004; e3/e4 → CS005)
 *   [1, x]          → invalid bracket                  (CS007)
 *   [5]             → resolved e4                      (clean)
 *   [9]             → out-of-range                     (CS008)
 *   [0]             → unmatched                        (CS008)
 *
 * Entries e0..e5:
 *   e0 Doe, J. (2018)            CITED
 *   e1 Le, M. (2019)             UNUSED        (CS002, CS009)
 *   e2 Tran, V. (2024)           near-miss UNUSED (CS002, CS009)
 *   e3 Smith, J. (2020)          AMBIGUOUS_USAGE + suffix cluster (CS005)
 *   e4 Smith, J. (2020)          AMBIGUOUS_USAGE + suffix cluster (CS005)
 *                                + numeric-bound by [5]
 *   e5 "Junk without a year."    §88 parse failure (CS006) + UNUSED (CS002,
 *                                CS009)
 */
function mixedDoc(): AcademicDocument {
  const body = {
    id: 'doc-p1',
    type: 'paragraph' as const,
    text: 'Doe (2018) and Xyz (1999) and Tran (2021) and Smith (2020); see [1, x], [5], [9], [0].',
    source: { blockId: 'doc-p1', paragraphIndex: 0 },
  };
  const entries = [
    entry('e0', 'Doe', 'J', 2018),
    entry('e1', 'Le', 'M', 2019),
    entry('e2', 'Tran', 'V', 2024),
    entry('e3', 'Smith', 'J', 2020),
    entry('e4', 'Smith', 'J', 2020),
    entry('e5', undefined, undefined, undefined, {
      rawOverride: 'Junk without a year.',
    }),
  ];
  const d: AcademicDocument = {
    metadata: {},
    blocks: [body],
    citations: [
      occ('c0', { firstAuthor: 'Doe', year: 2018 }, 'Doe (2018)', srcOf(body, 'Doe (2018)')),
      occ('c1', { firstAuthor: 'Xyz', year: 1999 }, 'Xyz (1999)', srcOf(body, 'Xyz (1999)')),
      occ('c2', { firstAuthor: 'Tran', year: 2021 }, 'Tran (2021)', srcOf(body, 'Tran (2021)')),
      occ('c3', { firstAuthor: 'Smith', year: 2020 }, 'Smith (2020)', srcOf(body, 'Smith (2020)')),
      numOcc('c4', [5], srcOf(body, '[5]')),
      numOcc('c5', [9], srcOf(body, '[9]')),
      numOcc('c6', [0], srcOf(body, '[0]')),
    ],
    bibliography: {
      outcome: 'detected',
      heading: 'References',
      blockIds: entries.map((e) => `ref-${e.id}`),
      entries,
    },
    referenceParseIssues: [
      {
        blockId: 'ref-e5',
        index: 5,
        raw: 'Junk without a year.',
        code: 'reference-parse',
        message: 'no (YYYY) year marker',
      },
    ],
    sourceMap: { version: 1, blocks: {} },
  };
  d.matchMap = buildMatchMap(d);
  d.numericIndexMap = buildNumericIndexMap(d);
  return d;
}

// ---------------------------------------------------------------------------
// Registry surface.
// ---------------------------------------------------------------------------

describe('rule registry (T4) — surface', () => {
  it('registers exactly CS001…CS009 in rule-id order', () => {
    expect(REGISTERED_RULES.map((r) => r.id)).toEqual([
      'CS001', 'CS002', 'CS003', 'CS004', 'CS005',
      'CS006', 'CS007', 'CS008', 'CS009',
    ]);
    // Unique ids — a duplicate would break the registry contract.
    expect(new Set(REGISTERED_RULES.map((r) => r.id)).size).toBe(9);
  });

  it('RULE_BY_ID resolves every registered rule', () => {
    for (const rule of REGISTERED_RULES) {
      expect(RULE_BY_ID.get(rule.id)).toBe(rule);
    }
    expect(RULE_BY_ID.size).toBe(9);
    expect(RULE_BY_ID.has('CS999')).toBe(false);
  });

  it('RULE_SEGMENTS partitions the ruleset by PRD §53 families', () => {
    expect(RULE_SEGMENTS['author-date']).toEqual(['CS001', 'CS002', 'CS003', 'CS004', 'CS005']);
    expect(RULE_SEGMENTS.numeric).toEqual(['CS006', 'CS007', 'CS008', 'CS009']);
    // Every registered rule lives in exactly one segment.
    const all = [...RULE_SEGMENTS['author-date'], ...RULE_SEGMENTS.numeric];
    expect(all.sort()).toEqual(REGISTERED_RULES.map((r) => r.id).sort());
    expect(new Set(all).size).toBe(9);
  });

  it('exposes the severity defaults of every registered rule (R008)', () => {
    expect(REGISTERED_RULES.map((r) => r.severity)).toEqual([
      'ERROR', 'WARNING', 'WARNING', 'AMBIGUOUS', 'WARNING',
      'ERROR', 'WARNING', 'ERROR', 'WARNING',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Full pass — the deterministic issue report over the mixed document.
// ---------------------------------------------------------------------------

describe('lintDocumentRules — full pass (CS001–CS009)', () => {
  it('runs every rule and returns the full typed issue set in deterministic order', () => {
    const issues = lintDocumentRules(mixedDoc());
    expect(issues.map((i) => i.id)).toEqual([
      // ERROR (RULE_SEVERITIES first, then source order: body offsets first,
      // ref blocks sort after the body block)
      'CS001:0', // c1 Xyz missing (body offset 15)
      'CS008:0', // [9] out-of-range (body offset 78)
      'CS008:1', // [0] unmatched (body offset 83)
      'CS006:0', // e5 parse failure (ref block sorts after body)
      // WARNING (source order: body offsets, then ref blocks by blockId)
      'CS003:0', // c2 Tran year mismatch
      'CS007:0', // [1, x] invalid
      'CS002:0', // e1 unused
      'CS009:0', // e1 unused numeric
      'CS002:1', // e2 unused
      'CS009:1', // e2 unused numeric
      'CS005:0', // e3 missing suffix
      'CS005:1', // e4 missing suffix
      'CS002:2', // e5 unused
      'CS009:2', // e5 unused numeric
      // AMBIGUOUS
      'CS004:0', // c3 ambiguous
    ]);
    // Severity is non-decreasing along the report (RULE_SEVERITIES order).
    const severities = issues.map((i) => i.severity);
    const rank = (s: string) => ['ERROR', 'WARNING', 'AMBIGUOUS', 'INFO'].indexOf(s);
    for (let i = 1; i < severities.length; i += 1) {
      expect(rank(severities[i]!)).toBeGreaterThanOrEqual(rank(severities[i - 1]!));
    }
    // Every issue is a typed LintIssue: severity + evidence + sourceLoc.
    for (const issue of issues) {
      expect(issue.severity).toMatch(/^(ERROR|WARNING|AMBIGUOUS|INFO)$/);
      expect(issue.evidence.length).toBeGreaterThan(0);
      expect(issue.evidence.every((e) => e.code !== undefined && e.source !== undefined)).toBe(true);
      expect(issue.sourceLoc.blockId.length).toBeGreaterThan(0);
    }
  });

  it('returns an empty array for a clean document (no defect surfaces)', () => {
    const doc = mixedDoc();
    // Keep only the MATCHED Doe citation bound to a single entry; drop every
    // defect surface: the invalid bracket block, the §88 failure record and
    // the numeric map (no numeric citations left).
    const clean: AcademicDocument = {
      ...doc,
      blocks: [],
      citations: [doc.citations[0]!],
      bibliography: {
        ...doc.bibliography!,
        entries: [doc.bibliography!.entries[0]!],
      },
    };
    delete (clean as { referenceParseIssues?: unknown }).referenceParseIssues;
    delete (clean as { numericIndexMap?: unknown }).numericIndexMap;
    clean.matchMap = buildMatchMap(clean);
    expect(lintDocumentRules(clean)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Enable / disable (segment-scoped, PRD §53).
// ---------------------------------------------------------------------------

describe('lintDocumentRules — enable/disable', () => {
  it('enabled: ["author-date"] runs only CS001–CS005', () => {
    const issues = lintDocumentRules(mixedDoc(), { enabled: ['author-date'] });
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) {
      expect(issue.ruleId).toMatch(/^CS00[1-5]$/);
    }
    // Author-date set exactly: CS001, CS002, CS003, CS004, CS005 present.
    expect(new Set(issues.map((i) => i.ruleId))).toEqual(
      new Set(['CS001', 'CS002', 'CS003', 'CS004', 'CS005']),
    );
  });

  it('enabled: ["numeric"] runs only CS006–CS009', () => {
    const issues = lintDocumentRules(mixedDoc(), { enabled: ['numeric'] });
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) {
      expect(issue.ruleId).toMatch(/^CS00[6-9]$/);
    }
    expect(new Set(issues.map((i) => i.ruleId))).toEqual(
      new Set(['CS006', 'CS007', 'CS008', 'CS009']),
    );
  });

  it('enabled: [] disables every rule (returns [])', () => {
    expect(lintDocumentRules(mixedDoc(), { enabled: [] })).toEqual([]);
  });

  it('default (undefined) is the full pass — identical to both segments', () => {
    const full = lintDocumentRules(mixedDoc());
    const both = lintDocumentRules(mixedDoc(), {
      enabled: ['author-date', 'numeric'],
    });
    expect(full).toEqual(both);
    expect(full.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Severity overrides (PRD §51).
// ---------------------------------------------------------------------------

describe('lintDocumentRules — severity overrides (PRD §51)', () => {
  it('re-grades an issue deterministically without renumbering its id', () => {
    const issues = lintDocumentRules(mixedDoc(), { severityOverrides: { CS002: 'ERROR' } });
    const cs002 = issues.filter((i) => i.ruleId === 'CS002');
    expect(cs002.length).toBe(3);
    for (const issue of cs002) {
      expect(issue.severity).toBe('ERROR');
      expect(issue.id).toMatch(/^CS002:\d$/); // id shape unchanged
    }
    // The CS002 ids are still the rule's own ordinals (0,1,2).
    expect(cs002.map((i) => i.id)).toEqual(['CS002:0', 'CS002:1', 'CS002:2']);
    // Re-graded issues sort into the ERROR band (severity-first re-sort).
    const first = issues[0]!;
    expect(first.severity).toBe('ERROR');
  });

  it('accepts the PRD §51 lowercase config-file casing', () => {
    const issues = lintDocumentRules(mixedDoc(), { severityOverrides: { CS002: 'error' } });
    expect(issues.filter((i) => i.ruleId === 'CS002').every((i) => i.severity === 'ERROR')).toBe(true);
  });

  it('ignores invalid severity values deterministically (config line never crashes)', () => {
    // 'fatal' is not a RuleSeverity — the override is dropped, defaults stay.
    const issues = lintDocumentRules(mixedDoc(), {
      severityOverrides: { CS002: 'fatal' as never },
    });
    expect(issues.filter((i) => i.ruleId === 'CS002').every((i) => i.severity === 'WARNING')).toBe(true);
  });

  it('ignores overrides for unknown rule ids', () => {
    const issues = lintDocumentRules(mixedDoc(), {
      severityOverrides: { CS999: 'ERROR', CS001: 'INFO' },
    });
    // CS001 downgraded; the phantom CS999 changes nothing.
    expect(issues.find((i) => i.ruleId === 'CS001')!.severity).toBe('INFO');
    expect(issues.some((i) => i.ruleId === 'CS999')).toBe(false);
  });

  it('keeps rules pure — the override is a post-map, the rule object is untouched', () => {
    const doc = mixedDoc();
    const before = JSON.stringify(ruleCS001.run({
      doc,
      matchMap: doc.matchMap,
      numericIndexMap: doc.numericIndexMap,
      bibliography: doc.bibliography,
      citations: doc.citations,
    }));
    lintDocumentRules(doc, { severityOverrides: { CS001: 'INFO' } });
    const after = JSON.stringify(ruleCS001.run({
      doc,
      matchMap: doc.matchMap,
      numericIndexMap: doc.numericIndexMap,
      bibliography: doc.bibliography,
      citations: doc.citations,
    }));
    expect(after).toBe(before); // rules are not mutated by the aggregator
  });
});

// ---------------------------------------------------------------------------
// Determinism (R008).
// ---------------------------------------------------------------------------

describe('lintDocumentRules — determinism', () => {
  it('is byte-identical across re-runs of the same document', () => {
    const doc = mixedDoc();
    const first = JSON.stringify(lintDocumentRules(doc));
    const second = JSON.stringify(lintDocumentRules(doc));
    expect(second).toBe(first);
  });

  it('is byte-identical across independent passes with options', () => {
    const opts = {
      enabled: ['author-date', 'numeric'] as const,
      severityOverrides: { CS009: 'INFO', CS001: 'warning' as const },
    };
    const doc = mixedDoc();
    const first = JSON.stringify(lintDocumentRules(doc, opts));
    const second = JSON.stringify(lintDocumentRules(doc, opts));
    expect(second).toBe(first);
  });
});

// ---------------------------------------------------------------------------
// Golden issue report.
// ---------------------------------------------------------------------------

describe('golden issue report (T4)', () => {
  it('locks the mixed author-date+numeric report against tests/golden/numeric.golden.json', () => {
    const golden = JSON.parse(
      readFileSync(join(GOLDEN_DIR, 'numeric.golden.json'), 'utf8'),
    ) as LintIssue[];
    const fresh = JSON.parse(
      JSON.stringify(lintDocumentRules(mixedDoc())),
    ) as LintIssue[];
    expect(fresh).toEqual(golden);
  });

  it('golden anchor carries the hand-known multi-rule structure (drift guard)', () => {
    const golden = JSON.parse(
      readFileSync(join(GOLDEN_DIR, 'numeric.golden.json'), 'utf8'),
    ) as LintIssue[];
    expect(golden.length).toBe(15);
    expect(golden.map((i) => i.ruleId)).toEqual([
      'CS001', 'CS008', 'CS008', 'CS006',
      'CS003', 'CS007', 'CS002', 'CS009',
      'CS002', 'CS009', 'CS005', 'CS005',
      'CS002', 'CS009', 'CS004',
    ]);
    expect(golden.filter((i) => i.severity === 'ERROR').length).toBe(4);
    expect(golden.filter((i) => i.severity === 'WARNING').length).toBe(10);
    expect(golden.filter((i) => i.severity === 'AMBIGUOUS').length).toBe(1);
    // R009 round-trip spot-check: the [9] out-of-range issue selects "9".
    const cs008 = golden.find((i) => i.ruleId === 'CS008' && i.message.includes('9'))!;
    const block = mixedDoc().blocks[0]!;
    expect(block.text.slice(cs008.sourceLoc.startOffset, cs008.sourceLoc.endOffset)).toBe('9');
  });
});
