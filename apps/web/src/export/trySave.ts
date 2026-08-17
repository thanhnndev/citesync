/**
 * M005-S02-T3 — export-failure surface helper.
 *
 * Pure wrapper (zero DOM — node-testable, matches the vitest node-env
 * constraint): runs `save` and reports whether it threw. The UI shows an
 * inline error + keeps the panel usable (retry = click again) instead of
 * the old silent fire-and-forget (UI-SPEC §4.5/5.7 — the export-failure gap).
 *
 * The helper never rethrows and never logs — the caller decides what to
 * surface (the inline `export-error` message).
 */
export function trySave(save: () => void): boolean {
  try {
    save();
    return true;
  } catch {
    return false;
  }
}
