import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { ErrorNotice } from '../components/ui';
import { formatDuration, formatInt } from '../lib/format';
import { ApiError } from '../lib/api';
import { de, en, errorMessage, I18nProvider, LANG_STORAGE_KEY, useI18n, type Dictionary } from './index';

function Probe(): React.ReactNode {
  const { t, lang, locale } = useI18n();
  return (
    <p>
      {t.shell.overview}|{lang}|{locale}|{formatInt(1234567)}
    </p>
  );
}

function setNavigatorLanguage(value: string): void {
  vi.spyOn(window.navigator, 'language', 'get').mockReturnValue(value);
}

afterEach(() => vi.restoreAllMocks());

describe('dictionary parity', () => {
  // kind of every leaf: strings and functions (with their arity) must line up, objects recurse
  const shape = (value: unknown): unknown => {
    if (typeof value === 'function') return `fn/${value.length}`;
    if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, shape(inner)]));
    return typeof value;
  };
  const keys = (value: unknown, prefix = ''): string[] =>
    typeof value === 'object' && value !== null ? Object.entries(value).flatMap(([key, inner]) => keys(inner, `${prefix}${key}.`)) : [prefix];

  it('has identical key sets, value kinds and function arities in de and en', () => {
    expect(keys(en).sort()).toEqual(keys(de).sort());
    expect(shape(en)).toEqual(shape(de));
  });

  it('is enforced at compile time', () => {
    expectTypeOf(en).toEqualTypeOf<Dictionary>();
    // @ts-expect-error a dictionary missing namespaces is not a Dictionary
    const incomplete: Dictionary = { common: de.common };
    expect(incomplete).toBeDefined();
    // @ts-expect-error a missing key inside a namespace is an error
    const missingKey: Dictionary['login'] = { title: 'x' };
    expect(missingKey).toBeDefined();
  });
});

describe('language selection', () => {
  it('uses the stored language first', () => {
    window.localStorage.setItem(LANG_STORAGE_KEY, 'en');
    setNavigatorLanguage('de-DE');
    render(<I18nProvider><Probe /></I18nProvider>);
    expect(screen.getByText(/^Overview\|en\|en-US\|1,234,567$/)).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('en');
  });

  it('falls back to German for a German browser and to English otherwise', () => {
    window.localStorage.removeItem(LANG_STORAGE_KEY);
    setNavigatorLanguage('de-AT');
    const german = render(<I18nProvider><Probe /></I18nProvider>);
    expect(screen.getByText(/^Übersicht\|de\|de-DE\|1\.234\.567$/)).toBeInTheDocument();
    german.unmount();

    setNavigatorLanguage('fr-FR');
    render(<I18nProvider><Probe /></I18nProvider>);
    expect(screen.getByText(/^Overview\|en/)).toBeInTheDocument();
  });

  it('ignores garbage in storage and survives a throwing storage', () => {
    window.localStorage.setItem(LANG_STORAGE_KEY, 'klingon');
    setNavigatorLanguage('en-GB');
    const first = render(<I18nProvider><Probe /></I18nProvider>);
    expect(screen.getByText(/^Overview\|en/)).toBeInTheDocument();
    first.unmount();

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result } = renderHook(() => useI18n(), { wrapper: I18nProvider });
    expect(result.current.lang).toBe('en');
    act(() => result.current.setLang('de'));
    expect(result.current.lang).toBe('de');
  });

  it('switches visible text, document language, formatting and persists the choice', async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <Probe />
        <LanguageSwitcher />
      </I18nProvider>,
    );
    expect(screen.getByText(/^Übersicht\|de/)).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('de');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Sprache / Language' }), 'en');
    expect(screen.getByText(/^Overview\|en\|en-US\|1,234,567$/)).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('en');
    expect(window.localStorage.getItem(LANG_STORAGE_KEY)).toBe('en');
    expect(formatDuration(30_000)).toBe('under 1 min');
  });

  it('renders German without any provider', () => {
    render(<Probe />);
    expect(screen.getByText(/^Übersicht\|de/)).toBeInTheDocument();
  });
});

