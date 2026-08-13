/**
 * T6 — e2e of the S02 evidence issue explorer on the PRODUCTION build.
 *
 * Executable proof of the R012 demo contract on the REAL production artifact
 * (vite preview + real SW precache — S01 pattern, NOT devOptions SW):
 *
 *   test 1 'ambiguous.docx: ERROR click → highlight → evidence → recovery':
 *     the below-threshold fixture (PRD §63 ask-user, D005/D009). Drop →
 *     deterministic report (1 ERROR = CS001, 0 references) → click
 *     issue-row-CS001:0 → doc-view scrolls to and highlights the exact
 *     citation span "(Doe, 2017)" → evidence panel explains it VERBATIM from
 *     matcher data (code `no-entry`, NEVER LLM) → recovery panel lists the
 *     detector candidates (doc-p3 'References' exact, doc-p0 'Introduction'
 *     style) → clicking "Use this section" re-runs the SAME retained bytes
 *     with the user's pick via the T3 rerun seam → the bibliography outcome
 *     flips below-threshold → detected (the panel unmounts — the
 *     user-visible proof the pick was consumed) → the report re-renders and
 *     the issue persists with the same matcher-data evidence.
 *
 *     DEVIATION from the T6 plan's "1 references" claim (documented, T2
 *     bibliography-blockids case (a)): ambiguous.docx recovery with doc-p3
 *     honestly yields 0 §21 entries — the prose after "References" is not
 *     reference-like, so the recovered span is the heading alone — and
 *     `references = bib.entries.length ?? bib.blockIds.length ?? 0` stays 0
 *     because entries is `[]` (defined), so the blockIds fallback never
 *     fires. The e2e asserts the honest deterministic outcome instead: the
 *     outcome flip is observed via recovery-panel unmount + report re-render.
 *
 *   test 2 'ambiguous-same-author-year.docx: severity groups + refs': the
 *     flagship ambiguous fixture (CS004). Deterministic severity groups in
 *     RULE_SEVERITIES order (WARNING 2×CS005, AMBIGUOUS 3×CS004) → click
 *     CS004:0 → doc-view highlights "Smith (2020)" → evidence codes exact /
 *     year-match / ambiguous (matcher MatchReason codes, verbatim) →
 *     possible references r0 + r1 from candidateEntryIds (T1 surface) →
 *     bibliography DETECTED (not below-threshold) → recovery panel absent.
 *
 * data-testid contract (FROZEN — T5/T6): explorer, severity-group-{severity},
 * issue-row-{id}, doc-view, source-highlight, evidence-panel,
 * evidence-code-{code}, possible-ref-{entryId}, recovery-panel,
 * recovery-candidate-{blockId}, recovery-use-{blockId}, report-summary,
 * processing-badge.
 *
 * MEM107 gotcha: the SW precache serves stale bundles after a rebuild — each
 * test uses a fresh Playwright context (default) so the SW + precache are
 * never shared across tests.
 */

import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// repo-root fixture paths (committed, deterministic — R008/R017).
const AMBIGUOUS_DOCX = fileURLToPath(
  new URL('../../../fixtures/bibliography/ambiguous.docx', import.meta.url),
);
const SAME_AUTHOR_YEAR_DOCX = fileURLToPath(
  new URL('../../../fixtures/match/ambiguous-same-author-year.docx', import.meta.url),
);

