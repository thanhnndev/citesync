/**
 * S03-T03 — author-name list parsing + surname extraction (grammar support).
 *
 * The narrative author-list machinery behind `grammar.ts` (§18 narrative
 * forms: "Pham and Nguyen (2017)", "Anderson, Brown, and Clark (2018)",
 * "Nguyễn Văn A (2015)"). Pure + deterministic (R008); no I/O, no state.
 *
 * Splitting: author groups are separated by `,` / `;` / `and` / `&` (and the
 * Vietnamese equivalents `và` / `hay` / `hoặc`). "et al."/"et al" is a
 * single pseudo-author group, never split.
 *
 * Plausibility: a narrative group must survive et-al stripping, have 1–8 name
 * tokens, start with an uppercase letter (or be a Vietnamese family name —
 * family-first full names are trusted wholesale: "Nguyễn Văn A"), and contain
 * no prose stopword. Failed groups are back-tracked away token-by-token by
 * `parseAuthorPrefix`, so "The results (2020)" / "An anonymous reviewer (n.d.)"
 * collapse to "not a citation" (or the missing-author "(n.d.)" item).
 *
 * `familyToken` extracts the surname: the FIRST token for Vietnamese
 * family-first names (Nguyễn Văn A → Nguyễn, via `isVietnameseFamilyName`),
 * the last NON-INITIAL token for Western names (Doe, J. → Doe; John Smith →
 * Smith). A trailing "et al." phrase is stripped first (Johnson et al. →
 * Johnson).
 */

import { isVietnameseFamilyName } from '../normalize/names.js';
import type { CitationFeatures } from './confidence.js';

/** Author-group separators inside a narrative prefix. */
const AUTHOR_SEPARATOR_RE = /(?:,\s*|\s*;\s*|\band\b|\bvà\b|\bhay\b|\bhoặc\b|&)/gi;
/** Trailing et-al phrase: "et al.", "et al", "et. al.". */
export const ET_AL_TAIL_RE = /(?:^|\s)et\s*\.?\s*al\s*\.?$/i;
/** "et al." / "et al" as separate author tokens. */
const ET_RE = /^et\.?$/i;
const AL_RE = /^al\.?$/i;
/** Author-list filler tokens dropped from parenthetical author lists. */
const AUTHOR_FILLER_RE = /^(&|and|và|or|hay|hoặc)$/i;
/** Leading cross-reference markers in parenthetical author lists. */
export const CROSS_REF_MARKERS: ReadonlySet<string> = new Set([
  'see', 'cf', 'e.g', 'i.e', 'also', 'viz',
]);
/** Name-token stopwords (len ≥ 2; single letters are initials and allowed). */
const FULL_STOPWORDS: ReadonlySet<string> = new Set([
  'an', 'the', 'and', 'or', 'but', 'for', 'on', 'at', 'by', 'with', 'from',
  'to', 'in', 'of', 'this', 'that', 'these', 'those', 'see', 'cf', 'e.g',
  'i.e', 'etc', 'per', 'pp', 'et', 'al', 'figure', 'fig', 'table', 'section',
  'chapter', 'research', 'study', 'studies', 'data', 'note', 'notes',
  'results', 'result', 'cited', 'according', 'appendix', 'supplement',
  'page', 'pages', 'reviewer', 'anonymous', 'unknown',
]);
/** Hard stopwords even for single-token groups. */
const HARD_STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'for', 'on', 'at', 'by', 'with',
  'from', 'to', 'in', 'of', 'this', 'that', 'these', 'those', 'see', 'cf',
  'e.g', 'i.e', 'etc', 'per', 'pp', 'et', 'al',
]);

/**
 * Parse the narrative prefix as an author list: split on `,`/`;`/`and`/`&`
 * (and Vietnamese `và`/`hay`/`hoặc`), then validate every group. If the full
 * prefix fails, back-track token-by-token from the end ("An anonymous
 * reviewer" → "An anonymous" → "An" → ""), returning the first valid parse.
 * Returns `null` when no valid author list survives.
 */
