/**
 * T2 — pure node tests locking the JSON export contract (R014, D024).
 *
 * Node environment (vitest config), REAL fixture (fixtures/minimal.docx) —
 * same pattern as resolution-integrity.test.ts. Covers the four things T2
 * owns:
 *
 *   (a) BYTE CONTRACT — serializeReport(minimal-report) equals the exact
 *       frozen bytes: 2-space indent, trailing newline, key order
 *       version → meta → issues → counts (R008 insertion order). The
 *       expected string is pinned verbatim below — if the frozen schema
 *       ever changes, this test fails loudly and the expected bytes must be
 *       re-pinned deliberately.
 *   (b) FILENAMES — exportJsonFilename / exportHtmlFilename append the
 *       extension to the report's meta.file basename (never swap it).
 *   (c) DETERMINISM — two serializeReport calls on the same report are
 *       byte-identical; the CLI --json parity guard (T1) already proves
 *       cross-surface identity.
 *   (d) ROUND-TRIP — JSON.parse(serializeReport(report)) deep-equals the
 *       report: the report is plain structured-clone-safe objects, so the
 *       export loses nothing.
 *
 * DOM (download.ts) is deliberately NOT tested here — URL.createObjectURL /
 * anchor click are browser APIs; the T4 Playwright e2e proves the download
 * event + saved-file bytes.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCliReport, lintDocument, REPORT_VERSION, serializeReport } from '@citesync/core';
import type { CliReport } from '@citesync/core';
import { exportHtmlFilename, exportJsonFilename } from '../src/export/filenames';

/** Committed fixtures root (apps/web/tests → ../../../fixtures). */
const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures', import.meta.url));

/** Lint a fixture and build the canonical report (same as the worker). */
function lintReport(...parts: string[]): CliReport {
  const { issues, doc, ruleIds } = lintDocument(readFileSync(join(FIXTURES_DIR, ...parts)));
  return buildCliReport(doc, issues, ruleIds, {
    fileName: parts[parts.length - 1]!,
    version: REPORT_VERSION,
  });
}

/** The exact serialized bytes for minimal.docx — pinned from the frozen schema. */
const EXPECTED_MINIMAL_JSON = `{
  "version": 1,
  "meta": {
    "file": "minimal.docx",
    "citations": 1,
    "references": 0,
    "ruleIds": [
      "CS001",
      "CS002",
      "CS003",
      "CS004",
      "CS005",
      "CS006",
      "CS007",
      "CS008",
      "CS009"
    ]
  },
  "issues": [
    {
      "id": "CS001:0",
      "ruleId": "CS001",
      "severity": "ERROR",
      "message": "Missing reference: no bibliography entry matches 'Smith (2024)'.",
      "evidence": [
        {
          "code": "no-entry",
          "message": "No bibliography entry exists to match this citation.",
          "source": {
            "blockId": "doc-p1",
            "paragraphIndex": 1,
            "startOffset": 0,
            "endOffset": 12
          }
        }
      ],
      "sourceLoc": {
        "blockId": "doc-p1",
        "paragraphIndex": 1,
        "startOffset": 0,
        "endOffset": 12
      }
    }
  ],
  "counts": {
    "ERROR": 1,
    "WARNING": 0,
    "AMBIGUOUS": 0,
    "INFO": 0
  }
}
`;

describe('serializeReport — frozen JSON byte contract (R014)', () => {
  it('minimal.docx serializes to the exact pinned bytes (2-space, trailing newline)', () => {
    const report = lintReport('minimal.docx');
    expect(serializeReport(report)).toBe(EXPECTED_MINIMAL_JSON);
  });

  it('property order is version → meta → issues → counts (R008 insertion order)', () => {
    const report = lintReport('minimal.docx');
    expect(Object.keys(report)).toEqual(['version', 'meta', 'issues', 'counts']);
    expect(Object.keys(report.meta)).toEqual(['file', 'citations', 'references', 'ruleIds']);
    expect(Object.keys(report.counts)).toEqual(['ERROR', 'WARNING', 'AMBIGUOUS', 'INFO']);
    expect(serializeReport(report).startsWith('{\n  "version": 1,\n  "meta":')).toBe(true);
  });

  it('trailing newline + 2-space indent hold for a multi-issue fixture too', () => {
    const report = lintReport('author-date', 'simple.docx');
    const text = serializeReport(report);
    expect(text.endsWith('\n')).toBe(true);
    expect(text.startsWith('{\n  ')).toBe(true);
  });

  it('determinism: two serializeReport calls are byte-identical', () => {
    const report = lintReport('minimal.docx');
    expect(serializeReport(report)).toBe(serializeReport(report));
    // Two independently built reports from the same fixture are identical too.
    expect(serializeReport(lintReport('minimal.docx'))).toBe(serializeReport(lintReport('minimal.docx')));
  });

  it('round-trip: JSON.parse(serializeReport(report)) deep-equals the report', () => {
    const report = lintReport('minimal.docx');
    expect(JSON.parse(serializeReport(report))).toEqual(report);
  });
});

describe('export filenames', () => {
  it('JSON filename appends .json to the report basename', () => {
    expect(exportJsonFilename('minimal.docx')).toBe('minimal.docx.json');
    expect(exportJsonFilename('report.docx')).toBe('report.docx.json');
    expect(exportJsonFilename('my report.docx')).toBe('my report.docx.json');
  });

  it('HTML filename appends .html to the report basename', () => {
    expect(exportHtmlFilename('minimal.docx')).toBe('minimal.docx.html');
    expect(exportHtmlFilename('report.docx')).toBe('report.docx.html');
  });

  it('filename derivation flows from report.meta.file (the export wiring)', () => {
    const report = lintReport('minimal.docx');
    expect(exportJsonFilename(report.meta.file)).toBe('minimal.docx.json');
    expect(exportHtmlFilename(report.meta.file)).toBe('minimal.docx.html');
  });
});
