import type { MessageKey, MessageParamsMap, MessageRef } from '@craftmanager/backend/contract';
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

// The params of a message as a text function receives them: a nested reference (a reason, a label) arrives as its text
export type ResolvedParams<P> = { [N in keyof P]-?: P[N] extends MessageRef ? string : P[N] };
// One message of the `messages` namespace: a plain text when the key has no params, else a function of its params
export type MessageText<K extends MessageKey> = undefined extends MessageParamsMap[K]
  ? string
  : (params: ResolvedParams<MessageParamsMap[K]>) => string;
// Every key of the backend's message table (contract MessageKey) with its text; a missing key is a compile error
export type MessageTexts = { [K in MessageKey]: MessageText<K> };
