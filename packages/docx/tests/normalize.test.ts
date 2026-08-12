/**
 * S03-T02 — diacritic-aware tiered name normalization proof (R006/§24, R008).
 *
 * Locks the exact done-when contract:
 *  - `Nguyễn` (NFC) ≠ `Nguyen` at the `exact` tier (diacritics PRESERVED);
 *  - `stripDiacritics` makes them equal as the tier-3 SECONDARY key — which
 *    must never override `exact` (§5d);
 *  - ư/ơ/ă decompose and strip; đ/Đ do NOT (phonemic, no canonical
 *    decomposition — deliberately preserved);
 *  - plain `toLowerCase()` determinism (locale-independent), so R008 holds;
 *  - `buildNameKey` emits exactly the 3-tier `PersonNameKey` shape.
 *
 * Negative coverage (Q7): empty/whitespace/punctuation-only inputs, đ-preserve
 * boundary, non-Vietnamese surname rejection, NFD-form equivalence.
 */

import { describe, expect, it } from 'vitest';
import {
  buildNameKey,
  initialsKey,
  isVietnameseFamilyName,
  normalizeIdentityName,
  stripDiacritics,
} from '../src/normalize/index.js';

describe('normalizeIdentityName (tier 1–2, diacritic-preserving)', () => {
  it('preserves diacritics: Nguyễn (NFC) !== Nguyen (exact tier)', () => {
    const nguyenNfc = normalizeIdentityName('Nguyễn');
    const nguyenPlain = normalizeIdentityName('Nguyen');
    expect(nguyenNfc).toBe('nguyễn');
    expect(nguyenPlain).toBe('nguyen');
    expect(nguyenNfc).not.toBe(nguyenPlain);
  });

  it('is spelling-form independent: NFD and NFC inputs yield the same key', () => {
    const nfc = 'Nguyễn Văn A'.normalize('NFC');
    const nfd = 'Nguyễn Văn A'.normalize('NFD');
    expect(normalizeIdentityName(nfc)).toBe(normalizeIdentityName(nfd));
    expect(normalizeIdentityName(nfc)).toBe('nguyễn văn a');
  });

  it('collapses whitespace, removes punctuation, trims', () => {
    expect(normalizeIdentityName('  O\'Brien,   John  ')).toBe('obrien john');
    expect(normalizeIdentityName('Nguyen-Van')).toBe('nguyenvan');
    expect(normalizeIdentityName('  de   la  Cruz. ')).toBe('de la cruz');
  });

  it('is deterministic across repeated calls (R008)', () => {
    const input = 'Đỗ  Văn, Phạm';
    const first = normalizeIdentityName(input);
    for (let i = 0; i < 20; i++) {
      expect(normalizeIdentityName(input)).toBe(first);
    }
  });

  it('uses locale-independent toLowerCase (Turkish-İ stable)', () => {
    // Plain toLowerCase follows the Unicode default mapping regardless of
    // host locale; 'İ' lowercases to 'i\u0307' (i + combining dot) — the same
    // bytes on every engine. toLocaleLowerCase() with a tr-TR locale would
    // produce 'istanbul' (dotless i); we deliberately use the locale-free
    // mapping so R008 determinism holds. The combining dot survives because
    // normalizeIdentityName preserves diacritics by contract.
    expect(normalizeIdentityName('İSTANBUL')).toBe('i\u0307stanbul');
    expect(normalizeIdentityName('İSTANBUL')).toBe(
      normalizeIdentityName('İSTANBUL'),
    );
    expect(normalizeIdentityName('SMITH')).toBe(normalizeIdentityName('Smith'));
  });
});

