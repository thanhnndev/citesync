/**
 * T3 — pure unit tests for the worker message protocol (node env, NO real
 * Worker — node vitest has none). The real worker is proven by the vite
 * build (worker chunk bundling) and the Playwright e2e (T6).
 *
 * Covers:
 *   - makeAnalyzeRequest shape + transferable ArrayBuffer,
 *   - makeAnalyzeRequest bibliographyBlockIds round-trip (present / absent),
 *   - classifyWorkerError: all four known names preserved + fallback,
 *   - describeWorkerError: all five branches (4 known + fallback),
 *   - type guards discriminating the incoming union,
 *   - runAnalysis against a stub Worker: correlated request + transferred
 *     bytes, stage forwarding order, done resolve shape, error reject
 *     envelope, foreign-correlation-id filtering, cleanup (terminate),
 *   - runAnalysis forwards bibliographyBlockIds into the posted request only
 *     when provided (below-threshold recovery seam, T3).
 */

import { describe, expect, it, vi } from 'vitest';
import type { AcademicDocument, CliReport, PipelineStage } from '@citesync/core';
import { runAnalysis } from '../src/worker/client';
import {
  classifyWorkerError,
  describeWorkerError,
  isDoneMessage,
  isErrorMessage,
  isStageMessage,
  makeAnalyzeRequest,
} from '../src/worker/protocol';
import type { WorkerIncomingMessage } from '../src/worker/protocol';

// ---------------------------------------------------------------------------
// Stub Worker: a plain event emitter capturing postMessage calls — enough to
// drive the client's orchestration without a real worker thread.
// ---------------------------------------------------------------------------

class FakeWorker {
  posted: Array<{ message: unknown; transfer: unknown[] }> = [];
  terminated = false;
  private listeners = new Map<string, Array<(event: MessageEvent<unknown>) => void>>();

  postMessage(message: unknown, transfer?: unknown[]): void {
    this.posted.push({ message, transfer: transfer ?? [] });
  }

  addEventListener(type: string, listener: (event: MessageEvent<unknown>) => void): void {
    const set = this.listeners.get(type);
    if (set) set.push(listener);
    else this.listeners.set(type, [listener]);
  }

