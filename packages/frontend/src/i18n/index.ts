// Contributor notes - adding a string:
// 1. Add it to the German file src/i18n/locales/de/<namespace>.ts (German is the source of truth; nested keys, values are
//    strings or functions like `(n: number) => ...` for interpolation/plural). Namespaces are registered already.
// 2. Add the same key to locales/en/<namespace>.ts. The English file is typed `Namespace<'x'>`, so a missing or extra key is a type error.
// 3. Use it: `const { t, locale } = useI18n(); ... {t.backups.count(3)}`. Components that call lib/format.ts helpers should also call useI18n()
//    so they re-render on a language change. Outside React use `getCurrentDictionary()`. Show errors with `<ErrorNotice>` / `errorMessage(e, t)`.
export { I18nProvider, useI18n, detectLang, LANG_STORAGE_KEY, type I18n } from './I18nProvider';
export { errorMessage } from './errorMessage';
export { getCurrentDictionary, getCurrentLang, getCurrentLocale, setCurrentLang, dictionaryFor } from './current';
export { LANGS, LANGUAGE_NAMES, LOCALES, type Dictionary, type Lang, type Locale, type Namespace } from './types';
export { de } from './locales/de';
export { en } from './locales/en';
