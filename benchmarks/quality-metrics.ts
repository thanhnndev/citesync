/**
 * M004-S03 (T1) — shared pure R017 quality metrics (measured truth).
 *
 * ONE pure implementation backs both the CI gate
 * (packages/core/tests/quality-gates.test.ts) and the recording harness
 * (benchmarks/quality.ts) so gate and recorded report can never drift
 * (MEM148). This module is RUNTIME-PURE: no node:fs, no @citesync/* imports,
 * no clock, no random — it consumes parsed projections (passed as
 * arguments) and the committed pure-data manifests only. Both tsx (file
 * mode) and vitest remap the NodeNext `.js` import convention to the `.ts`
 * sources (exact precedent: packages/docx/tests/extraction.test.ts imports
 * '../../../scripts/fixture-ground-truth.js').
 *
 * The four R017 metrics (D045):
 *   - detection precision/recall — MULTISET raw-string comparison: per
 *     fixture, count maps of emitted `doc.citations[].raw` vs the expected
 *     raws (KNOWN_OCCURRENCES + the isolation overlay + the quality
 *     manifest); true positives = sum of min(counts) per unique raw;
 *     precision = TP/emitted, recall = TP/expected, aggregated across the
 *     corpus;
 *   - matching precision — correct engine-MATCHED rows / total
 *     engine-MATCHED rows, where the expected `matchedEntryId` comes from a
 *     RAW-KEYED map (KNOWN_MATCHES MATCHED rows joined via KNOWN_OCCURRENCES
 *     id→raw, plus the quality manifest expectedMatches and the isolation
 *     overlay). "Correct" means expected(raw) === row.matchedEntryId; a
 *     MATCHED row with no expected entry counts as INCORRECT (conservative
 *     §79). Fixtures with no detected bibliography (doc.matchMap undefined)
 *     contribute no matching rows (guard ?? []);
 *   - false-positive issue rate — per fixture per ruleId
 *     fp = max(0, emitted − expected) over the per-rule expected counts
 *     derived programmatically from the four manifests + the explicit
 *     overlay constants below (probe-verified canonical totals
 *     CS001 35 / CS002 1 / CS003 0 / CS004 3 / CS005 2 / CS006 1 / CS007 2 /
 *     CS008 3 / CS009 0 = 47); falsePositiveRate = fpCount / total emitted
 *     issues.
 *
 * Corpus = manifest-driven union (D046): Object.keys(KNOWN_OCCURRENCES) +
 * the isolation overlay fixture + QUALITY_CORPUS — the T4 quality fixture
 * lands by extending its manifest (scripts/fixture-ground-truth-quality.ts),
 * this module needs no edit.
 */

import { KNOWN_OCCURRENCES } from '../scripts/fixture-ground-truth.js';
import type { KnownCitationOccurrence } from '../scripts/fixture-ground-truth.js';
import { KNOWN_REFERENCES } from '../scripts/fixture-ground-truth-references.js';
// KnownReferenceEntry is exported by fixture-ground-truth.ts (line 42), NOT
// by fixture-ground-truth-references.ts — the references manifest only
// re-uses it internally (T2 type-coherence fix; type-only, runtime-identical).
import type { KnownReferenceEntry } from '../scripts/fixture-ground-truth.js';
import { KNOWN_MATCHES } from '../scripts/fixture-ground-truth-matches.js';
import { KNOWN_NUMERIC_INDEX_MAP } from '../scripts/fixture-ground-truth-numeric.js';
import { QUALITY_CORPUS } from '../scripts/fixture-ground-truth-quality.js';
import type { QualityFixtureGroundTruth } from '../scripts/fixture-ground-truth-quality.js';

/** The nine built-in rule ids, in registry order (CS001–CS009). */
export const RULE_IDS = [
  'CS001', 'CS002', 'CS003', 'CS004', 'CS005', 'CS006', 'CS007', 'CS008', 'CS009',
] as const;

/**
 * Explicit isolation-fixture ground truth (S02-provided false-positive
 * reference, D045). The fixture lives OUTSIDE KNOWN_OCCURRENCES / KNOWN_MATCHES
 * (its match states are pinned here instead) — the `[1]` numeric bracket
 * binds positionally to the garbage entry r0, while the two entry tails
 * match r1/r2.
 */
