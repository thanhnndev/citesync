/**
 * S04-T4 — fixture-driven §27 match-state ground-truth tests (R007/R008).
 *
 * Asserts the committed fixture corpus (authored by `scripts/make-fixtures.ts`)
 * through the PUBLIC `parseDocument` entry — never internal helpers — against
 * the KNOWN_MATCHES ground truth in `scripts/fixture-ground-truth-matches.ts`:
 *
 *   - every covered fixture's `doc.matchMap` deep-equals the projected table
 *     (citationId/relationship/matchedEntryId/score/tier/confidence/reasons
 *     per citation + the bibliography-side entryStatus rows), in document
 *     order with contiguous ids c0..cN / r0..rN (R008);
 *   - the §79 false-positive guards, pinned end-to-end: a wrong-YEAR pairing
 *     is never a confident MATCHED (same-author-two-years), an author+year
 *     tie is AMBIGUOUS with no auto-pick (ambiguous-same-author-year), a
 *     contradicting given initial is a low-confidence POSSIBLE_MISMATCH
 *     (near-miss-author), Nguyễn/Nguyen stays on the diacritic-insensitive
 *     tier while Đỗ/Do stays DISTINCT (near-miss-vietnamese), and every
 *     absent-target fixture is all MISSING_REFERENCE — the engine never
 *     silently guesses (§79/R004);
 *   - bibliography-side ownership: a MATCHED entry is CITED, an entry only
 *     ever appearing in an AMBIGUOUS resolution is AMBIGUOUS_USAGE, and an
 *     entry no citation references is UNUSED (inline doc — the committed
 *     corpus references every entry by construction).
 *
 * Ground truth is byte-stable (R008): any change to the fixture bytes, the
 * model shape, the scorer, the thresholds or the orchestration policy drifts
 * these rows and the deep-equal fails. Fixtures are git-tracked committed
 * files read via node:fs (never .gsd/ or any gitignored path).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type {
  AcademicDocument,
  AuthorDateCitationItem,
  CitationMatchResult,
  CitationOccurrence,
  ReferenceEntry,
} from '@citesync/document-model';

import { buildMatchMap, buildNameKey, parseDocument } from '../src/index.js';
import { KNOWN_MATCHES } from '../../../scripts/fixture-ground-truth-matches.js';

const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/', import.meta.url));

/** Fixtures whose KNOWN_MATCHES row is fully empty (no map is emitted). */
const EMPTY_MATCH_FIXTURES = Object.keys(KNOWN_MATCHES).filter(
  (rel) =>
    KNOWN_MATCHES[rel]!.citations.length === 0 && KNOWN_MATCHES[rel]!.entryStatus.length === 0,
);

/** Project a real §27 result onto the KNOWN_MATCHES row shape. */
function projectMatch(r: CitationMatchResult) {
  return {
    citationId: r.citationId,
    relationship: r.relationship,
    ...(r.matchedEntryId !== undefined ? { matchedEntryId: r.matchedEntryId } : {}),
    score: r.score,
    tier: r.tier,
    confidence: r.confidence,
    reasons: r.reasons,
  };
}

// ---------------------------------------------------------------------------
// Fixture-driven deep-equal ground truth.
// ---------------------------------------------------------------------------

