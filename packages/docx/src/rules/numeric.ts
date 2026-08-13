/**
 * M002-S02-T3 — numeric + parse-failure rules CS006–CS009 (pure, R008).
 *
 * Each rule is a PURE function over the frozen `RuleContext` (T1): it maps
 * the M002-S01 `numericIndexMap` (D016), the §88 `referenceParseIssues`
 * list, the document's blocks (invalid bracket surface) and the §21
 * bibliography entries to typed `LintIssue[]` with severity + evidence +
 * sourceLoc. No I/O, no clock, no locale — same ctx → byte-identical issues.
 *
 * CONDITION SURFACES (signal → rule):
 *   - CS006 Citation/Reference Parse Failure (ERROR): a bibliography entry
 *     whose §21 grammar failed (§88 failure isolation — the entry is still
 *     emitted with `parseConfidence: 0` and recorded in
 *     `doc.referenceParseIssues`). The entry is opaque to every downstream
 *     check, so the failure surfaces prominently; evidence code
 *     'reference-parse' (pre-declared by T1). The sibling 'citation-parse'
 *     code stays reserved for a recorded citation-grammar failure list
 *     (the numeric grammar's invalid surface is CS007's producer — see
 *     below), so CS006 reads `doc.referenceParseIssues` only.
 *   - CS007 Invalid Numeric Citation (WARNING): a bracket region that LOOKS
 *     like a numeric citation but is not clean — the numeric grammar's
 *     `invalid` outcome (R007: never half-emitted as an occurrence), reason
 *     'malformed' (`[4-1]`, `[1 2]`, `[1a]`, span > MAX_RANGE_SPAN) or
 *     'mixed' (`[1, x]`). The rule re-runs the deterministic grammar over
 *     every block (the same pattern the D016 mapping pass uses) because the
 *     doc records only VALID occurrences, never the invalid surface;
 *     evidence code 'invalid-numeric' (pre-declared by T1).
 *   - CS008 Missing Numeric Reference (ERROR): a numeric index token bound
 *     to nothing — D016 status 'out-of-range' (index > entries.length, or no
 *     bibliography) or 'unmatched' (index < 1, e.g. `[0]`). Consumes
 *     `numericIndexMap` directly; evidence code is the D016 status carried
 *     verbatim (types.ts contract). The numeric analog of CS001.
 *   - CS009 Unused Numeric Reference (WARNING): a bibliography entry never
 *     bound by any resolved numeric token. Computed from the resolved
 *     bindings of `numericIndexMap`; evidence code 'unused' (same
 *     deterministic family code CS002 uses — a bibliography entry never
 *     cited). Cross-family guard: an entry the author-date family cites
 *     (matchMap.entryStatus CITED/AMBIGUOUS_USAGE) is NOT flagged — it IS
 *     used, via the other family. The numeric analog of CS002.
 *
 * CONSERVATIVE BIAS (§79): an absent `numericIndexMap` is itself a signal —
 * no numeric usage evidence → CS008/CS009 emit NOTHING (never guess a
 * missing/unused binding); an empty map likewise proves nothing, so CS009
 * stays silent. CS006 needs only `doc.referenceParseIssues`; CS007 re-scans
 * the blocks (the invalid surface is deterministic grammar output, never a
 * guess). Out-of-range/unmatched indices and unparseable entries are ALWAYS
 * surfaced — never silently dropped.
 */

import type {
  DocumentBlock,
  ReferenceEntry,
  SourceLocation,
} from '@citesync/document-model';

import { detectNumericCitationsInBlock } from '../citations/numeric/index.js';
import type { InvalidNumericCandidate } from '../citations/numeric/index.js';
import type { LintIssue, Rule, RuleContext } from './types.js';

// ---------------------------------------------------------------------------
// Shared deterministic helpers.
// ---------------------------------------------------------------------------

/** Deterministic 72-char truncation for message labels (ASCII ellipsis). */
function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}

/**
 * A SourceLocation for an invalid bracket candidate: block-anchored, R009
 * exact character span over the bracket region (paragraphIndex carried when
 * the block has one — mirrors the D016 token-source pattern).
 */
