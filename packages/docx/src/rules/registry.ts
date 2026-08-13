/**
 * M002-S02-T4 — the rule registry + deterministic aggregator.
 *
 * `lintDocumentRules(doc, options)` is the S3 `lintDocument()`-ready surface:
 * it builds the frozen `RuleContext` from the `AcademicDocument` (T1), runs
 * every registered rule (T2 author-date CS001–CS005 + T3 numeric CS006–CS009)
 * over it, honors enable/disable (rule segments, PRD §53 families) and
 * per-rule severity overrides (PRD §51 `.citesyncrc` `rules` map), and
 * returns `LintIssue[]` in a DETERMINISTIC order (R008): severity first
 * (RULE_SEVERITIES precedence — conservative-most first), then source
 * position (document order: block order → paragraph index → char offsets),
 * then ruleId. Issue ids are never renumbered — the registry sorts but does
 * not renumber (T1 contract).
 *
 * CONSERVATIVE BIAS (§79): the aggregator never suppresses or downgrades an
 * issue on its own — `enabled` filters entire rule segments (a deliberate
 * user/config choice), and `severityOverrides` only re-grades what a rule
 * already surfaced. A genuine ambiguity is never silently dropped.
 *
 * DETERMINISM (R008): same `doc` + same options → same byte-identical
 * `LintIssue[]`. Rules stay pure (T1) — overrides are applied as a
 * deterministic POST-MAP over the returned issues, never inside the rules.
 * Invalid override values (not a RuleSeverity, case-insensitive) and
 * overrides for unknown rule ids are ignored deterministically — a bad
 * config line must not crash a lint pass.
 */

import type { AcademicDocument, SourceLocation } from '@citesync/document-model';

import { AUTHOR_DATE_RULES } from './author-date.js';
import { NUMERIC_RULES } from './numeric.js';
import { RULE_SEVERITIES } from './types.js';
import type { LintIssue, Rule, RuleContext, RuleSeverity } from './types.js';

/**
 * A ruleset segment — a family of rules that enable/disable as a group
 * (PRD §53 citation families: `author-date`, `numeric`). The registry's
 * `enabled` option takes segments; rule membership is fixed by
 * `RULE_SEGMENTS` (deterministic).
 */
export type RuleSegment = 'author-date' | 'numeric';

/**
 * All registered rules in rule-id order (CS001…CS009). The registry runs
 * exactly these — the single registration point for the S3 lint core.
 */
export const REGISTERED_RULES: readonly Rule[] = [
  ...AUTHOR_DATE_RULES,
  ...NUMERIC_RULES,
];

/** Rule id → rule lookup (admin/test surface). */
export const RULE_BY_ID: ReadonlyMap<string, Rule> = new Map(
  REGISTERED_RULES.map((rule) => [rule.id, rule]),
);

/**
 * Deterministic segment membership: segment → rule ids in rule-id order.
 * The registry's `enabled` filter resolves through this map.
 */
export const RULE_SEGMENTS: Readonly<Record<RuleSegment, readonly string[]>> = {
  'author-date': AUTHOR_DATE_RULES.map((rule) => rule.id),
  numeric: NUMERIC_RULES.map((rule) => rule.id),
};

/** Rule id → owning segment (inverse of `RULE_SEGMENTS`, built once). */
const SEGMENT_OF: ReadonlyMap<string, RuleSegment> = new Map(
  (Object.keys(RULE_SEGMENTS) as RuleSegment[]).flatMap((segment) =>
    RULE_SEGMENTS[segment].map((ruleId) => [ruleId, segment] as const),
  ),
);

/**
 * Accepted severity-override value: the R008 union or its PRD §51 config-file
 * casing (lowercase `"warning"`). Normalized to the canonical union at
 * runtime; anything else is ignored deterministically.
 */
export type SeverityInput = RuleSeverity | Lowercase<RuleSeverity>;

/** `lintDocumentRules` options (all optional — defaults are the full pass). */
export interface LintDocumentRulesOptions {
  /**
   * Rule segments to run. `undefined` → every registered segment (default);
   * `[]` → no rules run (returns `[]`). Enable/disable is segment-scoped
   * (PRD §53 families), never rule-level — per-rule control happens through
   * `severityOverrides` or a caller-side filter.
   */
  enabled?: readonly RuleSegment[];
  /**
   * Per-rule severity overrides keyed by rule id (PRD §51). Values are
   * case-insensitive (`"warning"` or `"WARNING"` both work); values outside
   * the R008 union and keys without a registered rule are ignored
   * deterministically (a bad config line never crashes a lint pass). Applied
   * as a deterministic post-map — rules stay pure (T1).
   */
  severityOverrides?: Readonly<Partial<Record<string, SeverityInput>>>;
}

// ---------------------------------------------------------------------------
// Deterministic helpers.
// ---------------------------------------------------------------------------

