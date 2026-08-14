/**
 * M004/S03-T2 — R017 quality gates as a deterministic CI-gated vitest suite
 * (D040/MEM148) over the committed ground-truth corpus.
 *
 * The R017 measured-truth surface has TWO halves that must never drift:
 *
 *   a. CI GATE (this file) — recomputes the four metrics on every run by
 *      driving the PUBLIC `lintDocument(bytes)` from '@citesync/core' (dist;
 *      R008/R009 seam — the same entry the PWA worker and the benchmark
 *      harness use) over the full committed corpus, then asserts the R017
 *      targets. The gate is a TEST that fails loudly naming the offending
 *      metric — never a recorded script.
 *
 *   b. RECORDED EVIDENCE (T3) — `npm run benchmark:quality` records the
 *      SAME metrics (computed through the SAME shared module
 *      benchmarks/quality-metrics.ts) into the write-once committed file
 *      benchmarks/results/quality-corpus.json. The drift-guard test below
 *      locks test-computed == committed: it reads the recorded JSON and
 *      deep-equals the recomputed metric fields, so a future change that
 *      moves gate and record apart fails CI loudly.
 *
 * ONE implementation backs both halves (MEM148): this test imports the
 * metrics from '../../../benchmarks/quality-metrics.js' (NodeNext `.js`
 * convention — vitest remaps to the `.ts` source; exact precedent:
 * packages/docx/tests/extraction.test.ts imports
 * '../../../scripts/fixture-ground-truth.js'). The metric SEMANTICS live in
 * that module (D045); the important ones are:
 *
 *   - detection precision/recall — MULTISET raw-string comparison: per
 *     fixture, count maps of emitted `doc.citations[].raw` vs the expected
 *     raws (KNOWN_OCCURRENCES + the isolation overlay + the quality
 *     manifest); TP = sum of min(counts) per unique raw; precision =
 *     TP/emitted, recall = TP/expected, aggregated across the corpus;
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
 *     derived programmatically from the manifests + overlay constants
 *     (canonical totals CS001 35 / CS002 1 / CS003 0 / CS004 3 / CS005 2 /
 *     CS006 1 / CS007 2 / CS008 3 / CS009 0 = 47, D045); falsePositiveRate =
 *     fpCount / total emitted issues.
 *
 * Asserted targets (shared QUALITY_TARGETS — the harness evaluates the SAME
 * constants): detectionPrecision >= 0.98, recall >= 0.95,
 * matchingPrecision >= 0.97, falsePositiveCount === 0. The corpus TODAY
 * emits exactly the expected 47 issues (the derived per-rule expected
 * counts), so any excess over expected is a genuine false positive to
 * investigate — the derivation lives in the shared module, never here.
 *
 * The corpus is MANIFEST-DRIVEN (D046): `corpusFixtures()` returns the 26
 * KNOWN_OCCURRENCES fixtures + the isolation overlay fixture, and grows
 * automatically when T4's quality manifest (QUALITY_CORPUS) lands — this
 * file needs no edit.
 *
 * Fixtures are git-tracked committed files under fixtures/ (never .gsd/).
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { lintDocument } from '@citesync/core';
import type { LintReport } from '@citesync/core';

import {
  QUALITY_TARGETS,
  computeQualityMetrics,
  corpusFixtures,
  evaluateQualityGates,
  formatQualityTable,
} from '../../../benchmarks/quality-metrics.js';
import type { ParsedProjection, QualityMetricsResult } from '../../../benchmarks/quality-metrics.js';

const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
/** T3's write-once committed evidence — the drift guard is inert until it exists. */
const EVIDENCE_PATH = fileURLToPath(
  new URL('../../../benchmarks/results/quality-corpus.json', import.meta.url),
);

/** Every committed corpus fixture as raw bytes (read once, git-tracked). */
function readCorpusFixtures(): Map<string, Uint8Array> {
  const bytes = new Map<string, Uint8Array>();
  for (const fixture of corpusFixtures()) {
    bytes.set(fixture, readFileSync(`${FIXTURES_DIR}${fixture}`));
  }
  return bytes;
}

/**
 * Project one lint report into the shared module's ParsedProjection shape.
 * Fixtures with no detected bibliography carry no matchMap (and documents
 * without numeric citations carry no numericIndexMap) — the `undefined`
 * guards keep those fixtures metric-neutral inside computeQualityMetrics
 * (the module applies `?? []` itself; this is the faithful projection).
 */
