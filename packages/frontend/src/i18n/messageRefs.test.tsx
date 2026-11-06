import { render, screen } from '@testing-library/react';
import type { MessageRef } from '@craftmanager/backend/contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { NoticeList } from '../components/WorldImport';
import { ApiError, errorFromResponse } from '../lib/api';
import { FakeSocket } from '../test/fakes';
import { baseRoutes, mockApi, offline, serverFixture } from '../test/mockApi';
import { LANG_STORAGE_KEY, I18nProvider, de, en, errorMessage, renderOptionalRef, renderRef, resolveRef } from './index';

// The references the backend sends next to its English texts: rendered in the active language, with the English text
// as the fallback. The language is chosen with the stored choice, the way a user does.
const useLanguage = (lang: 'de' | 'en'): void => window.localStorage.setItem(LANG_STORAGE_KEY, lang);

beforeEach(() => {
  FakeSocket.reset();
  vi.stubGlobal('WebSocket', FakeSocket);
});
afterEach(() => vi.unstubAllGlobals());

describe('renderRef', () => {
  it('renders a message key with its params in both languages', () => {
    const ref: MessageRef = { key: 'SERVER_STARTING', params: { major: 21, port: 25565 } };
    expect(renderRef(ref, de, 'fallback')).toBe('Der Server wird gestartet (Java 21, Port 25565) ...');
    expect(renderRef(ref, en, 'fallback')).toBe('Starting the server (Java 21, port 25565) ...');
  });

  it('words the exit of a server per language from structured params', () => {
    const at = (params: Record<string, string | number>): MessageRef => ({ key: 'SERVER_EXITED_UNEXPECTEDLY', params });
    expect(renderRef(at({ code: 1 }), de, 'x')).toBe('Der Server wurde unerwartet beendet (Exit-Code 1).');
    expect(renderRef(at({ code: 1 }), en, 'x')).toBe('The server exited unexpectedly (exit code 1).');
    expect(renderRef(at({ signal: 'SIGKILL' }), de, 'x')).toBe('Der Server wurde unerwartet beendet (Signal SIGKILL).');
    expect(renderRef({ key: 'SERVER_STOPPED' }, de, 'x')).toBe('Server gestoppt (unbekannter Exit-Code).');
    expect(renderRef({ key: 'SERVER_STOPPED' }, en, 'x')).toBe('Server stopped (exit code unknown).');
  });

  it('renders INSTALLER_FAILED and PLAYER_LOOKUP_FAILED from their params', () => {
    const exit: MessageRef = { key: 'INSTALLER_FAILED', params: { reason: 'exit', exitCode: 3, output: 'boom' } };
    expect(renderRef(exit, en, 'x')).toBe('The installer failed with exit code 3.\nLast output:\nboom');
    expect(renderRef(exit, de, 'x')).toBe('Der Installer ist mit Exit-Code 3 fehlgeschlagen.\nLetzte Ausgabe:\nboom');
    expect(renderRef({ key: 'INSTALLER_FAILED', params: { reason: 'not-started' } }, en, 'x')).toBe('The installer could not be started. Is the Java file valid?');
    expect(renderRef({ key: 'PLAYER_LOOKUP_FAILED', params: { reason: 'timeout' } }, en, 'x')).toContain('did not respond in time');
    expect(renderRef({ key: 'PLAYER_LOOKUP_FAILED', params: { reason: 'rate-limited' } }, de, 'x')).toContain('begrenzt');
    expect(renderRef({ key: 'PLAYER_LOOKUP_FAILED', params: { reason: 'http', status: 503 } }, en, 'x')).toContain('HTTP 503');
  });

  it('renders a key without params as its plain text', () => {
    expect(renderRef({ key: 'SERVER_STOPPING' }, de, 'fallback')).toBe('Der Server wird gestoppt ...');
    expect(renderRef({ key: 'SERVER_STOPPING' }, en, 'fallback')).toBe('Stopping the server ...');
  });

  it('renders an AppError code with the params of the error', () => {
    const ref: MessageRef = { key: 'UPSTREAM_UNREACHABLE', params: { host: 'api.adoptium.net' } };
    expect(renderRef(ref, de, 'fallback')).toBe('Der Dienst „api.adoptium.net“ ist nicht erreichbar. Bitte die Internetverbindung prüfen.');
    expect(renderRef(ref, en, 'fallback')).toBe('The service "api.adoptium.net" cannot be reached. Please check the internet connection.');
  });

  it('shows several references one after the other for MESSAGE_LIST', () => {
    const ref: MessageRef = { key: 'MESSAGE_LIST', params: { '1': { key: 'SERVER_STOPPING' }, '2': { key: 'UPDATE_PROGRESS_FINISHING' } } };
    expect(renderRef(ref, en, 'fallback')).toBe('Stopping the server ... Finishing the update …');
    expect(renderRef(ref, de, 'fallback')).toBe('Der Server wird gestoppt ... Das Update wird abgeschlossen …');
  });

  it('renders a nested reference before the text that holds it', () => {
    const ref: MessageRef = { key: 'START_NOTE', params: { note: { key: 'JAVA_FORGE_OLD_NOTE' } } };
    expect(renderRef(ref, en, 'fallback')).toBe(
      'Note: Forge for Minecraft up to 1.16.5 often does not run with Java versions newer than 11. Java 8 is recommended.',
    );
    expect(renderRef(ref, de, 'fallback')).toBe(
      'Hinweis: Forge für Minecraft bis 1.16.5 läuft oft nicht mit Java-Versionen, die neuer als 11 sind. Java 8 wird empfohlen.',
    );
  });

  it('falls back to the given text for no reference, unknown keys and missing params', () => {
    expect(renderRef(null, de, 'English backend text')).toBe('English backend text');
    expect(renderRef(undefined, de, 'English backend text')).toBe('English backend text');
    expect(renderRef({ key: 'NOT_A_KEY' }, de, 'fb')).toBe('fb');
    expect(renderRef({ key: 'toString' }, de, 'fb')).toBe('fb');
    // a required param is missing: the text would be incomplete, so the backend text is shown
    expect(renderRef({ key: 'SERVER_STARTING', params: { major: 21 } }, de, 'fb')).toBe('fb');
    expect(renderRef({ key: 'UPSTREAM_UNREACHABLE' }, en, 'fb')).toBe('fb');
    // a nested reference that cannot be rendered makes the whole text fall back
    expect(renderRef({ key: 'START_NOTE', params: { note: { key: 'NOT_A_KEY' } } }, en, 'fb')).toBe('fb');
    // a MESSAGE_LIST with one unknown part
    expect(renderRef({ key: 'MESSAGE_LIST', params: { '1': { key: 'SERVER_STOPPING' }, '2': { key: 'NOT_A_KEY' } } }, en, 'fb')).toBe('fb');
  });

  it('keeps an optional param out of the check: the text without it is still translated', () => {
    expect(renderRef({ key: 'NETWORK_PORT_IN_USE', params: { port: 25565 } }, de, 'fb')).toBe(
      'Der Port ist bereits belegt, durch ein anderes Programm oder einen Minecraft-Server. Bitte einen freien Port wählen.',
    );
    expect(renderRef({ key: 'NETWORK_PORT_IN_USE', params: { port: 25565, server: 'Survival' } }, de, 'fb')).toBe(
      'Der Port ist bereits vom Server „Survival“ belegt. Bitte einen freien Port wählen.',
    );
  });

  it('resolves to null when nothing can be rendered, and renderOptionalRef keeps the text', () => {
    expect(resolveRef({ key: 'NOT_A_KEY' }, en)).toBeNull();
    expect(resolveRef(null, en)).toBeNull();
    expect(renderOptionalRef(null, en, undefined)).toBeUndefined();
    expect(renderOptionalRef(null, en, 'text only')).toBe('text only');
    expect(renderOptionalRef({ key: 'SERVER_STOPPING' }, en, 'text only')).toBe('Stopping the server ...');
  });
});

