/**
 * M002-S02-T2 — author-date rules CS001–CS005 tests.
 *
 * Each rule is tested both on hand-built match-map fixtures (exact control
 * of the trigger condition) and through the real `buildMatchMap` pipeline
 * (proves the rules consume the M001 engine output it claims). Assertions
 * cover: correct trigger condition per rule, typed issues with
 * severity + evidence + sourceLoc, no-fire on clean docs, numeric-family
 * exclusion (CS001), absent-map conservatism (no fabricated match state),
 * deterministic byte-identical re-runs (R008), and severity defaults.
 *
 * All fixtures are inline AcademicDocument / MatchMap / ReferenceEntry
 * literals — no I/O, no locale calls (R008).
 */

import { describe, expect, it } from 'vitest';

import type {
  AcademicDocument,
  AuthorDateCitationItem,
  CitationMatchResult,
  CitationOccurrence,
  EntryMatchStatusRow,
  MatchMap,
  MatchReason,
  ReferenceEntry,
  RuleContext,
  SourceLocation,
} from '@citesync/document-model';

import {
  AUTHOR_DATE_RULES,
  buildMatchMap,
  buildNameKey,
  ruleCS001,
  ruleCS002,
  ruleCS003,
  ruleCS004,
  ruleCS005,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// Fixture helpers — realistic literals (same shapes S03/S04 produce).
// ---------------------------------------------------------------------------

/** One §21 reference entry with a tiered name key built over the full name. */
function ref(
  id: string,
  family: string,
  given: string | undefined,
  year: number,
  opts: { yearSuffix?: string } = {},
): ReferenceEntry {
  const originalName = given === undefined ? family : `${family}, ${given}`;
  const suffix = opts.yearSuffix === undefined ? '' : opts.yearSuffix;
  return {
    id,
    raw: `${originalName} (${year}${suffix}). Title. Journal.`,
    authors: [
      {
        originalName,
        family,
        ...(given !== undefined ? { given } : {}),
        key: buildNameKey(originalName),
      },
    ],
    year,
    ...(opts.yearSuffix !== undefined ? { yearSuffix: opts.yearSuffix } : {}),
    source: { blockId: `ref-${id}` },
    parseConfidence: 1,
  };
}

/** One §20 author-date citation occurrence literal. */
function occurrence(
  id: string,
  item: AuthorDateCitationItem,
  raw = '(cited)',
): CitationOccurrence {
  return {
    id,
    raw,
    family: 'author-date',
    items: [item],
    source: { blockId: 'doc-p1', startOffset: 0, endOffset: raw.length },
    confidence: 0.9,
  };
}

/** One numeric-family citation occurrence (used for CS001 exclusion tests). */
function numericOccurrence(id: string, numbers: number[]): CitationOccurrence {
  return {
    id,
    raw: `[${numbers.join(',')}]`,
    family: 'numeric',
    items: [{ numbers }],
    source: { blockId: 'doc-p2', startOffset: 0, endOffset: 3 },
    confidence: 0.9,
  };
}

/** Minimal AcademicDocument literal; entries omitted → no bibliography. */
function doc(
  citations: CitationOccurrence[],
  entries?: ReferenceEntry[],
): AcademicDocument {
  const bibliography =
    entries === undefined
      ? undefined
      : {
          outcome: 'detected' as const,
          heading: 'References',
          blockIds: entries.map((e) => `ref-${e.id}`),
          entries,
        };
  return {
    metadata: {},
    blocks: [],
    citations,
    ...(bibliography !== undefined ? { bibliography } : {}),
    sourceMap: { version: 1, blocks: {} },
  };
}

/** One §27 citation match row literal. */
function matchRow(
  citationId: string,
  relationship: CitationMatchResult['relationship'],
  reasons: MatchReason[],
  source: SourceLocation,
  opts: { matchedEntryId?: string } = {},
): CitationMatchResult {
  return {
    citationId,
    citationSource: source,
    relationship,
    score: relationship === 'MATCHED' ? 0.95 : 0.5,
    tier: 1,
    confidence: 0.5,
    reasons,
    ...(opts.matchedEntryId !== undefined ? { matchedEntryId: opts.matchedEntryId } : {}),
  };
}

/** One §27 match map literal. */
function mapOf(
  citations: CitationMatchResult[],
  entryStatus: EntryMatchStatusRow[] = [],
): MatchMap {
  return { version: 1, citations, entryStatus };
}

/** The frozen rule ctx over a fixture doc. */
function ruleCtx(
  d: AcademicDocument,
  matchMap: MatchMap | undefined,
): RuleContext {
  return {
    doc: d,
    matchMap,
    numericIndexMap: undefined,
    bibliography: d.bibliography,
    citations: d.citations,
  };
}

const SRC: SourceLocation = { blockId: 'doc-p1', startOffset: 0, endOffset: 12 };

// ---------------------------------------------------------------------------
// Severity defaults (PRD §28–§32).
// ---------------------------------------------------------------------------

describe('author-date rules — severity defaults (PRD §28–§32)', () => {
  it('pins each rule to its PRD severity', () => {
    expect(ruleCS001.severity).toBe('ERROR');
    expect(ruleCS002.severity).toBe('WARNING');
    expect(ruleCS003.severity).toBe('WARNING');
    expect(ruleCS004.severity).toBe('AMBIGUOUS');
    expect(ruleCS005.severity).toBe('WARNING');
  });
});

// ---------------------------------------------------------------------------
// CS001 — Missing Reference.
// ---------------------------------------------------------------------------

describe('CS001 — missing reference', () => {
  it('fires on a MISSING_REFERENCE row with severity + evidence + sourceLoc', () => {
    const d = doc([occurrence('c0', { firstAuthor: 'Smith', year: 2023 }, 'Smith (2023)')]);
    const mm = mapOf([matchRow('c0', 'MISSING_REFERENCE', ['no-entry'], SRC)]);
    const issues = ruleCS001.run(ruleCtx(d, mm));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.id).toBe('CS001:0');
    expect(issues[0]!.ruleId).toBe('CS001');
    expect(issues[0]!.severity).toBe('ERROR');
    expect(issues[0]!.message).toContain('Smith (2023)');
    expect(issues[0]!.evidence).toHaveLength(1);
    expect(issues[0]!.evidence[0]!.code).toBe('no-entry');
    expect(issues[0]!.evidence[0]!.source).toEqual(SRC);
    expect(issues[0]!.sourceLoc).toEqual(SRC);
  });

  it('fires on a no-bibliography document through the real buildMatchMap pipeline', () => {
    // Matcher policy: no bibliography targets → every citation MISSING_REFERENCE
    // with reasons ['no-entry'] (§79 — never guess a target).
    const d = doc([occurrence('c0', { firstAuthor: 'Smith', year: 2023 }, 'Smith (2023)')]);
    const issues = ruleCS001.run(ruleCtx(d, buildMatchMap(d)));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.evidence.map((e) => e.code)).toEqual(['no-entry']);
  });

  it('skips numeric-family citations (their missing-target surface is CS008)', () => {
    const citations = [
      occurrence('c0', { firstAuthor: 'Smith', year: 2023 }, 'Smith (2023)'),
      numericOccurrence('c1', [1]),
    ];
    const d = doc(citations);
    const mm = mapOf([
      matchRow('c0', 'MISSING_REFERENCE', ['no-entry'], SRC),
      matchRow('c1', 'MISSING_REFERENCE', ['no-entry'], { blockId: 'doc-p2' }),
    ]);
    const issues = ruleCS001.run(ruleCtx(d, mm));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.id).toBe('CS001:0');
    expect(issues[0]!.sourceLoc).toEqual(SRC);
  });

  it('emits one issue per missing citation in document order (stable ids)', () => {
    const d = doc([
      occurrence('c0', { firstAuthor: 'A', year: 2000 }, 'A (2000)'),
      occurrence('c1', { firstAuthor: 'B', year: 2001 }, 'B (2001)'),
      occurrence('c2', { firstAuthor: 'C', year: 2002 }, 'C (2002)'),
    ]);
    const mm = mapOf([
      matchRow('c0', 'MISSING_REFERENCE', ['no-entry'], SRC),
      matchRow('c1', 'MATCHED', ['exact', 'year-match'], SRC, { matchedEntryId: 'r0' }),
      matchRow('c2', 'MISSING_REFERENCE', ['no-entry'], SRC),
    ]);
    const issues = ruleCS001.run(ruleCtx(d, mm));
    expect(issues.map((i) => i.id)).toEqual(['CS001:0', 'CS001:1']);
    expect(issues.map((i) => i.message)).toEqual([
      expect.stringContaining('A (2000)'),
      expect.stringContaining('C (2002)'),
    ]);
  });

  it('does not fire on MATCHED / AMBIGUOUS / POSSIBLE_MISMATCH rows', () => {
    const d = doc([
      occurrence('c0', { firstAuthor: 'A', year: 2000 }),
      occurrence('c1', { firstAuthor: 'B', year: 2001 }),
      occurrence('c2', { firstAuthor: 'C', year: 2002 }),
    ]);
    const mm = mapOf([
      matchRow('c0', 'MATCHED', ['exact', 'year-match'], SRC, { matchedEntryId: 'r0' }),
      matchRow('c1', 'AMBIGUOUS', ['exact', 'year-match', 'ambiguous'], SRC),
      matchRow('c2', 'POSSIBLE_MISMATCH', ['exact', 'year-mismatch'], SRC),
    ]);
    expect(ruleCS001.run(ruleCtx(d, mm))).toEqual([]);
  });

  it('emits nothing when matchMap is absent — no fabricated match state (§79)', () => {
    const d = doc([occurrence('c0', { firstAuthor: 'Smith', year: 2023 }, 'Smith (2023)')]);
    expect(ruleCS001.run(ruleCtx(d, undefined))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// CS002 — Unused Reference.
// ---------------------------------------------------------------------------

describe('CS002 — unused reference', () => {
  it('fires on an UNUSED entryStatus row with severity + evidence + sourceLoc', () => {
    const e1 = ref('r1', 'Doe', 'J', 2018);
    const e2 = ref('r2', 'Le', 'M', 2019);
    const d = doc([], [e1, e2]);
    const mm = mapOf([], [
      { entryId: 'r1', status: 'CITED' },
      { entryId: 'r2', status: 'UNUSED' },
    ]);
    const issues = ruleCS002.run(ruleCtx(d, mm));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.id).toBe('CS002:0');
    expect(issues[0]!.severity).toBe('WARNING');
    expect(issues[0]!.message).toContain('Le, M (2019)');
    expect(issues[0]!.evidence).toEqual([
      {
        code: 'unused',
        message: 'Bibliography entry is never cited by any citation.',
        source: e2.source,
      },
    ]);
    expect(issues[0]!.sourceLoc).toEqual(e2.source);
  });

  it('emits in bibliography order for consecutive UNUSED entries (stable ids)', () => {
    const e1 = ref('r1', 'Doe', 'J', 2018);
    const e2 = ref('r2', 'Le', 'M', 2019);
    const e3 = ref('r3', 'Tran', 'V', 2020);
    const d = doc([], [e1, e2, e3]);
    const mm = mapOf([], [
      { entryId: 'r1', status: 'UNUSED' },
      { entryId: 'r2', status: 'UNUSED' },
      { entryId: 'r3', status: 'CITED' },
    ]);
    const issues = ruleCS002.run(ruleCtx(d, mm));
    expect(issues.map((i) => i.id)).toEqual(['CS002:0', 'CS002:1']);
    expect(issues.map((i) => i.sourceLoc)).toEqual([e1.source, e2.source]);
  });

  it('skips CITED and AMBIGUOUS_USAGE rows and status rows with no entry', () => {
    const e1 = ref('r1', 'Doe', 'J', 2018);
    const d = doc([], [e1]);
    const mm = mapOf([], [
      { entryId: 'r1', status: 'CITED' },
      { entryId: 'r1', status: 'AMBIGUOUS_USAGE' },
      { entryId: 'r9', status: 'UNUSED' }, // not in the bibliography → no source
    ]);
    expect(ruleCS002.run(ruleCtx(d, mm))).toEqual([]);
  });

  it('emits nothing when matchMap is absent', () => {
    const d = doc([], [ref('r1', 'Doe', 'J', 2018)]);
    expect(ruleCS002.run(ruleCtx(d, undefined))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// CS003 — Year Mismatch.
// ---------------------------------------------------------------------------

describe('CS003 — year mismatch', () => {
  it('fires on a year-mismatch reason row with the citation year in the message', () => {
    const d = doc([occurrence('c0', { firstAuthor: 'Smith', year: 2023 }, 'Smith (2023)')]);
    const mm = mapOf([matchRow('c0', 'POSSIBLE_MISMATCH', ['exact', 'year-mismatch'], SRC)]);
    const issues = ruleCS003.run(ruleCtx(d, mm));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.id).toBe('CS003:0');
    expect(issues[0]!.severity).toBe('WARNING');
    expect(issues[0]!.message).toContain('year (2023)');
    expect(issues[0]!.evidence.map((e) => e.code)).toEqual(['exact', 'year-mismatch']);
    expect(issues[0]!.sourceLoc).toEqual(SRC);
  });

  it('fires on a wrong-year near-miss through the real buildMatchMap pipeline', () => {
    // Doe (2018) vs Doe, J. (2021): exact author + year mismatch → 0.6 score,
    // in the POSSIBLE_MISMATCH band [0.4, 0.7) — never a confident MATCHED (§79).
    const d = doc(
      [occurrence('c0', { firstAuthor: 'Doe', year: 2018 }, 'Doe (2018)')],
      [ref('r0', 'Doe', 'J', 2021)],
    );
    const mm = buildMatchMap(d);
    const row = mm.citations[0]!;
    expect(row.relationship).toBe('POSSIBLE_MISMATCH');
    expect(row.reasons).toContain('year-mismatch');
    const issues = ruleCS003.run(ruleCtx(d, mm));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain('2018');
  });

  it('does not fire on year-match rows', () => {
    const d = doc([occurrence('c0', { firstAuthor: 'Doe', year: 2018 }, 'Doe (2018)')]);
    const mm = mapOf([matchRow('c0', 'MATCHED', ['exact', 'year-match'], SRC, { matchedEntryId: 'r0' })]);
    expect(ruleCS003.run(ruleCtx(d, mm))).toEqual([]);
  });

  it('emits nothing when matchMap is absent', () => {
    const d = doc([occurrence('c0', { firstAuthor: 'Doe', year: 2018 }, 'Doe (2018)')]);
    expect(ruleCS003.run(ruleCtx(d, undefined))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// CS004 — Ambiguous Author-Date Match.
// ---------------------------------------------------------------------------

describe('CS004 — ambiguous author-date match', () => {
  it('fires on an AMBIGUOUS row with AMBIGUOUS severity and ambiguous evidence', () => {
    const cit = occurrence('c0', { firstAuthor: 'Nguyen', year: 2023 }, 'Nguyen (2023)');
    const d = doc([cit]);
    const mm = mapOf([
      matchRow('c0', 'AMBIGUOUS', ['exact', 'year-match', 'ambiguous'], cit.source),
    ]);
    const issues = ruleCS004.run(ruleCtx(d, mm));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.id).toBe('CS004:0');
    expect(issues[0]!.severity).toBe('AMBIGUOUS');
    expect(issues[0]!.message).toContain('multiple reference entries');
    expect(issues[0]!.evidence.some((e) => e.code === 'ambiguous')).toBe(true);
    expect(issues[0]!.sourceLoc).toEqual(cit.source);
  });

  it('fires on a real tie through buildMatchMap — never auto-picks (§27)', () => {
    // Smith (2020) against two identical Smith, J. (2020) entries: both score
    // 0.95 ≥ threshold, gap 0 → AMBIGUOUS; matchedEntryId is NOT set.
    const d = doc(
      [occurrence('c0', { firstAuthor: 'Smith', year: 2020 }, 'Smith (2020)')],
      [ref('r1', 'Smith', 'J', 2020), ref('r2', 'Smith', 'J', 2020)],
    );
    const mm = buildMatchMap(d);
    const row = mm.citations[0]!;
    expect(row.relationship).toBe('AMBIGUOUS');
    expect(row.matchedEntryId).toBeUndefined();
    const issues = ruleCS004.run(ruleCtx(d, mm));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain('Smith (2020)');
  });

  it('does not fire on a MATCHED row', () => {
    const d = doc([occurrence('c0', { firstAuthor: 'Doe', year: 2018 }, 'Doe (2018)')]);
    const mm = mapOf([matchRow('c0', 'MATCHED', ['exact', 'year-match'], SRC, { matchedEntryId: 'r0' })]);
    expect(ruleCS004.run(ruleCtx(d, mm))).toEqual([]);
  });

  it('emits nothing when matchMap is absent', () => {
    const d = doc([occurrence('c0', { firstAuthor: 'Doe', year: 2018 }, 'Doe (2018)')]);
    expect(ruleCS004.run(ruleCtx(d, undefined))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// CS005 — Missing Year Suffix.
// ---------------------------------------------------------------------------

describe('CS005 — missing year suffix', () => {
  it('fires once per same-author-same-year entry lacking a suffix', () => {
    const e1 = ref('r1', 'Smith', 'J', 2023);
    const e2 = ref('r2', 'Smith', 'J', 2023);
    const d = doc([], [e1, e2]);
    const issues = ruleCS005.run(ruleCtx(d, undefined));
    expect(issues).toHaveLength(2);
    expect(issues.map((i) => i.id)).toEqual(['CS005:0', 'CS005:1']);
    for (const issue of issues) {
      expect(issue.severity).toBe('WARNING');
      expect(issue.message).toContain('suffix');
      expect(issue.message).toContain('2023');
      expect(issue.evidence).toEqual([
        {
          code: 'missing-suffix',
          message: 'Same-author-same-year entries lack a unique disambiguation suffix (2018a / 2018b).',
          source: issue.sourceLoc,
        },
      ]);
    }
    expect(issues.map((i) => i.sourceLoc)).toEqual([e1.source, e2.source]);
  });

  it('flags only the unsuffixed entry when the cluster is partially suffixed', () => {
    const d = doc([], [
      ref('r1', 'Smith', 'J', 2023, { yearSuffix: 'a' }),
      ref('r2', 'Smith', 'J', 2023, { yearSuffix: 'b' }),
      ref('r3', 'Smith', 'J', 2023), // plain 2018 — missing its suffix
    ]);
    const issues = ruleCS005.run(ruleCtx(d, undefined));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.id).toBe('CS005:0');
    expect(issues[0]!.sourceLoc).toEqual({ blockId: 'ref-r3' });
  });

  it('flags duplicated suffixes as ambiguous (a duplicate is as bad as none)', () => {
    const d = doc([], [
      ref('r1', 'Smith', 'J', 2023, { yearSuffix: 'a' }),
      ref('r2', 'Smith', 'J', 2023, { yearSuffix: 'a' }),
    ]);
    const issues = ruleCS005.run(ruleCtx(d, undefined));
    expect(issues.map((i) => i.id)).toEqual(['CS005:0', 'CS005:1']);
  });

  it('does not fire when every entry in the cluster carries a distinct suffix', () => {
    const d = doc([], [
      ref('r1', 'Smith', 'J', 2023, { yearSuffix: 'a' }),
      ref('r2', 'Smith', 'J', 2023, { yearSuffix: 'b' }),
    ]);
    expect(ruleCS005.run(ruleCtx(d, undefined))).toEqual([]);
  });

  it('does not fire when entries differ by given name (distinct §24 keys)', () => {
    const d = doc([], [ref('r1', 'Smith', 'J', 2023), ref('r2', 'Smith', 'P', 2023)]);
    expect(ruleCS005.run(ruleCtx(d, undefined))).toEqual([]);
  });

  it('does not fire when entries differ by year', () => {
    const d = doc([], [ref('r1', 'Smith', 'J', 2023), ref('r2', 'Smith', 'J', 2024)]);
    expect(ruleCS005.run(ruleCtx(d, undefined))).toEqual([]);
  });

  it('does not fire on a single-entry bibliography or an empty one', () => {
    expect(ruleCS005.run(ruleCtx(doc([], [ref('r1', 'Smith', 'J', 2023)]), undefined))).toEqual([]);
    expect(ruleCS005.run(ruleCtx(doc([], []), undefined))).toEqual([]);
    expect(ruleCS005.run(ruleCtx(doc([]), undefined))).toEqual([]);
  });

  it('runs on bibliography alone — independent of the match map', () => {
    // CS005 is a bibliography-quality check: it fires even when the matcher
    // never ran (matchMap absent) — absent map is no reason to hide a defect.
    const d = doc([], [ref('r1', 'Smith', 'J', 2023), ref('r2', 'Smith', 'J', 2023)]);
    const issues = ruleCS005.run(ruleCtx(d, undefined));
    expect(issues).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Whole-ruleset behavior.
// ---------------------------------------------------------------------------

describe('author-date rules — clean docs, determinism, integration', () => {
  it('no rule fires on a clean document (MATCHED citation + CITED entry)', () => {
    const d = doc(
      [occurrence('c0', { firstAuthor: 'Doe', year: 2018 }, 'Doe (2018)')],
      [ref('r0', 'Doe', 'J', 2018)],
    );
    const mm = buildMatchMap(d);
    expect(mm.citations[0]!.relationship).toBe('MATCHED');
    expect(mm.entryStatus).toEqual([{ entryId: 'r0', status: 'CITED' }]);
    for (const rule of AUTHOR_DATE_RULES) {
      expect(rule.run(ruleCtx(d, mm))).toEqual([]);
    }
  });

  it('is deterministic — byte-identical re-run across every rule (R008)', () => {
    const d = doc(
      [
        occurrence('c0', { firstAuthor: 'Doe', year: 2018 }, 'Doe (2018)'),
        occurrence('c1', { firstAuthor: 'Xyz', year: 1999 }, 'Xyz (1999)'),
        occurrence('c2', { firstAuthor: 'Tran', year: 2021 }, 'Tran (2021)'),
        occurrence('c3', { firstAuthor: 'Smith', year: 2020 }, 'Smith (2020)'),
      ],
      [
        ref('r0', 'Doe', 'J', 2018),
        ref('r1', 'Le', 'M', 2019),
        ref('r2', 'Tran', 'V', 2024),
        ref('r3', 'Smith', 'J', 2020),
        ref('r4', 'Smith', 'J', 2020),
      ],
    );
    const mm = buildMatchMap(d);
    const run = () =>
      JSON.stringify(AUTHOR_DATE_RULES.flatMap((rule) => rule.run(ruleCtx(d, mm))));
    expect(run()).toBe(run());
  });

  it('produces the full expected multi-rule issue set on a mixed document', () => {
    // One document exercising every author-date defect: missing (CS001),
    // unused (CS002), year mismatch (CS003), ambiguity (CS004) and the
    // missing-suffix bibliography defect (CS005) all fire together.
    const d = doc(
      [
        occurrence('c0', { firstAuthor: 'Doe', year: 2018 }, 'Doe (2018)'),
        occurrence('c1', { firstAuthor: 'Xyz', year: 1999 }, 'Xyz (1999)'),
        occurrence('c2', { firstAuthor: 'Tran', year: 2021 }, 'Tran (2021)'),
        occurrence('c3', { firstAuthor: 'Smith', year: 2020 }, 'Smith (2020)'),
      ],
      [
        ref('r0', 'Doe', 'J', 2018), // CITED by c0
        ref('r1', 'Le', 'M', 2019), // UNUSED
        ref('r2', 'Tran', 'V', 2024), // near-miss of c2 → not matched → UNUSED
        ref('r3', 'Smith', 'J', 2020), // AMBIGUOUS_USAGE (c3)
        ref('r4', 'Smith', 'J', 2020), // AMBIGUOUS_USAGE (c3) + suffix cluster
      ],
    );
    const mm = buildMatchMap(d);
    const ctx = ruleCtx(d, mm);

    expect(ruleCS001.run(ctx).map((i) => i.id)).toEqual(['CS001:0']); // c1 Xyz
    expect(ruleCS002.run(ctx).map((i) => i.id)).toEqual(['CS002:0', 'CS002:1']); // r1, r2
    expect(ruleCS003.run(ctx).map((i) => i.id)).toEqual(['CS003:0']); // c2 Tran
    expect(ruleCS004.run(ctx).map((i) => i.id)).toEqual(['CS004:0']); // c3 Smith
    expect(ruleCS005.run(ctx).map((i) => i.id)).toEqual(['CS005:0', 'CS005:1']); // r3, r4

    const all = AUTHOR_DATE_RULES.flatMap((rule) => rule.run(ctx));
    expect(all.map((i) => i.id)).toEqual([
      'CS001:0',
      'CS002:0',
      'CS002:1',
      'CS003:0',
      'CS004:0',
      'CS005:0',
      'CS005:1',
    ]);
    // Every issue is a typed LintIssue: severity + evidence + sourceLoc present.
    for (const issue of all) {
      expect(issue.severity).toMatch(/^(ERROR|WARNING|AMBIGUOUS|INFO)$/);
      expect(issue.evidence.length).toBeGreaterThan(0);
      expect(issue.evidence.every((e) => e.code !== undefined && e.source !== undefined)).toBe(true);
      expect(issue.sourceLoc.blockId.length).toBeGreaterThan(0);
    }
  });
});
