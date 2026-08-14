# CiteSync — UI-SPEC (M005-S01)

> **Contract thiết kế toàn diện cho UI overhaul M005 (S02–S04).**
> Tài liệu này là nguồn duy nhất (single source of truth) cho design tokens, layout,
> flow map, state inventory và mockup của toàn bộ giao diện web. Mọi slice sau
> (S02 flow phân tích, S03 explorer/evidence/resolution, S04 onboarding/song ngữ/
> responsive) phải triển khai **theo đúng** contract này.

| | |
|---|---|
| **Milestone / Slice** | M005 / S01 |
| **Trạng thái** | Draft v0.1 — chờ review gate (T05) chốt |
| **Phạm vi** | `apps/web` (UI layer) — không đổi engine, worker protocol, report schema |
| **Nguyên tắc bất biến** | Report giữ byte-identical (D024); data-testid FROZEN (5 e2e specs); không LLM trong UI (R012); không đoán mò (§79) |
| **Tham chiếu chính** | PRD (`docs/CiteSync.dev — Product Requirements Document.md`), `apps/web/src/**`, `packages/*/src/**` |

---

## Mục lục

1. [Design Tokens](#1-design-tokens)
2. [Layout System](#2-layout-system)
3. [Flow Map](#3-flow-map)
4. [State Inventory](#4-state-inventory)
5. [Mockups từng màn hình](#5-mockups-từng-màn-hình)
6. [Tham chiếu chéo PRD / Issue types / Components](#6-tham-chiếu-chéo-prd--issue-types--components)
7. [Phụ lục A — FROZEN data-testid inventory](#phụ-lục-a--frozen-data-testid-inventory)
8. [Phụ lục B — Checklist review contract](#phụ-lục-b--checklist-review-contract)

---

# 1. Design Tokens

Tokens được định nghĩa tại đây (contract) và triển khai thành **CSS custom
properties** trong `apps/web/src/design-system.css` (T03), khai báo trên `:root`
của app shell. Tên token theo quy ước:

```text
--cs-{category}-{name}[-{variant}]

category: color | font | space | radius | shadow | z
name:     ngữ nghĩa rõ ràng (bg, fg, border, accent, severity, size, weight, line…)
variant:  trạng thái/bậc (hover, tint, sm, md, lg, 1..8…)
```

**Quy tắc sử dụng:**
- Component chỉ đọc token, **không hardcode** giá trị màu/khoảng cách (trừ giá trị
  độc nhất một lần không có ngữ nghĩa lặp lại).
- Màu severity phải đi kèm **nhãn chữ + marker**, không chỉ dùng màu (PRD §89 —
  accessibility: non-color-only severity indicators).
- Theme dark (S04, optional) chỉ override token trên `[data-theme="dark"]`, không
  đổi component.

## 1.1 Màu sắc (Color)

| Token | Giá trị (light) | Vai trò | Map app.css hiện tại |
|---|---|---|---|
| `--cs-color-bg` | `#f6f8fa` | Nền trang (page background) | `body { background }` |
| `--cs-color-bg-surface` | `#ffffff` | Bề mặt card/panel | `--color-*` card backgrounds |
| `--cs-color-bg-subtle` | `#f6f8fa` | Nền "well" nhạt (row, chip) | `.severity-count`, `.issue-row`, `.recovery-candidate` |
| `--cs-color-bg-hover` | `#eef4ff` | Hover/selected accent-tinted | `.issue-row:hover`, `.drop-zone-dragging` |
| `--cs-color-bg-highlight` | `#fffdf0` | Nền block được highlight trong doc | `.doc-block-highlighted` |
| `--cs-color-fg` | `#1f2328` | Chữ chính | `--color-text` |
| `--cs-color-fg-muted` | `#656d76` | Chữ phụ (caption, meta) | `--color-muted` |
| `--cs-color-fg-inverse` | `#ffffff` | Chữ trên nền accent | `--color-accent` buttons |
| `--cs-color-border` | `#d0d7de` | Viền mặc định | `--color-border` |
| `--cs-color-border-strong` | `#aeb6be` | Viền nổi bật (selected row) | — |
| `--cs-color-accent` | `#1a5cff` | Màu thương hiệu / hành động chính | `--color-accent` |
| `--cs-color-accent-hover` | `#0d47d0` | Accent khi hover | `.export-button:hover` |
| `--cs-color-accent-tint` | `#eef4ff` | Nền tint accent (dragging, selected) | `.drop-zone-dragging`, `.issue-row-selected` |
| `--cs-color-done` | `#1a7f37` | Trạng thái thành công / resolved | `--color-done` |

### 1.1.1 Severity mapping (ERROR / WARNING / AMBIGUOUS / INFO)

Thứ tự canonical `RULE_SEVERITIES` (ERROR → WARNING → AMBIGUOUS → INFO — bảo thủ
nhất trước, D022/D024). Ý nghĩa theo PRD §38:

| Severity | Ý nghĩa (PRD §38) | Token chính | Token tint (nền highlight) | Tint hiện tại |
|---|---|---|---|---|
| `ERROR` | Bằng chứng mạnh về bất nhất thực sự | `--cs-color-severity-error` `#d1242f` | `--cs-color-severity-error-tint` `#ffebe9` | `#ffebe9` |
| `WARNING` | Khả năng cao cần review | `--cs-color-severity-warning` `#9a6700` | `--cs-color-severity-warning-tint` `#fff8c5` | `#fff8c5` |
| `AMBIGUOUS` | Nhiều cách diễn giải hợp lệ | `--cs-color-severity-ambiguous` `#bc4c00` | `--cs-color-severity-ambiguous-tint` `#fff1e5` | `#fff1e5` |
| `INFO` | Pattern tiềm năng, độ tin cậy thấp | `--cs-color-severity-info` `#57606a` | `--cs-color-severity-info-tint` `#eaeef2` | `#eaeef2` |

Quy ước đặt class song song token (đã tồn tại, giữ nguyên):
`severity-error` / `severity-warning` / `severity-ambiguous` / `severity-info`
và `source-highlight-{severity}` cho `<mark>` trong DocumentView.

> Màu severity **không được** dùng đơn lẻ để truyền đạt ý nghĩa — luôn có nhãn
> chữ (ví dụ `ERROR`/`WARNING`) hoặc marker text (PRD §89). Tint dùng cho nền
> highlight trong văn bản để chữ chính giữ độ tương phản.

## 1.2 Typography

Font stacks (giữ nguyên dependency-free — không import font service, offline-first PRD §11):

| Token | Giá trị |
|---|---|
| `--cs-font-sans` | `system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif` |
| `--cs-font-mono` | `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` |

Scale (rem — tương đối, dễ zoom):

| Token | Kích thước | Trọng lượng | Dùng cho |
|---|---|---|---|
| `--cs-font-size-display` | `1.75rem` | 700 | H1 — tiêu đề app (header) |
| `--cs-font-size-h2` | `1.1rem` | 600 | H2 — tiêu đề section/panel |
| `--cs-font-size-h3` | `0.95rem` | 600 | H3 — tiêu đề phụ (evidence refs, group header) |
| `--cs-font-size-body` | `0.95rem` | 400 | Nội dung chính |
| `--cs-font-size-caption` | `0.85rem` | 400 | Caption, meta, hint, badge |
| `--cs-font-size-code` | `0.8rem` | 400 | Code, issue id, stage-name, confidence |
| `--cs-font-size-code-sm` | `0.75rem` | 400 | Code nhỏ (evidence-code, issue-row-id) |
| `--cs-line-height-tight` | `1.25` | — | Heading |
| `--cs-line-height-normal` | `1.5` | — | Body |
| `--cs-font-weight-semibold` | 600 | — | Emphasis vừa |
| `--cs-font-weight-bold` | 700 | — | Counts, badge mạnh |

> Mono bắt buộc cho: `issue.id`, `ruleId`, evidence `code`, `stage-name`,
> confidence số — phân biệt máy đọc được với text người đọc (R012).

## 1.3 Spacing

Scale 4px (8 bậc) + gutter trang:

| Token | Giá trị | Token | Giá trị |
|---|---|---|---|
| `--cs-space-1` | `4px` | `--cs-space-5` | `24px` |
| `--cs-space-2` | `8px` | `--cs-space-6` | `32px` |
| `--cs-space-3` | `12px` | `--cs-space-7` | `48px` |
| `--cs-space-4` | `16px` | `--cs-space-8` | `64px` |
| `--cs-space-page-x` | `16px` (mobile) / `24px` (≥768px) | | |

Quy ước: gap giữa panel liền kề = `--cs-space-5` (24px); padding trong card =
`--cs-space-4` (16px); padding row = `--cs-space-2`/`--cs-space-3`; khoảng cách
header–content = `--cs-space-5`.

## 1.4 Border radius

| Token | Giá trị | Dùng cho |
|---|---|---|
| `--cs-radius-sm` | `4px` | Row, chip, code badge, highlight mark |
| `--cs-radius-md` | `8px` | Card, panel, button, drop-zone (default — map `--radius` hiện tại) |
| `--cs-radius-lg` | `12px` | Modal, large surface (S02+) |
| `--cs-radius-pill` | `999px` | Badge tròn (S02+, processing badge) |

## 1.5 Shadow

| Token | Giá trị | Dùng cho |
|---|---|---|
| `--cs-shadow-sm` | `0 1px 2px rgba(31,35,40,0.08)` | Card nổi nhẹ (default card) |
| `--cs-shadow-md` | `0 4px 12px rgba(31,35,40,0.12)` | Panel nổi / sticky header |
| `--cs-shadow-lg` | `0 12px 32px rgba(31,35,40,0.18)` | Modal, overlay (S02+) |

## 1.6 Z-index

| Token | Giá trị | Dùng cho |
|---|---|---|
| `--cs-z-base` | `0` | Nội dung thường |
| `--cs-z-zone-overlay` | `1` | Overlay file-input trong drop-zone (input phủ toàn zone) |
| `--cs-z-sticky` | `100` | Header sticky (S02+) |
| `--cs-z-overlay` | `1000` | Overlay backdrop |
| `--cs-z-modal` | `1100` | Modal |
| `--cs-z-toast` | `1200` | Toast / inline error nổi (S02+ export failure) |

## 1.7 Bảng đối chiếu hiện tại → token (T03 migration map)

| app.css hiện tại | Token mới |
|---|---|
| `--color-accent` | `--cs-color-accent` |
| `--color-border` | `--cs-color-border` |
| `--color-text` | `--cs-color-fg` |
| `--color-muted` | `--cs-color-fg-muted` |
| `--color-error` | `--cs-color-severity-error` |
| `--color-warning` | `--cs-color-severity-warning` |
| `--color-ambiguous` | `--cs-color-severity-ambiguous` |
| `--color-info` | `--cs-color-severity-info` |
| `--color-done` | `--cs-color-done` |
| `--radius` | `--cs-radius-md` |
| hardcoded `#ffffff`, `#f6f8fa`, `#eef4ff`… | `--cs-color-bg-surface`, `--cs-color-bg-subtle`, `--cs-color-accent-tint`… |

---

# 2. Layout System

## 2.1 Grid + Breakpoints (desktop-first)

Desktop-first (PRD §56 — mobile secondary, "mobile dùng được cơ bản"):
thiết kế cho desktop trước, mobile là phái sinh (stack + thu gọn), không ngược lại.

| Breakpoint | Phạm vi | Chiến lược |
|---|---|---|
| `--cs-bp-wide` | `≥ 1024px` | Full desktop: container 1080px, explorer 2 cột |
| `--cs-bp-narrow` | `768–1023px` | Desktop hẹp: container 1080px (hoặc 100% − gutters), explorer 2 cột |
| `--cs-bp-tablet` | `481–767px` | Tablet/mobile ngang: explorer **xếp chồng 1 cột** |
| `--cs-bp-mobile` | `≤ 480px` | Mobile nhỏ: gutters 16px, touch targets ≥ 40px |

Breakpoint hiện tại (giữ nguyên trong T03): explorer chuyển 2 cột → 1 cột tại
`max-width: 700px` (`apps/web/src/app.css` — `.explorer-layout`). Contract cho
S02–S04: chuẩn hóa về media queries dùng token breakpoint.

```css
:root {
  --cs-bp-wide: 1024px;
  --cs-bp-narrow: 768px;
  --cs-bp-tablet: 767px;   /* max-width */
  --cs-bp-mobile: 480px;   /* max-width */
}
```

Grid cơ bản (không dùng framework — vanilla, T02 decision):

```text
.desktop (≥768px)                    .mobile (<768px)
┌─────────────────────────────┐      ┌──────────────────────┐
│ header (full width)         │      │ header (full width)  │
├─────────────────────────────┤      ├──────────────────────┤
│ flow-column (≤720px, giữa)  │      │ flow-column (stack)  │
│ ┌─────────────────────────┐ │      ├──────────────────────┤
│ │ drop / stages / report  │ │      │ explorer (1 cột)     │
│ │ / export / error        │ │      │  issues              │
│ └─────────────────────────┘ │      │  doc + evidence      │
├─────────────────────────────┤      │  + picker            │
│ explorer-layout (full, 2 cột)│     ├──────────────────────┤
│ ┌────────────┬────────────┐ │      │ footer               │
│ │ issues     │ doc +      │ │      └──────────────────────┘
│ │ (1fr)      │ evidence   │ │
│ │            │ + picker   │ │
│ │            │ (1.35fr)   │ │
│ └────────────┴────────────┘ │
├─────────────────────────────┤
│ footer (full width)         │
└─────────────────────────────┘
```

## 2.2 App shell (header / main / footer)

| Vùng | Thành phần | Nội dung | Token |
|---|---|---|---|
| `.app-shell` | container | `max-width: 1080px`, `margin-inline: auto`, `padding: 24px 16px 48px` (page-x 16px, mobile 24px) | `--cs-space-5`, `--cs-space-page-x`, `--cs-space-8` |
| `.app-header` | header | H1 `CiteSync` + `.processing-badge` (luôn mounted — badge text đổi theo state, FROZEN testid `processing-badge`) | display size, flex baseline, gap 12px |
| `.app-main` | main | Render theo state machine (mục 3): drop → stages → report/explorer → export | stack, gap 20px (`--cs-space-5`) |
| `.app-footer` | footer | **Mới (S04)**: dòng privacy `Processed locally — never left this device` + links (GitHub, README) | caption, muted |

- **flow-column** (drop, stages, report-summary, export-panel, error-panel,
  recovery-panel): `max-width: 720px`, căn giữa trong shell — vùng tương tác
  "một cột" trước khi vào explorer.
- **explorer-layout** (done state): grid 2 cột `minmax(0,1fr) minmax(0,1.35fr)`,
  `align-items: start`, gap `20px`; cột phải `.doc-column` là stack dọc
  (DocumentView → EvidencePanel → ResolutionPicker).
- Các panel dùng chung kiểu surface: `background: var(--cs-color-bg-surface)`,
  `border: 1px solid var(--cs-color-border)`, `border-radius: var(--cs-radius-md)`,
  `padding: var(--cs-space-4)`.

## 2.3 Sticky header (S02+, target)

Header có thể sticky (`position: sticky; top: 0; z-index: var(--cs-z-sticky)`,
nền `--cs-color-bg` mờ) để badge trạng thái luôn thấy khi scroll trong explorer —
triển khai ở S02, không bắt buộc trong T03.

---

# 3. Flow Map

## 3.1 Sơ đồ transition tổng thể

```text
                    ┌────────────────────────────────────────────────────────┐
                    │                        SHELL                           │
                    │  status = idle (empty)                                │
                    └─────────────────────────┬──────────────────────────────┘
                                              │ drop .docx (hợp lệ)
                                              ▼
                    ┌────────────────────────────────────────────────────────┐
                    │  status = analyzing  (stages: ✓ ● ○ checklist)        │
                    └──────────────┬───────────────────────┬─────────────────┘
                         done (thành công)                │ error envelope
                                   ▼                       ▼
        ┌────────────────────────────────────┐   ┌──────────────────────────┐
        │  status = done  (report summary)   │   │ status = error (error-   │
        │  + ExportPanel + explorer-layout   │   │ panel; stages giữ lại —  │
        │  + recovery-panel nếu cần          │   │ biết đã chạy tới đâu)    │
        └───────┬────────────────────┬───────┘   └──────────────────────────┘
                │                    │
      select issue (click row)       │ export JSON / HTML
                ▼                    ▼
   doc highlight + evidence     browser download
   + resolution picker (nếu     (filenames từ report.meta.file)
   AMBIGUOUS resolvable)
                │
      recovery re-run:
   bibliography below-threshold
                ▼
   user picks section → rerun({bibliographyBlockIds:[id]}) → analyzing (reset selection, R008)
```

## 3.2 Chi tiết từng transition + state

| # | Transition | Điều kiện | Từ → Đến | State trung gian | Reset |
|---|---|---|---|---|---|
| T1 | `empty → analyzing` | Người dùng drop/chọn file `.docx` hợp lệ (client-side validate extension) | `idle` → `analyzing` | — | `stages: []`, `selectedIssueId: undefined` (R008) |
| T2 | `drop invalid file` | File không đuôi `.docx` | `idle` → `idle` (giữ nguyên) | inline message `drop-zone-invalid`, **không** vào worker | — |
| T3 | `analyzing → analyzing` | Mỗi message `stage` đến (thứ tự cố định `PIPELINE_STAGES`, D025) | stages append, checklist cập nhật ✓/●/○ | badge: `Processing locally` | — |
| T4 | `analyzing → done` | envelope `done {report, doc, stages}` | → report summary + explorer + export | badge: `Processed locally — never left this device` | — |
| T5 | `analyzing → error` | envelope `error {name, message}` (classifyWorkerError, D021) | → error-panel | stages giữ lại (đã chạy tới đâu), badge trở về text idle | — |
| T6 | `done → doc highlight` | Click issue row | `selectedIssueId` set → DocumentView scroll-to-center + `<mark>` severity-tint; EvidencePanel + possible refs render; picker nếu resolvable | — | — |
| T7 | `done → done` (đổi selection) | Click row khác | selection cũ bỏ highlight, row mới nổi bật | — | — |
| T8 | `done → recovery` | `doc.bibliography.outcome === 'below-threshold'` | recovery-panel xuất hiện dưới explorer | — | — |
| T9 | `recovery → analyzing` | User click `Use this section` | `rerun({bibliographyBlockIds:[blockId]})` → `analyzing` với SAME bytes (retained copy) | `selectedIssueId: undefined` (R008) | generation bump — race-safe |
| T10 | `done → export` | Click `Download JSON report` / `Download HTML report` | `saveTextFile(serializeReport|buildHtmlReport, filename từ report.meta.file)` | — | — |
| T11 | `analyzing → analyzing` (race) | Drop file mới khi đang analyze | generation cũ trở thành no-op (stale callbacks bị loại) | — | generation counter |

## 3.3 Flow lỗi chi tiết (envelope → UI)

Worker gửi `error {name, message}`; UI map qua `describeWorkerError` (R016) —
đây là **toàn bộ** tập lỗi chạm UI (protocol.ts):

| err.name (stable, D021) | Mô tả | UI message (EN frozen — hiện tại) | State |
|---|---|---|---|
| `NotADocxError` | Không phải DOCX | "This file does not look like a DOCX document. Try a .docx file exported from Word or Google Docs." | error |
| `ZipBombError` | Quá giới hạn an toàn (oversize/zip bomb) | "This document was rejected for safety — it exceeds the size limits." | error |
| `ParseFailureError` | Parse thất bại | "The document could not be parsed." | error |
| `UnsupportedFormatError` | Format không hỗ trợ (mã hóa/compression lạ) | "This DOCX uses an unsupported format (encryption or unknown compression)." | error |
| `TimeBudgetExceededError` | Vượt time budget (R016) | "The analysis took too long and was stopped to keep the app responsive." | error |
| khác | Worker crash / lỗi không biết | `Unexpected error: {name}` | error |

> Toàn bộ lỗi chạy về **cùng một error-panel** (FROZEN testid `error-panel`,
> `role="alert"`) — không có panel lỗi riêng lẻ; nội dung phân biệt bằng
> `describeWorkerError(name)` + `message` gốc. Stages đạt được trước lỗi vẫn hiển
> thị (failure isolation, PRD §88).

---

# 4. State Inventory

Quy ước trạng thái của MỌI màn: `empty` / `loading` / `error` / `success`.
`n/a` = trạng thái không tồn tại về mặt cấu trúc cho màn đó (ghi rõ lý do).
**Error states KHÔNG được thiếu** — mỗi màn phải khai đủ error path (parse-failure,
oversize, unsupported, worker error, export failure, time-budget) dù chúng có thể
dùng chung một surface (error-panel).

## 4.1 Màn DROP (DropZone — `apps/web/src/components/DropZone.tsx`)

| State | Mô tả | UI | testid/class |
|---|---|---|---|
| **empty** | Chưa có file | Title "Drop a .docx file here", hint "or click to choose — analysis runs locally in your browser" | `drop-zone`, `file-input` |
| **loading** | n/a — `File.arrayBuffer()` gần như tức thời; trạng thái chờ thực sự thuộc màn ANALYZE | — | — |
| **error — invalid type** | File không đuôi `.docx` (client-side validate) | Inline message `"{name}" is not a .docx file. Choose a Word document saved as .docx.` — giữ nguyên màn, **không** gửi worker | class `drop-zone-invalid` |
| **error — parse/oversize/unsupported/time-budget/worker** | Worker trả envelope lỗi | error-panel toàn shell (mục 3.3) — màn drop mất đi vì status ≠ idle | `error-panel` |
| **success** | File hợp lệ được chấp nhận | → `analyzing` (T1); badge đổi text | — |

## 4.2 Màn ANALYZE (StageChecklist — `apps/web/src/components/StageChecklist.tsx`)

| State | Mô tả | UI | testid/class |
|---|---|---|---|
| **empty** | n/a — chỉ tồn tại khi `analyzing` hoặc đã chạy | — | — |
| **loading** | Đang chạy pipeline | Checklist 5 stages theo `PIPELINE_STAGES` (D025): ✓ done / ● current / ○ pending + badge "Processing locally" | `stage-{stage}` (5 items) |
| **error — worker error** | envelope lỗi giữa chừng | error-panel + **stages giữ lại** (biết đã chạy tới đâu) | `error-panel` |
| **error — time-budget** | `TimeBudgetExceededError` | error-panel với message friendly (R016) | `error-panel` |
| **success** | `done` envelope | checklist đủ 5 ✓ (persist sau done — e2e assert) → report | `stage-*` |

## 4.3 Màn REPORT (ReportSummary — `apps/web/src/components/ReportSummary.tsx`)

| State | Mô tả | UI | testid/class |
|---|---|---|---|
| **empty** | n/a — chỉ render ở `done` | — | — |
| **loading** | n/a — dữ liệu từ envelope frozen (D024), render đồng bộ | — | — |
| **error** | n/a về mặt cấu trúc (report luôn renderable từ envelope; không có lỗi render riêng — nếu có, là bug không phải state) | — | — |
| **success — có issue** | counts theo `RULE_SEVERITIES` order + meta line | Severity counts `{ERROR} {WARNING} {AMBIGUOUS} {INFO}` + `{citations} citations · {references} references · {ruleIds.length} rules applied` | `report-summary` |
| **success — zero issue** | Không có issue nào (PRD §62) | counts đều 0; explorer hiện "No issues found." — message "Citation consistency looks good" là polish S02 | `report-summary`, `explorer` |

## 4.4 Màn EXPLORER (IssueExplorer + DocumentView + EvidencePanel + ResolutionPicker)

| State | Mô tả | UI | testid/class |
|---|---|---|---|
| **empty — issues** | Không issue nào | "No issues found." (explorer) | `explorer` |
| **empty — doc** | Không block body nào | "No document content." (doc-view) | `doc-view` |
| **empty — evidence refs** | Join không khớp entry nào (matcher data, §79 no-guess) | "No references matched" | `evidence-panel` |
| **empty — picker** | n/a — picker **không bao giờ** render rỗng: `resolutionCandidatesForIssue` trả `null` khi không có candidate (entry-scoped/không AMBIGUOUS/below-threshold → không offer) | — | — |
| **loading** | n/a — surface chỉ tồn tại ở `done` (không async trong explorer) | — | — |
| **error — stale selection** | `selectedIssueId` không còn tồn tại trong issue list mới (recovery re-run reset R008) | Render nothing — guard mềm, không crash | — |
| **error — missing block** | `sourceLoc.blockId` không có trong `doc.blocks` | Block render plain, **không** highlight giả (§79) | `doc-view` |
| **success** | Groups theo severity, click-to-source, evidence, picker | Row selected: class `issue-row-selected` + highlight `<mark data-testid="source-highlight">`; resolved: chip `Resolved → {label}` + class `issue-row-resolved`; group header `{n} resolved` | `severity-group-{severity}`, `issue-row-{id}`, `source-highlight`, `evidence-code-{code}`, `possible-ref-{entryId}`, `resolution-*` |

## 4.5 Màn EXPORT (ExportPanel — `apps/web/src/components/ExportPanel.tsx`)

| State | Mô tả | UI | testid/class |
|---|---|---|---|
| **empty** | n/a — chỉ render ở `done` | — | — |
| **loading** | n/a — download đồng bộ (blob + anchor click) | — | — |
| **error — export failure** | ⚠️ **GAP hiện tại (cần thiết kế S02/S03)**: `saveTextFile` fire-and-forget, không có surface lỗi nếu download bị chặn/throw (popup blocker, quota, browser hỏng blob). Contract: thêm surface lỗi inline/toast `--cs-z-toast` với message "Export failed. Try again." — KHÔNG được silent fail | **chưa có** (thiết kế target) | mới: `export-error` |
| **success** | Download JSON (serializeReport — byte-identical với CLI, D024) / HTML (buildHtmlReport) | Buttons `Download JSON report` / `Download HTML report`; filename từ `exportJsonFilename`/`exportHtmlFilename` (dựa `report.meta.file`) | `export-panel`, `export-json`, `export-html` |

## 4.6 Màn RECOVERY (BibliographyRecoveryPanel — `apps/web/src/components/BibliographyRecoveryPanel.tsx`)

| State | Mô tả | UI | testid/class |
|---|---|---|---|
| **empty — candidates** | Defensive: `candidates` rỗng dù `outcome === 'below-threshold'` | "No candidates available." (không đoán — §79) | `recovery-panel` |
| **loading** | n/a — panel tĩnh; re-run thuộc màn ANALYZE | — | — |
| **error** | n/a — re-run thất bại sẽ rơi vào error-panel (T9) | — | — |
| **success** | `outcome === 'below-threshold'` (chỉ render case này; outcome khác → `null`) | Giải thích + list candidate (heading, type label, confidence 2 chữ số) + nút `Use this section` | `recovery-candidate-{blockId}`, `recovery-use-{blockId}` |

## 4.7 Màn ONBOARDING (S04 — mới, chưa tồn tại trong code)

| State | Mô tả | UI |
|---|---|---|
| **empty** | n/a — nội dung tĩnh | — |
| **loading** | n/a | — |
| **error** | n/a | — |
| **success** | Hero + privacy badges + how-it-works + supported styles + CTA drop zone (mockup mục 5.9) | — |

## 4.8 Ma trận phủ error states (bắt buộc — checklist T05 #4)

| Error path | Drop | Analyze | Report | Explorer | Export |
|---|---|---|---|---|---|
| parse-failure (`ParseFailureError`) | ✅ error-panel | ✅ error-panel + stages | n/a | n/a | n/a |
| oversize (`ZipBombError`) | ✅ error-panel | ✅ error-panel | n/a | n/a | n/a |
| unsupported (`NotADocxError`, `UnsupportedFormatError`) | ✅ (invalid type inline + error-panel) | ✅ error-panel | n/a | n/a | n/a |
| worker error (generic `Error`) | ✅ error-panel | ✅ error-panel | n/a | n/a | n/a |
| export failure | n/a | n/a | n/a | n/a | ⚠️ gap — thiết kế target S02 |
| time-budget (`TimeBudgetExceededError`) | ✅ error-panel | ✅ error-panel | n/a | n/a | n/a |

---

# 5. Mockups từng màn hình

Wireframe ASCII — mô tả cấu trúc, không phải pixel-perfect. Ký hiệu:
`[testid]` = anchor data-testid (FROZEN — Phụ lục A), `{x}` = dynamic content,
`▷` = trạng thái current.

## 5.1 Drop screen (empty — DropZone)

```text
┌──────────────────────────────────────────────────────────────┐
│ CiteSync                                    [processing-badge]│
│                                             Ready — analysis  │
│                                             runs locally in   │
│                                             your browser      │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   ┌──────────────────────────────────────────────────────┐   │
│   │ [drop-zone] (dashed border, radius-md)               │   │
│   │                                                      │   │
│   │            Drop a .docx file here                    │   │
│   │     or click to choose — analysis runs locally       │   │
│   │     in your browser                                  │   │
│   │                                                      │   │
│   │   [file-input]  ← invisible overlay phủ toàn zone    │   │
│   │                                                      │   │
│   │   ─── dragging state ────────────────────────────    │   │
│   │   border → accent, bg → accent-tint,                │   │
│   │   title → "Drop to analyze"                         │   │
│   └──────────────────────────────────────────────────────┘   │
│                                                              │
│   ─── error: invalid file (client-side) ─────────────────    │
│   ┌──────────────────────────────────────────────────────┐   │
│   │  "notes.pdf" is not a .docx file. Choose a Word       │   │
│   │  document saved as .docx.            [drop-zone-      │   │
│   │  (class .drop-zone-invalid, severity-error)           │   │
│   └──────────────────────────────────────────────────────┘   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**PRD:** §58 hero, §60 empty state, §63 error-recovery. **Component:** DropZone.
**State:** 4.1. Tham chiếu: badge idle text.

## 5.2 Stages screen (analyzing — StageChecklist)

```text
┌──────────────────────────────────────────────────────────────┐
│ CiteSync                                    [processing-badge]│
│                                             Processing       │
│                                             locally          │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Analysis stages                                       │  │
│  │                                                        │  │
│  │  ✓ Reading document              [stage-reading-        │  │
│  │  ✓ Detecting bibliography        [stage-detecting-      │  │
│  │  ✓ Finding citations              [stage-finding-       │  │
│  │  ● Matching references            [stage-matching-      │  │
│  │  ○ Running checks                 [stage-running-       │  │
│  │     marker: ✓ done(green) ● current(accent) ○ pending  │  │
│  │     + code stage-name (mono, muted) bên phải            │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│   ─── error giữa chừng (stages giữ lại) ─────────────────    │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ [error-panel] role=alert                               │  │
│  │  The document could not be parsed.      (strong)       │  │
│  │  {error.message gốc từ worker}          (muted)        │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

**PRD:** §61 analysis state, §63 error, §88 failure isolation. **Component:**
StageChecklist + error-panel (App). **State:** 4.2. Tham chiếu: PIPELINE_STAGES
(D025), classifyWorkerError (D021/R016).

## 5.3 Report summary (done — ReportSummary)

```text
┌──────────────────────────────────────────────────────────────┐
│ CiteSync                                    [processing-badge]│
│                                             Processed        │
│                                             locally — never  │
│                                             left this device │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Report                        [report-summary]         │  │
│  │                                                        │  │
│  │  [ERROR 3]  [WARNING 5]  [AMBIGUOUS 2]  [INFO 1]      │  │
│  │   severity-count chips: name + value, tint theo mức    │  │
│  │                                                        │  │
│  │  132 citations · 87 references · 10 rules applied      │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Export                        [export-panel]           │  │
│  │  [Download JSON report]  [Download HTML report]        │  │
│  │   [export-json]           [export-html]                │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**PRD:** §39 core report, §45 export, §62 success. **Components:** ReportSummary,
ExportPanel. **State:** 4.3, 4.5. Tham chiếu: CliReport (D024), RULE_SEVERITIES
order (D022), serializeReport byte-identical (D024).

## 5.4 Issue explorer + Document view (done — IssueExplorer + DocumentView)

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ CiteSync                                          [processing-badge]     │
│                                                  Processed locally…      │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────────────────┬─────────────────────────────────────┐  │
│  │ Issues        [explorer]     │ Document           [doc-view]       │  │
│  │                              │                                     │  │
│  │ ┌──────────────────────────┐ │ ┌─────────────────────────────────┐ │  │
│  │ │ ERROR            3       │ │ │ …The results suggest that       │ │  │
│  │ │ [severity-group-ERROR]   │ │ │ <mark class="source-highlight   │ │  │
│  │ │ ┌──────────────────────┐ │ │ │  source-highlight-error"        │ │  │
│  │ │ │ CS001:001            │ │ │ │  data-testid="source-highlight" │ │  │
│  │ │ │ Smith (2023) → no    │ │ │ │ >Smith (2023)</mark> contradicts│ │  │
│  │ │ │ matching reference   │ │ │ │ earlier findings…               │ │  │
│  │ │ │ [issue-row-CS001:001]│ │ │ └─────────────────────────────────┘ │  │
│  │ │ │  ── selected ──      │ │ │  (scrollIntoView center —          │  │
│  │ │ │  (accent border+tint)│ │ │   block đc highlight cả block nếu  │  │
│  │ │ └──────────────────────┘ │ │   entry-scoped: CS002/005/006/009) │  │
│  │ │ ┌──────────────────────┐ │ └─────────────────────────────────────┘ │  │
│  │ │ │ CS004:002            │ │                                         │  │
│  │ │ │ Nguyen (2023) is     │ │                                         │  │
│  │ │ │ ambiguous  ⏺chosen   │ │                                         │  │
│  │ │ └──────────────────────┘ │                                         │  │
│  │ │  (resolved: class        │                                         │  │
│  │ │   issue-row-resolved +   │                                         │  │
│  │ │   chip "Resolved → …")   │                                         │  │
│  │ │                          │                                         │  │
│  │ │ WARNING           5      │                                         │  │
│  │ │ AMBIGUOUS          2     │                                         │  │
│  │ │ INFO              1      │                                         │  │
│  │ │  (group header: name +   │                                         │  │
│  │ │   count + "{n} resolved")│                                         │  │
│  │ └──────────────────────────┘                                         │  │
│  │  empty: "No issues found."                                           │  │
│  └──────────────────────────────┬─────────────────────────────────────┘  │
│                                 │ (cột phải: stack doc → evidence →      │
│                                 │  picker, chỉ khi có selection)         │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
  grid: 1fr / 1.35fr (≥768px); <768px: 1 cột xếp chồng (issues trên, doc dưới)
```

**PRD:** §40 main results UI, §41 issue interaction, §16 source mapping.
**Components:** IssueExplorer, DocumentView. **State:** 4.4. Tham chiếu:
groupIssuesBySeverity (R008 order), sourceSpanForIssue/highlightParts (R009,
MEM013 UTF-16), entry-scoped whole-block highlight (MEM074, §79 no-guess).

## 5.5 Evidence panel (selected issue — EvidencePanel)

```text
┌──────────────────────────────────────────────────────────────┐
│ Evidence                              [evidence-panel]       │
│                                                              │
│  CS004:002   Nguyen (2023) is ambiguous                      │
│  (mono id)   (message)                                       │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ [evidence-code-AMBIGUOUS_CANDIDATES]                   │  │
│  │  Matches multiple bibliography entries                 │  │
│  │  _Nguyen, T. (2023). Deep learning…_  (source italic)  │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ [evidence-code-CANDIDATE_COUNT]                        │  │
│  │  2 candidate entries matched                           │  │
│  │  _Nguyen, T. (2023). Deep learning…_                   │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  Possible references                                         │
│  • Nguyen, T. (2023) — Deep learning for NLP        [possible-│
│  • Nguyen, H. (2023) — Advances in NLP               ref-{id}]│
│  empty: "No references matched" (join matcher data, §79)      │
└──────────────────────────────────────────────────────────────┘
```

**PRD:** §42 evidence panel, §26 matching, §64 confidence display.
**Component:** EvidencePanel. **State:** 4.4. Tham chiếu: LintEvidence codes
(machine-readable, NEVER LLM — R012), possibleReferencesForIssue (region join
matchMap + numericIndexMap).

## 5.6 Resolution picker (AMBIGUOUS resolvable — ResolutionPicker)

```text
┌──────────────────────────────────────────────────────────────┐
│ Resolve ambiguity                    [resolution-picker]     │
│ (viền severity-ambiguous, title màu ambiguous)              │
│                                                              │
│ Which reference is this citation pointing at? Your choice    │
│ stays in this session only — the document is never modified. │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Nguyen, T. (2023) — Deep learning for NLP   [Choose]   │  │
│  │                                          [resolution-  │  │
│  │                                           candidate-…] │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Nguyen, H. (2023) — Advances in NLP        [Chosen ✓]  │  │
│  │  (chosen: border ambiguous + tint, nút [resolution-    │  │
│  │   aria-pressed=true, "Chosen")            choose-…]    │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  Chọn lại → upsert cùng citationId (SessionResolution key), │
│  không duplicate; resolved chip cập nhật ở explorer (R013)   │
└──────────────────────────────────────────────────────────────┘
```

**PRD:** §43 user corrections, §31 CS004. **Component:** ResolutionPicker.
**State:** 4.4 (picker không bao giờ render rỗng — §79). Tham chiếu:
resolutionCandidatesForIssue (chỉ AMBIGUOUS span-scoped, có candidate),
referenceLabel (một label dùng chung: picker + chip + possible-refs).

## 5.7 Export panel (done — ExportPanel)

```text
┌──────────────────────────────────────────────────────────────┐
│ Export                                 [export-panel]       │
│                                                              │
│  [ Download JSON report ]   [ Download HTML report ]         │
│        [export-json]              [export-html]              │
│                                                              │
│  JSON: serializeReport(report) — byte-identical với CLI      │
│  --json (D024); HTML: buildHtmlReport (standalone, breakout- │
│  safe). Filename: exportJsonFilename/exportHtmlFilename từ   │
│  report.meta.file.                                            │
│                                                              │
│  ─── export failure (thiết kế target S02) ──────────────    │
│  [toast/inline] Export failed. Try again.     [export-error] │
└──────────────────────────────────────────────────────────────┘
```

**PRD:** §45 export, §49–50 CLI parity. **Component:** ExportPanel +
export/download.ts + export/html.ts + export/filenames.ts. **State:** 4.5.
Tham chiếu: saveTextFile (blob + deferred revokeObjectURL).

## 5.8 Bibliography recovery (below-threshold — BibliographyRecoveryPanel)

```text
┌──────────────────────────────────────────────────────────────┐
│ Select the bibliography section          [recovery-panel]    │
│                                                              │
│ No single bibliography heading cleared the confidence        │
│ threshold — choose the section below to re-run the analysis  │
│ with it.                                                     │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Tài liệu tham khảo                       [Use this      │  │
│  │ Exact bibliography heading  0.92         section]       │  │
│  │                                            [recovery-   │  │
│  │  (heading bold + type label + confidence mono)  use-…]  │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ References                              [Use this      │  │
│  │ Heading style               0.71        section]       │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  → rerun({bibliographyBlockIds:[blockId]}) → analyzing      │
│    (SAME retained bytes, selection reset — R008/T9)          │
│  empty (defensive): "No candidates available."               │
└──────────────────────────────────────────────────────────────┘
```

**PRD:** §17 bibliography detection, §63 ask-user recovery, §79 never-guess
(R004: engine không tự chọn dưới threshold). **Component:**
BibliographyRecoveryPanel. **State:** 4.6. Tham chiếu: headingType signals
(exact/style/position/reference-segment/none), rerun seam (lastInputRef copy).

## 5.9 Onboarding (S04 — mới, contract cho slice sau)

```text
┌──────────────────────────────────────────────────────────────┐
│ CiteSync                                     [processing-badge]│
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   ┌──────────────────────────────────────────────────────┐   │
│   │  ESLint for your citations.                          │   │
│   │  Find missing, unused, and inconsistent references   │   │
│   │  before you submit.                                  │   │
│   │                                                      │   │
│   │  [ Drop your DOCX ]   ← cùng drop-zone surface       │   │
│   │                                                      │   │
│   │  Your manuscript never leaves your device.           │   │
│   └──────────────────────────────────────────────────────┘   │
│                                                              │
│   Privacy badges (grid, caption):                            │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│   │ 100%     │ │ No       │ │ No       │ │ Open     │       │
│   │ local    │ │ account  │ │ upload   │ │ source   │       │
│   └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
│                                                              │
│   How it works (3 bước, numbered):                           │
│   1. Drop your thesis.docx     2. CiteSync analyzes locally  │
│   3. Review evidence & export                                │
│                                                              │
│   Supported: APA-like · Harvard-like · IEEE-like ·           │
│              Vancouver-like · Tài liệu tham khảo (VI)        │
└──────────────────────────────────────────────────────────────┘
```

**PRD:** §58 homepage hero, §59 product proof, §7 initial styles, §54 VI
bibliography headings. **Component:** mới (S04). **State:** 4.7.

---

# 6. Tham chiếu chéo PRD / Issue types / Components

## 6.1 Ma trận màn hình ↔ PRD ↔ Component

| Màn (UI-SPEC) | PRD | Component (apps/web) | Trạng thái hiện tại |
|---|---|---|---|
| Drop | §58–60, §63 | `DropZone.tsx` | ✅ có |
| Stages | §61, §63, §88 | `StageChecklist.tsx` | ✅ có |
| Report summary | §39, §62 | `ReportSummary.tsx` | ✅ có |
| Issue explorer | §40–41, §16 | `IssueExplorer.tsx` | ✅ có |
| Document view | §40–41, §16 | `DocumentView.tsx` | ✅ có |
| Evidence panel | §42, §26, §64 | `EvidencePanel.tsx` | ✅ có |
| Resolution picker | §43, §31 | `ResolutionPicker.tsx` | ✅ có |
| Export | §45, §49–50 | `ExportPanel.tsx` + `export/*` | ✅ có |
| Bibliography recovery | §17, §63, §79 | `BibliographyRecoveryPanel.tsx` | ✅ có |
| Onboarding | §58–59, §7, §54 | — | 🔜 S04 (mockup 5.9) |
| Error panel (shell-level) | §63, §88, §13 | App.tsx (`error-panel`) | ✅ có |

## 6.2 Issue types (CS001–CS010) ↔ severity ↔ UI surface

| Rule | PRD | Severity | Nội dung | UI surface (UI-SPEC) | Scope highlight |
|---|---|---|---|---|---|
| CS001 | §28 | ERROR | Missing reference | issue row + evidence "no matching reference" | span |
| CS002 | §29 | WARNING | Unused reference | issue row; possible-refs = entries trong block | **entry** (cả block) |
| CS003 | §30 | WARNING | Year mismatch | issue row + evidence (author 100% / year 0%) | span |
| CS004 | §31 | AMBIGUOUS | Ambiguous author-date | issue row + **resolution picker** (nếu resolvable) | span |
| CS005 | §32 | WARNING | Missing year suffix | issue row | **entry** (cả block) |
| CS006 | §33 | ERROR | Invalid numeric citation | issue row | **entry** (cả block) |
| CS007 | §34 | ERROR | Missing numeric reference (range gap) | issue row + evidence | span |
| CS008 | §35 | WARNING | Unused numeric reference | issue row | span |
| CS009 | §36 | WARNING | Duplicate reference | issue row (conservative) | **entry** (cả block) |
| CS010 | §37 | INFO | Citation parse failure | issue row ("Potential citation could not be interpreted") | span |

> Ghi chú scope: issue **span-scoped** (có `startOffset`/`endOffset`) → highlight
> đúng span; issue **entry-scoped** (chỉ `blockId` — CS002/CS005/CS006/CS009,
> MEM074) → highlight **cả block**, UI không bao giờ đoán span (§79).
> Picker chỉ xuất hiện cho CS004 AMBIGUOUS span-scoped có candidate —
> `resolutionCandidatesForIssue` trả `null` cho mọi case khác.

## 6.3 Severity model (PRD §38) — nhắc lại cho UI

| Severity | Ý nghĩa | Hiển thị |
|---|---|---|
| ERROR | Bằng chứng mạnh về bất nhất thực sự | nhãn chữ + màu + tint highlight |
| WARNING | Khả năng cao cần review | nhãn chữ + màu + tint highlight |
| AMBIGUOUS | Nhiều cách diễn giải hợp lệ | nhãn chữ + màu + tint; picker khi resolvable |
| INFO | Pattern tiềm năng, độ tin cậy thấp | nhãn chữ + màu + tint |

---

# Phụ lục A — FROZEN data-testid inventory

Danh sách FACTUAL các data-testid hiện có (đọc từ source) — 5 e2e specs tham
chiếu: `smoke.spec.ts`, `explorer.spec.ts`, `resolution.spec.ts`, `export.spec.ts`,
`perf.spec.ts`. Chính sách (quy ước testid mới, khi nào được rename) do **T02**
ghi vào section quyết định — appendix này chỉ chốt hiện trạng contract.

| testid | Element | Component | E2E dùng |
|---|---|---|---|
| `file-input` | input[type=file] | DropZone | smoke, explorer, resolution, export, perf |
| `drop-zone` | section | DropZone | smoke |
| `processing-badge` | p[role=status] — luôn mounted, text đổi theo state | App header | smoke, perf |
| `stage-{stage}` | li (5 items theo `PIPELINE_STAGES`) | StageChecklist | smoke |
| `report-summary` | section | ReportSummary | smoke |
| `export-panel` | section (chỉ done) | ExportPanel | export |
| `export-json` | button | ExportPanel | export |
| `export-html` | button | ExportPanel | export |
| `explorer` | section | IssueExplorer | explorer |
| `severity-group-{severity}` | div | IssueExplorer | explorer |
| `issue-row-{id}` | button | IssueExplorer | explorer, resolution |
| `doc-view` | section | DocumentView | explorer |
| `source-highlight` | mark | DocumentView | explorer |
| `evidence-panel` | section | EvidencePanel | explorer |
| `evidence-code-{code}` | code | EvidencePanel | explorer |
| `possible-ref-{entryId}` | li | EvidencePanel | explorer |
| `resolution-picker` | section | ResolutionPicker | resolution |
| `resolution-candidate-{entryId}` | li | ResolutionPicker | resolution |
| `resolution-choose-{entryId}` | button | ResolutionPicker | resolution |
| `recovery-panel` | section | BibliographyRecoveryPanel | smoke (fixture below-threshold) |
| `recovery-candidate-{blockId}` | li | BibliographyRecoveryPanel | smoke |
| `recovery-use-{blockId}` | button | BibliographyRecoveryPanel | smoke |
| `error-panel` | div[role=alert] (chỉ error) | App | smoke (GARBAGE_DOCX) |

Class quan trọng đi kèm (e2e assert state, không phải testid): `issue-row-selected`,
`issue-row-resolved`, `drop-zone-dragging`, `stage-done|stage-current|stage-pending`,
`severity-{error|warning|ambiguous|info}`, `source-highlight-{severity}`.

---

# Phụ lục B — Checklist review contract

Checklist mà T05 (review gate) sẽ chạy để chốt tài liệu này làm contract cho
S02–S04. Mỗi mục có con trỏ tới section tương ứng:

| # | Check | Section |
|---|---|---|
| 1 | Tokens đầy đủ: màu (bg/fg/severity mapping + accent), typography, spacing, radius, shadow, z-index | §1 |
| 2 | Flow map phủ mọi transition (T1–T11) + mọi state kèm theo | §3 |
| 3 | Mockup phủ mọi màn hình hiện có (9 component) + onboarding | §5 |
| 4 | State inventory không thiếu error states: parse-failure, oversize, unsupported, worker error, export failure, time-budget | §4.8 |
| 5 | 3 quyết định nền (i18n, data-testid policy, vanilla CSS/styling) được ghi | T02 (bổ sung section riêng) |
