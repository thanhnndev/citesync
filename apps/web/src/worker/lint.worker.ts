/**
 * T3 in-worker lint handler — speaks the shared typed protocol.
 *
 * Imports @citesync/core ONLY (PRD §92/§93) — the public lint surface that
 * pulls in the DOCX reader (fflate + fast-xml-parser) transitively. Vite
 * bundles the whole ESM NodeNext chain into this single worker chunk; the
 * build fails if the entry cannot be resolved, so a green build is the proof
 * that the core runs inside a browser worker (M003 risk #1).
 *
 * Message contract (protocol.ts — the S01→S02 boundary):
 *   in:  AnalyzeRequest  {id, type:'analyze', bytes, fileName, bibliographyBlockIds?}  (bytes transferred)
 *        — bibliographyBlockIds: below-threshold recovery (T3/T5) — when present the
 *        engine rebuilds the bibliography from those section blocks instead of running
 *        the detector (absent for a normal full-document run).
 *   out: WorkerStageMessage {id, type:'stage', stage}        — per pipeline stage (PRD §61)
 *      | WorkerDoneMessage   {id, type:'done', report, doc, stages}
 *      | WorkerErrorMessage  {id, type:'error', name, message}  (stable err.name, D021)
 *
 * Every response echoes the request `id` (correlation), and the handler wraps
 * the whole pass in try/catch so a terminal envelope is ALWAYS posted — the
 * client promise never hangs for bounded, deterministic input (R008).
 *
 * Error mapping: classifyWorkerError (protocol.ts) forwards the stable
 * DocxReaderError `name` verbatim and collapses everything else to
 * {name:'Error', message:String(err)} — the worker has no CLI classification
 * (ErrorCode stays CLI-owned, D021), the UI maps names to friendly text.
 *
 * NOTE: `self` and bare `onmessage` are deliberately NOT used — the DOM +
 * WebWorker libs both declare global `var self` / `var onmessage` with
 * different types (TS2403). addEventListener/postMessage are `declare
 * function` overload sets that merge cleanly (T1 decision).
 */

import { buildCliReport, lintDocument, REPORT_VERSION } from '@citesync/core';
import type { PipelineStage } from '@citesync/core';
import { classifyWorkerError } from './protocol';
import type {
  AnalyzeRequest,
  WorkerDoneMessage,
  WorkerErrorMessage,
  WorkerStageMessage,
} from './protocol';

addEventListener('message', (event: MessageEvent<AnalyzeRequest>) => {
  const { id, bytes, fileName, bibliographyBlockIds } = event.data;
  try {
    // Collect stages as the engine emits them (PRD §61) — the final list is
    // the checklist truth delivered in the done envelope.
    const stages: PipelineStage[] = [];
    const { doc, issues, ruleIds } = lintDocument(new Uint8Array(bytes), {
      onStage: (stage) => {
        stages.push(stage);
        postMessage({ id, type: 'stage', stage } satisfies WorkerStageMessage);
      },
      // Undefined when absent — engine falls back to the detector path
      // (build-model checks `givenIds !== undefined`).
      bibliographyBlockIds,
    });

    // Canonical CLI-compatible report from the shared pure builder (D024) —
    // the worker and the CLI can never drift.
    const report = buildCliReport(doc, issues, ruleIds, {
      fileName,
      version: REPORT_VERSION,
    });

    postMessage({ id, type: 'done', report, doc, stages } satisfies WorkerDoneMessage);
  } catch (err) {
    postMessage({ id, type: 'error', ...classifyWorkerError(err) } satisfies WorkerErrorMessage);
  }
});
