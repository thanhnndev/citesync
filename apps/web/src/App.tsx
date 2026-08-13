/**
 * T1 proof UI (raw — T5 replaces this with the real shell).
 *
 * Minimal flow: pick a .docx → File.arrayBuffer() → worker postMessage with
 * the bytes as a transferable (never re-read after transfer) → 'done' renders
 * the LintReport as JSON; 'error' renders the {name, message} envelope.
 */

import { useState } from 'react';
import type { LintReport } from '@citesync/core';

/** T1 inline request shape (T3 introduces the shared typed protocol). */
type AnalyzeRequest = {
  id: number;
  type: 'analyze';
  bytes: ArrayBuffer;
  fileName: string;
};

/** T1 inline response shape (T3 introduces the shared typed protocol). */
type AnalyzeResponse =
  | { id: number; type: 'done'; report: LintReport }
  | { id: number; type: 'error'; name: string; message: string };

export default function App() {
  const [report, setReport] = useState<LintReport | null>(null);
  const [error, setError] = useState<{ name: string; message: string } | null>(null);

  async function analyzeFile(file: File) {
    setReport(null);
    setError(null);
    const worker = new Worker(new URL('./worker/lint.worker.ts', import.meta.url), {
      type: 'module',
    });
    const bytes = await file.arrayBuffer();
    worker.postMessage(
      { id: 1, type: 'analyze', bytes, fileName: file.name } satisfies AnalyzeRequest,
      // Transfer the buffer — it is never read again after this send.
      [bytes],
    );
    worker.onmessage = (event: MessageEvent<AnalyzeResponse>) => {
      const message = event.data;
      if (message.type === 'done') {
        setReport(message.report);
      } else {
        setError({ name: message.name, message: message.message });
      }
      worker.terminate();
    };
  }

  return (
    <main>
      <h1>CiteSync — worker proof</h1>
      <input
        type="file"
        accept=".docx"
        data-testid="file-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void analyzeFile(file);
        }}
      />
      {report !== null && <pre data-testid="report-json">{JSON.stringify(report, null, 2)}</pre>}
      {error !== null && (
        <div data-testid="error-panel">
          <strong>{error.name}:</strong> {error.message}
        </div>
      )}
    </main>
  );
}
