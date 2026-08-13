/**
 * T3 — the shared typed worker message protocol (S01→S02 boundary contract).
 *
 * One module, imported by BOTH sides of the postMessage boundary:
 *   - the worker (`lint.worker.ts`) builds outgoing envelopes from these
 *     types and `classifyWorkerError`;
 *   - the app (`client.ts`) builds `AnalyzeRequest`s via `makeAnalyzeRequest`
 *     and discriminates incoming envelopes with the type guards.
 *
 * PURE TS — zero DOM/Node imports, so this file (and `client.ts`'s protocol
 * surface) is unit-testable in the node vitest environment with a stub
 * Worker object. The real worker is exercised by the vite build (worker
 * chunk) and Playwright e2e (T6).
 *
 * CONTRACT (roadmap S01→S02): AnalyzeRequest {bytes, fileName} →
 *   done {report, doc, stages} | error {name, message}, correlated by `id`.
 *
 * WHY `doc` in the done envelope: the S02 explorer needs the §15
 * `AcademicDocument` (sourceMap + matchMap) to render evidence. The model is
 * plain interfaces (no Map/Set — checked against
 * packages/document-model/src/types.ts), so structured clone serializes it
 * losslessly.
 *
 * WHY `error` is {name, message} and NOT a classified code: the
 * ErrorCode/classifyError family lives in @citesync/cli, and the worker must
 * never import the CLI (dependency direction, PRD §92/§93 — core cannot
 * import cli). The stable `name` discriminator is set by the
 * DocxReaderError subclasses themselves (packages/docx/src/zip/errors.ts,
 * D021), so the worker forwards it verbatim and the UI maps it to friendly
 * text with `describeWorkerError` (R016).
 */

import type { AcademicDocument, CliReport, PipelineStage } from '@citesync/core';

// ---------------------------------------------------------------------------
// Outgoing (app → worker).
// ---------------------------------------------------------------------------

/** One lint analysis request. `bytes` is transferred (detached), never reused. */
export interface AnalyzeRequest {
  /** Correlation id — echoed on every response message from the worker. */
  id: string;
  type: 'analyze';
  /** Raw .docx bytes (ArrayBuffer so it can be a transferable, R016 budget). */
  bytes: ArrayBuffer;
  /** Original file name (display-friendly; basename by the file picker). */
  fileName: string;
}

// ---------------------------------------------------------------------------
// Incoming (worker → app).
// ---------------------------------------------------------------------------

/** Progress tick: one of the five real pipeline stages reached (PRD §61). */
export interface WorkerStageMessage {
  id: string;
  type: 'stage';
  stage: PipelineStage;
}

/**
 * Success: the canonical CLI-compatible report (D024), the §15 document the
 * pass interpreted (S02 explorer needs sourceMap + matchMap), and the
 * stages that actually ran, in emission order (the §61 checklist truth).
 */
export interface WorkerDoneMessage {
  id: string;
  type: 'done';
  report: CliReport;
  doc: AcademicDocument;
  stages: PipelineStage[];
}

/** Failure: stable `name` discriminator (D021) + diagnostic `message`. */
export interface WorkerErrorMessage {
  id: string;
  type: 'error';
  name: string;
  message: string;
}

/** Discriminated union of everything the worker can send. */
export type WorkerIncomingMessage = WorkerStageMessage | WorkerDoneMessage | WorkerErrorMessage;

// ---------------------------------------------------------------------------
// Pure helpers (node-testable — no Worker needed).
// ---------------------------------------------------------------------------

/** Build a correlated analyze request (bytes stays a transferable ArrayBuffer). */
export function makeAnalyzeRequest(id: string, bytes: ArrayBuffer, fileName: string): AnalyzeRequest {
  return { id, type: 'analyze', bytes, fileName };
}

/** Type guard: stage progress tick. */
export function isStageMessage(message: WorkerIncomingMessage): message is WorkerStageMessage {
  return message.type === 'stage';
}

/** Type guard: successful analysis. */
export function isDoneMessage(message: WorkerIncomingMessage): message is WorkerDoneMessage {
  return message.type === 'done';
}

/** Type guard: failure envelope. */
export function isErrorMessage(message: WorkerIncomingMessage): message is WorkerErrorMessage {
  return message.type === 'error';
}

/**
 * The DocxReaderError family names the worker forwards verbatim (D021 — the
 * same stable-name discriminator the CLI's classifyError switches on). Any
 * OTHER error collapses to name 'Error' with `String(err)` as the message:
 * the app only needs to tell the user "something unexpected happened".
 */
const KNOWN_ERROR_NAMES: readonly string[] = [
  'NotADocxError',
  'ZipBombError',
  'ParseFailureError',
  'UnsupportedFormatError',
];

/** Classify an arbitrary thrown value into the {name, message} envelope. */
export function classifyWorkerError(err: unknown): { name: string; message: string } {
  const name = (err as { name?: unknown } | null | undefined)?.name;
  if (typeof name === 'string' && KNOWN_ERROR_NAMES.includes(name)) {
    return { name, message: err instanceof Error ? err.message : String(err) };
  }
  return { name: 'Error', message: String(err) };
}

/** Deterministic name → friendly EN text for the UI error panel (R016). */
const ERROR_DESCRIPTIONS: Readonly<Record<string, string>> = {
  NotADocxError:
    'This file does not look like a DOCX document. Try a .docx file exported from Word or Google Docs.',
  ZipBombError: 'This document was rejected for safety — it exceeds the size limits.',
  ParseFailureError: 'The document could not be parsed.',
  UnsupportedFormatError:
    'This DOCX uses an unsupported format (encryption or unknown compression).',
};

/** Map a worker error name to user-facing text (fallback: generic). */
export function describeWorkerError(name: string): string {
  return ERROR_DESCRIPTIONS[name] ?? `Unexpected error: ${name}`;
}
