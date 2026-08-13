/**
 * T3 — pure node tests locking the standalone HTML report builder (R008/R017).
 *
 * Node environment (vitest config), REAL fixtures (same pattern as
 * export-json.test.ts). Locks the six things T3 owns:
 *
 *   (a) DETERMINISM — two builds of the same report are byte-identical
 *       (no timestamps / random ids); independently built reports from the
 *       same fixture match too.
 *   (b) ESCAPING / SCRIPT BREAKOUT — a hostile `meta.file`
 *       (`x</script><script>alert(1)</script>.docx`) must never produce a
 *       raw `</script>` inside the embedded JSON block (the escaped JSON
 *       contains NO literal `</script>` and the document has exactly one
 *       `</script>` closer), the visible markup escapes the payload, and
 *       the escaped JSON still parses back to the exact report.
 *   (c) CONTENT — every issue id / ruleId / message and evidence code /
 *       message is present; severity counts appear in RULE_SEVERITIES order.
 *   (d) STANDALONE — zero external references: no `<link`, no `src=`,
 *       no `href=`, no `url(`, no `@import`; the embedded JSON comes from
 *       the canonical serializer (D024) modulo script escaping.
 *   (e) SKELETON — `<!doctype html>` first, `<html>`/`<head>`/`<body>`,
 *       `<meta charset="utf-8">` (Vietnamese fixture content), header with
 *       file / schema version / meta line.
 *   (f) ROUND-TRIP — `JSON.parse` of the `script#citesync-report` content
 *       deep-equals the report (including a Vietnamese fixture).
 *
 * Plus edge coverage: empty report (no issues / no ruleIds) and
 * blockId-only source locations.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCliReport, lintDocument, REPORT_VERSION, serializeReport } from '@citesync/core';
import type { CliReport } from '@citesync/core';
import { buildHtmlReport, escapeHtml } from '../src/export/html';

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

/** Clone a report with a different `meta.file` (hostile-input tests). */
function withFile(report: CliReport, file: string): CliReport {
  return { ...report, meta: { ...report.meta, file } };
}

/** Extract the escaped JSON text inside `<script id="citesync-report">`. */
function embeddedJson(html: string): string {
  const match = html.match(
    /<script type="application\/json" id="citesync-report">([\s\S]*?)<\/script>/,
  );
  if (!match) throw new Error('embedded report JSON script block not found');
  return match[1]!;
}

/** The hostile file name the escaping / breakout tests rely on. */
const HOSTILE_FILE = 'x</script><script>alert(1)</script>.docx';

describe('buildHtmlReport — determinism (R008/R017)', () => {
  it('two calls with the same report are byte-identical', () => {
    const report = lintReport('author-date', 'vietnamese.docx');
    expect(buildHtmlReport(report)).toBe(buildHtmlReport(report));
  });

  it('independently built reports from the same fixture are byte-identical', () => {
    expect(buildHtmlReport(lintReport('minimal.docx'))).toBe(
      buildHtmlReport(lintReport('minimal.docx')),
    );
  });
});

describe('buildHtmlReport — escaping / script breakout (hostile meta.file)', () => {
  it('the embedded JSON block contains NO literal `</script>` (no breakout)', () => {
    const report = withFile(lintReport('minimal.docx'), HOSTILE_FILE);
    const html = buildHtmlReport(report);
    const json = embeddedJson(html);
    expect(json).not.toContain('</script>');
    expect(json).not.toContain('<script>');
    // The whole document has exactly one `</script>` — the JSON block closer.
    expect(html.match(/<\/script>/g)).toHaveLength(1);
  });

  it('visible markup escapes the hostile file name (`<`/`>` become entities)', () => {
    const report = withFile(lintReport('minimal.docx'), HOSTILE_FILE);
    const html = buildHtmlReport(report);
    expect(html).toContain(escapeHtml(HOSTILE_FILE));
    expect(html).not.toContain('<script>alert(1)');
    expect(html).not.toContain(HOSTILE_FILE);
  });

  it('the escaped embedded JSON still parses back to the exact hostile report', () => {
    const report = withFile(lintReport('minimal.docx'), HOSTILE_FILE);
    expect(JSON.parse(embeddedJson(buildHtmlReport(report)))).toEqual(report);
  });

  it('escapeHtml covers the full & < > " \' set', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
    expect(escapeHtml('plain text 123')).toBe('plain text 123');
  });
});

