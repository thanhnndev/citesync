/**
 * M002-S02-T3 — numeric + parse-failure rules CS006–CS009 tests.
 *
 * Each rule is tested both on hand-built fixtures (exact control of the
 * trigger condition) and through the real pipeline pieces it consumes
 * (`buildNumericIndexMap` for CS008/CS009, `parseReferences` for CS006,
 * the numeric grammar's invalid surface for CS007). Assertions cover:
 * correct trigger condition per rule, typed issues with severity +
 * evidence + sourceLoc, no-fire on clean numeric docs, absent-map
 * conservatism (no fabricated binding state), the cross-family guard on
 * CS009, deterministic byte-identical re-runs (R008), and severity
 * defaults. All fixtures are inline literals — no I/O, no locale calls.
 */

import { describe, expect, it } from 'vitest';

import type {
  AcademicDocument,
  BibliographySection,
  CitationOccurrence,
  DocumentBlock,
  MatchMap,
  NumericIndexMap,
  NumericIndexToken,
  ReferenceEntry,
  ReferenceParseIssue,
  RuleContext,
  SourceLocation,
} from '@citesync/document-model';

import {
  buildNumericIndexMap,
  NUMERIC_RULES,
  parseReferences,
  ruleCS006,
  ruleCS007,
  ruleCS008,
  ruleCS009,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// Fixture helpers — realistic literals (same shapes S01/S03 produce).
// ---------------------------------------------------------------------------

/** A minimal synthetic block (only id/text/source are read). */
function makeBlock(
  text: string,
  id = 'b1',
  paragraphIndex?: number,
): DocumentBlock {
  return {
    id,
    type: 'paragraph',
    text,
    source: {
      blockId: id,
      ...(paragraphIndex !== undefined ? { paragraphIndex } : {}),
    },
  };
}

/** A minimal bibliography entry with a stable id and zero-based index. */
function makeEntry(id: string, index: number): ReferenceEntry {
  const raw = `raw ${id}`;
  return {
    id,
    raw,
    index,
    source: { blockId: `ref-${id}`, startOffset: 0, endOffset: raw.length },
    parseConfidence: 1,
  };
}

/** One §20 numeric-family citation occurrence literal. */
function numOcc(
  id: string,
  numbers: number[],
  source: SourceLocation,
): CitationOccurrence {
  return {
    id,
    raw: `[${numbers.join(',')}]`,
    family: 'numeric',
    items: [{ numbers }],
    source,
    confidence: 0.97,
  };
}

/** A detected bibliography section over the given entries. */
function bib(entries: ReferenceEntry[]): BibliographySection {
  return {
    outcome: 'detected',
    heading: 'References',
    blockIds: entries.map((e) => e.source.blockId),
    entries,
  };
}

/**
 * Minimal AcademicDocument literal. `entries === undefined` → no
 * bibliography; extra doc fields (referenceParseIssues / numericIndexMap /
 * matchMap) are attached only when provided (mirrors buildModel's
 * conditional emission).
 */
function doc(
  blocks: DocumentBlock[],
  entries: ReferenceEntry[] | undefined,
  opts: {
    citations?: CitationOccurrence[];
    referenceParseIssues?: ReferenceParseIssue[];
    numericIndexMap?: NumericIndexMap;
    matchMap?: MatchMap;
  } = {},
): AcademicDocument {
  return {
    metadata: {},
    blocks,
    citations: opts.citations ?? [],
    ...(entries !== undefined ? { bibliography: bib(entries) } : {}),
    ...(opts.referenceParseIssues !== undefined
      ? { referenceParseIssues: opts.referenceParseIssues }
      : {}),
    ...(opts.numericIndexMap !== undefined ? { numericIndexMap: opts.numericIndexMap } : {}),
    ...(opts.matchMap !== undefined ? { matchMap: opts.matchMap } : {}),
    sourceMap: { version: 1, blocks: {} },
  };
}

/** One D016 map row literal (hand-built for exact trigger control). */
function mapRow(
  citationId: string,
  tokens: NumericIndexToken[],
): NumericIndexMap['citations'][number] {
  return { citationId, tokens };
}

/** A resolved numeric token literal. */
function resolvedToken(
  index: number,
  entryId: string,
  source: SourceLocation,
): NumericIndexToken {
  return { index, status: 'resolved', resolvedEntryId: entryId, source };
}

/** An out-of-range / unmatched numeric token literal. */
function badToken(
  index: number,
  status: 'out-of-range' | 'unmatched',
  source: SourceLocation,
): NumericIndexToken {
  return { index, status, source };
}

/** The frozen rule ctx over a fixture doc (map/status overridable). */
function ruleCtx(
  d: AcademicDocument,
  overrides: {
    numericIndexMap?: NumericIndexMap | undefined;
    matchMap?: MatchMap | undefined;
  } = {},
): RuleContext {
  return {
    doc: d,
    matchMap: overrides.matchMap === undefined ? d.matchMap : overrides.matchMap,
    numericIndexMap:
      overrides.numericIndexMap === undefined
        ? d.numericIndexMap
        : overrides.numericIndexMap,
    bibliography: d.bibliography,
    citations: d.citations,
  };
}

const SRC: SourceLocation = { blockId: 'b1', startOffset: 0, endOffset: 5 };

// ---------------------------------------------------------------------------
// Severity defaults (PRD §33–§35 + the missing-reference analog).
// ---------------------------------------------------------------------------

describe('numeric rules — severity defaults', () => {
  it('pins each rule to its severity', () => {
    expect(ruleCS006.severity).toBe('ERROR'); // unanalyzable entry
    expect(ruleCS007.severity).toBe('WARNING'); // malformed bracket
    expect(ruleCS008.severity).toBe('ERROR'); // cites nothing (CS001 analog)
    expect(ruleCS009.severity).toBe('WARNING'); // housekeeping (CS002 analog)
  });
});

// ---------------------------------------------------------------------------
// CS006 — Citation / Reference Parse Failure.
// ---------------------------------------------------------------------------

describe('CS006 — citation/reference parse failure', () => {
  it('fires on §88 referenceParseIssues with severity + evidence + sourceLoc', () => {
    const r0 = makeEntry('r0', 0);
    const r1 = makeEntry('r1', 1);
    const d = doc([], [r0, r1], {
      referenceParseIssues: [
        {
          blockId: r1.source.blockId,
          index: 1,
          raw: 'Junk without a year.',
          code: 'reference-parse',
          message: 'no (YYYY) year marker',
        },
      ],
    });
    const issues = ruleCS006.run(ruleCtx(d));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.id).toBe('CS006:0');
    expect(issues[0]!.ruleId).toBe('CS006');
    expect(issues[0]!.severity).toBe('ERROR');
    expect(issues[0]!.message).toContain('Junk without a year.');
    expect(issues[0]!.message).toContain('no (YYYY) year marker');
    expect(issues[0]!.evidence).toEqual([
      {
        code: 'reference-parse',
        message: 'no (YYYY) year marker',
        source: r1.source,
      },
    ]);
    expect(issues[0]!.sourceLoc).toEqual(r1.source);
  });

  it('fires on real §88 failures through the parseReferences pipeline', () => {
    const blocks = [
      makeBlock('Doe, J. (2023). Artificial Intelligence. Journal of AI.', 'bib-0'),
      makeBlock('This is not a reference at all.', 'bib-1'),
    ];
    const d = doc(blocks, undefined);
    d.bibliography = {
      outcome: 'detected',
      heading: 'References',
      blockIds: ['bib-0', 'bib-1'],
      entries: [],
    };
    const { entries, issues } = parseReferences(d);
    d.bibliography.entries = entries;
    if (issues.length > 0) d.referenceParseIssues = issues;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toBe('no (YYYY) year marker');
    expect(entries[1]!.parseConfidence).toBe(0);
    const result = ruleCS006.run(ruleCtx(d));
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('CS006:0');
    expect(result[0]!.severity).toBe('ERROR');
    expect(result[0]!.message).toContain('This is not a reference at all.');
    expect(result[0]!.evidence[0]!.code).toBe('reference-parse');
    expect(result[0]!.sourceLoc).toEqual(entries[1]!.source);
  });

  it('emits one issue per failure in section order (stable ids)', () => {
    const r1 = makeEntry('r1', 1);
    const r2 = makeEntry('r2', 2);
    const d = doc([], [makeEntry('r0', 0), r1, r2], {
      referenceParseIssues: [
        { blockId: 'ref-r1', index: 1, raw: 'a', code: 'reference-parse', message: 'no (YYYY) year marker' },
        { blockId: 'ref-r2', index: 2, raw: 'b', code: 'reference-parse', message: 'no author segment before the year' },
      ],
    });
    const issues = ruleCS006.run(ruleCtx(d));
    expect(issues.map((i) => i.id)).toEqual(['CS006:0', 'CS006:1']);
    // Index-aligned: evidence points at the bibliography entry's R009 source.
    expect(issues.map((i) => i.sourceLoc)).toEqual([r1.source, r2.source]);
  });

  it('falls back to a block-range source when the bibliography lacks the entry', () => {
    // referenceParseIssues index 5 has no matching bibliography entry — the
    // failure is still surfaced (§79) via the block-derived source.
    const d = doc([makeBlock('Junk without a year.', 'ref-x')], [makeEntry('r0', 0)], {
      referenceParseIssues: [
        {
          blockId: 'ref-x',
          index: 5,
          raw: 'Junk without a year.',
          code: 'reference-parse',
          message: 'no (YYYY) year marker',
        },
      ],
    });
    const issues = ruleCS006.run(ruleCtx(d));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.sourceLoc).toEqual({
      blockId: 'ref-x',
      startOffset: 0,
      endOffset: 'Junk without a year.'.length,
    });
  });

  it('emits nothing when there are no referenceParseIssues', () => {
    const d = doc([], [makeEntry('r0', 0)]);
    expect(ruleCS006.run(ruleCtx(d))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// CS007 — Invalid Numeric Citation.
// ---------------------------------------------------------------------------

describe('CS007 — invalid numeric citation', () => {
  it('fires on a malformed bracket ([4-1]) with WARNING + invalid-numeric evidence', () => {
    const d = doc([makeBlock('see [4-1] for details')], undefined);
    const issues = ruleCS007.run(ruleCtx(d));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.id).toBe('CS007:0');
    expect(issues[0]!.ruleId).toBe('CS007');
    expect(issues[0]!.severity).toBe('WARNING');
    expect(issues[0]!.message).toContain('[4-1]');
    expect(issues[0]!.message).toContain('malformed');
    expect(issues[0]!.evidence[0]!.code).toBe('invalid-numeric');
    // R009 round-trip: the source span selects exactly the bracket.
    const { startOffset, endOffset } = issues[0]!.sourceLoc;
    expect(d.blocks[0]!.text.slice(startOffset!, endOffset!)).toBe('[4-1]');
  });

  it('fires on a mixed bracket ([1, x]) with the mixed reason message', () => {
    const d = doc([makeBlock('see [1, x]')], undefined);
    const issues = ruleCS007.run(ruleCtx(d));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain('mixes numeric indices');
    expect(issues[0]!.message).toContain('[1, x]');
    expect(issues[0]!.evidence[0]!.message).toContain('non-numeric');
  });

  it('emits one issue per invalid bracket in document order (stable ids)', () => {
    const d = doc([makeBlock('see [1, x] and [4-1] and [1a]')], undefined);
    const issues = ruleCS007.run(ruleCtx(d));
    expect(issues.map((i) => i.id)).toEqual(['CS007:0', 'CS007:1', 'CS007:2']);
    expect(issues.map((i) => i.message)).toEqual([
      expect.stringContaining('[1, x]'),
      expect.stringContaining('[4-1]'),
      expect.stringContaining('[1a]'),
    ]);
  });

  it('does not fire on clean numeric citations, ranges or prose brackets', () => {
    const d = doc([makeBlock('Evidence [1] and [2,4-5]; prose [Figure 2] stays clean.')], undefined);
    expect(ruleCS007.run(ruleCtx(d))).toEqual([]);
  });

  it('carries the block paragraphIndex into the bracket source (R009)', () => {
    const d = doc([makeBlock('see [4-1]', 'b1', 3)], undefined);
    const issues = ruleCS007.run(ruleCtx(d));
    expect(issues[0]!.sourceLoc).toMatchObject({ blockId: 'b1', paragraphIndex: 3 });
  });
});

// ---------------------------------------------------------------------------
// CS008 — Missing Numeric Reference.
// ---------------------------------------------------------------------------

describe('CS008 — missing numeric reference', () => {
  it('fires on an out-of-range token with ERROR + the D016 status as evidence code', () => {
    const d = doc([], [makeEntry('r0', 0), makeEntry('r1', 1)], {
      citations: [numOcc('c0', [3], SRC)],
      numericIndexMap: {
        version: 1,
        citations: [mapRow('c0', [badToken(3, 'out-of-range', SRC)])],
      },
    });
    const issues = ruleCS008.run(ruleCtx(d));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.id).toBe('CS008:0');
    expect(issues[0]!.ruleId).toBe('CS008');
    expect(issues[0]!.severity).toBe('ERROR');
    expect(issues[0]!.message).toContain('index 3 is out of range');
    expect(issues[0]!.message).toContain('2 entries');
    expect(issues[0]!.evidence).toEqual([
      { code: 'out-of-range', message: issues[0]!.message, source: SRC },
    ]);
    expect(issues[0]!.sourceLoc).toEqual(SRC);
  });

  it('fires on an unmatched token ([0]) with the unmatched message', () => {
    const d = doc([], [makeEntry('r0', 0)], {
      citations: [numOcc('c0', [0], SRC)],
      numericIndexMap: {
        version: 1,
        citations: [mapRow('c0', [badToken(0, 'unmatched', SRC)])],
      },
    });
    const issues = ruleCS008.run(ruleCtx(d));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain('not a valid 1-based reference position');
    expect(issues[0]!.evidence[0]!.code).toBe('unmatched');
  });

  it('skips resolved tokens while flagging only the bad ones in one bracket', () => {
    const d = doc([], [makeEntry('r0', 0), makeEntry('r1', 1), makeEntry('r2', 2)], {
      citations: [numOcc('c0', [1, 5], SRC)],
      numericIndexMap: {
        version: 1,
        citations: [
          mapRow('c0', [
            resolvedToken(1, 'r0', SRC),
            badToken(5, 'out-of-range', SRC),
          ]),
        ],
      },
    });
    const issues = ruleCS008.run(ruleCtx(d));
    expect(issues.map((i) => i.id)).toEqual(['CS008:0']);
    expect(issues[0]!.message).toContain('index 5');
  });

  it('fires on a real out-of-range citation through buildNumericIndexMap', () => {
    const entries = [makeEntry('r0', 0), makeEntry('r1', 1), makeEntry('r2', 2), makeEntry('r3', 3)];
    const d = doc([makeBlock('see [1] and [5]')], entries);
    d.citations = [
      numOcc('c0', [1], { blockId: 'b1', startOffset: 4, endOffset: 7 }),
      numOcc('c1', [5], { blockId: 'b1', startOffset: 12, endOffset: 15 }),
    ];
    d.numericIndexMap = buildNumericIndexMap(d);
    const issues = ruleCS008.run(ruleCtx(d));
    expect(issues.map((i) => i.id)).toEqual(['CS008:0']);
    expect(issues[0]!.message).toContain('index 5');
    expect(issues[0]!.message).toContain('4 entries');
    // Token-level source: the span selects exactly "5" in the block text.
    const { startOffset, endOffset } = issues[0]!.sourceLoc;
    expect(d.blocks[0]!.text.slice(startOffset!, endOffset!)).toBe('5');
  });

  it('does not fire when every token is resolved', () => {
    const d = doc([], [makeEntry('r0', 0), makeEntry('r1', 1)], {
      citations: [numOcc('c0', [1, 2], SRC)],
      numericIndexMap: {
        version: 1,
        citations: [
          mapRow('c0', [
            resolvedToken(1, 'r0', SRC),
            resolvedToken(2, 'r1', SRC),
          ]),
        ],
      },
    });
    expect(ruleCS008.run(ruleCtx(d))).toEqual([]);
  });

  it('emits nothing when numericIndexMap is absent — no fabricated binding (§79)', () => {
    const d = doc([], [makeEntry('r0', 0)], { citations: [numOcc('c0', [1], SRC)] });
    expect(ruleCS008.run(ruleCtx(d))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// CS009 — Unused Numeric Reference.
// ---------------------------------------------------------------------------

describe('CS009 — unused numeric reference', () => {
  it('fires on bibliography entries never bound by any resolved token', () => {
    const r0 = makeEntry('r0', 0);
    const r1 = makeEntry('r1', 1);
    const r2 = makeEntry('r2', 2);
    const d = doc([], [r0, r1, r2], {
      citations: [numOcc('c0', [1], SRC)],
      numericIndexMap: {
        version: 1,
        citations: [mapRow('c0', [resolvedToken(1, 'r0', SRC)])],
      },
    });
    const issues = ruleCS009.run(ruleCtx(d));
    expect(issues).toHaveLength(2);
    expect(issues.map((i) => i.id)).toEqual(['CS009:0', 'CS009:1']);
    expect(issues.map((i) => i.sourceLoc)).toEqual([r1.source, r2.source]);
    for (const issue of issues) {
      expect(issue.severity).toBe('WARNING');
      expect(issue.message).toContain('never cited by any numeric citation');
      expect(issue.evidence).toEqual([
        {
          code: 'unused',
          message: 'Bibliography entry is never cited by any numeric citation.',
          source: issue.sourceLoc,
        },
      ]);
    }
  });

  it('does not flag entries bound by numeric citations (including range expansion)', () => {
    const r0 = makeEntry('r0', 0);
    const r1 = makeEntry('r1', 1);
    const r2 = makeEntry('r2', 2);
    const d = doc([], [r0, r1, r2], {
      citations: [numOcc('c0', [1, 2, 3], SRC)],
      numericIndexMap: {
        version: 1,
        citations: [
          mapRow('c0', [
            resolvedToken(1, 'r0', SRC),
            resolvedToken(2, 'r1', SRC),
            resolvedToken(3, 'r2', SRC),
          ]),
        ],
      },
    });
    expect(ruleCS009.run(ruleCtx(d))).toEqual([]);
  });

  it('skips entries the author-date family cites (cross-family guard)', () => {
    const r0 = makeEntry('r0', 0);
    const r1 = makeEntry('r1', 1);
    const mm: MatchMap = {
      version: 1,
      citations: [],
      entryStatus: [
        { entryId: 'r0', status: 'CITED' }, // cited by an author-date citation
        { entryId: 'r1', status: 'UNUSED' },
      ],
    };
    const d = doc([], [r0, r1], {
      citations: [numOcc('c0', [1], SRC)],
      numericIndexMap: {
        version: 1,
        citations: [mapRow('c0', [resolvedToken(1, 'r1', SRC)])],
      },
      matchMap: mm,
    });
    // r0 used via author-date, r1 used via numeric — nothing is unused.
    expect(ruleCS009.run(ruleCtx(d))).toEqual([]);
  });

  it('stays inert when the author-date rows are all UNUSED (pure numeric doc)', () => {
    const r0 = makeEntry('r0', 0);
    const r1 = makeEntry('r1', 1);
    const mm: MatchMap = {
      version: 1,
      citations: [],
      entryStatus: [
        { entryId: 'r0', status: 'UNUSED' },
        { entryId: 'r1', status: 'UNUSED' },
      ],
    };
    const d = doc([], [r0, r1], {
      citations: [numOcc('c0', [1], SRC)],
      numericIndexMap: {
        version: 1,
        citations: [mapRow('c0', [resolvedToken(1, 'r0', SRC)])],
      },
      matchMap: mm,
    });
    const issues = ruleCS009.run(ruleCtx(d));
    expect(issues.map((i) => i.id)).toEqual(['CS009:0']);
    expect(issues[0]!.sourceLoc).toEqual(r1.source);
  });

  it('emits nothing when numericIndexMap is absent or empty — no evidence to judge', () => {
    const d = doc([], [makeEntry('r0', 0), makeEntry('r1', 1)], {
      citations: [numOcc('c0', [1], SRC)],
    });
    expect(ruleCS009.run(ruleCtx(d))).toEqual([]);
    const empty: NumericIndexMap = { version: 1, citations: [] };
    expect(ruleCS009.run(ruleCtx(d, { numericIndexMap: empty }))).toEqual([]);
  });

  it('emits nothing when the bibliography is empty', () => {
    const d = doc([], [], {
      numericIndexMap: { version: 1, citations: [mapRow('c0', [])] },
    });
    expect(ruleCS009.run(ruleCtx(d))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Whole-ruleset behavior.
// ---------------------------------------------------------------------------

describe('numeric rules — clean docs, determinism, integration', () => {
  it('no rule fires on a clean numeric document', () => {
    const entries = [makeEntry('r0', 0), makeEntry('r1', 1)];
    const d = doc([makeBlock('Evidence [1] and [2]; prose [Figure 2] is ignored.')], entries);
    d.citations = [
      numOcc('c0', [1], { blockId: 'b1', startOffset: 9, endOffset: 12 }),
      numOcc('c1', [2], { blockId: 'b1', startOffset: 17, endOffset: 20 }),
    ];
    d.numericIndexMap = buildNumericIndexMap(d);
    const ctx = ruleCtx(d);
    expect(ctx.numericIndexMap!.citations[0]!.tokens[0]!.status).toBe('resolved');
    for (const rule of NUMERIC_RULES) {
      expect(rule.run(ctx)).toEqual([]);
    }
  });

  it('is deterministic — byte-identical re-run across every rule (R008)', () => {
    const entries = [
      makeEntry('r0', 0),
      makeEntry('r1', 1),
      makeEntry('r2', 2),
    ];
    const d = doc(
      [makeBlock('See [1, x], [2-3] and [0].')],
      entries,
      {
        referenceParseIssues: [
          {
            blockId: 'ref-r2',
            index: 2,
            raw: 'Junk without a year.',
            code: 'reference-parse',
            message: 'no (YYYY) year marker',
          },
        ],
      },
    );
    d.citations = [
      numOcc('c0', [2, 3], { blockId: 'b1', startOffset: 12, endOffset: 17 }),
      numOcc('c1', [0], { blockId: 'b1', startOffset: 22, endOffset: 25 }),
    ];
    d.numericIndexMap = buildNumericIndexMap(d);
    const ctx = ruleCtx(d);
    const run = () =>
      JSON.stringify(NUMERIC_RULES.flatMap((rule) => rule.run(ctx)));
    expect(run()).toBe(run());
  });

  it('produces the full expected multi-rule issue set on a mixed document', () => {
    const entries = [
      makeEntry('r0', 0), // never cited → CS009
      makeEntry('r1', 1), // cited by [2-3] range
      makeEntry('r2', 2), // cited by [2-3] range AND unparseable → CS006
    ];
    const d = doc(
      [makeBlock('See [1, x], [2-3] and [0].')],
      entries,
      {
        referenceParseIssues: [
          {
            blockId: 'ref-r2',
            index: 2,
            raw: 'Junk without a year.',
            code: 'reference-parse',
            message: 'no (YYYY) year marker',
          },
        ],
      },
    );
    d.citations = [
      numOcc('c0', [2, 3], { blockId: 'b1', startOffset: 12, endOffset: 17 }),
      numOcc('c1', [0], { blockId: 'b1', startOffset: 22, endOffset: 25 }),
    ];
    d.numericIndexMap = buildNumericIndexMap(d);
    const ctx = ruleCtx(d);

    expect(ruleCS006.run(ctx).map((i) => i.id)).toEqual(['CS006:0']); // r2 parse failure
    expect(ruleCS007.run(ctx).map((i) => i.id)).toEqual(['CS007:0']); // [1, x] invalid
    expect(ruleCS008.run(ctx).map((i) => i.id)).toEqual(['CS008:0']); // [0] unmatched
    expect(ruleCS009.run(ctx).map((i) => i.id)).toEqual(['CS009:0']); // r0 unused

    const all = NUMERIC_RULES.flatMap((rule) => rule.run(ctx));
    expect(all.map((i) => i.id)).toEqual([
      'CS006:0',
      'CS007:0',
      'CS008:0',
      'CS009:0',
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