function bracketSource(
  block: DocumentBlock,
  cand: InvalidNumericCandidate,
): SourceLocation {
  return {
    blockId: block.id,
    ...(block.source.paragraphIndex !== undefined
      ? { paragraphIndex: block.source.paragraphIndex }
      : {}),
    startOffset: cand.startOffset,
    endOffset: cand.endOffset,
  };
}

/**
 * A SourceLocation for a §88 parse-failure entry when the bibliography no
 * longer carries the entry (map/bibliography desync): the whole block text
 * range, block-anchored.
 */
function blockRangeSource(
  block: DocumentBlock | undefined,
  blockId: string,
  rawLength: number,
): SourceLocation {
  return {
    blockId,
    ...(block?.source.paragraphIndex !== undefined
      ? { paragraphIndex: block.source.paragraphIndex }
      : {}),
    startOffset: 0,
    endOffset: rawLength,
  };
}

/** Deterministic per-reason template for CS007's invalid-numeric message. */
const INVALID_REASON_MESSAGES: Readonly<Record<InvalidNumericCandidate['reason'], string>> = {
  malformed:
    'the bracket contains a malformed numeric token (e.g. "1a", "1 2", a reversed or oversized range)',
  mixed: 'the bracket mixes numeric indices with non-numeric text (e.g. "[1, x]")',
};

// ---------------------------------------------------------------------------
// CS006 — Citation / Reference Parse Failure (ERROR).
// ---------------------------------------------------------------------------

/** CS006 — a bibliography entry whose §21 grammar failed (§88). */
export const ruleCS006: Rule = {
  id: 'CS006',
  severity: 'ERROR',
  run: (ctx) => {
    const failures = ctx.doc.referenceParseIssues ?? [];
    if (failures.length === 0) return [];
    // Index-aligned bibliography lookup so evidence points at the entry's
    // R009 source region; fall back to a block-derived source when the
    // bibliography is absent or out of sync with the issues list (§79 — the
    // failure is still surfaced, never dropped).
    const entriesByIndex = new Map<number, ReferenceEntry>();
    for (const entry of ctx.bibliography?.entries ?? []) {
      if (entry.index !== undefined) entriesByIndex.set(entry.index, entry);
    }
    const blocksById = new Map(ctx.doc.blocks.map((b) => [b.id, b]));
    const issues: LintIssue[] = [];
    let n = 0;
    for (const failure of failures) {
      const entry = entriesByIndex.get(failure.index);
      const source =
        entry?.source ??
        blockRangeSource(blocksById.get(failure.blockId), failure.blockId, failure.raw.length);
      issues.push({
        id: `CS006:${n++}`,
        ruleId: 'CS006',
        severity: 'ERROR',
        message: `Unparseable reference entry ${failure.index + 1}: '${truncate(failure.raw, 72)}' — ${failure.message}.`,
        evidence: [
          { code: 'reference-parse', message: failure.message, source },
        ],
        sourceLoc: source,
      });
    }
    return issues;
  },
};

// ---------------------------------------------------------------------------
// CS007 — Invalid Numeric Citation (WARNING).
// ---------------------------------------------------------------------------

/** CS007 — a bracket that looks like a numeric citation but is not clean. */
export const ruleCS007: Rule = {
  id: 'CS007',
  severity: 'WARNING',
  run: (ctx) => {
    const issues: LintIssue[] = [];
    let n = 0;
    for (const block of ctx.doc.blocks) {
      const { invalid } = detectNumericCitationsInBlock(block);
      for (const cand of invalid) {
        const source = bracketSource(block, cand);
        issues.push({
          id: `CS007:${n++}`,
          ruleId: 'CS007',
          severity: 'WARNING',
          message: `Invalid numeric citation '${truncate(cand.raw, 40)}': ${INVALID_REASON_MESSAGES[cand.reason]}.`,
          evidence: [
            {
              code: 'invalid-numeric',
              message: INVALID_REASON_MESSAGES[cand.reason],
              source,
            },
          ],
          sourceLoc: source,
        });
      }
    }
    return issues;
  },
};

