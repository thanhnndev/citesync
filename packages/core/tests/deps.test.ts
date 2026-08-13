/**
 * M002-S03-T2 — zero-dependency audit (R009): @citesync/core must carry NO
 * React/DOM/server/UI dependencies, and must be importable + runnable in a
 * BARE Node context (the CLI in S04 and the M003 UI consume THIS package —
 * never the parser directly, PRD §92/§93; the S04 slice plan states "CLI
 * consumes @citesync/core, never the parser directly").
 *
 * What this file audits:
 *   1. `package.json` — declared dependencies are ONLY the workspace
 *      packages (@citesync/docx + @citesync/document-model); no forbidden
 *      library name anywhere in the manifest (deps, dev/peer/optional,
 *      scripts, description).
 *   2. The SOURCE IMPORT GRAPH of `packages/core/src` — every transitive
 *      bare import (through the workspace deps' own src) must be a workspace
 *      package, a `node:` builtin, or an explicit allow-listed pure-data
 *      library (`fflate` — zip decompression in @citesync/docx). Anything
 *      else fails the audit, so a future contributor adding a UI/server
 *      dependency breaks the build here.
 *   3. Workspace transitive manifests — @citesync/docx and
 *      @citesync/document-model declare no forbidden libraries either.
 *   4. BARE NODE IMPORT — spawn a plain `node` process (no vitest, no
 *      bundler) from the repo root, `import '@citesync/core'`, run
 *      `lintDocument(bytes)` end-to-end, and assert the public surface.
 *   5. PARSER ENCAPSULATION — the public entry exports `lintDocument` but
 *      NOT `parseDocument`: the only way a consumer reaches the parser is
 *      through core's `lintDocument` (PRD §92: "UI never directly parses
 *      academic documents"; §93: CLI --> CORE --> DOC). This is the
 *      strongest code-level confirmation available before S04 ships.
 *
 * All audited sources are git-tracked files (packages/<name>/src, package.json);
 * `dist/` (gitignored build output) is never read here.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const CORE_DIR = fileURLToPath(new URL('..', import.meta.url));
const CORE_PKG_PATH = join(CORE_DIR, 'package.json');

/**
 * Libraries that would break the "zero React/DOM/server/UI" constraint
 * (R009). Match on the package name — scoped packages keep their scope.
 * Pure-data libraries are NOT listed here (e.g. `fflate` is zip
 * decompression, not UI/server).
 */
const FORBIDDEN_LIBRARIES = [
  // React / view ecosystems
  'react', 'react-dom', 'preact', 'vue', 'svelte', 'solid-js', '@angular',
  'next', 'remix', '@remix-run', 'nuxt', 'astro', 'gatsby', '@sveltejs',
  // DOM / browser-ish libraries
  'jsdom', 'happy-dom', 'linkedom', 'cheerio', 'parse5', 'canvas',
  'playwright', 'puppeteer', 'selenium-webdriver', '@testing-library',
  'enzyme', 'react-test-renderer',
  // server frameworks
  'express', 'fastify', 'koa', 'hono', '@nestjs', 'hapi', 'restify',
  'polka', 'sails', 'feathers', 'socket.io', 'ws',
] as const;

/**
 * The only third-party (non-workspace, non-node:) libraries the runtime
 * import graph may reference. `fflate` = pure zip/deflate decompression used
 * by @citesync/docx's bounds-guarded reader. Anything else — including a
 * future UI/server/DOM lib — fails the audit.
 */
const ALLOWED_THIRD_PARTY = new Set<string>(['fflate']);

function isForbidden(pkg: string): boolean {
  return FORBIDDEN_LIBRARIES.some((lib) => pkg === lib || pkg.startsWith(`${lib}/`));
}

// ---------------------------------------------------------------------------
// 1. package.json manifest audit.
// ---------------------------------------------------------------------------

const corePkg = JSON.parse(readFileSync(CORE_PKG_PATH, 'utf8')) as {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  bundledDependencies?: string[];
};

