# Fixtures (S01-T7)

Committed .docx binaries authored by `scripts/make-fixtures.ts` (run via `npx tsx`).
Authoring uses fflate + hand-authored OOXML — **never the reader** — and is fully
deterministic (R008/R017): pinned DOS timestamps, fixed entry order, no clock/random.
Re-running the script rewrites byte-identical files.

## Golden anchor

`minimal.docx` is the golden/determinism anchor with hand-known offsets:

| block | text | note |
|-------|------|------|
| 0 (heading, style Heading1) | `Introduction` | exercises styles.xml style-map path |
| 1 (paragraph) | `Smith (2024) proposed a theory` | citation `Smith (2024)` at `[0,12)` in paragraph text |
| 2 (paragraph) | `Fragmented run text here.` | fragmented runs, coalesced; runs at `[0,11)` `[11,20)` `[20,25)` |

## Corpus (author-date)

| fixture | purpose |
|---------|---------|
| `author-date/simple.docx` | APA-like simple citations + footnote |
| `author-date/et-al.docx` | et-al + multiple authors + Zotero CSL field marker |
| `author-date/multiple-authors.docx` | 3+ author spellings |
| `author-date/same-author-year.docx` | 2020a/2020b disambiguation |
| `author-date/missing.docx` | missing year/author edge cases |
| `author-date/ambiguous.docx` | ambiguous same-name citations |
| `author-date/vietnamese.docx` | Vietnamese thesis with diacritics + footnote |

## Corpus (documents/docx mirrors)

| fixture | purpose |
|---------|---------|
| `documents/docx/apa-like.docx` | narrative + parenthetical citations + reference list |
| `documents/docx/harvard.docx` | Harvard variants, page-number citation, entity-encoded text |
| `documents/docx/plain-text.docx` | plain-text citations, no structured fields |

## Security samples

| fixture | expected reader behavior |
|---------|--------------------------|
| `security/zip-bomb.docx` | entry declares 60 MiB (> DOCX_ENTRY_MAX) -> `ZipBombError` before inflate |
| `security/lying-bomb.docx` | entry declares 100 B but inflates to 60 MiB (lying declaration) -> `ZipBombError` on actual output (S01-T9) |
| `security/truncated.docx` | central directory + EOCD removed -> `NotADocxError` (truncated ZIP) |
| `security/not-a-docx.zip` | well-formed ZIP, missing required parts -> `NotADocxError` |
| `security/garbage.docx` | non-ZIP bytes -> `NotADocxError` (no PK magic) |
| `security/vba-sample.docx` | **valid** docx + `word/vbaProject.bin` + external rel targets; parses fine, macro/remote targets only noted |

> `security/vba-sample.docx` is a VALID package (macro parts are note-and-skip, never
> executed or decoded). Only the five explicitly "bad" samples are expected to throw
> typed errors from the reader.