describe('stripDiacritics (tier 3, secondary signal)', () => {
  it('makes Nguyễn and Nguyen equal as a SECONDARY key', () => {
    expect(stripDiacritics(normalizeIdentityName('Nguyễn'))).toBe(
      normalizeIdentityName('Nguyen'),
    );
  });

  it('handles ư/ơ/ă (NFD-decomposable Vietnamese letters)', () => {
    expect(stripDiacritics('ư')).toBe('u');
    expect(stripDiacritics('ơ')).toBe('o');
    expect(stripDiacritics('ă')).toBe('a');
    expect(stripDiacritics('Ă')).toBe('A');
    expect(stripDiacritics('Nguyễn Văn A')).toBe('Nguyen Van A');
  });

  it('preserves đ/Đ — MUST NOT collapse to d (phonemic, §5d)', () => {
    expect(stripDiacritics('đ')).toBe('đ');
    expect(stripDiacritics('Đ')).toBe('Đ');
    expect(stripDiacritics('Đặng')).toBe('Đang');
    // ỗ (o + circumflex + tilde) NFD-decomposes and strips to 'o'; only the
    // Đ survives. Distinct surnames stay distinct even at tier 3: Đỗ → 'Đo'
    // vs Do — the phonemic Đ/d boundary is preserved.
    expect(stripDiacritics('Đỗ')).toBe('Đo');
    expect(stripDiacritics('Đỗ')).not.toBe('Do');
  });

  it('is idempotent', () => {
    expect(stripDiacritics(stripDiacritics('Nguyễn ư ơ ă'))).toBe(
      stripDiacritics('Nguyễn ư ơ ă'),
    );
  });

  it('handles empty and mark-only input', () => {
    expect(stripDiacritics('')).toBe('');
    // A lone combining mark (U+0300) has no base letter left after NFD-drop.
    expect(stripDiacritics('\u0300')).toBe('');
  });
});

describe('initialsKey (tier 4, initial-compatible)', () => {
  it('builds lowercase first-letter initials per whitespace token', () => {
    expect(initialsKey('Nguyễn Văn A')).toBe('nva');
    expect(initialsKey('Nguyen Van A')).toBe('nva');
  });

  it('is diacritic- and case-insensitive across spellings', () => {
    expect(initialsKey('TRẦN  Quốc')).toBe('tq');
    expect(initialsKey('Tran Quoc')).toBe('tq');
  });

  it('handles punctuation in the source name', () => {
    expect(initialsKey('Smith, John')).toBe('sj');
  });

  it('returns "" for empty/whitespace-only input (matches nothing)', () => {
    expect(initialsKey('')).toBe('');
    expect(initialsKey('   ')).toBe('');
  });
});

describe('buildNameKey (PersonNameKey 3-tier shape)', () => {
  it('returns exactly { exact, diacriticInsensitive, initials }', () => {
    const key = buildNameKey('Nguyễn Văn A');
    expect(Object.keys(key).sort()).toEqual([
      'diacriticInsensitive',
      'exact',
      'initials',
    ]);
    expect(key.exact).toBe('nguyễn văn a');
    expect(key.diacriticInsensitive).toBe('nguyen van a');
    expect(key.initials).toBe('nva');
  });

  it('keeps exact authoritative while tier 3 equals across spellings', () => {
    const a = buildNameKey('Nguyễn');
    const b = buildNameKey('Nguyen');
    expect(a.exact).not.toBe(b.exact); // tier 1–2 mismatch must be reportable
    expect(a.diacriticInsensitive).toBe(b.diacriticInsensitive); // tier 3 fallback
  });

  it('preserves đ at every tier (exact + diacriticInsensitive)', () => {
    const key = buildNameKey('Đặng');
    expect(key.exact).toBe('đặng');
    expect(key.diacriticInsensitive).toBe('Đang'.toLowerCase()); // 'đang'
  });
});

describe('isVietnameseFamilyName (optional helper)', () => {
  it('recognizes common Vietnamese surnames case/diacritic-insensitively', () => {
    expect(isVietnameseFamilyName('Nguyễn')).toBe(true);
    expect(isVietnameseFamilyName('nguyen')).toBe(true);
    expect(isVietnameseFamilyName('TRẦN')).toBe(true);
    expect(isVietnameseFamilyName('Đặng')).toBe(true);
    expect(isVietnameseFamilyName('Pham')).toBe(true);
  });

  it('rejects non-Vietnamese and empty surnames (Q7 negative)', () => {
    expect(isVietnameseFamilyName('Smith')).toBe(false);
    expect(isVietnameseFamilyName('')).toBe(false);
    expect(isVietnameseFamilyName('   ')).toBe(false);
    // A Vietnamese-matching token embedded in a longer name is NOT a surname.
    expect(isVietnameseFamilyName('Nguyễn Văn')).toBe(false);
  });
});

describe('buildNameKey determinism (R008)', () => {
  it('repeated builds are deep-equal', () => {
    const first = buildNameKey('Phạm Quốc Hùng');
    for (let i = 0; i < 10; i++) {
      expect(buildNameKey('Phạm Quốc Hùng')).toEqual(first);
    }
  });
});
