/**
 * T4 — e2e of the S04 export contract on the PRODUCTION build (vite preview
 * + real SW precache — smoke.spec.ts pattern, NOT devOptions SW).
 *
 * Executable health check for R014 (export JSON byte-compatible with CLI
 * --json) / R008 (determinism) / R011 (offline PWA) on the REAL production
 * artifact:
 *
 *   test 1 JSON byte-parity: drop minimal.docx → done → export-json →
 *     suggestedFilename 'minimal.docx.json' → downloaded bytes EXACTLY equal
 *     runCli(['--json', fixture]).stdout (the frozen CLI serializer, D024)
 *     → validateReport(downloaded).valid === true → frozen testids
 *     export-panel / export-json / export-html present+enabled → no
 *     uncaught pageerrors (resolution.spec.ts collector pattern).
 *   test 2 HTML standalone + deterministic: export-html →
 *     'minimal.docx.html' → the document contains the embedded canonical
 *     JSON (script#citesync-report), the severity summary (ERROR 1), the
 *     CS001 issue entry with its no-entry evidence, and NO external
 *     src=/href= references (offline-safe from disk) → determinism:
 *     buildHtmlReport called twice in-process is byte-identical AND equals
 *     the downloaded bytes (the app bundle runs the exact same pure
 *     builder — T3).
 *   test 3 offline export: SW active → context.setOffline(true) → drop →
 *     done → export-json still downloads and bytes STILL match runCli
 *     stdout (pure client-side: worker + @citesync/core from the SW
 *     precache, blob download needs no network) → network restored.
 *
 * MEM107 gotcha: the SW precache serves stale bundles after a rebuild — each
 * test uses a fresh default Playwright context (never shared), so the
 * precached worker/app are per-test and always match the served bundle.
 */

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { runCli } from '../../../packages/cli/src/index.js';
import { validateReport } from '../../../packages/cli/src/json-schema.js';
import { buildHtmlReport } from '../../../apps/web/src/export/html.ts';

// repo-root fixture path (committed, deterministic — R008/R017).
const MINIMAL_DOCX = fileURLToPath(new URL('../../../fixtures/minimal.docx', import.meta.url));

/** Wait until the service worker for scope '/' is registered AND active. */
async function waitForActiveServiceWorker(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    const registration = await navigator.serviceWorker.getRegistration('/');
    if (registration?.active === undefined || registration?.active === null) {
      throw new Error('service worker not active for scope /');
    }
  });
}

/** Drop minimal.docx and wait for the deterministic done envelope. */
async function analyzeMinimal(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('file-input')).toBeVisible();
  await page.setInputFiles('input[data-testid="file-input"]', MINIMAL_DOCX);
  await expect(page.getByTestId('report-summary')).toBeVisible();
  await expect(page.getByTestId('export-panel')).toBeVisible();
}

test.describe('report export (production build)', () => {
  test('JSON export: byte-parity with CLI --json + frozen testids', async ({ page }) => {
    // No uncaught JS errors anywhere on this page (slice verification).
    const pageErrors: Error[] = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    await analyzeMinimal(page);

    // Frozen testids: export-panel mounted, both export buttons visible +
    // enabled (the panel is only rendered in the done state).
    await expect(page.getByTestId('export-json')).toBeVisible();
    await expect(page.getByTestId('export-json')).toBeEnabled();
    await expect(page.getByTestId('export-html')).toBeVisible();
    await expect(page.getByTestId('export-html')).toBeEnabled();

    // Download the JSON export (a browser download event, not a fetch).
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('export-json').click();
    const download = await downloadPromise;

    // Filename contract (T2): source basename + appended .json.
    expect(download.suggestedFilename()).toBe('minimal.docx.json');

    // Byte-parity: downloaded bytes === CLI --json stdout on the same fixture
    // (the app and the CLI share serializeReport from @citesync/core — D024).
    const downloadedText = readFileSync(await download.path(), 'utf8');
    const cliOutcome = runCli(['--json', MINIMAL_DOCX]);
    expect(downloadedText).toBe(cliOutcome.stdout);

    // The downloaded artifact validates against the frozen schema (R014).
    const validation = validateReport(downloadedText);
    expect(validation.valid).toBe(true);

    // No uncaught JS errors across the whole flow.
    expect(pageErrors).toEqual([]);
  });

  test('HTML export: standalone, deterministic, byte-matches the pure builder', async ({
    page,
  }) => {
    await analyzeMinimal(page);

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('export-html').click();
    const download = await downloadPromise;

    // Filename contract (T2): source basename + appended .html.
    expect(download.suggestedFilename()).toBe('minimal.docx.html');

    const htmlText = readFileSync(await download.path(), 'utf8');

    // Standalone document with the canonical report JSON embedded verbatim
    // (script#citesync-report — T3 breakout-safe embedding).
    expect(htmlText).toContain('<script type="application/json" id="citesync-report">');

    // Severity summary in RULE_SEVERITIES order: ERROR 1 for minimal.docx.
    expect(htmlText).toContain('<span class="severity-name">ERROR</span>');
    expect(htmlText).toContain('<span class="severity-value">1</span>');

    // The CS001 issue entry with its frozen evidence (code no-entry).
    expect(htmlText).toContain('id="issue-CS001:0"');
    expect(htmlText).toContain('<code class="evidence-code">no-entry</code>');

    // Standalone: zero external references — the file renders from disk with
    // no network (R011): no src=, no href=, no <link>.
    expect(htmlText).not.toContain('src=');
    expect(htmlText).not.toContain('href=');
    expect(htmlText).not.toContain('<link');

    // Determinism (R008) + byte-parity with the pure builder: two in-process
    // buildHtmlReport calls are byte-identical AND equal the downloaded bytes
    // — the app bundle runs the exact same builder (T3), so the production
    // artifact cannot drift from the node-tested pure function.
    const validation = validateReport(runCli(['--json', MINIMAL_DOCX]).stdout);
    if (!validation.valid) throw new Error('expected a valid report from runCli');
    const builtOnce = buildHtmlReport(validation.report);
    const builtTwice = buildHtmlReport(validation.report);
    expect(builtOnce).toBe(builtTwice);
    expect(htmlText).toBe(builtOnce);
  });

  test('offline export: JSON download still byte-identical (SW precache, no network)', async ({
    page,
    context,
  }) => {
    await page.goto('/');
    await expect(page.getByTestId('file-input')).toBeVisible();

    // SW must be installed + active BEFORE going offline (precache complete).
    await waitForActiveServiceWorker(page);

    // The entire analysis + export runs client-side: worker + @citesync/core
    // from the SW precache, blob download needs no network (R011).
    await context.setOffline(true);
    await page.setInputFiles('input[data-testid="file-input"]', MINIMAL_DOCX);
    await expect(page.getByTestId('report-summary')).toBeVisible();
    await expect(page.getByTestId('export-panel')).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('export-json').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('minimal.docx.json');

    const downloadedText = readFileSync(await download.path(), 'utf8');
    expect(downloadedText).toBe(runCli(['--json', MINIMAL_DOCX]).stdout);

    // Restore the network so later tests are unaffected.
    await context.setOffline(false);
  });
});