export const ISOLATION_QUALITY: QualityFixtureGroundTruth = {
  fixture: 'isolation/garbage-and-malformed.docx',
  expectedRaws: ['[1]', 'Doe, J. (2017)', 'Roe, M. (2018)'],
  expectedMatches: { 'Doe, J. (2017)': 'r1', 'Roe, M. (2018)': 'r2' },
  expectedIssues: { CS006: 1, CS007: 1, CS002: 1 },
};

/**
 * Expected-issue overlays for fixtures whose expected counts cannot be
 * derived from the match/numeric manifests alone (D045):
 *   - numeric/malformed.docx — the malformed '[1, x]' bracket surfaces as
 *     CS007 (invalid numeric) but is NEVER emitted as a citation (R007), so
 *     it leaves no row in any manifest;
 *   - documents/docx/plain-text.docx — its '[1]' has no detected
 *     bibliography, so the numeric index map is absent from the manifests
 *     and the out-of-range CS008 surface is pinned here.
 */
export const EXPECTED_ISSUE_OVERLAYS: Record<string, Record<string, number>> = {
  'numeric/malformed.docx': { CS007: 1 },
  'documents/docx/plain-text.docx': { CS008: 1 },
};

/**
 * Minimal structural projection of one parsed document plus its emitted
 * issues — the argument shape `computeQualityMetrics` consumes. The gate
 * test and the harness build this from `lintDocument(bytes)` through the
 * PUBLIC surface (R008 seam); fixtures with no detected bibliography carry
 * no matchMap (the `?? []` guards below keep them metric-neutral).
 */
export interface ParsedProjection {
  /** Emitted §20 citations (id → raw join for the match rows). */
  citations: Array<{ id: string; raw: string }>;
  /** §27 match map — absent when no bibliography was detected. */
  matchMap?: {
    citations: Array<{ citationId: string; relationship: string; matchedEntryId?: string }>;
    entryStatus: Array<{ entryId: string; status: string }>;
  };
  /** D016 numeric index map — absent without numeric citations. */
  numericIndexMap?: {
    citations: Array<{ citationId: string; tokens: Array<{ status: string; resolvedEntryId?: string }> }>;
  };
  /** Emitted lint issues (ruleId only — the FP surface). */
  issues: Array<{ ruleId: string }>;
}

/** Per-fixture quality row (harness + gate printout). */
export interface PerFixtureQualityRow {
  fixture: string;
  /** Emitted raw count (detection). */
  emitted: number;
  /** Expected raw count (detection). */
  expected: number;
  /** False-positive issue count for this fixture. */
  fp: number;
  /** Per-rule emitted/expected/fp breakdown. */
  issues: Record<string, { emitted: number; expected: number; fp: number }>;
}

/** The full computed R017 metric surface. */
export interface QualityMetricsResult {
  detectionPrecision: number;
  recall: number;
  matchingPrecision: number;
  falsePositiveCount: number;
  falsePositiveRate: number;
  emittedIssueCount: number;
  expectedIssueCount: number;
  perFixture: PerFixtureQualityRow[];
}

/** R017 gate targets (asserted by the CI gate, evaluated by the harness). */
export const QUALITY_TARGETS = {
  detectionPrecision: 0.98,
  recall: 0.95,
  matchingPrecision: 0.97,
} as const;

/** Gate verdicts per metric (single evaluation in the shared module). */
export interface QualityGateResults {
  detection: 'PASS' | 'FAIL';
  recall: 'PASS' | 'FAIL';
  matching: 'PASS' | 'FAIL';
}

/** Build a count map from raw string values (multiset). */
function countMap(values: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return m;
}

/**
 * The committed corpus, manifest-driven (D046): the 26 KNOWN_OCCURRENCES
 * fixtures, the isolation overlay fixture, and every quality-manifest
 * fixture. The T4 fixture lands here via QUALITY_CORPUS — no code edit.
 */
export function corpusFixtures(): string[] {
  return [
    ...Object.keys(KNOWN_OCCURRENCES),
    ISOLATION_QUALITY.fixture,
    ...QUALITY_CORPUS.map((q) => q.fixture),
  ];
}

/**
 * Expected emitted raws for one fixture: KNOWN_OCCURRENCES raws, replaced by
 * the isolation overlay or a quality manifest entry when the fixture carries
 * its own manifest (the isolation fixture and the quality fixtures are NOT
 * in KNOWN_OCCURRENCES).
 */
