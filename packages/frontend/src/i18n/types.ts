import type { de } from './locales/de';

export type Lang = 'de' | 'en';
export const LANGS: readonly Lang[] = ['de', 'en'];
export type Locale = 'de-DE' | 'en-US';
export const LOCALES: Record<Lang, Locale> = { de: 'de-DE', en: 'en-US' };
export const LANGUAGE_NAMES: Record<Lang, string> = { de: 'Deutsch', en: 'English' };

// The German dictionary is the source of truth; every other language must have exactly this shape.
export type Dictionary = typeof de;
// Type of one namespace, for the per-namespace files of the other languages: `export const mods: Namespace<'mods'> = {...}`
export type Namespace<K extends keyof Dictionary> = Dictionary[K];
