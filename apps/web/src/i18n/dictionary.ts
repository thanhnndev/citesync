/**
 * M005-S01-T4 — the hand-rolled i18n dictionary (UI-SPEC §7.1).
 *
 * Typed dictionary: `en` is the source of truth (its key set IS the I18nKey
 * type); `vi` is compile-time checked against it via `satisfies
 * Record<I18nKey, string>` — a missing key, an extra key, or a wrong value
 * type is a build error, so EN↔VI parity is enforced at COMPILE time and
 * re-checked at runtime by `parity.test.ts`.
 *
 * CONTRACT (UI-SPEC §7.1.1):
 *   - ONLY UI-layer strings live here (copy the components render).
 *   - Engine / data text stays EN FROZEN and has NO key: stage labels
 *     (PIPELINE_STAGES, D025), LintEvidence.code/message, Issue.message,
 *     describeWorkerError output + error.name (protocol, D021/R016), issue
 *     ids, severity values, confidence numbers, entry ids.
 *   - Key naming §7.1.3: `{surface}.{element}.{state|variant}`, lowercase
 *     dot-separated, hyphens for compounds, NO data values in keys — use
 *     placeholders `{name}` instead.
 *   - Default locale is EN (`DEFAULT_LOCALE`) — the app renders
 *     behavior-identical by default (T04 verify).
 *   - `export.failure` is a documented S02 target key (§7.1.3 mapping
 *     table) — declared now so the contract key set is stable.
 */

export const en = {
  // ----------------------------------------------------------------- common
  'common.badge.ready': 'Ready — analysis runs locally in your browser',
  'common.badge.processing': 'Processing locally',
  'common.badge.done': 'Processed locally — never left this device',
  'common.badge.error': 'Analysis runs locally in your browser',
  'common.language': 'Language',
  'common.new-document': 'New document',
  'common.locale.en': 'English',
  'common.locale.vi': 'Vietnamese',
  // -------------------------------------------------------------------- drop
  'drop.title': 'Drop a .docx file here',
  'drop.hint': 'or click to choose — analysis runs locally in your browser',
  'drop.dragging': 'Drop to analyze',
  'drop.invalid-file': '"{name}" is not a .docx file. Choose a Word document saved as .docx.',
  'drop.choose-label': 'Choose a .docx file to analyze',
  // ------------------------------------------------------------------ stages
  'stages.title': 'Analysis stages',
  // --------------------------------------------------------------- onboarding
  // M005-S02-T4: idle hero (UI-SPEC mockup 5.1/5.9 — PRD §58 hero, §59 proof).
  'onboarding.hero-title': 'ESLint for your citations.',
  'onboarding.hero-subtitle':
    'Find missing, unused, and inconsistent references before you submit — all locally in your browser.',
  // ------------------------------------------------------------------ report
  'report.title': 'Report',
  'report.aria-label': 'Report summary',
  'report.meta-count': '{citations} citations · {references} references · {rules} rules applied',
  // M005-S02-T3: zero-issue success message (UI-SPEC §4.3 — polish).
  'report.zero-issue': 'Citation consistency looks good.',
  // ---------------------------------------------------------------- explorer
  'explorer.title': 'Issues',
  'explorer.aria-label': 'Issues by severity',
  'explorer.empty': 'No issues found.',
  'explorer.resolved-count': '{count} resolved',
  'explorer.resolved-chip': 'Resolved → {label}',
  // DocumentView lives in the explorer screen (UI-SPEC Appendix A domain).
  'explorer.doc-title': 'Document',
  'explorer.doc-aria-label': 'Document source',
  'explorer.doc-empty': 'No document content.',
  // ---------------------------------------------------------------- evidence
  'evidence.title': 'Evidence',
  'evidence.aria-label': 'Issue evidence',
  'evidence.possible-references': 'Possible references',
  'evidence.no-refs': 'No references matched',
  // -------------------------------------------------------------- resolution
  'resolution.title': 'Resolve ambiguity',
  'resolution.aria-label': 'Resolve ambiguous citation',
  'resolution.hint':
    'Which reference is this citation pointing at? Your choice stays in this session only — the document is never modified.',
  'resolution.chosen': 'Chosen',
  'resolution.choose': 'Choose',
  // ------------------------------------------------------------------ export
  'export.title': 'Export',
  'export.aria-label': 'Export report',
  'export.json': 'Download JSON report',
  'export.json-aria-label': 'Export report as JSON',
  'export.html': 'Download HTML report',
  'export.html-aria-label': 'Export report as HTML',
  'export.failure': 'Export failed. Try again.',
  // ------------------------------------------------------------------ error
  // M005-S02-T3: error guidance layer — i18n UI copy rendered UNDER the
  // FROZEN describeWorkerError text (UI-SPEC §3.3 — guidance is a separate
  // layer; describeWorkerError + err.name never i18n'd). No placeholders.
  'error.guidance.not-docx':
    'Re-export your document from Word or Google Docs as .docx, then try again.',
  'error.guidance.oversize':
    'Reduce the file size or split the document into smaller parts, then try again.',
  'error.guidance.parse-failure':
    'The file may be corrupted. Re-save it from your word processor and analyze again.',
  'error.guidance.unsupported':
    'Remove encryption or re-save with standard compression, then try again.',
  'error.guidance.time-budget':
    'Try a smaller document, or close other tabs and try again.',
  'error.guidance.generic':
    'Reload the page and try again. If it keeps failing, your document may not be supported yet.',
  // ---------------------------------------------------------------- recovery
  'recovery.aria-label': 'Bibliography recovery',
  'recovery.title': 'Select the bibliography section',
  'recovery.explanation':
    'No single bibliography heading cleared the confidence threshold — choose the section below to re-run the analysis with it.',
  'recovery.no-candidates': 'No candidates available.',
  'recovery.use': 'Use this section',
  'recovery.type.exact': 'Exact bibliography heading',
  'recovery.type.style': 'Heading style',
  'recovery.type.position': 'Document-end position',
  'recovery.type.reference-segment': 'Followed by reference-like text',
  'recovery.type.none': 'No positive signal',
} as const;

