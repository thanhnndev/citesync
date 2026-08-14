/**
 * M004-S02-T1 — absence audit for R016 ("no remote content is ever loaded
 * and nothing is executed from the document").
 *
 * deps.test.ts audits the IMPORT GRAPH (which libraries may be linked); this
 * file audits API USAGE — that no network or dynamic-eval call site exists
 * anywhere in the runtime code paths that touch a document:
 *
 *   - packages/core/src   (lint pipeline)
 *   - packages/docx/src   (reader / model builder)
 *   - apps/web/src/worker (web worker — the only web runtime code path)
 *
 * Banned family (assert ZERO occurrences in CODE position):
 *   fetch(   XMLHttpRequest   WebSocket(   EventSource(   eval(
 *   Function( (subsumes `new Function`)   import( (dynamic import only)
 *
 * The scanner is a tiny state machine over raw source — the same skip
 * discipline as extractImportSpecifiers in deps.test.ts (MEM078/MEM090):
 * comments, ' " ` string/template literals and regex literals are skipped,
 * so comment prose that legitimately names the APIs ("never fetched", "no
 * eval, no network" — MEM127/MEM140) and string literals can never produce
 * false positives. Naive `rg` over file text is FORBIDDEN for this reason.
 *
 * The test self-validates its own scanner on synthetic samples first (so a
 * broken lexer that matches nothing cannot pass vacuously), then scans every
 * git-tracked .ts file in the three directories.
 *
 * All scanned files are git-tracked src — dist/, node_modules/, .gsd/ and
 * other gitignored paths are never read.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/** Directories scanned for banned API usage (git-tracked src only). */
const SCAN_DIRS = [
  join(REPO_ROOT, 'packages', 'core', 'src'),
  join(REPO_ROOT, 'packages', 'docx', 'src'),
  join(REPO_ROOT, 'apps', 'web', 'src', 'worker'),
] as const;

// ---------------------------------------------------------------------------
// Scanner: banned API sequences in CODE position only.
// ---------------------------------------------------------------------------

/**
 * A banned token is an identifier (word chars) immediately followed by a
 * code-position marker, OR a bare identifier:
 *   - word + '('  → call sites: fetch( eval( Function( WebSocket( EventSource(
 *     and dynamic import(. The '(' must be IMMEDIATELY after the identifier
 *     (word-boundary care: `eval(` must not match `evaluate(`, and static
 *     `import ... from` must not match `import(`).
 *   - `XMLHttpRequest` is a bare identifier (constructor reference — the
 *     name is only reachable through the global, so any occurrence in code
 *     position is a violation regardless of whether it is immediately
 *     followed by `(`).
 * `Function(` subsumes `new Function` — the call token itself is banned.
 */
const CALL_TOKENS = [
  'fetch',
  'eval',
  'Function',
  'WebSocket',
  'EventSource',
] as const;
const BARE_IDENTIFIER_TOKENS = ['XMLHttpRequest'] as const;
const DYNAMIC_IMPORT_WORD = 'import';

export interface BannedOccurrence {
  /** The exact token that matched (e.g. `fetch(`, `XMLHttpRequest`, `import(`). */
  token: string;
  /** 0-based character index of the token start in the scanned text. */
  index: number;
}

/**
 * Scan a source string for banned API sequences that appear in CODE
 * position. Comments, string/template literals (with backslash-escape
 * handling) and regex literals (prev-char heuristic, plus character-class
 * awareness so a '/' inside [..] does not end the regex early) are skipped —
 * the exact skip discipline deps.test.ts established for its import-graph
 * scanner.
 */
