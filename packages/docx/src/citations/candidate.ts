/**
 * S03-T03 — citation candidate detection (R005/§18, plain-text tier 4 of §23).
 *
 * The plain-text fallback detector scans a block's text for two structural
 * shapes ONLY:
 *
 *   1. Parenthetical regions `( ... )` — balanced, nesting-aware.
 *   2. Narrative regions `Author (year)` / `Author (n.d.)` — a paren whose
 *      content is a bare year/date AND which is immediately preceded by a
 *      plausible author-name prefix.
 *
 * EXPLICIT OVER-MATCH GUARD (documented policy, §18/§23 conservative rule):
 * a citation REQUIRES a parenthetical form OR a narrative `Name (year)` where
 * `(` directly follows the name. A bare `Smith 2024.` (no parens at all) is
 * therefore NEVER a candidate, and the numeric family `[1]` (square brackets)
 * is structurally excluded (M002 — numeric parsing is out of S03 scope).
 *
 * The name-prefix scan walks left from `(` over name characters (letters,
 * combining marks, spaces, commas, `&`, hyphens, apostrophes, periods for
 * initials/`et al.`) and STOPS at a small set of prose stopwords (English +
 * Vietnamese discourse markers: "in", "of", "cited", "theo", "của", ...) so a
 * phrase like "Research & Development cited in Le (2023)" yields prefix "Le",
 * not the whole sentence. Word-level plausibility (capitalization, stopword
 * rejection) is the grammar's job (`grammar.ts`); this module is purely
 * structural and deterministic (R008).
 *
 * All offsets are CHARACTER offsets into `block.text` (S01 offset semantics:
 * end-exclusive, UTF-16 code units), so `text.slice(startOffset, endOffset)`
 * round-trips exactly (R009).
 */

/** A balanced `( ... )` region with its text-relative offsets. */
export interface ParentheticalRegion {
  /** Character offset of the opening `(`. */
  openOffset: number;
  /** Character offset one PAST the closing `)` (exclusive). */
  closeOffset: number;
  /** Character offset of the first content char (openOffset + 1). */
  innerStart: number;
  /** Character offset one past the last content char (closeOffset - 1). */
  innerEnd: number;
  /** The text between the parens: `text.slice(innerStart, innerEnd)`. */
  inner: string;
}

/**
 * One detected candidate: a parenthetical region plus the name-like prefix
 * immediately preceding it (empty for parenthetical-only candidates).
 */
export interface CitationCandidate {
  region: ParentheticalRegion;
  /**
   * The whitespace-normalized name prefix directly before `(` (may be '').
   * "Anderson, Brown, and Clark" for `Anderson, Brown, and Clark (2018)`.
   */
  prefix: string;
  /**
   * Character offset where `prefix` starts inside the block text; equals
   * `region.openOffset` when `prefix` is empty. The narrative citation's raw
   * region is `[prefixStart, closeOffset)`.
   */
  prefixStart: number;
}

/** Whitespace includes NBSP (\u00A0) which Word loves to emit. */
function isWhitespace(ch: string): boolean {
  return /\s/u.test(ch);
}

/**
 * Prose words that TERMINATE the backward name-prefix scan. These are words
 * that separate a citation name from the rest of the sentence ("cited in Le",
 * "According to Johnson", "Nghiên cứu của Trần Thị B"). `and`/`or`/`và` are
 * deliberately NOT here — they are author-list separators that must keep the
 * scan going ("Pham and Nguyen (2017)", "Anderson, Brown, and Clark (2018)").
 * `et`/`al` are also excluded — "Nguyen et al. (2019)" must survive intact.
 */
export const SCAN_STOPWORDS: ReadonlySet<string> = new Set([
  // English discourse/preposition words
  'in', 'of', 'for', 'on', 'at', 'by', 'with', 'from', 'to', 'as', 'this',
  'that', 'these', 'those', 'see', 'cf', 'e.g', 'i.e', 'etc', 'per', 'pp',
  'according', 'cited', 'discussed', 'mentioned', 'follow', 'following',
  'respectively', 'summarized', 'reported',
  // Common-noun false-positive guards
  'figure', 'fig', 'table', 'section', 'chapter', 'research', 'study',
  'studies', 'data', 'note', 'notes', 'results', 'result', 'appendix',
  'supplement', 'page', 'pages',
  // Vietnamese discourse markers (trích dẫn lồng trong câu)
  'theo', 'xem', 'thêm', 'trong', 'của', 'nghiên', 'cứu', 'về', 'cho',
  'với', 'từ', 'trên', 'tại', 'qua', 'chương', 'trang', 'hình', 'bảng',
  'mục', 'phần', 'luận', 'án', 'tiến', 'sĩ', 'tài', 'liệu', 'tham',
  'khảo', 'như', 'được', 'đã', 'sẽ',
]);