test.describe('evidence issue explorer (production build)', () => {
  test('ambiguous.docx: ERROR click → source highlight → evidence → below-threshold recovery re-run', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByTestId('file-input')).toBeVisible();
    await expect(page.getByTestId('processing-badge')).toContainText('locally');

    // Drop the below-threshold fixture → deterministic report: 1 ERROR
    // (CS001), references 0 (candidates present, entries absent).
    await page.setInputFiles('input[data-testid="file-input"]', AMBIGUOUS_DOCX);
    await expect(page.getByTestId('report-summary')).toBeVisible();
    await expect(page.getByTestId('report-summary')).toContainText('ERROR');
    await expect(page.getByTestId('report-summary')).toContainText('0 references');

    // Explorer: the ERROR severity group with the single CS001:0 row.
    await expect(page.getByTestId('severity-group-ERROR')).toBeVisible();
    await expect(page.getByTestId('issue-row-CS001:0')).toBeVisible();

    // Click → the doc view scrolls to + highlights the EXACT citation span.
    await page.getByTestId('issue-row-CS001:0').click();
    await expect(page.getByTestId('doc-view')).toBeVisible();
    await expect(page.getByTestId('source-highlight')).toContainText('(Doe, 2017)');

    // Evidence panel: matcher-data message verbatim (code `no-entry`), NEVER
    // LLM output.
    await expect(page.getByTestId('evidence-panel')).toBeVisible();
    await expect(page.getByTestId('evidence-code-no-entry')).toBeVisible();
    await expect(page.getByTestId('evidence-panel')).toContainText(
      'No bibliography entry exists to match this citation.',
    );

    // Below-threshold recovery: both detector candidates with their headings
    // and signal types (deterministic detector data).
    await expect(page.getByTestId('recovery-panel')).toBeVisible();
    await expect(page.getByTestId('recovery-candidate-doc-p3')).toContainText('References');
    await expect(page.getByTestId('recovery-candidate-doc-p3')).toContainText('Exact bibliography heading');
    await expect(page.getByTestId('recovery-candidate-doc-p0')).toContainText('Introduction');

    // --- recovery re-run with the user-picked section (doc-p3) ---
    // Pre-click: panel visible + badge in the done state.
    await expect(page.getByTestId('processing-badge')).toContainText('Processed locally');

    await page.getByTestId('recovery-use-doc-p3').click();

    // The re-run flips status analyzing → done. Catch the transient
    // analyzing badge (T3 seam's observable: stage messages flow through the
    // same onStage path), then the deterministic terminal contract: a NEW
    // done envelope (report-summary re-rendered) whose bibliography outcome
    // left 'below-threshold' (recovery panel unmounted — the pick was
    // consumed). The report-summary-visible + recovery-panel-count-0 pair is
    // mutually race-checking: during analyzing BOTH are unmounted.
    await expect(page.getByTestId('processing-badge')).toContainText('Processing locally', {
      timeout: 10_000,
    });
    await expect(page.getByTestId('processing-badge')).toContainText('Processed locally', {
      timeout: 10_000,
    });
    await expect(page.getByTestId('report-summary')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('recovery-panel')).toHaveCount(0);
    // Honest references count after recovery (see DEVIATION note above).
    await expect(page.getByTestId('report-summary')).toContainText('0 references');

    // The re-run's analysis is consistent: the same issue persists and still
    // explains itself from matcher data; the page never crashed (badge alive).
    await expect(page.getByTestId('issue-row-CS001:0')).toBeVisible();
    await page.getByTestId('issue-row-CS001:0').click();
    await expect(page.getByTestId('evidence-panel')).toBeVisible();
    await expect(page.getByTestId('evidence-code-no-entry')).toBeVisible();
    await expect(page.getByTestId('source-highlight')).toContainText('(Doe, 2017)');
    await expect(page.getByTestId('processing-badge')).toContainText('Processed locally');
  });

  test('ambiguous-same-author-year.docx: severity groups + possible references, no recovery panel', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByTestId('file-input')).toBeVisible();

    // Drop the flagship ambiguous fixture → deterministic report: WARNING 2
    // (CS005×2) + AMBIGUOUS 3 (CS004×3).
    await page.setInputFiles('input[data-testid="file-input"]', SAME_AUTHOR_YEAR_DOCX);
    await expect(page.getByTestId('report-summary')).toBeVisible();
    await expect(page.getByTestId('report-summary')).toContainText('AMBIGUOUS');
    await expect(page.getByTestId('report-summary')).toContainText('3');

    // Severity groups in RULE_SEVERITIES order; rows deterministic
    // (severity → source → ruleId, R008). Counts pinned via the frozen
    // issue-row testids — no CSS-class coupling.
    await expect(page.getByTestId('severity-group-WARNING')).toBeVisible();
    await expect(page.getByTestId('severity-group-WARNING').getByTestId(/^issue-row-CS005:/)).toHaveCount(2);
    await expect(page.getByTestId('issue-row-CS005:0')).toBeVisible();
    await expect(page.getByTestId('issue-row-CS005:1')).toBeVisible();

    await expect(page.getByTestId('severity-group-AMBIGUOUS')).toBeVisible();
    await expect(page.getByTestId('severity-group-AMBIGUOUS').getByTestId(/^issue-row-CS004:/)).toHaveCount(3);
    await expect(page.getByTestId('issue-row-CS004:0')).toBeVisible();
    await expect(page.getByTestId('issue-row-CS004:1')).toBeVisible();
    await expect(page.getByTestId('issue-row-CS004:2')).toBeVisible();

    // Click the first AMBIGUOUS issue → doc-view highlights its exact span.
    await page.getByTestId('issue-row-CS004:0').click();
    await expect(page.getByTestId('doc-view')).toBeVisible();
    await expect(page.getByTestId('source-highlight')).toContainText('Smith (2020)');

    // Evidence codes verbatim from matcher data (MatchReason codes):
    // exact + year-match + ambiguous on the same citation row.
    await expect(page.getByTestId('evidence-panel')).toBeVisible();
    await expect(page.getByTestId('evidence-code-exact')).toBeVisible();
    await expect(page.getByTestId('evidence-code-year-match')).toBeVisible();
    await expect(page.getByTestId('evidence-code-ambiguous')).toBeVisible();

    // Possible references from candidateEntryIds (T1 surface): r0 + r1 —
    // both Smith, J. (2020) entries the matcher tied on.
    await expect(page.getByTestId('possible-ref-r0')).toBeVisible();
    await expect(page.getByTestId('possible-ref-r1')).toBeVisible();
    await expect(page.getByTestId('possible-ref-r0')).toContainText('Smith, J. (2020)');

    // Bibliography DETECTED (not below-threshold) → recovery panel ABSENT.
    await expect(page.getByTestId('recovery-panel')).toHaveCount(0);
  });
});
