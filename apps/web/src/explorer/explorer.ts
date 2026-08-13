/**
 * T4 — pure, node-testable explorer helpers (R012 evidence issue explorer).
 *
 * Everything the M003 explorer renders is derived deterministically from the
 * S01 done envelope ({ report, doc }) — this module is the pure-logic seam:
 * severity grouping, click-to-source span resolution, UTF-16 highlight
 * splitting and the possible-references join. Zero DOM, zero `node:*`, zero
 * I/O — every function is a pure function of its inputs (R008), unit-tested
 * in the node vitest environment.
 *
 * CONSUMES ONLY `@citesync/core` (PRD §92/§93 — apps/web never imports
 * `@citesync/docx` / `@citesync/cli` / `@citesync/document-model` directly).
 * The model types below are DERIVED from the single `AcademicDocument` type
 * core re-exports, so no document-model import is needed here.
 *
 * CONSERVATIVE BIAS (§79): the helpers never guess. An absent
 * `matchMap` / `numericIndexMap` / `bibliography.entries` yields an empty
 * reference list, never a fabricated match.
 */

import { RULE_SEVERITIES } from '@citesync/core';
import type { AcademicDocument, LintIssue } from '@citesync/core';

// ---------------------------------------------------------------------------
// Model types derived from the core re-export (PRD §93 import direction).
// ---------------------------------------------------------------------------

/** §15 document block (derived from `AcademicDocument.blocks`). */
export type DocumentBlock = AcademicDocument['blocks'][number];
/** §21 parsed reference entry (derived from `bibliography.entries`). */
export type ReferenceEntry = NonNullable<
  NonNullable<AcademicDocument['bibliography']>['entries']
>[number];
/** §16 source location (derived from a block's `source`). */
export type SourceLocation = DocumentBlock['source'];

// ---------------------------------------------------------------------------
// groupIssuesBySeverity — RULE_SEVERITIES order, empty groups dropped.
// ---------------------------------------------------------------------------

/** One severity group: the canonical RULE_SEVERITIES label + its issues. */
export interface SeverityGroup {
  /** The severity label (RULE_SEVERITIES order — ERROR first, INFO last). */
  severity: (typeof RULE_SEVERITIES)[number];
  /** Issues of this severity, in the input's relative order (already severity → source → ruleId from lintDocument, R008). */
  issues: LintIssue[];
}

/**
 * Group issues by severity in the canonical RULE_SEVERITIES order
 * (ERROR → WARNING → AMBIGUOUS → INFO — the same order the CLI and
 * report-summary use, D022/D024). Empty severity groups are dropped; issues
 * within a group keep their input order (lintDocument already sorts
 * severity → source → ruleId, so the group rows are document-ordered).
 */
export function groupIssuesBySeverity(issues: readonly LintIssue[]): SeverityGroup[] {
  const groups: SeverityGroup[] = [];
  for (const severity of RULE_SEVERITIES) {
    const group = issues.filter((issue) => issue.severity === severity);
    if (group.length > 0) groups.push({ severity, issues: group });
  }
  return groups;
}

// ---------------------------------------------------------------------------
// sourceSpanForIssue — the click-to-source span for one issue (R009).
// ---------------------------------------------------------------------------

/** The source span a click highlights: the block plus an optional text span. */
export interface SourceSpan {
  /** The block the issue's `sourceLoc.blockId` resolves to. */
  block: DocumentBlock;
  /**
   * Character offset (inclusive) into `block.text` — present only for
   * span-scoped issues (sourceLoc carries startOffset/endOffset).
   */
  start?: number;
  /**
   * Character offset (EXCLUSIVE) into `block.text` — present only for
   * span-scoped issues. `block.text.slice(start, end)` selects the exact
   * referenced text (UTF-16 slice semantics, MEM013).
   */
  end?: number;
}

/**
 * Resolve an issue's `sourceLoc` to the document block (plus optional text
 * span) it points at.
 *
 *   - Span-scoped issue (sourceLoc has startOffset AND endOffset): the block
 *     plus the exact offsets — `block.text.slice(start, end)` is the cited
 *     text (MEM013).
 *   - Entry-scoped issue (sourceLoc carries ONLY blockId — MEM074:
 *     CS002/CS005/CS006/CS009 surface entries/blocks, not text spans):
 *     the block with `start`/`end` undefined — the UI highlights the whole
 *     block.
 *
 * A blockId missing from `doc.blocks` yields `null` (fixture/desync
 * locations stay safe — never a fabricated highlight target).
 */
