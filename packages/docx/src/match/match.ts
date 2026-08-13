/**
 * S04-T2 — §27 match-map orchestration (pure, R008).
 *
 * `buildMatchMap(doc, weights)` turns the per-citation×per-entry scores of
 * `score.ts` into the §27 match-state map: every §20 citation occurrence
 * maps to a §21 bibliography entry or to a no-good-target state, plus the
 * reverse bibliography-side entry statuses (CITED / UNUSED /
 * AMBIGUOUS_USAGE). Deterministic — same document bytes, same map,
 * byte-identically (R008).
 *
 * POLICY (D015, conservative per §79 — prefer "I am uncertain" over "This is
 * wrong" when evidence is insufficient):
 *   - Entries absent (bibliography absent, outcome !== 'detected', or
 *     `entries` empty/undefined) → every citation is MISSING_REFERENCE with
 *     reasons ['no-entry'] — the engine NEVER silently guesses a target
 *     (R004/§79). Nothing is scored against nothing.
 *   - Each §20 AUTHOR-DATE item is scored against EVERY entry; numeric items
 *     are skipped (M001 is author-date only; the §20 numeric family is M002).
 *   - Candidates are stable-sorted by (score desc, entry index asc) — the
 *     deterministic tie-break mirrored from S02 (MEM032; scores are
 *     4-decimal-rounded so the comparison is exact).
 *   - Exactly one candidate at/above MATCH_THRESHOLD → MATCHED (the §79
 *     guard: no wrong-year pairing can reach 0.7 — max 0.65).
 *   - Multiple candidates at/above MATCH_THRESHOLD within MATCH_MARGIN of
 *     each other → AMBIGUOUS, never auto-picked (§27/CS004); a decisive gap
 *     (> MATCH_MARGIN) still resolves to MATCHED (the runner-up is a
 *     rejected candidate, not a tie).
 *   - No candidate at/above MATCH_THRESHOLD: the top candidate in the
 *     [POSSIBLE_MISMATCH_THRESHOLD, MATCH_THRESHOLD) band → POSSIBLE_MISMATCH
 *     with the in-band score as its low confidence (a near-miss with partial
 *     author/year evidence — e.g. a wrong-year pairing, a contradicting
 *     given initial, a Đ/đ phoneme mismatch); below the band →
 *     MISSING_REFERENCE (no usable evidence).
 *   - `confidence` is derived deterministically from the score evidence:
 *     MATCHED/AMBIGUOUS/POSSIBLE_MISMATCH carry the representative score
 *     (the in-band POSSIBLE_MISMATCH score is "low" by construction),
 *     MISSING_REFERENCE carries 0.
 *
 * MULTI-ITEM OCCURRENCES: one result per occurrence (the model contract).
 * Each item is scored independently, then the occurrence takes the state of
 * its most-severe item under the conservative order AMBIGUOUS >
 * POSSIBLE_MISMATCH > MISSING_REFERENCE > MATCHED (an unresolvable item
 * makes the whole occurrence unresolvable); `matchedEntryId` is set only for
 * a MATCHED resolution and picks the first MATCHED item's entry (document
 * order — deterministic). M001's fixture corpus uses single-item
 * occurrences; this rule is documented for M003.
 *
 * Determinism discipline: no locale calls, insertion-stable iteration over
 * `doc.citations` and `bibliography.entries` order, scores rounded to 4
 * decimals upstream, margin comparisons guarded by an epsilon.
 */

import type {
  AcademicDocument,
  AuthorDateCitationItem,
  CitationItem,
  CitationMatchResult,
  EntryMatchStatusRow,
  MatchMap,
  MatchReason,
  ReferenceEntry,
} from '@citesync/document-model';

import { scoreCitationAgainstEntry } from './score.js';
import type { CitationScore } from './score.js';
import {
  MATCH_WEIGHTS,
  MATCH_THRESHOLD,
  POSSIBLE_MISMATCH_THRESHOLD,
  MATCH_MARGIN,
} from './weights.js';
import type { MatchWeights } from './weights.js';

/** Float comparison epsilon (scores are 4-decimal-rounded; guards drift). */
const EPSILON = 1e-9;

/** One item × entry scored candidate (entry index kept for the tie-break). */
interface ScoredCandidate {
  entry: ReferenceEntry;
  index: number;
  score: CitationScore;
}

