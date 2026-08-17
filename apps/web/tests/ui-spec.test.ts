/**
 * M005-S01-T1 — UI-SPEC contract test.
 *
 * Guards the T01 deliverables of docs/UI-SPEC.md — the design contract for the
 * whole M005 UI overhaul (S02–S04). A regression here means the spec drifted
 * from reality (a screen added without a mockup/state inventory, an error
 * state dropped, markdown corrupted), and the contract must be fixed, not the
 * test.
 *
 * Path resolution: `new URL('../../../docs/UI-SPEC.md', import.meta.url)` from
 * apps/web/tests (up 3: tests → web → apps → repo root) → repo-root/docs —
 * independent of the vitest cwd.
 *
 * NOTE for T02 (decisions section) and later slices: this test asserts
 * PRESENCE only (sections/components/error-states must exist), never absence —
 * adding new sections cannot break it. If a screen is intentionally removed,
 * update BOTH the spec and this list in the same change.
 */

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SPEC_PATH = new URL('../../../docs/UI-SPEC.md', import.meta.url).pathname;

/** Split the doc at a level-1 heading (`# N. Title`) and return its body. */
function sectionFrom(text: string, header: RegExp): string {
  const start = text.search(header);
  expect(start, `missing heading ${header}`).toBeGreaterThan(-1);
  const bodyStart = text.indexOf('\n', start) + 1;
  const nextHeading = text.slice(bodyStart).search(/^# \d+\. /m);
  return nextHeading === -1
    ? text.slice(bodyStart)
    : text.slice(bodyStart, bodyStart + nextHeading);
}

describe('docs/UI-SPEC.md — M005-S01-T1 contract', () => {
  const spec = existsSync(SPEC_PATH) ? readFileSync(SPEC_PATH, 'utf8') : '';

  it('file exists and is non-empty', () => {
    expect(spec.length).toBeGreaterThan(10_000);
  });

  it('renders as valid markdown: balanced code fences, no empty headings', () => {
    const fences = spec.match(/^```/gm) ?? [];
    expect(fences.length, 'unbalanced code fences break rendering').toBeGreaterThan(0);
    expect(fences.length % 2, 'unbalanced code fences break rendering').toBe(0);
    const emptyHeadings = spec
      .split('\n')
      .filter((line) => /^#{1,6}\s/.test(line))
      .filter((heading) => heading.replace(/^#{1,6}\s*/, '').trim() === '');
    expect(emptyHeadings).toEqual([]);
  });

  it('contains all 5 required sections: tokens, layout, flow map, state inventory, mockups', () => {
    const required = [
      ['tokens', /^# 1\. Design Tokens/m],
      ['layout', /^# 2\. Layout System/m],
      ['flow map', /^# 3\. Flow Map/m],
      ['state inventory', /^# 4\. State Inventory/m],
      ['mockups', /^# 5\. Mockups/m],
    ] as const;
    for (const [name, re] of required) {
      expect(spec.match(re), `missing section: ${name}`).not.toBeNull();
    }
  });

  it('every current apps/web screen has a mockup (section 5) AND a state inventory (section 4)', () => {
    const mockups = sectionFrom(spec, /^# 5\. Mockups/m);
    const states = sectionFrom(spec, /^# 4\. State Inventory/m);
    const components = [
      'DropZone',
      'StageChecklist',
      'ReportSummary',
      'IssueExplorer',
      'EvidencePanel',
      'ResolutionPicker',
      'ExportPanel',
      'BibliographyRecoveryPanel',
      'DocumentView',
    ];
    for (const name of components) {
      expect(mockups.includes(name), `${name} missing from mockups (§5)`).toBe(true);
      expect(states.includes(name), `${name} missing from state inventory (§4)`).toBe(true);
    }
  });

  it('state inventory does not miss any required error state', () => {
    const states = sectionFrom(spec, /^# 4\. State Inventory/m).toLowerCase();
    const requiredErrors = [
      'parse-failure',
      'oversize',
      'unsupported',
      'worker error',
      'export failure',
      'time-budget',
    ];
    for (const error of requiredErrors) {
      expect(states.includes(error), `missing error state: ${error}`).toBe(true);
    }
  });

  it('flow map covers all 11 transitions (T1–T11)', () => {
    const flow = sectionFrom(spec, /^# 3\. Flow Map/m);
    for (let i = 1; i <= 11; i += 1) {
      expect(flow.includes(`| T${i} |`), `missing transition row T${i}`).toBe(true);
    }
  });

  it('cross-references all 10 issue types (CS001–CS010)', () => {
    for (let i = 1; i <= 10; i += 1) {
      const id = `CS${String(i).padStart(3, '0')}`;
      expect(spec.includes(id), `missing issue type ${id}`).toBe(true);
    }
  });

  it('cross-references the PRD document (§ sections present)', () => {
    expect((spec.match(/§\d+/g) ?? []).length).toBeGreaterThan(20);
  });
});
