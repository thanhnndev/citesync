/**
 * S03-T05 — bibliography entry splitting (R006/§21, scope = S02's blockIds).
 *
 * S02's detected `BibliographySection` carries `blockIds`: an ORDERED list —
 * heading block first, then the consecutive reference-like blocks in document
 * order. This module turns that span into the ordered list of ENTRY blocks:
 * the heading block is skipped unless it carries an entry itself (a heading
 * whose text is itself a reference-shaped line, e.g. a missing-heading doc
 * where S02 detected "Doe, J. (2017). …" as the first reference-like block).
 *
 * Each entry's text is simply `block.text`; multi-line/continuation handling
 * is S02's run-gating concern (the run breaks at the first non-reference-like
 * block), so a continuation line outside `blockIds` is never parsed here.
 * Blocks whose id does not resolve are skipped (defensive; `blockIds` comes
 * from the same document).
 *
 * Pure + deterministic (R008): a `Map` lookup preserves `blockIds` order and
 * never depends on iteration order.
 */

import type { DocumentBlock } from '@citesync/document-model';

/**
 * Conservative reference-entry shape: a line that STARTS with a name run then
 * a 4-digit year in parentheses closed by '.' or ':' — the same shape S02's
 * detector gates its reference-like run on ("Doe, J. (2017). …",
 * "Nguyễn Văn A (2015): …"). Used ONLY to decide whether the heading block
 * carries an entry; every other block in `blockIds` already passed S02's own
 * gate, so they are trusted and left to `parse.ts`'s §88 failure isolation.
 */
const ENTRY_LIKE_RE = /^[\p{L}][\p{L}\p{M}\s.,'’“”&–-]{1,80}\(\d{4}\)[.:]/u;

/** True when the block's text looks like a reference entry (not a heading). */
export function isReferenceEntryBlock(block: DocumentBlock): boolean {
  return ENTRY_LIKE_RE.test(block.text);
}

/**
 * Enumerate the entry blocks of a detected bibliography section.
 *
 * @param blockIds ordered ids from `BibliographySection.blockIds` (heading
 *   block first, then the reference-like run — S02's contract).
 * @param blocks   the document's blocks (`AcademicDocument.blocks`, ordered),
 *   resolved by id.
 * @returns the entry blocks in document order — every block except the
 *   heading, and the heading itself when it carries an entry.
 */
export function splitEntryBlocks(
  blockIds: string[],
  blocks: DocumentBlock[],
): DocumentBlock[] {
  if (blockIds.length === 0 || blocks.length === 0) return [];

  const byId = new Map<string, DocumentBlock>();
  for (const block of blocks) byId.set(block.id, block);

  const resolved: DocumentBlock[] = [];
  for (const id of blockIds) {
    const block = byId.get(id);
    if (block !== undefined) resolved.push(block);
  }
  if (resolved.length === 0) return [];

  const [head, ...rest] = resolved;
  // Heading block carries an entry? Keep it; otherwise skip it (pure heading
  // like "References" / "Tài liệu tham khảo" is not an entry).
  const entries = head !== undefined && isReferenceEntryBlock(head)
    ? [head, ...rest]
    : rest;
  return entries;
}