/** §27 states ordered by conservative severity (most severe first). */
const SEVERITY: Readonly<Record<CitationMatchResult['relationship'], number>> = {
  AMBIGUOUS: 3,
  POSSIBLE_MISMATCH: 2,
  MISSING_REFERENCE: 1,
  MATCHED: 0,
};

/** Internal item-level result (carries the AMBIGUOUS candidate entry ids). */
interface ItemResult {
  relationship: 'MATCHED' | 'MISSING_REFERENCE' | 'AMBIGUOUS' | 'POSSIBLE_MISMATCH';
  matchedEntryId?: string;
  score: number;
  tier: number;
  confidence: number;
  reasons: MatchReason[];
  /** Entry ids of the tied at/above-threshold candidates (AMBIGUOUS only). */
  ambiguousEntries: string[];
}

/**
 * Build the §27 match-state map for a document.
 *
 * Pure + deterministic (R008): a function of `doc` (and the optional named
 * weight set), with no I/O, no clock, no locale calls. The caller wires this
 * AFTER `doc.citations` and `doc.bibliography.entries` are populated (the
 * extraction tail in buildModel).
 */
export function buildMatchMap(
  doc: AcademicDocument,
  weights: MatchWeights = MATCH_WEIGHTS,
): MatchMap {
  const entries =
    doc.bibliography?.outcome === 'detected' ? (doc.bibliography.entries ?? []) : [];
  const hasTargets = entries.length > 0;

  const citations: CitationMatchResult[] = [];
  const cited = new Set<string>();
  const ambiguousUsed = new Set<string>();

  for (const occurrence of doc.citations) {
    const itemResults = occurrence.items
      .filter(isAuthorDateItem)
      .map((item) => matchItem(item, entries, hasTargets, weights));
    const combined = combineItems(occurrence.id, occurrence.source, itemResults);
    if (
      combined.result.relationship === 'MATCHED' &&
      combined.result.matchedEntryId !== undefined
    ) {
      cited.add(combined.result.matchedEntryId);
    }
    for (const id of combined.ambiguousEntries) ambiguousUsed.add(id);
    citations.push(combined.result);
  }

  // §27 bibliography-side statuses, reversed from the citation map in
  // deterministic r0..rN section order (D015): every entry matched by ≥1
  // MATCHED citation → CITED; an entry appearing in an AMBIGUOUS resolution
  // → AMBIGUOUS_USAGE; otherwise UNUSED.
  const entryStatus: EntryMatchStatusRow[] = entries.map((entry) => {
    const status = cited.has(entry.id)
      ? 'CITED'
      : ambiguousUsed.has(entry.id)
        ? 'AMBIGUOUS_USAGE'
        : 'UNUSED';
    return { entryId: entry.id, status };
  });

  return { version: 1, citations, entryStatus };
}

// ---------------------------------------------------------------------------
// Item-level resolution.
// ---------------------------------------------------------------------------

/** Score one author-date item against every entry and apply the D015 policy. */
function matchItem(
  item: AuthorDateCitationItem,
  entries: ReferenceEntry[],
  hasTargets: boolean,
  weights: MatchWeights,
): ItemResult {
  if (!hasTargets) {
    // No bibliography targets at all — no silent guess (§79/R004).
    return missingEntryResult();
  }
  const candidates: ScoredCandidate[] = entries
    .map((entry, index) => ({ entry, index, score: scoreCitationAgainstEntry(item, entry, weights) }))
    .sort((a, b) => b.score.score - a.score.score || a.index - b.index);

  const top = candidates[0]!;
  const second = candidates[1];
  const above = candidates.filter((c) => c.score.score >= MATCH_THRESHOLD - EPSILON);

  if (above.length >= 2 && top.score.score - second!.score.score <= MATCH_MARGIN + EPSILON) {
    // Multiple strong candidates within the margin — never auto-pick (§27).
    return {
      relationship: 'AMBIGUOUS',
      score: top.score.score,
      tier: top.score.tier,
      confidence: top.score.score,
      reasons: dedupeReasons([...top.score.reasons, 'ambiguous']),
      ambiguousEntries: above.map((c) => c.entry.id),
    };
  }
  if (above.length >= 1) {
    // A single (or decisively-gapped) candidate above the threshold: MATCHED.
    // The §79 invariant guarantees no wrong-year pairing ever gets here.
    return {
      relationship: 'MATCHED',
      matchedEntryId: top.entry.id,
      score: top.score.score,
      tier: top.score.tier,
      confidence: top.score.score,
      reasons: top.score.reasons,
      ambiguousEntries: [],
    };
  }
  if (top.score.score >= POSSIBLE_MISMATCH_THRESHOLD - EPSILON) {
    // Near-miss band: partial author/year evidence, low confidence — a
    // warning, never a confident state (§79).
    return {
      relationship: 'POSSIBLE_MISMATCH',
      score: top.score.score,
      tier: top.score.tier,
      confidence: top.score.score,
      reasons: top.score.reasons,
      ambiguousEntries: [],
    };
  }
  // Below the band: no usable evidence.
  return {
    relationship: 'MISSING_REFERENCE',
    score: top.score.score,
    tier: top.score.tier,
    confidence: 0,
    reasons: ['no-entry'],
    ambiguousEntries: [],
  };
}

