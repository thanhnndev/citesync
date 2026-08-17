/**
 * M005-S01-T4 — i18n parity + contract tests (UI-SPEC §7.1).
 *
 * Guards the hand-rolled typed dictionary:
 *   - EN↔VI key parity (no missing/extra keys — §7.1.1 "parity test bắt
 *     buộc"), placeholder-set equality per key, key naming convention
 *     (§7.1.3 `{surface}.{element}.{variant}`),
 *   - the FROZEN-text contract: stage labels, worker error descriptions and
 *     engine issue text must NEVER get a dictionary key (they stay EN
 *     literal — §7.1.1),
 *   - the §7.1.3 documented mapping table is pinned (a drift here breaks
 *     the contract),
 *   - `interpolate` semantics + the LocaleProvider behavior (default EN
 *     renders the EN table — behavior-identical; switching locales swaps
 *     the table; useI18n outside the provider fails fast).
 *
 * Runs in the node vitest environment — React is rendered to static markup
 * (react-dom/server), no jsdom needed.
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocaleProvider } from './index';
import { useI18n } from './useI18n';
import {
  DEFAULT_LOCALE,
  dictionaries,
  en,
  interpolate,
  placeholdersOf,
  vi,
} from './dictionary';
import type { I18nKey, Locale } from './dictionary';

/** The §7.1.3 surface set — every key's first segment must be one of these. */
const ALLOWED_SURFACES = [
  'common',
  'drop',
  'stages',
  'report',
  'explorer',
  'evidence',
  'resolution',
  'export',
  'recovery',
  'onboarding',
  'error',
] as const;

const KEYS = Object.keys(en) as I18nKey[];

describe('i18n dictionary — EN↔VI parity (§7.1.1)', () => {
  it('en and vi share the exact same key set (no missing / no extra keys)', () => {
    expect(Object.keys(vi).sort()).toEqual(Object.keys(en).sort());
  });

  it('every key resolves in both locales with a non-empty value', () => {
    for (const key of KEYS) {
      expect(en[key], `en.${key}`).toBeTruthy();
      expect(vi[key], `vi.${key}`).toBeTruthy();
      expect(en[key].trim(), `en.${key}`).not.toBe('');
      expect(vi[key].trim(), `vi.${key}`).not.toBe('');
    }
  });

  it('placeholder sets match between locales for every key', () => {
    for (const key of KEYS) {
      expect(placeholdersOf(en[key]).sort(), `placeholder set of ${key}`).toEqual(
        placeholdersOf(vi[key]).sort(),
      );
    }
  });
});

describe('i18n dictionary — key naming convention (§7.1.3)', () => {
  it('every key is lowercase dot-separated with hyphen compounds and no data values', () => {
    for (const key of KEYS) {
      expect(key, `key ${key}`).toMatch(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/);
    }
  });

  it('every key starts with an allowed §7.1.3 surface', () => {
    for (const key of KEYS) {
      const surface = key.split('.')[0];
      expect(ALLOWED_SURFACES, `surface of ${key}`).toContain(surface);
    }
  });

  it('keys with placeholders have no literal numbers/counts embedded (data-free keys)', () => {
    for (const key of KEYS) {
      expect(key, `key ${key}`).not.toMatch(/[0-9]/);
    }
  });
});

describe('i18n dictionary — FROZEN engine text has no key (§7.1.1)', () => {
  it('stage labels (PIPELINE_STAGES, D025) are never dictionary values', () => {
    const stageLabels = [
      'Reading document',
      'Detecting bibliography',
      'Finding citations',
      'Matching references',
      'Running checks',
    ];
    const values = [...Object.values(en), ...Object.values(vi)];
    for (const label of stageLabels) {
      expect(values, `stage label "${label}" must stay engine-side (EN literal)`).not.toContain(
        label,
      );
    }
  });

  it('worker error descriptions (protocol.ts, D021/R016) are never dictionary values', () => {
    const workerDescriptions = [
      'This file does not look like a DOCX document. Try a .docx file exported from Word or Google Docs.',
      'This document was rejected for safety — it exceeds the size limits.',
      'The document could not be parsed.',
      'The analysis took too long and was stopped to keep the app responsive.',
    ];
    const values = [...Object.values(en), ...Object.values(vi)];
    for (const description of workerDescriptions) {
      expect(
        values,
        `worker description "${description}" must stay protocol-side (EN literal)`,
      ).not.toContain(description);
    }
  });
});