function project(report: LintReport): ParsedProjection {
  const { doc, issues } = report;
  return {
    citations: doc.citations.map((c) => ({ id: c.id, raw: c.raw })),
    matchMap:
      doc.matchMap === undefined
        ? undefined
        : {
            citations: doc.matchMap.citations.map((row) => ({
              citationId: row.citationId,
              relationship: row.relationship,
              matchedEntryId: row.matchedEntryId,
            })),
            entryStatus: doc.matchMap.entryStatus.map((row) => ({
              entryId: row.entryId,
              status: row.status,
            })),
          },
    numericIndexMap:
      doc.numericIndexMap === undefined
        ? undefined
        : {
            citations: doc.numericIndexMap.citations.map((row) => ({
              citationId: row.citationId,
              tokens: row.tokens.map((t) => ({
                status: t.status,
                resolvedEntryId: t.resolvedEntryId,
              })),
            })),
          },
    issues: issues.map((i) => ({ ruleId: i.ruleId })),
  };
}

/** Drive the PUBLIC lintDocument over the whole corpus and project each report. */
function computeCorpusMetrics(): QualityMetricsResult {
  const actual: Record<string, ParsedProjection> = {};
  for (const [fixture, bytes] of readCorpusFixtures()) {
    actual[fixture] = project(lintDocument(bytes));
  }
  return computeQualityMetrics(actual);
}

describe('R017 quality gates over the committed corpus (multiset detection, raw-keyed matching, FP = expected-vs-emitted excess)', () => {
  // Computed ONCE at describe scope: both the gate test and the drift guard
  // assert the SAME recomputed numbers (deterministic — R008), and the
  // printed table below always equals the asserted metrics (MEM148).
  const metrics = computeCorpusMetrics();
  const gates = evaluateQualityGates(metrics);

  it('meets the R017 targets over the whole corpus (precision/recall/matching/FP)', () => {
    // Visible when a test fails: the full metric table + per-fixture rows
    // (emitted/expected detection raws, fp issues, per-rule drift).
    console.log(formatQualityTable(metrics));

    // The three R017 targets from the SHARED constants — the same numbers
    // the T3 harness evaluates, so gate and record can never disagree.
    expect(metrics.detectionPrecision).toBeGreaterThanOrEqual(
      QUALITY_TARGETS.detectionPrecision,
    );
    expect(metrics.recall).toBeGreaterThanOrEqual(QUALITY_TARGETS.recall);
    expect(metrics.matchingPrecision).toBeGreaterThanOrEqual(
      QUALITY_TARGETS.matchingPrecision,
    );
    // Shared evaluator verdicts (single implementation, MEM148).
    expect(gates.detection).toBe('PASS');
    expect(gates.recall).toBe('PASS');
    expect(gates.matching).toBe('PASS');
  });

  it('emits exactly the derived expected issue counts — zero false positives (D045 canonical 47)', () => {
    // FP = expected-vs-emitted excess per ruleId; the derived per-rule
    // expected counts (CS001 35 / CS002 1 / CS003 0 / CS004 3 / CS005 2 /
    // CS006 1 / CS007 2 / CS008 3 / CS009 0 = 47) live in the shared module.
    // The corpus today emits exactly those 47 — any excess is a genuine
    // false positive to investigate (a rule firing where none should).
    expect(metrics.falsePositiveCount).toBe(0);
    expect(metrics.falsePositiveRate).toBe(0);
    // Canonical-totals lock: under-emission is already caught by the recall
    // gate; this pins the expected surface itself to the probe-verified
    // totals so a manifest edit cannot silently shift the baseline.
    expect(metrics.expectedIssueCount).toBe(47);
    expect(metrics.emittedIssueCount).toBe(47);
  });

  // Drift guard (MEM148): inert until T3 records benchmarks/results/
  // quality-corpus.json (skipIf), then locks test-computed == committed.
  // The harness stores `corpusCount` at the top level while the gate
  // recomputes it as perFixture.length — the deep-equal merges the two so
  // either placement stays locked.
  it.skipIf(!existsSync(EVIDENCE_PATH))(
    'drift guard — recomputed metrics deep-equal the committed quality-corpus.json evidence',
    () => {
      const recorded = JSON.parse(readFileSync(EVIDENCE_PATH, 'utf8')) as {
        metrics: {
          detectionPrecision: number;
          recall: number;
          matchingPrecision: number;
          falsePositiveCount: number;
          falsePositiveRate: number;
          emittedIssueCount: number;
          expectedIssueCount: number;
        };
        corpusCount: number;
      };
      expect({
        detectionPrecision: metrics.detectionPrecision,
        recall: metrics.recall,
        matchingPrecision: metrics.matchingPrecision,
        falsePositiveCount: metrics.falsePositiveCount,
        falsePositiveRate: metrics.falsePositiveRate,
        emittedIssueCount: metrics.emittedIssueCount,
        expectedIssueCount: metrics.expectedIssueCount,
        corpusCount: metrics.perFixture.length,
      }).toEqual({ ...recorded.metrics, corpusCount: recorded.corpusCount });
    },
  );
});
