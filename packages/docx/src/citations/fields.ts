/**
 * S03-T04 — structured citation fields (Zotero CSL_CITATION + Word CITATION)
 * as the identity backbone (§22 tier 1/2 of §23).
 *
 * S01 preserves field markers in `block.fields[]` (raw `w:instrText` /
 * `w:fldSimple/@w:instr`, entity-decoded, document order — §5c) while the
 * cached field RESULT (the visible display) stays in `block.text`. Parses
 * markers into a structured identity keyed to the display region: Zotero
 * authors from `citationItems[].itemData.author[]` ({family,given}/{literal})
 * and year from `itemData.issued` with a display-text fallback; Word
 * `CITATION <key> \l <lang>` via a key→year heuristic (2-digit tail:
 * 00–29→20xx, 30–99→19xx; embedded 4-digit wins), key letters = weak family
 * guess.
 *
 * DISPLAY ALIGNMENT (R009): `raw` always round-trips — the display, never
 * the marker. Order: exact `indexOf` of the display → whitespace-collapsed
 * regex → a plain occurrence matching family (diacritic-insensitive, §25 t3)
 * + year; an overlapping plain occurrence wins its offsets. Nothing aligns →
 * no occurrence (plain-text pass owns the display). A Word code with no
 * derivable year is recorded (0.6) but never emitted (§88, never throws).
 *
 * CONFIDENCE (R008): zotero 1.0/0.85/0.7 · word 0.92/0.6; occurrence = max(structured, plain) — a field never lowers confidence (§22/§23).
 *
 * Ids `c{n}` from the caller's counter (same namespace as T03, R008; T06
 * re-numbers the merged stream). Unknown markers → `null`, ignored.
 */

import type {
  AuthorDateCitationItem,
  DocumentBlock,
  SourceLocation,
} from '@citesync/document-model';

import { findCitationCandidates } from './candidate.js';
import { parseCandidate } from './grammar.js';
import { citationConfidence } from './confidence.js';
import { normalizeIdentityName, stripDiacritics } from '../normalize/names.js';

/** A structured author from CSL itemData ({family, given} or {literal}). */
export interface StructuredAuthor {
  family?: string;
  given?: string;
  literal?: string;
}

/** One cited work from a structured field (one per CSL citationItem). */
export interface StructuredFieldItem {
  authors: StructuredAuthor[];
  year?: number;
  yearSuffix?: string;
}

/** Kind of structured citation field this identity came from. */
export type StructuredFieldKind = 'zotero' | 'word';

/** The parsed structured identity of one field marker (§22 tier 1/2). */
export interface StructuredFieldIdentity {
  kind: StructuredFieldKind;
  /** One item per CSL citationItem (Zotero) / single best-effort item (Word). */
  items: StructuredFieldItem[];
  /** Display text recorded by the field (formattedCitation/plainCitation). */
  display?: string;
  /** The raw field marker exactly as S01 preserved it. */
  rawField: string;
  /** Structured-tier confidence in [0, 1] — see the tier table above. */
  confidence: number;
}

/** One structured-backed citation occurrence keyed to its display region. */
export interface StructuredFieldCitation {
  /** Deterministic occurrence id (`c{n}`) — same counter namespace as T03. */
  id: string;
  /** Display-region text: `text.slice(startOffset, endOffset)` (R009). */
  raw: string;
  /** §20 items built from the structured identity (identity backbone). */
  items: AuthorDateCitationItem[];
  /** Display-region offsets into `block.text`. */
  source: Pick<SourceLocation, 'blockId'> &
    Pick<SourceLocation, 'paragraphIndex'> &
    Pick<SourceLocation, 'startOffset'> &
    Pick<SourceLocation, 'endOffset'>;
  /** The structured identity that produced this occurrence (provenance). */
  identity: StructuredFieldIdentity;
  /** Occurrence confidence — max(structured tier, plain-text equivalent). */
  confidence: number;
}