describe('errors with params', () => {
  it('translates an error by its code and params, in both languages', () => {
    const error = new ApiError(502, 'UPSTREAM_UNREACHABLE', 'The service api.adoptium.net cannot be reached.', undefined, { host: 'api.adoptium.net' });
    expect(errorMessage(error, en)).toBe('The service "api.adoptium.net" cannot be reached. Please check the internet connection.');
    expect(errorMessage(error, de)).toBe('Der Dienst „api.adoptium.net“ ist nicht erreichbar. Bitte die Internetverbindung prüfen.');
  });

  it('renders a nested reference of an error, and shows the backend text when it cannot', () => {
    const blocked = new ApiError(409, 'UPDATE_BLOCKED', 'x', undefined, { reason: { key: 'UPDATE_WAIT_INSTALL' } });
    expect(errorMessage(blocked, en)).toBe('The update is blocked at the moment: A server installation is currently running. The update is possible afterwards.');
    expect(errorMessage(blocked, de)).toBe('Das Update ist im Moment blockiert: Gerade läuft die Installation eines Servers. Das Update ist danach möglich.');
    const broken = new ApiError(409, 'UPDATE_BLOCKED', 'English backend text', undefined, { reason: { key: 'NOT_A_KEY' } });
    expect(errorMessage(broken, de)).toBe('English backend text');
  });

  it('keeps the params of an error body', () => {
    const error = errorFromResponse(502, JSON.stringify({ error: { code: 'UPSTREAM_UNREACHABLE', message: 'm', params: { host: 'h' } } }));
    expect(error.params).toEqual({ host: 'h' });
  });
});

