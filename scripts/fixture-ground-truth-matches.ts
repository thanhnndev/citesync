/**
 * S04-T4 — §27 KNOWN_MATCHES ground truth (split from the extraction table
 * so every ground-truth file stays < 400 lines).
 *
 * Expected §27 match-state map per fixture, in document order (c0.., r0..):
 * every §20 citation occurrence's relationship state (MATCHED /
 * MISSING_REFERENCE / AMBIGUOUS / POSSIBLE_MISMATCH) plus its score / tier /
 * confidence / reasons, and the bibliography-side entry statuses (CITED /
 * UNUSED / AMBIGUOUS_USAGE). Only fixtures whose extraction produces
 * citations AND/OR a detected bibliography carry rows here; the no-entry /
 * absence fixtures are pinned as all-MISSING_REFERENCE (score 0, tier 5,
 * reasons ['no-entry'] — the §79 no-silent-guess contract).
 *
 * Consumed by `packages/docx/tests/matching.test.ts` (deep-equal drift
 * guard) and `scripts/make-fixtures.ts` (README manifest rendering).
 * Pure data — imports only the shared row types (erased at runtime).
 */

import type { KnownEntryStatusRow, KnownMatchMap, KnownMatchRow } from './fixture-ground-truth.js';

const MR = (o: KnownMatchRow): KnownMatchRow => o;
const ES = (o: KnownEntryStatusRow): KnownEntryStatusRow => o;
const MM = (o: KnownMatchMap): KnownMatchMap => o;

/** Compact builder: the uniform absent-targets MISSING_REFERENCE row. */
const missing = (citationId: string): KnownMatchRow =>
  MR({ citationId, relationship: 'MISSING_REFERENCE', score: 0, tier: 5, confidence: 0, reasons: ['no-entry'] });

/**
 * Expected §27 match states per fixture, in document order (c0.., r0..).
 * Authored from the real pipeline (verified against parseDocument) — any
 * change to the scorer, the orchestration policy, the thresholds, the
 * fixtures or the ground truth drifts these rows and matching.test.ts fails.
 */
