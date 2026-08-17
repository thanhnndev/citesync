/**
 * M005-S02-T3 — ReportSummary zero-issue test (vitest node env).
 *
 * `isZeroIssue` is a pure function over the canonical CliReport counts
 * (UI-SPEC §4.3): all four severity counts === 0 → true; any count > 0 →
 * false. The contract is the COUNTS, not the issues array length — a report
 * whose issues were filtered out but whose counts are non-zero is NOT a
 * zero-issue report.
 */

import { describe, expect, it } from 'vitest';
import type { CliReport } from '@citesync/core';
import { isZeroIssue } from '../src/components/ReportSummary';

/** Minimal canonical report builder — only counts drive the function. */
function reportWithCounts(counts: CliReport['counts']): CliReport {
  return {
    version: 1,
    meta: { file: 'paper.docx', citations: 0, references: 0, ruleIds: [] },
    issues: [],
    counts,
  };
}

describe('isZeroIssue (M005-S02-T3, UI-SPEC §4.3)', () => {
  it('returns true when all four severity counts are 0', () => {
    expect(isZeroIssue(reportWithCounts({ ERROR: 0, WARNING: 0, AMBIGUOUS: 0, INFO: 0 }))).toBe(
      true,
    );
  });

  it('returns false when any single severity count is > 0', () => {
    expect(isZeroIssue(reportWithCounts({ ERROR: 1, WARNING: 0, AMBIGUOUS: 0, INFO: 0 }))).toBe(
      false,
    );
    expect(isZeroIssue(reportWithCounts({ ERROR: 0, WARNING: 2, AMBIGUOUS: 0, INFO: 0 }))).toBe(
      false,
    );
    expect(isZeroIssue(reportWithCounts({ ERROR: 0, WARNING: 0, AMBIGUOUS: 3, INFO: 0 }))).toBe(
      false,
    );
    expect(isZeroIssue(reportWithCounts({ ERROR: 0, WARNING: 0, AMBIGUOUS: 0, INFO: 4 }))).toBe(
      false,
    );
  });

  it('judges by COUNTS, not issues.length — an issues array does not zero the report', () => {
    const report = reportWithCounts({ ERROR: 1, WARNING: 0, AMBIGUOUS: 0, INFO: 0 });
    expect(isZeroIssue(report)).toBe(false);
  });
});
