/**
 * M002-S02-T2 — author-date rules CS001–CS005 (pure, R008).
 *
 * Each rule is a PURE function over the frozen `RuleContext` (T1): it maps
 * M001 match-map rows (`matchMap.citations` / `matchMap.entryStatus`) and
 * §21 bibliography entries to typed `LintIssue[]` with severity + evidence +
 * sourceLoc. No I/O, no clock, no locale — same ctx → byte-identical issues.
 *
 * CONDITION SURFACES (map row → rule):
 *   - CS001 Missing Reference (ERROR): author-date citation whose match-map
 *     row is `MISSING_REFERENCE` (the M001 engine emits this when no
 *     bibliography target exists — reasons ['no-entry'] — or when the top
 *     candidate fell below the POSSIBLE_MISMATCH band; never a silent guess,
 *     §79/R004). Numeric-family citations are skipped (their "missing
 *     target" surface is CS008, T3).
 *   - CS002 Unused Reference (WARNING): an `entryStatus` row with
 *     `UNUSED` — the reverse bibliography-side map (D015). CITED and
 *     AMBIGUOUS_USAGE rows are not unused.
 *   - CS003 Year Mismatch (WARNING): a row whose `reasons` include the
 *     deterministic matcher code 'year-mismatch' (the §25/§26 scorer emits it
 *     for a wrong-year pairing, which by construction stays below
 *     MATCH_THRESHOLD — §79 caps wrong-year at 0.65). The row is therefore
 *     POSSIBLE_MISMATCH; the matched reference entry is NOT exposed by the
 *     map (only MATCHED rows carry `matchedEntryId`), so the message states
 *     the citation year and flags the reference-side mismatch without
 *     inventing a reference year.
 *   - CS004 Ambiguous Author-Date Match (AMBIGUOUS): a row with
 *     relationship 'AMBIGUOUS' — M001 already refused to auto-pick among
 *     tied at/above-threshold candidates (§27/CS004 never auto-pick); this
 *     rule surfaces that state as a typed issue. The candidate entry ids are
 *     matcher-internal and not exposed on the map row, so evidence carries
 *     the 'ambiguous' reason code + the citation source (R009 join).
 *   - CS005 Missing Year Suffix (WARNING): a bibliography-side defect,
 *     independent of the match map — two+ entries sharing the same
 *     first-author §24 key AND year form a cluster that requires 2018a/2018b
 *     disambiguation (PRD §32). An entry in a ≥2 cluster is flagged when it
 *     carries no `yearSuffix` or its suffix is duplicated within the
 *     cluster (a duplicate suffix is as ambiguous as none). Fully
 *     disambiguated clusters (every entry carries a distinct suffix) and
 *     clusters whose entries differ by given name (distinct §24 keys) are
 *     clean.
 *
 * CONSERVATIVE BIAS (§79): an absent `matchMap` is itself a signal — the
 * rules never fabricate a match state, so CS001–CS004 emit NOTHING when the
 * map is undefined (no evidence of any match), while CS005 still runs
 * because it needs only the bibliography. Entries without authors/year never
 * cluster (no author signal → no guess). Rows referencing entries the
 * bibliography no longer carries are skipped defensively (no source to
 * point at).
 */

import type {
  CitationOccurrence,
  MatchMap,
  MatchReason,
  ReferenceEntry,
  SourceLocation,
} from '@citesync/document-model';

import type { LintEvidence, LintIssue, Rule, RuleContext } from './types.js';

// ---------------------------------------------------------------------------
// Shared deterministic helpers.
// ---------------------------------------------------------------------------

/**
 * Deterministic template messages for the §25/§26/§27 matcher codes a
 * CS001/CS003/CS004 row can carry (R012 — never LLM output; the evidence UI
 * (M003) renders these verbatim).
 */
const REASON_MESSAGES: Readonly<Record<MatchReason, string>> = {
  exact: 'First author matched on the exact normalized key.',
  normalized: 'First author matched on the normalized key.',
  'diacritic-insensitive': 'First author matched only on the diacritic-stripped key.',
  initials: 'First author matched only on the initial-compatible tier.',
  fuzzy: 'First author matched only on the fuzzy tier.',
  'given-initial-mismatch': 'First-author given initials contradict the reference entry.',
  'year-match': 'Citation year equals the reference entry year.',
  'year-mismatch': 'Citation year differs from the reference entry year.',
  'no-year': 'Citation or reference entry lacks a year.',
  'year-suffix': 'Same-year disambiguation suffix present on one side.',
  'author-mismatch': 'No author tier matched the reference entry.',
  'page-match': 'Cited page found in the reference entry pages.',
  'additional-authors': 'Additional cited authors matched reference entry authors.',
  'no-entry': 'No bibliography entry exists to match this citation.',
  ambiguous: 'Multiple reference entries match this citation; none was auto-selected.',
};