function expectedRawsFor(fixture: string): string[] {
  if (fixture === ISOLATION_QUALITY.fixture) return [...ISOLATION_QUALITY.expectedRaws];
  const quality = QUALITY_CORPUS.find((q) => q.fixture === fixture);
  if (quality !== undefined) return [...quality.expectedRaws];
  return (KNOWN_OCCURRENCES[fixture] ?? []).map((o) => o.raw);
}

/**
 * Raw-keyed expected matchedEntryId map for one fixture: KNOWN_MATCHES
 * MATCHED rows joined via KNOWN_OCCURRENCES id→raw, extended by the quality
 * manifest expectedMatches and the isolation overlay. In the corpus every
 * MATCHED raw maps to exactly one entry (the T4 fixture enforces unique
 * keys), so a plain record is exact.
 */
function buildExpectedMatches(fixture: string): Record<string, string> {
  const map: Record<string, string> = {};
  const occById = new Map<string, KnownCitationOccurrence>(
    (KNOWN_OCCURRENCES[fixture] ?? []).map((o) => [o.id, o]),
  );
  for (const row of KNOWN_MATCHES[fixture]?.citations ?? []) {
    if (row.relationship !== 'MATCHED' || row.matchedEntryId === undefined) continue;
    const occ = occById.get(row.citationId);
    if (occ !== undefined) map[occ.raw] = row.matchedEntryId;
  }
  const quality = QUALITY_CORPUS.find((q) => q.fixture === fixture);
  if (quality !== undefined) Object.assign(map, quality.expectedMatches);
  if (fixture === ISOLATION_QUALITY.fixture) Object.assign(map, ISOLATION_QUALITY.expectedMatches);
  return map;
}

/**
 * Programmatic per-ruleId expected issue counts for one fixture (D045 —
 * the same derivations the rules compute over the real document, over the
 * committed ground truth). Canonical corpus totals: CS001 35 / CS002 1 /
 * CS003 0 / CS004 3 / CS005 2 / CS006 1 / CS007 2 / CS008 3 / CS009 0 = 47.
 */
