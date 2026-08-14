/**
 * M005-S01-T4 — useI18n hook (UI-SPEC §7.1).
 *
 * Consumes the LocaleProvider context: `const { t, locale, setLocale } =
 * useI18n()`. Throws outside the provider so a component wired before the
 * provider (or a test forgetting the wrapper) fails fast instead of
 * rendering silently-untranslated copy.
 */

import { useContext } from 'react';
import { I18nContext } from './index';
import type { I18nContextValue } from './index';

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (context === null) {
    throw new Error('useI18n must be used within a <LocaleProvider>');
  }
  return context;
}
