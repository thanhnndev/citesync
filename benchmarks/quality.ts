#!/usr/bin/env node
/**
 * benchmarks/quality.ts — T3: R017 quality-gate recording harness (S03).
 *
 * Measures the FOUR R017 metrics (detection precision/recall, matching
 * precision, false-positive issue rate) over the committed ground-truth
 * corpus as measured truth, and records them as WRITE-ONCE committed
 * evidence (R017/MEM155).
 *
 * The metrics are computed through the SHARED pure module
 * benchmarks/quality-metrics.ts — the SAME implementation the CI gate
 * (packages/core/tests/quality-gates.test.ts) asserts — so gate and
 * recorded report can never drift (MEM148). The harness drives the PUBLIC
 * `lintDocument(bytes)` from '@citesync/core' (dist; R008/R009 seam — the
 * exact entry the PWA worker, the S01/S02 harnesses and the CI gate use),
 * projects each report into the shared module's ParsedProjection shape, and
 * evaluates the gates through the shared `evaluateQualityGates()`.
 *
 * EXIT POLICY — the OPPOSITE of benchmarks/perf.ts (MEM148): quality IS
 * CI-gated (the engine is R008 byte-stable, so the numbers are
 * deterministic), therefore this harness exits NON-ZERO when any gate
 * fails, loudly naming the offending metric. Wall-clock perf is recorded
 * only (always exit 0 on a successful measurement); quality is a hard gate
 * — the harness is a local pre-CI check AND the recorder of the committed
 * evidence the CI drift guard locks against.
 *
 * Emits (committed evidence):
 *   benchmarks/results/quality-<label>.json — deterministic metric record
 *     (default label 'corpus' → quality-corpus.json): corpus list + counts,
 *     the computed metrics, the per-fixture table (emitted/expected raws,
 *     fp issues per rule), gate verdicts. NO machine identity — the numbers
 *     are machine-independent (R008) and must be reproducible byte-for-byte
 *     on any machine, so a machine field would only invite drift (noted in
 *     BENCHMARKS.md).
 *
 * R017 write-once: the result file is committed evidence — a re-run with
 * the same label measures and prints but never overwrites an existing file
 * (--force to re-record deliberately). This keeps the recorded JSON
 * byte-stable so a verification re-run cannot mutate committed source.
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { lintDocument } from '@citesync/core';
import type { LintReport } from '@citesync/core';

import {
  computeQualityMetrics,
  corpusFixtures,
  evaluateQualityGates,
  formatQualityTable,
} from './quality-metrics.js';
import type { ParsedProjection, QualityMetricsResult } from './quality-metrics.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(here, '..', 'fixtures');
const RESULTS = join(here, 'results');

const labelIdx = process.argv.indexOf('--label');
/** Default label 'corpus' → benchmarks/results/quality-corpus.json (R017). */
const label = labelIdx >= 0 && process.argv[labelIdx + 1] ? process.argv[labelIdx + 1] : 'corpus';
/** Re-record committed evidence only on explicit request (R017). */
const force = process.argv.includes('--force');

/**
 * Write-once (committed evidence, R017): a results file is a recorded,
 * immutable artifact — re-running the harness must never silently overwrite
 * it (a verification re-run rewriting the committed JSON mid-check is what
 * tripped the source-integrity gate). Use --force to re-record deliberately.
 */
function writeOnce(path: string, contents: string): void {
  if (existsSync(path) && !force) {
    console.log(`SKIP ${path} — exists (committed evidence, R017); --force to re-record`);
    return;
  }
  writeFileSync(path, contents);
  console.log(`wrote ${path}`);
}

/**
 * Project one lint report into the shared module's ParsedProjection shape —
 * identical to the CI gate's projection (packages/core/tests/
 * quality-gates.test.ts): gate and harness feed the SAME shape so the SAME
 * pure module computes the SAME numbers (MEM148). Fixtures with no detected
 * bibliography carry no matchMap (and documents without numeric citations
 * carry no numericIndexMap) — the `undefined` guards keep those fixtures
 * metric-neutral inside computeQualityMetrics.
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

/** Read every committed corpus fixture as raw bytes (git-tracked, R017). */
function readCorpusFixtures(): Map<string, Uint8Array> {
  const bytes = new Map<string, Uint8Array>();
  for (const fixture of corpusFixtures()) {
    bytes.set(fixture, readFileSync(join(FIXTURES_DIR, fixture)));
  }
  return bytes;
}

/** Drive the PUBLIC lintDocument over the whole corpus and project each report. */
function computeCorpusMetrics(): QualityMetricsResult {
  const actual: Record<string, ParsedProjection> = {};
  for (const [fixture, bytes] of readCorpusFixtures()) {
    actual[fixture] = project(lintDocument(bytes));
  }
  return computeQualityMetrics(actual);
}

const metrics = computeCorpusMetrics();
const gates = evaluateQualityGates(metrics);
const corpus = corpusFixtures();

console.log(formatQualityTable(metrics));
console.log(`corpus: ${corpus.length} fixtures (manifest-driven — 26 KNOWN_OCCURRENCES + isolation + QUALITY_CORPUS)`);
console.log(`label: ${label} | --force: ${force}`);

// Committed evidence record — NO machine identity (deterministic,
// machine-independent, R008): the same numbers must reproduce on any
// machine, so `metrics` carries exactly the seven computed fields and the
// top-level corpusCount matches the CI drift guard's read shape.
const evidence = {
  fixture: 'quality corpus (manifest-driven, committed fixtures/)',
  label,
  corpusCount: metrics.perFixture.length,
  corpus,
  metrics: {
    detectionPrecision: metrics.detectionPrecision,
    recall: metrics.recall,
    matchingPrecision: metrics.matchingPrecision,
    falsePositiveCount: metrics.falsePositiveCount,
    falsePositiveRate: metrics.falsePositiveRate,
    emittedIssueCount: metrics.emittedIssueCount,
    expectedIssueCount: metrics.expectedIssueCount,
  },
  perFixture: metrics.perFixture.map((row) => ({
    fixture: row.fixture,
    emitted: row.emitted,
    expected: row.expected,
    fp: row.fp,
    issues: row.issues,
  })),
  gates,
  recordedAt: new Date().toISOString(),
};

mkdirSync(RESULTS, { recursive: true });
const outPath = join(RESULTS, `quality-${label}.json`);
writeOnce(outPath, JSON.stringify(evidence, null, 2) + '\n');

// Gate summary — the same shared verdicts the CI gate asserts. Unlike perf,
// a FAIL here is a hard failure (exit 1): quality is CI-gated (MEM148).
const failed = (gates.detection === 'FAIL' ? ['detectionPrecision'] : []).concat(
  gates.recall === 'FAIL' ? ['recall'] : [],
  gates.matching === 'FAIL' ? ['matchingPrecision'] : [],
);
console.log(
  `gates: detection ${gates.detection} | recall ${gates.recall} | matching ${gates.matching}` +
    ` (targets >= 0.98 / >= 0.95 / >= 0.97, FP = 0)`,
);
if (failed.length === 0) {
  console.log(`R017 quality gates: PASS — metrics recorded at ${outPath} (write-once, R017)`);
} else {
  console.error(`R017 quality gates: FAIL — ${failed.join(', ')} below target; see the table above`);
  console.error(`drift surface: recompute through the SHARED module (benchmarks/quality-metrics.ts), never edit the record`);
  process.exitCode = 1;
}
