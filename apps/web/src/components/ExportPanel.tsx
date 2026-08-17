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
 * M005-S02-T3 (Tailwind v4): export-failure surface (testid `export-error`,
 * UI-SPEC §4.5/5.7) — each click runs through `trySave`; a thrown download
 * shows the inline error and a re-click retries (state resets per click).
 * Primary/secondary button styling per design. testids FROZEN.
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

import { useState } from 'react';
import { serializeReport } from '@citesync/core';
import type { CliReport } from '@citesync/core';
import { saveTextFile } from '../export/download';
import { exportHtmlFilename, exportJsonFilename } from '../export/filenames';
import { buildHtmlReport } from '../export/html';
import { trySave } from '../export/trySave';
import { useI18n } from '../i18n/useI18n';

export interface ExportPanelProps {
  /** The canonical CLI-compatible report (D024) from the done envelope. */
  report: CliReport;
}

export default function ExportPanel({ report }: ExportPanelProps) {
  const { t } = useI18n();
  // M005-S02-T3: per-click failure flag — reset by the outcome of each click
  // (a successful retry clears it; no stale error after a working download).
  const [exportFailed, setExportFailed] = useState(false);

  return (
    <section
      className="export-panel rounded-lg border border-border bg-surface p-5 shadow-sm"
      data-testid="export-panel"
      aria-label={t('export.aria-label')}
    >
      <h2 className="m-0 mb-3 font-display text-lg font-semibold text-ink">
        {t('export.title')}
      </h2>
      <div className="export-actions flex flex-wrap gap-2">
        <button
          type="button"
          className="export-button cursor-pointer rounded-md bg-accent px-4 py-2 text-sm font-semibold text-inverse transition-colors duration-150 hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          data-testid="export-json"
          aria-label={t('export.json-aria-label')}
          onClick={() =>
            setExportFailed(
              !trySave(() =>
                saveTextFile(
                  serializeReport(report),
                  exportJsonFilename(report.meta.file),
                  'application/json',
                ),
              ),
            )
          }
        >
          {t('export.json')}
        </button>
        <button
          type="button"
          className="export-button cursor-pointer rounded-md border border-accent bg-surface px-4 py-2 text-sm font-semibold text-accent transition-colors duration-150 hover:bg-accent-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          data-testid="export-html"
          aria-label={t('export.html-aria-label')}
          onClick={() =>
            setExportFailed(
              !trySave(() =>
                saveTextFile(
                  buildHtmlReport(report),
                  exportHtmlFilename(report.meta.file),
                  'text/html;charset=utf-8',
                ),
              ),
            )
          }
        >
          {t('export.html')}
        </button>
      </div>
      {exportFailed && (
        <p
          className="export-error m-0 mt-3 rounded-md bg-severity-error-tint px-3 py-2 text-sm text-severity-error"
          data-testid="export-error"
          role="alert"
        >
          {t('export.failure')}
        </p>
      )}
    </section>
  );
}
