/**
 * M002-S03-T1 — the public `lintDocument` entry (R009).
 *
 * `lintDocument(input, options)` is the one-call lint surface of
 * `@citesync/core`. It accepts EITHER a parsed §15 `AcademicDocument` OR raw
 * `.docx` bytes (`Uint8Array` / `ArrayBuffer`) — in the bytes case it runs
 * the S01 `parseDocument` reader end-to-end first (UI -> core -> docx
 * dependency direction, PRD §93), then runs the pass. It returns a typed
 * `LintReport`:
 *
 *   { issues: LintIssue[], doc: AcademicDocument, ruleIds: string[] }
 *
 * Pipeline (all deterministic, R008):
 *   1. Parse (bytes only) via `@citesync/docx` parseDocument — typed
 *      DocxReaderError family on invalid/unsafe input, never a raw crash.
 *   2. Built-in pass CS001–CS009 via the S02 aggregator `lintDocumentRules`
 *      (segment enable/disable + per-rule severity overrides post-map).
 *   3. Contributor custom rules (`options.customRules`, created through
 *      `createRule`) run over the SAME frozen `RuleContext` and are merged
 *      with the built-in issues into ONE deterministic severity → source →
 *      ruleId order. The matcher, built-in registry and built-in rules are
 *      never touched (slice demo contract).
 *
 * VALIDATION: custom rules fail fast with a `TypeError` naming the offending
 * id/field (shape errors, id collisions with built-ins or between custom
 * rules). Severity-override VALUES stay lenient like S02: invalid values and
 * unknown rule ids are ignored deterministically — a bad config line never
 * crashes a lint pass.
 */

import type { AcademicDocument, SourceLocation } from '@citesync/document-model';
import {
  REGISTERED_RULES,
  RULE_BY_ID,
  RULE_SEGMENTS,
  RULE_SEVERITIES,
  lintDocumentRules,
  parseDocument,
} from '@citesync/docx';
import type {
  LintDocumentRulesOptions,
  LintIssue,
  PipelineStage,
  Rule,
  RuleContext,
  RuleSeverity,
  RuleSegment,
  SeverityInput,
} from '@citesync/docx';

/** A raw DOCX buffer (Uint8Array, e.g. fs.readFileSync result) or an ArrayBuffer view. */
export type DocBytes = Uint8Array | ArrayBuffer;

/** What `lintDocument` accepts: a parsed §15 document, or raw .docx bytes. */
export type LintDocumentInput = AcademicDocument | DocBytes;

/** `lintDocument` options — S02 pass options plus the contributor rule surface. */
export interface LintDocumentOptions extends LintDocumentRulesOptions {
  /**
   * Contributor custom rules (built via `createRule`) that run alongside the
   * built-in CS001–CS009 registry in the same pass. Never mutate built-ins:
   * custom rules are registered per-call (no global registry state), so the
   * pass stays deterministic — same input + same options → same report.
   * Custom rules always run (segment `enabled` filtering applies to built-in
   * segments only); per-rule `severityOverrides` apply to them too.
   */
  customRules?: readonly Rule[];
  /**
   * Progress callback (M003, PRD §61): invoked synchronously with each
   * pipeline stage as the pass reaches it. For bytes input the four parse
   * stages are forwarded from `parseDocument` ('reading-document' →
   * 'detecting-bibliography' → 'finding-citations' → 'matching-references');
   * then — for BOTH input kinds — 'running-checks' fires right before the
   * rules pass. Purely observational (R008): the callback can never change
   * the resulting report.
   */
  onStage?: (stage: PipelineStage) => void;
  /**
   * M003 recovery (PRD §63 ask-user): ordered bibliography section block ids
   * (heading block FIRST — the shape of `BibliographySection.blockIds`,
   * MEM097) for the pick-a-section re-run. Forwarded to `parseDocument` and
   * honored ONLY for bytes input: the recovery pass parses the same bytes
   * with the user-chosen section instead of the detector's threshold
   * decision. With a pre-parsed `AcademicDocument` input this option is
   * IGNORED — the document already carries its bibliography state and the
   * parse never runs twice (the re-run must start from the retained bytes,
   * not from the old parsed doc). Additive only: absent/undefined keeps
   * detection behavior byte-identical (R008).
   */
  bibliographyBlockIds?: string[];
}

