/**
 * M005-S02-T5 — e2e error-states spec (production build via vite preview).
 *
 * Executable proof of the S02 demo contract on the REAL production artifact:
 *
 *   1. idle negative:  fresh load → drop-zone + file-input visible, NO
 *                      stage-* items (the checklist only renders once a run
 *                      starts — idle shell, UI-SPEC §4.2).
 *   2. oversize:       zip-bomb.docx → error-panel (FROZEN EN text) +
 *                      guidance line (error.guidance.oversize EN) + the five
 *                      stage-* items persist (failure isolation, PRD §88) +
 *                      drop-zone/file-input still enabled (no dead end).
 *   3. stages persist: medium.docx → report renders → all five stage-* carry
 *                      stage-done (done envelope carries the full list).
 *   4. zero-issue:     medium.docx → report-summary 'Citation consistency
 *                      looks good.' + explorer 'No issues found.' (counts 0).
 *   5. export failure: URL.createObjectURL throws (addInitScript, this test
 *                      only) → click export-json → export-error visible with
 *                      'Export failed.' → panel still mounted (no crash).
 *
 * FROZEN testids (unchanged — Appendix A): file-input, drop-zone, stage-*,
 * report-summary, error-panel, export-panel, export-json, export-error (new
 * M005-S02 §7.2.3 — this spec is the test that uses it), explorer.
 *
 * Fixture paths resolve from THIS file (apps/web/e2e/) up to the repo root:
 *   new URL('../../../fixtures/...', import.meta.url) → <root>/fixtures/...
 */

import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const ZIP_BOMB_DOCX = fileURLToPath(new URL('../../../fixtures/security/zip-bomb.docx', import.meta.url));
const MEDIUM_DOCX = fileURLToPath(new URL('../../../fixtures/quality/medium.docx', import.meta.url));
const MINIMAL_DOCX = fileURLToPath(new URL('../../../fixtures/minimal.docx', import.meta.url));

/** The five real pipeline stages — internal contract (D025), frozen. */
const FIVE_STAGES: readonly string[] = [
  'reading-document',
  'detecting-bibliography',
  'finding-citations',
  'matching-references',
  'running-checks',
];

test.describe('error states (production build)', () => {
  test('idle: drop-zone visible, no stage checklist before a run', async ({ page }) => {
    await page.goto('/');

    // Fresh load → empty state (UI-SPEC §4.1): drop zone is the surface.
    await expect(page.getByTestId('drop-zone')).toBeVisible();
    await expect(page.getByTestId('file-input')).toBeVisible();

    // Idle gate (UI-SPEC §4.2, M005-S02-T3): the checklist does NOT render
    // at idle — no stage-* items exist yet.
    for (const stage of FIVE_STAGES) {
      await expect(page.getByTestId(`stage-${stage}`)).toHaveCount(0);
    }
  });

  test('oversize: zip-bomb → typed error panel + guidance + stages persist + UI alive', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByTestId('file-input')).toBeVisible();

    // zip-bomb.docx → ZipBombError envelope (stable name, D021).
    await page.setInputFiles('input[data-testid="file-input"]', ZIP_BOMB_DOCX);

    // FROZEN describeWorkerError EN text mentions safety/size limits.
    await expect(page.getByTestId('error-panel')).toBeVisible();
    await expect(page.getByTestId('error-panel')).toContainText('safety');

    // M005-S02-T3 guidance layer: the i18n hint renders UNDER the frozen
    // message (error.guidance.oversize EN — default locale).
    await expect(page.getByTestId('error-panel')).toContainText('Reduce the file size');

    // Failure isolation (PRD §88): the stages reached before the error still
    // render — the user sees how far the run got.
    for (const stage of FIVE_STAGES) {
      await expect(page.getByTestId(`stage-${stage}`)).toBeVisible();
    }
    // analyzing=false after the error envelope → no stage is current.
    for (const stage of FIVE_STAGES) {
      await expect(page.getByTestId(`stage-${stage}`)).not.toHaveClass(/stage-current/);
    }

    // No dead end: the same drop zone accepts another file after the error.
    await expect(page.getByTestId('drop-zone')).toBeVisible();
    await expect(page.getByTestId('file-input')).toBeEnabled();
  });

  test('success: medium.docx → stages persist as done after report renders', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('file-input')).toBeVisible();

    await page.setInputFiles('input[data-testid="file-input"]', MEDIUM_DOCX);

    // Deterministic done envelope → report renders.
    await expect(page.getByTestId('report-summary')).toBeVisible();

    // Stages persist post-completion (e2e assert — UI-SPEC §4.2): the done
    // envelope carries all five, all marked stage-done.
    for (const stage of FIVE_STAGES) {
      await expect(page.getByTestId(`stage-${stage}`)).toHaveClass(/stage-done/);
    }
  });

  test('zero-issue: medium.docx → "looks good" + "No issues found." + counts 0', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByTestId('file-input')).toBeVisible();

    await page.setInputFiles('input[data-testid="file-input"]', MEDIUM_DOCX);

    // Report summary renders with the zero-issue success message
    // (M005-S02-T3, UI-SPEC §4.3 — EN default locale).
    await expect(page.getByTestId('report-summary')).toBeVisible();
    await expect(page.getByTestId('report-summary')).toContainText('Citation consistency looks good.');

    // Explorer shows the empty-issues state.
    await expect(page.getByTestId('explorer')).toBeVisible();
    await expect(page.getByTestId('explorer')).toContainText('No issues found.');
  });

  test('export failure: blocked blob URL → export-error inline, no crash', async ({ page }) => {
    // M005-S02-T3: mock the download seam BEFORE the app loads — every
    // createObjectURL throws, so saveTextFile's blob path fails. Test-scoped
    // (each test gets its own context, so other tests are unaffected).
    await page.addInitScript(() => {
      URL.createObjectURL = () => {
        throw new Error('blocked');
      };
    });
    await page.goto('/');
    await expect(page.getByTestId('file-input')).toBeVisible();

    await page.setInputFiles('input[data-testid="file-input"]', MINIMAL_DOCX);
    await expect(page.getByTestId('report-summary')).toBeVisible();
    await expect(page.getByTestId('export-panel')).toBeVisible();

    // Click JSON export — the download throws → inline export-error appears
    // with the i18n EN text (no silent fail).
    await page.getByTestId('export-json').click();
    await expect(page.getByTestId('export-error')).toBeVisible();
    await expect(page.getByTestId('export-error')).toContainText('Export failed.');

    // No crash: the panel stays mounted and usable for a retry.
    await expect(page.getByTestId('export-panel')).toBeVisible();
    await expect(page.getByTestId('export-json')).toBeEnabled();
  });
});