describe('the messages are shown in the active language', () => {
  it('shows the status message of a server that waits for Java, in German and in English', async () => {
    const status = { ...offline, state: 'preparing', message: 'Installing Java 21 ...', messageRef: { key: 'JAVA_INSTALLING', params: { major: 21 } } };
    mockApi({
      ...baseRoutes(serverFixture({ status })),
      'GET /api/servers/srv-1/console/history': () => ({ body: { lines: [] } }),
    });
    window.history.replaceState(null, '', '/servers/srv-1');
    useLanguage('de');
    const german = render(<App />);
    expect((await screen.findAllByText('Java 21 wird installiert ...')).length).toBeGreaterThan(0);
    german.unmount();

    useLanguage('en');
    render(<App />);
    expect((await screen.findAllByText('Installing Java 21 ...')).length).toBeGreaterThan(0);
  });

  it('shows a system line of the console in the active language', async () => {
    mockApi({
      ...baseRoutes(serverFixture({ status: { ...offline, state: 'online', pid: 1, startedAt: null, exitCode: null, port: 25565 } })),
      'GET /api/servers/srv-1/console/history': () => ({ body: { lines: [] } }),
    });
    window.history.replaceState(null, '', '/servers/srv-1');
    useLanguage('de');
    render(<App />);
    const socket = await vi.waitFor(() => {
      const found = FakeSocket.instances.find((entry) => entry.url.includes('/console'));
      if (found === undefined) throw new Error('no console socket yet');
      return found;
    });
    socket.open();
    socket.receive({
      type: 'history',
      lines: [{ seq: 1, time: 1_700_000_000_000, stream: 'system', text: 'Stopping the server ...', textRef: { key: 'SERVER_STOPPING' } }],
    });
    expect(await screen.findByText('Der Server wird gestoppt ...')).toBeInTheDocument();
  });

  it('shows an import notice in the active language, and its English text as the fallback', () => {
    const notice = {
      code: 'OTHER_WORLDS',
      level: 'info' as const,
      text: 'Other worlds are not imported: Welt A and 2 more.',
      needsConfirm: false,
      params: { names: 'Welt A', more: 2 },
    };
    const { unmount } = render(
      <I18nProvider>
        <NoticeList notices={[notice]} acknowledged={[]} onToggle={() => undefined} />
      </I18nProvider>,
    );
    expect(screen.getByText('Das Archiv enthält weitere Welten, die nicht übernommen werden: Welt A und 2 weitere.')).toBeInTheDocument();
    unmount();

    window.localStorage.setItem(LANG_STORAGE_KEY, 'en');
    render(
      <I18nProvider>
        <NoticeList notices={[notice]} acknowledged={[]} onToggle={() => undefined} />
      </I18nProvider>,
    );
    expect(screen.getByText('The archive contains other worlds that are not imported: Welt A and 2 more.')).toBeInTheDocument();
  });

  it('shows the progress message of an update in the active language', async () => {
    const update = {
      currentVersion: '0.3.0',
      installMode: 'service',
      installModeNote: null,
      installModeNoteRef: null,
      checksEnabled: true,
      autoCheck: true,
      channel: 'stable',
      repo: 'dxvro/MC-Server-Launcher',
      countdownSeconds: 60,
      checking: false,
      lastCheckAt: null,
      lastCheckError: null,
      lastCheckErrorRef: null,
      latest: { version: '0.4.0', name: null, notes: '', publishedAt: null, htmlUrl: 'https://example.invalid', prerelease: false, assetSizeBytes: null },
      updateAvailable: true,
      canApply: false,
      canApplyReason: null,
      canApplyReasonRef: null,
      phase: 'downloading',
      progress: { message: 'Downloading update to 0.4.0 …', messageRef: { key: 'UPDATE_PROGRESS_DOWNLOADING', params: { version: '0.4.0' } }, percent: 40, countdownRemaining: null },
      error: null,
      errorRef: null,
      job: null,
      history: [],
    };
    mockApi({
      ...baseRoutes(serverFixture({ status: offline })),
      'GET /api/system/update': () => ({ body: update }),
    });
    window.history.replaceState(null, '', '/system');
    useLanguage('de');
    const german = render(<App />);
    expect(await screen.findByText('Update auf 0.4.0 wird heruntergeladen …')).toBeInTheDocument();
    german.unmount();

    useLanguage('en');
    render(<App />);
    expect(await screen.findByText('Downloading update to 0.4.0 …')).toBeInTheDocument();
  });

  it('shows the note of a backup in the active language', async () => {
    const backup = {
      id: 'b1',
      serverId: 'srv-1',
      kind: 'manual',
      status: 'ok',
      fileName: 'b1.tar.gz',
      sizeBytes: 5 * 1024 * 1024,
      rawBytes: 9 * 1024 * 1024,
      includesConfig: false,
      levelName: 'world',
      worlds: ['world'],
      note: 'English note of the backup',
      noteRef: { key: 'BACKUP_NOTE_BEFORE_RESTORE', params: { fileName: 'b1.tar.gz' } },
      error: null,
      errorRef: null,
      createdAt: '2025-03-01T10:00:00.000Z',
      finishedAt: '2025-03-01T10:00:05.000Z',
    };
    mockApi({
      ...baseRoutes(serverFixture({ status: offline })),
      'GET /api/servers/srv-1/backups': () => ({ body: { backups: [backup], schedule: { intervalHours: null, keepLast: 7, includeConfig: false }, totalBytes: 0, freeBytes: 50 * 1024 ** 3, running: false } }),
    });
    window.history.replaceState(null, '', '/servers/srv-1/backups');
    useLanguage('de');
    render(<App />);
    expect(await screen.findByText('Automatisch erstellt vor der Wiederherstellung von b1.tar.gz.')).toBeInTheDocument();
    expect(screen.queryByText('English note of the backup')).not.toBeInTheDocument();
  });
});
