/**
 * S04-T1 — §25 tier-ladder + §26 weighted scorer (pure, R008).
 *
 * `scoreCitationAgainstEntry` computes the deterministic [0,1] match score of
 * one §20 author-date citation item against one §21 reference entry, applying
 * the PRD §25 tier ladder to the first-author surname and the §26 weights
 * (firstAuthor / year / additionalAuthors / yearSuffix / other) from
 * `weights.ts`.
 *
 * TIER LADDER (§25) — the stored `PersonNameKey` tiers are reused verbatim
 * (S03 built them; nothing is re-normalized on the reference side, MEM047):
 *   tier 1 exact            — citation family key == entry family key segment
 *                             (our `exact` key IS the normalized form, so
 *                             §25 tier 2 "normalized" is subsumed);
 *   tier 3 diacritic-insensitive — exact mismatch but stripped keys agree
 *                             (Nguyễn vs Nguyen). NON-OVERRIDING candidate
 *                             signal (§24): it is reported as a reason and
 *                             never promoted over an exact-phoneme mismatch —
 *                             Đ/đ (U+0110/U+0111) survive stripping
 *                             (MEM002/MEM037), so Đỗ vs Do never reaches this
 *                             tier;
 *   tier 4 initials          — initial-compatible (citation initials are a
 *                             prefix of the entry initials);
 *   tier 5 none              — no author signal at all.
 *
 * The citation-side key is built at match time over the FAMILY TOKEN
 * (`familyToken`, S03) with the literal "et al." pseudo-author stripped
 * (ET_AL_TAIL_RE, MEM038) — the pseudo-author must never leak into keying.
 *
 * CONSERVATIVE BIAS (§79): a wrong-year pairing scores at most 0.65
 * (author 0.40 + additional 0.15 + suffix 0.05 + other 0.05), strictly below
 * MATCH_THRESHOLD 0.7 — so the same-author-two-years fixture can never emit a
 * confident wrong MATCHED. A same-year suffix conflict ("2020a" vs "2020b")
 * is treated as a year-axis mismatch (different works), also capped below the
 * threshold. Neutral signals (citation lists no additional authors / no
 * suffix / no page) do not penalize — absence of evidence is not evidence of
 * absence, but the missing component never ADDS above its weight either.
 *
 * Deterministic: pure function of its inputs, no I/O, no state, no locale
 * calls (plain toLowerCase via the shared normalizer); the score is rounded
 * to 4 decimals and clamped to [0,1] (mirroring the S03 confidence pattern).
 */

import type {
  AuthorDateCitationItem,
  MatchReason,
  PersonName,
  PersonNameKey,
  ReferenceEntry,
} from '@citesync/document-model';

import { familyToken, ET_AL_TAIL_RE } from '../citations/authors.js';
import { buildNameKey } from '../normalize/names.js';
import { MATCH_WEIGHTS } from './weights.js';
import type { MatchWeights } from './weights.js';

/** §25 author-match tiers (tier 2 "normalized" is subsumed by exact here). */
export const AUTHOR_TIER = {
  EXACT: 1,
  NORMALIZED: 2,
  DIACRITIC: 3,
  INITIALS: 4,
  NONE: 5,
} as const;

/**
 * §25 tier → credit fraction of the `firstAuthor` weight.
 *
 * Exact is decisive (full credit); diacritic-insensitive and initials are
 * non-overriding candidate signals with reduced credit (§24/§79 — they may
 * support a MATCHED only together with a strong year signal, and are always
 * reported in `reasons` for transparency).
 */
const AUTHOR_CREDIT: Readonly<Record<number, number>> = {
  [AUTHOR_TIER.EXACT]: 1,
  [AUTHOR_TIER.NORMALIZED]: 1,
  [AUTHOR_TIER.DIACRITIC]: 0.8,
  [AUTHOR_TIER.INITIALS]: 0.6,
  [AUTHOR_TIER.NONE]: 0,
};