/** The `lintDocument` result: typed issues + the parsed document + the rules that ran. */
export interface LintReport {
  /** Typed issues in deterministic order: severity (conservative-first) → source → ruleId. */
  issues: LintIssue[];
  /** The §15 document the pass interpreted (parsed from bytes, or the passed-in doc). */
  doc: AcademicDocument;
  /** Rule ids that ran this pass (built-ins after segment filtering + custom rules), sorted. Inspectable for contributors/debugging (R009). */
  ruleIds: readonly string[];
}

// ---------------------------------------------------------------------------
// Input discrimination.
// ---------------------------------------------------------------------------

/** A parsed §15 document has an ordered `blocks` array — bytes never do. */
function isDocument(input: LintDocumentInput): input is AcademicDocument {
  return (
    typeof input === 'object' &&
    input !== null &&
    Array.isArray((input as { blocks?: unknown }).blocks)
  );
}

/** Build the frozen pass context straight from the §15 document (mirrors S02). */
function contextFromDoc(doc: AcademicDocument): RuleContext {
  return {
    doc,
    matchMap: doc.matchMap,
    numericIndexMap: doc.numericIndexMap,
    bibliography: doc.bibliography,
    citations: doc.citations,
  };
}

// ---------------------------------------------------------------------------
// Custom-rule validation (fail-fast contributor errors).
// ---------------------------------------------------------------------------

function isSeverity(value: unknown): value is RuleSeverity {
  return (RULE_SEVERITIES as readonly string[]).includes(value as string);
}

/**
 * Validate the custom-rule set before running. Throws a `TypeError` naming
 * the offending rule id/field — deterministic programmatic feedback, never a
 * silent skip: a malformed or colliding custom rule is a contributor bug,
 * not a config line.
 */
function validateCustomRules(customRules: readonly Rule[]): void {
  const seen = new Set<string>();
  for (const rule of customRules) {
    if (typeof rule?.id !== 'string' || rule.id.trim() === '') {
      throw new TypeError('lintDocument: custom rule "id" must be a non-empty string');
    }
    if (typeof rule?.run !== 'function') {
      throw new TypeError(
        `lintDocument: custom rule "${rule.id}" must provide a "run(ctx): LintIssue[]" function`,
      );
    }
    if (!isSeverity(rule.severity)) {
      throw new TypeError(
        `lintDocument: custom rule "${rule.id}" severity must be one of ${RULE_SEVERITIES.join(' | ')}`,
      );
    }
    if (RULE_BY_ID.has(rule.id)) {
      throw new TypeError(
        `lintDocument: custom rule id "${rule.id}" collides with a built-in rule — ` +
          `choose a unique id (built-ins: ${[...RULE_BY_ID.keys()].join(', ')})`,
      );
    }
    if (seen.has(rule.id)) {
      throw new TypeError(`lintDocument: duplicate custom rule id "${rule.id}"`);
    }
    seen.add(rule.id);
  }
}

// ---------------------------------------------------------------------------
// Severity overrides (S02-lenient: invalid values ignored deterministically).
// ---------------------------------------------------------------------------

/** Case-insensitive normalize (PRD §51 lowercase config); undefined → invalid. */
function normalizeSeverity(value: SeverityInput): RuleSeverity | undefined {
  const upper = value.toUpperCase() as RuleSeverity;
  return isSeverity(upper) ? upper : undefined;
}

/** Overrides scoped to the custom rules (built-ins are handled by S02's aggregator). */
function customOverrideMap(
  severityOverrides: Readonly<Partial<Record<string, SeverityInput>>> | undefined,
  customRules: readonly Rule[],
): ReadonlyMap<string, RuleSeverity> {
  const map = new Map<string, RuleSeverity>();
  if (severityOverrides === undefined) return map;
  const customIds = new Set(customRules.map((rule) => rule.id));
  for (const [ruleId, value] of Object.entries(severityOverrides)) {
    if (value === undefined || !customIds.has(ruleId)) continue;
    const normalized = normalizeSeverity(value);
    if (normalized !== undefined) map.set(ruleId, normalized);
  }
  return map;
}