export function findBannedSequences(text: string): BannedOccurrence[] {
  const occurrences: BannedOccurrence[] = [];
  const isWord = (c: string | undefined): c is string =>
    !!c && /[A-Za-z0-9_$]/.test(c);
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i]!;
    const next = text[i + 1];

    // Line comment.
    if (c === '/' && next === '/') {
      while (i < n && text[i] !== '\n') i++;
      continue;
    }
    // Block comment.
    if (c === '/' && next === '*') {
      i += 2;
      while (i + 1 < n && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    // String / template literal.
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      i++;
      while (i < n) {
        if (text[i] === '\\') {
          i += 2;
          continue;
        }
        if (text[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    // Regex literal (prev-char heuristic, same as deps.test.ts): '/' starts a
    // regex when the previous char is not an identifier char, ')', ']', quote
    // or whitespace. We also skip over `[...]` character classes so a '/'
    // inside a class does not prematurely end the regex (defensive against
    // regexes like /[/]fetch\(/ — a legit "mention" pattern).
    if (c === '/' && next !== '/' && next !== '*') {
      const prev = text[i - 1];
      if (
        !isWord(prev) &&
        prev !== ')' &&
        prev !== ']' &&
        prev !== "'" &&
        prev !== '"' &&
        prev !== '`' &&
        prev !== ' ' &&
        prev !== '\t' &&
        prev !== '\n'
      ) {
        i++;
        let inClass = false;
        while (i < n) {
          if (text[i] === '\\') {
            i += 2;
            continue;
          }
          if (text[i] === '[') inClass = true;
          else if (text[i] === ']') inClass = false;
          else if (text[i] === '/' && !inClass) {
            i++;
            break;
          }
          i++;
        }
        continue;
      }
    }
    // Code position: scan identifier tokens.
    if (isWord(c)) {
      let j = i;
      while (j < n && isWord(text[j])) j++;
      const word = text.slice(i, j);
      const after = text[j];
      const record = (token: string): void => {
        occurrences.push({ token, index: i });
      };
      if ((CALL_TOKENS as readonly string[]).includes(word) && after === '(') {
        record(`${word}(`);
      } else if (word === DYNAMIC_IMPORT_WORD && after === '(') {
        record('import(');
      } else if ((BARE_IDENTIFIER_TOKENS as readonly string[]).includes(word)) {
        record(word);
      }
      i = j;
      continue;
    }
    i++;
  }
  return occurrences;
}

// ---------------------------------------------------------------------------
// Self-validation — the scanner must behave correctly on synthetic samples
// BEFORE it audits the repo, so the audit cannot pass vacuously.
// ---------------------------------------------------------------------------

describe('absence scanner self-validation (synthetic samples)', () => {
  it('flags every banned API in code position', () => {
    expect(findBannedSequences('const r = fetch(url);')).toEqual([
      { token: 'fetch(', index: 10 },
    ]);
    expect(findBannedSequences('const xhr = new XMLHttpRequest();')).toEqual([
      { token: 'XMLHttpRequest', index: 16 },
    ]);
    expect(findBannedSequences('const ws = new WebSocket("ws://x");')).toEqual([
      { token: 'WebSocket(', index: 15 },
    ]);
    expect(findBannedSequences('const es = new EventSource("/sse");')).toEqual([
      { token: 'EventSource(', index: 15 },
    ]);
    expect(findBannedSequences('const code = eval("1+1");')).toEqual([
      { token: 'eval(', index: 13 },
    ]);
    // `Function(` subsumes `new Function` — only the call token is reported.
    expect(findBannedSequences('const f = new Function("return 1");')).toEqual([
      { token: 'Function(', index: 14 },
    ]);
    expect(findBannedSequences('Function("x")')).toEqual([
      { token: 'Function(', index: 0 },
    ]);
    expect(findBannedSequences('const m = await import("./mod.js");')).toEqual([
      { token: 'import(', index: 16 },
    ]);
  });

  it('flags multiple distinct occurrences and reports every index', () => {
    const out = findBannedSequences('fetch(1); // c\neval(2);');
    expect(out).toEqual([
      { token: 'fetch(', index: 0 },
      { token: 'eval(', index: 15 },
    ]);
  });

  it('NEVER flags comment prose (MEM127/MEM140)', () => {
    // The build-model.ts docstring style: "No eval, no network" — no `(`
    // after the word, so no match.
    expect(findBannedSequences('// we never call fetch( on anything')).toEqual([]);
    expect(findBannedSequences('* `security.remoteTargets` first-seen and never fetched. No eval, no network,')).toEqual([]);
    expect(findBannedSequences('/* eval( and fetch( must never appear here */')).toEqual([]);
  });

  it('NEVER flags string / template literals', () => {
    expect(findBannedSequences("const s = 'WebSocket( is just text';")).toEqual([]);
    expect(findBannedSequences('const t = `eval( and fetch(${x}) inside a template`;')).toEqual([]);
    expect(findBannedSequences('const q = "import( ./mod.js )";')).toEqual([]);
  });

  it('NEVER flags regex literals that mention the APIs', () => {
    expect(findBannedSequences('const re = /fetch\\(/;')).toEqual([]);
    expect(findBannedSequences('if (/import\\(/.test(s)) return;')).toEqual([]);
    expect(findBannedSequences('const re2 = /[/]eval\\(/;')).toEqual([]);
  });

  it('enforces word boundaries (eval( ≠ evaluate(), import( ≠ static import)', () => {
    expect(findBannedSequences('evaluate(x);')).toEqual([]);
    expect(findBannedSequences('myFetch(x);')).toEqual([]);
    expect(findBannedSequences("import { x } from './x.js';")).toEqual([]);
    expect(findBannedSequences("import * as m from './m.js';")).toEqual([]);
    expect(findBannedSequences('import.meta.url;')).toEqual([]);
    expect(findBannedSequences('XMLHttpRequestLike(x);')).toEqual([]);
    expect(findBannedSequences('const f = Function; // bare reference, no call')).toEqual([]);
    expect(findBannedSequences('fetched = true;')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Repo scan — zero banned API sequences across git-tracked src.
// ---------------------------------------------------------------------------

function* walkTs(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* walkTs(p);
    else if (entry.endsWith('.ts')) yield p;
  }
}

/**
 * The set of git-tracked files under the scanned directories, repo-root
 * relative. Any .ts file that exists on disk but is NOT in this set fails a
 * dedicated assertion — an untracked file could otherwise slip past the scan
 * (and past a future commit) without anyone noticing.
 */
function gitTrackedFilesUnder(relDirs: string[]): Set<string> {
  const out = execFileSync('git', ['ls-files', ...relDirs], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  return new Set(out.split('\n').filter((l) => l.length > 0));
}

describe('R016 absence audit — no network/eval API anywhere in core/docx/worker src', () => {
  const relDirs = SCAN_DIRS.map((d) => relative(REPO_ROOT, d));
  const tracked = gitTrackedFilesUnder(relDirs);

  it('visits a non-trivial corpus (sanity: the scan really ran)', () => {
    // 52 .ts files exist today (4 core + 45 docx + 3 worker). The ≥40 floor
    // keeps the audit from silently degrading if dirs are ever restructured.
    const files = [...walkTs(SCAN_DIRS[0]), ...walkTs(SCAN_DIRS[1]), ...walkTs(SCAN_DIRS[2])];
    expect(files.length).toBeGreaterThanOrEqual(40);
    expect(files.length).toBe(52); // exact today-count lock (4+45+3)
  });

  it('scans ONLY git-tracked src — an untracked .ts file fails loudly', () => {
    const untracked: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of walkTs(dir)) {
        const rel = relative(REPO_ROOT, file);
        if (!tracked.has(rel)) untracked.push(rel);
      }
    }
    expect(untracked).toEqual([]);
  });

  it('finds ZERO banned API sequences in code position across every scanned file', () => {
    const violations: Record<string, BannedOccurrence[]> = {};
    let filesScanned = 0;
    for (const dir of SCAN_DIRS) {
      for (const file of walkTs(dir)) {
        const rel = relative(REPO_ROOT, file);
        if (!tracked.has(rel)) continue; // untracked → asserted elsewhere
        filesScanned++;
        const hits = findBannedSequences(readFileSync(file, 'utf8'));
        if (hits.length > 0) violations[rel] = hits;
      }
    }
    expect(filesScanned).toBeGreaterThanOrEqual(40);
    expect(violations).toEqual({});
  });
});