/** One citation-item × entry scoring result (S04-T1 contract). */
export interface CitationScore {
  /** §26 score in [0, 1], 4-decimal rounded. */
  score: number;
  /** §25 author tier reached for the first author (1..5). */
  tier: number;
  /** Evidence codes explaining the score (R009-style). */
  reasons: MatchReason[];
  /** True when the first author matched on the exact tier. */
  authorExact: boolean;
}

/**
 * Score one §20 author-date citation item against one §21 reference entry.
 *
 * @param citationItem the citation item to match (firstAuthor/authors/year/
 *   yearSuffix/page — the S03-extracted raw display strings; the "et al."
 *   pseudo-author is stripped before keying, MEM038).
 * @param entry        the reference entry to score against (its `PersonName.key`
 *   tiers are consumed as-is — nothing is re-normalized, MEM047).
 * @param weights      the §26 named weight set (defaults to MATCH_WEIGHTS).
 */
export function scoreCitationAgainstEntry(
  citationItem: AuthorDateCitationItem,
  entry: ReferenceEntry,
  weights: MatchWeights = MATCH_WEIGHTS,
): CitationScore {
  const reasons: MatchReason[] = [];

  // ---- First-author tier (§25 ladder over the stored keys) ----
  const firstRaw =
    citationItem.firstAuthor ?? citationItem.authors?.[0] ?? '';
  const citationKey = citationAuthorKey(firstRaw);
  const entryFirst = entry.authors?.[0];
  const tier =
    entryFirst !== undefined && citationKey.exact !== ''
      ? firstAuthorTier(citationKey, entryFirst)
      : AUTHOR_TIER.NONE;
  const authorExact = tier === AUTHOR_TIER.EXACT;
  const authorCredit = (AUTHOR_CREDIT[tier] ?? 0) * weights.firstAuthor;
  if (tier === AUTHOR_TIER.EXACT) reasons.push('exact');
  else if (tier === AUTHOR_TIER.NORMALIZED) reasons.push('normalized');
  else if (tier === AUTHOR_TIER.DIACRITIC) reasons.push('diacritic-insensitive');
  else if (tier === AUTHOR_TIER.INITIALS) reasons.push('initials');
  else reasons.push('author-mismatch');

  // ---- Year axis (§26 year weight + same-year suffix disambiguation) ----
  // A same-year suffix conflict ("2020a" vs "2020b") means DIFFERENT works:
  // treat the whole year axis as mismatched so such a pairing can never reach
  // MATCH_THRESHOLD (§79 — prefer uncertainty over a confident wrong pick).
  const cy = citationItem.year;
  const ey = entry.year;
  const cs = citationItem.yearSuffix;
  const es = entry.yearSuffix;
  let yearCredit = 0;
  let suffixCredit = 0;
  if (cy === undefined || ey === undefined) {
    reasons.push('no-year');
  } else if (cy !== ey) {
    reasons.push('year-mismatch');
  } else if (cs !== undefined && es !== undefined && cs !== es) {
    reasons.push('year-suffix', 'year-mismatch');
  } else {
    yearCredit = weights.year;
    reasons.push('year-match');
    if (cs !== undefined || es !== undefined) {
      // Suffix present on at least one side: equal → full credit; one-sided →
      // half (the disambiguator is missing on one side — evidence incomplete).
      suffixCredit =
        cs !== undefined && es !== undefined
          ? weights.yearSuffix
          : weights.yearSuffix / 2;
      reasons.push('year-suffix');
    } else {
      // Neither side disambiguated — neutral full credit (nothing to contradict).
      suffixCredit = weights.yearSuffix;
    }
  }

  // ---- Additional authors (§26) ----
  // Citation lists no additional real authors → neutral full credit (the
  // citation is allowed to abbreviate). Citation lists some → proportional
  // credit against the entry's additional authors; an entry with no
  // additional authors to compare against yields half credit (truncated
  // entry — cannot verify, §79).
  let additionalCredit = weights.additionalAuthors;
  const citationAdditional = (citationItem.authors ?? [])
    .slice(1)
    .map((a) => citationAuthorKey(a))
    .filter((k) => k.exact !== '');
  if (citationAdditional.length > 0) {
    const entryAdditional = (entry.authors ?? []).slice(1);
    if (entryAdditional.length === 0) {
      additionalCredit = weights.additionalAuthors / 2;
    } else {
      let matched = 0;
      for (const ck of citationAdditional) {
        if (entryAdditional.some((ea) => additionalAuthorMatches(ck, ea))) {
          matched++;
        }
      }
      additionalCredit =
        (matched / citationAdditional.length) * weights.additionalAuthors;
      if (matched > 0) reasons.push('additional-authors');
    }
  }

  // ---- Other metadata (§26 'other' — page evidence) ----
  // No page cited → neutral full credit. Page cited but the entry carries no
  // pages (or contradicts) → no credit (missing evidence must not inflate).
  let otherCredit = weights.other;
  const page = citationItem.page;
  if (page !== undefined) {
    const pages = entry.identifiers?.pages;
    if (pages !== undefined && pages.includes(page)) {
      reasons.push('page-match');
    } else {
      otherCredit = 0;
    }
  }

  const score = clamp01(
    Math.round(
      (authorCredit + yearCredit + suffixCredit + additionalCredit + otherCredit) *
        10000,
    ) / 10000,
  );
  return { score, tier, reasons, authorExact };
}