const ZOTERO_PREFIX_RE = /^ADDIN\s+ZOTERO_ITEM\s+CSL_CITATION\b/;
const WORD_CODE_RE = /^CITATION\s+([^\s\\]+)/;
const YEAR_SUFFIX_RE = /(?:19|20)\d{2}([a-z])?/;

/** Parse one marker → identity, or null for non-citation markers. Never throws (§88). */
export function parseStructuredField(marker: string): StructuredFieldIdentity | null {
  if (typeof marker !== 'string') return null;
  const m = marker.trim();
  if (m === '') return null;
  if (ZOTERO_PREFIX_RE.test(m)) return parseZoteroMarker(m);
  if (WORD_CODE_RE.test(m)) return parseWordMarker(m);
  return null;
}

/** Parse `ADDIN ZOTERO_ITEM CSL_CITATION <json>`: authors/year from itemData, display fallback. */
function parseZoteroMarker(marker: string): StructuredFieldIdentity {
  const jsonStart = marker.indexOf('{');
  if (jsonStart === -1) {
    return { kind: 'zotero', items: [], rawField: marker, confidence: 0.7 };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(marker.slice(jsonStart));
  } catch {
    return { kind: 'zotero', items: [], rawField: marker, confidence: 0.7 };
  }
  const rec = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>;
  const citationItems = Array.isArray(rec.citationItems) ? (rec.citationItems as unknown[]) : [];
  const props = (typeof rec.properties === 'object' && rec.properties !== null
    ? (rec.properties as Record<string, unknown>)
    : {});
  const display = firstString(props.formattedCitation) ?? firstString(props.plainCitation);
  const segments = display !== undefined ? display.split(';').map((s) => s.trim()) : [];
  const globalYear = display !== undefined ? yearFromText(display) : {};

  const items: StructuredFieldItem[] = [];
  let hasAuthors = false;
  for (let i = 0; i < citationItems.length; i++) {
    const ci = citationItems[i];
    if (typeof ci !== 'object' || ci === null) continue;
    const raw = (ci as Record<string, unknown>).itemData;
    const itemData = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    const authors = parseCslAuthors(itemData.author);
    if (authors.length > 0) hasAuthors = true;
    const dataYear = yearFromItemData(itemData);
    const seg = segments[i] !== undefined ? yearFromText(segments[i]!) : {};
    const year = dataYear ?? seg.year ?? globalYear.year;
    const suffix = seg.suffix ?? globalYear.suffix;
    items.push({
      authors,
      ...(year !== undefined ? { year } : {}),
      ...(suffix !== undefined ? { yearSuffix: suffix } : {}),
    });
  }

  return {
    kind: 'zotero',
    items,
    ...(display !== undefined ? { display } : {}),
    rawField: marker,
    confidence: structuredFieldConfidence('zotero', {
      payloadPresent: true,
      hasAuthors,
      hasYear: items.some((it) => it.year !== undefined),
    }),
  };
}

function parseCslAuthors(raw: unknown): StructuredAuthor[] {
  if (!Array.isArray(raw)) return [];
  const out: StructuredAuthor[] = [];
  for (const a of raw) {
    if (typeof a !== 'object' || a === null) continue;
    const rec = a as Record<string, unknown>;
    const family = firstString(rec.family);
    const given = firstString(rec.given);
    const literal = firstString(rec.literal);
    if (family !== undefined) out.push({ family, ...(given !== undefined ? { given } : {}) });
    else if (literal !== undefined) out.push({ literal });
    else if (given !== undefined) out.push({ given });
  }
  return out;
}

