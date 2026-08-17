# Phase 01: Foundation & Core Engine - Context

**Gathered:** 2026-08-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the monorepo structure and core parsing/matching engine for CiteSync — an offline-first citation consistency linter for DOCX academic documents. This phase delivers the complete foundation: monorepo scaffolding, DOCX/OOXML parser, AcademicDocument model with source mapping, citation extraction (author-date + numeric families), bibliography detection with confidence scoring, author normalization pipeline, matching engine with weighted scoring, and benchmark dataset with fixture infrastructure.

**Requirements covered:** R001–R009, R020–R021, R046–R051

</domain>

<decisions>
## Implementation Decisions

### Package Structure
- **D-01:** Giữ nguyên 4 packages: `@citesync/document-model`, `@citesync/docx`, `@citesync/core`, `@citesync/cli` — consolidation là kiến trúc cuối cùng cho v0.1. — **Reversibility:** costly — tách packages sau sẽ cần refactor imports, update tsconfig references, thay đổi dependency graph
- **D-02:** Rules (CS001–CS009) giữ trong `@citesync/docx` — tightly coupled với matching engine. — **Reversibility:** costly — rules depend on internal docx types
- **D-03:** Report builder (`buildCliReport`, `serializeReport`) giữ trong `@citesync/core` — output format của lint pipeline. — **Reversibility:** reversible — report module có interface rõ ràng

### Parser Robustness
- **D-04:** Focus vào core academic patterns cho v0.1 — headings, paragraphs, footnotes, endnotes, tables cơ bản. Bỏ qua edge cases hiếm (RTL, nested tables sâu, math equations, tracked changes). — **Reversibility:** reversible — thêm features sau không break existing
- **D-05:** Parser UTF-8 full support — language-neutral. Citation detection chỉ EN+VI. — **Reversibility:** reversible — mở rộng language scope sau
- **D-06:** Failure isolation theo §88 — skip phần lỗi, ghi `ParseIssue`, tiếp tục parse phần còn lại. Không fail fast. — **Reversibility:** one-way — thay đổi error handling strategy sẽ ảnh hưởng toàn bộ error contract với CLI/web
- **D-07:** Structured citations (Zotero CSL_CITATION / Word CITATION fields) ưu tiên hơn plain-text author-date. Priority: structured > author-date > numeric. — **Reversibility:** reversible — priority order có thể adjust

### Matching Accuracy
- **D-08:** Levenshtein distance cho fuzzy matching algorithm — simple, well-understood, tốt cho typo correction. — **Reversibility:** costly — thay đổi algorithm sẽ ảnh hưởng match results trên toàn bộ fixtures
- **D-09:** Vietnamese name matching: diacritic-insensitive + structure-aware — strip diacritics + handle middle names/honorifics (Văn, Thị) separately. — **Reversibility:** costly — thay đổi name normalization sẽ ảnh hưởng match results
- **D-10:** Fixed match thresholds (match ≥ threshold, mismatch < threshold) — deterministic, không configurable qua .citesyncrc cho v0.1. — **Reversibility:** reversible — thêm configurability sau
- **D-11:** Handle core edge cases: same-author-same-year (a/b suffix), hyphenated names. Skip rare suffixes (Jr., Sr., III, Ph.D.) cho v0.1. — **Reversibility:** reversible — thêm suffix handling sau

### Fixture & Benchmark
- **D-12:** Mixed fixture strategy — synthetic fixtures cho edge cases (deterministic) + 2-3 real-world DOCX cho integration testing. — **Reversibility:** reversible — thêm/bớt fixtures bất cứ lúc nào
- **D-13:** Golden file strategy — 5-10 golden files cho representative cases (minimal, author-date, numeric, Vietnamese, multi-author). Không golden file cho mọi fixture. — **Reversibility:** reversible — thêm golden files sau
- **D-14:** 3-5 benchmark documents: small (10p), medium (50p), large (100p), edge-case heavy, Vietnamese. Đủ cho regression testing và performance target verification. — **Reversibility:** reversible — thêm benchmarks sau
- **D-15:** Vietnamese academic documents là fixture riêng — 1-2 Vietnamese fixtures với tên có dấu, bibliography tiếng Việt. Test diacritic handling chuyên biệt. — **Reversibility:** reversible

### Agent's Discretion
Không có area nào user để agent quyết định — tất cả decisions đều có lựa chọn cụ thể từ user.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product & Requirements
- `docs/CiteSync.dev — Product Requirements Document.md` — PRD gốc, chứa §14–§88 chi tiết về parsing, matching, security
- `docs/UI-SPEC.md` — UI specification (cho Phase 3-5, nhưng chứa §7.3 Tailwind và §7.2 testid contract)
- `.planning/PROJECT.md` — Project identity, architecture, locked decisions D001–D018
- `.planning/REQUIREMENTS.md` — 58 requirements R001–R058 với source traceability

### Architecture & Stack
- `.planning/ROADMAP.md` — Phase definitions và requirement mapping
- `.planning/codebase/ARCHITECTURE.md` — Full pipeline architecture S01→S05, module responsibilities, entry points, design patterns
- `.planning/codebase/STACK.md` — TypeScript 5.9.3, npm workspaces, fflate, fast-xml-parser, Vitest, Playwright
- `.planning/codebase/CONVENTIONS.md` — Code style, naming, imports, error handling patterns

### Security & Quality
- `.planning/codebase/CONCERNS.md` — Security concerns và known issues
- `.planning/codebase/TESTING.md` — Test strategy và patterns

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `@citesync/document-model` — Type-only contracts đã define đầy đủ: AcademicDocument, DocumentBlock, SourceLocation, CitationOccurrence, ReferenceEntry, MatchMap, PersonName
- `@citesync/docx` — Engine package đã implement: zip/reader.ts (fflate), xml/ parser, bibliography/detect.ts, citations/, references/, normalize/, match/, rules/
- `@citesync/core` — Public lint surface: lintDocument(), buildCliReport(), createRule()
- `@citesync/cli` — CLI interface: runCli() với arg parsing, report rendering, exit codes

### Established Patterns
- Pure/deterministic stages — mỗi stage là pure function, onStage callback observational only
- Failure isolation (§88) — ParseIssue[] và ReferenceParseIssue[] arrays, không throw
- Conservative bias (§79) — AMBIGUOUS > wrong MATCHED
- Typed error hierarchy — DocxReaderError abstract class, stable `name` discriminator
- Discriminated unions cho multi-state results (MatchState, EntryMatchStatus)

### Integration Points
- `buildModel()` trong `@citesync/docx` — assembler orchestrate S01→S04
- `lintDocument()` trong `@citesync/core` — entry point cho CLI và web
- Web Worker protocol — typed messages cho browser-based analysis
- Golden files trong `docx/tests/golden/` — pin exact JSON output

</code_context>

<specifics>
## Specific Ideas

Không có specific references hoặc "I want it like X" moments — decisions dựa trên analysis của codebase hiện tại và best practices cho academic citation tools.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. Không có scope creep.

</deferred>

---

*Phase: 01-Foundation & Core Engine*
*Context gathered: 2026-08-17*
