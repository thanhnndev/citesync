/**
 * R013 (S03-T1) — pure manual-resolution view model (PRD §92/§93).
 *
 * Zero DOM, zero `node:*`, zero I/O — every function is a pure function of
 * its inputs (R008). Consumes ONLY `@citesync/core` types (via indexed
 * access + the explorer helpers in ../explorer/explorer.ts) — apps/web never
 * imports `@citesync/docx` / `@citesync/cli` / `@citesync/document-model`
 * directly.
 *
 * The user's manual resolution of an AMBIGUOUS citation is a VIEW overlay:
 * it never mutates the canonical report (D020/D024 — the frozen CliReport is
 * byte-stable) nor the parsed document (R018 — the app only ever reads the
 * manuscript). `applyResolutions` therefore returns a NEW view model and
 * never writes to its inputs — the deep-freeze tests prove it.
 *
 * The join is: issue → region → matchMap citation row (via
 * resolutionCandidatesForIssue) → citationId → user's SessionResolution.
 * Resolution data is matcher data only (R012 — NEVER LLM).
 */

import type { CliReport, RuleSeverity } from '@citesync/core';
import type { AcademicDocument } from '@citesync/core';
import {
  resolutionCandidatesForIssue,
  type ReferenceEntry,
} from '../explorer/explorer';

/**
 * One user choice: citationId (the matchMap row id, e.g. `'c0'`) resolved to
 * one of its candidate entry ids. Stored per-document-file, keyed by
 * citationId so re-choosing updates the same citation (T2/T3).
 */
export interface SessionResolution {
  /** The matchMap citation row's id the user resolved (e.g. `'c0'`). */
  citationId: string;
  /** The chosen `ReferenceEntry.id` from the row's candidate list. */
  chosenEntryId: string;
}

/** The resolved state of one issue: which citation + which entry was chosen. */
export interface ResolvedIssue {
  /** The citationId the issue region-joined to (its resolution key). */
  citationId: string;
  /** The chosen bibliography entry (resolved from the candidate list). */
  chosenEntry: ReferenceEntry;
}

/**
 * The R013 view model derived from the report + doc + session resolutions.
 *
 * - `byIssue`: issueId → resolved state for every RESOLVED issue (an issue
 *   with no resolution, or an unresolvable issue, has no entry — read via
 *   `view.byIssue[issue.id]` which yields `undefined`).
 * - `resolvedCounts`: per-severity resolved-issue counts — UI-derived, NEVER
 *   a mutation of `report.counts` (D034 — the frozen schema stays byte-identical).
 * - `totalResolved`: total resolved issues across severities.
 */
export interface ResolutionsView {
  byIssue: Record<string, ResolvedIssue | undefined>;
  resolvedCounts: Partial<Record<RuleSeverity, number>>;
  totalResolved: number;
}

/**
 * Build the resolution view model over a done envelope.
 *
 * Walks `report.issues`, joins each issue to a citation via
 * {@link resolutionCandidatesForIssue} (span-scoped region join over
 * `doc.matchMap.citations` — FIRST matching row wins, R008), and marks the
 * issue resolved when a {@link SessionResolution} exists for that citationId.
 * The chosen entry is resolved from the candidate list by id; an unknown
 * `chosenEntryId` (or a resolution for a citationId this document does not
 * contain) leaves the issue unresolved — never guessed (§79).
 *
 * Conservative by construction:
 *   - unresolvable issues (CS001 MISSING_REFERENCE, CS002/CS005 entry-scoped,
 *     absent matchMap) can never be resolved — there is no candidate surface;
 *   - a resolution whose chosenEntryId is not among the candidates is inert;
 *   - duplicate resolutions for one citationId: the LAST one wins (upsert
 *     semantics — the T2 hook replaces, never appends, per citationId).
 *
 * Never mutates its inputs (deep-freeze tests prove it): the overlay returns
 * new objects only — the report, its issues and the document are untouched,
 * so the canonical report JSON and the DOCX bytes stay byte-identical.
 */
export function applyResolutions(
  report: CliReport,
  doc: AcademicDocument,
  resolutions: readonly SessionResolution[],
): ResolutionsView {
  // Index resolutions by citationId (last-wins for a duplicate key — the
  // hook upserts one resolution per citationId, so this is defensive only).
  const chosenByCitationId = new Map<string, string>();
  for (const resolution of resolutions) {
    chosenByCitationId.set(resolution.citationId, resolution.chosenEntryId);
  }

  const byIssue: Record<string, ResolvedIssue | undefined> = {};
  const resolvedCounts: Partial<Record<RuleSeverity, number>> = {};
  let totalResolved = 0;

  for (const issue of report.issues) {
    const joined = resolutionCandidatesForIssue(doc, issue);
    if (joined === null) continue;
    const chosenEntryId = chosenByCitationId.get(joined.citationId);
    if (chosenEntryId === undefined) continue;
    const chosenEntry = joined.candidates.find((entry) => entry.id === chosenEntryId);
    if (chosenEntry === undefined) continue; // unknown chosenEntryId → unresolved
    byIssue[issue.id] = { citationId: joined.citationId, chosenEntry };
    resolvedCounts[issue.severity] = (resolvedCounts[issue.severity] ?? 0) + 1;
    totalResolved += 1;
  }

  return { byIssue, resolvedCounts, totalResolved };
}
