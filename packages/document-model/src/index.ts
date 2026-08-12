/**
 * @citesync/document-model — public barrel.
 *
 * Re-exports the PRD §15 internal document model contract (see `types.ts`).
 * Every export is type-only (interfaces/type aliases are erased at runtime);
 * downstream packages import with `import type { ... } from
 * '@citesync/document-model'`.
 */
export type {
  AcademicDocument,
  AuthorDateCitationItem,
  BibliographySection,
  BlockSourceMap,
  CitationItem,
  CitationOccurrence,
  DocumentBlock,
  DocumentBlockType,
  DocumentMetadata,
  NumericCitationItem,
  RunSpan,
  SourceLocation,
  SourceMap,
} from './types.js';