describe('buildHtmlReport — content coverage', () => {
  it('every issue id, ruleId, message and evidence code/message is present', () => {
    const report = lintReport('author-date', 'same-author-year.docx');
    const html = buildHtmlReport(report);
    expect(report.issues.length).toBeGreaterThan(0);
    for (const issue of report.issues) {
      expect(html).toContain(escapeHtml(issue.id));
      expect(html).toContain(escapeHtml(issue.ruleId));
      expect(html).toContain(escapeHtml(issue.message));
      for (const ev of issue.evidence) {
        expect(html).toContain(escapeHtml(ev.code));
        expect(html).toContain(escapeHtml(ev.message));
      }
    }
  });

  it('severity counts appear in RULE_SEVERITIES order (ERROR → INFO)', () => {
    const report = lintReport('author-date', 'same-author-year.docx');
    const html = buildHtmlReport(report);
    const section = html.slice(
      html.indexOf('<section class="severity-summary"'),
      html.indexOf('</section>'),
    );
    expect(section).toContain('severity-counts');
    const order = ['ERROR', 'WARNING', 'AMBIGUOUS', 'INFO'];
    let last = -1;
    for (const severity of order) {
      const idx = section.indexOf(severity);
      expect(idx).toBeGreaterThan(last);
      last = idx;
    }
    // Each count value renders next to its severity name.
    for (const severity of order) {
      const count = String(report.counts[severity as keyof CliReport['counts']]);
      expect(section).toContain(count);
    }
  });

  it('renders compact source locations with paragraph/offset fields when present', () => {
    const report = lintReport('minimal.docx');
    const html = buildHtmlReport(report);
    const loc = report.issues[0]!.sourceLoc;
    expect(loc).toMatchObject({ blockId: 'doc-p1', paragraphIndex: 1, startOffset: 0, endOffset: 12 });
    expect(html).toContain('doc-p1:p1:chars0-12');
  });
});

describe('buildHtmlReport — standalone (zero external references)', () => {
  it('has no <link>, src=, href=, url( or @import anywhere', () => {
    const report = lintReport('minimal.docx');
    const html = buildHtmlReport(report);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/src\s*=/i);
    expect(html).not.toMatch(/href\s*=/i);
    expect(html).not.toMatch(/url\(/i);
    expect(html).not.toContain('@import');
  });

  it('embedded JSON is the canonical serializeReport bytes modulo script escaping (D024)', () => {
    const report = lintReport('minimal.docx');
    const json = embeddedJson(buildHtmlReport(report));
    const canonical = serializeReport(report)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026');
    expect(json).toBe(canonical);
  });
});

describe('buildHtmlReport — document skeleton', () => {
  it('starts with <!doctype html> and has html/head/meta charset/body/html close', () => {
    const html = buildHtmlReport(lintReport('minimal.docx'));
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<head>');
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<body>');
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
  });

  it('header shows file name, schema version and the meta line', () => {
    const report = lintReport('minimal.docx');
    const html = buildHtmlReport(report);
    expect(html).toContain('minimal.docx');
    expect(html).toContain(`Schema v${REPORT_VERSION}`);
    expect(html).toContain(`${report.meta.citations} citations`);
    expect(html).toContain(`${report.meta.references} references`);
    expect(html).toContain(`${report.meta.ruleIds.length} rules applied`);
  });
});

describe('buildHtmlReport — embedded canonical JSON round-trip', () => {
  it('JSON.parse of the script block content deep-equals the report (minimal)', () => {
    const report = lintReport('minimal.docx');
    expect(JSON.parse(embeddedJson(buildHtmlReport(report)))).toEqual(report);
  });

  it('round-trips a Vietnamese fixture (utf-8 content)', () => {
    const report = lintReport('author-date', 'vietnamese.docx');
    const html = buildHtmlReport(report);
    expect(html).toContain('<meta charset="utf-8">');
    expect(JSON.parse(embeddedJson(html))).toEqual(report);
  });
});

describe('buildHtmlReport — edge reports', () => {
  it('renders an empty report cleanly (no issues, no ruleIds)', () => {
    const empty: CliReport = {
      version: REPORT_VERSION,
      meta: { file: 'empty.docx', citations: 0, references: 0, ruleIds: [] },
      issues: [],
      counts: { ERROR: 0, WARNING: 0, AMBIGUOUS: 0, INFO: 0 },
    };
    const html = buildHtmlReport(empty);
    expect(html).toContain('Issues (0)');
    expect(html).toContain('0 rules applied');
    expect(html).not.toContain('rules applied ()');
    expect(html).toContain('severity-counts');
    expect(JSON.parse(embeddedJson(html))).toEqual(empty);
  });

  it('renders blockId-only source locations (no paragraph/offsets)', () => {
    const report: CliReport = {
      version: REPORT_VERSION,
      meta: { file: 'loc.docx', citations: 0, references: 0, ruleIds: ['CS001'] },
      issues: [
        {
          id: 'CS001:0',
          ruleId: 'CS001',
          severity: 'WARNING',
          message: 'block-only location',
          evidence: [{ code: 'no-entry', message: 'no entry matches', source: { blockId: 'b0' } }],
          sourceLoc: { blockId: 'b0' },
        },
      ],
      counts: { ERROR: 0, WARNING: 1, AMBIGUOUS: 0, INFO: 0 },
    };
    const html = buildHtmlReport(report);
    expect(html).toContain('>b0<');
    expect(html).toContain('CS001');
    expect(JSON.parse(embeddedJson(html))).toEqual(report);
  });
});
