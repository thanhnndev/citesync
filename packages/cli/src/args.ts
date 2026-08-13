/**
 * @citesync/cli — argument parsing (R010 contract).
 *
 * The CLI accepts exactly one positional input — a `.docx` file path — and
 * three output-mode flags. There is NO stdin/pipe input (M002 S4 decision,
 * R010): the only way in is a file path, keeping the surface tiny and CI-
 * friendly.
 *
 * Flags (deterministic, order-independent):
 *   -d | --detailed   per-issue list with source evidence
 *   -j | --json       machine-readable canonical JSON report (single source
 *                     of truth; M003 export reuses the same schema, R014)
 *   -h | --help       usage text (exits 0)
 *   -v | --version    version line (exits 0)
 *
 * A flag conflict (`-d -j`), an unknown flag, a missing file argument, or an
 * extra positional is a `UsageError` — the caller maps it to exit code 2
 * (input could not be processed) with the usage text on stderr.
 */

/** The three output modes. Default = severity summary table. */
export type OutputMode = 'default' | 'detailed' | 'json';

/** Parsed CLI invocation. */
export interface CliArgs {
  /** The one positional: path to the .docx to analyze. Empty when help/version. */
  file: string;
  /** Output mode (default unless -d/-j given). */
  mode: OutputMode;
  /** --help / -h was requested (short-circuits everything else, exit 0). */
  help: boolean;
  /** --version / -v was requested (short-circuits everything else, exit 0). */
  version: boolean;
}

/** A user input error (bad flags / missing file arg). Mapped to exit code 2. */
export class UsageError extends Error {}

const MODE_FLAGS: ReadonlyMap<string, OutputMode> = new Map([
  ['--detailed', 'detailed'],
  ['-d', 'detailed'],
  ['--json', 'json'],
  ['-j', 'json'],
]);

/**
 * Parse `process.argv.slice(2)` into a `CliArgs`. Pure and deterministic:
 * the same argv array always yields the same result.
 *
 * @throws UsageError — unknown flag, conflicting mode flags, missing file
 *   positional, or more than one positional (only a single .docx path is
 *   accepted; no stdin).
 */
export function parseArgs(argv: readonly string[]): CliArgs {
  let mode: OutputMode = 'default';
  let help = false;
  let version = false;
  const positionals: string[] = [];

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--version' || arg === '-v') {
      version = true;
    } else {
      const flagMode = MODE_FLAGS.get(arg);
      if (flagMode !== undefined) {
        if (mode !== 'default') {
          throw new UsageError(`conflicting output mode flags: ${arg} cannot combine with -d/--detailed or -j/--json`);
        }
        mode = flagMode;
      } else if (arg.startsWith('-')) {
        throw new UsageError(`unknown flag: ${arg}`);
      } else {
        positionals.push(arg);
      }
    }
  }

  // --help / --version short-circuit: no file argument required.
  if (help || version) {
    return { file: positionals[0] ?? '', mode, help, version };
  }
  if (positionals.length === 0) {
    throw new UsageError('missing required argument: <file.docx> (no stdin input is supported)');
  }
  if (positionals.length > 1) {
    throw new UsageError(`unexpected extra argument: "${positionals[1]}" (exactly one .docx path is accepted)`);
  }
  return { file: positionals[0] as string, mode, help, version };
}
