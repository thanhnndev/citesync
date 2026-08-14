/**
 * M005-S01-T3 — design token contract test.
 *
 * Guards the T03 deliverable: apps/web/src/design-system.css must define the
 * full token set from docs/UI-SPEC.md §1 (colors incl. severity mapping,
 * typography, spacing, radius, shadow, z-index) + breakpoints §2.1, and
 * apps/web/src/app.css must consume tokens instead of hardcoded values.
 *
 * A regression here means the CSS drifted from the spec (a token dropped, a
 * hardcoded color reintroduced) — fix the CSS to match the spec, don't weaken
 * this test. Adding a NEW token is allowed (spec asserts presence, not
 * absence — same philosophy as ui-spec.test.ts).
 *
 * Path resolution: `new URL('../src/design-system.css', import.meta.url)`
 * from apps/web/tests → apps/web/src/design-system.css (cwd-independent).
 */

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DS_PATH = new URL('../src/design-system.css', import.meta.url).pathname;
const APP_CSS_PATH = new URL('../src/app.css', import.meta.url).pathname;

/** Token names exactly as written in UI-SPEC §1 (contract — 1:1). */
const REQUIRED_TOKENS = [
  // 1.1 Color
  '--cs-color-bg',
  '--cs-color-bg-surface',
  '--cs-color-bg-subtle',
  '--cs-color-bg-hover',
  '--cs-color-bg-highlight',
  '--cs-color-fg',
  '--cs-color-fg-muted',
  '--cs-color-fg-inverse',
  '--cs-color-border',
  '--cs-color-border-strong',
  '--cs-color-accent',
  '--cs-color-accent-hover',
  '--cs-color-accent-tint',
  '--cs-color-done',
  // 1.1.1 Severity mapping (+ tint per severity)
  '--cs-color-severity-error',
  '--cs-color-severity-error-tint',
  '--cs-color-severity-warning',
  '--cs-color-severity-warning-tint',
  '--cs-color-severity-ambiguous',
  '--cs-color-severity-ambiguous-tint',
  '--cs-color-severity-info',
  '--cs-color-severity-info-tint',
  // 1.2 Typography
  '--cs-font-sans',
  '--cs-font-mono',
  '--cs-font-size-display',
  '--cs-font-size-h2',
  '--cs-font-size-h3',
  '--cs-font-size-body',
  '--cs-font-size-caption',
  '--cs-font-size-code',
  '--cs-font-size-code-sm',
  '--cs-line-height-tight',
  '--cs-line-height-normal',
  '--cs-font-weight-semibold',
  '--cs-font-weight-bold',
  // 1.3 Spacing
  '--cs-space-1',
  '--cs-space-2',
  '--cs-space-3',
  '--cs-space-4',
  '--cs-space-5',
  '--cs-space-6',
  '--cs-space-7',
  '--cs-space-8',
  '--cs-space-page-x',
  // 1.4 Border radius
  '--cs-radius-sm',
  '--cs-radius-md',
  '--cs-radius-lg',
  '--cs-radius-pill',
  // 1.5 Shadow
  '--cs-shadow-sm',
  '--cs-shadow-md',
  '--cs-shadow-lg',
  // 1.6 Z-index
  '--cs-z-base',
  '--cs-z-zone-overlay',
  '--cs-z-sticky',
  '--cs-z-overlay',
  '--cs-z-modal',
  '--cs-z-toast',
  // 2.1 Breakpoints
  '--cs-bp-wide',
  '--cs-bp-narrow',
  '--cs-bp-tablet',
  '--cs-bp-mobile',
] as const;

describe('apps/web/src/design-system.css — M005-S01-T3 token contract', () => {
  const ds = existsSync(DS_PATH) ? readFileSync(DS_PATH, 'utf8') : '';

  it('design-system.css exists and is non-empty', () => {
    expect(ds.length).toBeGreaterThan(1_000);
  });

  it('defines every token required by UI-SPEC §1 + §2.1', () => {
    for (const token of REQUIRED_TOKENS) {
      expect(
        new RegExp(`${token}\\s*:`).test(ds),
        `missing token ${token} — UI-SPEC §1 requires it`,
      ).toBe(true);
    }
  });

  it('severity mapping is complete and canonical (ERROR→WARNING→AMBIGUOUS→INFO)', () => {
    const severities = ['error', 'warning', 'ambiguous', 'info'];
    for (const sev of severities) {
      expect(ds.includes(`--cs-color-severity-${sev}:`), `missing severity ${sev}`).toBe(true);
      expect(ds.includes(`--cs-color-severity-${sev}-tint:`), `missing tint ${sev}`).toBe(true);
    }
    // Canonical order (D022/D024 — conservative first).
    const order = ['error', 'warning', 'ambiguous', 'info'].map(
      (s) => ds.indexOf(`--cs-color-severity-${s}:`),
    );
    expect(order[0]).toBeGreaterThan(-1);
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
    expect(order[2]).toBeLessThan(order[3]);
  });

  it('legacy aliases from the §1.7 migration map still resolve', () => {
    for (const alias of [
      '--color-accent',
      '--color-border',
      '--color-text',
      '--color-muted',
      '--color-error',
      '--color-warning',
      '--color-ambiguous',
      '--color-info',
      '--color-done',
      '--radius',
    ]) {
      expect(ds.includes(`${alias}:`), `missing legacy alias ${alias}`).toBe(true);
    }
  });
});

describe('apps/web/src/app.css — consumes tokens, no hardcoded colors', () => {
  const css = existsSync(APP_CSS_PATH) ? readFileSync(APP_CSS_PATH, 'utf8') : '';

  it('app.css exists and is non-empty', () => {
    expect(css.length).toBeGreaterThan(1_000);
  });

  it('uses design tokens pervasively (no hardcoded color hex values)', () => {
    const hexColors = css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hexColors, `hardcoded hex colors left in app.css: ${hexColors.join(', ')}`).toEqual([]);
    const rgbaColors = css.match(/rgba?\([^)]*\)/g) ?? [];
    expect(rgbaColors, `hardcoded rgb()/rgba() colors left in app.css: ${rgbaColors.join(', ')}`).toEqual([]);
  });

  it('references --cs-* tokens across the styling surface', () => {
    const tokenUses = (css.match(/var\(--cs-/g) ?? []).length;
    expect(tokenUses).toBeGreaterThan(50);
    // Every category is exercised somewhere in app.css.
    for (const category of ['color', 'font', 'space', 'radius', 'shadow', 'z']) {
      expect(css.includes(`var(--cs-${category}-`), `no ${category} token used in app.css`).toBe(true);
    }
  });

  it('app shell (header/main) is token-driven', () => {
    expect(css).toMatch(/\.app-shell\s*{[^}]*var\(--cs-/);
    expect(css).toMatch(/\.app-header\s*{[^}]*var\(--cs-/);
    expect(css).toMatch(/\.processing-badge\s*{[^}]*var\(--cs-/);
  });
});
