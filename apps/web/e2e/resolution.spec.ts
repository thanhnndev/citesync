/**
 * T5 — e2e of the R013 manual ambiguity-resolution loop on the PRODUCTION
 * build (vite preview + real SW precache — S02 pattern, NOT devOptions SW).
 *
 * Executable proof of the S03 demo contract on the REAL production artifact
 * with fixtures/match/ambiguous-same-author-year.docx (the flagship CS004
 * fixture: WARNING 2×CS005 + AMBIGUOUS 3×CS004; see explorer.spec.ts test 2):
 *
 *   test 1 'resolve loop + session persistence' (single page/context):
 *     drop → done → click issue-row-CS004:0 → resolution-picker offers the
 *     tied candidates (r0/r1, both 'Smith, J. (2020)') → choose r0 → the row
 *     gains issue-row-resolved + the 'Resolved →' chip → the
 *     severity-group-AMBIGUOUS header renders '1 resolved' (UI-derived view,
 *     D034 — the frozen report.counts is NEVER asserted) → page.reload()
 *     (sessionStorage survives in the same tab/context) → re-drop the SAME
 *     file → done → CS004:0 is resolved again WITHOUT any user re-click
 *     (T2 contract: the per-file bucket re-applies via the citationId
 *     re-join) → no uncaught JS errors on the page.
 *
 *   test 2 'fresh session = cleared' (new context, default): drop the same
 *     fixture → click issue-row-CS004:0 → the picker still offers the
 *     candidates (matcher data is always there) BUT the row is NOT resolved
 *     (no issue-row-resolved class, no 'Resolved →' chip, and the
 *     severity-group-AMBIGUOUS header shows no 'resolved' span) — R013 state
 *     clears with the session → negative guard: click issue-row-CS005:0 →
 *     resolution-picker is NOT visible (never offered where there are no
 *     AMBIGUOUS candidates — §79 no-guess; CS005 is entry-scoped).
 *
 * data-testid contract (FROZEN — T5): resolution-picker,
 * resolution-candidate-{entryId}, resolution-choose-{entryId}; resolved
 * rows carry the `issue-row-resolved` class; severity-group-{severity}
 * headers expose a `.severity-group-resolved` span ('{n} resolved') so the
 * e2e asserts the UI-derived counts, never report.counts.
 *
 * MEM107 gotcha: the SW precache serves stale bundles after a rebuild — each
 * test uses a fresh Playwright context (default) so the SW + precache are
 * never shared across tests; the reload inside test 1 stays within ONE
 * context by design (sessionStorage must survive the reload).
 */

import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// repo-root fixture path (committed, deterministic — R008/R017).
const SAME_AUTHOR_YEAR_DOCX = fileURLToPath(
  new URL('../../../fixtures/match/ambiguous-same-author-year.docx', import.meta.url),
);

/** The frozen report-summary testid (asserted visible, never its counts — D034). */
const REPORT_SUMMARY = 'report-summary';

test.describe('manual ambiguity resolution (production build)', () => {
  test('resolve loop + session persistence: choose r0 → resolved states → reload → re-applied', async ({
    page,
  }) => {
    // No uncaught JS errors anywhere on this page (slice verification).
    const pageErrors: Error[] = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    await page.goto('/');
    await expect(page.getByTestId('file-input')).toBeVisible();

    // Drop the flagship ambiguous fixture → deterministic done envelope.
    await page.setInputFiles('input[data-testid="file-input"]', SAME_AUTHOR_YEAR_DOCX);
    await expect(page.getByTestId(REPORT_SUMMARY)).toBeVisible();
    await expect(page.getByTestId('issue-row-CS004:0')).toBeVisible();

    // Select the first AMBIGUOUS issue → the picker offers the tied
    // candidates from matcher data (candidateEntryIds — T1 surface): r0 + r1.
    await page.getByTestId('issue-row-CS004:0').click();
    await expect(page.getByTestId('resolution-picker')).toBeVisible();
    await expect(page.getByTestId('resolution-candidate-r0')).toBeVisible();
    await expect(page.getByTestId('resolution-candidate-r1')).toBeVisible();
    await expect(page.getByTestId('resolution-candidate-r0')).toContainText('Smith, J. (2020)');

    // Choose r0 → the row flips to resolved (class + chip) and the AMBIGUOUS
    // group header derives its count from the UI view ('1 resolved').
    await page.getByTestId('resolution-choose-r0').click();
    await expect(page.getByTestId('issue-row-CS004:0')).toHaveClass(/issue-row-resolved/);
    await expect(page.getByTestId('issue-row-CS004:0')).toContainText('Resolved →');
    await expect(
      page.getByTestId('severity-group-AMBIGUOUS').locator('.severity-group-resolved'),
    ).toHaveText('1 resolved');

    // --- reload leg: sessionStorage survives; the stored bucket re-applies
    // via the citationId re-join when the SAME file is re-analyzed ---
    await page.reload();
    await expect(page.getByTestId('file-input')).toBeVisible();
    await page.setInputFiles('input[data-testid="file-input"]', SAME_AUTHOR_YEAR_DOCX);
    await expect(page.getByTestId(REPORT_SUMMARY)).toBeVisible();

    // Resolved again WITHOUT any user re-click (T2 contract).
    await expect(page.getByTestId('issue-row-CS004:0')).toHaveClass(/issue-row-resolved/);
    await expect(page.getByTestId('issue-row-CS004:0')).toContainText('Resolved →');
    await expect(
      page.getByTestId('severity-group-AMBIGUOUS').locator('.severity-group-resolved'),
    ).toHaveText('1 resolved');

    // No uncaught JS errors across the whole flow.
    expect(pageErrors).toEqual([]);
  });

  test('fresh session = cleared: candidates offered but nothing resolved; CS005 never offers a picker', async ({
    page,
  }) => {
    // New context (Playwright default) → sessionStorage is empty: R013 state
    // clears with the session.
    const pageErrors: Error[] = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    await page.goto('/');
    await expect(page.getByTestId('file-input')).toBeVisible();
    await page.setInputFiles('input[data-testid="file-input"]', SAME_AUTHOR_YEAR_DOCX);
    await expect(page.getByTestId(REPORT_SUMMARY)).toBeVisible();

    // Matcher data is always there: the picker offers the candidates…
    await page.getByTestId('issue-row-CS004:0').click();
    await expect(page.getByTestId('resolution-picker')).toBeVisible();
    await expect(page.getByTestId('resolution-candidate-r0')).toBeVisible();
    await expect(page.getByTestId('resolution-candidate-r1')).toBeVisible();

    // …but the row is NOT resolved: no class, no chip, no header count —
    // session state is cleared (R013).
    await expect(page.getByTestId('issue-row-CS004:0')).not.toHaveClass(/issue-row-resolved/);
    await expect(page.getByTestId('issue-row-CS004:0').locator('.issue-row-resolved-chip')).toHaveCount(0);
    await expect(
      page.getByTestId('severity-group-AMBIGUOUS').locator('.severity-group-resolved'),
    ).toHaveCount(0);

    // Negative guard: an entry-scoped issue (CS005 MISSING_ENTRY) has no
    // AMBIGUOUS candidate surface — the picker is never offered (§79).
    await page.getByTestId('issue-row-CS005:0').click();
    await expect(page.getByTestId('resolution-picker')).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  });
});
