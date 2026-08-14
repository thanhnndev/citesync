/**
 * T2 — export panel for the done envelope (R014 JSON export; T4 adds the
 * standalone HTML report button).
 *
 * A PURE consumer of the S01 done-envelope report: renders ONLY in the done
 * state (App gates it), reads `report.meta.file` for the filename and hands
 * `serializeReport(report)` — the SAME canonical serializer the CLI `--json`
 * uses (D024) — to the browser download helper. The HTML variant hands
 * `buildHtmlReport(report)` (T3 pure builder — deterministic, standalone,
 * breakout-safe) to the same helper. Zero worker/pipeline changes; this
 * panel never touches the parsed document or the issue list beyond what the
 * frozen report already carries.
 *
 * data-testid contract (FROZEN — T4 e2e, must never change):
 *   - export-panel   (wrapper — only mounted in the done state)
 *   - export-json    (the JSON download button)
 *   - export-html    (the standalone HTML report button)
 *
 * Import boundary (PRD §92/§93): the app may only import @citesync/core —
 * serializeReport comes from core, and the DOM work is isolated in
 * ../export/download.ts so no DOM leaks into other modules.
 */

import { serializeReport } from '@citesync/core';
import type { CliReport } from '@citesync/core';
import { saveTextFile } from '../export/download';
import { exportHtmlFilename, exportJsonFilename } from '../export/filenames';
import { buildHtmlReport } from '../export/html';
import { useI18n } from '../i18n/useI18n';

export interface ExportPanelProps {
  /** The canonical CLI-compatible report (D024) from the done envelope. */
  report: CliReport;
}

export default function ExportPanel({ report }: ExportPanelProps) {
  const { t } = useI18n();
  return (
    <section
      className="export-panel"
      data-testid="export-panel"
      aria-label={t('export.aria-label')}
    >
      <h2>{t('export.title')}</h2>
      <div className="export-actions">
        <button
          type="button"
          className="export-button"
          data-testid="export-json"
          aria-label={t('export.json-aria-label')}
          onClick={() =>
            saveTextFile(
              serializeReport(report),
              exportJsonFilename(report.meta.file),
              'application/json',
            )
          }
        >
          {t('export.json')}
        </button>
        <button
          type="button"
          className="export-button"
          data-testid="export-html"
          aria-label={t('export.html-aria-label')}
          onClick={() =>
            saveTextFile(
              buildHtmlReport(report),
              exportHtmlFilename(report.meta.file),
              'text/html;charset=utf-8',
            )
          }
        >
          {t('export.html')}
        </button>
      </div>
    </section>
  );
}
