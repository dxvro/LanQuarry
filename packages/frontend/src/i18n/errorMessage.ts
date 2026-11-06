import { ApiError } from '../lib/api';
import type { Dictionary } from './types';

type ErrorText = string | ((details: Record<string, unknown>) => string);

// Turns any thrown value into text for the active language. The backend only speaks German: for a known
// error `code` the English text comes from `t.errors.codes`; in German, or for unknown codes and dynamic
// messages (names, paths, numbers inside the text), the backend's own message is shown unchanged.
export function errorMessage(error: unknown, t: Dictionary): string {
  if (error instanceof ApiError) {
    if (t.errors.translateCodes) {
      const entry = (t.errors.codes as Record<string, ErrorText | undefined>)[error.code];
      if (typeof entry === 'string') return entry;
      if (typeof entry === 'function') {
        const details = typeof error.details === 'object' && error.details !== null ? (error.details as Record<string, unknown>) : {};
        return entry(details);
      }
      if (error.code.startsWith('HTTP_')) return t.errors.unexpectedStatus(error.status);
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return t.errors.unknown;
}
