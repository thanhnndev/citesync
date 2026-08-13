/**
 * T5 — pure unit tests for the §61 checklist state machine (stageStatus).
 *
 * Node environment, no DOM: stageStatus is the deterministic mapping
 * (received-prefix → done | current | pending) the StageChecklist renders
 * from. The DOM rendering itself is exercised by the Playwright e2e smoke
 * (T6) against the real worker + SW.
 */

import { describe, expect, it } from 'vitest';
import { PIPELINE_STAGES } from '@citesync/core';
import type { PipelineStage } from '@citesync/core';
import { stageStatus } from '../src/components/StageChecklist';

// Canonical order (PRD §61, D025) — stable names, never reordered.
const [READING, DETECTING, FINDING, MATCHING, RUNNING] = PIPELINE_STAGES;
if (
  READING === undefined ||
  DETECTING === undefined ||
  FINDING === undefined ||
  MATCHING === undefined ||
  RUNNING === undefined
) {
  throw new Error('PIPELINE_STAGES must contain exactly the five §61 stages');
}

describe('stageStatus', () => {
  it('idle (no stages received, not analyzing): everything pending', () => {
    expect(stageStatus(READING, [], false)).toBe('pending');
    expect(stageStatus(DETECTING, [], false)).toBe('pending');
    expect(stageStatus(FINDING, [], false)).toBe('pending');
    expect(stageStatus(MATCHING, [], false)).toBe('pending');
    expect(stageStatus(RUNNING, [], false)).toBe('pending');
  });

  it('analyzing with zero received: first stage is current, rest pending', () => {
    expect(stageStatus(READING, [], true)).toBe('current');
    expect(stageStatus(DETECTING, [], true)).toBe('pending');
    expect(stageStatus(RUNNING, [], true)).toBe('pending');
  });

  it('analyzing mid-run: received prefix is done, next stage is current, rest pending', () => {
    const received = [READING, DETECTING, FINDING];
    expect(stageStatus(READING, received, true)).toBe('done');
    expect(stageStatus(DETECTING, received, true)).toBe('done');
    expect(stageStatus(FINDING, received, true)).toBe('done');
    expect(stageStatus(MATCHING, received, true)).toBe('current');
    expect(stageStatus(RUNNING, received, true)).toBe('pending');
  });

  it('done (all five received, not analyzing): every stage stays done (persisted ✓)', () => {
    const received = [READING, DETECTING, FINDING, MATCHING, RUNNING];
    for (const stage of PIPELINE_STAGES) {
      expect(stageStatus(stage, received, false)).toBe('done');
    }
  });

  it('error mid-run (received prefix kept, not analyzing): reached stages done, rest pending', () => {
    const received = [READING, DETECTING];
    expect(stageStatus(READING, received, false)).toBe('done');
    expect(stageStatus(DETECTING, received, false)).toBe('done');
    expect(stageStatus(FINDING, received, false)).toBe('pending');
    expect(stageStatus(RUNNING, received, false)).toBe('pending');
  });

  it('unknown stage name (defensive) collapses to pending, never crashes', () => {
    expect(stageStatus('not-a-stage' as PipelineStage, [READING], true)).toBe('pending');
  });
});