export function deriveExpectedIssueCounts(fixture: string): Record<string, number> {
  const counts = Object.fromEntries(RULE_IDS.map((r) => [r, 0])) as Record<string, number>;
  const occById = new Map<string, KnownCitationOccurrence>(
    (KNOWN_OCCURRENCES[fixture] ?? []).map((o) => [o.id, o]),
  );
  const matches = KNOWN_MATCHES[fixture];
  const refs = KNOWN_REFERENCES[fixture] ?? [];
  const numeric = KNOWN_NUMERIC_INDEX_MAP[fixture];

  // CS001: MISSING_REFERENCE rows whose citation family is 'author-date'
  // (numeric brackets are surfaced by CS008, never by CS001).
  // CS003: rows whose reasons include 'year-mismatch'.
  // CS004: AMBIGUOUS rows.
  for (const row of matches?.citations ?? []) {
    if (row.relationship === 'MISSING_REFERENCE' && occById.get(row.citationId)?.family === 'author-date') {
      counts.CS001 += 1;
    }
    if (row.reasons.includes('year-mismatch')) counts.CS003 += 1;
    if (row.relationship === 'AMBIGUOUS') counts.CS004 += 1;
  }

  // CS002: UNUSED entryStatus rows.
  for (const row of matches?.entryStatus ?? []) {
    if (row.status === 'UNUSED') counts.CS002 += 1;
  }

  // CS005: cluster over KNOWN_REFERENCES — key = first author key.exact +
  // '::' + year; clusters of size >= 2; an entry is undisambiguated when its
  // yearSuffix is '' OR the same suffix occurs >= 2x in the cluster (the
  // exact ruleCS005 semantics — a duplicate suffix is as ambiguous as a
  // missing one, §79).
  const clusters = new Map<string, KnownReferenceEntry[]>();
  for (const entry of refs) {
    const first = entry.authors?.[0];
    if (first === undefined || entry.year === undefined) continue;
    const key = `${first.key.exact}::${entry.year}`;
    const list = clusters.get(key);
    if (list === undefined) clusters.set(key, [entry]);
    else list.push(entry);
  }
  for (const cluster of clusters.values()) {
    if (cluster.length < 2) continue;
    const suffixCounts = new Map<string, number>();
    for (const entry of cluster) {
      const suffix = entry.yearSuffix ?? '';
      suffixCounts.set(suffix, (suffixCounts.get(suffix) ?? 0) + 1);
    }
    for (const entry of cluster) {
      const suffix = entry.yearSuffix ?? '';
      if (suffix !== '' && (suffixCounts.get(suffix) ?? 0) < 2) continue;
      counts.CS005 += 1;
    }
  }

  // CS008: tokens with status != 'resolved' from KNOWN_NUMERIC_INDEX_MAP
  // (out-of-range/unmatched surfaces, D016).
  for (const row of numeric?.citations ?? []) {
    for (const token of row.tokens) {
      if (token.status !== 'resolved') counts.CS008 += 1;
    }
  }

  // CS009: entries neither numeric-resolved (KNOWN_NUMERIC_INDEX_MAP) nor
  // author-date CITED/AMBIGUOUS_USAGE (KNOWN_MATCHES entryStatus) over the
  // KNOWN_REFERENCES entries — the ruleCS009 cross-family guard.
  const numericResolved = new Set<string>();
  for (const row of numeric?.citations ?? []) {
    for (const token of row.tokens) {
      if (token.resolvedEntryId !== undefined) numericResolved.add(token.resolvedEntryId);
    }
  }
  const authorDateUsed = new Set<string>();
  for (const row of matches?.entryStatus ?? []) {
    if (row.status === 'CITED' || row.status === 'AMBIGUOUS_USAGE') authorDateUsed.add(row.entryId);
  }
  for (const entry of refs) {
    if (numericResolved.has(entry.id) || authorDateUsed.has(entry.id)) continue;
    counts.CS009 += 1;
  }

  // Overlays (D045): the isolation fixture's own expected issues plus the
  // per-fixture CS007/CS008 surfaces not derivable from the manifests.
  const overlay =
    fixture === ISOLATION_QUALITY.fixture ? ISOLATION_QUALITY.expectedIssues : undefined;
  const extra = EXPECTED_ISSUE_OVERLAYS[fixture];
  for (const [ruleId, n] of Object.entries({ ...(overlay ?? {}), ...(extra ?? {}) })) {
    counts[ruleId] = (counts[ruleId] ?? 0) + n;
  }
  return counts;
}

/**
 * Compute the four R017 metrics over the provided per-fixture projections
 * (see the header for the exact semantics). Deterministic: same projections
 * in, same numbers out (R008).
 */
export function computeQualityMetrics(actual: Record<string, ParsedProjection>): QualityMetricsResult {
  const fixtures = corpusFixtures();
  let tpTotal = 0;
  let emittedTotal = 0;
  let expectedTotal = 0;
  let correctMatches = 0;
  let totalMatched = 0;
  let fpCount = 0;
  let emittedIssues = 0;
  let expectedIssues = 0;
  const perFixture: PerFixtureQualityRow[] = [];

  for (const fixture of fixtures) {
    const proj = actual[fixture];

    // Detection: multiset raw-string comparison (TP = sum of min per unique
    // raw; aggregated across fixtures).
    const emittedRaws = (proj?.citations ?? []).map((c) => c.raw);
    const expectedRaws = expectedRawsFor(fixture);
    const emittedCounts = countMap(emittedRaws);
    const expectedCounts = countMap(expectedRaws);
    let tp = 0;
    for (const [raw, n] of emittedCounts) {
      tp += Math.min(n, expectedCounts.get(raw) ?? 0);
    }
    tpTotal += tp;
    emittedTotal += emittedRaws.length;
    expectedTotal += expectedRaws.length;

    // Matching: correct engine-MATCHED rows / total engine-MATCHED rows.
    // A MATCHED row with no expected entry (or an unknown raw) counts as
    // incorrect — conservative (§79). No matchMap → no matching rows.
    const expectedMatches = buildExpectedMatches(fixture);
    const rawById = new Map((proj?.citations ?? []).map((c) => [c.id, c.raw]));
    for (const row of proj?.matchMap?.citations ?? []) {
      if (row.relationship !== 'MATCHED') continue;
      totalMatched += 1;
      const raw = rawById.get(row.citationId);
      const expectedEntry = raw !== undefined ? expectedMatches[raw] : undefined;
      if (expectedEntry !== undefined && expectedEntry === row.matchedEntryId) correctMatches += 1;
    }

    // FP issues: per ruleId fp = max(0, emitted − expected).
    const emittedIssue = countMap((proj?.issues ?? []).map((i) => i.ruleId));
    const expectedIssue = deriveExpectedIssueCounts(fixture);
    const issues: PerFixtureQualityRow['issues'] = {};
    let fixtureFp = 0;
    for (const ruleId of RULE_IDS) {
      const emitted = emittedIssue.get(ruleId) ?? 0;
      const expected = expectedIssue[ruleId] ?? 0;
      const fp = Math.max(0, emitted - expected);
      issues[ruleId] = { emitted, expected, fp };
      fixtureFp += fp;
    }
    fpCount += fixtureFp;
    emittedIssues += (proj?.issues ?? []).length;
    expectedIssues += Object.values(expectedIssue).reduce((a, b) => a + b, 0);

    perFixture.push({ fixture, emitted: emittedRaws.length, expected: expectedRaws.length, fp: fixtureFp, issues });
  }

  return {
    detectionPrecision: emittedTotal === 0 ? 1 : tpTotal / emittedTotal,
    recall: expectedTotal === 0 ? 1 : tpTotal / expectedTotal,
    matchingPrecision: totalMatched === 0 ? 1 : correctMatches / totalMatched,
    falsePositiveCount: fpCount,
    falsePositiveRate: emittedIssues === 0 ? 0 : fpCount / emittedIssues,
    emittedIssueCount: emittedIssues,
    expectedIssueCount: expectedIssues,
    perFixture,
  };
}