describe('@citesync/core manifest (package.json) — zero forbidden libraries', () => {
  it('declares ONLY the workspace runtime dependencies', () => {
    const deps = Object.keys(corePkg.dependencies ?? {});
    expect(deps).toEqual(['@citesync/docx', '@citesync/document-model']);
  });

  it('has no forbidden library in any dependency bucket', () => {
    const buckets = [
      corePkg.dependencies,
      corePkg.devDependencies,
      corePkg.peerDependencies,
      corePkg.optionalDependencies,
    ];
    for (const bucket of buckets) {
      for (const name of Object.keys(bucket ?? {})) {
        expect(isForbidden(name), `forbidden dependency "${name}"`).toBe(false);
      }
    }
    // NOTE: we deliberately do NOT scan the manifest free text — the
    // description legitimately names React/UI to declare their ABSENCE
    // ("zero React/DOM/server/UI dependencies"). Dependency buckets above +
    // the source import-graph audit below are the precise zero-deps proof.
  });
});

// ---------------------------------------------------------------------------
// 2. Source import graph audit (git-tracked src only).
// ---------------------------------------------------------------------------

/**
 * Extract real import specifiers from TypeScript source WITHOUT parsing the
 * language: a tiny state machine that skips comments, string/template
 * literals and regex literals, then recognizes the `from` / `import`
 * keywords followed by a quoted specifier. Comment prose (e.g. `from
 * "w:t"`) and string literals (e.g. the filler token `'from'`) can never
 * produce false positives.
 */
function extractImportSpecifiers(text: string): string[] {
  const specifiers: string[] = [];
  const isWord = (c: string | undefined): c is string => !!c && /[A-Za-z0-9_$]/.test(c);
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i]!;
    const next = text[i + 1];
    if (c === '/' && next === '/') {
      while (i < n && text[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i + 1 < n && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
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
    // Regex-literal heuristic: '/' is a regex start when the previous char
    // is not an identifier, ')', ']', quote or whitespace.
    if (c === '/' && next !== '/' && next !== '*') {
      const prev = text[i - 1];
      if (!isWord(prev) && prev !== ')' && prev !== ']' && prev !== "'" && prev !== '"' && prev !== '`' && prev !== ' ' && prev !== '\t' && prev !== '\n') {
        i++;
        while (i < n) {
          if (text[i] === '\\') {
            i += 2;
            continue;
          }
          if (text[i] === '/') {
            i++;
            break;
          }
          i++;
        }
        continue;
      }
    }
    if (isWord(c)) {
      let j = i;
      while (j < n && isWord(text[j])) j++;
      const word = text.slice(i, j);
      i = j;
      let k = i;
      while (k < n && /\s/.test(text[k]!)) k++;
      const isDynamic = word === 'import' && text[k] === '(';
      if (isDynamic) {
        k++;
        while (k < n && /\s/.test(text[k]!)) k++;
      }
      if ((word === 'from' || word === 'import') && (text[k] === "'" || text[k] === '"')) {
        const quote = text[k]!;
        let end = k + 1;
        while (end < n && text[end] !== quote) end++;
        specifiers.push(text.slice(k + 1, end));
        i = end + 1;
      }
      continue;
    }
    i++;
  }
  return specifiers;
}

function* walkTs(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* walkTs(p);
    else if (entry.endsWith('.ts')) yield p;
  }
}

/** Resolve a relative specifier to a concrete .ts file (dir index fallback). */
function resolveRelative(baseFile: string, spec: string): string | null {
  let p = join(dirname(baseFile), spec);
  if (p.endsWith('.js')) p = p.slice(0, -3) + '.ts';
  else if (!p.endsWith('.ts')) p += '.ts';
  if (statSync(p, { throwIfNoEntry: false })?.isFile()) return p;
  const index = join(p, 'index.ts');
  return statSync(index, { throwIfNoEntry: false })?.isFile() ? index : null;
}

interface GraphAudit {
  /** Every .ts file reachable from packages/core/src through relative + workspace imports. */
  filesVisited: string[];
  /** Package name (scoped-aware) of every non-relative, non-node: import found. */
  bareImports: string[];
  /** Relative specifiers that did not resolve to a file (should be none). */
  unresolved: string[];
}

/**
 * Walk the transitive import graph of `packages/core/src` without touching
 * node_modules or dist: relative imports resolve to git-tracked .ts files,
 * workspace imports (@citesync/*) recurse into their git-tracked src.
 */
