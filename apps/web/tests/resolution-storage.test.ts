/**
 * R013 (S03-T2) — guarded sessionStorage + file-scoped resolution state
 * (node env, no DOM, no sessionStorage global).
 *
 * Covers the T2 DONE-WHEN contract:
 *   - stub-store round-trip (save → load → deep-equal), Map-based stub —
 *     the S02 stub-Worker pattern applied to storage;
 *   - load/save NO-OP without crashing when sessionStorage is undefined
 *     (the node env has no global — pinned below);
 *   - file-collision: a resolution recorded for file A never surfaces for
 *     file B (bucket isolation — the top correctness trap);
 *   - same-file re-analysis re-applies the stored bucket (the e2e
 *     reload-persistence leg depends on this: hydrate + set-file re-join);
 *   - malformed / absent stored JSON → empty map (the try/catch path);
 *   - reducer semantics: resolve upserts per citationId (last wins), clear
 *     empties the ACTIVE file's bucket, every transition returns new objects
 *     (never mutates the input map — same discipline as applyResolutions).
 *
 * The hook itself is a thin wiring layer over `resolutionReducer` +
 * storage: its on-mount hydration, fileScope follow and persist effects are
 * covered here via the pure reducer (node-testable) and end-to-end by the
 * T5 resolution.spec.ts production-build e2e.
 */

import { describe, expect, it } from 'vitest';
import type { SessionResolution } from '../src/resolutions/resolutions';
import {
  RESOLUTIONS_STORAGE_KEY,
  clearFileResolutions,
  loadResolutionMap,
  resolutionsForFile,
  saveResolutionMap,
  upsertResolution,
  type ResolutionMap,
  type ResolutionStore,
} from '../src/resolutions/storage';
import {
  INITIAL_RESOLUTION_STATE,
  resolutionReducer,
  type ResolutionState,
} from '../src/hooks/useResolutions';

/** A Map-backed Storage stub — injectable into load/save (node has no sessionStorage). */
function stubStore(
  seed?: Record<string, string>,
): { store: ResolutionStore; read: () => Map<string, string> } {
  const data = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    store: {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        data.set(key, value);
      },
    },
    read: () => data,
  };
}

const RES_A = { citationId: 'c0', chosenEntryId: 'r0' } satisfies SessionResolution;
const RES_B = { citationId: 'c0', chosenEntryId: 'r1' } satisfies SessionResolution;

/** A settled reducer state with the given bucket for the active file. */
function settledState(buckets: ResolutionMap, fileScope: string | undefined): ResolutionState {
  return {
    fileScope,
    buckets,
    resolutions: resolutionsForFile(buckets, fileScope),
    hydrated: true,
  };
}

// ---------------------------------------------------------------------------
// Storage: stub-store round-trip + guarded access.
// ---------------------------------------------------------------------------

describe('storage — stub-store round-trip', () => {
  it('save → load returns the full per-file map (multiple buckets, multiple resolutions)', () => {
    const { store, read } = stubStore();
    const map: ResolutionMap = {
      'a.docx': [RES_A],
      'b.docx': [RES_B, { citationId: 'c1', chosenEntryId: 'r0' }],
    };

    saveResolutionMap(map, store);

    // The single key holds the whole map as JSON.
    expect(read().get(RESOLUTIONS_STORAGE_KEY)).toBe(JSON.stringify(map));
    expect(loadResolutionMap(store)).toEqual(map);
  });

  it('load on an empty store → empty map', () => {
    const { store } = stubStore();
    expect(loadResolutionMap(store)).toEqual({});
  });

  it('save overwrites the previous map under the same key', () => {
    const { store } = stubStore();
    saveResolutionMap({ 'a.docx': [RES_A] }, store);
    saveResolutionMap({ 'b.docx': [RES_B] }, store);
    const loaded = loadResolutionMap(store);
    expect(Object.keys(loaded)).toEqual(['b.docx']);
    expect(loaded['a.docx']).toBeUndefined();
  });
});

describe('storage — guarded access (no sessionStorage global in node)', () => {
  it('pins the environment: sessionStorage is undefined here', () => {
    // The defaultStore() guard has a real job in this test env.
    expect(typeof sessionStorage).toBe('undefined');
  });

  it('loadResolutionMap() with no store → empty map, no crash', () => {
    expect(loadResolutionMap()).toEqual({});
  });

  it('saveResolutionMap() with no store → silent no-op, no crash', () => {
    expect(() => saveResolutionMap({ 'a.docx': [RES_A] })).not.toThrow();
  });
});

