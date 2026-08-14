# BENCHMARKS — R015: 100-page document under 3 seconds

R015 is a **measured claim, not a promise** (MEM148): timing is recorded on a
specific machine and judged against the 3000 ms gate *on that machine* — never
gated on CI wall-clock. This file is the audit surface for the S01 proof.

## Methodology

- **Fixture**: `fixtures/perf/100-page.docx` (committed, byte-stable R017,
  53.5K words, 260 reference entries, ~2960 citations, 30 footnotes, 3 tables,
  6 Zotero fields — see `fixtures/README.md`).
- **Driver**: `benchmarks/perf.ts` → public `lintDocument(bytes, { onStage })`
  from `@citesync/core` (the exact production entry; no internal shortcuts).
- **Runs**: 3 warm-up runs (JIT/deopt stabilization), then **8 measured runs**
  (≥7 per contract). Median / p95 / min / max reported; spread =
  `(max − min) / median`.
- **Per-stage timing**: collected from the `onStage` callback — each stage
  fires right before its work begins (`buildModel`), so stage N's delta is the
  span between its fire and the next stage's fire (last stage spans to run
  end). Stage names are the frozen `PIPELINE_STAGES` (D025).
- **Percentile**: nearest-rank (with n=8, p95 is the max).
- **Exit policy**: the harness prints a PASS/FAIL note against the 3000 ms
  gate but always exits 0 when the measurement succeeds — the claim is judged
  from the recorded JSON on the recorded machine, not from the exit code.

## Machine (from `benchmarks/results/machine-snapshot.json`)

| Field | Value |
|-------|-------|
| platform | linux (7.1.8-1-cachyos) |
| arch | x64 |
| CPU | 13th Gen Intel(R) Core(TM) i9-13900K |
| cores | 32 |
| CPU speed | 5500 MHz |
| RAM | 31.1 GB |
| Node | v24.18.0 |

`machine-snapshot.json` holds machine identity **only** (no timestamps), so
PRE/POST rows share one machine description and the file is byte-stable across
runs on the same machine (R017 discipline).

## Commands

```bash
npm run benchmark:perf -- --label pre    # pre-optimization baseline
npm run benchmark:perf -- --label post   # post-optimization (T3/T4)
npm run benchmark:perf -- --label pre --force   # re-record an existing baseline deliberately
```

Each run writes:

- `benchmarks/results/perf-100-page-<label>.json` — per-run totals,
  median/p95/min/max/spread, per-stage medians/p95, machine identity, gate note
- `benchmarks/results/machine-snapshot.json` — machine identity

## Results

Same fixture (`fixtures/perf/100-page.docx`), same machine (above), total
median over 8 measured runs.

| Phase | Median | p95 | Min | Max | matching-references median | finding-citations median | Date |
|-------|--------|-----|-----|-----|----------------------------|--------------------------|------|
| PRE (pre-optimization, T2) | **1146.1 ms** | 1193.3 | 1127.6 | 1193.3 | 1065.6 ms | 66.7 ms | 2026-08-14 |
| POST (post-optimization, T4) | **240.7 ms** | 275.1 | 229 | 275.1 | 156.4 ms | 70.4 ms | 2026-08-14 |

Gate (median < 3000 ms): **PASS** for both rows — PRE at 2.6× headroom,
POST at **12.5× headroom**. POST is **4.8× faster** than PRE on the same
fixture and machine. `matching-references` dominated the PRE profile at
~93% of total (1065.6 ms) and is the T3 matcher optimization target:
1065.6 → 156.4 ms (~6.8× faster). `finding-citations` is flat across the
optimization (66.7 → 70.4 ms), as expected — the memoization only touches
citation-side key derivation inside the per-entry matching loop.

Run-to-run stability check: PRE medians across five earlier runs were
1163 / 1166 / 1170 / 1124 / 1171 ms (≈4% spread), with the committed
`benchmarks/results/perf-100-page-pre.json` at 1146.1 ms (its own spread
5.7%) and two post-commit verification re-runs at 1122.6 ms (spread 4%) and
1146.0 ms (spread 12.4% — a busy-desktop run) — one earlier run saw a single
1378 ms scheduler hiccup (spread 24.8%) on this shared desktop. All eight
PRE medians fall within ±2.2% of the committed 1146.1 ms baseline, well
under the 15% stability criterion. The committed POST run (`perf-100-page-post.json`,
spread 19.1% — a 46 ms absolute range at sub-300 ms scale, same class of
shared-desktop scheduler noise as PRE) agrees with the independent
T3-verification measurement of ~240 ms to within ~0.2%, so the 4.8× speedup
is stable across measurements.

