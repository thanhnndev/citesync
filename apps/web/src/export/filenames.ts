/**
 * T2 — deterministic export filenames (pure, node-testable).
 *
 * Pure string functions, zero imports (types only): the derived filename is
 * `${file}.${ext}` where `file` is the report's `meta.file` basename — e.g.
 * "minimal.docx" → "minimal.docx.json" / "minimal.docx.html". The extension
 * is APPENDED, never swapped: the JSON/HTML export of a ".docx" keeps the
 * source basename so a user can trace the artifact back to the analyzed
 * document (and the frozen byte contract only ever sees `meta.file`, which
 * is untouched here).
 *
 * The HTML variant is consumed by T4 (export-html button + e2e); it lives
 * here now because the name contract is part of the T2 export surface.
 */

/** JSON export filename for a report whose `meta.file` is `file`. */
export function exportJsonFilename(file: string): string {
  return `${file}.json`;
}

/** Standalone HTML report filename for a report whose `meta.file` is `file`. */
export function exportHtmlFilename(file: string): string {
  return `${file}.html`;
}
