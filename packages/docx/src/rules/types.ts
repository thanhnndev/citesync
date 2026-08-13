/**
 * M002-S02-T1 — the LintIssue + Rule interface contract (FROZEN for S3).
 *
 * This file defines the single shared shape that the S3 lint core, the CLI,
 * and the T2–T4 rule implementations all consume (D011 package-location
 * pattern: the ruleset lives under `packages/docx/src/rules/` and renders
 * through the `@citesync/docx` package barrel).
 *
 * CONTRACT (R008/R012):
 *   - `LintIssue` is `{ id, ruleId, severity, message, evidence[], sourceLoc }`
 *     with `severity` exactly `'ERROR' | 'WARNING' | 'AMBIGUOUS' | 'INFO'`
 *     (the R008 union — enforced at compile time below).
 *   - `Rule` is `{ id, severity (default), run(ctx): LintIssue[] }`; every
 *     rule is a PURE function over the frozen `RuleContext` — no I/O, no
 *     clock, no randomness (R008): same ctx → same issues, byte-identically.
 *   - `LintEvidence` carries deterministic matcher codes (the §25/§26
 *     `MatchReason` set + the family-specific `RuleEvidenceCode` set) and
 *     source references — NEVER LLM output (R012 boundary). The M003 issue
 *     explorer joins issues back to the match/numeric maps via these codes.
 *   - `id` on an issue is `${ruleId}:${n}` where `n` is the 0-based ordinal
 *     in the rule's deterministic emission order; ids stay stable across
 *     passes (byte-identical re-runs) and unique across rules (each rule has
 *     a distinct `ruleId`). The T4 registry sorts but never renumbers.
 *   - `Rule.severity` is the rule's DEFAULT severity; issues are emitted
 *     with it, and the T4 registry applies per-pass `severityOverrides` as a
 *     deterministic post-map over the returned issues (rules stay pure).
 *
 * CONSERVATIVE BIAS (§79): a rule surfaces issue/uncertainty over a confident
 * wrong answer and never silently guesses. An absent `matchMap` /
 * `numericIndexMap` / `bibliography` in the context is itself a signal — the
 * rules must handle it explicitly (e.g. no map → no evidence of any match),
 * never fabricate a match.
 */

import type {
  AcademicDocument,
  BibliographySection,
  CitationOccurrence,
  MatchMap,
  MatchReason,
  NumericIndexMap,
  NumericIndexToken,
  SourceLocation,
} from '@citesync/document-model';

/**
 * R008 severity union — exactly these four values (locked below). Order in
 * the union mirrors the PRD listing; `RULE_SEVERITIES` fixes the
 * deterministic report precedence.
 */
export type RuleSeverity = 'ERROR' | 'WARNING' | 'AMBIGUOUS' | 'INFO';

/**
 * The canonical severity set in deterministic report order
 * (conservative-most first: an issue that signals a likely defect or an
 * unresolved ambiguity outranks a hint). Used by the T4 registry sort and
 * by tooling that renders severity consistently.
 */
export const RULE_SEVERITIES = [
  'ERROR',
  'WARNING',
  'AMBIGUOUS',
  'INFO',
] as const satisfies readonly RuleSeverity[];

/**
 * Deterministic evidence codes the CS rules emit beyond the §25/§26 matcher
 * `MatchReason` set. Additive — a later rule may extend this union; the code
 * is ALWAYS a machine-readable deterministic signal, never LLM output (R012).
 */
export type RuleEvidenceCode =
  /** D016 numeric binding status, carried verbatim from `NumericIndexToken.status` (CS008 evidence). */
  | NumericIndexToken['status']
  /** CS007: a bracket that looks like a numeric citation but is not clean (grammar `invalid` surface). */
  | 'invalid-numeric'
  /** CS006 reference side: a §88 reference-grammar failure (`ReferenceParseIssue.code` = 'reference-parse'). */
  | 'reference-parse'
  /** CS006 citation side: a citation candidate whose grammar failed. */
  | 'citation-parse'
  /** CS005: same-author-same-year citations lack a disambiguation suffix (2018 vs 2018a). */
  | 'missing-suffix'
  /** CS002: a bibliography entry never cited (reverse-map `entryStatus` status UNUSED). */
  | 'unused';

/**
 * One deterministic evidence item backing a `LintIssue` (R009/R012).
 *
 * `code` is a `MatchReason` (author-date matcher signal) or a
 * `RuleEvidenceCode` (numeric/parse-family signal) so the M003 evidence UI
 * can join an issue back to the match-state / numeric-index maps it cites.
 * `message` is a template-derived explanation — deterministic, never
 * free-text LLM output (R012 boundary).
 */
