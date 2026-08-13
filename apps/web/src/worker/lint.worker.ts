/**
 * T1 in-worker lint proof (M003 research risk #1).
 *
 * This worker imports `@citesync/core` ONLY (PRD §92/§93) — the public lint
 * surface that pulls in the DOCX reader package (fflate + fast-xml-parser)
 * transitively. Vite bundles the whole ESM NodeNext chain into this single
 * worker chunk; the vite build fails if the worker entry cannot be
 * resolved/bundled, so a green build is the proof that the core runs inside
 * a browser worker.
 *
 * Message contract (T1 inline; T3 replaces with the shared protocol module):
 *   in:  { id, type: 'analyze', bytes: ArrayBuffer, fileName }  (bytes transferred)
 *   out: { id, type: 'done', report: LintReport }
 *     |  { id, type: 'error', name, message }  (stable err.name discriminator)
 *
 * NOTE: `self` and bare `onmessage` are deliberately NOT used — the DOM +
 * WebWorker libs both declare global `var self` / `var onmessage` with
 * different types, which is a TS2403 duplicate-identifier error. `addEventListener`
 * and `postMessage` are `declare function` overload sets that merge cleanly.
 */

import { lintDocument } from '@citesync/core';
import type { LintReport } from '@citesync/core';

type AnalyzeRequest = {
  id: number;
  type: 'analyze';
  bytes: ArrayBuffer;
  fileName: string;
};

type AnalyzeResponse =
  | { id: number; type: 'done'; report: LintReport }
  | { id: number; type: 'error'; name: string; message: string };

addEventListener('message', (event: MessageEvent<AnalyzeRequest>) => {
  const { id, bytes } = event.data;
  try {
    const report: LintReport = lintDocument(new Uint8Array(bytes));
    postMessage({ id, type: 'done', report } satisfies AnalyzeResponse);
  } catch (err) {
    const name = err instanceof Error ? err.name : 'Error';
    const message = err instanceof Error ? err.message : String(err);
    postMessage({ id, type: 'error', name, message } satisfies AnalyzeResponse);
  }
});
