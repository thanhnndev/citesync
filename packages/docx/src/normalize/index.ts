/**
 * S03-T02 — diacritic-aware tiered name normalization (R006/§24, R008).
 *
 * Pure, deterministic primitives shared by citation extraction (T03/T04),
 * reference parsing (T05) and the §25 matcher (S04). The three stored tiers
 * exactly match `PersonNameKey` from `@citesync/document-model`.
 */

export {
  normalizeIdentityName,
  stripDiacritics,
  initialsKey,
  buildNameKey,
  isVietnameseFamilyName,
} from './names.js';

export type { PersonNameKey } from '@citesync/document-model';