describe('S04 matching — KNOWN_MATCHES ground truth (per fixture)', () => {
  it('produces exactly the documented §27 match map for every covered fixture', () => {
    for (const rel of Object.keys(KNOWN_MATCHES)) {
      const doc = parseDocument(readFileSync(join(FIXTURES_DIR, rel)));
      const expected = KNOWN_MATCHES[rel]!;

      if (EMPTY_MATCH_FIXTURES.includes(rel)) {
        // vba-sample: no citations, no entries — buildModel emits no map.
        expect(doc.matchMap, rel).toBeUndefined();
        continue;
      }

      expect(doc.matchMap, `${rel} matchMap present`).toBeDefined();
      const map = doc.matchMap!;
      expect(map.version, rel).toBe(1);
      expect(map.citations.length, `${rel} citation row count`).toBe(expected.citations.length);

      for (let i = 0; i < expected.citations.length; i++) {
        const exp = expected.citations[i]!;
        const act = map.citations[i]!;
        expect(act.citationId, `${rel} c${i} id`).toBe(exp.citationId);
        expect(act.relationship, `${rel} c${i} relationship`).toBe(exp.relationship);
        expect(act.matchedEntryId, `${rel} c${i} entry`).toBe(exp.matchedEntryId);
        // Float score/confidence — toBeCloseTo (MEM032), 4-decimal-rounded.
        expect(act.score, `${rel} c${i} score`).toBeCloseTo(exp.score, 4);
        expect(act.tier, `${rel} c${i} tier`).toBe(exp.tier);
        expect(act.confidence, `${rel} c${i} confidence`).toBeCloseTo(exp.confidence, 4);
        expect(act.reasons, `${rel} c${i} reasons`).toEqual(exp.reasons);
      }

      expect(map.entryStatus, `${rel} entryStatus`).toEqual(expected.entryStatus);
    }
  });

  it('orders citation rows like doc.citations and entryStatus like bibliography entries (R008)', () => {
    for (const rel of Object.keys(KNOWN_MATCHES)) {
      const doc = parseDocument(readFileSync(join(FIXTURES_DIR, rel)));
      if (doc.matchMap === undefined) continue;
      expect(doc.matchMap!.citations.map((c) => c.citationId), rel).toEqual(
        doc.citations.map((c) => c.id),
      );
      expect(doc.matchMap!.entryStatus.map((s) => s.entryId), rel).toEqual(
        (doc.bibliography?.entries ?? []).map((e) => e.id),
      );
    }
  });

  it('reproduces a byte-identical matchMap on re-parse (R008 — deterministic re-run)', () => {
    for (const rel of Object.keys(KNOWN_MATCHES)) {
      if (EMPTY_MATCH_FIXTURES.includes(rel)) continue;
      const bytes = readFileSync(join(FIXTURES_DIR, rel));
      const a = JSON.stringify(parseDocument(bytes).matchMap);
      const b = JSON.stringify(parseDocument(bytes).matchMap);
      expect(a, rel).toBe(b);
    }
  });
});

// ---------------------------------------------------------------------------
// §79 semantic guards (fixture-driven, match-map level).
// ---------------------------------------------------------------------------

