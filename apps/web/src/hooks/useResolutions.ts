/**
 * R013 (S03-T2) — file-scoped useResolutions reducer hook.
 *
 * A useReducer overlay (MEM098) over the T2 storage layer: on mount it
 * hydrates the per-file resolution map from sessionStorage; `fileScope`
 * derives from the done envelope's `report.meta.file` (undefined while
 * idle/analyzing → the active list is empty); `resolve` / `clear` mutate
 * ONLY the ACTIVE file's bucket, then a persist effect writes the whole map
 * back on change.
 *
 * Buckets are file-scoped — per-document citationId ordinals (c0..cN) never
 * leak across documents (the top correctness trap). Re-analyzing the SAME
 * file re-applies its stored bucket via the citationId re-join (the e2e
 * reload-persistence leg); a NEW file starts with an empty list.
 *
 * The hook consumes the report shape ONLY — it never touches the worker or
 * the postMessage protocol (no new message kinds; resolution is client-side
 * only, PRD §92/§93). Deterministic core is pure `resolutionReducer` +
 * storage bucket helpers, unit-tested in node without a DOM.
 *
 * Hydration discipline: `hydrated` flips only after the on-mount load, so
 * the persist effect can never write `{}` over an existing stored map before
 * it is read (the first hydrate write-back is idempotent).
 */

import { useCallback, useEffect, useReducer } from 'react';
import type { CliReport } from '@citesync/core';
import type { SessionResolution } from '../resolutions/resolutions';
import {
  clearFileResolutions,
  loadResolutionMap,
  resolutionsForFile,
  saveResolutionMap,
  upsertResolution,
  type ResolutionMap,
} from '../resolutions/storage';

// ---------------------------------------------------------------------------
// Reducer state + actions (exported for direct node tests — no DOM needed).
// ---------------------------------------------------------------------------

/** The reducer's full state: the stored map + the derived active view. */
export interface ResolutionState {
  /** The active file (canonical report `meta.file`) — undefined while idle/analyzing. */
  fileScope: string | undefined;
  /** The whole per-file map (the persisted truth). */
  buckets: ResolutionMap;
  /** The ACTIVE file's bucket — what the UI renders (derived, never stored alone). */
  resolutions: SessionResolution[];
  /** True once the on-mount hydration load has been applied. */
  hydrated: boolean;
}

/** Reducer actions — hydrate (on mount), follow the file, resolve, clear. */
export type ResolutionAction =
  | { type: 'hydrate'; buckets: ResolutionMap }
  | { type: 'set-file'; file: string | undefined }
  | { type: 'resolve'; file: string; citationId: string; chosenEntryId: string }
  | { type: 'clear'; file: string };

export const INITIAL_RESOLUTION_STATE: ResolutionState = {
  fileScope: undefined,
  buckets: {},
  resolutions: [],
  hydrated: false,
};

/**
 * Pure resolution reducer. `resolve` / `clear` only touch the action's file
 * bucket (and only re-derive the active list when that file IS the active
 * scope); every transition returns a new object — no input mutation.
 */
export function resolutionReducer(
  state: ResolutionState,
  action: ResolutionAction,
): ResolutionState {
  switch (action.type) {
    case 'hydrate':
      return {
        ...state,
        buckets: action.buckets,
        resolutions: resolutionsForFile(action.buckets, state.fileScope),
        hydrated: true,
      };
    case 'set-file':
      return {
        ...state,
        fileScope: action.file,
        resolutions: resolutionsForFile(state.buckets, action.file),
      };
    case 'resolve': {
      const buckets = upsertResolution(state.buckets, action.file, {
        citationId: action.citationId,
        chosenEntryId: action.chosenEntryId,
      });
      return {
        ...state,
        buckets,
        resolutions:
          action.file === state.fileScope
            ? resolutionsForFile(buckets, action.file)
            : state.resolutions,
      };
    }
    case 'clear': {
      const buckets = clearFileResolutions(state.buckets, action.file);
      return {
        ...state,
        buckets,
        resolutions: action.file === state.fileScope ? [] : state.resolutions,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// The hook.
// ---------------------------------------------------------------------------

/** The R013 hook surface (T3 wires this into the explorer). */
export interface UseResolutions {
  /** The ACTIVE file's resolutions ([] while idle/analyzing or nothing stored). */
  resolutions: SessionResolution[];
  /** Record/update the user's choice for one citationId of the ACTIVE file. */
  resolve: (citationId: string, chosenEntryId: string) => void;
  /** Clear the ACTIVE file's bucket (session state cleared with the session). */
  clear: () => void;
  /** The active file (report.meta.file) — undefined while idle/analyzing. */
  fileScope: string | undefined;
}

/**
 * File-scoped session resolutions for the currently analyzed document.
 *
 * @param report the done envelope's report — the hook reads ONLY
 *   `report.meta.file` for its scope; undefined (idle / analyzing / error)
 *   scopes to no file → the active list is empty and resolve/clear no-op.
 */
export function useResolutions(report: CliReport | undefined): UseResolutions {
  // fileScope derives purely from the report shape — never from the worker
  // or protocol (client-side only).
  const fileScope = report?.meta.file;

  const [state, dispatch] = useReducer(
    resolutionReducer,
    undefined,
    () => INITIAL_RESOLUTION_STATE,
  );

  // Hydrate once on mount (guarded by storage availability — node/private
  // mode/sandboxed iframe all degrade to an empty map, never a crash).
  useEffect(() => {
    dispatch({ type: 'hydrate', buckets: loadResolutionMap() });
  }, []);

  // Follow the active file: re-analysis of the same file re-applies its
  // stored bucket (citationId re-join); a new file swaps to an empty list.
  useEffect(() => {
    dispatch({ type: 'set-file', file: fileScope });
  }, [fileScope]);

  // Persist the whole map on change — but never before hydration has read
  // the stored map back (a pre-hydration write would clobber it with {}).
  useEffect(() => {
    if (!state.hydrated) return;
    saveResolutionMap(state.buckets);
  }, [state.buckets, state.hydrated]);

  const resolve = useCallback(
    (citationId: string, chosenEntryId: string): void => {
      if (fileScope === undefined) return; // idle/analyzing — nothing to record against
      dispatch({ type: 'resolve', file: fileScope, citationId, chosenEntryId });
    },
    [fileScope],
  );

  const clear = useCallback((): void => {
    if (fileScope === undefined) return;
    dispatch({ type: 'clear', file: fileScope });
  }, [fileScope]);

  return { resolutions: state.resolutions, resolve, clear, fileScope };
}
