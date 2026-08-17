/**
 * M005-S02-T3 — export-failure helper unit test (vitest node env).
 *
 * `trySave` is a pure wrapper (zero DOM) so the failure/retry contract is
 * testable without a browser: a callback that throws → false (no rethrow, no
 * log), a quiet callback → true, and the callback runs exactly once.
 */

import { describe, expect, it, vi } from 'vitest';
import { trySave } from '../src/export/trySave';

describe('trySave (M005-S02-T3 export-failure surface)', () => {
  it('returns true when the save callback completes without throwing', () => {
    const save = vi.fn(() => undefined);
    expect(trySave(save)).toBe(true);
  });

  it('returns false when the save callback throws — without rethrowing', () => {
    const save = vi.fn(() => {
      throw new Error('blocked by the browser');
    });
    // If trySave rethrew, this test would fail with the thrown error.
    expect(trySave(save)).toBe(false);
  });

  it('runs the save callback exactly once per call', () => {
    const save = vi.fn(() => undefined);
    trySave(save);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('a failed call does not poison a later retry (state resets per click)', () => {
    let fail = true;
    const save = vi.fn(() => {
      if (fail) throw new Error('blocked');
    });
    expect(trySave(save)).toBe(false);
    fail = false;
    expect(trySave(save)).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
  });
});
