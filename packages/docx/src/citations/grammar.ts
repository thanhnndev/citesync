/**
 * S03-T03 — author-date citation grammar (§20/§18, plain-text fallback).
 *
 * Consumes a {@link CitationCandidate} from `candidate.ts` and decides —
 * conservatively — whether the region is a real author-date citation, and if
 * so which §20 `AuthorDateCitationItem[]` it yields.
 *
 * SUPPORTED FORMS (§18, exhaustive list from the task contract):
 *   parenthetical:   (Smith, 2024) · (A, B, & C, 2020) · (A & B, 2023) ·
 *                    (A, B, and C, 2022) · (Nguyen et al., 2019) ·
 *                    (Smith, 2020, 2022) multi-year · (Smith, 2021a, 2021b)
 *                    year-suffix · (A, 2020; B, 2019) multi-citation ·
 *                    (Smith, 2020a; Smith, 2020b) · (A, 2024, p. 12) page ·
 *                    (A 2024: 12) Harvard colon page · (Author unknown, n.d.) ·
 *                    (Nguyen 2021) Harvard no-comma
 *   narrative:       Smith (2020) · Pham and Nguyen (2017) ·
 *                    Anderson, Brown, and Clark (2018) · Nguyen et al. (2019) ·
 *                    Nguyễn Văn A (2015) (Vietnamese family-first) ·
 *                    Smith (n.d.)
 *
 * OVER-MATCH GUARDS (documented policy — candidate.ts covers the structural
 * side: paren required, `[1]` excluded, bare "Smith 2024." never a candidate):
 *   - the region must contain a 4-digit year (optionally suffixed) or `n.d.`;
 *   - a parenthetical item REQUIRES an author name unless the date is `n.d.`
 *     (so "(2020)", "(2020; 2021)" and "(Smith)" are NOT citations);
 *   - the narrative form requires a bare-year/`n.d.` paren AND a plausible
 *     name prefix (see `authors.ts` — capitalization, stopwords, back-tracking),
 *     so "The results (2020)" / "An anonymous reviewer (n.d.)" fall back to
 *     "not a citation" (or, for n.d., to the missing-author item "(n.d.)");
 *   - inner content containing `( ) [ ]` is skipped (nested/bracketed regions
 *     are conservatively rejected; their inner regions are still scanned).
 *
 * `firstAuthor` is the surname/family token (see `authors.ts` `familyToken`):
 * first token for Vietnamese family-first names, last non-initial token for
 * Western names. `authors[]` preserves the full cited list, including the
 * "et al." pseudo-author. Everything here is pure + deterministic (R008).
 */

import type { AuthorDateCitationItem } from '@citesync/document-model';

import type { CitationCandidate } from './candidate.js';
import type { CitationFeatures } from './confidence.js';
import {
  cleanAuthorTokens,
  CROSS_REF_MARKERS,
  ET_AL_TAIL_RE,
  familyToken,
  narrativeFeatures,
  parseAuthorPrefix,
  stripPunct,
} from './authors.js';

/** 4-digit year with optional single-letter suffix: 2024, 2021a, 2024. */
const YEAR_RE = /^(\d{4})([a-z])?\.?$/i;
/** n.d. / nd / N.D. (no date). */
const ND_RE = /^n\.?d\.?$/i;
/** Bare-year paren content (narrative form): "2020", "2021a", "n.d.". */
const BARE_YEAR_RE = /^\s*(\d{4})([a-z])?\.?\s*$/i;
const BARE_ND_RE = /^\s*n\.?d\.?\s*$/i;
/** Page tail: p. 12, pp. 12-14, p.12. */
const PAGE_TAIL_RE = /(?:p{1,2}\.?\s*)(\d+(?:\s*[-–—]\s*\d+)?)\s*$/i;
/** Harvard colon page: (A 2024: 12). Applied only when a year precedes ':'. */
const COLON_PAGE_RE = /^(.*?):\s*(\d+(?:\s*[-–—]\s*\d+)?)\s*$/;

/** The parsed result of one candidate region. */
export interface ParsedCitation {
  /** §20 items (one per cited year; multi-citation yields multiple items). */
  items: AuthorDateCitationItem[];
  /** Character offset of the raw region start (name included for narrative). */
  startOffset: number;
  /** Character offset one past the raw region end. */
  endOffset: number;
  /** `text.slice(startOffset, endOffset)` — the raw citation text (R009). */
  raw: string;
  /** Structural features driving the deterministic confidence score. */
  features: CitationFeatures;
}

