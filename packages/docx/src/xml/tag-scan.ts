/**
 * @citesync/docx — shared quoted-aware tag-scanning helpers (S01-T5).
 *
 * The S01-T4 source-position scanner keeps its own private equivalents of
 * these functions (locked + tested; not exported). The S01-T5 parsers
 * (paragraph/table/style) need the same primitive operations — finding a tag
 * end without being fooled by `>` inside quoted attribute values, reading an
 * opening tag, extracting a tag's element name, and reading an attribute
 * value — so they share one small module instead of triplicating the logic.
 *
 * The duplication between this module and source-position.ts is deliberate:
 * T4's scanner is a completed, tested deliverable and is not modified here.
 * Every function here is pure, deterministic (R008) and never throws.
 */

/**
 * Index of the `>` that closes the tag whose opening `<` is at `lt`.
 * Quoted attribute values are treated so a literal `>` inside `"`/`'` quotes
 * is not mistaken for the tag end. Returns `-1` when the tag is unterminated
 * (the caller decides how to fail safely — never throws).
 */
export function scanTagEnd(xml: string, lt: number): number {
  const n = xml.length;
  let i = lt + 1;
  let quote: '"' | "'" | null = null;
  for (; i < n; i++) {
    const c = xml[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === '>') return i;
  }
  return -1;
}

/**
 * Parse the opening tag at `lt` (index of `<`). Returns the tag's inner text
 * (between `<` and `>`) and whether it is self-closing (`/>`). Null when the
 * tag is unterminated — never throws.
 */
export function readOpenTag(
  xml: string,
  lt: number,
): { inner: string; selfClosing: boolean } | null {
  const tagEnd = scanTagEnd(xml, lt);
  if (tagEnd === -1) return null;
  const inner = xml.slice(lt + 1, tagEnd);
  let endIdx = inner.length - 1;
  while (endIdx >= 0 && /\s/.test(inner[endIdx]!)) endIdx -= 1;
  const selfClosing = endIdx >= 0 && inner[endIdx] === '/';
  return { inner, selfClosing };
}

/**
 * Element name from an opening tag's inner text (up to whitespace or `/`),
 * e.g. `<w:t xml:space="preserve">` -> "w:t".
 */
export function tagName(inner: string): string {
  let i = 0;
  const n = inner.length;
  for (; i < n; i++) {
    const c = inner[i]!;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '/') break;
  }
  return inner.slice(0, i);
}

/**
 * Value of the attribute `attr` inside an opening tag's inner text, e.g.
 * `attrVal('<w:pStyle w:val="Heading1"'.slice(1), 'w:val')` -> "Heading1".
 * Undefined when absent. The `(?:^|\s)` anchor prevents a prefix match (e.g.
 * searching "val" must not hit "w:val2").
 */
export function attrVal(inner: string, attr: string): string | undefined {
  // Attribute names are XML Names: alnum plus `:`, `_`, `-`, `.` — no regex
  // metacharacters in practice, but escape defensively anyway.
  const esc = attr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|\\s)${esc}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`);
  const m = re.exec(inner);
  if (!m) return undefined;
  return m[1] ?? m[2];
}
