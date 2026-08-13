/**
 * R013 (S03-T2) — guarded sessionStorage persistence for manual resolutions.
 *
 * One storage key ('citesync.resolutions.v1') holds a per-file map:
 *
 *     { [fileName: string]: SessionResolution[] }
 *
 * Buckets are keyed by the canonical report's `meta.file` (the done envelope
 * basename), so per-document citationId ordinals (c0..cN) never leak across
 * documents — the top correctness trap of R013 session state.
 *
 * EVERY access is guarded:
 *   - `typeof sessionStorage === 'undefined'` first (node vitest env — no
 *     global — and any non-browser runtime);
 *   - the access itself wrapped in try/catch (private mode / sandboxed
 *     iframes can THROW on getItem/setItem, or even on touching the
 *     sessionStorage global — SecurityError).
 *
 * A failure anywhere degrades to a NO-OP: load → empty map, save → nothing
 * written. The in-session overlay still works (the T1 view model is pure);
 * only cross-reload persistence is lost. Never throws, never guesses (§79).
 *
 * `store` defaults to sessionStorage and is injectable, so node-vitest
 * (where sessionStorage is undefined) passes a Map-based stub — the S02
 * stub-Worker pattern applied to storage.
 *
 * Pure bucket helpers (upsertResolution / clearFileResolutions /
 * resolutionsForFile) live here too: they are the deterministic core the
 * useResolutions reducer delegates to, unit-tested directly.
 *
 * Consumes ONLY `@citesync/core` types (via indexed access — the
 * SessionResolution shape from ./resolutions) — no DOM, no `node:*`,
 * no worker/protocol imports (PRD §92/§93; resolution is client-side only).
 */

import type { SessionResolution } from './resolutions';

/** The single storage key — the whole per-file map lives under it. */
export const RESOLUTIONS_STORAGE_KEY = 'citesync.resolutions.v1';

/** Per-file buckets: canonical report `meta.file` → its resolutions. */
export interface ResolutionMap {
  [fileName: string]: SessionResolution[];
}

/**
 * The injectable store surface — just the two calls storage needs. A
 * Map-based stub satisfies it (node tests), and `Storage` implements it.
 */
export type ResolutionStore = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * Resolve the active store: sessionStorage when available, undefined
 * otherwise. `typeof` guards the node env; the try/catch covers browsers
 * where merely touching the sessionStorage global throws (sandboxed
 * iframe SecurityError).
 */
function defaultStore(): ResolutionStore | undefined {
  try {
    if (typeof sessionStorage === 'undefined') return undefined;
    return sessionStorage;
  } catch {
    return undefined;
  }
}

/** Shape guard: a stored bucket entry must carry two string ids (§79 — never guess). */
function isSessionResolution(value: unknown): value is SessionResolution {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.citationId === 'string' && typeof candidate.chosenEntryId === 'string'
  );
}

/**
 * Load the full per-file map. Absent storage, unreadable storage, malformed
 * JSON or malformed shape → `{}` (empty map — never a guess, never a throw).
 * Invalid entries inside a bucket are dropped; buckets left with zero valid
 * resolutions are omitted.
 */
export function loadResolutionMap(store?: ResolutionStore): ResolutionMap {
  const target = store ?? defaultStore();
  if (target === undefined) return {};

  let raw: string | null;
  try {
    raw = target.getItem(RESOLUTIONS_STORAGE_KEY);
  } catch {
    return {}; // private mode / sandboxed iframe — read unavailable
  }
  if (raw === null || raw === '') return {}; // absent — nothing stored yet

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {}; // malformed JSON — never guess (§79)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }

  const map: ResolutionMap = {};
  for (const [file, resolutions] of Object.entries(parsed as Record<string, unknown>)) {
    if (!Array.isArray(resolutions)) continue;
    const valid = resolutions.filter(isSessionResolution);
    if (valid.length > 0) map[file] = valid;
  }
  return map;
}

/**
 * Persist the full per-file map. No-op (never a throw) when storage is
 * unavailable or the write fails (quota exceeded, private mode) — the
 * in-session overlay is unaffected, only cross-reload persistence is lost.
 */
export function saveResolutionMap(map: ResolutionMap, store?: ResolutionStore): void {
  const target = store ?? defaultStore();
  if (target === undefined) return; // node env — no-op without crashing
  try {
    target.setItem(RESOLUTIONS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Quota / private-mode write failure — swallow: the session still works.
  }
}

// ---------------------------------------------------------------------------
// Pure bucket helpers (the deterministic core of the useResolutions reducer).
// ---------------------------------------------------------------------------

/**
 * Upsert one resolution into a file's bucket — replace the existing entry
 * with the same citationId (re-choosing updates the same citation — the T1
 * last-wins semantics), or append when the citationId is new. Returns a NEW
 * map; the input map is never mutated (same discipline as applyResolutions).
 */
export function upsertResolution(
  buckets: ResolutionMap,
  file: string,
  resolution: SessionResolution,
): ResolutionMap {
  const current = buckets[file] ?? [];
  const next = current.some((entry) => entry.citationId === resolution.citationId)
    ? current.map((entry) =>
        entry.citationId === resolution.citationId ? resolution : entry,
      )
    : [...current, resolution];
  return { ...buckets, [file]: next };
}

/**
 * Clear a file's bucket. Returns the SAME map reference when the bucket is
 * already empty (no persistence churn — the persist effect only fires on a
 * new object reference).
 */
export function clearFileResolutions(buckets: ResolutionMap, file: string): ResolutionMap {
  const current = buckets[file];
  if (current === undefined || current.length === 0) return buckets;
  const next = { ...buckets };
  delete next[file];
  return next;
}

/**
 * The ACTIVE file's resolutions: `[]` while no file is scoped (idle /
 * analyzing — the done envelope's report is absent) and for files with no
 * stored bucket. File-scoped by construction — a bucket recorded for file A
 * can never surface for file B.
 */
export function resolutionsForFile(
  buckets: ResolutionMap,
  file: string | undefined,
): SessionResolution[] {
  if (file === undefined) return [];
  return buckets[file] ?? [];
}
