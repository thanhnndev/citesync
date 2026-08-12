/**
 * @citesync/document-model — public barrel.
 *
 * Re-exports the PRD §15 internal document model contract plus the §21
 * reference-record types S03 added (see `types.ts`). Every export is
 * type-only (interfaces/type aliases are erased at runtime); downstream
 * packages import with `import type { ... } from
 * '@citesync/document-model'`.
 */
export type {
  AcademicDocument,
  AuthorDateCitationItem,
  BibliographyCandidate,
  BibliographyDetectionResult,
  BibliographySection,
  BlockSourceMap,
  CitationItem,
  CitationOccurrence,
  DocumentBlock,
  DocumentBlockType,
  DocumentMetadata,
  DocumentSecurityInfo,
  NumericCitationItem,
  ParseIssue,
  PersonName,
  PersonNameKey,
  ReferenceEntry,
  ReferenceParseIssue,
  RunSpan,
  SourceLocation,
  SourceMap,
} from './types.js';
