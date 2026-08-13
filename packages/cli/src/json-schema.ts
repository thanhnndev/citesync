/**
 * @citesync/cli — the FROZEN canonical CLI-report JSON schema (T2, R014).
 *
 * M003's export UI (R014) and external consumers consume EXACTLY the JSON
 * this schema describes. Freeze mechanics (three independent locks):
 *
 *   1. ONE machine-readable schema document — `cliReportSchema` (draft
 *      2020-12 subset): `additionalProperties: false` at every object level,
 *      explicit `required` arrays, severity `enum` bound to `SEVERITY_ORDER`,
 *      `version` `const` bound to `REPORT_VERSION`, error-code `enum` bound
 *      to the `ErrorCode` union.
 *   2. The runtime validator (`validateReport`) INTERPRETS the schema
 *      document — there is no second hand-written shape check to drift.
 *   3. Compile-time freezes: every `properties` map is `satisfies`-typed
 *      against the TS interface it documents (`CliReportMeta`, `LintIssue`,
 *      `LintEvidence`, the issue source location, `CliErrorInfo`,
 *      `RuleSeverity`), so renaming/adding/removing a field breaks `tsc -b`
 *      until the schema follows.
 *
 * PROPERTY ORDER is the canonical serialization order (JSON.stringify =
 * insertion order, R008): report is version → meta → issues → counts →
 * error (error last, present only on failure). meta: file → citations →
 * references → ruleIds. counts: ERROR → WARNING → AMBIGUOUS → INFO.
 * issues[n] (frozen S02 shape): id → ruleId → severity → message → evidence
 * → sourceLoc. evidence[n]: code → message → source.
 *
 * The `issues` array is the @citesync/core `LintIssue[]` VERBATIM — the JSON
 * adds nothing to what S03 `lintDocument` produces (the contract test
 * asserts deep equality against `lintDocument(bytes).issues`), so M003
 * consumes the report as-is with no reshaping.
 */

import type { LintEvidence, LintIssue, RuleSeverity } from '@citesync/core';
import { RULE_SEVERITIES } from '@citesync/core';

import { REPORT_VERSION, SEVERITY_ORDER } from './report.js';
import type { CliErrorInfo, CliReport, CliReportMeta, ErrorCode } from './report.js';

/**
 * Stable identifier for the frozen schema. A URN, not a fetchable URL: it
 * names the contract so consumers (M003 export, CI scripts) can pin the
 * schema version they were built against. Bump the schema id alongside
 * REPORT_VERSION when the shape changes.
 */
export const CLI_REPORT_SCHEMA_ID = 'urn:citesync:cli-report:schema:v1' as const;

/**
 * Error codes observable in the serialized report's `error.code`. Mirrors
 * the `ErrorCode` union (compile-time bound below): `usage` is classified
 * for stderr-only handling today and never serialized, but stays in the
 * enum so the schema is a superset of the observable set and can never lag
 * the TS type.
 */
export const REPORT_ERROR_CODES = [
  'parse-failure',
  'unsupported-document',
  'file-not-found',
  'usage',
] as const satisfies readonly ErrorCode[];

// ---------------------------------------------------------------------------
// Schema node types — the draft 2020-12 subset the validator interprets.
// ---------------------------------------------------------------------------

/** `{ type: 'integer' }` — optional exact value and inclusive lower bound. */
export interface CliJsonSchemaInteger {
  type: 'integer';
  /** Exact value required (used for `version` = REPORT_VERSION). */
  const?: number;
  /** Inclusive lower bound (counters are non-negative). */
  minimum?: number;
}

/** `{ type: 'string' }` — optional closed value set. */
export interface CliJsonSchemaString {
  type: 'string';
  /** Closed value set (severity / error codes). */
  enum?: readonly string[];
}

/** `{ type: 'array' }` — homogeneous arrays only. */
export interface CliJsonSchemaArray {
  type: 'array';
  /** Element schema (homogeneous arrays only). */
  items?: CliJsonSchemaNode;
}

