/**
 * M002-S02-T1 — ruleset public surface (freeze point for S3).
 *
 * Exposes the LintIssue + Rule contract that the S3 lint core, the CLI, and
 * the T2–T4 rule implementations consume. T2 adds the author-date rules
 * (CS001–CS005), T3 the numeric + parse-failure rules (CS006–CS009), T4 the
 * registry + `lintDocumentRules` aggregator — all surface through this
 * barrel and the `@citesync/docx` package entry.
 */

export { RULE_SEVERITIES } from './types.js';
export type {
  LintEvidence,
  LintIssue,
  Rule,
  RuleContext,
  RuleEvidenceCode,
  RuleSeverity,
} from './types.js';

// M002-S02-T2 — the author-date ruleset (CS001–CS005), each a pure function
// over the frozen RuleContext (T1). T4's registry consumes AUTHOR_DATE_RULES.
export {
  AUTHOR_DATE_RULES,
  ruleCS001,
  ruleCS002,
  ruleCS003,
  ruleCS004,
  ruleCS005,
} from './author-date.js';

// M002-S02-T3 — the numeric + parse-failure ruleset (CS006–CS009), each a
// pure function over the frozen RuleContext (T1). T4's registry consumes
// NUMERIC_RULES.
export {
  NUMERIC_RULES,
  ruleCS006,
  ruleCS007,
  ruleCS008,
  ruleCS009,
} from './numeric.js';

// M002-S02-T4 — the rule registry + deterministic aggregator. REGISTERED_RULES
// is the single registration point (CS001–CS009); lintDocumentRules(doc,
// options) runs the pass with segment enable/disable (PRD §53 families) and
// per-rule severity overrides (PRD §51), returning issues in deterministic
// severity → source → ruleId order. S3's lintDocument() wraps this.
export {
  REGISTERED_RULES,
  RULE_BY_ID,
  RULE_SEGMENTS,
  lintDocumentRules,
} from './registry.js';
export type {
  LintDocumentRulesOptions,
  RuleSegment,
  SeverityInput,
} from './registry.js';
