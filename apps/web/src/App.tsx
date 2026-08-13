/**
 * T1 proof UI, now wired to the T3 typed protocol client (T5 replaces this
 * with the real shell).
 *
 * Flow: pick a .docx → File.arrayBuffer() → runAnalysis (correlated request,
 * bytes transferred) → stage messages render a live checklist (PRD §61) →
 * done renders the canonical CLI-compatible report JSON (D024); error renders
 * the {name, message} envelope mapped to friendly text (R016).
 */

import { useState } from 'react';
import type { PipelineStage } from '@citesync/core';
import { createLintWorker, runAnalysis } from './worker/client';
import type { AnalyzeResult } from './worker/client';
import { describeWorkerError } from './worker/protocol';

export default function App() {
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [error, setError] = useState<{ name: string; message: string } | null>(null);

  async function analyzeFile(file: File) {
    setStages([]);
    setResult(null);
    setError(null);
    try {
      const worker = createLintWorker();
      const bytes = await file.arrayBuffer();
      // runAnalysis terminates the worker on the terminal envelope.
      const analysis = await runAnalysis(worker, bytes, file.name, {
        onStage: (stage) => setStages((prev) => [...prev, stage]),
      });
      setResult(analysis);
    } catch (err) {
      setError(err as { name: string; message: string });
    }
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
      {stages.length > 0 && (
        <ol data-testid="stage-list">
          {stages.map((stage) => (
            <li key={stage}>{stage}</li>
          ))}
        </ol>
      )}
      {result !== null && (
        <pre data-testid="report-json">{JSON.stringify(result.report, null, 2)}</pre>
      )}
      {error !== null && (
        <div data-testid="error-panel">
          <strong>{describeWorkerError(error.name)}</strong> ({error.name}) — {error.message}
        </div>
      )}
    </main>
  );
}