/** `{ type: 'object' }` — required keys, frozen extra-key policy, properties. */
export interface CliJsonSchemaObject {
  type: 'object';
  /** Draft 2020-12 annotation fields (ignored by the validator). */
  $schema?: string;
  $id?: string;
  title?: string;
  description?: string;
  /** When false, keys not in `properties` are rejected (the freeze). */
  additionalProperties?: boolean;
  /** Keys that MUST be present. */
  required?: readonly string[];
  /** Canonical key set + order (the serialization order). */
  properties?: Readonly<Record<string, CliJsonSchemaNode>>;
}

/** The subset union the validator understands. */
export type CliJsonSchemaNode =
  | CliJsonSchemaInteger
  | CliJsonSchemaString
  | CliJsonSchemaArray
  | CliJsonSchemaObject;

// ---------------------------------------------------------------------------
// The frozen schema document. Each `properties` map is `satisfies`-typed
// against the TS interface it documents — the compile-time freeze.
// ---------------------------------------------------------------------------

const versionNode = { type: 'integer', const: REPORT_VERSION } as const satisfies CliJsonSchemaInteger;

/** `meta` properties — bound to `CliReportMeta`: adding/renaming a field breaks the build. */
const metaProperties = {
  file: { type: 'string' },
  citations: { type: 'integer', minimum: 0 },
  references: { type: 'integer', minimum: 0 },
  ruleIds: { type: 'array', items: { type: 'string' } },
} as const satisfies Record<keyof CliReportMeta, CliJsonSchemaNode>;

/** `counts` properties — bound to `RuleSeverity`: a severity union change breaks the build. */
const countsProperties = {
  ERROR: { type: 'integer', minimum: 0 },
  WARNING: { type: 'integer', minimum: 0 },
  AMBIGUOUS: { type: 'integer', minimum: 0 },
  INFO: { type: 'integer', minimum: 0 },
} as const satisfies Record<RuleSeverity, CliJsonSchemaInteger>;

/** Source-location properties — bound to `LintIssue['sourceLoc']` (all five keys). */
const sourceLocProperties = {
  blockId: { type: 'string' },
  paragraphIndex: { type: 'integer', minimum: 0 },
  runIndex: { type: 'integer', minimum: 0 },
  startOffset: { type: 'integer', minimum: 0 },
  endOffset: { type: 'integer', minimum: 0 },
} as const satisfies Record<keyof LintIssue['sourceLoc'], CliJsonSchemaNode>;

const sourceLocationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['blockId'],
  properties: sourceLocProperties,
} as const satisfies CliJsonSchemaObject;

/** Evidence properties — bound to `LintEvidence`: the S02 frozen evidence shape. */
const evidenceProperties = {
  code: { type: 'string' },
  message: { type: 'string' },
  source: sourceLocationSchema,
} as const satisfies Record<keyof LintEvidence, CliJsonSchemaNode>;

const evidenceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['code', 'message', 'source'],
  properties: evidenceProperties,
} as const satisfies CliJsonSchemaObject;

/** Issue properties — bound to `LintIssue`: the frozen S02 issue shape verbatim. */
const issueProperties = {
  id: { type: 'string' },
  ruleId: { type: 'string' },
  severity: { type: 'string', enum: SEVERITY_ORDER },
  message: { type: 'string' },
  evidence: { type: 'array', items: evidenceSchema },
  sourceLoc: sourceLocationSchema,
} as const satisfies Record<keyof LintIssue, CliJsonSchemaNode>;

const issueSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'ruleId', 'severity', 'message', 'evidence', 'sourceLoc'],
  properties: issueProperties,
} as const satisfies CliJsonSchemaObject;

/** Error properties — bound to `CliErrorInfo`. */
const errorProperties = {
  code: { type: 'string', enum: REPORT_ERROR_CODES },
  message: { type: 'string' },
} as const satisfies Record<keyof CliErrorInfo, CliJsonSchemaNode>;

const errorSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['code', 'message'],
  properties: errorProperties,
} as const satisfies CliJsonSchemaObject;

/** The severity enum is locked to the canonical R008 order (RULE_SEVERITIES). */
const _severityEnumFreeze: readonly RuleSeverity[] = RULE_SEVERITIES;
void _severityEnumFreeze;

/**
 * The FROZEN canonical CLI report schema (R014). Plain JSON-serializable —
 * `JSON.parse(JSON.stringify(cliReportSchema))` deep-equals it, so M003 and
 * external consumers can embed/cache the document directly.
 */