function yearFromItemData(data: Record<string, unknown>): number | undefined {
  const issued = typeof data.issued === 'object' && data.issued !== null
    ? (data.issued as Record<string, unknown>)
    : undefined;
  const parts = issued?.['date-parts'];
  if (Array.isArray(parts) && parts.length > 0 && Array.isArray(parts[0]) && parts[0]!.length > 0) {
    const y = Number(parts[0]![0]);
    if (isYear(y)) return y;
  }
  if (typeof issued?.raw === 'string') {
    const m = issued.raw.match(/(?:19|20)\d{2}/);
    if (m !== null) return Number(m[0]);
  }
  if (data.year !== undefined) {
    const y = Number(data.year);
    if (isYear(y)) return y;
  }
  return undefined;
}

function yearFromText(s: string): { year?: number; suffix?: string } {
  const m = s.match(YEAR_SUFFIX_RE);
  if (m === null) return {};
  return { year: Number(m[0]!.slice(0, 4)), suffix: m[1] ?? undefined };
}

function isYear(n: number): boolean {
  return Number.isInteger(n) && n >= 1000 && n <= 9999;
}

function parseWordMarker(marker: string): StructuredFieldIdentity {
  const key = WORD_CODE_RE.exec(marker)![1]!;
  const { year, suffix } = yearFromWordKey(key);
  const family = key.replace(/\d+[a-z]?$/i, '');
  const items: StructuredFieldItem[] = [
    {
      authors: family !== '' ? [{ family }] : [],
      ...(year !== undefined ? { year } : {}),
      ...(suffix !== undefined ? { yearSuffix: suffix } : {}),
    },
  ];
  return {
    kind: 'word',
    items,
    rawField: marker,
    confidence: structuredFieldConfidence('word', {
      payloadPresent: true,
      hasAuthors: family !== '',
      hasYear: year !== undefined,
    }),
  };
}

function yearFromWordKey(key: string): { year?: number; suffix?: string } {
  const full = key.match(/(?:19|20)\d{2}/);
  if (full !== null) return { year: Number(full[0]) };
  const tail = key.match(/(\d{2})([a-z])?$/);
  if (tail !== null) {
    const n = Number(tail[1]);
    return { year: n <= 29 ? 2000 + n : 1900 + n, suffix: tail[2] ?? undefined };
  }
  return {};
}

/** Structured-tier confidence (tier table in the header). Pure + deterministic (R008). */
export function structuredFieldConfidence(
  kind: StructuredFieldKind,
  o: { payloadPresent: boolean; hasAuthors: boolean; hasYear: boolean },
): number {
  if (kind === 'zotero') {
    if (!o.payloadPresent) return 0.7;
    return o.hasAuthors ? 1 : 0.85;
  }
  return o.hasYear ? 0.92 : 0.6;
}

interface AlignedRegion {
  startOffset: number;
  endOffset: number;
  /** The plain-text occurrence overlapping the region (confidence floor). */
  plain?: PlainOccurrence;
}

interface PlainOccurrence {
  startOffset: number;
  endOffset: number;
  confidence: number;
  items: AuthorDateCitationItem[];
}

function plainOccurrencesInBlock(block: DocumentBlock): PlainOccurrence[] {
  const out: PlainOccurrence[] = [];
  for (const cand of findCitationCandidates(block.text)) {
    const parsed = parseCandidate(block.text, cand);
    if (parsed === null) continue;
    out.push({
      startOffset: parsed.startOffset,
      endOffset: parsed.endOffset,
      confidence: citationConfidence(parsed.features),
      items: parsed.items,
    });
  }
  return out;
}

