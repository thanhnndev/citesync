# CiteSync — Codebase Concerns

> Honest assessment of technical debt, security risks, performance bottlenecks,
> missing features, and dependency concerns. Based on thorough source analysis.

---

## 1. Security Concerns

### 🔴 HIGH — Dynamic RegExp Construction from Document Content

**File:** `packages/docx/src/citations/fields.ts:326-336`

The `fuzzyIndexOf` function builds a `RegExp` from parsed Zotero/Word structured field data embedded in the untrusted .docx. While regex metacharacters ARE escaped, the `\s+` replacement means the compiled pattern's length scales with the display text. A malicious document with an extremely long display string could create a large regex pattern.

**Mitigation:** `XML_STRING_MAX` bounds input size, but no explicit regex-length guard exists. Consider capping pattern length or using `indexOf` with whitespace normalization.

### 🟡 MEDIUM — attrVal Creates New RegExp Per Call

**File:** `packages/docx/src/xml/tag-scan.ts:79-86`

Called for every attribute lookup during XML scanning. Attribute names come from internal constants (low injection risk), but repeated RegExp construction in hot loops adds GC pressure.

### 🟢 LOW — Encrypted Document Handling

Encrypted/password-protected .docx files are rejected with `UnsupportedFormatError`, but the error message doesn't distinguish "encrypted" from "unknown compression."

### ✅ GOOD — Absence Audit

`absence.test.ts` enforces zero occurrences of `fetch()`, `eval()`, `Function()`, `WebSocket()`, `EventSource()`, `XMLHttpRequest`, or dynamic `import()` in production code positions.

### ✅ GOOD — Macro/Remote Content Isolation

Macro-bearing parts and external relationship targets are flagged but never decoded, decompressed, executed, or followed.

### ✅ GOOD — XSS-Safe HTML Export

`apps/web/src/export/html.ts` escapes all report-derived strings through `escapeHtml` with `\u003c`/`\u003e`/`\u0026` escapes.

### ✅ GOOD — Zip Bomb Defense in Depth

Bounds enforced on ACTUAL extracted bytes via streaming inflate. Per-entry (50 MiB), aggregate (200 MiB), entry count (2000), and time budget (1.5s) caps all enforced twice.

---

## 2. Performance Concerns

### 🔴 HIGH — O(citations × entries) Match Complexity

**File:** `packages/docx/src/match/match.ts:162-231`

Every citation occurrence is scored against every bibliography entry. The 100-page fixture (2335 citations × 260 references = ~607K scorings) runs in ~250ms. Scaling:

| Citations | References | Operations | Est. Time |
|---|---|---|---|
| 2,335 | 260 | 607K | ~250ms |
| 5,000 | 500 | 2.5M | ~1s |
| 10,000 | 1,000 | 10M | ~4s |
| 50,000 | 2,000 | 100M | ~40s (exceeds budget) |

**Mitigation:** Consider pre-filter (bloom filter on surname keys, or index by first-author family initial).

### 🟡 MEDIUM — O(n²) Paragraph Flush in Source-Position Scanner

**File:** `packages/docx/src/xml/source-position.ts:334-343`

Every paragraph flush calls `allRuns.filter()` over the ENTIRE accumulated runs array. For P paragraphs and R total runs, this is O(P × R). Tracking a `runStartIndex` and slicing would be O(1) per flush.

### 🟡 MEDIUM — No Streaming/Incremental Processing

The entire .docx is decompressed into memory (up to 200 MiB), then all XML parts are parsed sequentially. The full `AcademicDocument` is held in memory simultaneously. For the 100-page fixture, the structured clone is ~2.5 MB.

### 🟡 MEDIUM — Custom XML Scanner Processes Entire String

`scanWtOffsets` walks the entire XML string character-by-character. The scanner runs twice (source-position + paragraph parser), effectively doubling the work.

### ✅ GOOD — Time Budget Safety Valve

30-second default `timeBudgetMs` checked at coarse pipeline checkpoints. 1.5-second `PROCESSING_TIME_BUDGET_MS` checked between ZIP entries and inflate chunks.

### ✅ GOOD — Per-Item Key Pre-computation

`deriveCitationKeys()` pre-computes citation-side keys once before the per-entry scoring loop.

---

## 3. Technical Debt

### 🟡 MEDIUM — fast-xml-parser Is an Unused Runtime Dependency

**File:** `packages/docx/package.json`

`fast-xml-parser` 5.10.1 is declared as a runtime dependency but is **never imported** in any source file. All XML parsing is done by custom tag-scanning code. Should be moved to `devDependencies` or removed.

### 🟡 MEDIUM — Deliberate Code Duplication in Tag Scanning

**Files:** `packages/docx/src/xml/source-position.ts` and `packages/docx/src/xml/tag-scan.ts`

Both contain near-identical implementations of `scanTagEnd`, `readOpenTag`, `tagName`. Documented as intentional but creates maintenance risk.

### 🟢 LOW — No TODO/FIXME/HACK Comments

Zero TODO, FIXME, HACK, or WORKAROUND comments in any source file under `packages/` or `apps/`.