export function sourceSpanForIssue(doc: AcademicDocument, issue: LintIssue): SourceSpan | null {
  const block = doc.blocks.find((b) => b.id === issue.sourceLoc.blockId);
  if (block === undefined) return null;
  const { startOffset, endOffset } = issue.sourceLoc;
  if (startOffset !== undefined && endOffset !== undefined) {
    return { block, start: startOffset, end: endOffset };
  }
  return { block };
}

// ---------------------------------------------------------------------------
// highlightParts — split block text into before/mark/after (UTF-16 slice).
// ---------------------------------------------------------------------------

/** The three segments of a highlighted block text. */
export interface HighlightParts {
  /** `text.slice(0, start)` — the text before the highlighted span. */
  before: string;
  /** `text.slice(start, end)` — the highlighted span itself. */
  mark: string;
  /** `text.slice(end)` — the text after the highlighted span. */
  after: string;
}

/**
 * Split a block text into before/mark/after for `<mark>` highlighting.
 *
 * UTF-16 slice semantics (MEM013) — identical to `String.prototype.slice`:
 * the caller passes `start`/`end` straight through, so out-of-range or
 * negative values clamp exactly like JS slice (never throws, never
 * out-of-bounds). When either bound is undefined (a whole-block highlight —
 * entry-scoped issues, MEM074), the WHOLE text becomes the mark — the UI
 * never guesses a span.
 */
export function highlightParts(
  text: string,
  start: number | undefined,
  end: number | undefined,
): HighlightParts {
  if (start === undefined || end === undefined) {
    return { before: '', mark: text, after: '' };
  }
  return { before: text.slice(0, start), mark: text.slice(start, end), after: text.slice(end) };
}

// ---------------------------------------------------------------------------
// possibleReferencesForIssue — deterministic, NEVER-LLM reference resolution.
// ---------------------------------------------------------------------------

/**
 * Collect the bibliography entries an issue's sourceLoc points at — the
 * evidence panel's "possible references" list. Deterministic (R008), matcher
 * data only, NEVER LLM output (R012) and NEVER a guess (§79):
 *
 *   - Span-scoped issue (startOffset/endOffset present): region-join the
 *     issue's source region (blockId + startOffset + endOffset) against
 *       a) `doc.matchMap.citations` rows via `citationSource` region
 *          equality — the FIRST matching row wins (document order): a
 *          MATCHED row contributes its `matchedEntryId`, an AMBIGUOUS row
 *          its `candidateEntryIds` (M003-S02-T1 surface); then
 *       b) `doc.numericIndexMap` tokens via `token.source` region equality —
 *          every matching RESOLVED token contributes its `resolvedEntryId`
 *          in document/token order (range expansions legitimately share one
 *          source segment — keep all, deduped preserve-first-seen).
 *   - Entry-scoped issue (blockId only — MEM074): the entries whose
 *     `source.blockId` equals the issue's blockId, in bibliography order.
 *
 * Collected ids are resolved against `doc.bibliography.entries` (find by
 * id — ids whose entry is missing are dropped, order preserved, deduped
 * preserve-first-seen). Absent `matchMap` / `numericIndexMap` /
 * `bibliography.entries` → `[]` (never guess — §79).
 */
export function possibleReferencesForIssue(
  doc: AcademicDocument,
  issue: LintIssue,
): ReferenceEntry[] {
  const entries = doc.bibliography?.entries ?? [];
  if (entries.length === 0) return [];
  const loc = issue.sourceLoc;

  const ids: string[] = [];
  const push = (id: string): void => {
    if (!ids.includes(id)) ids.push(id);
  };

  // Entry-scoped issue: the entries living in the issue's block.
  if (loc.startOffset === undefined || loc.endOffset === undefined) {
    for (const entry of entries) {
      if (entry.source.blockId === loc.blockId) push(entry.id);
    }
    return resolveIds(entries, ids);
  }

  // Span-scoped issue: region join against the match map, then the numeric
  // index map (document order each; match-map ids precede numeric ids).
  if (doc.matchMap !== undefined) {
    for (const row of doc.matchMap.citations) {
      if (!sameRegion(row.citationSource, loc)) continue;
      // First matching row wins (deterministic — a region maps to one
      // citation row by construction, R008).
      if (row.matchedEntryId !== undefined) push(row.matchedEntryId);
      for (const id of row.candidateEntryIds ?? []) push(id);
      break;
    }
  }
  if (doc.numericIndexMap !== undefined) {
    for (const cit of doc.numericIndexMap.citations) {
      for (const token of cit.tokens) {
        if (token.resolvedEntryId === undefined) continue;
        if (!sameRegion(token.source, loc)) continue;
        push(token.resolvedEntryId);
      }
    }
  }

  return resolveIds(entries, ids);
}

