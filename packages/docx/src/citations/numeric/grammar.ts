/**
 * M002-S01-T1 — bracketed numeric citation grammar (R007, §20 numeric family).
 *
 * Consumes a {@link NumericCandidate} from `candidate.ts` and classifies the
 * bracket — conservatively — into exactly one of three outcomes:
 *
 *   valid    — every comma-separated segment is a clean index token (single
 *              `1` or range `1-4`); yields `numbers[]` for the §20
 *              `NumericCitationItem` plus per-token sources for T2's mapping.
 *   invalid  — the bracket LOOKS like a numeric citation attempt but is not
 *              clean; surfaced as an invalid-numeric candidate (CS007 in S2)
 *              — NEVER half-emitted as a citation.
 *   ignored  — no numeric-shaped segment at all (prose brackets like
 *              `[Figure 2]`, `[Appendix A]`); not a citation attempt.
 *
 * SUPPORTED FORMS (exhaustive):
 *   [1]            single index
 *   [1,2]          comma-separated list (spaces tolerated: `[1, 2]`)
 *   [1-4]          inclusive range (ASCII hyphen or en-dash: `[1 - 4]`)
 *   [1,2,4-5]      mixed list + ranges
 *   [1][2]         multiple ADJACENT brackets → separate occurrences
 *
 * SEGMENT CLASSIFICATION (documented policy — the conservative core):
 *   numeric-shaped   `^\d+$` (any non-negative integer; `[0]` parses — the
 *                    mapping pass T2 flags index validity) OR a range
 *                    `(\d+)[-–](\d+)` with 1 ≤ start ≤ end and span
 *                    ≤ MAX_RANGE_SPAN. A reversed (`[4-1]`), zero-based or
 *                    oversized range is malformed, not shaped.
 *   malformed-numeric  starts with a digit but is not numeric-shaped
 *                    (`1 2`, `1a`, `1-`, `1-2-3`) — a citation-ish token
 *                    that cannot parse.
 *   non-numeric      anything else (`x`, `Figure`, `Appendix A`) — prose.
 *
 * Bracket outcome by segment classes:
 *   all numeric-shaped        -> valid occurrence
 *   any malformed-numeric     -> invalid (reason 'malformed')
 *   any numeric-shaped + any non-numeric -> invalid (reason 'mixed'),
 *                                  e.g. `[1, x]` — the plan's canonical case
 *   otherwise (all non-numeric) -> ignored (e.g. `[Figure 2]`)
 *
 * Everything here is pure + deterministic (R008) and never guesses: a
 * bracket that cannot be fully parsed is never half-emitted.
 */

import type { NumericCitationItem } from '@citesync/document-model';

import type { NumericCandidate } from './candidate.js';
import type { NumericFeatures } from './confidence.js';

/**
 * Inclusive range span bound (R019 bounds-guard philosophy): a range wider
 * than this is malformed — real bibliographies never span 1000+ references,
 * and expanding it would allocate a huge `numbers[]`. Surfaces as an
 * invalid-numeric candidate instead of a resource spike.
 */
export const MAX_RANGE_SPAN = 1000;

/** A single parsed index token of one bracket, with its text-relative span. */
export interface NumericIndexToken {
  /** The token's index value (single) or range START (kind 'range'). */
  index: number;
  /** Range END (inclusive) when kind 'range'; undefined for 'single'. */
  end?: number;
  kind: 'single' | 'range';
  /** Character offset of the token start inside the block text. */
  startOffset: number;
  /** Character offset one past the token end (exclusive, R009). */
  endOffset: number;
}

/** The parsed result of one clean numeric bracket. */
export interface ParsedNumericCitation {
  /** §20 NumericCitationItem with the flattened, dedup-preserving numbers. */
  item: NumericCitationItem;
  /** Per-token detail in source order (T2 mapping input). */
  tokens: NumericIndexToken[];
  /** Character offset of the bracket's `[`. */
  startOffset: number;
  /** Character offset one past the bracket's `]` (exclusive). */
  endOffset: number;
  /** `text.slice(startOffset, endOffset)` — the raw bracket (R009). */
  raw: string;
  /** Structural features driving the deterministic confidence score. */
  features: NumericFeatures;
}

/** An invalid-numeric bracket surfaced for CS007 (never half-emitted). */
export interface InvalidNumericCandidate {
  /** `text.slice(startOffset, endOffset)` — the raw bracket (R009). */
  raw: string;
  /** Character offset of the bracket's `[`. */
  startOffset: number;
  /** Character offset one past the bracket's `]` (exclusive). */
  endOffset: number;
  /**
   * Why the bracket is not a clean numeric citation:
   *   'malformed' — a segment starts with a digit but cannot parse
   *                 (`1 2`, `1a`, `4-1`, span > MAX_RANGE_SPAN);
   *   'mixed'     — numeric-shaped and non-numeric segments coexist
   *                 (`[1, x]`, `[x, 2]`).
   */
  reason: 'malformed' | 'mixed';
  /** The trimmed comma-separated segments, in source order. */
  segments: string[];
}

/** The grammar's decision for one bracket region. */
export type NumericBracketParse =
  | { outcome: 'valid'; citation: ParsedNumericCitation }
  | { outcome: 'invalid'; invalid: InvalidNumericCandidate }
  | { outcome: 'ignored' };