export type I18nKey = keyof typeof en;

export const vi = {
  // ----------------------------------------------------------------- common
  'common.badge.ready': 'Sẵn sàng — phân tích chạy hoàn toàn trên trình duyệt của bạn',
  'common.badge.processing': 'Đang xử lý trên máy',
  'common.badge.done': 'Đã xử lý trên máy — chưa bao giờ rời khỏi thiết bị của bạn',
  'common.badge.error': 'Phân tích chạy hoàn toàn trên trình duyệt của bạn',
  'common.language': 'Ngôn ngữ',
  'common.new-document': 'Tài liệu mới',
  'common.locale.en': 'Tiếng Anh',
  'common.locale.vi': 'Tiếng Việt',
  // -------------------------------------------------------------------- drop
  'drop.title': 'Kéo thả tệp .docx vào đây',
  'drop.hint': 'hoặc nhấp để chọn — phân tích chạy hoàn toàn trên trình duyệt của bạn',
  'drop.dragging': 'Thả để phân tích',
  'drop.invalid-file': '"{name}" không phải tệp .docx. Hãy chọn tài liệu Word được lưu dưới định dạng .docx.',
  'drop.choose-label': 'Chọn tệp .docx để phân tích',
  // ------------------------------------------------------------------ stages
  'stages.title': 'Các bước phân tích',
  // --------------------------------------------------------------- onboarding
  'onboarding.hero-title': 'ESLint cho trích dẫn của bạn.',
  'onboarding.hero-subtitle':
    'Phát hiện tham chiếu thiếu, thừa và không nhất quán trước khi nộp — hoàn toàn trên trình duyệt của bạn.',
  // ------------------------------------------------------------------ report
  'report.title': 'Báo cáo',
  'report.aria-label': 'Tóm tắt báo cáo',
  'report.meta-count': '{citations} trích dẫn · {references} tham chiếu · {rules} quy tắc đã áp dụng',
  'report.zero-issue': 'Tính nhất quán trích dẫn trông ổn.',
  // ---------------------------------------------------------------- explorer
  'explorer.title': 'Vấn đề',
  'explorer.aria-label': 'Vấn đề theo mức độ',
  'explorer.empty': 'Không tìm thấy vấn đề nào.',
  'explorer.resolved-count': 'đã xử lý {count}',
  'explorer.resolved-chip': 'Đã xử lý → {label}',
  'explorer.doc-title': 'Tài liệu',
  'explorer.doc-aria-label': 'Nguồn tài liệu',
  'explorer.doc-empty': 'Không có nội dung tài liệu.',
  // ---------------------------------------------------------------- evidence
  'evidence.title': 'Bằng chứng',
  'evidence.aria-label': 'Bằng chứng vấn đề',
  'evidence.possible-references': 'Tham chiếu khả dĩ',
  'evidence.no-refs': 'Không có tham chiếu khớp',
  // -------------------------------------------------------------- resolution
  'resolution.title': 'Giải quyết sự mơ hồ',
  'resolution.aria-label': 'Giải quyết trích dẫn mơ hồ',
  'resolution.hint':
    'Trích dẫn này đang trỏ tới tham chiếu nào? Lựa chọn của bạn chỉ tồn tại trong phiên này — tài liệu không bao giờ bị sửa đổi.',
  'resolution.chosen': 'Đã chọn',
  'resolution.choose': 'Chọn',
  // ------------------------------------------------------------------ export
  'export.title': 'Xuất',
  'export.aria-label': 'Xuất báo cáo',
  'export.json': 'Tải báo cáo JSON',
  'export.json-aria-label': 'Xuất báo cáo dạng JSON',
  'export.html': 'Tải báo cáo HTML',
  'export.html-aria-label': 'Xuất báo cáo dạng HTML',
  'export.failure': 'Xuất thất bại. Hãy thử lại.',
  // ------------------------------------------------------------------ error
  'error.guidance.not-docx':
    'Hãy xuất lại tài liệu từ Word hoặc Google Docs dưới dạng .docx, rồi thử lại.',
  'error.guidance.oversize':
    'Hãy giảm dung lượng tệp hoặc chia tài liệu thành nhiều phần nhỏ hơn, rồi thử lại.',
  'error.guidance.parse-failure':
    'Tệp có thể đã bị hỏng. Hãy lưu lại từ trình soạn thảo và phân tích lại.',
  'error.guidance.unsupported':
    'Hãy bỏ mã hóa hoặc lưu lại với nén chuẩn, rồi thử lại.',
  'error.guidance.time-budget':
    'Hãy thử tệp nhỏ hơn, hoặc đóng các tab khác và thử lại.',
  'error.guidance.generic':
    'Hãy tải lại trang và thử lại. Nếu vẫn lỗi, tài liệu của bạn có thể chưa được hỗ trợ.',
  // ---------------------------------------------------------------- recovery
  'recovery.aria-label': 'Khôi phục danh mục tài liệu tham khảo',
  'recovery.title': 'Chọn mục danh mục tài liệu tham khảo',
  'recovery.explanation':
    'Không có tiêu đề danh mục nào vượt ngưỡng tin cậy — hãy chọn mục bên dưới để chạy lại phân tích với mục đó.',
  'recovery.no-candidates': 'Không có ứng viên nào.',
  'recovery.use': 'Dùng mục này',
  'recovery.type.exact': 'Tiêu đề danh mục chính xác',
  'recovery.type.style': 'Kiểu tiêu đề',
  'recovery.type.position': 'Vị trí cuối tài liệu',
  'recovery.type.reference-segment': 'Theo sau bởi văn bản giống tham chiếu',
  'recovery.type.none': 'Không có tín hiệu tích cực',
} satisfies Record<I18nKey, string>;