/** MISSING_REFERENCE shape for the absent-targets path (score 0 / tier 5). */
function missingEntryResult(): ItemResult {
  return {
    relationship: 'MISSING_REFERENCE',
    score: 0,
    tier: 5,
    confidence: 0,
    reasons: ['no-entry'],
    ambiguousEntries: [],
  };
}

// ---------------------------------------------------------------------------
// Occurrence-level combination (multi-item citations).
// ---------------------------------------------------------------------------

/** The public result plus the internal AMBIGUOUS-entry set for statusing. */
interface CombinedResult {
  result: CitationMatchResult;
  ambiguousEntries: string[];
}

/**
 * Combine per-item results into the one-per-occurrence model contract.
 * The most-severe item (AMBIGUOUS > POSSIBLE_MISMATCH > MISSING_REFERENCE >
 * MATCHED) is the representative; ties resolve to the first item in document
 * order. Ambiguous candidate ids from every item are forwarded for the
 * bibliography-side AMBIGUOUS_USAGE derivation.
 */
function combineItems(
  citationId: string,
  citationSource: CitationMatchResult['citationSource'],
  items: ItemResult[],
): CombinedResult {
  if (items.length === 0) {
    // An occurrence with no scoreable author-date items (e.g. numeric-only
    // in a future M002 document) — no target, no silent guess.
    const result: CitationMatchResult = {
      citationId,
      citationSource,
      relationship: 'MISSING_REFERENCE',
      score: 0,
      tier: 5,
      confidence: 0,
      reasons: ['no-entry'],
    };
    return { result, ambiguousEntries: [] };
  }
  let rep = items[0]!;
  for (const item of items) {
    if (SEVERITY[item.relationship] > SEVERITY[rep.relationship]) rep = item;
  }
  const ambiguousEntries: string[] = [];
  for (const item of items) {
    for (const id of item.ambiguousEntries) {
      if (!ambiguousEntries.includes(id)) ambiguousEntries.push(id);
    }
  }
  const result: CitationMatchResult = {
    citationId,
    citationSource,
    relationship: rep.relationship,
    ...(rep.matchedEntryId !== undefined ? { matchedEntryId: rep.matchedEntryId } : {}),
    score: rep.score,
    tier: rep.tier,
    confidence: rep.confidence,
    reasons: rep.reasons,
    // M003-S02-T1 (additive): expose the tied at/above-threshold candidate
    // ids ONLY for an AMBIGUOUS resolution — the possible-references panel
    // (S02) / R013 resolution picker (S03) consume these. `ambiguousEntries`
    // is deduped preserve-first-seen in document order (deterministic). The
    // items.length === 0 numeric-only path above returns before this point,
    // and a non-empty set is structurally impossible for a non-AMBIGUOUS
    // representative (AMBIGUOUS has the top SEVERITY), so the field is
    // present iff relationship === 'AMBIGUOUS'.
    ...(ambiguousEntries.length > 0 ? { candidateEntryIds: ambiguousEntries } : {}),
  };
  return { result, ambiguousEntries };
}

// ---------------------------------------------------------------------------
// Helpers (all pure).
// ---------------------------------------------------------------------------

/** A §20 item is author-date when it is not a numeric (bracketed) item. */
function isAuthorDateItem(item: CitationItem): item is AuthorDateCitationItem {
  return !('numbers' in item);
}

/** Deduplicate reasons preserving first-seen order (deterministic). */
function dedupeReasons(reasons: MatchReason[]): MatchReason[] {
  const seen = new Set<MatchReason>();
  const out: MatchReason[] = [];
  for (const reason of reasons) {
    if (!seen.has(reason)) {
      seen.add(reason);
      out.push(reason);
    }
  }
  return out;
}
