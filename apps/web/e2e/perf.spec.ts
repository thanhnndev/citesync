/**
 * T5 — Playwright large-doc spec: stages + responsiveness + report render.
 *
 * Executable proof of R015 on the REAL production artifact (vite preview,
 * dist/ build, real worker): the committed 100-page fixture
 * (fixtures/perf/100-page.docx — 2335 citations / 260 references / 84
 * issues, deterministic, R008/R017) is dropped into the PWA and:
 *
 *   1. all five §61 stage-* testids become visible — the frozen D025 names
 *      (visibility only, never their transient status),
 *   2. the MAIN THREAD stays responsive while the worker analyzes: a
 *      high-frequency interval counter armed BEFORE the drop keeps ticking
 *      during the run. The samples are badge-tagged, so the analyzing
 *      window (badge 'Processing locally') is isolated and must show the
 *      event loop advancing — if parsing ran on the UI thread (R015
 *      violation) the counter would freeze for the whole window,
 *   3. report-summary renders the deterministic report with a generous
 *      bounded timeout — the done envelope carries the full doc (~2.5 MB
 *      JSON; structured clone + React render add a tail). NEVER assert
 *      wall-clock inside Playwright: speed (the < 3 s gate) is judged by
 *      benchmarks/perf.ts on the recorded machine; this spec asserts
 *      behaviour, not speed.
 *
 * Responsiveness signal design: the assertion uses the 10 ms INTERVAL
 * counter — an event-loop liveness signal that only stalls when the main
 * thread is blocked by synchronous work. rAF is captured per-sample too
 * (diagnostics), but headless chromium throttles frame production under
 * parallel CI load, so rAF is not asserted. The analyzing window ends with
 * the acknowledged main-thread tail (structured clone + React render, badge
 * still 'Processing locally') — the assertion therefore checks TOTAL
 * advancement across the window (pipeline phase runs free) instead of every
 * consecutive pair.
 *
 * Measured on this machine (production build, chromium): stages visible
 * within ~20 ms of the drop; analyzing window ~105–340 ms; report rendered
 * at ~335 ms; ~5 in-flight samples at 50 ms cadence.
 *
 * The 84-issue report is small, so assertions stay at the summary-level
 * frozen testids (file-input, processing-badge, stage-*, report-summary) —
 * no deep evidence expansion.
 *
 * Fixture paths resolve from THIS file (apps/web/e2e/) up to the repo root:
 *   new URL('../../../fixtures/...', import.meta.url) → <root>/fixtures/...
 */

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// repo-root fixture path (committed, deterministic — R008/R017).
const PERF_DOCX = fileURLToPath(
  new URL('../../../fixtures/perf/100-page.docx', import.meta.url),
);

/** The five real pipeline stages — internal contract (D025), frozen. */
const FIVE_STAGES: readonly string[] = [
  'reading-document',
  'detecting-bibliography',
  'finding-citations',
  'matching-references',
  'running-checks',
];

/**
 * Deterministic meta counts of the committed perf fixture (measured on the
 * byte-stable file — R008/R017; regenerating the fixture is an explicit
 * commit that must update this).
 */
const PERF_META = { citations: 2335, references: 260 } as const;

/** One sample of the responsiveness time series (badge-tagged). */
interface ResponsiveSample {
  /** performance.now() at sample time (diagnostics only). */
  t: number;
  /** 10 ms interval counter value at sample time (event-loop liveness). */
  ticks: number;
  /** rAF tick counter value at sample time (diagnostics — not asserted). */
  rafTicks: number;
  /** processing-badge text at sample time — 'Processing locally' during analysis. */
  badge: string | null;
}

/**
 * Arm the counters + 50 ms badge-tagged sampling loop BEFORE the file drop.
 * Returns a reader for the accumulated samples (called from the test
 * whenever a snapshot of the time series is needed).
 */
