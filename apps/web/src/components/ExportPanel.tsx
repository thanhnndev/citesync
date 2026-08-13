/**
 * T2 — export panel for the done envelope (R014 JSON export).
 *
 * A PURE consumer of the S01 done-envelope report: renders ONLY in the done
 * state (App gates it), reads `report.meta.file` for the filename and hands
 * `serializeReport(report)` — the SAME canonical serializer the CLI `--json`
 * uses (D024) — to the browser download helper. Zero worker/pipeline
 * changes; this panel never touches the parsed document or the issue list
 * beyond what the frozen report already carries.
 *
 * data-testid contract (FROZEN for T4 e2e, must never change):
 *   - export-panel   (wrapper — only mounted in the done state)
 *   - export-json    (the JSON download button; T4 adds export-html beside it)
 *
 * Import boundary (PRD §92/§93): the app may only import @citesync/core —
 * serializeReport comes from core, and the DOM work is isolated in
 * ../export/download.ts so no DOM leaks into other modules.
 */

import { serializeReport } from '@citesync/core';
import type { CliReport } from '@citesync/core';
import { saveTextFile } from '../export/download';
import { exportJsonFilename } from '../export/filenames';

export interface ExportPanelProps {
  /** The canonical CLI-compatible report (D024) from the done envelope. */
  report: CliReport;
}

export default function ExportPanel({ report }: ExportPanelProps) {
  return (
    <section
      className="export-panel"
      data-testid="export-panel"
      aria-label="Export report"
    >
      <h2>Export</h2>
      <button
        type="button"
        data-testid="export-json"
        aria-label="Export report as JSON"
        onClick={() =>
          saveTextFile(
            serializeReport(report),
            exportJsonFilename(report.meta.file),
            'application/json',
          )
        }
      >
        Download JSON report
      </button>
    </section>
  );
}