/** A year/date token as parsed. */
interface YearToken {
  year?: number;
  suffix?: string;
  nd: boolean;
}

/** Result of parsing one semicolon group of a parenthetical citation. */
interface GroupResult {
  items: AuthorDateCitationItem[];
  features: CitationFeatures;
}

/**
 * Parse one candidate region into items, or `null` when the region is not a
 * citation (conservative — never guess).
 */
export function parseCandidate(
  text: string,
  cand: CitationCandidate,
): ParsedCitation | null {
  const inner = cand.region.inner.trim();
  // Nested/bracketed content is structurally rejected (conservative); inner
  // regions are still scanned separately by the candidate detector.
  if (/[()[\]{}]/.test(inner)) return null;

  const yearM = BARE_YEAR_RE.exec(inner);
  const ndM = BARE_ND_RE.exec(inner);
  if (yearM !== null || ndM !== null) {
    // Narrative form: `Name (year)` — authors come from the prefix.
    const prefix = cand.prefix;
    if (prefix !== '') {
      const authors = parseAuthorPrefix(prefix);
      if (authors !== null && authors.length > 0) {
        const firstAuthor = familyToken(authors[0]!);
        const suffix = yearM !== null ? (yearM[2] ?? undefined) : undefined;
        const items: AuthorDateCitationItem[] = [
          {
            ...(firstAuthor !== undefined ? { firstAuthor } : {}),
            authors,
            ...(yearM !== null ? { year: Number(yearM[1]) } : {}),
            ...(suffix !== undefined ? { yearSuffix: suffix } : {}),
          },
        ];
        const startOffset = cand.prefixStart;
        const endOffset = cand.region.closeOffset;
        return {
          items,
          startOffset,
          endOffset,
          raw: text.slice(startOffset, endOffset),
          features: narrativeFeatures(authors, yearM !== null, suffix !== undefined),
        };
      }
    }
    // Missing-author fallback: only a bare `(n.d.)` is kept (the "no date,
    // author unknown" edge case); a bare `(2020)` with no name is NOT a
    // citation (conservative — it is far more likely a section reference).
    if (ndM !== null) {
      return {
        items: [{}],
        startOffset: cand.region.openOffset,
        endOffset: cand.region.closeOffset,
        raw: text.slice(cand.region.openOffset, cand.region.closeOffset),
        features: {
          narrative: false, noComma: false, authorCount: 0, hasEtAl: false,
          years: 0, hasSuffix: false, multiCitation: false, hasPage: false,
          noYear: true, noAuthor: true,
        },
      };
    }
    return null;
  }

  return parseParenthetical(inner, text, cand);
}

/**
 * Parse a full parenthetical content (`Smith, 2020a; Smith, 2020b`) into one
 * occurrence's items. Semicolon-separated groups each yield their own items.
 * Any group that fails the grammar rejects the whole occurrence (conservative).
 */
function parseParenthetical(
  inner: string,
  text: string,
  cand: CitationCandidate,
): ParsedCitation | null {
  const groups = inner
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  if (groups.length === 0) return null;

  const items: AuthorDateCitationItem[] = [];
  let authorCount = 0;
  let hasEtAl = false;
  let hasSuffix = false;
  let hasPage = false;
  let noYear = false;
  let noAuthor = false;
  let noComma = false;
  let years = 0;

  for (const group of groups) {
    const r = parseGroup(group);
    if (r === null) return null;
    items.push(...r.items);
    // Multi-citation groups are SEPARATE items — aggregate with MAX (not sum)
    // so "(A, 2020; B, 2019)" does not look like a 2-author multi-year cite.
    authorCount = Math.max(authorCount, r.features.authorCount);
    hasEtAl = hasEtAl || r.features.hasEtAl;
    hasSuffix = hasSuffix || r.features.hasSuffix;
    hasPage = hasPage || r.features.hasPage;
    noYear = noYear || r.features.noYear;
    noAuthor = noAuthor || r.features.noAuthor;
    noComma = noComma || r.features.noComma;
    years = Math.max(years, r.features.years);
  }

  return {
    items,
    startOffset: cand.region.openOffset,
    endOffset: cand.region.closeOffset,
    raw: text.slice(cand.region.openOffset, cand.region.closeOffset),
    features: {
      narrative: false,
      noComma,
      authorCount,
      hasEtAl,
      years,
      hasSuffix,
      multiCitation: groups.length > 1,
      hasPage,
      noYear,
      noAuthor,
    },
  };
}

