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

  it('uses the dictionary text for known codes in both languages, whatever the backend message says', () => {
    expect(errorMessage(api('ORIGIN_FORBIDDEN', 'The origin is not allowed.'), en)).toBe('The request comes from an origin that is not allowed and was rejected.');
    expect(errorMessage(api('SERVER_NOT_FOUND', 'The server was not found.'), en)).toBe('The server was not found.');
    expect(errorMessage(api('SERVER_NOT_FOUND', 'Der Server wurde nicht gefunden.'), de)).toBe('Der Server wurde nicht gefunden.');
    expect(errorMessage(api('SERVER_NOT_FOUND', 'The server was not found.'), de)).toBe('Der Server wurde nicht gefunden.');
    expect(errorMessage(api('UNAUTHORIZED', 'Sign-in required.'), de)).toBe('Anmeldung erforderlich. Bitte anmelden.');
  });

  it('falls back to the backend message only for unknown codes, and to the status text for HTTP_ codes', () => {
    expect(errorMessage(api('SOMETHING_NEW', 'Something new went wrong.'), en)).toBe('Something new went wrong.');
    expect(errorMessage(api('SOMETHING_NEW', 'Etwas Neues ist passiert.'), de)).toBe('Etwas Neues ist passiert.');
    expect(errorMessage(api('HTTP_502', 'Bad', undefined, 502), en)).toBe('The server responded unexpectedly (status 502).');
    expect(errorMessage(api('HTTP_502', 'Bad', undefined, 502), de)).toBe('Der Server hat unerwartet geantwortet (Status 502).');
  });

  it('uses details for functional entries in both languages', () => {
    expect(errorMessage(api('TOO_MANY_ATTEMPTS', 'x', { retryAfterSeconds: 12 }, 429), en)).toBe('Too many failed sign-in attempts. Please try again in 12 seconds.');
    expect(errorMessage(api('TOO_MANY_ATTEMPTS', 'x', { retryAfterSeconds: 12 }, 429), de)).toBe('Zu viele fehlgeschlagene Anmeldeversuche. Bitte in 12 Sekunden erneut versuchen.');
  });

  it('translates the player and property codes, using the details when present', () => {
    expect(errorMessage(api('PLAYER_NOT_FOUND', 'x', { name: 'Notch' }, 404), en)).toBe('Player not found: the name "Notch" does not exist at Mojang.');
    expect(errorMessage(api('PLAYER_NOT_FOUND', 'x', undefined, 404), en)).toBe('Player not found: this name does not exist at Mojang.');
    expect(errorMessage(api('PLAYER_NOT_LISTED', 'x', { name: 'Notch' }, 404), en)).toBe('"Notch" is not in this list.');
    expect(errorMessage(api('PLAYER_NOT_LISTED', 'x', undefined, 404), en)).toBe('This entry is not in the list.');
    expect(errorMessage(api('OP_LEVEL_LIVE', 'x', { level: 4 }, 409), en)).toContain('default level (4)');
    expect(errorMessage(api('OP_LEVEL_LIVE', 'x', undefined, 409), en)).toContain('only the default level is assigned');
    expect(errorMessage(api('PLAYER_NOT_FOUND', 'x', { name: 'Notch' }, 404), de)).toBe('Spieler nicht gefunden: Der Name „Notch“ existiert bei Mojang nicht.');
    expect(errorMessage(api('PLAYER_NOT_LISTED', 'x', undefined, 404), de)).toBe('Dieser Eintrag steht nicht in der Liste.');
    for (const code of ['PLAYERS_BUSY', 'PLAYERS_UNSUPPORTED', 'PLAYER_LIST_CORRUPT', 'PLAYER_LOOKUP_FAILED', 'PROPERTY_NOT_REMOVABLE']) {
      expect(errorMessage(api(code, 'Backend message', undefined, 409), en), code).not.toBe('Backend message');
      expect(errorMessage(api(code, 'Backend message', undefined, 409), de), code).not.toBe('Backend message');
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
    expect(errorMessage(api('PORT_IN_USE', 'Port belegt', { port: 25565 }, 409), de)).toBe(
      'Port 25565 wird bereits von einem anderen Programm verwendet oder darf nicht genutzt werden. Bitte das Programm beenden oder in den Servereigenschaften einen anderen Port einstellen.',
    );
    expect(errorMessage(api('PORT_IN_USE', 'Port belegt', { port: 25565, serverName: 'Survival' }, 409), de)).toBe(
      'Port 25565 wird bereits vom laufenden Server „Survival“ verwendet. Bitte in den Servereigenschaften einen anderen Port einstellen.',
    );
  });

  it('translates the codes that the backend sends with German and English details alike', () => {
    expect(errorMessage(api('JAVA_NOT_FOUND', 'x', { required: 17, requiredMax: 21, found: [] }, 422), de)).toBe(
      'Es wurde keine Java-Installation gefunden. Benötigt wird Java 17 bis 21. Bitte Java installieren oder im Server den Java-Pfad angeben.',
    );
    expect(errorMessage(api('JAVA_NOT_FOUND', 'x', { javaPath: '/opt/java/bin/java' }, 422), en)).toContain('/opt/java/bin/java');
    expect(errorMessage(api('JAVA_VERSION_INCOMPATIBLE', 'x', { required: 17, requiredMax: 21, found: [8, 8] }, 422), de)).toBe(
      'Dieser Server benötigt Java 17 bis 21, gefunden wurde Java 8.',
    );
    expect(errorMessage(api('JAVA_IN_USE', 'x', { servers: [{ name: 'Survival' }, { name: 'Creative' }] }, 409), de)).toBe(
      'Diese Java-Laufzeit wird gerade von folgenden Servern verwendet: Survival, Creative. Bitte zuerst die Server stoppen.',
    );
    expect(errorMessage(api('JAVA_NOT_AVAILABLE', 'x', { major: 25, platform: 'linux-riscv64' }, 422), en)).toBe(
      'Eclipse Temurin does not offer Java 25 for linux-riscv64. Please install Java 25 manually and enter its path in the server.',
    );
    expect(errorMessage(api('MOD_INCOMPATIBLE', 'x', { mods: ['A', 'B'] }, 409), de)).toBe('„A“ ist nicht mit „B“ kompatibel.');
    expect(errorMessage(api('MOD_REQUIRED_BY_OTHERS', 'x', { dependents: [{ name: 'Gamma' }] }, 409), de)).toBe('Dieser Mod wird von anderen Mods benötigt: Gamma.');
    expect(errorMessage(api('MOD_REQUIRED_BY_OTHERS', 'x', { dependents: [{ name: 'Gamma' }] }, 409), en)).toBe('This mod is required by other mods: Gamma.');
    expect(errorMessage(api('RAM_EXCEEDS_SYSTEM', 'x', { maxRamMb: 16384, totalRamMb: 8192 }, 422), de)).toBe(
      'Der maximale Arbeitsspeicher (16384 MB) übersteigt den Arbeitsspeicher dieses Rechners (8192 MB).',
    );
    expect(errorMessage(api('FILE_LOCKED', 'x', { fileName: 'world/level.dat' }, 423), de)).toContain('Die Datei „world/level.dat“ wird von einem anderen Programm verwendet');
    expect(errorMessage(api('FILE_LOCKED', 'x', undefined, 423), en)).toContain('The file is used by another program');
  });

  it('knows the codes the backend sends outside AppError: unsupported media type and invalid messages', () => {
    expect(errorMessage(api('UNSUPPORTED_MEDIA_TYPE', 'The content type is not supported.', undefined, 415), en)).toBe('The content type of the request is not supported.');
    expect(errorMessage(api('UNSUPPORTED_MEDIA_TYPE', 'Inhaltstyp', undefined, 415), de)).toBe('Der Inhaltstyp der Anfrage wird nicht unterstützt.');
    expect(errorMessage(api('INVALID_MESSAGE', 'The message is malformed.'), en)).toBe('The message is invalid.');
    expect(errorMessage(api('INVALID_MESSAGE', 'Die Nachricht ist fehlerhaft.'), de)).toBe('Die Nachricht ist ungültig.');
  });

  it('handles plain errors and non-errors', () => {
    expect(errorMessage(new Error('boom'), en)).toBe('boom');
    expect(errorMessage(null, en)).toBe('Unknown error.');
    expect(errorMessage('weird', de)).toBe('Unbekannter Fehler.');
  });

  it('shows the validation details as a generic line per field in both languages, never the backend text of the detail', async () => {
    const detail = [{ path: 'body.name', message: 'Backend text of the detail' }];
    window.localStorage.setItem(LANG_STORAGE_KEY, 'en');
    const { unmount } = render(
      <I18nProvider>
        <ErrorNotice error={api('VALIDATION_ERROR', 'The request contains invalid data.', detail)} />
      </I18nProvider>,
    );
    expect(await screen.findByText('body.name: invalid value')).toBeInTheDocument();
    expect(screen.queryByText(/Backend text of the detail/)).not.toBeInTheDocument();
    unmount();
    window.localStorage.setItem(LANG_STORAGE_KEY, 'de');
    render(
      <I18nProvider>
        <ErrorNotice error={api('VALIDATION_ERROR', 'The request contains invalid data.', detail)} />
      </I18nProvider>,
    );
    expect(await screen.findByText('body.name: ungültiger Wert')).toBeInTheDocument();
    expect(screen.queryByText(/Backend text of the detail/)).not.toBeInTheDocument();
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
