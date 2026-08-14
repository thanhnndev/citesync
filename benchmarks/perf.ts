#!/usr/bin/env node
/**
 * benchmarks/perf.ts — T2: reproducible R015 timing harness (S01).
 *
 * Reads the committed 100-page fixture and drives the public
 * `lintDocument(bytes, { onStage })` from @citesync/core: warm-up runs, then
 * >=7 measured runs. Per-stage deltas come from the onStage callback: each
 * stage fires right before its work begins (buildModel), so stage N's delta
 * is the span between its fire and the next stage's fire — the last stage
 * spans to run end. Stage names are PIPELINE_STAGES (re-exported by core).
 *
 * Emits (committed evidence):
 *   benchmarks/results/perf-100-page-<label>.json — per-stage medians/p95,
 *     total median/p95/min/max/spread, machine identity, gate note.
 *   benchmarks/results/machine-snapshot.json — machine identity ONLY
 *     (byte-stable across runs on the same machine: no timestamps, R017
 *     discipline) so PRE/POST rows share one machine description.
 *
 * MEM148: the 3000 ms gate is judged on the RECORDED machine, never CI
 * wall-clock. The script prints a PASS/FAIL note but always exits 0 when the
 * measurement itself succeeds.
 *
 * R017 write-once: result files are committed evidence — a re-run with the
 * same label measures and reports but never overwrites an existing file
 * (--force to re-record deliberately). This keeps the recorded JSON
 * byte-stable so a verification re-run cannot mutate committed source.
 */

import { cpus, platform, release, arch, totalmem } from 'node:os';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { lintDocument, PIPELINE_STAGES } from '@citesync/core';
import type { PipelineStage } from '@citesync/core';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, '..', 'fixtures', 'perf', '100-page.docx');
const RESULTS = join(here, 'results');
const WARMUP = 3;
const MEASURED = 8;
const GATE_MS = 3000;

const labelIdx = process.argv.indexOf('--label');
const label = labelIdx >= 0 && process.argv[labelIdx + 1] ? process.argv[labelIdx + 1] : 'run';
/** Re-record committed evidence only on explicit request (R017). */
const force = process.argv.includes('--force');

const sortAsc = (a: number[]) => [...a].sort((x, y) => x - y);
const median = (a: number[]) => {
  const s = sortAsc(a);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
/** Nearest-rank percentile (documented: with n=8, p95 is the max). */
const pct = (a: number[], p: number) => {
  const s = sortAsc(a);
  return s[Math.max(0, Math.min(s.length - 1, Math.ceil(p * s.length) - 1))];
};

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

function runOnce(bytes: Uint8Array): { totalMs: number; stageMs: Record<PipelineStage, number> } {
  const fires = new Map<PipelineStage, number>();
  const t0 = performance.now();
  lintDocument(bytes, { onStage: (stage) => fires.set(stage, performance.now()) });
  const end = performance.now();
  const stageMs = {} as Record<PipelineStage, number>;
  for (let i = 0; i < PIPELINE_STAGES.length; i++) {
    const stage = PIPELINE_STAGES[i];
    const fire = fires.get(stage);
    if (fire === undefined) {
      throw new Error(`benchmark: onStage never fired '${stage}' — pipeline contract broken`);
    }
    const next = i + 1 < PIPELINE_STAGES.length ? (fires.get(PIPELINE_STAGES[i + 1]) ?? end) : end;
    stageMs[stage] = next - fire;
  }
  return { totalMs: end - t0, stageMs };
}

const bytes = readFileSync(FIXTURE);
console.log(`fixture ${FIXTURE} (${(bytes.length / 1024).toFixed(0)} KiB) | warm-up ${WARMUP} | measured ${MEASURED} | label ${label}`);
for (let i = 0; i < WARMUP; i++) runOnce(bytes);

const totals: number[] = [];
const perStage: Record<string, number[]> = {};
for (const s of PIPELINE_STAGES) perStage[s] = [];
for (let i = 0; i < MEASURED; i++) {
  const r = runOnce(bytes);
  totals.push(r.totalMs);
  for (const s of PIPELINE_STAGES) perStage[s].push(r.stageMs[s]);
  console.log(`run ${String(i + 1).padStart(2)}: ${r.totalMs.toFixed(1)} ms`);
}

const round1 = (v: number) => +v.toFixed(1);
const totalMs = {
  median: round1(median(totals)),
  p95: round1(pct(totals, 0.95)),
  min: round1(Math.min(...totals)),
  max: round1(Math.max(...totals)),
  spreadPct: round1(((Math.max(...totals) - Math.min(...totals)) / median(totals)) * 100),
};
const stageMs = Object.fromEntries(
  PIPELINE_STAGES.map((s) => [s, { median: round1(median(perStage[s])), p95: round1(pct(perStage[s], 0.95)) }]),
);
const machine = {
  platform: platform(),
  arch: arch(),
  release: release(),
  cpuModel: cpus()[0]?.model ?? 'unknown',
  cpuCores: cpus().length,
  cpuSpeedMhz: cpus()[0]?.speed ?? 0,
  totalMemGb: round1(totalmem() / 2 ** 30),
  node: process.version,
};

mkdirSync(RESULTS, { recursive: true });
writeOnce(join(RESULTS, 'machine-snapshot.json'), JSON.stringify(machine, null, 2) + '\n');

const result = {
  fixture: 'fixtures/perf/100-page.docx',
  label,
  warmupRuns: WARMUP,
  measuredRuns: MEASURED,
  totalMs,
  stageMs,
  gateMs: GATE_MS,
  passesGate: totalMs.median < GATE_MS,
  machine,
  recordedAt: new Date().toISOString(),
};
const outPath = join(RESULTS, `perf-100-page-${label}.json`);
writeOnce(outPath, JSON.stringify(result, null, 2) + '\n');

const gate = totalMs.median < GATE_MS ? 'PASS' : 'FAIL';
console.log(`\nmedian ${totalMs.median} ms | p95 ${totalMs.p95} | min ${totalMs.min} | max ${totalMs.max} | spread ${totalMs.spreadPct}%`);
console.log(
  gate === 'PASS'
    ? `R015 gate (<${GATE_MS} ms): PASS (${(GATE_MS / totalMs.median).toFixed(1)}x headroom) — judged on this recorded machine (see BENCHMARKS.md)`
    : `R015 gate (<${GATE_MS} ms): FAIL — median ${totalMs.median} ms on this machine (see BENCHMARKS.md)`,
);
console.log(`evidence: ${outPath} + machine-snapshot.json (write-once, R017)`);
