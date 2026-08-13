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
 * RACE SAFETY (deterministic UI): a generation counter makes a stale run's
 * callbacks no-ops — dropping a new file while one is analyzing discards the
 * old run's stages/done/error instead of overwriting the fresh state.
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

export function useAnalyze(): { state: AnalyzeState; analyze: (bytes: ArrayBuffer, fileName: string) => Promise<void> } {
  const [state, setState] = useState<AnalyzeState>(INITIAL_STATE);
  // The live worker — `runAnalysis` terminates it on the terminal envelope,
  // so this ref only guards an in-flight worker at unmount time.
  const workerRef = useRef<Worker | null>(null);
  // Bumped per run; callbacks from older generations become no-ops.
  const generationRef = useRef(0);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const analyze = useCallback(async (bytes: ArrayBuffer, fileName: string): Promise<void> => {
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
  }, []);

  return { state, analyze };
}