function auditImportGraph(): GraphAudit {
  const visited = new Set<string>();
  const bareImports = new Set<string>();
  const unresolved: string[] = [];
  const stack: string[] = [...walkTs(join(CORE_DIR, 'src'))];

  while (stack.length > 0) {
    const file = stack.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const specifiers = extractImportSpecifiers(readFileSync(file, 'utf8'));
    for (const spec of specifiers) {
      if (spec.startsWith('.')) {
        const resolved = resolveRelative(file, spec);
        if (resolved) stack.push(resolved);
        else unresolved.push(`${file.replace(REPO_ROOT, '')} -> ${spec}`);
      } else if (spec.startsWith('node:')) {
        continue; // Node builtin — allowed (no UI/server/React).
      } else {
        const pkg = spec.startsWith('@')
          ? spec.split('/').slice(0, 2).join('/')
          : spec.split('/')[0]!;
        if (pkg.startsWith('@citesync/')) {
          const sub = pkg.slice('@citesync/'.length);
          for (const f of walkTs(join(REPO_ROOT, 'packages', sub, 'src'))) stack.push(f);
        } else {
          bareImports.add(pkg);
        }
      }
    }
  }
  return { filesVisited: [...visited], bareImports: [...bareImports], unresolved };
}

describe('@citesync/core source import graph — no React/DOM/server/UI anywhere', () => {
  it('walks a non-trivial transitive graph (sanity: the closure really was visited)', () => {
    const audit = auditImportGraph();
    expect(audit.filesVisited.length).toBeGreaterThan(20);
    expect(audit.unresolved).toEqual([]);
  });

  it('contains no forbidden library and only allow-listed third-party imports', () => {
    const audit = auditImportGraph();
    for (const pkg of audit.bareImports) {
      expect(isForbidden(pkg), `forbidden library "${pkg}" in the import graph`).toBe(false);
      expect(
        ALLOWED_THIRD_PARTY.has(pkg),
        `unexpected third-party import "${pkg}" — add it deliberately or it breaks the zero-deps constraint`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Workspace transitive manifests.
// ---------------------------------------------------------------------------

describe('transitive workspace manifests (@citesync/docx, @citesync/document-model)', () => {
  it('declare no forbidden libraries either', () => {
    for (const sub of ['docx', 'document-model']) {
      const pkg = JSON.parse(
        readFileSync(join(REPO_ROOT, 'packages', sub, 'package.json'), 'utf8'),
      ) as { dependencies?: Record<string, string> };
      for (const name of Object.keys(pkg.dependencies ?? {})) {
        expect(isForbidden(name), `${sub} depends on forbidden "${name}"`).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Bare Node import + 5. parser encapsulation.
// ---------------------------------------------------------------------------

describe('bare Node import (no vitest, no bundler — what the CLI/S4 will run)', () => {
  it('imports @citesync/core in a plain node process and lints end-to-end', () => {
    const script = `
      import { readFileSync } from 'node:fs';
      import * as core from '@citesync/core';
      const report = core.lintDocument(readFileSync('fixtures/minimal.docx'));
      const surface = Object.keys(core).sort().join(',');
      console.log(JSON.stringify({
        hasLintDocument: typeof core.lintDocument === 'function',
        hasCreateRule: typeof core.createRule === 'function',
        registrySurface: [core.REGISTERED_RULES.length, core.RULE_BY_ID.size, core.RULE_SEVERITIES.length],
        parserEncapsulated: !('parseDocument' in core),
        issueCount: report.issues.length,
        firstIssue: report.issues[0] && { ruleId: report.issues[0].ruleId, severity: report.issues[0].severity },
        ruleIds: report.ruleIds,
        surface,
      }));
    `;
    const out = execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    const result = JSON.parse(out.trim()) as {
      hasLintDocument: boolean;
      hasCreateRule: boolean;
      registrySurface: number[];
      parserEncapsulated: boolean;
      issueCount: number;
      firstIssue: { ruleId: string; severity: string };
      ruleIds: string[];
    };

    expect(result.hasLintDocument).toBe(true);
    expect(result.hasCreateRule).toBe(true);
    expect(result.registrySurface).toEqual([9, 9, 4]); // CS001–CS009, R008 severities
    // PRD §92/§93: the parser is NOT part of core's public surface — the CLI
    // and UI reach parsing only through lintDocument.
    expect(result.parserEncapsulated).toBe(true);
    expect(result.issueCount).toBe(1);
    expect(result.firstIssue).toEqual({ ruleId: 'CS001', severity: 'ERROR' });
    expect(result.ruleIds).toContain('CS001');
    expect(result.ruleIds).toContain('CS009');
  });
});