### 🟢 LOW — All Packages Private, No Public API Surface

Every package is `"private": true` with `"license": "UNLICENSED"`. No published API contract.

---

## 4. Missing Features / Incomplete Areas

### 🟡 MEDIUM — Bibliography Detection Limited to Author-Date Patterns

The `REFERENCE_LIKE_RE` only matches APA-style entries (`Author (Year). Title...`). Numeric bibliography formats are not detected by this regex.

### 🟡 MEDIUM — Table Structure Is Flattened

Deep table structure (rows/cells/grid spans/merges) is OUT OF SCOPE. Citations in table cells lose cell-level context.

### 🟡 MEDIUM — CLI Cannot Read from stdin

Documented as M002 S4 decision: "Input is a single `.docx` FILE PATH — no stdin/pipe."

### 🟢 LOW — No Streaming/WebSocket Progress for Large Documents

The web app sends stage progress via `postMessage`, but no incremental result delivery — entire report sent in final `done` envelope.

### 🟢 LOW — Vietnamese Heading Detection Limited to Two Phrases

Only `'Tài liệu tham khảo'` and `'Danh mục tài liệu tham khảo'` are recognized.

---

## 5. Risk Areas

### 🔴 HIGH — Error Classification by String Name

**Files:** `packages/cli/src/index.ts:61-88`, `apps/web/src/worker/protocol.ts:137-174`

Both classify errors by checking `err.name` against hardcoded strings. Any new error class must remember to set `this.name`, and classifiers must add the new name.

**Mitigation:** Consider a shared error-code enum or discriminated union type.

### 🟡 MEDIUM — Worker Structured Clone Limitations

The entire `AcademicDocument` (~2.5 MB for 100-page fixture) is structured-cloned across the worker boundary. The contract uses only plain interfaces (no Map/Set), but this is implicit, not enforced.

### 🟢 LOW — CLI reads entire file synchronously

`readFileSync` blocks the event loop during read. Acceptable for CLI but worth noting.

### 🟢 LOW — trySave Swallows All Errors

The catch block discards errors entirely — no logging, no type discrimination.

---

## 6. Dependency Risks

### 🔴 HIGH — Node >= 24 Requirement

Node.js 24 is a current release line (not LTS). Limits deployment to environments with older Node.js.

### 🟡 MEDIUM — Cutting-Edge Toolchain Versions

| Dependency | Version | Concern |
|---|---|---|
| TypeScript | 5.9.3 | Very recent |
| Vitest | 4.1.10 | Major version jump |
| Vite | 8.2.1 | Very recent |
| React | 19.2.8 | Recent major version |

Runtime-critical deps (fflate, fast-xml-parser) pinned to exact versions — good for determinism but no automatic security patches.

### 🟡 MEDIUM — fast-xml-parser Attack Surface (Unused)

Ships in Web Worker bundle despite being unused. If a vulnerability is discovered, CiteSync would need to patch.

### 🟢 LOW — No Automated Dependency Auditing

No `npm audit`, Snyk, Dependabot, or similar tools found in repository configuration.

---

## 7. Scalability Concerns

### 🔴 HIGH — Quadratic Citation×Reference Matching

For C citations and R references, the match phase performs C × R operations. Documents with tens of thousands of citations (systematic reviews, meta-analyses) would hit the 30-second time budget.

### 🟡 MEDIUM — Memory Proportional to Document Size

`AcademicDocument` holds everything in memory: blocks, source map, citations, match map, bibliography entries. A 1000-page document could produce 20+ MB, causing noticeable latency in Worker postMessage → React render.

### 🟡 MEDIUM — Single Worker, No Parallelism

One `Worker` per analysis. No document chunking, no parallel rule execution, no multi-document analysis.

---

## Summary — Top Concerns by Severity

| Severity | Concern | Area |
|---|---|---|
| 🔴 HIGH | O(citations × entries) matching — quadratic, no pre-filter | Performance |
| 🔴 HIGH | Error classification by fragile string name matching | Risk |
| 🔴 HIGH | Node >= 24 requirement limits deployment | Dependencies |
| 🔴 HIGH | Dynamic RegExp from document content in fuzzyIndexOf | Security |
| 🟡 MEDIUM | fast-xml-parser unused but shipped as runtime dep | Tech Debt |
| 🟡 MEDIUM | O(n²) paragraph flush in source-position scanner | Performance |
| 🟡 MEDIUM | No streaming processing — full document in memory | Scalability |
| 🟡 MEDIUM | Custom tag-scan code duplicated across modules | Tech Debt |
| 🟡 MEDIUM | Bibliography detection limited to author-date format | Gaps |
| 🟡 MEDIUM | Cutting-edge toolchain versions | Dependencies |
| 🟡 MEDIUM | Table structure flattened | Gaps |
| 🟡 MEDIUM | Worker structured clone sends entire document | Performance |
| 🟢 LOW | No automated dependency auditing | Dependencies |
| 🟢 LOW | trySave swallows all errors silently | Risk |
| 🟢 LOW | No stdin support in CLI | Gaps |