  removeEventListener(type: string, listener: (event: MessageEvent<unknown>) => void): void {
    const set = this.listeners.get(type);
    if (!set) return;
    const next = set.filter((l) => l !== listener);
    if (next.length > 0) this.listeners.set(type, next);
    else this.listeners.delete(type);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(message: unknown): void {
    for (const listener of this.listeners.get('message') ?? []) {
      listener({ data: message } as MessageEvent<unknown>);
    }
  }
}

function asWorker(fake: FakeWorker): Worker {
  return fake as unknown as Worker;
}

// ---------------------------------------------------------------------------
// Canned payloads (plain data — structured-clone-safe shapes).
// ---------------------------------------------------------------------------

const cannedDoc = { blocks: [] } as unknown as AcademicDocument;

const cannedReport = {
  version: 1,
  meta: { file: 'paper.docx', citations: 2, references: 1, ruleIds: ['CS001'] },
  issues: [],
  counts: { ERROR: 0, WARNING: 0, AMBIGUOUS: 0, INFO: 0 },
} as unknown as CliReport;

const ALL_STAGES: readonly PipelineStage[] = [
  'reading-document',
  'detecting-bibliography',
  'finding-citations',
  'matching-references',
  'running-checks',
];

// ---------------------------------------------------------------------------
// makeAnalyzeRequest
// ---------------------------------------------------------------------------

describe('makeAnalyzeRequest', () => {
  it('builds the typed analyze envelope with a transferable ArrayBuffer', () => {
    const bytes = new ArrayBuffer(8);
    const request = makeAnalyzeRequest('req-1', bytes, 'paper.docx');
    expect(request).toEqual({ id: 'req-1', type: 'analyze', bytes, fileName: 'paper.docx' });
    expect(request.bytes).toBeInstanceOf(ArrayBuffer);
  });

  it('round-trips bibliographyBlockIds when provided (below-threshold recovery)', () => {
    const bytes = new ArrayBuffer(8);
    const request = makeAnalyzeRequest('req-2', bytes, 'paper.docx', ['doc-p3', 'doc-p4']);
    expect(request).toEqual({
      id: 'req-2',
      type: 'analyze',
      bytes,
      fileName: 'paper.docx',
      bibliographyBlockIds: ['doc-p3', 'doc-p4'],
    });
    // The array identity is preserved (no defensive copy) — the worker
    // consumes it read-only, and postMessage structured-clones it anyway.
    expect(request.bibliographyBlockIds).toEqual(['doc-p3', 'doc-p4']);
  });

  it('omits bibliographyBlockIds entirely when not provided (normal run)', () => {
    const bytes = new ArrayBuffer(8);
    const request = makeAnalyzeRequest('req-3', bytes, 'paper.docx');
    // Absent field, NOT undefined — the worker's destructure sees no
    // override and runs the normal detector path (T2 contract).
    expect('bibliographyBlockIds' in request).toBe(false);
    expect(request).toEqual({ id: 'req-3', type: 'analyze', bytes, fileName: 'paper.docx' });
  });
});

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

describe('type guards', () => {
  it('discriminate the stage/done/error union on the type field', () => {
    const stage = { id: 'a', type: 'stage', stage: 'reading-document' } as WorkerIncomingMessage;
    const done = { id: 'a', type: 'done', report: cannedReport, doc: cannedDoc, stages: [] } as WorkerIncomingMessage;
    const error = { id: 'a', type: 'error', name: 'NotADocxError', message: 'x' } as WorkerIncomingMessage;
    expect(isStageMessage(stage)).toBe(true);
    expect(isDoneMessage(stage)).toBe(false);
    expect(isErrorMessage(stage)).toBe(false);
    expect(isDoneMessage(done)).toBe(true);
    expect(isErrorMessage(error)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// classifyWorkerError
// ---------------------------------------------------------------------------

describe('classifyWorkerError', () => {
  it.each([
    'NotADocxError',
    'ZipBombError',
    'ParseFailureError',
    'UnsupportedFormatError',
    // T3 (R016 residual, D039): the whole-analysis time-budget abort joins
    // the D021/D029 known-name family — preserved verbatim like its siblings.
    'TimeBudgetExceededError',
  ])('preserves the stable name for %s', (name) => {
      const err = Object.assign(new Error('boom'), { name });
      expect(classifyWorkerError(err)).toEqual({ name, message: 'boom' });
    },
  );

  it('reads the message off a plain {name, message} envelope (postMessage structured clone)', () => {
    // The worker forwards its error envelope over postMessage — structured
    // clone strips the Error prototype, so the app receives a PLAIN object
    // (`instanceof Error` is false) whose message must be read off the field.
    const envelope = { name: 'NotADocxError', message: 'Not a DOCX/OOXML package' };
    expect(classifyWorkerError(envelope)).toEqual(envelope);
  });

  it('preserves name+message verbatim for unknown but structured errors', () => {
    // A real Error with an unknown name keeps its diagnostic message — the
    // worker-side classifier already collapsed unknown failures to 'Error'
    // with a real message; re-collapsing here would lose it ([object Object]).
    const err = Object.assign(new Error('boom'), { name: 'TypeError' });
    expect(classifyWorkerError(err)).toEqual({ name: 'TypeError', message: 'boom' });
  });

  it('is total for non-Error thrown values (worker catch-all)', () => {
    expect(classifyWorkerError('string failure')).toEqual({ name: 'Error', message: 'string failure' });
    expect(classifyWorkerError(undefined)).toEqual({ name: 'Error', message: 'undefined' });
    expect(classifyWorkerError({ name: 'SomeRandomError' })).toEqual({
      name: 'Error',
      message: '[object Object]',
    });
  });
});

// ---------------------------------------------------------------------------
// describeWorkerError
// ---------------------------------------------------------------------------

describe('describeWorkerError', () => {
  it('maps every known error name to a friendly EN message (R016)', () => {
    expect(describeWorkerError('NotADocxError')).toContain('does not look like a DOCX');
    expect(describeWorkerError('ZipBombError')).toContain('size limits');
    expect(describeWorkerError('ParseFailureError')).toContain('could not be parsed');
    expect(describeWorkerError('UnsupportedFormatError')).toContain('unsupported format');
    // T3 (R016 residual, D039): a pathological upload aborts with friendly
    // text instead of a spinner hang — the UI maps the new name too.
    expect(describeWorkerError('TimeBudgetExceededError')).toContain('took too long');
  });

  it('falls back to "Unexpected error: <name>" for unknown names', () => {
    expect(describeWorkerError('WhateverError')).toBe('Unexpected error: WhateverError');
  });
});

// ---------------------------------------------------------------------------
// runAnalysis (stub worker)
// ---------------------------------------------------------------------------

describe('runAnalysis', () => {
  it('posts a correlated request with transferred bytes and resolves the done envelope', async () => {
    const worker = new FakeWorker();
    const bytes = new ArrayBuffer(16);
    const onStage = vi.fn();
    const promise = runAnalysis(asWorker(worker), bytes, 'paper.docx', { onStage }, { makeId: () => 'req-42' });

    // The request goes out immediately with the injected correlation id.
    expect(worker.posted).toHaveLength(1);
    const posted = worker.posted[0]!;
    expect(posted.message).toMatchObject({ id: 'req-42', type: 'analyze', fileName: 'paper.docx' });
    expect((posted.message as { bytes: unknown }).bytes).toBeInstanceOf(ArrayBuffer);
    expect(posted.transfer).toEqual([bytes]);

    // Forward the five real stages in canonical order, then done — all
    // messages echo the request correlation id.
    for (const stage of ALL_STAGES) {
      worker.emit({ id: 'req-42', type: 'stage', stage });
    }
    worker.emit({ id: 'req-42', type: 'done', report: cannedReport, doc: cannedDoc, stages: [...ALL_STAGES] });

    await expect(promise).resolves.toEqual({
      report: cannedReport,
      doc: cannedDoc,
      stages: [...ALL_STAGES],
    });
    expect(onStage.mock.calls.map((call) => call[0] as PipelineStage)).toEqual([...ALL_STAGES]);
    expect(worker.terminated).toBe(true);
  });

  it('ignores messages with a foreign correlation id (single-flight filter)', async () => {
    const worker = new FakeWorker();
    const onStage = vi.fn();
    const promise = runAnalysis(asWorker(worker), new ArrayBuffer(8), 'a.docx', { onStage }, { makeId: () => 'req-1' });

    // Another (hypothetical) request's traffic must be ignored entirely.
    worker.emit({ id: 'other-request', type: 'stage', stage: 'reading-document' });
    worker.emit({ id: 'other-request', type: 'done', report: cannedReport, doc: cannedDoc, stages: [] });
    expect(onStage).not.toHaveBeenCalled();
    expect(worker.terminated).toBe(false);

    // The correlated done settles the promise.
    worker.emit({ id: 'req-1', type: 'done', report: cannedReport, doc: cannedDoc, stages: ['reading-document'] });
    await expect(promise).resolves.toMatchObject({ stages: ['reading-document'] });
    expect(worker.terminated).toBe(true);
  });

  it('rejects with the {name, message} envelope on error and cleans up', async () => {
    const worker = new FakeWorker();
    const promise = runAnalysis(asWorker(worker), new ArrayBuffer(8), 'a.docx', {}, { makeId: () => 'req-9' });

    worker.emit({ id: 'req-9', type: 'error', name: 'NotADocxError', message: 'Not a DOCX/OOXML package' });

    await expect(promise).rejects.toEqual({ name: 'NotADocxError', message: 'Not a DOCX/OOXML package' });
    expect(worker.terminated).toBe(true);
  });

  it('falls back to crypto.randomUUID when no id source is injected', async () => {
    const worker = new FakeWorker();
    const promise = runAnalysis(asWorker(worker), new ArrayBuffer(8), 'a.docx');

    const posted = worker.posted[0]!;
    const id = (posted.message as { id: string }).id;
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);

    // Settle the promise so the test never dangles.
    worker.emit({ id, type: 'done', report: cannedReport, doc: cannedDoc, stages: [] });
    await promise;
  });

  it('never forwards a stage after the terminal message (cleanup ordering)', async () => {
    const worker = new FakeWorker();
    const onStage = vi.fn();
    const promise = runAnalysis(asWorker(worker), new ArrayBuffer(8), 'a.docx', { onStage }, { makeId: () => 'req-5' });

    worker.emit({ id: 'req-5', type: 'stage', stage: 'reading-document' });
    worker.emit({ id: 'req-5', type: 'done', report: cannedReport, doc: cannedDoc, stages: ['reading-document'] });
    // A straggler stage after done must be ignored (listener removed).
    worker.emit({ id: 'req-5', type: 'stage', stage: 'running-checks' });

    await promise;
    expect(onStage).toHaveBeenCalledTimes(1);
  });

  it('forwards bibliographyBlockIds into the posted request when provided (recovery)', async () => {
    const worker = new FakeWorker();
    const onStage = vi.fn();
    const promise = runAnalysis(
      asWorker(worker),
      new ArrayBuffer(8),
      'a.docx',
      { onStage, bibliographyBlockIds: ['doc-p0', 'doc-p3'] },
      { makeId: () => 'req-bb' },
    );

    const posted = worker.posted[0]!;
    expect(posted.message).toMatchObject({
      id: 'req-bb',
      type: 'analyze',
      fileName: 'a.docx',
      bibliographyBlockIds: ['doc-p0', 'doc-p3'],
    });
    // Regression: stage forwarding + done resolve shape are unchanged by the
    // new optional field — the recovery request rides the same pipeline.
    for (const stage of ALL_STAGES) {
      worker.emit({ id: 'req-bb', type: 'stage', stage });
    }
    worker.emit({ id: 'req-bb', type: 'done', report: cannedReport, doc: cannedDoc, stages: [...ALL_STAGES] });

    await expect(promise).resolves.toEqual({
      report: cannedReport,
      doc: cannedDoc,
      stages: [...ALL_STAGES],
    });
    expect(onStage.mock.calls.map((call) => call[0] as PipelineStage)).toEqual([...ALL_STAGES]);
    expect(worker.terminated).toBe(true);
  });

  it('omits bibliographyBlockIds from the posted request when not provided', async () => {
    const worker = new FakeWorker();
    const promise = runAnalysis(asWorker(worker), new ArrayBuffer(8), 'a.docx', {}, { makeId: () => 'req-nb' });

    const posted = worker.posted[0]!.message as { bibliographyBlockIds?: unknown };
    expect(posted.bibliographyBlockIds).toBeUndefined();
    expect('bibliographyBlockIds' in posted).toBe(false);

    // Settle the promise so the test never dangles.
    worker.emit({ id: 'req-nb', type: 'done', report: cannedReport, doc: cannedDoc, stages: [] });
    await promise;
  });
});
