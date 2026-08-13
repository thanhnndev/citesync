/**
 * M003-T2 — the onStage pipeline threading (PRD §61): `lintDocument` must
 * report the five REAL pipeline stages in canonical order, and the callback
 * must be purely observational (R008) — same bytes + same options → same
 * report, with or without a callback.
 *
 * Fixtures are git-tracked files under fixtures/ (minimal.docx). The
 * expected stage sequence is pinned to the exported `PIPELINE_STAGES` const
 * so the test and the UI checklist (§61, T5) share one source of truth; the
 * literal sequence is also asserted so a renamed stage fails loudly.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PIPELINE_STAGES, lintDocument } from '@citesync/core';
import type { PipelineStage } from '@citesync/core';

const FIXTURES = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
const MINIMAL = join(FIXTURES, 'minimal.docx'); // 1 ERROR (CS001)

/** Collect the stages a lintDocument call emits through onStage. */
function collectStages(run: (onStage: (stage: PipelineStage) => void) => unknown): PipelineStage[] {
  const stages: PipelineStage[] = [];
  run((stage) => stages.push(stage));
  return stages;
}

describe('onStage pipeline threading (PRD §61)', () => {
  it('bytes input emits the full 5-stage sequence in canonical order', () => {
    const report = lintDocument(readFileSync(MINIMAL), {
      onStage: () => {},
    });
    expect(report.issues.length).toBe(1); // still lints normally

    const stages = collectStages((onStage) =>
      lintDocument(readFileSync(MINIMAL), { onStage }),
    );
    expect(stages).toEqual([...PIPELINE_STAGES]);
    expect(stages).toEqual([
      'reading-document',
      'detecting-bibliography',
      'finding-citations',
      'matching-references',
      'running-checks',
    ]);
  });

  it('doc input emits only the running-checks stage (no parse stages)', () => {
    const doc = lintDocument(readFileSync(MINIMAL)).doc;
    const stages: PipelineStage[] = [];
    const report = lintDocument(doc, { onStage: (stage) => stages.push(stage) });
    expect(stages).toEqual(['running-checks']);
    expect(report.issues.length).toBe(1);
  });

  it('is deterministic — two runs emit identical stage sequences (R008)', () => {
    const bytes = readFileSync(MINIMAL);
    const run = (): PipelineStage[] =>
      collectStages((onStage) => lintDocument(bytes, { onStage }));
    expect(run()).toEqual(run());
  });

  it('is additive — the report is deep-equal with and without onStage (R008)', () => {
    const bytes = readFileSync(MINIMAL);
    const spied = lintDocument(bytes, { onStage: () => {} });
    const plain = lintDocument(bytes);
    expect(spied.issues).toEqual(plain.issues);
    expect(spied.doc).toEqual(plain.doc);
    expect(spied.ruleIds).toEqual(plain.ruleIds);
  });

  it('custom rules still run after the running-checks stage (one emit, no dupes)', () => {
    const bytes = readFileSync(MINIMAL);
    const stages: PipelineStage[] = [];
    lintDocument(bytes, {
      onStage: (stage) => stages.push(stage),
      customRules: [
        {
          id: 'CS900',
          severity: 'INFO',
          run: () => [],
        },
      ],
    });
    expect(stages).toEqual([...PIPELINE_STAGES]);
    expect(stages.filter((s) => s === 'running-checks')).toHaveLength(1);
  });

  it('forwards bibliographyBlockIds to the bytes parse; doc input ignores it (M003 recovery)', () => {
    // ambiguous.docx is below-threshold by default (pick-a-section candidates);
    // the recovery re-run passes the user-chosen heading id through.
    const bytes = readFileSync(join(FIXTURES, 'bibliography/ambiguous.docx'));
    const plain = lintDocument(bytes).doc.bibliography;
    expect(plain?.outcome).toBe('below-threshold');

    const recovered = lintDocument(bytes, { bibliographyBlockIds: ['doc-p3'] }).doc
      .bibliography;
    expect(recovered?.outcome).toBe('detected'); // user-directed, not thresholded
    if (recovered?.outcome === 'detected') {
      expect(recovered.heading).toBe('References');
      expect(recovered.blockIds).toEqual(['doc-p3']);
    }

    // Doc input ignores the option (the parse never runs twice): re-linting
    // the already-parsed doc keeps its below-threshold bibliography state.
    const fromDoc = lintDocument(lintDocument(bytes).doc, {
      bibliographyBlockIds: ['doc-p3'],
    });
    expect(fromDoc.doc.bibliography?.outcome).toBe('below-threshold');
  });
});