/** Build the frozen rule context straight from the §15 document. */
function contextFromDoc(doc: AcademicDocument): RuleContext {
  return {
    doc,
    matchMap: doc.matchMap,
    numericIndexMap: doc.numericIndexMap,
    bibliography: doc.bibliography,
    citations: doc.citations,
  };
}

/**
 * Normalize a severity-override value: case-insensitive (PRD §51 lowercase
 * config), validated against the R008 union. Returns `undefined` for invalid
 * values — the caller ignores them deterministically.
 */
function normalizeSeverity(value: SeverityInput): RuleSeverity | undefined {
  const upper = value.toUpperCase() as RuleSeverity;
  return (RULE_SEVERITIES as readonly string[]).includes(upper) ? upper : undefined;
}

/**
 * Deterministic document-position tuple of a source location:
 * [block order index, paragraphIndex, startOffset, endOffset]. A block id
 * missing from `doc.blocks` sorts AFTER every real block (tie-broken by the
 * block id string) — fixture/desync locations stay stable.
 */
function sourcePosition(
  source: SourceLocation,
  blockOrder: ReadonlyMap<string, number>,
): readonly [number, number, number, number] {
  return [
    blockOrder.get(source.blockId) ?? Number.MAX_SAFE_INTEGER,
    source.paragraphIndex ?? 0,
    source.startOffset ?? 0,
    source.endOffset ?? 0,
  ];
}

/** Deterministic sort: severity (RULE_SEVERITIES) → source → ruleId → id. */
function compareIssues(
  a: LintIssue,
  b: LintIssue,
  blockOrder: ReadonlyMap<string, number>,
): number {
  const severityA = RULE_SEVERITIES.indexOf(a.severity);
  const severityB = RULE_SEVERITIES.indexOf(b.severity);
  if (severityA !== severityB) return severityA - severityB;
  const [blockA, paraA, startA, endA] = sourcePosition(a.sourceLoc, blockOrder);
  const [blockB, paraB, startB, endB] = sourcePosition(b.sourceLoc, blockOrder);
  if (blockA !== blockB) return blockA - blockB;
  if (paraA !== paraB) return paraA - paraB;
  if (startA !== startB) return startA - startB;
  if (endA !== endB) return endA - endB;
  if (a.sourceLoc.blockId !== b.sourceLoc.blockId) {
    return a.sourceLoc.blockId < b.sourceLoc.blockId ? -1 : 1;
  }
  if (a.ruleId !== b.ruleId) return a.ruleId < b.ruleId ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// ---------------------------------------------------------------------------
// The aggregator.
// ---------------------------------------------------------------------------

/**
 * Run the registered ruleset (CS001–CS009) over one document.
 *
 * @param doc — the §15 document (bibliography/citations/matchMap/
 *   numericIndexMap/referenceParseIssues as populated by the pipeline).
 * @param options — segment enable/disable + per-rule severity overrides
 *   (PRD §51); both optional, defaults = full pass.
 * @returns typed `LintIssue[]` in deterministic order: severity first
 *   (RULE_SEVERITIES precedence), then source position, then ruleId. Issue
 *   ids are stable per-rule ordinals (`${ruleId}:${n}`) — sorted, never
 *   renumbered (T1 contract).
 */
export function lintDocumentRules(
  doc: AcademicDocument,
  options: LintDocumentRulesOptions = {},
): LintIssue[] {
  const ctx = contextFromDoc(doc);
  const { enabled, severityOverrides } = options;

  // Enable/disable: filter REGISTERED_RULES by segment membership. `enabled`
  // undefined → full pass; `[]` → no rules (returns []). Order preserved.
  const rules =
    enabled === undefined
      ? REGISTERED_RULES
      : REGISTERED_RULES.filter((rule) => {
          const segment = SEGMENT_OF.get(rule.id);
          return segment !== undefined && enabled.includes(segment);
        });

  // Severity overrides: deterministic post-map over the returned issues
  // (rules stay pure, T1). Invalid values and unknown rule ids are ignored.
  const overrideOf = new Map<string, RuleSeverity>();
  for (const [ruleId, value] of Object.entries(severityOverrides ?? {})) {
    if (value === undefined) continue; // Partial<Record<...>> — skip missing entries
    const normalized = normalizeSeverity(value);
    if (normalized !== undefined && RULE_BY_ID.has(ruleId)) {
      overrideOf.set(ruleId, normalized);
    }
  }

  const issues: LintIssue[] = [];
  for (const rule of rules) {
    for (const issue of rule.run(ctx)) {
      const severity = overrideOf.get(issue.ruleId);
      issues.push(severity === undefined ? issue : { ...issue, severity });
    }
  }

  // Deterministic order: severity → source → ruleId. Ids are untouched.
  const blockOrder = new Map(doc.blocks.map((block, index) => [block.id, index]));
  issues.sort((a, b) => compareIssues(a, b, blockOrder));
  return issues;
}