/** Run the custom rules over the frozen context, applying severity overrides post-map. */
function runCustomRules(
  customRules: readonly Rule[],
  ctx: RuleContext,
  overrideOf: ReadonlyMap<string, RuleSeverity>,
): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const rule of customRules) {
    for (const issue of rule.run(ctx)) {
      const severity = overrideOf.get(issue.ruleId);
      issues.push(severity === undefined ? issue : { ...issue, severity });
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Deterministic merge ordering (R008): severity → source → ruleId → id.
// ---------------------------------------------------------------------------

/**
 * Deterministic document-position tuple: [block order index, paragraphIndex,
 * startOffset, endOffset]. A block id missing from `doc.blocks` sorts after
 * every real block (tie-broken by the block id string) — fixture/desync
 * locations stay stable.
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

/** Deterministic sort shared by the merged issue list (mirrors the S02 order). */
function compareIssues(a: LintIssue, b: LintIssue, blockOrder: ReadonlyMap<string, number>): number {
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

/** Rule id → owning built-in segment (inverse of `RULE_SEGMENTS`, built once). */
const SEGMENT_OF: ReadonlyMap<string, RuleSegment> = new Map(
  (Object.keys(RULE_SEGMENTS) as RuleSegment[]).flatMap((segment) =>
    RULE_SEGMENTS[segment].map((ruleId) => [ruleId, segment] as const),
  ),
);

/** Built-in rule ids after segment enable/disable (deterministic, registry order). */
function activeBuiltInRuleIds(enabled: readonly RuleSegment[] | undefined): string[] {
  if (enabled === undefined) return REGISTERED_RULES.map((rule) => rule.id);
  const enabledSegments = new Set(enabled);
  return REGISTERED_RULES.filter((rule) => {
    const segment = SEGMENT_OF.get(rule.id);
    return segment !== undefined && enabledSegments.has(segment);
  }).map((rule) => rule.id);
}

// ---------------------------------------------------------------------------
// The public entry.
// ---------------------------------------------------------------------------

/**
 * Run the full lint pass over a document.
 *
 * @param input — a parsed `AcademicDocument`, or raw `.docx` bytes
 *   (`Uint8Array`/`ArrayBuffer`) that are parsed end-to-end via
 *   `@citesync/docx` first (typed DocxReaderError family on invalid/unsafe
 *   input).
 * @param options — segment enable/disable + per-rule severity overrides
 *   (S02, PRD §51/§53) plus `customRules` (contributor rules via
 *   `createRule` that run alongside CS001–CS009 without touching the
 *   matcher).
 * @returns `{ issues, doc, ruleIds }` — typed issues in deterministic
 *   severity → source → ruleId order (R008), the parsed document, and the
 *   inspectable list of rules that ran.
 * @throws TypeError on malformed/colliding custom rules (fail-fast
 *   contributor errors); DocxReaderError family on unparseable bytes.
 */
export function lintDocument(
  input: LintDocumentInput,
  options: LintDocumentOptions = {},
): LintReport {
  const { enabled, severityOverrides, customRules = [], onStage, bibliographyBlockIds } = options;

  // Bytes input runs the parse stages (forwarded through onStage by
  // parseDocument); doc input has no parse stages — either way the parse
  // never runs twice. bibliographyBlockIds applies to the bytes parse only
  // (M003 recovery re-run); with doc input it is ignored by design.
  const doc = isDocument(input)
    ? input
    : parseDocument(input, { onStage, bibliographyBlockIds });

  validateCustomRules(customRules);

  // Stage 5/5 (PRD §61): the rules pass — the last pipeline stage. Emitted
  // for BOTH input kinds (doc input has no parse stages, so this is its only
  // stage). Observational only (R008).
  onStage?.('running-checks');

  // Built-in pass CS001–CS009 (S02 aggregator: segment filter + overrides).
  const builtInIssues = lintDocumentRules(doc, { enabled, severityOverrides });

  // Contributor custom rules over the same frozen context, merged below.
  const customIssues =
    customRules.length === 0
      ? []
      : runCustomRules(
          customRules,
          contextFromDoc(doc),
          customOverrideMap(severityOverrides, customRules),
        );

  const issues = [...builtInIssues, ...customIssues];
  const blockOrder = new Map(doc.blocks.map((block, index) => [block.id, index]));
  issues.sort((a, b) => compareIssues(a, b, blockOrder));

  const ruleIds = [...activeBuiltInRuleIds(enabled), ...customRules.map((rule) => rule.id)].sort();

  return { issues, doc, ruleIds };
}
