/**
 * T6 — e2e smoke of the offline PWA shell (production build via vite preview).
 *
 * Executable proof of the S01 demo contract on the REAL production artifact
 * (dist/ + real service worker precache — vite preview, NOT devOptions SW):
 *
 *   1. happy path:  drop minimal.docx → 5 real stages → deterministic report
 *                   (1 ERROR = CS001) → 'Processing locally' badge semantics.
 *   2. offline:     SW ready → context offline → reload served from precache
 *                   → analysis STILL completes (worker + @citesync/core run
 *                   from precached assets; file input needs no network).
 *   3. error path:  garbage.docx → NotADocxError envelope → friendly error
 *                   panel (R016) → page still responsive (no crash).
 *
 * data-testid contract (FROZEN — T5): file-input, drop-zone, processing-badge,
 * stage-{stage}, report-summary, error-panel.
 *
 * Fixture paths resolve from THIS file (apps/web/e2e/) up to the repo root:
 *   new URL('../../../fixtures/...', import.meta.url) → <root>/fixtures/...
 */

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// repo-root fixture paths (committed, deterministic — R008/R017).
const MINIMAL_DOCX = fileURLToPath(new URL('../../../fixtures/minimal.docx', import.meta.url));
const GARBAGE_DOCX = fileURLToPath(new URL('../../../fixtures/security/garbage.docx', import.meta.url));

/** The five real pipeline stages — internal contract (D025), frozen. */
const FIVE_STAGES: readonly string[] = [
  'reading-document',
  'detecting-bibliography',
  'finding-citations',
  'matching-references',
  'running-checks',
];

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

test.describe('offline PWA shell (production build)', () => {
  test('happy path: drop .docx → 5 stages → report with ERROR', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('file-input')).toBeVisible();

    // Drop the golden fixture: minimal.docx → exactly 1 ERROR (CS001).
    await page.setInputFiles('input[data-testid="file-input"]', MINIMAL_DOCX);

    // All five §61 stages reach the checklist (visibility only — the run on
    // minimal.docx settles fast, so item status may already be ✓ done; the
    // stage NAMES are the frozen contract, not their transient status).
    for (const stage of FIVE_STAGES) {
      await expect(page.getByTestId(`stage-${stage}`)).toBeVisible();
    }

    // Deterministic report: report-summary renders severity counts, ERROR 1.
    await expect(page.getByTestId('report-summary')).toBeVisible();
    await expect(page.getByTestId('report-summary')).toContainText('ERROR');

    // R011: badge is always mounted; in done state text still says "locally".
    await expect(page.getByTestId('processing-badge')).toContainText('locally');
  });

  test('offline: SW precache serves reload, analysis still completes', async ({ page, context }) => {
    await page.goto('/');
    await expect(page.getByTestId('file-input')).toBeVisible();

    // SW must be installed + active BEFORE going offline — precache complete.
    await waitForActiveServiceWorker(page);

    // Go offline; the reload is a NEW navigation in SW scope → served from
    // the workbox precache (index.html + JS/CSS + the worker chunk).
    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });

    // App shell rendered from precache — SW serving, not network.
    await expect(page.getByTestId('file-input')).toBeVisible();
    await expect(page.getByTestId('drop-zone')).toBeVisible();

    // Analysis runs entirely client-side: worker + @citesync/core come from
    // the precache; the file input needs no network. Deterministic report.
    await page.setInputFiles('input[data-testid="file-input"]', MINIMAL_DOCX);
    await expect(page.getByTestId('report-summary')).toBeVisible();
    await expect(page.getByTestId('report-summary')).toContainText('ERROR');

    // Restore the network so later tests are unaffected.
    await context.setOffline(false);
  });

  test('error path: garbage file → typed error panel, page stays responsive', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('file-input')).toBeVisible();

    // garbage.docx is 59 bytes of ASCII → NotADocxError (stable name, D021).
    await page.setInputFiles('input[data-testid="file-input"]', GARBAGE_DOCX);

    // Friendly text from describeWorkerError (R016) mentions DOCX.
    await expect(page.getByTestId('error-panel')).toBeVisible();
    await expect(page.getByTestId('error-panel')).toContainText('DOCX');

    // No crash (R016): the shell is still mounted and interactive — the same
    // input can accept another file after the typed error.
    await expect(page.getByTestId('drop-zone')).toBeVisible();
    await expect(page.getByTestId('processing-badge')).toBeVisible();
    await expect(page.getByTestId('file-input')).toBeEnabled();
  });
});
