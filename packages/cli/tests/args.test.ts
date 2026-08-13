/**
 * @citesync/cli — argument-parsing unit tests (T1: flags parse; R010).
 *
 * The CLI accepts exactly one positional (.docx path, no stdin) plus the
 * output-mode flags -d/--detailed and -j/--json, and -h/--help, -v/--version.
 * Everything else is a UsageError mapped to exit code 2 by the runner.
 */

import { describe, expect, it } from 'vitest';

import { parseArgs, UsageError } from '../src/args.js';

describe('parseArgs — positional (file path, no stdin)', () => {
  it('accepts exactly one .docx path and defaults to the default output mode', () => {
    expect(parseArgs(['thesis.docx'])).toEqual({
      file: 'thesis.docx',
      mode: 'default',
      help: false,
      version: false,
    });
  });

  it('accepts an absolute or directory-qualified path as the single positional', () => {
    expect(parseArgs(['/tmp/dir/thesis.docx']).file).toBe('/tmp/dir/thesis.docx');
    expect(parseArgs(['./manuscripts/a.docx']).file).toBe('./manuscripts/a.docx');
  });

  it('rejects stdin/pipe-style usage — no positional is a UsageError', () => {
    expect(() => parseArgs([])).toThrow(UsageError);
    expect(() => parseArgs(['--json'])).toThrow(UsageError);
  });

  it('rejects a second positional', () => {
    expect(() => parseArgs(['a.docx', 'b.docx'])).toThrow(UsageError);
  });
});

describe('parseArgs — output-mode flags', () => {
  it('parses -d / --detailed and -j / --json in any position', () => {
    expect(parseArgs(['thesis.docx', '-d']).mode).toBe('detailed');
    expect(parseArgs(['thesis.docx', '--detailed']).mode).toBe('detailed');
    expect(parseArgs(['-j', 'thesis.docx']).mode).toBe('json');
    expect(parseArgs(['thesis.docx', '--json']).mode).toBe('json');
  });

  it('rejects conflicting mode flags', () => {
    expect(() => parseArgs(['thesis.docx', '-d', '-j'])).toThrow(UsageError);
    expect(() => parseArgs(['thesis.docx', '--json', '--detailed'])).toThrow(UsageError);
  });

  it('rejects unknown flags', () => {
    expect(() => parseArgs(['thesis.docx', '--bogus'])).toThrow(UsageError);
    expect(() => parseArgs(['thesis.docx', '-x'])).toThrow(UsageError);
  });
});

describe('parseArgs — help / version short-circuit', () => {
  it('accepts --help / -h without a file argument', () => {
    expect(parseArgs(['--help'])).toMatchObject({ help: true, file: '' });
    expect(parseArgs(['thesis.docx', '-h']).help).toBe(true);
  });

  it('accepts --version / -v without a file argument', () => {
    expect(parseArgs(['--version'])).toMatchObject({ version: true, file: '' });
    expect(parseArgs(['thesis.docx', '-v']).version).toBe(true);
  });
});