// ---------------------------------------------------------------------------
// CS008 — Missing Numeric Reference (ERROR).
// ---------------------------------------------------------------------------

/** CS008 — a numeric index bound to nothing (out-of-range / unmatched). */
export const ruleCS008: Rule = {
  id: 'CS008',
  severity: 'ERROR',
  run: (ctx) => {
    if (ctx.numericIndexMap === undefined) return [];
    // entries is optional on BibliographySection (the below-threshold variant
    // carries none) — an absent list means every index is out of range.
    const entryCount = ctx.bibliography?.entries?.length ?? 0;
    const issues: LintIssue[] = [];
    let n = 0;
    for (const row of ctx.numericIndexMap.citations) {
      for (const token of row.tokens) {
        if (token.status === 'resolved') continue;
        const message =
          token.status === 'out-of-range'
            ? `Missing numeric reference: index ${token.index} is out of range (the bibliography has ${entryCount} entr${entryCount === 1 ? 'y' : 'ies'}).`
            : `Missing numeric reference: index ${token.index} is not a valid 1-based reference position.`;
        issues.push({
          id: `CS008:${n++}`,
          ruleId: 'CS008',
          severity: 'ERROR',
          message,
          evidence: [{ code: token.status, message, source: token.source }],
          sourceLoc: token.source,
        });
      }
    }
    return issues;
  },
};

// ---------------------------------------------------------------------------
// CS009 — Unused Numeric Reference (WARNING).
// ---------------------------------------------------------------------------

/** CS009 — a bibliography entry never bound by any resolved numeric token. */
export const ruleCS009: Rule = {
  id: 'CS009',
  severity: 'WARNING',
  run: (ctx) => {
    const entries = ctx.bibliography?.entries ?? [];
    if (entries.length === 0) return [];
    // No numeric usage evidence (absent or empty map) → nothing to check:
    // never guess a binding (§79). buildModel assigns the map only when the
    // doc carries numeric citations, so this guard fires only on absent map.
    if (ctx.numericIndexMap === undefined || ctx.numericIndexMap.citations.length === 0) {
      return [];
    }
    const numericCited = new Set<string>();
    for (const row of ctx.numericIndexMap.citations) {
      for (const token of row.tokens) {
        if (token.resolvedEntryId !== undefined) numericCited.add(token.resolvedEntryId);
      }
    }
    // Cross-family guard: an entry the AUTHOR-DATE family cites is used, so
    // the numeric family must not flag it (matchMap.entryStatus reflects
    // author-date usage only — M001 skips numeric items). In a purely
    // numeric doc every row is UNUSED and the guard stays inert.
    const authorDateCited = new Set<string>();
    for (const row of ctx.matchMap?.entryStatus ?? []) {
      if (row.status === 'CITED' || row.status === 'AMBIGUOUS_USAGE') {
        authorDateCited.add(row.entryId);
      }
    }
    const issues: LintIssue[] = [];
    let n = 0;
    for (const entry of entries) {
      if (numericCited.has(entry.id) || authorDateCited.has(entry.id)) continue;
      issues.push({
        id: `CS009:${n++}`,
        ruleId: 'CS009',
        severity: 'WARNING',
        message: `Unused numeric reference: bibliography entry '${truncate(entry.raw, 72)}' is never cited by any numeric citation.`,
        evidence: [
          {
            code: 'unused',
            message: 'Bibliography entry is never cited by any numeric citation.',
            source: entry.source,
          },
        ],
        sourceLoc: entry.source,
      });
    }
    return issues;
  },
};

// ---------------------------------------------------------------------------
// T4 registry input.
// ---------------------------------------------------------------------------

/** The numeric + parse-failure ruleset (CS006–CS009), in rule-id order. */
export const NUMERIC_RULES: readonly Rule[] = [
  ruleCS006,
  ruleCS007,
  ruleCS008,
  ruleCS009,
];
