import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { FakeSocket } from '../test/fakes';
import { baseRoutes, mockApi, offline, serverFixture, type MockApi } from '../test/mockApi';

let api: MockApi;

const eventsSocket = (): FakeSocket => {
  const socket = FakeSocket.instances.find((entry) => entry.url.includes('/api/events'));
  if (socket === undefined) throw new Error('Kein Ereignis-Socket');
  return socket;
};

beforeEach(() => {
  FakeSocket.reset();
  vi.stubGlobal('WebSocket', FakeSocket);
  window.history.replaceState(null, '', '/servers/srv-1');
});
afterEach(() => vi.unstubAllGlobals());

function setup(server: Record<string, unknown>, extra: Record<string, () => { status?: number; body: unknown }> = {}): void {
  api = mockApi({
    ...baseRoutes(server),
    'GET /api/servers/srv-1/console/history': () => ({ body: { lines: [] } }),
    'GET /api/servers/srv-1/install-log': () => ({ body: { lines: [], totalLines: 0, truncated: false } }),
    ...extra,
  });
}

describe('starting without Java', () => {
  it('shows the preparing state with progress, an "Abbrechen" button and no kill/restart buttons', async () => {
    setup(serverFixture());
    api.set('POST /api/servers/srv-1/start', () => ({ body: { status: { ...offline, state: 'preparing', message: 'Java 21 wird installiert ...' }, warnings: [] } }));
    api.set('POST /api/servers/srv-1/stop', () => ({ body: { status: offline } }));
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Starten' }));
    act(() => {
      eventsSocket().open();
      eventsSocket().receive({ type: 'server.status', serverId: 'srv-1', status: { ...offline, state: 'preparing', startedAt: Date.now(), message: 'Java 21 wird installiert (43 %) ...' } });
      eventsSocket().receive({ type: 'java.install', major: 21, state: 'running', phase: 'download', percent: 43, message: 'Java 21 wird heruntergeladen (21 von 49 MB)', error: null });
    });
    expect(await screen.findByText('Java 21 wird installiert (43 %) ...')).toBeInTheDocument();
    expect(screen.getAllByText('Bereitet vor').length).toBeGreaterThan(0);
    expect(screen.getByRole('progressbar', { name: 'Installation von Java 21' })).toHaveAttribute('aria-valuenow', '43');
    expect(screen.getByText('Java 21 wird heruntergeladen (21 von 49 MB)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erzwingen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Neustart' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(api.callsTo('POST /api/servers/srv-1/stop')).toHaveLength(1));
  });

  it('shows a failed preparation as a start failure with the readable message', async () => {
    setup(serverFixture());
    render(<App />);
    await screen.findByRole('button', { name: 'Starten' });
    act(() => {
      eventsSocket().open();
      eventsSocket().receive({ type: 'server.status', serverId: 'srv-1', status: { ...offline, state: 'crashed', message: 'Die heruntergeladene Datei stimmt nicht mit der erwarteten Prüfsumme überein.' } });
    });
    expect(await screen.findByText('Der Server konnte nicht gestartet werden')).toBeInTheDocument();
    expect(screen.getByText(/Prüfsumme überein/)).toBeInTheDocument();
  });
});

describe('start errors about Java', () => {
  const missing = { status: 422, body: { error: { code: 'JAVA_NOT_FOUND', message: 'Es wurde keine Java-Installation gefunden. Benötigt wird Java 21 oder neuer.', details: { required: 21, requiredMax: null, found: [] } } } };

  it('offers to install the right Java instead of sending the user to the settings', async () => {
    setup(serverFixture());
    api.set('POST /api/servers/srv-1/start', () => missing);
    api.set('POST /api/java/runtimes/21/install', () => ({ body: { runtime: { major: 21 }, alreadyInstalled: false } }));
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Starten' }));
    expect(await screen.findByText(/Es wurde keine Java-Installation gefunden/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Java 21 installieren' }));
    expect(await screen.findByText('Java 21 ist installiert. Der Server kann jetzt gestartet werden.')).toBeInTheDocument();
    expect(api.callsTo('POST /api/java/runtimes/21/install')).toHaveLength(1);
    expect(screen.queryByText('Java-Laufzeit einstellen')).not.toBeInTheDocument();
  });

  it('picks the major that satisfies the bounds of old Forge', async () => {
    setup(serverFixture({ loader: 'forge', mcVersion: '1.12.2', requiredJavaMajor: 8 }));
    api.set('POST /api/servers/srv-1/start', () => ({
      status: 422,
      body: { error: { code: 'JAVA_VERSION_INCOMPATIBLE', message: 'Dieser Server benötigt Java 8, gefunden wurde Java 21.', details: { required: 8, requiredMax: 8, found: [21] } } },
    }));
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Starten' }));
    expect(await screen.findByRole('button', { name: 'Java 8 installieren' })).toBeInTheDocument();
  });

  it('does not offer an installation when the server pins its own Java path', async () => {
    setup(serverFixture({ javaPath: 'C:/kaputt/java.exe' }));
    api.set('POST /api/servers/srv-1/start', () => ({
      status: 422,
      body: { error: { code: 'JAVA_NOT_FOUND', message: 'Die eingestellte Java-Installation wurde nicht gefunden oder startet nicht: C:/kaputt/java.exe', details: { javaPath: 'C:/kaputt/java.exe' } } },
    }));
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Starten' }));
    expect(await screen.findByText(/nicht gefunden oder startet nicht/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /installieren/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Java-Pfad des Servers ändern' })).toHaveAttribute('href', '/servers/srv-1/config');
  });

  it('shows a failure of the manual installation under the button', async () => {
    setup(serverFixture());
    api.set('POST /api/servers/srv-1/start', () => missing);
    api.set('POST /api/java/runtimes/21/install', () => ({ status: 502, body: { error: { code: 'UPSTREAM_UNREACHABLE', message: 'Der Dienst „api.adoptium.net“ ist nicht erreichbar. Bitte Internetverbindung prüfen.' } } }));
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Starten' }));
    await user.click(await screen.findByRole('button', { name: 'Java 21 installieren' }));
    expect(await screen.findByText('Ein externer Dienst ist nicht erreichbar. Bitte die Internetverbindung prüfen.')).toBeInTheDocument();
  });
});

describe('install panel and install log', () => {
  const installing = (): Record<string, unknown> => serverFixture({ installState: 'installing' });
  const fileLines = [
    { seq: 0, time: 1_700_000_000_000, text: '=== Installation von neoforge 1.21.1 gestartet ===' },
    { seq: 1, time: 1_700_000_001_000, text: 'Version wird bei der Quelle abgefragt ...' },
    { seq: 2, time: 1_700_000_002_000, text: 'Java 21 wird bei Adoptium abgefragt ...' },
  ];

  it('loads install.log when opened during an installation and continues with live lines without duplicates', async () => {
    setup(installing(), { 'GET /api/servers/srv-1/install-log': () => ({ body: { lines: fileLines, totalLines: 3, truncated: false } }) });
    render(<App />);
    const log = await screen.findByRole('log', { name: 'Installationsprotokoll' });
    await waitFor(() => expect(log).toHaveTextContent('Java 21 wird bei Adoptium abgefragt ...'));
    expect(api.callsTo('GET /api/servers/srv-1/install-log')[0]?.url).toBe('/api/servers/srv-1/install-log?tail=500');

    act(() => {
      eventsSocket().open();
      // line 2 is already in the file; 3 and 4 are new; 3 arrives twice (reconnect replay)
      eventsSocket().receive({ type: 'install.log', serverId: 'srv-1', line: 'Java 21 wird bei Adoptium abgefragt ...', seq: 2, time: 1_700_000_002_000 });
      eventsSocket().receive({ type: 'install.log', serverId: 'srv-1', line: 'Java 21 wird heruntergeladen', seq: 3, time: 1_700_000_003_000 });
      eventsSocket().receive({ type: 'install.log', serverId: 'srv-1', line: 'Java 21 wird heruntergeladen', seq: 3, time: 1_700_000_003_000 });
      eventsSocket().receive({ type: 'install.log', serverId: 'srv-1', line: 'Java 21 wird entpackt', seq: 4, time: 1_700_000_004_000 });
    });
    await waitFor(() => expect(log).toHaveTextContent('Java 21 wird entpackt'));
    expect(log.textContent?.split('\n')).toEqual([
      '=== Installation von neoforge 1.21.1 gestartet ===',
      'Version wird bei der Quelle abgefragt ...',
      'Java 21 wird bei Adoptium abgefragt ...',
      'Java 21 wird heruntergeladen',
      'Java 21 wird entpackt',
    ]);
  });

  it('keeps live lines that arrived before the file was loaded and fills the gap by reading the file again', async () => {
    let calls = 0;
    setup(installing(), {
      'GET /api/servers/srv-1/install-log': () => {
        calls++;
        return calls === 1
          ? { body: { lines: fileLines.slice(0, 2), totalLines: 2, truncated: false } }
          : { body: { lines: [...fileLines, { seq: 3, time: 1, text: 'Zeile 3 aus der Datei' }, { seq: 4, time: 1, text: 'Zeile 4 aus der Datei' }], totalLines: 5, truncated: false } };
      },
    });
    render(<App />);
    const log = await screen.findByRole('log', { name: 'Installationsprotokoll' });
    await waitFor(() => expect(log).toHaveTextContent('Version wird bei der Quelle abgefragt ...'));
    act(() => {
      eventsSocket().open();
      // lines 2 to 3 were missed: 4 arrives directly after the file's last line 1
      eventsSocket().receive({ type: 'install.log', serverId: 'srv-1', line: 'Zeile 4 live', seq: 4, time: 5 });
    });
    await waitFor(() => expect(api.callsTo('GET /api/servers/srv-1/install-log').length).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(log.textContent?.split('\n')).toHaveLength(5));
    expect(log.textContent?.split('\n').filter((line) => line.startsWith('Zeile 4'))).toHaveLength(1);
  });

  it('shows the log and the error text after a failed installation, with the file as source', async () => {
    setup(serverFixture({ installState: 'failed', installError: 'Der Installer ist mit Exit-Code 1 fehlgeschlagen.' }), {
      'GET /api/servers/srv-1/install-log': () => ({ body: { lines: [...fileLines, { seq: 3, time: 1, text: 'FEHLER: Der Installer ist mit Exit-Code 1 fehlgeschlagen.' }], totalLines: 4, truncated: true } }),
    });
    render(<App />);
    expect(await screen.findByLabelText('Fehlertext der Installation')).toHaveTextContent('Exit-Code 1');
    const log = await screen.findByRole('log', { name: 'Installationsprotokoll' });
    await waitFor(() => expect(log).toHaveTextContent('FEHLER: Der Installer'));
    expect(screen.getByText(/Aus der Datei install.log im Serverordner \(nur die letzten 500 Zeilen\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Installation erneut starten' })).toBeInTheDocument();
  });

  it('names the Java phase in the progress display', async () => {
    setup(installing());
    render(<App />);
    await screen.findByRole('log', { name: 'Installationsprotokoll' });
    act(() => {
      eventsSocket().open();
      eventsSocket().receive({ type: 'install.progress', serverId: 'srv-1', phase: 'java', percent: 30, message: 'Java 21 wird heruntergeladen (15 von 49 MB)' });
    });
    expect(await screen.findByText('Java wird installiert (30 %)')).toBeInTheDocument();
    expect(screen.getByText('Java 21 wird heruntergeladen (15 von 49 MB)')).toBeInTheDocument();
  });

  it('reports a log that cannot be read without breaking the panel', async () => {
    setup(installing(), { 'GET /api/servers/srv-1/install-log': () => ({ status: 409, body: { error: { code: 'INSTALL_LOG_UNSAFE', message: 'Die Protokolldatei ist keine normale Datei und wird nicht gelesen.' } } }) });
    render(<App />);
    expect(await screen.findByText('Die Protokolldatei ist keine normale Datei und wird nicht gelesen.')).toBeInTheDocument();
    expect(within(await screen.findByRole('log', { name: 'Installationsprotokoll' })).queryByText(/Protokoll wird geladen/)).not.toBeInTheDocument();
  });
});
