/**
 * M005-S01-T4 — LocaleProvider (UI-SPEC §7.1, hand-rolled i18n).
 *
 * Holds the current locale (default EN — behavior-identical render) and
 * exposes the typed `t(key, params?)` translator. `t` reads the locale's
 * table from the typed dictionary and runs simple `{name}` interpolation
 * (see dictionary.ts). No pluralization, no context, no ICU — by decision
 * (§7.1.1, not over-engineered for 2 locales).
 *
 * The context object is memoized (locale + setLocale + t all stable between
 * locale changes) so consumers re-render exactly once per switch.
 */

import { createContext, useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { DEFAULT_LOCALE, dictionaries, interpolate } from './dictionary';
import type { I18nKey, InterpolationParams, Locale } from './dictionary';

/** What `useI18n()` returns — the whole i18n surface of the app. */
export interface I18nContextValue {
  /** The active locale ('en' by default). */
  locale: Locale;
  /** Switch the active locale (re-renders every consumer). */
  setLocale: (locale: Locale) => void;
  /**
   * Translate a typed key with optional `{name}` interpolation, e.g.
   * `t('drop.invalid-file', { name: fileName })`.
   */
  t: (key: I18nKey, params?: InterpolationParams) => string;
}

/** Internal context — `useI18n` throws outside the provider (fail fast). */
export const I18nContext = createContext<I18nContextValue | null>(null);

export interface LocaleProviderProps {
  /** The subtree that can use `useI18n`. */
  children: ReactNode;
  /**
   * Initial locale — defaults to EN so the current render is
   * behavior-identical until the user switches (T04 verify).
   */
  defaultLocale?: Locale;
}

export function LocaleProvider({ children, defaultLocale = DEFAULT_LOCALE }: LocaleProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(defaultLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
  }, []);

  // Stable per locale: a locale switch re-creates `t` exactly once.
  const t = useCallback(
    (key: I18nKey, params?: InterpolationParams) =>
      interpolate(dictionaries[locale][key], params),
    [locale],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