Result files are **write-once** committed evidence (R017): re-running the
harness with the same label measures and prints but never overwrites an
existing file — use `--force` to re-record deliberately.

## R017 quality gates

R017 is a **deterministic, CI-gated** claim (MEM148): the engine is R008
byte-stable, so the four quality metrics are machine-independent numbers that
a vitest suite re-computes and asserts on every CI run — the opposite of the
R015 wall-clock claim above, which is recorded-only on the measured machine.

### Metric definitions (shared module `benchmarks/quality-metrics.ts`)

The SAME pure module backs the CI gate and the recording harness, so gate and
recorded report can never drift (MEM148):

- **Detection precision / recall** — multiset raw-string comparison: for each
  fixture the emitted `doc.citations[].raw` strings are counted per unique raw
  and compared to the expected raws (from the committed ground-truth manifests
  + the isolation overlay). TP = Σ min(emitted, expected) per unique raw;
  precision = TP / emitted, recall = TP / expected, aggregated across
  fixtures.
- **Matching precision** — raw-keyed reference matching: correct MATCHED rows
  / total engine-MATCHED rows, where "correct" means the row's matchedEntryId
  equals the expected entry for its raw (expected map built from KNOWN_MATCHES
  joined via KNOWN_OCCURRENCES id→raw, the quality manifest, and the isolation
  overlay). A MATCHED row with no expected entry counts as incorrect
  (conservative). Fixtures with no detected bibliography (no matchMap)
  contribute no matching rows.
- **False-positive issue rate** — expected-vs-emitted excess: per fixture per
  ruleId fp = max(0, emitted[r] − expected[r]) where expected[r] is the
  programmatic per-rule count derived from the manifests + overlays (canonical
  totals: CS001 35 / CS002 1 / CS003 0 / CS004 3 / CS005 2 / CS006 1 /
  CS007 2 / CS008 3 / CS009 0 = 47). falsePositiveCount = Σ fp,
  falsePositiveRate = fpCount / total emitted issues.

### Corpus (committed ground truth)

| Stat | Value |
|------|-------|
| Fixtures | 28 (26 KNOWN_OCCURRENCES ground-truth + isolation/garbage-and-malformed.docx overlay + quality/medium.docx with its own manifest) |
| Expected citations (raws) | 435 (95 hand-authored + 340 generated quality raws) |
| Expected issues | 47 (canonical totals above) |
| Measured FPs | 0 |

The corpus is manifest-driven: `corpusFixtures()` in the shared module unions
the ground-truth manifests with the quality manifest, so the harness and the
CI gate grew automatically when T4's `fixtures/quality/medium.docx` landed
(≈300 citations, own manifest, joins no ground-truth manifests per MEM065)
without touching either.

### Commands

```bash
npm run benchmark:quality                          # measure + record quality-corpus.json (write-once)
npm run benchmark:quality -- --label <name>        # record quality-<name>.json
npm run benchmark:quality -- --force               # deliberately re-record (R017)
npx vitest run packages/core/tests/quality-gates.test.ts   # CI gate (recomputes every run)
```

Unlike `benchmark:perf`, the quality harness **exits non-zero when a gate
fails** — quality is CI-gated, wall-clock perf is recorded-only (MEM148).

### Measured results (anchored to `benchmarks/results/quality-corpus.json`)

| Metric | Measured | Target | Verdict |
|--------|----------|--------|---------|
| detectionPrecision | 1.0000 | ≥ 0.98 | PASS |
| recall | 1.0000 | ≥ 0.95 | PASS |
| matchingPrecision | 1.0000 | ≥ 0.97 | PASS |
| falsePositiveCount | 0 | 0 | PASS |
| falsePositiveRate | 0.0000 | — | — |
| emittedIssueCount / expectedIssueCount | 47 / 47 | — | — |

The recorded JSON is **write-once committed evidence** (R017): re-running the
harness measures and prints but never overwrites it (--force to re-record).
It carries **no machine identity** — the numbers are deterministic and
byte-reproducible on any machine (R008), so a machine field would only invite
drift. The CI suite locks test-computed == recorded: the drift-guard test in
`packages/core/tests/quality-gates.test.ts` asserts the recomputed metric
fields deep-equal the committed JSON's `metrics` — a source regression that
changes the numbers fails the suite loudly, naming the offending metric.
