/**
 * T4 — pure unit tests for the explorer helpers (node env, REAL fixtures).
 *
 * Runs `lintDocument` (from @citesync/core) over committed fixture bytes
 * (fixtures/** — git-tracked, never .gsd/), then asserts the four explorer
 * helpers against the real parse output:
 *
 *   - groupIssuesBySeverity: RULE_SEVERITIES order, empty groups dropped,
 *     intra-group order preserved;
 *   - sourceSpanForIssue: span-scoped offsets passthrough, entry-scoped
 *     whole-block, unknown blockId → null;
 *   - highlightParts: UTF-16 slice semantics (before/mark/after), undefined
 *     bounds → whole text as mark, out-of-range clamps like JS slice;
 *   - possibleReferencesForIssue: matchMap region join (candidateEntryIds on
 *     AMBIGUOUS, matchedEntryId on MATCHED), numericIndexMap token join,
 *     entry-scoped block resolution, absent map/entries → [] (never guess).
 *
 * Fixture ground truth verified against the engine (probe): CS004 rows carry
 * candidateEntryIds ['r0','r1'] (T1 surface); CS001 MISSING_REFERENCE rows
 * carry no ids; the below-threshold bibliography (ambiguous.docx) has
 * candidates but no entries.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintDocument } from '@citesync/core';
import type { AcademicDocument, LintIssue } from '@citesync/core';
import {
  groupIssuesBySeverity,
  highlightParts,
  possibleReferencesForIssue,
  sourceSpanForIssue,
} from '../src/explorer/explorer';

/** Committed fixtures root (apps/web/tests → ../../../fixtures). */
const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures', import.meta.url));

function lintFixture(...parts: string[]): { issues: LintIssue[]; doc: AcademicDocument } {
  return lintDocument(readFileSync(join(FIXTURES_DIR, ...parts)));
}

