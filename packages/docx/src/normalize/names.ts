/**
 * T02 — diacritic-aware tiered name normalization primitives (R006/§24).
 *
 * Pure, deterministic functions (R008) that produce the three stored tiers of
 * `PersonNameKey` from `@citesync/document-model`:
 *
 *   - `exact`                — tier 1–2: normalized, DIACRITIC-PRESERVING
 *                              (Nguyễn ≠ Nguyen);
 *   - `diacriticInsensitive` — tier 3: diacritic-stripped SECONDARY signal.
 *                              MUST NOT override `exact` (documented in §5d) —
 *                              this key exists only so a tier-3 fallback match
 *                              can be *reported*, never to replace a tier-1/2
 *                              decision;
 *   - `initials`             — tier 4: initial-compatible (e.g. `Nguyễn Văn A`
 *                              → `nva`, matches `Nguyen Van A` → `nva`).
 *
 * Everything here is string-in / string-out with no I/O, no state, and no
 * locale-sensitive calls (plain `toLowerCase()`, never `toLocaleLowerCase()`,
 * which depends on the host locale and would break R008 determinism).
 */

import type { PersonNameKey } from '@citesync/document-model';

/**
 * Remove characters that act as punctuation inside a name. Uses the Unicode
 * `\p{P}` (Punctuation) category; letters such as Đ (U+0110) and đ (U+0111)
 * are category L* and are never removed. A hyphenated name therefore merges
 * (`Nguyen-Van` → `nguyenvan`) while `O'Brien` → `obrien` — deterministic
 * across engines because `\p{P}` is a stable Unicode property.
 */
const PUNCTUATION_RE = /\p{P}+/gu;

/**
 * Collapse any run of whitespace to a single space and trim edges.
 */
const WHITESPACE_RE = /\s+/gu;

/**
 * Tier 1–2 key: lower-case (plain, deterministic), Unicode NFC, punctuation
 * removed, whitespace collapsed — but diacritics PRESERVED.
 *
 * `Nguyễn` (any of its equivalent NFD/NFC spellings) → `nguyễn`, which never
 * equals `nguyen`. Deterministic: plain `toLowerCase()` uses the Unicode
 * default case mapping, independent of host locale (unlike
 * `toLocaleLowerCase()`).
 */
export function normalizeIdentityName(raw: string): string {
  return raw
    .normalize('NFC')
    .toLowerCase()
    .replace(PUNCTUATION_RE, '')
    .replace(WHITESPACE_RE, ' ')
    .trim();
}

/**
 * Tier 3 key: NFD-decompose → drop every combining mark (`\p{M}`) → NFC.
 *
 * Documented secondary-signal decision (§5d): Đ (U+0110) and đ (U+0111) have
 * NO canonical decomposition, so they survive stripping untouched — this
 * module deliberately does NOT collapse Đ/đ to d. The Vietnamese phoneme
 * distinction (đ vs d) is meaningful; treating it as removable would silently
 * merge distinct surnames. ư/ơ (horn letters) and ă (breve) DO decompose via
 * NFD, so their marks are stripped: ư → u, ơ → o, ă → a.
 */
export function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/\p{M}+/gu, '').normalize('NFC');
}

/**
 * Tier 4 key: initial-compatible form of a name.
 *
 * Pipeline: normalizeIdentityName → stripDiacritics → first char of each
 * whitespace token, lower-cased, joined without separator. Building on the
 * diacritic-stripped signal makes initials interoperable across spellings
 * (`Nguyễn Văn A` and `Nguyen Van A` both → `nva`), which is exactly the
 * "initial-compatible" matching intent of tier 4. Empty/blank input yields
 * the empty string (matches nothing by equality).
 */
export function initialsKey(s: string): string {
  const normalized = stripDiacritics(normalizeIdentityName(s));
  if (normalized === '') return '';
  return normalized
    .split(' ')
    .map((token) => token.charAt(0))
    .join('');
}

/**
 * Build the three stored tiers of a `PersonNameKey` from a raw name string.
 *
 * `exact` is the authoritative tier (tiers 1–2): a tier-3 diacritic-insensitive
 * match must be reported as a *fallback*, never promoted over an `exact`
 * mismatch (the §5d non-overriding rule). `initials` is tier 4 only; tier 5
 * fuzzy matching is S04's responsibility and has no stored key.
 */
export function buildNameKey(raw: string): PersonNameKey {
  const exact = normalizeIdentityName(raw);
  return {
    exact,
    diacriticInsensitive: stripDiacritics(exact),
    initials: initialsKey(raw),
  };
}

/**
 * Common Vietnamese family (surname) names, written with diacritics for
 * readability; comparison below is diacritic- and case-insensitive so the
 * list stays spelling-agnostic (Trần/Trân/Tran all hit).
 *
 * Family-first ordering is the default for Vietnamese names ("Nguyễn Văn A":
 * family = Nguyễn, given = Văn A); this helper lets T03/T05 decide whether a
 * surname token is Vietnamese without hardcoding parsing order.
 */
const VIETNAMESE_FAMILY_NAMES = [
  'Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ',
  'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý', 'Đinh', 'Tạ', 'Hà',
  'Trịnh', 'Đoàn', 'Mai', 'Tô', 'Cao', 'Lâm', 'Châu', 'Thái', 'Phùng',
];

/**
 * True when `name` (a single surname token) matches a common Vietnamese
 * family name, compared case- and diacritic-insensitively. Optional helper —
 * heuristic only, never a hard gate (an unknown Vietnamese surname still
 * parses; family-first is the fallback posture for §21/§24 handling).
 */
export function isVietnameseFamilyName(name: string): boolean {
  const key = stripDiacritics(normalizeIdentityName(name));
  if (key === '') return false;
  return VIETNAMESE_FAMILY_NAMES.some((family) => {
    return stripDiacritics(normalizeIdentityName(family)) === key;
  });
}