describe('errorMessage', () => {
  const api = (code: string, message = 'Deutsche Meldung', details?: unknown, status = 400): ApiError => new ApiError(status, code, message, details);

  it('translates known codes in English and keeps the backend message in German', () => {
    expect(errorMessage(api('ORIGIN_FORBIDDEN'), en)).toBe('The request comes from an origin that is not allowed and was rejected.');
    expect(errorMessage(api('SERVER_NOT_FOUND'), en)).toBe('The server was not found.');
    expect(errorMessage(api('SERVER_NOT_FOUND'), de)).toBe('Deutsche Meldung');
  });

  it('uses details for functional entries and falls back for unknown codes', () => {
    expect(errorMessage(api('TOO_MANY_ATTEMPTS', 'x', { retryAfterSeconds: 12 }, 429), en)).toBe('Too many failed sign-in attempts. Please try again in 12 seconds.');
    expect(errorMessage(api('SOMETHING_NEW', 'Neu'), en)).toBe('Neu');
    expect(errorMessage(api('HTTP_502', 'Bad', undefined, 502), en)).toBe('The server responded unexpectedly (status 502).');
  });

  it('translates the player and property codes, using the details when present', () => {
    expect(errorMessage(api('PLAYER_NOT_FOUND', 'x', { name: 'Notch' }, 404), en)).toBe('Player not found: the name "Notch" does not exist at Mojang.');
    expect(errorMessage(api('PLAYER_NOT_FOUND', 'x', undefined, 404), en)).toBe('Player not found: this name does not exist at Mojang.');
    expect(errorMessage(api('PLAYER_NOT_LISTED', 'x', { name: 'Notch' }, 404), en)).toBe('"Notch" is not in this list.');
    expect(errorMessage(api('PLAYER_NOT_LISTED', 'x', undefined, 404), en)).toBe('This entry is not in the list.');
    expect(errorMessage(api('OP_LEVEL_LIVE', 'x', { level: 4 }, 409), en)).toContain('default level (4)');
    expect(errorMessage(api('OP_LEVEL_LIVE', 'x', undefined, 409), en)).toContain('only the default level is assigned');
    for (const code of ['PLAYERS_BUSY', 'PLAYERS_UNSUPPORTED', 'PLAYER_LIST_CORRUPT', 'PLAYER_LOOKUP_FAILED', 'PROPERTY_NOT_REMOVABLE']) {
      expect(errorMessage(api(code, 'Deutsche Meldung', undefined, 409), en), code).not.toBe('Deutsche Meldung');
    }
  });

  it('translates the codes that came with the newer backend errors, with their details', () => {
    expect(errorMessage(api('PORT_IN_USE', 'x', { port: 25565, serverName: 'Survival' }, 409), en)).toBe('Port 25565 is already used by the running server "Survival". Please set another port in the server properties.');
    expect(errorMessage(api('PORT_IN_USE', 'x', { port: 25565 }, 409), en)).toContain('Port 25565 is already in use by another program');
    expect(errorMessage(api('MOD_INCOMPATIBLE', 'x', { mods: ['A', 'B'] }, 409), en)).toBe('"A" is not compatible with "B".');
    expect(errorMessage(api('JAVA_NOT_FOUND', 'x', { required: 21, requiredMax: null, found: [] }, 422), en)).toContain('Java 21 or newer');
    expect(errorMessage(api('JAVA_VERSION_INCOMPATIBLE', 'x', { required: 17, requiredMax: 21, found: [8, 8] }, 422), en)).toBe('This server needs Java 17 to 21, found Java 8.');
    expect(errorMessage(api('REASON_NOT_ASCII', 'Deutsche Meldung', undefined, 422), en)).toBe(
      'The reason may only contain plain letters (A–Z) while the server is running; umlauts are converted automatically.',
    );
    expect(errorMessage(api('PLAYER_NAME_NEEDS_RUNNING_SERVER', 'Deutsche Meldung', { name: '.Steve' }, 409), en)).toContain('".Steve" is a Bedrock name');
    expect(errorMessage(api('WORLD_NEWER', 'Deutsche Meldung', undefined, 409), en)).toContain('newer Minecraft version');
    expect(errorMessage(api('PORT_IN_USE', 'Deutsche Meldung', { port: 25565 }, 409), de)).toBe('Deutsche Meldung');
  });

  it('handles plain errors and non-errors', () => {
    expect(errorMessage(new Error('boom'), en)).toBe('boom');
    expect(errorMessage(null, en)).toBe('Unknown error.');
    expect(errorMessage('weird', de)).toBe('Unbekannter Fehler.');
  });

  it('shows the validation details in English as a generic line per field, and keeps the German text in German', async () => {
    const detail = [{ path: 'body.name', message: 'Deutsch' }];
    window.localStorage.setItem(LANG_STORAGE_KEY, 'en');
    const { unmount } = render(
      <I18nProvider>
        <ErrorNotice error={api('VALIDATION_ERROR', 'Die Anfrage enthält ungültige Daten.', detail)} />
      </I18nProvider>,
    );
    expect(await screen.findByText('body.name: invalid value')).toBeInTheDocument();
    expect(screen.queryByText('Deutsch')).not.toBeInTheDocument();
    unmount();
    window.localStorage.setItem(LANG_STORAGE_KEY, 'de');
    render(
      <I18nProvider>
        <ErrorNotice error={api('VALIDATION_ERROR', 'Die Anfrage enthält ungültige Daten.', detail)} />
      </I18nProvider>,
    );
    expect(await screen.findByText('body.name: Deutsch')).toBeInTheDocument();
  });

  it('is applied by ErrorNotice', async () => {
    window.localStorage.setItem(LANG_STORAGE_KEY, 'en');
    render(
      <I18nProvider>
        <ErrorNotice error={api('HOST_FORBIDDEN')} />
      </I18nProvider>,
    );
    expect(await screen.findByText(/The host of the request is not allowed/)).toBeInTheDocument();
    expect(screen.getByText('Error code: HOST_FORBIDDEN')).toBeInTheDocument();
  });
});