async function armResponsivenessSampler(page: Page): Promise<() => Promise<ResponsiveSample[]>> {
  await page.evaluate(() => {
    const win = window as unknown as {
      __csTicks: number;
      __csRafTicks: number;
      __csSamples: ResponsiveSample[];
    };
    win.__csTicks = 0;
    win.__csRafTicks = 0;
    win.__csSamples = [];
    // Event-loop liveness: fires ~100×/s unless the main thread is blocked.
    window.setInterval(() => {
      win.__csTicks += 1;
    }, 10);
    // Frame production (diagnostics only — headless throttles under load).
    const raf = (): void => {
      win.__csRafTicks += 1;
      requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
    // Badge-tagged sampling: isolates the analyzing window from the done
    // envelope (badge flips to 'Processed locally' only after the React
    // commit at the end of the clone+render tail).
    window.setInterval(() => {
      win.__csSamples.push({
        t: performance.now(),
        ticks: win.__csTicks,
        rafTicks: win.__csRafTicks,
        badge: document.querySelector('[data-testid="processing-badge"]')?.textContent ?? null,
      });
    }, 50);
  });
  return () =>
    page.evaluate(
      () => (window as unknown as { __csSamples: ResponsiveSample[] }).__csSamples,
    );
}

test.describe('large-doc performance proof (production build)', () => {
  test('100-page doc: stages visible, main thread responsive, report renders', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('file-input')).toBeVisible();

    // Arm the sampler BEFORE the drop — the samples below span the whole
    // run, and the badge tag isolates the analyzing window.
    const readSamples = await armResponsivenessSampler(page);

    // Drop the committed 100-page fixture.
    await page.setInputFiles('input[data-testid="file-input"]', PERF_DOCX);

    // All five §61 stages reach the checklist (frozen D025 names; the stage
    // NAMES are the contract, never their transient status).
    for (const stage of FIVE_STAGES) {
      await expect(page.getByTestId(`stage-${stage}`)).toBeVisible();
    }

    // report-summary renders the deterministic report. Generous bounded
    // timeout: the done envelope carries the full doc (~2.5 MB JSON);
    // structured clone + React render add a tail. No wall-clock speed
    // assertion here — that is the Node harness's job (benchmarks/perf.ts).
    await expect(page.getByTestId('report-summary')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('report-summary')).toContainText(
      `${PERF_META.citations} citations`,
    );
    await expect(page.getByTestId('report-summary')).toContainText(
      `${PERF_META.references} references`,
    );

    // Done envelope: R011 badge semantics + the five stages persisted in the
    // checklist (the done-envelope `stages` is the checklist truth).
    await expect(page.getByTestId('processing-badge')).toContainText('locally');
    for (const stage of FIVE_STAGES) {
      await expect(page.getByTestId(`stage-${stage}`)).toBeVisible();
    }

    // Responsiveness proof (R015): the time series captured DURING the run
    // must show the main-thread event loop running while the worker parsed.
    // (a) the analyzing window was actually observed — badge 'Processing
    //     locally' on at least two 50 ms samples (the ~250 ms window yields
    //     ~5 on this machine; a much shorter window still yields >= 2),
    // (b) the 10 ms interval counter ADVANCED between the first and the last
    //     in-flight sample — the event loop kept executing while the worker
    //     did the heavy parsing. If parsing ran on the UI thread, the whole
    //     window would be one synchronous block and the counter could not
    //     advance at all (first ticks === last ticks → FAIL). The window's
    //     tail (structured clone + React render) is a bounded main-thread
    //     cost by design and is NOT required to tick — hence first→last
    //     total, not every consecutive pair,
    // (c) the counter keeps advancing after the render tail — the shell is
    //     alive and painting (no crash, R016).
    const samples = await readSamples();
    const analyzing = samples.filter((s) => s.badge?.includes('Processing'));
    expect(
      analyzing.length,
      'observed the analyzing window (badge "Processing locally") while the worker parsed',
    ).toBeGreaterThanOrEqual(2);
    expect(
      analyzing[analyzing.length - 1].ticks,
      'main-thread event loop kept running while the worker parsed (R015: heavy parsing off the UI thread)',
    ).toBeGreaterThan(analyzing[0].ticks);
    const tailAt = samples.at(-1);
    await page.waitForTimeout(100);
    const tailLater = (await readSamples()).at(-1);
    expect(tailLater!.ticks).toBeGreaterThan(tailAt!.ticks);
  });
});
