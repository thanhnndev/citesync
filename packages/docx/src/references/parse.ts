/**
 * S03-T05 — bibliography entry grammar (R006/§21) + §88 failure isolation.
 *
 * `parseReferenceEntry(text, index, source)` turns ONE entry block's text into
 * a `ReferenceEntry`. Supported shapes (the APA author-date bibliography forms
 * S02's detector gates its run on):
 *
 *   - `Surname, Given (Year). Title. Container, Vol(Issue), Pages.`
 *     e.g. `Doe, J. (2017). Citation practice in digital documents. Journal
 *           of Citation Science, 12(3), 45-60.`
 *   - `Family Given (Year) Title.` (Vietnamese family-first, no comma)
 *     e.g. `Nguyễn Văn A (2015) Tên bài báo. Tạp chí Khoa học, 10(2), 15-20.`
 *   - year-suffix `Johnson, A. (2018a). …` → year 2018 + suffix 'a'
 *   - `n.d.` (year undefined, still a valid date marker)
 *   - DOI anywhere after the year: `doi: 10.…` / `https://doi.org/…`
 *
 * Author-group segmentation: groups split on `;` / `&` / ` and ` (and the
 * Vietnamese ` và `, consistent with T03's author lists); within a chunk,
 * `Family, Given` lists (leading surname + comma, e.g. `Doe, J., Smith, A.`)
 * pair alternately into authors, while comma-separated full names
 * (`Nguyễn Văn A, Trần Thị B`) are family-first groups. Names normalize via
 * the T02 module (PersonName + tiered PersonNameKey), reusing T03's
 * `familyToken` for the no-comma Western surname.
 *
 * §88 FAILURE ISOLATION: an entry that does not match the grammar (no year
 * marker, no author segment) NEVER throws. It is emitted with
 * `parseConfidence: 0` and `raw` preserved verbatim; the reason is exposed via
 * `describeReferenceParseFailure` for `AcademicDocument.referenceParseIssues`
 * (recorded by T06). Every regex is locale-free and stateless (R008).
 *
 * Title/container split heuristic: the remainder after the year is split on
 * `. ` and the LAST segment is the container (if any) — this survives
 * abbreviations like `U.S.` inside titles, and for canonical APA entries
 * equals the plan's "up to the first `. ` before container" (there is exactly
 * one `. ` between title and container there). The split skips `. ` that
 * follow abbreviation tokens (`pp`, `vol`, `no`, `ed(s)`, `et al.`) so
 * `pp. 45-60.` never fragments into a fake segment. The `Vol(Issue), Pages`
 * tail folds into `identifiers` = { volume, issue, pages } (D012 — §21 has no
 * page field). Editor-role markers (`(Ed.)`/`(Eds.)`) are stripped from a
 * name before segmentation — the role is not part of the name, and keeping it
 * would pollute the normalized match key (the role stays in `raw`).
 */

import type {
  PersonName,
  ReferenceEntry,
  SourceLocation,
} from '@citesync/document-model';

import { familyToken, stripPunct } from '../citations/authors.js';
import { buildNameKey, isVietnameseFamilyName } from '../normalize/names.js';
import { referenceConfidence, type ReferenceFeatures } from './confidence.js';

/** Year marker: `(2017)`, `(2018a)` (same-author suffix), or `(n.d.)`. */
const YEAR_RE = /\((\d{4})([a-z])?\)|\(n\.?d\.?\)/i;

/**
 * DOI marker: `doi: 10.xxxx/…` or `https://doi.org/…` / `http://dx.doi.org/…`.
 * The capture is the bare DOI value; a trailing sentence period/comma/paren is
 * stripped after capture.
 */
const DOI_RE = /(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)([^\s]+)/i;

/**
 * Container tail: `, Vol(Issue), Pages` | `, Vol, Pages` | `, Pages`, each
 * part optional; `pp.`-prefixed page ranges and en/hyphen dash ranges OK.
 */
const CONTAINER_TAIL_RE =
  /^(.*?)(?:,\s*(\d{1,4})\s*\(\s*(\d{1,4})\s*\)|,\s*(\d{1,4}))?(?:,\s*(?:pp\.?\s*)?(\d[\d\s–—-]*))?\s*\.?\s*$/u;

/** Author-group separators: `;` / `&` / ` and ` / ` và `. */
const AUTHOR_GROUP_SPLIT_RE = /(?:\s*;\s*|\s*&\s*|\s+and\s+|\s+và\s+)/gi;

/** Trailing editor-role marker — `(Ed.)`, `(Eds.)` — not part of the name. */
const EDITOR_MARKER_RE = /\s*\((?:ed|eds)\.?\)\s*$/i;