export function parseAuthorPrefix(prefix: string): string[] | null {
  const groups = splitAuthorGroups(prefix);
  if (groups.length > 0 && groups.every(narrativeGroupValid)) {
    return groups.map((g) => g.replace(/\s+/g, ' ').trim());
  }
  const tokens = prefix.split(/\s+/);
  for (let drop = 1; drop < tokens.length; drop++) {
    const shorter = tokens.slice(0, tokens.length - drop).join(' ');
    if (shorter.trim() === '') break;
    const g = splitAuthorGroups(shorter);
    if (g.length > 0 && g.every(narrativeGroupValid)) {
      return g.map((x) => x.replace(/\s+/g, ' ').trim());
    }
  }
  return null;
}

/** Split a narrative prefix into author-name groups. */
function splitAuthorGroups(prefix: string): string[] {
  return prefix
    .split(AUTHOR_SEPARATOR_RE)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Plausibility of one narrative author group:
 *   - must survive et-al stripping and have 1–8 name tokens;
 *   - the first token must be capitalized OR a Vietnamese family name
 *     (family-first full names are trusted wholesale);
 *   - no token may be a prose stopword (single letters are initials).
 */
function narrativeGroupValid(group: string): boolean {
  const g = group.trim().replace(ET_AL_TAIL_RE, '');
  const tokens = g.split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 8) return false;
  const first = tokens[0]!;
  if (isVietnameseFamilyName(first)) return true;
  if (!/^\p{Lu}/u.test(first)) return false;
  if (tokens.length === 1) {
    return !HARD_STOPWORDS.has(stripPunct(first).toLowerCase());
  }
  return tokens.every((t) => !FULL_STOPWORDS.has(stripPunct(t).toLowerCase()));
}

/**
 * Drop filler tokens ("&", "and", ...) and merge "et"/"al." pairs into a
 * single "et al." pseudo-author in a parenthetical author list.
 */
function cleanAuthorTokens(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (AUTHOR_FILLER_RE.test(t)) continue;
    if (ET_RE.test(t) && i + 1 < tokens.length && AL_RE.test(tokens[i + 1]!)) {
      out.push(`et ${tokens[i + 1]}`);
      i++;
      continue;
    }
    out.push(t);
  }
  return out;
}

export { cleanAuthorTokens };

/**
 * Surname/family token of an author name. Vietnamese family-first: the FIRST
 * token ("Nguyễn Văn A" → "Nguyễn"). Western: the LAST non-initial token
 * ("Doe, J." → "Doe", "John Smith" → "Smith"). A trailing "et al." phrase is
 * stripped first ("Johnson et al." → "Johnson").
 */
export function familyToken(name: string): string | undefined {
  const n = name.trim().replace(ET_AL_TAIL_RE, '');
  const tokens = n.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return undefined;
  if (tokens.length === 1) return stripPunct(tokens[0]!);
  if (isVietnameseFamilyName(tokens[0]!)) return stripPunct(tokens[0]!);
  let i = tokens.length - 1;
  while (i > 0 && /^[\p{L}\p{M}]\.?$/u.test(tokens[i]!)) i--;
  return stripPunct(tokens[i]!);
}

/** Strip trailing punctuation from a token ("Doe," → "Doe", "J." → "J"). */
export function stripPunct(t: string): string {
  return t.replace(/[.,;:]+$/u, '');
}

/**
 * Features for a narrative citation: the FULL cited list (incl. the "et al."
 * pseudo-author) is what `authors[]` carries; real-author counting and
 * et-al detection both scan the full list.
 */
export function narrativeFeatures(
  authors: string[],
  hasYear: boolean,
  hasSuffix: boolean,
): CitationFeatures {
  const real = authors.filter((a) => !ET_AL_TAIL_RE.test(a));
  return {
    narrative: true,
    noComma: false,
    authorCount: real.length,
    hasEtAl: authors.some((a) => ET_AL_TAIL_RE.test(a)),
    years: hasYear ? 1 : 0,
    hasSuffix,
    multiCitation: false,
    hasPage: false,
    noYear: !hasYear,
    noAuthor: false,
  };
}
