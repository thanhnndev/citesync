/**
 * T2 — browser-only text-file download helper (R014 JSON export).
 *
 * Pure DOM/blob code — deliberately NOT node-tested (URL.createObjectURL and
 * anchor click are browser APIs); the download path is proven end-to-end in
 * the T4 Playwright e2e (download event + byte comparison of the saved file).
 *
 * Zero imports — not even @citesync/core: callers pass the already-serialized
 * text (serializeReport(report)) so this module stays a dumb, leak-free
 * primitive and the core package boundary (PRD §92/§93) is never crossed here.
 */

/**
 * Save `text` to a file named `filename` (with MIME `mime`) via a transient
 * object-URL anchor click. The revoke is deferred with `setTimeout(..., 0)`:
 * an IMMEDIATE `URL.revokeObjectURL` can abort the download in some browsers
 * (the navigation still references the blob URL) — known pitfall.
 */
export function saveTextFile(text: string, filename: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Deferred revoke (see above) — safe in every modern browser.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
