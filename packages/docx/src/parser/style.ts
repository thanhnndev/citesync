/**
 * @citesync/docx — word/styles.xml style map (S01-T5).
 *
 * Parses the styles part into a deterministic map: styleId -> {@link StyleInfo}
 * (`name`/`label`, `isHeading`, `outlineLevel?`). The map decorates
 * `DocumentBlock.style` and lets S02 detect headings by style (research §5c:
 * "preserve paragraph property (style) for heading detection").
 *
 * Heading classification is a documented heuristic (never throws, never
 * guesses silently — see {@link headingAnalysis}):
 *   1. A `w:pPr/w:outlineLvl` in the style (any numeric value) makes it a
 *      heading with that outline level (Word's canonical heading marker).
 *   2. Otherwise a style is a heading when its `w:name` or `w:styleId`
 *      (lowercased) starts with "heading" or "outline". Character / table /
 *      numbering styles are never block headings ("Heading1Char" is the
 *      run-level companion of Heading1, not a block heading itself).
 *
 * Scope: only `<w:style>` elements are read. `w:docDefaults` and
 * `w:latentStyles` (`w:lsdException`) are ignored — they declare defaults,
 * not concrete styles a paragraph can reference. `w:aliases`/`w:basedOn` are
 * deliberately not followed: classification is per-style, not inherited.
 *
 * Determinism (R008): pure function of the input string; malformed entries
 * (unterminated tags, missing `w:styleId`) are skipped/isolated, never thrown.
 */

import { localName } from '../xml/ns.js';
import { attrVal, readOpenTag, scanTagEnd, tagName } from '../xml/tag-scan.js';

/** A parsed `w:style` entry, keyed by `w:styleId` in the returned map. */
export interface StyleInfo {
  /** `w:styleId` — the value a paragraph's `w:pStyle/@w:val` references. */
  styleId: string;
  /** `w:name/@w:val` (e.g. "heading 1") when present. */
  name?: string;
  /** `w:type` attribute ("paragraph" | "character" | "table" | "numbering" | ...). */
  type?: string;
  /** True when this style denotes a heading (see module docs for the rule). */
  isHeading: boolean;
  /**
   * Outline level (0-based) when derivable: the `w:pPr/w:outlineLvl` value,
   * or N-1 from a name/styleId like "heading 2" / "Heading3".
   */
  outlineLevel?: number;
}

/** Immutable style map: styleId -> style info. */
export type StyleMap = ReadonlyMap<string, StyleInfo>;

/**
 * Parse `word/styles.xml` into a {@link StyleMap}.
 *
 * Pure + deterministic. Malformed markup (unterminated tags, unreadable
 * attributes) is isolated: the entry is skipped or partially populated, never
 * an exception — a broken styles part must not crash document parsing (§88).
 */
export function loadStyleMap(stylesXml: string): StyleMap {
  const map = new Map<string, StyleInfo>();

  let inStyle = false;
  let styleId: string | undefined;
  let styleType: string | undefined;
  let styleName: string | undefined;
  let styleOutline: number | undefined;

  const n = stylesXml.length;
  let i = 0;
  while (i < n) {
    const lt = stylesXml.indexOf('<', i);
    if (lt === -1) break; // trailing plain text — nothing structural left

    const next = stylesXml[lt + 1];

    // Processing instruction / comment / CDATA / declaration: skip opaquely.
    if (next === '?') {
      const end = stylesXml.indexOf('?>', lt + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (next === '!' && stylesXml.startsWith('!--', lt + 1)) {
      const end = stylesXml.indexOf('-->', lt + 3);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (next === '!' && stylesXml.startsWith('![CDATA[', lt + 1)) {
      const end = stylesXml.indexOf(']]>', lt + 9);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (next === '!') {
      const end = scanTagEnd(stylesXml, lt);
      i = end === -1 ? n : end + 1;
      continue;
    }

    // Closing tag.
    if (next === '/') {
      const gt = stylesXml.indexOf('>', lt + 2);
      const closeInner = (gt === -1 ? stylesXml.slice(lt + 2) : stylesXml.slice(lt + 2, gt)).trim();
      if (localName(closeInner) === 'style' && inStyle) {
        finalize();
      }
      i = gt === -1 ? n : gt + 1;
      continue;
    }

    // Opening tag.
    const tag = readOpenTag(stylesXml, lt);
    if (tag === null) {
      // Unterminated tag: mark current style malformed and stop scanning
      // (the tail of a broken part is not trustworthy) — isolated, not thrown.
      if (inStyle) finalize();
      break;
    }
    const name = localName(tagName(tag.inner));

    if (name === 'style' && !tag.selfClosing) {
      if (inStyle) finalize(); // malformed nesting: close the previous entry
      inStyle = true;
      styleId = attrVal(tag.inner, 'w:styleId');
      styleType = attrVal(tag.inner, 'w:type');
      styleName = undefined;
      styleOutline = undefined;
    } else if (inStyle && name === 'name') {
      styleName = attrVal(tag.inner, 'w:val');
    } else if (inStyle && name === 'outlineLvl') {
      const v = attrVal(tag.inner, 'w:val');
      if (v !== undefined) {
        const lvl = Number.parseInt(v, 10);
        if (Number.isFinite(lvl)) styleOutline = lvl;
      }
    }

    i = lt + tag.inner.length + 2;
  }

  // Unterminated `<w:style>` at end of input.
  if (inStyle) finalize();

  return map;

  /** Finalize the current style entry (isolated when incomplete). */
  function finalize(): void {
    if (styleId !== undefined && styleId !== '') {
      const { isHeading, outlineLevel } = headingAnalysis(
        styleId,
        styleType,
        styleName,
        styleOutline,
      );
      map.set(styleId, {
        styleId,
        name: styleName,
        type: styleType,
        isHeading,
        outlineLevel,
      });
    }
    inStyle = false;
    styleId = undefined;
    styleType = undefined;
    styleName = undefined;
    styleOutline = undefined;
  }
}

/**
 * Heading classification heuristic (documented at module top). Exported for
 * unit-testing the rule in isolation.
 */
export function headingAnalysis(
  styleId: string,
  type: string | undefined,
  name: string | undefined,
  outlineFromPPr: number | undefined,
): { isHeading: boolean; outlineLevel?: number } {
  // 1. Explicit `w:pPr/w:outlineLvl` is the canonical heading marker.
  if (outlineFromPPr !== undefined) {
    return { isHeading: true, outlineLevel: outlineFromPPr };
  }
  // 2. Character/table/numbering styles are never block headings.
  if (type === 'character' || type === 'table' || type === 'numbering') {
    return { isHeading: false };
  }
  // 3. Name/styleId heuristic ("heading 1", "Heading2", "Outline 3", ...).
  const id = styleId.toLowerCase();
  const nm = (name ?? '').toLowerCase();
  const nameIsHeading = /^(heading|outline)/.test(nm);
  const idIsHeading = /^(heading|outline)/.test(id);
  if (nameIsHeading || idIsHeading) {
    const fromName = /(?:heading|outline)\s*(\d+)/.exec(nm);
    const fromId = /^(?:heading|outline)\s*(\d+)$/.exec(id);
    const raw = fromName?.[1] ?? fromId?.[1];
    if (raw !== undefined) {
      const level = Number.parseInt(raw, 10) - 1;
      if (level >= 0) return { isHeading: true, outlineLevel: level };
    }
    return { isHeading: true };
  }
  return { isHeading: false };
}