/** Region equality: blockId + startOffset + endOffset, all present and equal. */
function sameRegion(a: SourceLocation, b: SourceLocation): boolean {
  return (
    a.blockId === b.blockId &&
    a.startOffset !== undefined &&
    a.endOffset !== undefined &&
    a.startOffset === b.startOffset &&
    a.endOffset === b.endOffset
  );
}

/** Resolve ids against the entry list, preserving order; drop unknown ids. */
function resolveIds(entries: readonly ReferenceEntry[], ids: readonly string[]): ReferenceEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const out: ReferenceEntry[] = [];
  for (const id of ids) {
    const entry = byId.get(id);
    if (entry !== undefined) out.push(entry);
  }
  return out;
}

// ---------------------------------------------------------------------------
// resolutionCandidatesForIssue — the R013 manual-resolution seam (S03-T1).
// ---------------------------------------------------------------------------

/**
 * The picker surface for one resolvable issue (R013 manual resolution).
 */
export interface ResolutionCandidates {
  /** The region-joined matchMap citation row's id (e.g. `'c0'`). */
  citationId: string;
  /** The AMBIGUOUS row's candidate entries, resolved against the bibliography. */
  candidates: ReferenceEntry[];
}

/**
 * R013 (S03-T1): the candidate entries a user may choose between for one
 * AMBIGUOUS issue — the resolution-picker's data source.
 *
 * Mirrors {@link possibleReferencesForIssue}'s SPAN-SCOPED region join
 * (sameRegion = blockId + startOffset + endOffset, FIRST matching row wins in
 * document order) over `doc.matchMap.citations`, but additionally returns the
 * joined row's `citationId` — the stable key SessionResolution records the
 * user's choice against (T2/T3). All data is matcher data (R012 — NEVER LLM).
 *
 * Conservative bias (§79 — never guess): returns `null` when
 *   - `matchMap` is absent, or the bibliography has no entries;
 *   - the issue is entry-scoped (blockId only — no region to join; CS002/
 *     CS005/CS006/CS009 surface entries/blocks, not text spans, MEM074);
 *   - no matchMap row region-matches the issue's source span;
 *   - the row's `relationship !== 'AMBIGUOUS'` (CS001 MISSING_REFERENCE →
 *     null — no candidates exist);
 *   - the row's `candidateEntryIds` is absent or empty, or none of its ids
 *     resolve to a bibliography entry (below-threshold bibliography → null,
 *     never an empty offer).
 *
 * Candidate ids are resolved via {@link resolveIds}: unknown ids dropped,
 * order preserved, deduped preserve-first-seen.
 */
export function resolutionCandidatesForIssue(
  doc: AcademicDocument,
  issue: LintIssue,
): ResolutionCandidates | null {
  // Never guess (§79): no join surface, or nothing to resolve against.
  if (doc.matchMap === undefined) return null;
  const entries = doc.bibliography?.entries ?? [];
  if (entries.length === 0) return null;

  const loc = issue.sourceLoc;
  // Entry-scoped issue (blockId only): there is no source span to region-join.
  if (loc.startOffset === undefined || loc.endOffset === undefined) return null;

  for (const row of doc.matchMap.citations) {
    if (!sameRegion(row.citationSource, loc)) continue;
    // First matching row wins (deterministic — a region maps to one
    // citation row by construction, R008).
    if (row.relationship !== 'AMBIGUOUS') return null;
    const candidateIds = row.candidateEntryIds;
    if (candidateIds === undefined || candidateIds.length === 0) return null;
    // Dedupe preserve-first-seen, then resolve (drop unknown ids).
    const seen = new Set<string>();
    const uniqueIds: string[] = [];
    for (const id of candidateIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      uniqueIds.push(id);
    }
    const candidates = resolveIds(entries, uniqueIds);
    // All candidate ids resolved to nothing (below-threshold bibliography):
    // no pickable entries — never an empty offer.
    if (candidates.length === 0) return null;
    return { citationId: row.citationId, candidates };
  }

  return null;
}
