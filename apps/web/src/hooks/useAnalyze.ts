/**
 * T5 — the analysis state machine (idle → analyzing → done | error).
 *
 * Owns the worker lifecycle: ONE `createLintWorker()` per analysis, kept in a
 * ref so an unmount mid-analysis terminates it. `analyze(bytes, fileName)`
 * delegates to the T3 client's `runAnalysis` (correlated, single-flight):
 *   - every `stage` message appends to `stages` (PRD §61 live checklist),
 *   - `done` settles {report, doc, stages} into the state,
 *   - `error` maps the raw thrown value through `classifyWorkerError` into
 *     the {name, message} envelope the error panel renders (R016).
 *
 * RE-RUN SEAM (T3 — below-threshold recovery, T5 panel): `bytes` is a
 * TRANSFERABLE — postMessage detaches the buffer the caller handed over, so
 * `analyze` retains a COPY of {bytes, fileName} in `lastInputRef` BEFORE
 * delegating, and exposes `rerun(options)` that re-analyzes that retained
 * input (with a section override for recovery). No new file-picker round-trip
 * needed.
 *
 * RACE SAFETY (deterministic UI): a generation counter makes a stale run's
 * callbacks no-ops — dropping a new file while one is analyzing discards the
 * old run's stages/done/error instead of overwriting the fresh state. The
 * counter also guards rerun: it goes through `analyze`, so it bumps the
 * generation like any fresh run (single-flight untouched).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AcademicDocument, CliReport, PipelineStage } from '@citesync/core';
import { createLintWorker, runAnalysis } from '../worker/client';
import { classifyWorkerError } from '../worker/protocol';

/** The four UI states of one analysis run. */
export type AnalyzeStatus = 'idle' | 'analyzing' | 'done' | 'error';

/** The {name, message} envelope a run can fail with (stable err.name, D021). */
export interface AnalyzeError {
  name: string;
  message: string;
}

/**
 * Per-run options. `bibliographyBlockIds` is the below-threshold recovery
 * seam (T3/T5): when present, the worker rebuilds the bibliography from those
 * section blocks instead of running the detector (see protocol.ts).
 */
export interface AnalyzeOptions {
  bibliographyBlockIds?: string[];
}

/** The full UI state — what the shell renders from. */
export interface AnalyzeState {
  status: AnalyzeStatus;
  /** Stages received so far, in emission order (the §61 checklist truth). */
  stages: PipelineStage[];
  /** Present when status === 'done'. */
  report?: CliReport;
  /** Present when status === 'done' (S02 explorer consumes sourceMap/matchMap). */
  doc?: AcademicDocument;
  /** Present when status === 'error'. */
  error?: AnalyzeError;
}

const INITIAL_STATE: AnalyzeState = { status: 'idle', stages: [] };

export function useAnalyze(): {
  state: AnalyzeState;
  analyze: (bytes: ArrayBuffer, fileName: string, options?: AnalyzeOptions) => Promise<void>;
  rerun: (options?: AnalyzeOptions) => Promise<void>;
  /** M005-S02-T4 no-deadflow reset: back to idle, drops the retained input. */
  reset: () => void;
} {
  const [state, setState] = useState<AnalyzeState>(INITIAL_STATE);
  // The live worker — `runAnalysis` terminates it on the terminal envelope,
  // so this ref only guards an in-flight worker at unmount time.
  const workerRef = useRef<Worker | null>(null);
  // Bumped per run; callbacks from older generations become no-ops.
  const generationRef = useRef(0);
  // Retained COPY of the last input — `bytes` is detached by postMessage's
  // transfer list, so re-runs (below-threshold recovery) need this snapshot.
  const lastInputRef = useRef<{ bytes: ArrayBuffer; fileName: string } | null>(null);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const analyze = useCallback(
    async (bytes: ArrayBuffer, fileName: string, options?: AnalyzeOptions): Promise<void> => {
      // Retain a COPY BEFORE runAnalysis transfers the original buffer — the
      // caller's ArrayBuffer is detached on send and must never be read again.
      lastInputRef.current = { bytes: bytes.slice(0), fileName };

      const generation = ++generationRef.current;
      setState({ status: 'analyzing', stages: [] });

      const worker = createLintWorker();
      workerRef.current = worker;

      try {
        const result = await runAnalysis(worker, bytes, fileName, {
          onStage: (stage) => {
            if (generationRef.current !== generation) return;
            setState((prev) => ({ ...prev, stages: [...prev.stages, stage] }));
          },
          // Recovery override (undefined → normal detector run).
          bibliographyBlockIds: options?.bibliographyBlockIds,
        });
        if (generationRef.current !== generation) return;
        setState({ status: 'done', stages: result.stages, report: result.report, doc: result.doc });
      } catch (err) {
        if (generationRef.current !== generation) return;
        setState((prev) => ({
          status: 'error',
          // Keep the stages reached before the failure — the checklist shows
          // how far the run got before the error envelope arrived.
          stages: prev.stages,
          error: classifyWorkerError(err),
        }));
      }
    },
    [],
  );

  /**
   * Re-run the last analyzed file (T5 recovery panel): reuses the retained
   * bytes COPY, optionally with a bibliography section override. No-op (not
   * a throw) when nothing has been analyzed yet — the UI only exposes it
   * after a completed run.
   */
  const rerun = useCallback(
    async (options?: AnalyzeOptions): Promise<void> => {
      const retained = lastInputRef.current;
      if (!retained) return;
      await analyze(retained.bytes, retained.fileName, options);
    },
    [analyze],
  );

  /**
   * M005-S02-T4 — return to the idle shell (no-deadflow: a done/error user
   * can always start over). Bumps the generation so an in-flight run's
   * callbacks become no-ops, terminates the live worker, drops the
   * retained input (must re-pick a file), and restores INITIAL_STATE.
   */
  const reset = useCallback((): void => {
    generationRef.current += 1;
    workerRef.current?.terminate();
    workerRef.current = null;
    lastInputRef.current = null;
    setState(INITIAL_STATE);
  }, []);

  return { state, analyze, rerun, reset };
}