export const cliReportSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: CLI_REPORT_SCHEMA_ID,
  title: 'CiteSync CLI Report (canonical, R014)',
  description:
    'The canonical JSON report emitted by `npx citesync thesis.docx -j` and reused by the ' +
    'M003 export UI. version/meta/issues/counts are always present; error appears only when ' +
    'the run failed. issues are the @citesync/core LintIssue[] verbatim (frozen S02 shape).',
  type: 'object',
  additionalProperties: false,
  required: ['version', 'meta', 'issues', 'counts'],
  properties: {
    version: versionNode,
    meta: {
      type: 'object',
      additionalProperties: false,
      required: ['file', 'citations', 'references', 'ruleIds'],
      properties: metaProperties,
    },
    issues: { type: 'array', items: issueSchema },
    counts: {
      type: 'object',
      additionalProperties: false,
      required: SEVERITY_ORDER,
      properties: countsProperties,
    },
    error: errorSchema,
  },
} as const satisfies CliJsonSchemaObject;

// ---------------------------------------------------------------------------
// Runtime validation — interprets the schema document (single source of
// truth; there is no parallel hand-written shape check to drift).
// ---------------------------------------------------------------------------

/** Result of validating a candidate report against the frozen schema. */
export type ReportValidation =
  | { valid: true; report: CliReport }
  | { valid: false; errors: readonly string[] };

/** Compact value description for error messages (never stringifies whole objects). */
function describe(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'object') return typeof value;
  return String(value);
}

/** Recursively validate `value` against a schema node, collecting violations. */
function validateNode(node: CliJsonSchemaNode, value: unknown, path: string, errors: string[]): void {
  switch (node.type) {
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        errors.push(`${path}: expected object, got ${describe(value)}`);
        return;
      }
      const obj = value as Record<string, unknown>;
      for (const key of node.required ?? []) {
        if (!(key in obj)) errors.push(`${path}: missing required property "${key}"`);
      }
      if (node.additionalProperties === false) {
        for (const key of Object.keys(obj)) {
          if (node.properties === undefined || !(key in node.properties)) {
            errors.push(`${path}: unexpected property "${key}"`);
          }
        }
      }
      for (const [key, sub] of Object.entries(node.properties ?? {})) {
        if (key in obj) validateNode(sub, obj[key], `${path}.${key}`, errors);
      }
      return;
    }
    case 'array': {
      if (!Array.isArray(value)) {
        errors.push(`${path}: expected array, got ${describe(value)}`);
        return;
      }
      value.forEach((item, index) => {
        if (node.items !== undefined) validateNode(node.items, item, `${path}[${index}]`, errors);
      });
      return;
    }
    case 'string': {
      if (typeof value !== 'string') {
        errors.push(`${path}: expected string, got ${describe(value)}`);
        return;
      }
      if (node.enum !== undefined && !node.enum.includes(value)) {
        const allowed = node.enum.map((v) => `"${v}"`).join(', ');
        errors.push(`${path}: "${value}" not in enum [${allowed}]`);
      }
      return;
    }
    case 'integer': {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        errors.push(`${path}: expected integer, got ${describe(value)}`);
        return;
      }
      if (node.const !== undefined && value !== node.const) {
        errors.push(`${path}: expected const ${node.const}, got ${value}`);
      }
      if (node.minimum !== undefined && value < node.minimum) {
        errors.push(`${path}: expected >= ${node.minimum}, got ${value}`);
      }
      return;
    }
  }
}

/**
 * Validate a candidate report against the frozen schema.
 *
 * @param input — the serialized JSON text (what `--json` prints) OR an
 *   already-parsed value. A JSON string is parsed first; malformed JSON is
 *   an invalid result, not a throw.
 * @returns `{ valid: true, report }` on success, or `{ valid: false, errors }`
 *   listing every path-level violation found.
 */
export function validateReport(input: unknown): ReportValidation {
  let value: unknown = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch (err) {
      return {
        valid: false,
        errors: [`report: not valid JSON — ${err instanceof Error ? err.message : String(err)}`],
      };
    }
  }
  const errors: string[] = [];
  validateNode(cliReportSchema, value, 'report', errors);
  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, report: value as CliReport };
}