export const KNOWN_MATCHES: Record<string, KnownMatchMap> = {
  // No detected bibliography (absent / below-threshold) -> every citation
  // MISSING_REFERENCE, score 0, tier 5, reasons ['no-entry'] (no silent
  // guess, §79/R004). Same for 'detected' sections whose parsing scope
  // produced no entries (apa-like: blockIds span keeps only the heading).
  'minimal.docx': MM({ citations: [missing('c0')], entryStatus: [] }),
  'author-date/simple.docx': MM({
    citations: [missing('c0'), missing('c1'), missing('c2'), missing('c3')],
    entryStatus: [],
  }),
  'author-date/et-al.docx': MM({
    citations: [missing('c0'), missing('c1'), missing('c2'), missing('c3')],
    entryStatus: [],
  }),
  'author-date/multiple-authors.docx': MM({
    citations: [missing('c0'), missing('c1'), missing('c2')],
    entryStatus: [],
  }),
  'author-date/same-author-year.docx': MM({
    citations: [missing('c0'), missing('c1'), missing('c2')],
    entryStatus: [],
  }),
  'author-date/missing.docx': MM({
    citations: [missing('c0'), missing('c1')],
    entryStatus: [],
  }),
  'author-date/ambiguous.docx': MM({
    citations: [missing('c0'), missing('c1')],
    entryStatus: [],
  }),
  'author-date/vietnamese.docx': MM({
    citations: [missing('c0'), missing('c1'), missing('c2'), missing('c3')],
    entryStatus: [],
  }),
  'documents/docx/apa-like.docx': MM({
    citations: [missing('c0'), missing('c1'), missing('c2'), missing('c3'), missing('c4')],
    entryStatus: [],
  }),
  'documents/docx/harvard.docx': MM({
    citations: [missing('c0'), missing('c1'), missing('c2')],
    entryStatus: [],
  }),
  'documents/docx/plain-text.docx': MM({ citations: [missing('c0')], entryStatus: [] }),
  'bibliography/no-bibliography.docx': MM({
    citations: [missing('c0'), missing('c1')],
    entryStatus: [],
  }),
  'bibliography/ambiguous.docx': MM({ citations: [missing('c0')], entryStatus: [] }),

  // en-references: every body + entry-tail citation resolves to its entry
  // (bare surnames score 1.0; "Last, Initial" tails 0.925 — the initial is
  // treated as additional-author evidence against a truncated entry).
  'bibliography/en-references.docx': MM({
    citations: [
      MR({ citationId: 'c0', relationship: 'MATCHED', matchedEntryId: 'r0', score: 1, tier: 1, confidence: 1, reasons: ['exact', 'year-match'] }),
      MR({ citationId: 'c1', relationship: 'MATCHED', matchedEntryId: 'r1', score: 1, tier: 1, confidence: 1, reasons: ['exact', 'year-match'] }),
      MR({ citationId: 'c2', relationship: 'MATCHED', matchedEntryId: 'r2', score: 1, tier: 1, confidence: 1, reasons: ['exact', 'year-match'] }),
      MR({ citationId: 'c3', relationship: 'MATCHED', matchedEntryId: 'r0', score: 0.925, tier: 1, confidence: 0.925, reasons: ['exact', 'year-match'] }),
      MR({ citationId: 'c4', relationship: 'MATCHED', matchedEntryId: 'r1', score: 1, tier: 1, confidence: 1, reasons: ['exact', 'year-match'] }),
      MR({ citationId: 'c5', relationship: 'MATCHED', matchedEntryId: 'r2', score: 0.925, tier: 1, confidence: 0.925, reasons: ['exact', 'year-match'] }),
    ],
    entryStatus: [ES({ entryId: 'r0', status: 'CITED' }), ES({ entryId: 'r1', status: 'CITED' }), ES({ entryId: 'r2', status: 'CITED' })],
  }),

  'bibliography/vi-tai-lieu.docx': MM({
    citations: [
      MR({ citationId: 'c0', relationship: 'MATCHED', matchedEntryId: 'r0', score: 0.925, tier: 1, confidence: 0.925, reasons: ['exact', 'year-match'] }),
      MR({ citationId: 'c1', relationship: 'MATCHED', matchedEntryId: 'r1', score: 0.925, tier: 1, confidence: 0.925, reasons: ['exact', 'year-match'] }),
      MR({ citationId: 'c2', relationship: 'MATCHED', matchedEntryId: 'r2', score: 0.925, tier: 1, confidence: 0.925, reasons: ['exact', 'year-match'] }),
    ],
    entryStatus: [ES({ entryId: 'r0', status: 'CITED' }), ES({ entryId: 'r1', status: 'CITED' }), ES({ entryId: 'r2', status: 'CITED' })],
  }),

  // style-position: c0 "Nguyễn (2019)" has NO entry for it — the best
  // candidate is the 2019 Roe entry on the year axis alone (0.6, tier 5) ->
  // POSSIBLE_MISMATCH in the near-miss band; the entry tails match cleanly.
  'bibliography/style-position.docx': MM({
    citations: [
      MR({ citationId: 'c0', relationship: 'POSSIBLE_MISMATCH', score: 0.6, tier: 5, confidence: 0.6, reasons: ['author-mismatch', 'year-match'] }),
      MR({ citationId: 'c1', relationship: 'MATCHED', matchedEntryId: 'r0', score: 0.925, tier: 1, confidence: 0.925, reasons: ['exact', 'year-match'] }),
      MR({ citationId: 'c2', relationship: 'MATCHED', matchedEntryId: 'r1', score: 1, tier: 1, confidence: 1, reasons: ['exact', 'year-match'] }),
      MR({ citationId: 'c3', relationship: 'MATCHED', matchedEntryId: 'r2', score: 0.925, tier: 1, confidence: 0.925, reasons: ['exact', 'year-match'] }),
    ],
    entryStatus: [ES({ entryId: 'r0', status: 'CITED' }), ES({ entryId: 'r1', status: 'CITED' }), ES({ entryId: 'r2', status: 'CITED' })],
  }),

  // S04-T1: correct-year pairings MATCHED (1.0 / 0.925); the wrong-year
  // pairing is never selected (§79 — max wrong-year score 0.65 < 0.7).
  'match/same-author-two-years.docx': MM({
    citations: [
      MR({ citationId: 'c0', relationship: 'MATCHED', matchedEntryId: 'r0', score: 1, tier: 1, confidence: 1, reasons: ['exact', 'year-match'] }),
      MR({ citationId: 'c1', relationship: 'MATCHED', matchedEntryId: 'r1', score: 1, tier: 1, confidence: 1, reasons: ['exact', 'year-match'] }),
      MR({ citationId: 'c2', relationship: 'MATCHED', matchedEntryId: 'r0', score: 0.925, tier: 1, confidence: 0.925, reasons: ['exact', 'year-match'] }),
      MR({ citationId: 'c3', relationship: 'MATCHED', matchedEntryId: 'r1', score: 0.925, tier: 1, confidence: 0.925, reasons: ['exact', 'year-match'] }),
    ],
    entryStatus: [ES({ entryId: 'r0', status: 'CITED' }), ES({ entryId: 'r1', status: 'CITED' })],
  }),

  // S04-T2: identical author+year entries -> AMBIGUOUS, no auto-pick (§27).
  'match/ambiguous-same-author-year.docx': MM({
    citations: [
      MR({ citationId: 'c0', relationship: 'AMBIGUOUS', score: 1, tier: 1, confidence: 1, reasons: ['exact', 'year-match', 'ambiguous'] }),
      MR({ citationId: 'c1', relationship: 'AMBIGUOUS', score: 0.925, tier: 1, confidence: 0.925, reasons: ['exact', 'year-match', 'ambiguous'] }),
      MR({ citationId: 'c2', relationship: 'AMBIGUOUS', score: 0.925, tier: 1, confidence: 0.925, reasons: ['exact', 'year-match', 'ambiguous'] }),
    ],
    entryStatus: [ES({ entryId: 'r0', status: 'AMBIGUOUS_USAGE' }), ES({ entryId: 'r1', status: 'AMBIGUOUS_USAGE' })],
  }),

  // S04-T2: "Smith, J." vs "Smith, P." — given-initial contradiction zeroes
  // the first-author credit (0.525, POSSIBLE_MISMATCH); never MATCHED (§79).
  'match/near-miss-author.docx': MM({
    citations: [
      MR({ citationId: 'c0', relationship: 'POSSIBLE_MISMATCH', score: 0.525, tier: 1, confidence: 0.525, reasons: ['exact', 'given-initial-mismatch', 'year-match'] }),
      MR({ citationId: 'c1', relationship: 'MATCHED', matchedEntryId: 'r0', score: 0.925, tier: 1, confidence: 0.925, reasons: ['exact', 'year-match'] }),
      MR({ citationId: 'c2', relationship: 'MATCHED', matchedEntryId: 'r1', score: 0.925, tier: 1, confidence: 0.925, reasons: ['exact', 'year-match'] }),
    ],
    entryStatus: [ES({ entryId: 'r0', status: 'CITED' }), ES({ entryId: 'r1', status: 'CITED' })],
  }),

  // S04-T2: Nguyễn vs Nguyen reaches tier 3 (diacritic-insensitive, reported —
  // never promoted to exact: tier stays 3) and still MATCHED on the strong
  // year axis; Đỗ vs Do stays distinct (tier 5, 0.6 -> POSSIBLE_MISMATCH).
  'match/near-miss-vietnamese.docx': MM({
    citations: [
      MR({ citationId: 'c0', relationship: 'MATCHED', matchedEntryId: 'r0', score: 0.845, tier: 3, confidence: 0.845, reasons: ['diacritic-insensitive', 'year-match'] }),
      MR({ citationId: 'c1', relationship: 'POSSIBLE_MISMATCH', score: 0.6, tier: 5, confidence: 0.6, reasons: ['author-mismatch', 'year-match'] }),
      MR({ citationId: 'c2', relationship: 'MATCHED', matchedEntryId: 'r0', score: 0.925, tier: 1, confidence: 0.925, reasons: ['exact', 'year-match'] }),
      MR({ citationId: 'c3', relationship: 'MATCHED', matchedEntryId: 'r1', score: 0.925, tier: 1, confidence: 0.925, reasons: ['exact', 'year-match'] }),
    ],
    entryStatus: [ES({ entryId: 'r0', status: 'CITED' }), ES({ entryId: 'r1', status: 'CITED' })],
  }),

  // Macro-carriage sample: no citations, no entries -> empty map.
  'security/vba-sample.docx': MM({ citations: [], entryStatus: [] }),
};