describe('S04 matching — §79 false-positive guards', () => {
  it('same-author-two-years: correct-year citation MATCHED, wrong-year pairing never confident', () => {
    const map = parseDocument(readFileSync(join(FIXTURES_DIR, 'match/same-author-two-years.docx'))).matchMap!;
    const byId = new Map(map.citations.map((c) => [c.citationId, c]));

    // c0 "Doe (2018)" resolves to the 2018 entry r0; c1 "(Doe, 2021)" to r1.
    expect(byId.get('c0')).toMatchObject({ relationship: 'MATCHED', matchedEntryId: 'r0', tier: 1, confidence: 1 });
    expect(byId.get('c1')).toMatchObject({ relationship: 'MATCHED', matchedEntryId: 'r1', tier: 1, confidence: 1 });

    // The wrong-year pairing (c0 vs r1, c1 vs r0) scores 0.6 < MATCH_THRESHOLD
    // 0.7 — never a confident MATCHED (§79).
    expect(byId.get('c0')!.matchedEntryId).not.toBe('r1');
    expect(byId.get('c1')!.matchedEntryId).not.toBe('r0');
    // And the entry tails resolve the same way (c2 → r0, c3 → r1).
    expect(byId.get('c2')!.matchedEntryId).toBe('r0');
    expect(byId.get('c3')!.matchedEntryId).toBe('r1');
  });

  it('ambiguous-same-author-year: two identical author+year entries → AMBIGUOUS, no auto-pick', () => {
    const map = parseDocument(readFileSync(join(FIXTURES_DIR, 'match/ambiguous-same-author-year.docx'))).matchMap!;
    for (const c of map.citations) {
      expect(c.relationship).toBe('AMBIGUOUS');
      expect(c.matchedEntryId).toBeUndefined();
      expect(c.reasons).toContain('ambiguous');
      expect(c.confidence).toBeGreaterThanOrEqual(0.7); // both candidates clear the threshold
    }
    // The ambiguous pair is never CITED — AMBIGUOUS_USAGE on both entries.
    expect(map.entryStatus).toEqual([
      { entryId: 'r0', status: 'AMBIGUOUS_USAGE' },
      { entryId: 'r1', status: 'AMBIGUOUS_USAGE' },
    ]);
  });

  it('near-miss-author: "Smith, J." vs "Smith, P." → low-confidence POSSIBLE_MISMATCH, never MATCHED', () => {
    const map = parseDocument(readFileSync(join(FIXTURES_DIR, 'match/near-miss-author.docx'))).matchMap!;
    const byId = new Map(map.citations.map((c) => [c.citationId, c]));

    const c0 = byId.get('c0')!;
    expect(c0.relationship).toBe('POSSIBLE_MISMATCH');
    expect(c0.matchedEntryId).toBeUndefined();
    expect(c0.confidence).toBeLessThan(0.7); // 0.525 — low confidence (§79)
    expect(c0.reasons).toContain('given-initial-mismatch');

    // The clean pairings still resolve: Smith, P. → r0, Roe, M. → r1.
    expect(byId.get('c1')).toMatchObject({ relationship: 'MATCHED', matchedEntryId: 'r0' });
    expect(byId.get('c2')).toMatchObject({ relationship: 'MATCHED', matchedEntryId: 'r1' });
  });

  it('near-miss-vietnamese: Nguyễn/Nguyen stays tier 3 (never promoted); Đỗ/Do stays distinct', () => {
    const map = parseDocument(readFileSync(join(FIXTURES_DIR, 'match/near-miss-vietnamese.docx'))).matchMap!;
    const byId = new Map(map.citations.map((c) => [c.citationId, c]));

    // Nguyễn, V. A. (2015) vs the "Nguyen, V. A." entry: diacritic-insensitive
    // only — tier stays 3 and is REPORTED, never promoted to exact (§24).
    const c0 = byId.get('c0')!;
    expect(c0.relationship).toBe('MATCHED');
    expect(c0.matchedEntryId).toBe('r0');
    expect(c0.tier).toBe(3);
    expect(c0.reasons).toContain('diacritic-insensitive');
    expect(c0.reasons).not.toContain('exact');

    // Đỗ (2018) vs "Do, Q.": Đ/đ survive stripping — tier 5, POSSIBLE_MISMATCH.
    const c1 = byId.get('c1')!;
    expect(c1.relationship).toBe('POSSIBLE_MISMATCH');
    expect(c1.tier).toBe(5);
    expect(c1.matchedEntryId).toBeUndefined();

    // The exact-spelling citations match on tier 1.
    expect(byId.get('c2')).toMatchObject({ relationship: 'MATCHED', matchedEntryId: 'r0', tier: 1 });
    expect(byId.get('c3')).toMatchObject({ relationship: 'MATCHED', matchedEntryId: 'r1', tier: 1 });
  });

  it('absent-target fixtures: every citation MISSING_REFERENCE — no silent guess (§79/R004)', () => {
    const absentTargets = Object.keys(KNOWN_MATCHES).filter(
      (rel) => KNOWN_MATCHES[rel]!.citations.length > 0 && KNOWN_MATCHES[rel]!.entryStatus.length === 0,
    );
    expect(absentTargets.length).toBeGreaterThan(0);

    for (const rel of absentTargets) {
      const map = parseDocument(readFileSync(join(FIXTURES_DIR, rel))).matchMap!;
      for (const c of map.citations) {
        expect(c.relationship, `${rel} ${c.citationId}`).toBe('MISSING_REFERENCE');
        expect(c.score, `${rel} ${c.citationId}`).toBe(0);
        expect(c.tier, `${rel} ${c.citationId}`).toBe(5);
        expect(c.confidence, `${rel} ${c.citationId}`).toBe(0);
        expect(c.reasons, `${rel} ${c.citationId}`).toEqual(['no-entry']);
      }
      expect(map.entryStatus, rel).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Bibliography-side ownership (CITED / UNUSED / AMBIGUOUS_USAGE).
// ---------------------------------------------------------------------------

describe('S04 matching — entry status ownership', () => {
  it('is consistent with the citation map on every covered fixture', () => {
    for (const rel of Object.keys(KNOWN_MATCHES)) {
      const expected = KNOWN_MATCHES[rel]!;
      if (expected.citations.length === 0 && expected.entryStatus.length === 0) continue;

      // Derive ownership from the citation rows: an entry is CITED iff some
      // MATCHED citation names it; AMBIGUOUS_USAGE iff it only ever appears in
      // AMBIGUOUS resolutions; otherwise UNUSED.
      const cited = new Set(
        expected.citations
          .filter((c) => c.relationship === 'MATCHED' && c.matchedEntryId !== undefined)
          .map((c) => c.matchedEntryId!),
      );
      const ambiguousIds = new Set(
        expected.citations
          .filter((c) => c.relationship === 'AMBIGUOUS')
          .flatMap(() => expected.entryStatus.filter((s) => s.status === 'AMBIGUOUS_USAGE').map((s) => s.entryId)),
      );
      for (const row of expected.entryStatus) {
        const derived = cited.has(row.entryId)
          ? 'CITED'
          : ambiguousIds.has(row.entryId)
            ? 'AMBIGUOUS_USAGE'
            : 'UNUSED';
        expect(row.status, `${rel} ${row.entryId}`).toBe(derived);
      }
    }
  });

  it('marks an entry no citation references as UNUSED (inline doc — corpus cites all entries)', () => {
    // The committed corpus references every entry by construction, so the
    // UNUSED path is pinned here on an inline document through the public
    // buildMatchMap: r1 is never cited -> UNUSED, r0 is cited -> CITED.
    const doc: AcademicDocument = {
      metadata: {},
      blocks: [],
      citations: [occurrence('c0', { firstAuthor: 'Doe', authors: ['Doe'], year: 2018 })],
      bibliography: {
        outcome: 'detected',
        heading: 'References',
        blockIds: ['ref-r0', 'ref-r1'],
        entries: [entry('r0', 'Doe', 'J.', 2018), entry('r1', 'Smith', 'J.', 2021)],
      },
      sourceMap: { version: 1, blocks: {} },
    };
    expect(buildMatchMap(doc).entryStatus).toEqual([
      { entryId: 'r0', status: 'CITED' },
      { entryId: 'r1', status: 'UNUSED' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Inline document helpers (never a gitignored path — pure literals).
// ---------------------------------------------------------------------------

/** One §21 reference entry with a tiered name key over the full name. */
function entry(id: string, family: string, given: string, year: number): ReferenceEntry {
  const originalName = `${family}, ${given}`;
  return {
    id,
    raw: `${originalName} (${year}). Title. Journal.`,
    authors: [
      {
        originalName,
        family,
        given,
        key: buildNameKey(originalName),
      },
    ],
    year,
    source: { blockId: `ref-${id}` },
    parseConfidence: 1,
  };
}

/** One §20 author-date citation occurrence literal. */
function occurrence(id: string, item: AuthorDateCitationItem): CitationOccurrence {
  return {
    id,
    raw: '(cited)',
    family: 'author-date',
    items: [item],
    source: { blockId: 'doc-p1', startOffset: 0, endOffset: 8 },
    confidence: 0.9,
  };
}