/**
 * Normalize a token for stopword comparison: plain lowercase (locale-free,
 * R008) and strip trailing periods/commas ("cf." → "cf", "J." → "j").
 */
export function stripForStopword(word: string): string {
  return word.toLowerCase().replace(/[.,]+$/u, '');
}

/** True when `word` is a prose scan-terminator. */
export function isScanStopword(word: string): boolean {
  return SCAN_STOPWORDS.has(stripForStopword(word));
}

/**
 * Find every balanced `( ... )` region, nesting-aware, using a paren stack.
 * Emission order is by OPEN offset (document order) — regions are sorted
 * after collection so occurrence ids stay deterministic (R008). An
 * unbalanced `(` with no matching `)` yields no region (conservative).
 */
export function findParentheticalRegions(text: string): ParentheticalRegion[] {
  const regions: ParentheticalRegion[] = [];
  const stack: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '(') {
      stack.push(i);
    } else if (ch === ')') {
      const open = stack.pop();
      if (open !== undefined) {
        regions.push({
          openOffset: open,
          closeOffset: i + 1,
          innerStart: open + 1,
          innerEnd: i,
          inner: text.slice(open + 1, i),
        });
      }
    }
  }
  return regions.sort((a, b) => a.openOffset - b.openOffset);
}

/**
 * Backward name-prefix scan from `(`. Skips leading whitespace, collects the
 * maximal run of name characters, then trims prose stopwords from the LEFT
 * (outermost) end so the kept prefix is the name directly preceding the paren.
 * Returns `{ prefix: '', prefixStart: openOffset }` when nothing name-like
 * precedes the paren.
 */
export function scanNamePrefix(
  text: string,
  openOffset: number,
): { prefix: string; prefixStart: number } {
  const empty = { prefix: '', prefixStart: openOffset };

  let end = openOffset;
  while (end > 0 && isWhitespace(text[end - 1]!)) end--;
  if (end === 0) return empty;

  // Maximal backward run of name characters immediately before the paren.
  const head = text.slice(0, end);
  const m = head.match(/[\p{L}\p{M}\u00A0 ,.&'’\-–]+$/u);
  if (m === null || m[0] === '') return empty;
  const raw = m[0];
  const rawStart = end - raw.length;

  // Tokenize the run; the scan stops at the stopword CLOSEST to the paren
  // (largest token index), everything after it is the kept name.
  const tokens: Array<{ word: string; start: number }> = [];
  for (const match of raw.matchAll(/\S+/gu)) {
    tokens.push({ word: match[0], start: rawStart + match.index });
  }
  let keepFrom = 0;
  for (let k = tokens.length - 1; k >= 0; k--) {
    if (isScanStopword(tokens[k]!.word)) {
      keepFrom = k + 1;
      break;
    }
  }
  if (keepFrom >= tokens.length) return empty;
  let kept = tokens.slice(keepFrom);
  // Drop a leading run of pure separator tokens ("and", "&", ...) so the
  // prefix always starts with a name: for "Smith (2020) and (Lee, 2019)" the
  // second region's prefix is '' (parenthetical — the grammar ignores it).
  while (kept.length > 0 && isAuthorSeparator(kept[0]!.word)) kept = kept.slice(1);
  if (kept.length === 0) return empty;
  return {
    prefix: kept.map((t) => t.word).join(' '),
    prefixStart: kept[0]!.start,
  };
}

/** True when a token is a pure author-list separator ("and", "&", ...). */
function isAuthorSeparator(word: string): boolean {
  return /^(&|,|and|or|và|hay|hoặc)$/i.test(word);
}

/**
 * Enumerate all citation candidates of a block text: every parenthetical
 * region, each decorated with its narrative name-prefix. The grammar decides
 * which candidates are real citations. Deterministic (R008).
 */
export function findCitationCandidates(text: string): CitationCandidate[] {
  return findParentheticalRegions(text).map((region) => {
    const { prefix, prefixStart } = scanNamePrefix(text, region.openOffset);
    return { region, prefix, prefixStart };
  });
}
