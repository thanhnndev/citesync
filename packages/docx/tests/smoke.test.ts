import { describe, expect, it } from 'vitest';
import * as fflate from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import rootPkg from '../../../package.json';
import docxPkg from '../package.json';

// Placeholder smoke test (S01-T1): proves the npm-workspaces + TS + Vitest
// toolchain is wired end-to-end and that runtime deps resolve from the
// workspace. Replaced/extended by the real reader/model suite in S01-T8.

describe('toolchain smoke (S01-T1)', () => {
  it('runs a trivial vitest test through the workspace project', () => {
    expect(1 + 1).toBe(2);
  });

  it('resolves runtime dependencies from the docx workspace', () => {
    // fflate: zip primitives used by the bounds-guarded reader (S01-T3).
    expect(typeof fflate.unzipSync).toBe('function');
    // fast-xml-parser: OOXML parsing (S01-T4+).
    expect(typeof XMLParser).toBe('function');
  });

  it('pins toolchain and runtime versions exactly (determinism, R008)', () => {
    const rootDev = rootPkg.devDependencies as Record<string, string>;
    const docxDeps = docxPkg.dependencies as Record<string, string>;

    // Exact pins, no range specifiers — re-installs are byte-deterministic.
    for (const [name, expected] of Object.entries({
      typescript: '5.9.3',
      vitest: '4.1.10',
      fflate: '0.8.3',
      'fast-xml-parser': '5.10.1',
    })) {
      const spec = rootDev[name] ?? docxDeps[name];
      expect(spec, `${name} must be declared`).toBe(expected);

      // Negative guard: a caret/range spec would break re-install determinism.
      // @types/node and tsx intentionally stay ranged (node-following), so
      // this scope is limited to the four critical pins.
      expect(spec?.startsWith('^') || spec?.startsWith('~')).toBe(false);
    }
  });
});