type SegmentClass = 'numeric-shaped' | 'malformed-numeric' | 'non-numeric';

/** A comma-separated segment with its absolute text span (pre-trim). */
interface Segment {
  text: string;
  /** Character offset of the FIRST non-whitespace char (trimmed start). */
  startOffset: number;
  /** Character offset one past the last non-whitespace char. */
  endOffset: number;
}

/** Single index: any non-negative integer (`[0]` parses; T2 flags validity). */
const SINGLE_RE = /^\d+$/u;
/** Range: `1-4`, `1 - 4`, en-dash `1–4`. Hyphen/en-dash only (em-dash no). */
const RANGE_RE = /^(\d+)\s*[-–]\s*(\d+)$/u;

/**
 * Parse one candidate bracket region into a valid citation, an invalid-
 * numeric candidate, or nothing. Deterministic; never half-emits (R007).
 */
export function parseNumericBracket(
  text: string,
  cand: NumericCandidate,
): NumericBracketParse {
  const { region } = cand;
  const raw = text.slice(region.openOffset, region.closeOffset);
  const segments = splitSegments(region.inner, region.innerStart);
  if (segments.length === 0) return { outcome: 'ignored' };

  const classes: SegmentClass[] = segments.map((s) => classifySegment(s.text));

  // Any malformed-numeric segment poisons the whole bracket (conservative).
  const malformedIdx = classes.indexOf('malformed-numeric');
  if (malformedIdx !== -1) {
    return {
      outcome: 'invalid',
      invalid: {
        raw,
        startOffset: region.openOffset,
        endOffset: region.closeOffset,
        reason: 'malformed',
        segments: segments.map((s) => s.text),
      },
    };
  }

  // Mixed numeric + prose: `[1, x]` is an attempted citation that cannot be
  // fully parsed — surfaced, never half-emitted as `[1]`.
  const shaped = classes.filter((c) => c === 'numeric-shaped').length;
  if (shaped > 0 && shaped < segments.length) {
    return {
      outcome: 'invalid',
      invalid: {
        raw,
        startOffset: region.openOffset,
        endOffset: region.closeOffset,
        reason: 'mixed',
        segments: segments.map((s) => s.text),
      },
    };
  }

  // No numeric-shaped segment at all -> prose bracket, not a citation.
  if (shaped === 0) return { outcome: 'ignored' };

  // All segments are clean: build tokens + the flattened numbers array.
  const tokens: NumericIndexToken[] = [];
  const numbers: number[] = [];
  for (const seg of segments) {
    const token = buildToken(seg);
    if (token.kind === 'range') {
      for (let n = token.index; n <= token.end!; n++) numbers.push(n);
    } else {
      numbers.push(token.index);
    }
    tokens.push(token);
  }

  const features: NumericFeatures = {
    tokenCount: tokens.length,
    indexCount: numbers.length,
    hasRange: tokens.some((t) => t.kind === 'range'),
  };
  return {
    outcome: 'valid',
    citation: {
      item: { numbers },
      tokens,
      startOffset: region.openOffset,
      endOffset: region.closeOffset,
      raw,
      features,
    },
  };
}

/**
 * Split a bracket's inner content into trimmed comma-separated segments,
 * each with its absolute text span. Empty segments (`[1,,2]`, trailing
 * commas) are dropped — sloppy but harmless; the grammar only judges the
 * segments that carry content.
 */
function splitSegments(inner: string, innerStart: number): Segment[] {
  const out: Segment[] = [];
  for (const m of inner.matchAll(/[^,]+/gu)) {
    const chunk = m[0]!;
    const lead = chunk.match(/^\s*/u)?.[0]?.length ?? 0;
    const trail = chunk.match(/\s*$/u)?.[0]?.length ?? 0;
    const start = innerStart + m.index + lead;
    const end = innerStart + m.index + chunk.length - trail;
    if (end > start) out.push({ text: chunk.slice(lead, chunk.length - trail), startOffset: start, endOffset: end });
  }
  return out;
}

/** Classify one trimmed segment (documented policy above). */
function classifySegment(seg: string): SegmentClass {
  if (SINGLE_RE.test(seg)) return 'numeric-shaped';
  const range = RANGE_RE.exec(seg);
  if (range !== null) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    // Valid bounds: 1-based, non-reversed, bounded span. Anything else is a
    // malformed range (`[4-1]`, `[0-2]`, `[1-999999]`).
    if (start >= 1 && end >= start && end - start + 1 <= MAX_RANGE_SPAN) {
      return 'numeric-shaped';
    }
    return 'malformed-numeric';
  }
  // A token that starts with a digit but is not shaped is a citation-ish
  // attempt (`1 2`, `1a`, `1-`); a token starting with a letter is prose.
  return /^\d/u.test(seg) ? 'malformed-numeric' : 'non-numeric';
}

/** Build one index token from a segment already known to be numeric-shaped. */
function buildToken(seg: Segment): NumericIndexToken {
  const range = RANGE_RE.exec(seg.text);
  if (range !== null) {
    return {
      index: Number(range[1]),
      end: Number(range[2]),
      kind: 'range',
      startOffset: seg.startOffset,
      endOffset: seg.endOffset,
    };
  }
  return {
    index: Number(seg.text),
    kind: 'single',
    startOffset: seg.startOffset,
    endOffset: seg.endOffset,
  };
}