function alignDisplayRegion(
  text: string,
  identity: StructuredFieldIdentity,
  plain: PlainOccurrence[],
): AlignedRegion | null {
  if (identity.display !== undefined && identity.display !== '') {
    const exact = text.indexOf(identity.display);
    if (exact !== -1) {
      const end = exact + identity.display.length;
      const p = overlapping(plain, exact, end);
      return { startOffset: p?.startOffset ?? exact, endOffset: p?.endOffset ?? end, plain: p };
    }
    const fuzzy = fuzzyIndexOf(text, identity.display);
    if (fuzzy !== null) {
      const p = overlapping(plain, fuzzy.startOffset, fuzzy.endOffset);
      return {
        startOffset: p?.startOffset ?? fuzzy.startOffset,
        endOffset: p?.endOffset ?? fuzzy.endOffset,
        plain: p,
      };
    }
  }
  // No display (Word) / display not found: match a plain occurrence by
  // family (diacritic-insensitive, §25 t3) and — when known — year.
  const first = identity.items[0];
  if (first === undefined) return null;
  const family = first.authors[0]?.family;
  if (family === undefined || family === '') return null;
  const famKey = stripDiacritics(normalizeIdentityName(family));
  if (famKey === '') return null;
  const p = plain.find((o) =>
    o.items.some((it) => {
      if (it.firstAuthor === undefined) return false;
      if (stripDiacritics(normalizeIdentityName(it.firstAuthor)) !== famKey) return false;
      return first.year === undefined || it.year === first.year;
    }),
  );
  if (p === undefined) return null;
  return { startOffset: p.startOffset, endOffset: p.endOffset, plain: p };
}

function overlapping(
  plain: PlainOccurrence[],
  a: number,
  b: number,
): PlainOccurrence | undefined {
  return plain.find((o) => o.startOffset < b && a < o.endOffset);
}

function fuzzyIndexOf(
  text: string,
  display: string,
): { startOffset: number; endOffset: number } | null {
  const escaped = display.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = escaped.replace(/\s+/g, '\\s+');
  if (pattern === '') return null;
  const m = new RegExp(pattern).exec(text);
  if (m === null) return null;
  return { startOffset: m.index, endOffset: m.index + m[0].length };
}

/**
 * Detect structured-backed citations in one block: one occurrence per field
 * with a resolvable display region, in field order, ids `c{n}` from
 * `startIndex` (R008). Unalignable markers are never emitted (plain-text
 * fallback, §88). Never throws.
 */
export function detectStructuredCitationsInBlock(
  block: DocumentBlock,
  startIndex = 0,
): StructuredFieldCitation[] {
  const fields = block.fields;
  if (fields === undefined || fields.length === 0) return [];
  const text = block.text;
  const plain = plainOccurrencesInBlock(block);
  const out: StructuredFieldCitation[] = [];
  for (const marker of fields) {
    const identity = parseStructuredField(marker);
    if (identity === null || identity.items.length === 0) continue;
    // No derivable Word year → record identity, fall back to plain text (§88).
    if (identity.kind === 'word' && identity.items[0]!.year === undefined) continue;
    const region = alignDisplayRegion(text, identity, plain);
    if (region === null) continue;
    out.push({
      id: `c${startIndex + out.length}`,
      raw: text.slice(region.startOffset, region.endOffset),
      items: identity.items.map(toAuthorDateItem),
      source: {
        blockId: block.id,
        ...(block.source.paragraphIndex !== undefined
          ? { paragraphIndex: block.source.paragraphIndex }
          : {}),
        startOffset: region.startOffset,
        endOffset: region.endOffset,
      },
      identity,
      confidence: Math.max(identity.confidence, region.plain?.confidence ?? 0),
    });
  }
  return out;
}

function toAuthorDateItem(item: StructuredFieldItem): AuthorDateCitationItem {
  const out: AuthorDateCitationItem = {};
  const family = item.authors[0]?.family;
  if (family !== undefined && family !== '') out.firstAuthor = family;
  const names = item.authors.map(authorDisplayName).filter((n) => n !== '');
  if (names.length > 0) out.authors = names;
  if (item.year !== undefined) out.year = item.year;
  if (item.yearSuffix !== undefined) out.yearSuffix = item.yearSuffix;
  return out;
}

function authorDisplayName(a: StructuredAuthor): string {
  if (a.family !== undefined && a.family !== '') {
    return a.given !== undefined && a.given !== '' ? `${a.family} ${a.given}` : a.family;
  }
  return a.literal ?? a.given ?? '';
}

function firstString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}