export interface LintEvidence {
  /** Machine-readable deterministic code (MatchReason or RuleEvidenceCode). */
  code: MatchReason | RuleEvidenceCode;
  /** Human-readable, template-derived explanation (deterministic). */
  message: string;
  /** The source region this evidence points at (R009 jump-to-source). */
  source: SourceLocation;
}

/**
 * One typed lint issue (R008). The frozen shape S3's `lintDocument()` and
 * the CLI report on; `severity` drives filtering/sorting, `evidence` backs
 * the explanation, `sourceLoc` enables click-to-source (R009).
 */
export interface LintIssue {
  /**
   * Stable per-pass id: `${ruleId}:${n}` — `n` is the 0-based ordinal in the
   * rule's deterministic emission order. Unique across rules, stable across
   * re-runs (R008); the T4 registry sorts but does not renumber.
   */
  id: string;
  /** The rule that produced this issue (e.g. "CS001"). */
  ruleId: string;
  /** R008 severity (defaults to the rule's severity; registry overrides apply deterministically). */
  severity: RuleSeverity;
  /** Human-readable message (deterministic template — never LLM output). */
  message: string;
  /** Deterministic evidence backing the issue (matcher codes + source refs). */
  evidence: LintEvidence[];
  /** Primary source region of the issue (click-to-source, R009). */
  sourceLoc: SourceLocation;
}

/**
 * The frozen pass context every rule reads.
 *
 * `matchMap` / `numericIndexMap` / `bibliography` mirror `doc`'s optional
 * state as explicit `| undefined` fields: rules MUST handle absence
 * conservatively (an absent map is itself a signal — never a guessed match).
 * `doc` stays in the context for the raw text, `referenceParseIssues` and
 * the source map (R009) that rules read when they need them.
 */
export interface RuleContext {
  /** The parsed §15 document the rules interpret. */
  doc: AcademicDocument;
  /** §27 match-state map — undefined when the matcher never ran (no citations/entries). */
  matchMap: MatchMap | undefined;
  /** M002-S01 numeric index map — undefined when the doc has no numeric citations. */
  numericIndexMap: NumericIndexMap | undefined;
  /** §17 bibliography section — undefined when detection found none (or below-threshold with no section). */
  bibliography: BibliographySection | undefined;
  /** §20 citation occurrences (`doc.citations` — always an array; possibly empty). */
  citations: CitationOccurrence[];
}

/**
 * One ruleset rule (CS001–CS009). A pure function over the pass context:
 * no I/O, no clock, no randomness — the same ctx always yields the same
 * issues, byte-identically (R008).
 */
export interface Rule {
  /** Rule id (e.g. "CS001"); unique within the registry. */
  id: string;
  /** Default severity (R008); the T4 registry honors per-pass `severityOverrides`. */
  severity: RuleSeverity;
  /**
   * Run the rule over a pass context. Issues are emitted with the rule's
   * default severity (overrides are applied by the registry, keeping rules
   * pure). Conservative bias (§79): surface issue/uncertainty over a
   * confident wrong answer; never silently guess.
   */
  run(ctx: RuleContext): LintIssue[];
}

// ---------------------------------------------------------------------------
// Compile-time contract checks (enforced by `tsc -b`; runtime no-ops).
//
// These freeze the shape: renaming/extending the severity union, changing
// `Rule`, or changing `LintIssue` breaks the build — which is the T1
// "done-when" for the S3 contract.
// ---------------------------------------------------------------------------

/** `RuleSeverity` must be EXACTLY the R008 four: a missing/extra/renamed member breaks this record. */
const _severityExact: Record<RuleSeverity, true> = {
  ERROR: true,
  WARNING: true,
  AMBIGUOUS: true,
  INFO: true,
};

/** `Rule.run` must return `LintIssue[]` and read the full frozen context. */
const _ruleContract: Rule = {
  id: 'CS000',
  severity: 'INFO',
  run: (ctx) => {
    const _ctxFields: [
      typeof ctx.doc,
      typeof ctx.matchMap,
      typeof ctx.numericIndexMap,
      typeof ctx.bibliography,
      typeof ctx.citations,
    ] = [ctx.doc, ctx.matchMap, ctx.numericIndexMap, ctx.bibliography, ctx.citations];
    void _ctxFields;
    void _severityExact;
    return [];
  },
};

/** `LintIssue` must carry exactly id/ruleId/severity/message/evidence/sourceLoc. */
const _issueContract: LintIssue = {
  id: 'CS000:0',
  ruleId: 'CS000',
  severity: 'INFO',
  message: 'contract check',
  evidence: [{ code: 'no-entry', message: 'contract check', source: { blockId: 'b0' } }],
  sourceLoc: { blockId: 'b0' },
};

void _ruleContract;
void _issueContract;