/** Leading `Family, Given` shape: a single token run, a comma, then content. */
const FAMILY_GIVEN_RE = /^[\p{L}\p{M}][\p{L}\p{M}.'’\-–]*\s*,\s*\S/u;

// ---------------------------------------------------------------------------
// Authors (§21/§24).
// ---------------------------------------------------------------------------

/**
 * Split an author segment into raw author-name groups.
 *
 * `;` / `&` / ` and ` / ` và ` always separate groups. Within a chunk, a
 * leading `Family, Given` shape (single-token surname + comma) means the comma
 * is the family/given separator: `Doe, J., Smith, A.` pairs alternately into
 * `Doe, J.` + `Smith, A.`. Otherwise commas separate family-first full names
 * (`Nguyễn Văn A, Trần Thị B`). Deterministic (R008).
 */
export function splitAuthorGroups(segment: string): string[] {
  const groups: string[] = [];
  for (const chunk of segment.split(AUTHOR_GROUP_SPLIT_RE)) {
    const c = chunk.trim();
    if (c === '') continue;
    if (FAMILY_GIVEN_RE.test(c)) {
      const parts = c
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p !== '');
      for (let i = 0; i < parts.length; i += 2) {
        const fam = parts[i]!;
        const given = parts[i + 1];
        groups.push(given !== undefined ? `${fam}, ${given}` : fam);
      }
    } else {
      for (const part of c.split(',')) {
        const t = part.trim();
        if (t !== '') groups.push(t);
      }
    }
  }
  return groups;
}

/**
 * One author name → §21 `PersonName` with its tiered key (§24/§25).
 *
 * Family segmentation: `Family, Given` splits at the first comma; Vietnamese
 * family-first names (no comma) take the first token as family; Western
 * no-comma names take the last non-initial token via T03's `familyToken`.
 * `key` is built over the full written name (S04 compares full names).
 */
export function personName(raw: string): PersonName {
  const nameOnly = raw.replace(EDITOR_MARKER_RE, '').trim();
  // NOTE: the trailing class deliberately excludes `.` — a trailing period in
  // `Doe, J.` belongs to the initial and must survive segmentation (family /
  // given keep the written form; `stripPunct` cleans family tokens later).
  const clean = nameOnly.replace(/^[\s,;:]+|[\s,;:]+$/gu, '');
  const originalName = nameOnly;

  if (clean === '') {
    return { originalName, family: '', key: buildNameKey(clean) };
  }

  const comma = clean.indexOf(',');
  if (comma !== -1) {
    const fam = clean.slice(0, comma).trim();
    const given = clean.slice(comma + 1).trim();
    return {
      originalName,
      family: fam !== '' ? fam : clean,
      ...(given !== '' ? { given } : {}),
      key: buildNameKey(clean),
    };
  }

  const tokens = clean.split(/\s+/).filter((t) => t !== '');
  if (tokens.length === 1) {
    return {
      originalName,
      family: stripPunct(tokens[0]!),
      key: buildNameKey(clean),
    };
  }
  if (isVietnameseFamilyName(tokens[0]!)) {
    return {
      originalName,
      family: stripPunct(tokens[0]!),
      given: tokens.slice(1).join(' '),
      key: buildNameKey(clean),
    };
  }
  const family = familyToken(clean) ?? stripPunct(tokens[tokens.length - 1]!);
  const given = tokens.slice(0, tokens.length - 1).join(' ');
  return {
    originalName,
    family,
    ...(given !== '' ? { given } : {}),
    key: buildNameKey(clean),
  };
}

// ---------------------------------------------------------------------------
// Entry grammar (§21) + failure isolation (§88).
// ---------------------------------------------------------------------------

/** Strip a trailing period/comma run ("45-60." → "45-60"). */
function stripTrailingPunct(s: string): string {
  return s.replace(/[.,;]+$/u, '').trim();
}

/** Extract the volume/issue/pages tail from a raw container string. */
function splitContainerTail(
  container: string,
): { containerTitle: string; identifiers: Record<string, string> } {
  const identifiers: Record<string, string> = {};
  const m = CONTAINER_TAIL_RE.exec(container);
  if (m === null) return { containerTitle: container, identifiers };
  const [, base, volume, issue, volumeOnly, pages] = m;
  const title = base !== undefined && base.trim() !== '' ? base.trim() : container;
  if (volume !== undefined) identifiers.volume = volume;
  if (issue !== undefined) identifiers.issue = issue;
  if (volumeOnly !== undefined && volume === undefined) {
    identifiers.volume = volumeOnly;
  }
  if (pages !== undefined) identifiers.pages = pages;
  return { containerTitle: stripTrailingPunct(title), identifiers };
}

/**
 * Why an entry does not match the reference grammar — `null` when it parses.
 * The single source of truth shared by `parseReferenceEntry` (→ confidence 0)
 * and T06's `ReferenceParseIssue` recording.
 */
