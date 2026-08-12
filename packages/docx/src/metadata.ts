/**
 * @citesync/docx — docProps/core.xml core-properties extraction (S01-T6).
 *
 * Extracts the §15 `DocumentMetadata` fields (title / author / created /
 * modified) from the OPC core-properties part. Tag prefixes are arbitrary
 * bindings (`dc:title`, `dcterms:created`, ...), so extraction matches on the
 * LOCAL element name — the same prefix-agnostic rule used across the reader.
 *
 * Contract: never throws on missing or malformed metadata. A missing
 * `docProps/core.xml` part, an empty part, or a broken part yields an empty
 * `DocumentMetadata` (`{}`) with all fields `undefined` — the safe default.
 * `created`/`modified` are kept verbatim (Word writes W3CDTF ISO-8601, e.g.
 * `2024-01-15T10:30:00Z`); no timezone normalization, no clock, no random —
 * pure + deterministic (R008).
 *
 * Element content is entity-decoded and trimmed; whitespace-only values are
 * treated as absent. Repeated elements (rare) resolve last-wins.
 */

import type { DocumentMetadata } from '@citesync/document-model';

import { decodeEntities } from './xml/entities.js';
import { localName } from './xml/ns.js';
import { readOpenTag, scanTagEnd, tagName } from './xml/tag-scan.js';

/** Local element name -> the model field it populates. */
const CORE_FIELD_BY_LOCAL: Readonly<Record<string, keyof DocumentMetadata>> = {
  title: 'title',
  creator: 'author',
  created: 'created',
  modified: 'modified',
};

/**
 * Extract core-properties metadata from a raw `docProps/core.xml` string.
 *
 * @param coreXml - the raw part string; `undefined` when the part is absent.
 * @returns a `DocumentMetadata`; all fields `undefined` when absent/malformed.
 */
export function extractCoreProperties(coreXml: string | undefined): DocumentMetadata {
  const metadata: DocumentMetadata = {};
  if (coreXml === undefined || coreXml === '') return metadata;

  const n = coreXml.length;
  let i = 0;
  // Element state: local name of the open target element + content start.
  let openField: keyof DocumentMetadata | null = null;
  let fieldContentStart = -1;

  while (i < n) {
    const lt = coreXml.indexOf('<', i);
    if (lt === -1) break; // trailing plain text — nothing structural left

    const next = coreXml[lt + 1];

    // Processing instruction / comment / CDATA / declaration: skip opaquely.
    if (next === '?') {
      const end = coreXml.indexOf('?>', lt + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (next === '!' && coreXml.startsWith('!--', lt + 1)) {
      const end = coreXml.indexOf('-->', lt + 3);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (next === '!' && coreXml.startsWith('![CDATA[', lt + 1)) {
      const end = coreXml.indexOf(']]>', lt + 9);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (next === '!') {
      const end = scanTagEnd(coreXml, lt);
      i = end === -1 ? n : end + 1;
      continue;
    }

    // Closing tag: finalize an open target element (content between its
    // opening `>` and this `<`).
    if (next === '/') {
      const gt = coreXml.indexOf('>', lt + 2);
      const closeInner = (gt === -1 ? coreXml.slice(lt + 2) : coreXml.slice(lt + 2, gt)).trim();
      if (openField !== null && fieldContentStart >= 0) {
        const raw = coreXml.slice(fieldContentStart, lt);
        const value = decodeEntities(raw).decoded.trim();
        if (value !== '') metadata[openField] = value;
        openField = null;
        fieldContentStart = -1;
      } else if (localName(closeInner) in CORE_FIELD_BY_LOCAL) {
        openField = null;
        fieldContentStart = -1;
      }
      i = gt === -1 ? n : gt + 1;
      continue;
    }

    // Opening tag.
    const tag = readOpenTag(coreXml, lt);
    if (tag === null) {
      // Unterminated tag: stop safely — the tail of a broken part is not
      // trustworthy; return what we have. Isolated, never thrown.
      break;
    }
    const name = localName(tagName(tag.inner));
    const field = CORE_FIELD_BY_LOCAL[name];

    if (field !== undefined && !tag.selfClosing) {
      // Start content accumulation after the opening tag's `>`.
      openField = field;
      fieldContentStart = lt + tag.inner.length + 2; // +1 '<' +1 '>'
    } else if (field !== undefined) {
      // Self-closing `<dc:title/>`: no content — treated as absent.
      openField = null;
      fieldContentStart = -1;
    }

    i = lt + tag.inner.length + 2;
  }

  // Unterminated trailing element content at end of input (soft malformed):
  // finalize what was opened so present metadata is never lost.
  if (openField !== null && fieldContentStart >= 0) {
    const value = decodeEntities(coreXml.slice(fieldContentStart)).decoded.trim();
    if (value !== '') metadata[openField] = value;
  }

  return metadata;
}
