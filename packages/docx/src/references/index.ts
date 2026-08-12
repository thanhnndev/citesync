/**
 * S03-T05 — reference-entry parsing public surface (R006/§21).
 *
 * Exposes the S02-span entry splitter, the §21 entry grammar with §88 failure
 * isolation, and the deterministic parse-confidence scorer. T06's
 * `parseReferences(doc)` drives these per detected bibliography:
 *
 *   splitEntryBlocks(doc.bibliography.blockIds, doc.blocks)
 *     → entry blocks (heading skipped unless it carries an entry)
 *   parseReferenceEntry(block.text, i, source) per entry
 *     → ReferenceEntry with id `r{i}`, `parseConfidence: 0` on grammar
 *       failure (never throws — §88), reason via describeReferenceParseFailure.
 */

export { splitEntryBlocks, isReferenceEntryBlock } from './split.js';
export {
  parseReferenceEntry,
  splitAuthorGroups,
  personName,
  describeReferenceParseFailure,
} from './parse.js';
export { referenceConfidence, BASE_REFERENCE_FEATURES } from './confidence.js';
export type { ReferenceFeatures } from './confidence.js';