/** Minimal well-formed issue for synthetic cases. */
function syntheticIssue(
  overrides: Partial<LintIssue> & Pick<LintIssue, 'sourceLoc'>,
): LintIssue {
  return {
    id: 'CS000:0',
    ruleId: 'CS000',
    severity: 'INFO',
    message: 'synthetic',
    evidence: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// groupIssuesBySeverity
// ---------------------------------------------------------------------------

describe('groupIssuesBySeverity', () => {
  it('ambiguous-same-author-year: WARNING(2×CS005) then AMBIGUOUS(3×CS004), ERROR/INFO dropped', () => {
    const { issues } = lintFixture('match', 'ambiguous-same-author-year.docx');
    const groups = groupIssuesBySeverity(issues);
    expect(groups.map((g) => g.severity)).toEqual(['WARNING', 'AMBIGUOUS']);
    expect(groups[0]!.issues.map((i) => i.id)).toEqual(['CS005:0', 'CS005:1']);
    expect(groups[1]!.issues.map((i) => i.id)).toEqual(['CS004:0', 'CS004:1', 'CS004:2']);
  });

  it('empty input → no groups', () => {
    expect(groupIssuesBySeverity([])).toEqual([]);
  });

  it('a lone ERROR issue yields exactly one ERROR group (severity order first)', () => {
    const issue = syntheticIssue({
      id: 'CS001:0',
      ruleId: 'CS001',
      severity: 'ERROR',
      sourceLoc: { blockId: 'b0', startOffset: 0, endOffset: 4 },
    });
    const groups = groupIssuesBySeverity([issue]);
    expect(groups.map((g) => g.severity)).toEqual(['ERROR']);
    expect(groups[0]!.issues).toEqual([issue]);
  });
});

// ---------------------------------------------------------------------------
// sourceSpanForIssue + highlightParts
// ---------------------------------------------------------------------------

describe('sourceSpanForIssue', () => {
  it('CS004 span-scoped issue → block + exact offsets (doc-p1 [0,12))', () => {
    const { issues, doc } = lintFixture('match', 'ambiguous-same-author-year.docx');
    const issue = issues.find((i) => i.id === 'CS004:0')!;
    const span = sourceSpanForIssue(doc, issue);
    expect(span).not.toBeNull();
    expect(span!.block.id).toBe('doc-p1');
    expect(span!.start).toBe(0);
    expect(span!.end).toBe(12);
    expect(span!.block.text.slice(span!.start, span!.end)).toBe('Smith (2020)');
  });

  it('CS001 span-scoped issue → the exact "(Doe, 2017)" text', () => {
    const { issues, doc } = lintFixture('bibliography', 'ambiguous.docx');
    const issue = issues.find((i) => i.id === 'CS001:0')!;
    const span = sourceSpanForIssue(doc, issue)!;
    expect(span.block.id).toBe('doc-p2');
    expect(span.block.text.slice(span.start, span.end)).toBe('(Doe, 2017)');
  });

  it('entry-scoped issue (blockId only) → whole block, offsets undefined', () => {
    const { doc } = lintFixture('match', 'ambiguous-same-author-year.docx');
    const issue = syntheticIssue({
      id: 'CS002:0',
      ruleId: 'CS002',
      severity: 'WARNING',
      sourceLoc: { blockId: 'doc-p3' },
    });
    const span = sourceSpanForIssue(doc, issue);
    expect(span).not.toBeNull();
    expect(span!.block.id).toBe('doc-p3');
    expect(span!.start).toBeUndefined();
    expect(span!.end).toBeUndefined();
  });

  it('unknown blockId → null (never a fabricated highlight target)', () => {
    const { doc } = lintFixture('bibliography', 'ambiguous.docx');
    const issue = syntheticIssue({ sourceLoc: { blockId: 'no-such-block' } });
    expect(sourceSpanForIssue(doc, issue)).toBeNull();
  });
});

describe('highlightParts', () => {
  it('splits before/mark/after on UTF-16 slice semantics', () => {
    const text = 'Smith (2020) appears twice';
    const parts = highlightParts(text, 0, 12);
    expect(parts).toEqual({ before: '', mark: 'Smith (2020)', after: ' appears twice' });
  });

  it('round-trips: before + mark + after === text', () => {
    const text = 'Recent work (Doe, 2017) highlights';
    const parts = highlightParts(text, 12, 23);
    expect(parts.mark).toBe('(Doe, 2017)');
    expect(parts.before + parts.mark + parts.after).toBe(text);
  });

  it('start=0 / end=text.length selects the whole text', () => {
    const text = 'abc';
    expect(highlightParts(text, 0, text.length)).toEqual({
      before: '',
      mark: 'abc',
      after: '',
    });
  });

  it('out-of-range bounds clamp like JS slice (never throws)', () => {
    const text = 'abc';
    expect(highlightParts(text, 5, 10)).toEqual({ before: 'abc', mark: '', after: '' });
    expect(highlightParts(text, 1, 99)).toEqual({ before: 'a', mark: 'bc', after: '' });
    expect(highlightParts(text, -2, 3)).toEqual({ before: 'a', mark: 'bc', after: '' });
  });

  it('undefined bounds → whole text as mark (entry-scoped highlight)', () => {
    const text = 'Smith, J. (2020). First book on citation analysis.';
    expect(highlightParts(text, undefined, undefined)).toEqual({
      before: '',
      mark: text,
      after: '',
    });
  });
});

// ---------------------------------------------------------------------------
// possibleReferencesForIssue
// ---------------------------------------------------------------------------

describe('possibleReferencesForIssue', () => {
  it('AMBIGUOUS span issue → candidateEntryIds resolved to [r0, r1] (Smith, J. 2020 pair)', () => {
    const { issues, doc } = lintFixture('match', 'ambiguous-same-author-year.docx');
    const issue = issues.find((i) => i.id === 'CS004:0')!;
    const refs = possibleReferencesForIssue(doc, issue);
    expect(refs.map((r) => r.id)).toEqual(['r0', 'r1']);
    // Both are the Smith, J. 2020 entries the citation tied on (never LLM):
    // r0 = First book (doc-p3), r1 = Second book (doc-p4).
    for (const ref of refs) expect(ref.raw.startsWith('Smith, J. (2020)')).toBe(true);
    expect(refs[0]!.raw).toContain('First book');
    expect(refs[1]!.raw).toContain('Second book');
    expect(refs[0]!.source.blockId).toBe('doc-p3');
    expect(refs[1]!.source.blockId).toBe('doc-p4');
  });

  it('MISSING_REFERENCE span issue (no matched/candidate ids) → []', () => {
    const { issues, doc } = lintFixture('bibliography', 'ambiguous.docx');
    const issue = issues.find((i) => i.id === 'CS001:0')!;
    // matchMap row exists but is MISSING_REFERENCE (no ids); below-threshold
    // bibliography has candidates but NO entries → never guess, [].
    expect(possibleReferencesForIssue(doc, issue)).toEqual([]);
  });

  it('MATCHED span issue → matchedEntryId resolved (synthetic issue over a real doc)', () => {
    const { doc } = lintFixture('match', 'same-author-two-years.docx');
    // Synthetic span-scoped issue whose region equals citation c0's source.
    const issue = syntheticIssue({
      id: 'CS000:0',
      sourceLoc: { blockId: 'doc-p1', startOffset: 0, endOffset: 10 },
    });
    const refs = possibleReferencesForIssue(doc, issue);
    expect(refs.map((r) => r.id)).toEqual(['r0']);
    expect(refs[0]!.raw.startsWith('Doe, J. (2018)')).toBe(true);
  });

  it('numericIndexMap resolved token → resolvedEntryId (synthetic issue over a real doc)', () => {
    const { doc } = lintFixture('numeric', 'out-of-range.docx');
    // c0's token index 1 is RESOLVED at region (doc-p1, 12, 13); the CS008
    // issues at (44,45)/(65,66) are out-of-range/unmatched → no ids.
    const issue = syntheticIssue({
      id: 'CS008:0',
      severity: 'ERROR',
      sourceLoc: { blockId: 'doc-p1', startOffset: 12, endOffset: 13 },
    });
    const refs = possibleReferencesForIssue(doc, issue);
    expect(refs.map((r) => r.id)).toEqual(['r0']);
  });

  it('entry-scoped issue → the entries in that block, bibliography order', () => {
    const { doc } = lintFixture('match', 'ambiguous-same-author-year.docx');
    const issue = syntheticIssue({
      id: 'CS002:0',
      ruleId: 'CS002',
      severity: 'WARNING',
      sourceLoc: { blockId: 'doc-p3' },
    });
    const refs = possibleReferencesForIssue(doc, issue);
    expect(refs.map((r) => r.id)).toEqual(['r0']);
    expect(refs[0]!.source.blockId).toBe('doc-p3');
  });

  it('matchMap/numericIndexMap absent → [] (never guess)', () => {
    const { issues, doc } = lintFixture('match', 'ambiguous-same-author-year.docx');
    const issue = issues.find((i) => i.id === 'CS004:0')!;
    const stripped: AcademicDocument = { ...doc, matchMap: undefined, numericIndexMap: undefined };
    // Entries are present, but with no maps there is no join surface at all.
    expect(possibleReferencesForIssue(stripped, issue)).toEqual([]);
  });

  it('bibliography.entries absent → [] even when a matchMap row matches the region', () => {
    const { issues, doc } = lintFixture('bibliography', 'ambiguous.docx');
    const issue = issues.find((i) => i.id === 'CS001:0')!;
    // Below-threshold doc: matchMap row exists at the region but the
    // bibliography carries no entries — the helper must return [].
    expect(doc.bibliography?.entries).toBeUndefined();
    expect(possibleReferencesForIssue(doc, issue)).toEqual([]);
  });
});
