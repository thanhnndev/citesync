#!/usr/bin/env node
/**
 * @citesync/cli — the first-class CLI (R010).
 *
 *   npx citesync thesis.docx            → default severity-summary table
 *   npx citesync thesis.docx -d|--detailed → per-issue list + source evidence
 *   npx citesync thesis.docx -j|--json  → canonical JSON report (R014 schema)
 *
 * Contract:
 *   - Input is a single `.docx` FILE PATH — no stdin/pipe (M002 S4 decision).
 *   - The pipeline consumes `@citesync/core` `lintDocument` ONLY — never the
 *     parser directly (PRD §92/§93, proves core portability). The CLI has
 *     zero DOM/server/UI dependencies and runs in bare Node.
 *   - Exit codes (PRD §50): 0 no consistency errors · 1 consistency errors ·
 *     2 document could not be parsed · 3 unsupported document.
 *   - JSON is the single source of truth: the canonical report is built and
 *     serialized FIRST; the default/detailed renderers are pure functions
 *     over that exact JSON data, so the three outputs can never drift and
 *     M003's export (R014) reuses the same schema.
 *
 * The module also exports the pure `runCli` pipeline so tests exercise the
 * real surface (real fs + real lintDocument) without spawning a process; the
 * shebang + main-guard below are the only process-specific parts.
 */

import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { lintDocument } from '@citesync/core';

import { parseArgs, UsageError } from './args.js';
import type { CliArgs } from './args.js';
import { buildErrorReport, buildReport, serializeReport } from './report.js';
import type { CliErrorInfo, CliReport, ErrorCode } from './report.js';
import { renderDefault, renderDetailed, renderUsage } from './render.js';

/** CLI package version (read from package.json — display + --version). */
const VERSION: string = createRequire(import.meta.url)('../package.json').version as string;

/** R010 exit codes. */
export type ExitCode = 0 | 1 | 2 | 3;

/** Everything the CLI produced for one invocation (I/O-free, testable). */
export interface CliOutcome {
  /** The R010 exit code. */
  exitCode: ExitCode;
  /** stdout text (report JSON / table / list / usage / version). */
  stdout: string;
  /** stderr text (diagnostics + usage errors). */
  stderr: string;
}

/**
 * Classify a thrown failure into the stable R010 categories. The CLI never
 * imports @citesync/docx error classes (dependency stays @citesync/core
 * only); it branches on the stable `name` discriminator the docx reader
 * documents (zip/errors.ts: "name is the canonical programmatic signal,
 * stable across packaging").
 */
export function classifyError(err: unknown): CliErrorInfo {
  const name = err instanceof Error ? err.name : '';
  const message = err instanceof Error ? err.message : `unexpected failure: ${String(err)}`;
  if (name === 'UnsupportedFormatError') {
    return { code: 'unsupported-document', message };
  }
  if (name === 'NotADocxError' || name === 'ZipBombError' || name === 'ParseFailureError') {
    return { code: 'parse-failure', message };
  }
  // Filesystem input errors (missing file / unreadable) are input failures.
  const code = (err as NodeJS.ErrnoException | null)?.code;
  if (code === 'ENOENT') {
    return { code: 'file-not-found', message: `file not found: ${message}` };
  }
  if (code === 'EACCES' || code === 'EISDIR' || code === 'ENOTDIR') {
    return { code: 'file-not-found', message };
  }
  return { code: 'parse-failure', message };
}

/** R010 exit code for a failure category. */
export function exitCodeForFailure(code: ErrorCode): ExitCode {
  switch (code) {
    case 'unsupported-document':
      return 3;
    case 'parse-failure':
    case 'file-not-found':
    case 'usage':
      return 2;
  }
}

/** Exit code for a successful lint: 1 when any issue, 0 when clean. */
export function exitCodeForReport(report: CliReport): ExitCode {
  return report.issues.length > 0 ? 1 : 0;
}

/**
 * Run one CLI invocation end-to-end (arg parsing → read → lint → JSON →
 * render) and return the outcome without touching process I/O. Pure enough to
 * unit-test the full pipeline; `main()` below is the only process glue.
 */
export function runCli(argv: readonly string[]): CliOutcome {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      return { exitCode: 2, stdout: '', stderr: `citesync: ${err.message}\n\n${renderUsage()}` };
    }
    throw err;
  }

  if (args.help) return { exitCode: 0, stdout: renderUsage(), stderr: '' };
  if (args.version) return { exitCode: 0, stdout: `citesync v${VERSION}\n`, stderr: '' };

  // Read + lint through @citesync/core (the only public surface consumed).
  let report: CliReport;
  try {
    const bytes = readFileSync(args.file);
    const lint = lintDocument(bytes);
    report = buildReport(lint, args.file);
  } catch (err) {
    const error = classifyError(err);
    const stderr = `citesync: ${error.message}\n`;
    if (args.mode === 'json') {
      // Machine-readable failure: same schema, issues empty, error block set.
      return {
        exitCode: exitCodeForFailure(error.code),
        stdout: serializeReport(buildErrorReport(args.file, error)),
        stderr,
      };
    }
    return { exitCode: exitCodeForFailure(error.code), stdout: '', stderr };
  }

  // --- JSON is the single source of truth, produced FIRST. ---
  const json = serializeReport(report);
  if (args.mode === 'json') {
    return { exitCode: exitCodeForReport(report), stdout: json, stderr: '' };
  }

  // Default/detailed render the SAME data as the JSON — parse the serialized
  // report back and feed the renderers that object, so a renderer can never
  // read anything that the JSON does not carry (drift-proof by construction).
  const reportData = JSON.parse(json) as CliReport;
  const stdout =
    args.mode === 'detailed' ? renderDetailed(reportData, VERSION) : renderDefault(reportData, VERSION);
  return { exitCode: exitCodeForReport(reportData), stdout, stderr: '' };
}

/** True only when this module is the executed entry (not imported by tests). */
function isMainModule(): boolean {
  const invoked = process.argv[1];
  if (invoked === undefined) return false;
  try {
    return realpathSync(invoked) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const outcome = runCli(process.argv.slice(2));
  if (outcome.stdout.length > 0) process.stdout.write(outcome.stdout);
  if (outcome.stderr.length > 0) process.stderr.write(outcome.stderr);
  process.exitCode = outcome.exitCode;
}
