/**
 * T3 — the app-side worker client: correlated single-flight analysis.
 *
 * `runAnalysis(worker, bytes, fileName, opts, deps)` drives ONE lint request
 * to completion:
 *   - generates a correlation id (crypto.randomUUID by default; injectable
 *     via `deps.makeId` so node-env tests stay deterministic),
 *   - posts `AnalyzeRequest` with `bytes.buffer` as a TRANSFERABLE — the
 *     buffer is detached on send and must never be read again,
 *   - forwards every `stage` message to `onStage` (PRD §61 progress UI),
 *   - resolves with {report, doc, stages} on `done`,
 *   - rejects with the {name, message} envelope on `error`,
 *   - filters by correlation id: messages from any other request are
 *     ignored (single-flight is enough for S01; S02+ can multiplex).
 *
 * Cleanup: on the terminal message (done | error) the listener is removed
 * and the worker terminated — one worker per analysis, nothing leaks. The
 * worker always posts a terminal envelope (its message handler wraps the
 * whole pass in try/catch), so the promise always settles for bounded,
 * deterministic lint input (R008).
 */

import type { AcademicDocument, CliReport, PipelineStage } from '@citesync/core';
import { makeAnalyzeRequest } from './protocol';
import type { WorkerIncomingMessage } from './protocol';

/** What a completed analysis yields (the done-envelope payload). */
export interface AnalyzeResult {
  /** Canonical CLI-compatible report (D024) — the frozen JSON contract. */
  report: CliReport;
  /** The §15 document the pass interpreted (S02 explorer: sourceMap/matchMap). */
  doc: AcademicDocument;
  /** The stages that ran, in emission order (the §61 checklist truth). */
  stages: PipelineStage[];
}

/** `runAnalysis` options — progress + (future) cancellation surface. */
export interface RunAnalysisOptions {
  /** Forwarded each time the worker reports a pipeline stage (PRD §61). */
  onStage?: (stage: PipelineStage) => void;
}

/** Injectable dependencies — the only test seam (node vitest has no real Worker). */
export interface RunAnalysisDeps {
  /** Correlation-id source. Defaults to crypto.randomUUID (browser/node 24). */
  makeId?: () => string;
}

/**
 * Create the lint worker. The URL is a STATIC `new URL(..., import.meta.url)`
 * reference — required so Vite bundles the worker into its own chunk and the
 * whole @citesync/core chain (fflate + fast-xml-parser) ships there (T1 proof).
 */
export function createLintWorker(): Worker {
  return new Worker(new URL('./lint.worker.ts', import.meta.url), { type: 'module' });
}

/**
 * Run one analysis to completion (single-flight). Resolves with
 * {report, doc, stages}; rejects with the {name, message} envelope.
 * The worker is terminated on the terminal message — do not reuse it.
 */
export function runAnalysis(
  worker: Worker,
  bytes: ArrayBuffer,
  fileName: string,
  options: RunAnalysisOptions = {},
  deps: RunAnalysisDeps = {},
): Promise<AnalyzeResult> {
  const { onStage } = options;
  const makeId = deps.makeId ?? ((): string => crypto.randomUUID());
  const id = makeId();

  return new Promise<AnalyzeResult>((resolve, reject) => {
    const cleanup = (): void => {
      worker.removeEventListener('message', onMessage);
      worker.terminate();
    };

    const onMessage = (event: MessageEvent<WorkerIncomingMessage>): void => {
      const message = event.data;
      // Correlation filter: ignore anything not addressed to this request.
      if (message.id !== id) return;
      if (message.type === 'stage') {
        onStage?.(message.stage);
        return;
      }
      cleanup();
      if (message.type === 'done') {
        resolve({ report: message.report, doc: message.doc, stages: message.stages });
      } else {
        // WorkerErrorMessage — reject with the raw envelope; the UI maps it
        // to friendly text via describeWorkerError (protocol.ts).
        reject({ name: message.name, message: message.message });
      }
    };

    worker.addEventListener('message', onMessage);
    // Transfer the buffer: detached on send, must not be read again.
    worker.postMessage(makeAnalyzeRequest(id, bytes, fileName), [bytes]);
  });
}
