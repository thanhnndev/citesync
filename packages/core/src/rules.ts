/**
 * M002-S03 — contributor rule surface (R009): `createRule` + custom-rule
 * registration.
 *
 * Contributors build custom rules through the public `Rule` interface
 * (re-exported from the frozen S02 contract via `@citesync/core`), wrap them
 * with `createRule` (shape validation — fail-fast contributor errors, never
 * a silent mis-configuration), and hand them to `lintDocument` via
 * `options.customRules`. The custom rule then runs alongside the built-in
 * CS001–CS009 registry in the same deterministic pass — the matcher,
 * registry and built-in rules are never modified (slice demo contract).
 *
 * VALIDATION PHILOSOPHY: `createRule` validates the SHAPE of one rule
 * (id/severity/run). Id-collision checks against built-ins and between
 * custom rules happen at pass time in `lintDocument` (it knows the full
 * rule set); both fail fast with a `TypeError` naming the offending id —
 * deterministic programmatic errors, never a silent skip.
 */

import { RULE_SEVERITIES } from '@citesync/docx';
import type { Rule, RuleSeverity } from '@citesync/docx';

/**
 * Contributor-friendly configuration for one custom rule. Identical to the
 * frozen S02 `Rule` contract but written out so the public API documents
 * itself without forcing contributors to chase the type chain.
 */
export interface RuleConfig {
  /** Rule id (e.g. "CS900"). Must be unique — not colliding with a built-in CS001–CS009 id or another custom rule in the same pass. */
  id: string;
  /** Default severity (R008 union). `lintDocument` severityOverrides re-grade deterministically post-run. */
  severity: RuleSeverity;
  /**
   * Run the rule over the frozen pass context. A pure function: no I/O, no
   * clock, no randomness (R008) — same ctx → same `LintIssue[]`, byte-
   * identically. Conservative bias (§79): surface issue/uncertainty over a
   * confident wrong answer.
   */
  run: Rule['run'];
}

/**
 * Wrap a contributor rule definition with shape validation. Throws a
 * `TypeError` naming the offending field when the config is malformed —
 * fail-fast contributor feedback (a bad rule must never silently no-op).
 */
export function createRule(config: RuleConfig): Rule {
  if (typeof config.id !== 'string' || config.id.trim() === '') {
    throw new TypeError('createRule: rule "id" must be a non-empty string');
  }
  if (!(RULE_SEVERITIES as readonly string[]).includes(config.severity)) {
    throw new TypeError(
      `createRule: rule "${config.id}" severity must be one of ${RULE_SEVERITIES.join(' | ')} ` +
        `(got ${JSON.stringify(config.severity)})`,
    );
  }
  if (typeof config.run !== 'function') {
    throw new TypeError(
      `createRule: rule "${config.id}" must provide a "run(ctx: RuleContext): LintIssue[]" function`,
    );
  }
  return { id: config.id, severity: config.severity, run: config.run };
}