/**
 * Parse one semicolon group: `Smith, 2020a` or `Nguyen et al., 2019` or
 * `Author unknown, n.d.` or `Nguyen 2021` or `Smith, 2024, p. 12`.
 * Returns null when the group is not a citation (no year/date, no author
 * unless n.d., or trailing tokens that are not years).
 */
function parseGroup(group: string): GroupResult | null {
  let rest = group.trim();
  let page: string | undefined;

  // 1. p./pp. page tail: "(Smith, 2024, p. 12)" / "(Smith, 2024, pp. 12-14)".
  const pageM = PAGE_TAIL_RE.exec(rest);
  if (pageM !== null) {
    page = pageM[1]!.replace(/\s+/g, '');
    rest = rest.slice(0, pageM.index).trim();
  } else {
    // 2. Harvard colon page: "(A 2024: 12)" — only when a year precedes ':',
    //    so "(12:30, 2024)"-style prose is not misread as a page.
    const colM = COLON_PAGE_RE.exec(rest);
    if (colM !== null && /\d{4}/.test(colM[1]!)) {
      page = colM[2]!.replace(/\s+/g, '');
      rest = colM[1]!.trim();
    }
  }

  const tokens = rest.split(/[,\s]+/).filter(Boolean);
  if (tokens.length === 0) return null;

  // First year/date token splits authors (before) from years (after).
  let dateIdx = -1;
  for (let i = 0; i < tokens.length; i++) {
    if (YEAR_RE.test(tokens[i]!) || ND_RE.test(tokens[i]!)) {
      dateIdx = i;
      break;
    }
  }
  if (dateIdx === -1) return null;

  // Authors: tokens before the date, minus fillers; leading cross-refs
  // ("(see Smith, 2024)") are dropped; "et"/"al." merge into "et al.".
  const authors = cleanAuthorTokens(tokens.slice(0, dateIdx));
  while (authors.length > 0 && CROSS_REF_MARKERS.has(stripPunct(authors[0]!))) {
    authors.shift();
  }
  const realAuthors = authors.filter((a) => !ET_AL_TAIL_RE.test(a));
  const noAuthor = realAuthors.length === 0;
  // Years after the date token; anything that is not a year/date rejects the
  // group ("(Smith, 2024, fig. 2)" is not a citation).
  const years: YearToken[] = [];
  for (let i = dateIdx; i < tokens.length; i++) {
    const t = tokens[i]!;
    const y = YEAR_RE.exec(t);
    const nd = ND_RE.exec(t);
    if (y !== null) {
      years.push({ year: Number(y[1]), suffix: y[2] ?? undefined, nd: false });
    } else if (nd !== null) {
      years.push({ year: undefined, suffix: undefined, nd: true });
    } else {
      return null;
    }
  }
  // Author required unless the date is n.d. (the missing-author edge case).
  if (noAuthor && !years.some((y) => y.nd)) return null;

  const firstAuthor =
    realAuthors.length > 0 ? familyToken(realAuthors[0]!) : undefined;
  const items: AuthorDateCitationItem[] = [];
  let pageAttached = false;
  for (const y of years) {
    const item: AuthorDateCitationItem = {};
    if (firstAuthor !== undefined) item.firstAuthor = firstAuthor;
    // authors[] preserves the FULL cited list — including the "et al."
    // pseudo-author (realAuthors is only used for counting/firstAuthor).
    if (authors.length > 0) item.authors = [...authors];
    if (y.year !== undefined) item.year = y.year;
    if (y.suffix !== undefined) item.yearSuffix = y.suffix;
    if (page !== undefined && y.year !== undefined && !pageAttached) {
      item.page = page;
      pageAttached = true;
    }
    items.push(item);
  }

  const hasSuffix = years.some((y) => y.suffix !== undefined);
  const yearCount = years.filter((y) => y.year !== undefined).length;
  const noYearAll = yearCount === 0;
  // Harvard no-comma: the group contains NO comma at all — the year directly
  // follows the last author name ("(Nguyen 2021)"). "(Smith, 2024)" has the
  // comma, so this stays false for the standard form.
  const noComma = realAuthors.length > 0 && !rest.includes(',');

  return {
    items,
    features: {
      narrative: false,
      noComma,
      authorCount: realAuthors.length,
      // et-al detection must scan the FULL author list (the merged "et al."
      // pseudo-author is filtered out of realAuthors above).
      hasEtAl: authors.some((a) => ET_AL_TAIL_RE.test(a)),
      years: yearCount,
      hasSuffix,
      multiCitation: false,
      hasPage: page !== undefined,
      noYear: noYearAll,
      noAuthor,
    },
  };
}
