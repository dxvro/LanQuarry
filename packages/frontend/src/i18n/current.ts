import { de } from './locales/de';
import { en } from './locales/en';
import { LOCALES, type Dictionary, type Lang, type Locale } from './types';

const DICTIONARIES: Record<Lang, Dictionary> = { de, en };

export const dictionaryFor = (lang: Lang): Dictionary => DICTIONARIES[lang];

// Module-level mirror of the active language. I18nProvider updates it while rendering, so plain
// (non-React) helpers such as lib/format.ts can read the language without a hook.
let currentLang: Lang = 'de';

export function setCurrentLang(lang: Lang): void {
  currentLang = lang;
}
export const getCurrentLang = (): Lang => currentLang;
export const getCurrentLocale = (): Locale => LOCALES[currentLang];
export const getCurrentDictionary = (): Dictionary => DICTIONARIES[currentLang];