describe('storage — malformed / absent stored JSON → empty map (try/catch path)', () => {
  it('getItem throws (private mode / sandboxed iframe) → empty map, no crash', () => {
    const store: ResolutionStore = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {},
    };
    expect(loadResolutionMap(store)).toEqual({});
  });

  it('stored value is not valid JSON → empty map', () => {
    const { store } = stubStore({ [RESOLUTIONS_STORAGE_KEY]: 'not-json{{{' });
    expect(loadResolutionMap(store)).toEqual({});
  });

  it('stored value is JSON with a non-object top level → empty map', () => {
    const { store } = stubStore({ [RESOLUTIONS_STORAGE_KEY]: JSON.stringify([RES_A]) });
    expect(loadResolutionMap(store)).toEqual({});
  });

  it('malformed entries are dropped; empty buckets are omitted; valid ones survive', () => {
    const { store } = stubStore({
      [RESOLUTIONS_STORAGE_KEY]: JSON.stringify({
        'good.docx': [RES_A],
        'mixed.docx': [RES_B, { citationId: 42, chosenEntryId: 'r0' }, null, 'x'],
        'junk.docx': 'not-an-array',
        'empty.docx': [],
      }),
    });
    expect(loadResolutionMap(store)).toEqual({
      'good.docx': [RES_A],
      'mixed.docx': [RES_B],
    });
  });

  it('setItem throws (quota exceeded / private mode) → save is a silent no-op', () => {
    const store: ResolutionStore = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(() => saveResolutionMap({ 'a.docx': [RES_A] }, store)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// File-scoped bucket isolation (the top correctness trap).
// ---------------------------------------------------------------------------

describe('storage — file-scoped bucket isolation', () => {
  it('a resolution recorded for file A never surfaces for file B (pure helper)', () => {
    const buckets: ResolutionMap = { 'a.docx': [RES_A] };
    expect(resolutionsForFile(buckets, 'a.docx')).toEqual([RES_A]);
    expect(resolutionsForFile(buckets, 'b.docx')).toEqual([]);
    expect(resolutionsForFile(buckets, undefined)).toEqual([]);
  });

  it('a resolution recorded for file A never surfaces for file B (reducer)', () => {
    let state = settledState({}, 'a.docx');
    state = resolutionReducer(state, {
      type: 'resolve',
      file: 'a.docx',
      citationId: 'c0',
      chosenEntryId: 'r0',
    });
    expect(state.resolutions).toEqual([RES_A]);
    expect(state.buckets['a.docx']).toEqual([RES_A]);

    // Switch to file B — a fresh document with its own c0..cN ordinals.
    state = resolutionReducer(state, { type: 'set-file', file: 'b.docx' });
    expect(state.resolutions).toEqual([]);
    expect(state.buckets['b.docx']).toBeUndefined();
    // Re-analyzing file A re-applies its own bucket — no cross-file leak.
    state = resolutionReducer(state, { type: 'set-file', file: 'a.docx' });
    expect(state.resolutions).toEqual([RES_A]);
  });

  it('resolve only touches the action\'s bucket — other files stay intact', () => {
    const state = settledState({ 'a.docx': [RES_A] }, 'b.docx');
    const next = resolutionReducer(state, {
      type: 'resolve',
      file: 'b.docx',
      citationId: 'c0',
      chosenEntryId: 'r1',
    });
    expect(next.buckets['a.docx']).toEqual([RES_A]); // untouched
    expect(next.buckets['b.docx']).toEqual([RES_B]); // upserted
  });
});

// ---------------------------------------------------------------------------
// Same-file re-analysis re-applies the stored bucket (reload-persistence).
// ---------------------------------------------------------------------------

describe('storage + reducer — same-file re-analysis re-applies the stored bucket', () => {
  it('persist → reload → re-scope to the same file restores its resolutions (full loop)', () => {
    const { store } = stubStore();
    saveResolutionMap({ 'paper.docx': [RES_A, RES_B] }, store);

    // Fresh mount: hydrate from storage, then the done envelope scopes the
    // SAME file again — the stored bucket re-applies via citationId re-join.
    let state = resolutionReducer(INITIAL_RESOLUTION_STATE, {
      type: 'hydrate',
      buckets: loadResolutionMap(store),
    });
    state = resolutionReducer(state, { type: 'set-file', file: 'paper.docx' });
    expect(state.resolutions).toEqual([RES_A, RES_B]);
    expect(state.fileScope).toBe('paper.docx');
  });

  it('a DIFFERENT file on the fresh mount starts with an empty list', () => {
    const { store } = stubStore();
    saveResolutionMap({ 'paper.docx': [RES_A] }, store);
    let state = resolutionReducer(INITIAL_RESOLUTION_STATE, {
      type: 'hydrate',
      buckets: loadResolutionMap(store),
    });
    state = resolutionReducer(state, { type: 'set-file', file: 'other.docx' });
    expect(state.resolutions).toEqual([]);
  });

  it('hydrate keeps the active list in sync when a fileScope is already set', () => {
    const state: ResolutionState = {
      fileScope: 'a.docx',
      buckets: {},
      resolutions: [],
      hydrated: false,
    };
    const next = resolutionReducer(state, {
      type: 'hydrate',
      buckets: { 'a.docx': [RES_A] },
    });
    expect(next.hydrated).toBe(true);
    expect(next.resolutions).toEqual([RES_A]);
  });
});

// ---------------------------------------------------------------------------
// Reducer semantics: upsert per citationId, clear, non-mutation.
// ---------------------------------------------------------------------------

describe('resolutionReducer — upsert + clear semantics', () => {
  it('resolve appends a NEW citationId to the active bucket', () => {
    let state = settledState({}, 'a.docx');
    state = resolutionReducer(state, {
      type: 'resolve',
      file: 'a.docx',
      citationId: 'c0',
      chosenEntryId: 'r0',
    });
    state = resolutionReducer(state, {
      type: 'resolve',
      file: 'a.docx',
      citationId: 'c1',
      chosenEntryId: 'r1',
    });
    expect(state.resolutions).toEqual([
      { citationId: 'c0', chosenEntryId: 'r0' },
      { citationId: 'c1', chosenEntryId: 'r1' },
    ]);
  });

  it('re-choosing the same citationId REPLACES it — one resolution per citation (last wins)', () => {
    let state = settledState({}, 'a.docx');
    state = resolutionReducer(state, {
      type: 'resolve',
      file: 'a.docx',
      citationId: 'c0',
      chosenEntryId: 'r0',
    });
    state = resolutionReducer(state, {
      type: 'resolve',
      file: 'a.docx',
      citationId: 'c0',
      chosenEntryId: 'r1',
    });
    expect(state.resolutions).toEqual([RES_B]); // replaced, not appended
    expect(state.resolutions).toHaveLength(1);
  });

  it('clear empties the ACTIVE file\'s bucket and drops its key', () => {
    let state = settledState({ 'a.docx': [RES_A], 'b.docx': [RES_B] }, 'a.docx');
    state = resolutionReducer(state, { type: 'clear', file: 'a.docx' });
    expect(state.resolutions).toEqual([]);
    expect(state.buckets['a.docx']).toBeUndefined();
    expect(state.buckets['b.docx']).toEqual([RES_B]); // other buckets untouched
  });

  it('clear on an already-empty bucket returns the SAME map reference (no persistence churn)', () => {
    const state = settledState({}, 'a.docx');
    const next = resolutionReducer(state, { type: 'clear', file: 'a.docx' });
    expect(next.buckets).toBe(state.buckets);
  });

  it('set-file to undefined (idle / analyzing) → empty active list', () => {
    const state = settledState({ 'a.docx': [RES_A] }, 'a.docx');
    const next = resolutionReducer(state, { type: 'set-file', file: undefined });
    expect(next.fileScope).toBeUndefined();
    expect(next.resolutions).toEqual([]);
  });

  it('upsertResolution never mutates the input map (same discipline as applyResolutions)', () => {
    const buckets: ResolutionMap = { 'a.docx': [RES_A] };
    const frozen = Object.freeze({ ...buckets, 'a.docx': Object.freeze([RES_A]) });
    const next = upsertResolution(frozen, 'a.docx', RES_B);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen['a.docx'])).toBe(true);
    expect(next['a.docx']).toEqual([RES_B]); // new object
    expect(frozen['a.docx']).toEqual([RES_A]); // input untouched
  });

  it('clearFileResolutions returns a NEW map only when something is cleared', () => {
    const present = { 'a.docx': [RES_A] };
    const cleared = clearFileResolutions(present, 'a.docx');
    expect(cleared).not.toBe(present);
    expect(cleared['a.docx']).toBeUndefined();
    const empty = {};
    expect(clearFileResolutions(empty, 'a.docx')).toBe(empty);
  });
});