describe('i18n dictionary — §7.1.3 documented mapping is pinned', () => {
  it('every UI string documented in the §7.1.3 table maps to its key', () => {
    const documented: ReadonlyArray<readonly [I18nKey, string]> = [
      ['drop.title', 'Drop a .docx file here'],
      ['drop.hint', 'or click to choose — analysis runs locally in your browser'],
      ['drop.dragging', 'Drop to analyze'],
      ['common.badge.ready', 'Ready — analysis runs locally in your browser'],
      ['common.badge.processing', 'Processing locally'],
      ['common.badge.done', 'Processed locally — never left this device'],
      ['stages.title', 'Analysis stages'],
      ['evidence.no-refs', 'No references matched'],
      ['explorer.empty', 'No issues found.'],
      ['export.failure', 'Export failed. Try again.'],
      ['recovery.no-candidates', 'No candidates available.'],
      // The h2 keeps its current text; the aria-label carries the longer
      // descriptive string from the spec's example row.
      ['resolution.title', 'Resolve ambiguity'],
      ['resolution.aria-label', 'Resolve ambiguous citation'],
    ];
    for (const [key, value] of documented) {
      expect(en[key], `en.${key}`).toBe(value);
    }
  });
});

describe('interpolate — simple {name} substitution', () => {
  it('substitutes every declared placeholder', () => {
    expect(interpolate('"{name}" is not a .docx file.', { name: 'paper.doc' })).toBe(
      '"paper.doc" is not a .docx file.',
    );
  });

  it('substitutes numbers (counts stay data, outside the string)', () => {
    expect(interpolate('{count} resolved', { count: 3 })).toBe('3 resolved');
  });

  it('multiple params substitute in one pass', () => {
    expect(interpolate('{citations} · {references} · {rules}', { citations: 5, references: 2, rules: 9 })).toBe(
      '5 · 2 · 9',
    );
  });

  it('returns the template verbatim when no params are given', () => {
    expect(interpolate('Processing locally')).toBe('Processing locally');
  });

  it('a missing param leaves the placeholder literal (never crashes)', () => {
    expect(interpolate('Drop {name} here', {})).toBe('Drop {name} here');
  });
});

describe('LocaleProvider — default EN render is behavior-identical (§7.1.1)', () => {
  // NOTE: this file is `.ts` (not `.tsx`) per the T04 file contract, so React
  // is built with createElement — vite:oxc rejects JSX inside .ts files.

  /** A tiny consumer that renders one translated string via useI18n. */
  function Probe(props: { useKey: I18nKey }) {
    const { t } = useI18n();
    return createElement('span', { 'data-probe': true }, t(props.useKey));
  }

  function renderProbe(useKey: I18nKey, defaultLocale?: Locale): string {
    return renderToStaticMarkup(
      createElement(LocaleProvider, {
        // `defaultLocale` undefined falls back to DEFAULT_LOCALE (EN) — the
        // same default the real app uses, so this drives the EN branch.
        defaultLocale,
        children: createElement(Probe, { useKey }),
      }),
    );
  }

  it('renders the EN table with no explicit locale (default)', () => {
    const html = renderProbe('common.badge.processing');
    expect(html).toContain('Processing locally');
  });

  it('renders the VI table when defaultLocale="vi"', () => {
    const html = renderProbe('common.badge.processing', 'vi');
    expect(html).toContain('Đang xử lý trên máy');
  });

  it('interpolates params through t()', () => {
    function InterpProbe() {
      const { t } = useI18n();
      return createElement(
        'span',
        { 'data-probe': true },
        t('drop.invalid-file', { name: 'paper.doc' }),
      );
    }
    const html = renderToStaticMarkup(
      createElement(LocaleProvider, null, createElement(InterpProbe)),
    );
    // renderToStaticMarkup HTML-escapes the quotes in text content.
    expect(html).toContain('&quot;paper.doc&quot; is not a .docx file.');
  });

  it('DEFAULT_LOCALE is EN and the default table IS the en table', () => {
    expect(DEFAULT_LOCALE).toBe('en');
    expect(dictionaries[DEFAULT_LOCALE]).toBe(en);
  });
});

describe('useI18n — fails fast outside the provider', () => {
  it('throws when used without a LocaleProvider', () => {
    function Outer() {
      const { t } = useI18n();
      return createElement('span', null, t('report.title'));
    }
    expect(() => renderToStaticMarkup(createElement(Outer))).toThrow(
      'useI18n must be used within a <LocaleProvider>',
    );
  });
});