/** Evaluate the three R017 gate targets against computed metrics. */
export function evaluateQualityGates(metrics: QualityMetricsResult): QualityGateResults {
  return {
    detection: metrics.detectionPrecision >= QUALITY_TARGETS.detectionPrecision ? 'PASS' : 'FAIL',
    recall: metrics.recall >= QUALITY_TARGETS.recall ? 'PASS' : 'FAIL',
    matching: metrics.matchingPrecision >= QUALITY_TARGETS.matchingPrecision ? 'PASS' : 'FAIL',
  };
}

/**
 * Deterministic printable table shared by the gate test and the harness so
 * the printed numbers always equal the computed metrics (MEM148 — one
 * implementation, one format). Per-rule detail is shown only where emitted ≠
 * expected (a drift surface), keeping the clean-corpus output focused.
 */
export function formatQualityTable(metrics: QualityMetricsResult): string {
  const lines: string[] = [];
  lines.push(`R017 quality metrics — corpus ${metrics.perFixture.length} fixtures`);
  lines.push(`  detectionPrecision  ${metrics.detectionPrecision.toFixed(4)}  (target >= ${QUALITY_TARGETS.detectionPrecision})`);
  lines.push(`  recall              ${metrics.recall.toFixed(4)}  (target >= ${QUALITY_TARGETS.recall})`);
  lines.push(`  matchingPrecision   ${metrics.matchingPrecision.toFixed(4)}  (target >= ${QUALITY_TARGETS.matchingPrecision})`);
  lines.push(`  falsePositiveCount  ${metrics.falsePositiveCount}  (target 0)`);
  lines.push(`  falsePositiveRate   ${metrics.falsePositiveRate.toFixed(4)}`);
  lines.push(`  emittedIssueCount   ${metrics.emittedIssueCount}`);
  lines.push(`  expectedIssueCount  ${metrics.expectedIssueCount}`);
  lines.push('per-fixture (emitted/expected = detection raws; fp = false-positive issues):');
  for (const row of metrics.perFixture) {
    const drift: string[] = [];
    for (const [ruleId, per] of Object.entries(row.issues)) {
      if (per.emitted !== per.expected) {
        drift.push(`${ruleId} ${per.emitted}/${per.expected}${per.fp > 0 ? ` (+${per.fp} fp)` : ''}`);
      }
    }
    lines.push(
      `  ${row.fixture.padEnd(42)} emitted ${String(row.emitted).padStart(3)}  expected ${String(row.expected).padStart(3)}  fp ${String(row.fp).padStart(2)}${drift.length > 0 ? '  ' + drift.join(' ') : ''}`,
    );
  }
  return lines.join('\n');
}
