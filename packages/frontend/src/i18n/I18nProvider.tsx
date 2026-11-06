import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { dictionaryFor, setCurrentLang } from './current';
import { LANGS, LOCALES, type Dictionary, type Lang, type Locale } from './types';

export const LANG_STORAGE_KEY = 'craftmanager.lang';

export interface I18n {
  lang: Lang;
  setLang: (lang: Lang) => void;
  // the typed dictionary of the active language
  t: Dictionary;
  // BCP 47 locale for Intl / toLocale*String
  locale: Locale;
}

const isLang = (value: unknown): value is Lang => LANGS.includes(value as Lang);

// stored choice, else the browser language (German -> 'de', anything else -> 'en')
export function detectLang(): Lang {
  try {
    const stored = window.localStorage.getItem(LANG_STORAGE_KEY);
    if (isLang(stored)) return stored;
  } catch {
    // blocked storage: fall through to the browser language
  }
  return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('de') ? 'de' : 'en';
}

function build(lang: Lang, setLang: (lang: Lang) => void): I18n {
  return { lang, setLang, t: dictionaryFor(lang), locale: LOCALES[lang] };
}

// Used when a component is rendered without a provider (isolated component tests): German, no persistence.
const FALLBACK: I18n = build('de', () => undefined);
const I18nContext = createContext<I18n>(FALLBACK);

export function I18nProvider({ children, initialLang }: { children: ReactNode; initialLang?: Lang }): ReactNode {
  const [lang, setLangState] = useState<Lang>(() => initialLang ?? detectLang());
  // synchronously, so lib/format.ts already formats for the new language while the children render
  setCurrentLang(lang);

  const setLang = useCallback((next: Lang): void => {
    setLangState(next);
    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, next);
    } catch {
      // the choice then only lasts until the page is closed
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo(() => build(lang, setLang), [lang, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = (): I18n => useContext(I18nContext);
