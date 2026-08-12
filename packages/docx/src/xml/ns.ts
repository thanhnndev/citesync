/**
 * @citesync/docx — OOXML namespace constants + local-name helpers (S01-T4).
 *
 * OOXML parts (document.xml, styles.xml, footnotes.xml) sprinkle the same few
 * namespace URIs across every element ("w:", "r:", "xml:"). Consumers only
 * care about the *local* element name (e.g. "t" from "w:t", "p" from "w:p");
 * the prefix is an arbitrary binding chosen by each part's root element, so
 * matching on the prefix is fragile. These helpers drop the prefix baggage and
 * map known prefixes to their canonical URIs without ever guessing.
 */

/**
 * Canonical OOXML / Dublin Core namespace URIs (all constant, non-empty).
 * Keys are the conventional prefix; look up by prefix value via
 * `namespaceUri(prefix)`.
 */
export const NS = {
  /** WordprocessingML main document.xml namespace ("w"). */
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  /** Office-document relationships extension ("r"), used by r:id / r:embed. */
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  /** Relationship part names ("rel"). */
  rel: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  /** Package-level relationships ("pr"). */
  rels: 'http://schemas.openxmlformats.org/package/2006/relationships',
  /** Core (docProps/core.xml) properties ("cp"). */
  cp: 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties',
  /** Dublin Core elements ("dc"). */
  dc: 'http://purl.org/dc/elements/1.1/',
  /** Dublin Core terms — dcterms:created / dcterms:modified ("dcterms"). */
  dcterms: 'http://purl.org/dc/terms/',
  /** Dublin Core type ("dcmitype"). */
  dcmitype: 'http://purl.org/dc/dcmitype/',
  /** W3C XML namespace, e.g. xml:space / xml:lang ("xml"). */
  xml: 'http://www.w3.org/XML/1998/namespace',
  /** W3C XML Schema instance ("xsi"). */
  xsi: 'http://www.w3.org/2001/XMLSchema-instance',
  /** Extended document properties ("extended-props"). */
  extendedProps: 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties',
} as const;

export type NsKey = keyof typeof NS;

/**
 * Resolve a prefix to its canonical namespace URI.
 * Returns `undefined` for unknown prefixes (the caller decides how to treat
 * them) — never guesses or fabricates a URI.
 */
export function namespaceUri(prefix: string): string | undefined {
  return (NS as Record<string, string | undefined>)[prefix];
}

/**
 * Return the XML Name prefix of a (possibly prefixed) name, e.g. "w:t" -> "w",
 * "xml:space" -> "xml"; `undefined` when the name has no prefix ("t").
 * A name with more than one ':' (invalid XML) returns `undefined`.
 */
export function prefix(name: string): string | undefined {
  if (name === '') return undefined;
  if (name.startsWith(':')) return undefined;
  if (name.endsWith(':')) return undefined;
  const idx = name.indexOf(':');
  if (idx === -1) return undefined;
  // More than one colon is not a valid qualified XML Name.
  if (name.indexOf(':', idx + 1) !== -1) return undefined;
  return name.slice(0, idx);
}

/**
 * Return the XML Name local part of a (possibly prefixed) name:
 * "w:t" -> "t", "xml:space" -> "space", "p" -> "p", "a:b:c" -> "a:b:c". Returns
 * the input verbatim when it is not (properly) qualified — including names
 * with more than one ':' (invalid XML), keeping this helper consistent with
 * {@link prefix} / {@link splitName} so a malformed name is never silently
 * mis-sliced.
 */
export function localName(name: string): string {
  if (name === '') return name;
  // Reject multi-colon (unambiguously invalid XML Name) the same way `prefix`
  // does, and leave it verbatim rather than returning a wrong local part.
  const first = name.indexOf(':');
  if (first === -1) return name;
  if (name.lastIndexOf(':') !== first) return name;
  return name.slice(first + 1);
}

/**
 * Split a qualified name into { prefix?, local }. Thin convenience wrapper over
 * {@link prefix} + {@link localName} that also rejects malformed multi-colon
 * names by returning `{ prefix: undefined, local: name }`.
 */
export function splitName(name: string): { prefix?: string; local: string } {
  const p = prefix(name);
  if (p === undefined) return { local: name };
  return { prefix: p, local: name.slice(p.length + 1) };
}