// ---------------------------------------------------------------------------
// Helpers (all pure).
// ---------------------------------------------------------------------------

/** First whitespace token of a normalized key — the family segment (§24). */
function firstNameToken(key: string): string {
  return key.split(' ')[0] ?? '';
}

/**
 * Citation-side key for one author display string (MEM038/MEM047): strip the
 * literal "et al." pseudo-author, take the family token, then build the full
 * §25 key over it. Never re-normalizes the reference side.
 */
function citationAuthorKey(author: string): PersonNameKey {
  const cleaned = author.trim().replace(ET_AL_TAIL_RE, '').trim();
  const family = familyToken(cleaned) ?? '';
  return family === '' ? buildNameKey('') : buildNameKey(family);
}

/**
 * §25 tier of the first-author surname against the entry's first author.
 *
 * Compares the citation family key to the ENTRY's stored key segments: the
 * first token of `exact` (the family), the first token of
 * `diacriticInsensitive` (family, diacritic-stripped), then a prefix test on
 * `initials` (initial-compatible). Tier 2 is subsumed by tier 1 because the
 * stored `exact` key IS the normalized surname form.
 */
function firstAuthorTier(
  citationKey: PersonNameKey,
  entryAuthor: PersonName,
): number {
  const entryExact = firstNameToken(entryAuthor.key.exact);
  if (citationKey.exact === entryExact) return AUTHOR_TIER.EXACT;
  const entryDiacritic = firstNameToken(entryAuthor.key.diacriticInsensitive);
  if (citationKey.diacriticInsensitive === entryDiacritic) {
    return AUTHOR_TIER.DIACRITIC;
  }
  const entryInitials = entryAuthor.key.initials;
  if (citationKey.initials !== '' && entryInitials.startsWith(citationKey.initials)) {
    return AUTHOR_TIER.INITIALS;
  }
  return AUTHOR_TIER.NONE;
}

/**
 * One additional citation author against one entry author: exact family-token
 * equality, falling back to the diacritic-insensitive tier (same non-overriding
 * discipline as the first author — Đ/đ stay distinct, MEM037).
 */
function additionalAuthorMatches(
  citationKey: PersonNameKey,
  entryAuthor: PersonName,
): boolean {
  const exact = firstNameToken(entryAuthor.key.exact);
  if (citationKey.exact === exact) return true;
  const diacritic = firstNameToken(entryAuthor.key.diacriticInsensitive);
  return citationKey.diacriticInsensitive === diacritic;
}

/** Clamp to [0, 1] (scores are never negative by construction, but defend). */
function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}