/** One `LintEvidence` per DISTINCT matcher code, in row order (deterministic). */
function evidenceFromReasons(
  reasons: readonly MatchReason[],
  source: SourceLocation,
): LintEvidence[] {
  const seen = new Set<MatchReason>();
  const out: LintEvidence[] = [];
  for (const code of reasons) {
    if (seen.has(code)) continue;
    seen.add(code);
    out.push({ code, message: REASON_MESSAGES[code], source });
  }
  return out;
}

/** Row lookup by citation id (document order preserved by the caller). */
function rowsByCitation(matchMap: MatchMap): Map<string, MatchMap['citations'][number]> {
  return new Map(matchMap.citations.map((row) => [row.citationId, row]));
}

/** Deterministic short label for a citation (raw text, truncated). */
function citationLabel(citation: CitationOccurrence): string {
  const raw = citation.raw.trim();
  return raw === '' ? citation.id : truncate(raw, 72);
}

/** Deterministic 72-char truncation for message labels (ASCII ellipsis). */
function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}

/** The first author-date item's year (document order), if any. */
function citationYear(citation: CitationOccurrence): number | undefined {
  for (const item of citation.items) {
    if (!('numbers' in item) && item.year !== undefined) return item.year;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// CS001 — Missing Reference (ERROR).
// ---------------------------------------------------------------------------

/** CS001 — a citation with no matching bibliography entry (MISSING_REFERENCE). */
export const ruleCS001: Rule = {
  id: 'CS001',
  severity: 'ERROR',
  run: (ctx) => {
    if (ctx.matchMap === undefined) return [];
    const rows = rowsByCitation(ctx.matchMap);
    const issues: LintIssue[] = [];
    let n = 0;
    for (const citation of ctx.citations) {
      if (citation.family !== 'author-date') continue;
      const row = rows.get(citation.id);
      if (row === undefined) continue; // no map row → no match evidence (never guess)
      if (row.relationship !== 'MISSING_REFERENCE') continue;
      issues.push({
        id: `CS001:${n++}`,
        ruleId: 'CS001',
        severity: 'ERROR',
        message: `Missing reference: no bibliography entry matches '${citationLabel(citation)}'.`,
        evidence: evidenceFromReasons(row.reasons, citation.source),
        sourceLoc: citation.source,
      });
    }
    return issues;
  },
};

// ---------------------------------------------------------------------------
// CS002 — Unused Reference (WARNING).
// ---------------------------------------------------------------------------

/** CS002 — a bibliography entry never cited (entryStatus UNUSED). */
export const ruleCS002: Rule = {
  id: 'CS002',
  severity: 'WARNING',
  run: (ctx) => {
    if (ctx.matchMap === undefined) return [];
    const entries = new Map((ctx.bibliography?.entries ?? []).map((e) => [e.id, e]));
    const issues: LintIssue[] = [];
    let n = 0;
    for (const row of ctx.matchMap.entryStatus) {
      if (row.status !== 'UNUSED') continue;
      const entry = entries.get(row.entryId);
      if (entry === undefined) continue; // map/bibliography disagree → no source (defensive)
      issues.push({
        id: `CS002:${n++}`,
        ruleId: 'CS002',
        severity: 'WARNING',
        message: `Unused reference: bibliography entry '${truncate(entry.raw, 72)}' is never cited.`,
        evidence: [
          {
            code: 'unused',
            message: 'Bibliography entry is never cited by any citation.',
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
// CS003 — Year Mismatch (WARNING).
// ---------------------------------------------------------------------------

/** CS003 — citation year contradicts the (near-miss) reference year axis. */
export const ruleCS003: Rule = {
  id: 'CS003',
  severity: 'WARNING',
  run: (ctx) => {
    if (ctx.matchMap === undefined) return [];
    const rows = rowsByCitation(ctx.matchMap);
    const issues: LintIssue[] = [];
    let n = 0;
    for (const citation of ctx.citations) {
      if (citation.family !== 'author-date') continue;
      const row = rows.get(citation.id);
      if (row === undefined) continue;
      if (!row.reasons.includes('year-mismatch')) continue;
      const year = citationYear(citation);
      issues.push({
        id: `CS003:${n++}`,
        ruleId: 'CS003',
        severity: 'WARNING',
        message:
          year === undefined
            ? `Possible year mismatch: citation '${citationLabel(citation)}' year does not match the reference entry year.`
            : `Possible year mismatch: citation '${citationLabel(citation)}' year (${year}) does not match the reference entry year.`,
        evidence: evidenceFromReasons(row.reasons, citation.source),
        sourceLoc: citation.source,
      });
    }
    return issues;
  },
};

// ---------------------------------------------------------------------------
// CS004 — Ambiguous Author-Date Match (AMBIGUOUS).
// ---------------------------------------------------------------------------

/** CS004 — M001 refused to auto-pick; surface the ambiguity as a typed issue. */
export const ruleCS004: Rule = {
  id: 'CS004',
  severity: 'AMBIGUOUS',
  run: (ctx) => {
    if (ctx.matchMap === undefined) return [];
    const rows = rowsByCitation(ctx.matchMap);
    const issues: LintIssue[] = [];
    let n = 0;
    for (const citation of ctx.citations) {
      if (citation.family !== 'author-date') continue;
      const row = rows.get(citation.id);
      if (row === undefined) continue;
      if (row.relationship !== 'AMBIGUOUS') continue;
      issues.push({
        id: `CS004:${n++}`,
        ruleId: 'CS004',
        severity: 'AMBIGUOUS',
        message: `Ambiguous author-date match: '${citationLabel(citation)}' matches multiple reference entries; no single entry was selected (never auto-picked).`,
        evidence: evidenceFromReasons(row.reasons, citation.source),
        sourceLoc: citation.source,
      });
    }
    return issues;
  },
};

// ---------------------------------------------------------------------------
// CS005 — Missing Year Suffix (WARNING).
// ---------------------------------------------------------------------------

/**
 * Cluster key for suffix disambiguation: first-author §24 exact key + year.
 * Two entries in the same cluster are the same author publishing in the same
 * year — the reader cannot tell them apart without 2018a/2018b suffixes
 * (PRD §32). Different given names produce different keys (Smith, J. ≠
 * Smith, P. — no suffix needed). Entries without authors or year never
 * cluster (no signal → no guess, §79).
 */
function suffixClusterKey(entry: ReferenceEntry): string | undefined {
  const first = entry.authors?.[0];
  if (first === undefined || entry.year === undefined) return undefined;
  return `${first.key.exact}::${entry.year}`;
}

/** CS005 — same-author-same-year entries lack unique disambiguation suffixes. */
export const ruleCS005: Rule = {
  id: 'CS005',
  severity: 'WARNING',
  run: (ctx) => {
    const entries = ctx.bibliography?.entries ?? [];
    if (entries.length === 0) return [];
    const clusters = new Map<string, ReferenceEntry[]>();
    for (const entry of entries) {
      const key = suffixClusterKey(entry);
      if (key === undefined) continue;
      const list = clusters.get(key);
      if (list === undefined) clusters.set(key, [entry]);
      else list.push(entry);
    }
    const issues: LintIssue[] = [];
    let n = 0;
    for (const cluster of clusters.values()) {
      if (cluster.length < 2) continue;
      // An entry is undisambiguated when it carries no suffix or when another
      // entry in the cluster carries the SAME suffix (a duplicate is as
      // ambiguous as a missing one — conservative, §79).
      const suffixCounts = new Map<string, number>();
      for (const entry of cluster) {
        const suffix = entry.yearSuffix ?? '';
        suffixCounts.set(suffix, (suffixCounts.get(suffix) ?? 0) + 1);
      }
      for (const entry of cluster) {
        const suffix = entry.yearSuffix ?? '';
        // Undisambiguated = carries NO suffix (the plain 2018 among 2018a/
        // 2018b) OR a duplicated suffix (a duplicate is as ambiguous as a
        // missing one — conservative, §79).
        if (suffix !== '' && (suffixCounts.get(suffix) ?? 0) < 2) continue;
        const year = entry.year!; // cluster members always carry a year
        issues.push({
          id: `CS005:${n++}`,
          ruleId: 'CS005',
          severity: 'WARNING',
          message: `Same author and year as another reference entry: '${truncate(entry.raw, 72)}' needs a year suffix (e.g. ${year}a / ${year}b) to disambiguate.`,
          evidence: [
            {
              code: 'missing-suffix',
              message: 'Same-author-same-year entries lack a unique disambiguation suffix (2018a / 2018b).',
              source: entry.source,
            },
          ],
          sourceLoc: entry.source,
        });
      }
    }
    return issues;
  },
};

// ---------------------------------------------------------------------------
// T4 registry input.
// ---------------------------------------------------------------------------

/** The author-date ruleset (CS001–CS005), in rule-id order (T4 consumes). */
export const AUTHOR_DATE_RULES: readonly Rule[] = [
  ruleCS001,
  ruleCS002,
  ruleCS003,
  ruleCS004,
  ruleCS005,
];