/** The two supported locales. EN is default (§7.1.1 — PRD §54). */
export type Locale = 'en' | 'vi';

export const DEFAULT_LOCALE: Locale = 'en';

export const LOCALES: readonly Locale[] = ['en', 'vi'];

/** Lookup tables keyed by locale — compile-time parity via `satisfies` above. */
export const dictionaries: Readonly<Record<Locale, Readonly<Record<I18nKey, string>>>> = {
  en,
  vi,
};

/** Interpolation params — named values substituted into `{name}` placeholders. */
export interface InterpolationParams {
  [name: string]: string | number;
}

/**
 * Substitute `{name}` placeholders with the given params. A param that is
 * missing (undefined) leaves the placeholder literal in place — the UI never
 * crashes on a missing param; `parity.test.ts` + the compile-time `satisfies`
 * keep placeholder sets aligned, and callers must pass every declared
 * placeholder.
 */
export function interpolate(template: string, params?: InterpolationParams): string {
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/**
 * The set of `{name}` placeholders in a template, in first-appearance order.
 * Exported for the parity test (EN vs VI placeholder-set equality per key).
 */
export function placeholdersOf(template: string): string[] {
  const names: string[] = [];
  const re = /\{(\w+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    if (m[1] !== undefined) names.push(m[1]);
  }
  return names;
}
