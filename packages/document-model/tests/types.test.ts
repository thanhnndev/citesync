/**
 * Contract test (T01 done-when): a downstream consumer can import the §21
 * reference-record types from the public `@citesync/document-model` barrel.
 *
 * The type-only import below is the actual contract check — it fails at
 * typecheck time if the barrel stops exporting any of these names. The
 * runtime assertions prove the package boundary resolves end-to-end
 * (exports map → dist) and spot-check the structural shapes S03/S04 depend
 * on.
 */
import { describe, expect, it } from 'vitest';
import * as model from '@citesync/document-model';
import type {
  PersonName,
  PersonNameKey,
  ReferenceEntry,
  ReferenceParseIssue,
} from '@citesync/document-model';

// Type-level structural spot-checks (erased at runtime; enforced when this
// file is typechecked, e.g. via npx tsc --noEmit on the test file).
const _keyTierCheck: PersonNameKey = {
  exact: 'nguyen van a',
  diacriticInsensitive: 'nguyen van a',
  initials: 'n v a',
};
const _personCheck: PersonName = {
  originalName: 'Nguyễn Văn A',
  family: 'nguyễn',
  given: 'văn a',
  key: _keyTierCheck,
};
const _entryCheck: ReferenceEntry = {
  id: 'r0',
  raw: 'Doe, J. (2017). Citation practice in digital documents.',
  index: 0,
  authors: [
    {
      originalName: 'Doe, J.',
      family: 'doe',
      given: 'j',
      key: { exact: 'doe j', diacriticInsensitive: 'doe j', initials: 'd j' },
    },
  ],
  year: 2017,
  title: 'Citation practice in digital documents.',
  identifiers: { volume: '12', issue: '3', pages: '45-60' },
  source: { blockId: 'doc-p5' },
  parseConfidence: 0.9,
};
const _issueCheck: ReferenceParseIssue = {
  blockId: 'doc-p6',
  index: 1,
  raw: 'Not a reference at all',
  code: 'reference-parse',
  message: 'reference grammar failed',
};

// Negative compile-time checks (Q7): malformed shapes MUST be rejected by
// tsc. Verified via the standalone `npx tsc --noEmit` run on this file — an
// unused @ts-expect-error (i.e. the malformed shape accidentally becoming
// valid) fails that typecheck.
function _acceptEntry(_e: ReferenceEntry): void {}
function _acceptKey(_k: PersonNameKey): void {}
// @ts-expect-error parseConfidence must be a number, not a string
_acceptEntry({ id: 'r0', raw: 'x', source: { blockId: 'b' }, parseConfidence: 'high' });
// @ts-expect-error source is required on ReferenceEntry (§21)
_acceptEntry({ id: 'r0', raw: 'x', parseConfidence: 0.5 });
// @ts-expect-error diacriticInsensitive tier is required (§25)
_acceptKey({ exact: 'a', initials: 'a' });

describe('@citesync/document-model §21 reference contract', () => {
  it('resolves the package boundary and exposes the barrel', () => {
    // `model` is the runtime module (types-only → empty namespace object);
    // importable means the exports map + dist build are intact.
    expect(model).toBeDefined();
  });

  it('ReferenceEntry carries the §21 fields verbatim', () => {
    expect(_entryCheck.id).toBe('r0');
    expect(_entryCheck.index).toBe(0);
    expect(_entryCheck.year).toBe(2017);
    expect(_entryCheck.parseConfidence).toBe(0.9);
    // §21 has no page field — volume/issue/pages fold into identifiers (D012).
    expect(_entryCheck.identifiers).toEqual({
      volume: '12',
      issue: '3',
      pages: '45-60',
    });
  });

  it('PersonNameKey preserves the §24/§25 tiers', () => {
    expect(_keyTierCheck).toEqual({
      exact: 'nguyen van a',
      diacriticInsensitive: 'nguyen van a',
      initials: 'n v a',
    });
  });

  it('ReferenceParseIssue carries entry-scoped failure context', () => {
    expect(_issueCheck.code).toBe('reference-parse');
    expect(_issueCheck.blockId).toBe('doc-p6');
    expect(_issueCheck.raw).toBe('Not a reference at all');
  });
});
