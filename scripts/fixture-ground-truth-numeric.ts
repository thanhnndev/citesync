/**
 * M002-S01 (T4) — D016 numeric index map ground truth (KNOWN_NUMERIC_INDEX_MAP).
 *
 * Expected bracket→bibliography index bindings per numeric fixture, in
 * document order (c0.., r0..): every numeric citation occurrence's per-index
 * token bindings (resolved -> entries[index-1] by ORDERED INDEX / out-of-range
 * / unmatched — the conservative D016 surface, never silently guessed).
 *
 * Consumed by `packages/docx/tests/numeric-fixture.test.ts` (deep-equal drift
 * guard) and `scripts/make-fixtures.ts` (README manifest rendering).
 * Pure data — imports only the shared row types (erased at runtime).
 */

import type {
  KnownNumericCitationMap,
  KnownNumericIndexMap,
  KnownNumericToken,
} from './fixture-ground-truth.js';

const T = (o: KnownNumericToken): KnownNumericToken => o;
const R = (o: KnownNumericCitationMap): KnownNumericCitationMap => o;
const M = (o: KnownNumericIndexMap): KnownNumericIndexMap => o;

/** Compact builder: a resolved token bound to `entries[index-1]` by index. */
const r = (index: number, resolvedEntryId: string): KnownNumericToken =>
  T({ index, status: 'resolved', resolvedEntryId });

/** Compact builder: an index beyond the ordered entries (surfaced, D016). */
const oor = (index: number): KnownNumericToken => T({ index, status: 'out-of-range' });

/** Compact builder: an index below the 1-based system (e.g. [0]) — surfaced. */
const un = (index: number): KnownNumericToken => T({ index, status: 'unmatched' });

/**
 * Expected D016 numeric index maps per numeric fixture, in document order.
 * Authored from the real pipeline (verified against parseDocument) — any
 * change to the fixture bytes, the model shape, the grammar or the mapping
 * pass drifts these rows and numeric-fixture.test.ts fails.
 */
export const KNOWN_NUMERIC_INDEX_MAP: Record<string, KnownNumericIndexMap> = {
  // [1] -> entries[0]=r0, [1,2] -> r0,r1 by ORDERED INDEX (D016, never
  // author/year scoring); the entry tails are author-date, not numeric, so
  // only the two body brackets produce rows.
  'numeric/basic.docx': M({
    version: 1,
    citations: [
      R({ citationId: 'c0', tokens: [r(1, 'r0')] }),
      R({ citationId: 'c1', tokens: [r(1, 'r0'), r(2, 'r1')] }),
    ],
  }),

  // Ranges EXPAND per index value (D016): [1-4] -> four bindings r0..r3;
  // [1,2,4-5] -> r0,r1 + the 4-5 range -> r3,r4.
  'numeric/ranges.docx': M({
    version: 1,
    citations: [
      R({ citationId: 'c0', tokens: [r(1, 'r0'), r(2, 'r1'), r(3, 'r2'), r(4, 'r3')] }),
      R({ citationId: 'c1', tokens: [r(1, 'r0'), r(2, 'r1'), r(4, 'r3'), r(5, 'r4')] }),
    ],
  }),

  // Multiple adjacent brackets — each bracket is its own occurrence with
  // distinct regions (§20): [1][2,3] plus a trailing [4].
  'numeric/multiple-brackets.docx': M({
    version: 1,
    citations: [
      R({ citationId: 'c0', tokens: [r(1, 'r0')] }),
      R({ citationId: 'c1', tokens: [r(2, 'r1'), r(3, 'r2')] }),
      R({ citationId: 'c2', tokens: [r(4, 'r3')] }),
    ],
  }),

  // Conservative surface (D016, §79): [1] resolves to r0; [5] (index > 3
  // entries) is out-of-range; [0] (below the 1-based system) is unmatched —
  // both surfaced explicitly, never silently dropped or guessed.
  'numeric/out-of-range.docx': M({
    version: 1,
    citations: [
      R({ citationId: 'c0', tokens: [r(1, 'r0')] }),
      R({ citationId: 'c1', tokens: [oor(5)] }),
      R({ citationId: 'c2', tokens: [un(0)] }),
    ],
  }),

  // Malformed [1, x] is NEVER half-emitted (R007): the map covers exactly the
  // emitted numeric citations — only the clean [3] (bound to r2 = entries[2]).
  'numeric/malformed.docx': M({
    version: 1,
    citations: [R({ citationId: 'c0', tokens: [r(3, 'r2')] })],
  }),

  // M004-S02 (T5): failure-isolation demo — ONE document carries the clean
  // [1] beside the malformed [1, x]: only the clean bracket emits a row, and
  // it binds POSITIONALLY to entries[0] = r0 — the garbage entry itself, the
  // exact isolation surface (even a garbage entry never crashes the pass).
  'isolation/garbage-and-malformed.docx': M({
    version: 1,
    citations: [R({ citationId: 'c0', tokens: [r(1, 'r0')] })],
  }),
};