export function describeReferenceParseFailure(text: string): string | null {
  const t = text.trim();
  if (t === '') return 'empty entry text';
  const year = YEAR_RE.exec(t);
  if (year === null) return 'no (YYYY) year marker';
  const authorSeg = t.slice(0, year.index).trim().replace(/[.,;:\s]+$/u, '');
  if (authorSeg === '') return 'no author segment before the year';
  const authors = splitAuthorGroups(authorSeg).map(personName);
  if (authors.length === 0 || authors.every((a) => a.family === '')) {
    return 'no parseable author names';
  }
  return null;
}

/**
 * Parse one bibliography entry into a §21 `ReferenceEntry`.
 *
 * @param text   the entry's block text (`block.text` — the parsing scope).
 * @param index  zero-based position within the bibliography section; derives
 *   the deterministic id `r{index}` (R008, document-order ordinal).
 * @param source the entry's `SourceLocation` (R009 evidence: block + char
 *   offsets; T06 passes the whole block's range).
 * @returns a `ReferenceEntry` — ALWAYS, even on grammar failure
 *   (`parseConfidence: 0`, `raw` preserved, no throw — §88).
 */
export function parseReferenceEntry(
  text: string,
  index: number,
  source: SourceLocation,
): ReferenceEntry {
  const trimmed = text.trim();
  if (describeReferenceParseFailure(trimmed) !== null) {
    return { id: `r${index}`, raw: text, index, source, parseConfidence: 0 };
  }

  const year = YEAR_RE.exec(trimmed)!; // non-null: failure check above passed
  const yearStr = year[1];
  const yearSuffix = year[2];

  // Trailing strip excludes `.`: the final `.` belongs to the last initial
  // ("…, & Johnson, B."), not to sentence punctuation, in this segment.
  const authorSeg = trimmed
    .slice(0, year.index)
    .trim()
    .replace(/[,;:\s]+$/u, '');
  const authors = splitAuthorGroups(authorSeg)
    .map(personName)
    .filter((a) => a.family !== '');

  // Remainder after the year marker: strip the leading `.`/`:`/space, pull
  // out a trailing DOI, then split title / container.
  const remainder = trimmed
    .slice(year.index + year[0].length)
    .replace(/^[.:\s]+/u, '');

  let body = remainder;
  let doi: string | undefined;
  const doiMatch = DOI_RE.exec(remainder);
  if (doiMatch !== null) {
    doi = stripTrailingPunct(doiMatch[1]!);
    body =
      remainder.slice(0, doiMatch.index) +
      remainder.slice(doiMatch.index + doiMatch[0].length);
  }

  // Title = everything up to the LAST `. `; container = the last segment.
  // The negative lookbehind keeps `pp. 45-60`, `vol. 12`, `ed. 2020`,
  // `et al.` intact (no split after the abbreviation's period).
  const segs = body
    .split(/(?<!\b(?:pp|vol|no|ed|eds|et al|al))\.\s+/u)
    .map((s) => s.trim())
    .filter((s) => s !== '');
  let title: string | undefined;
  let container: string | undefined;
  if (segs.length === 1) {
    title = stripTrailingPunct(segs[0]!);
  } else if (segs.length > 1) {
    title = stripTrailingPunct(segs.slice(0, -1).join('. '));
    container = segs[segs.length - 1]!;
  }

  const emptyIdentifiers: Record<string, string> = {};
  const { containerTitle, identifiers } =
    container !== undefined
      ? splitContainerTail(container)
      : { containerTitle: undefined, identifiers: emptyIdentifiers };

  const features: ReferenceFeatures = {
    authorCount: authors.length,
    hasGivenName: authors.some((a) => a.given !== undefined && a.given.trim() !== ''),
    hasYear: yearStr !== undefined,
    hasYearSuffix: yearSuffix !== undefined,
    hasTitle: title !== undefined && title !== '',
    hasContainer: containerTitle !== undefined,
    hasVolume: identifiers.volume !== undefined,
    hasIssue: identifiers.issue !== undefined,
    hasPages: identifiers.pages !== undefined,
    hasDoi: doi !== undefined,
  };

  const entry: ReferenceEntry = {
    id: `r${index}`,
    raw: text,
    index,
    authors,
    ...(yearStr !== undefined ? { year: Number(yearStr) } : {}),
    ...(yearSuffix !== undefined ? { yearSuffix } : {}),
    ...(title !== undefined ? { title } : {}),
    ...(containerTitle !== undefined ? { containerTitle } : {}),
    ...(doi !== undefined ? { doi } : {}),
    ...(Object.keys(identifiers).length > 0 ? { identifiers } : {}),
    source,
    parseConfidence: referenceConfidence(features),
  };
  return entry;
}
