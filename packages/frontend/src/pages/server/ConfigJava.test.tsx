import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { FakeSocket } from '../../test/fakes';
import { baseRoutes, mockApi, serverFixture, systemFixture, type MockApi } from '../../test/mockApi';

const managedRuntime = {
  path: 'C:/data/runtimes/temurin-21/bin/java.exe',
  major: 21,
  version: '21.0.13',
  name: 'Eclipse Temurin 21.0.13+9-LTS (JRE)',
  source: 'managed',
  origin: 'Von LanQuarry am 5.11.2026 automatisch installiert: Eclipse Temurin 21.0.13+9-LTS (JRE), geladen über api.adoptium.net, SHA-256 675c6158fd374747 geprüft.',
};
const systemJava = { path: 'C:/Program Files/Java/jdk-17/bin/java.exe', major: 17, version: '17.0.9', name: 'JDK', source: 'standard', origin: null };
const managedInfo = (inUseBy: string[] = []): Record<string, unknown> => ({
  major: 21,
  version: '21.0.13+9-LTS',
  release: 'jdk-21.0.13+9',
  image: 'jre',
  sha256: 'a'.repeat(64),
  installedAt: Date.UTC(2026, 10, 5),
  sizeBytes: 150 * 1024 * 1024,
  javaPath: managedRuntime.path,
  origin: managedRuntime.origin,
  inUseBy,
});

let api: MockApi;

function setup(system: Record<string, unknown>, server: Record<string, unknown> = serverFixture()): void {
  api = mockApi({
    ...baseRoutes(server, system),
    'GET /api/servers/srv-1/properties': () => ({ body: { exists: false, properties: { 'server-port': 25565, gamemode: 'survival', difficulty: 'easy', 'white-list': false, 'max-players': 20, 'view-distance': 10, 'online-mode': true, motd: 'x' }, extra: {} } }),
    'GET /api/servers/srv-1/backups': () => ({ body: { backups: [], schedule: { intervalHours: null, keepLast: 7, includeConfig: false }, totalBytes: 0, freeBytes: null, running: false } }),
  });
}

beforeEach(() => {
  FakeSocket.reset();
  vi.stubGlobal('WebSocket', FakeSocket);
  window.history.replaceState(null, '', '/servers/srv-1/config');
});
afterEach(() => vi.unstubAllGlobals());

const runtimesSection = async (): Promise<HTMLElement> => {
  const heading = await screen.findByRole('heading', { name: 'Java-Laufzeiten' });
  return heading.closest('section') as HTMLElement;
};

describe('runtime list', () => {
  it('shows the origin of managed runtimes next to the others', async () => {
    setup(systemFixture({ javaRuntimes: [managedRuntime, systemJava], managedJava: [managedInfo()] }));
    render(<App />);
    const section = await runtimesSection();
    const items = within(section).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Java 21');
    expect(items[0]).toHaveTextContent('Von LanQuarry installiert');
    expect(items[0]).toHaveTextContent('JRE');
    expect(items[0]).toHaveTextContent('150 MB');
    expect(items[0]).toHaveTextContent('geladen über api.adoptium.net');
    expect(items[0]).toHaveTextContent('C:/data/runtimes/temurin-21/bin/java.exe');
    expect(items[1]).toHaveTextContent('Standard-Installationsordner');
    expect(within(items[1] as HTMLElement).queryByRole('button', { name: 'Entfernen' })).not.toBeInTheDocument();
    expect(within(section).getByText(/Fehlt für einen Server die passende Java-Version, installiert LanQuarry sie/)).toBeInTheDocument();
  });

  it('removes a managed runtime after confirmation', async () => {
    setup(systemFixture({ javaRuntimes: [managedRuntime], managedJava: [managedInfo()] }));
    api.set('DELETE /api/java/runtimes/21', () => ({ body: { removed: true } }));
    const user = userEvent.setup();
    render(<App />);
    const section = await runtimesSection();
    await user.click(within(section).getByRole('button', { name: 'Entfernen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Java 21 entfernen?' });
    expect(api.callsTo('DELETE /api/java/runtimes/21')).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Entfernen' }));
    await waitFor(() => expect(api.callsTo('DELETE /api/java/runtimes/21')).toHaveLength(1));
    expect(await screen.findByText('Java 21 wurde entfernt.')).toBeInTheDocument();
  });

  it('keeps the remove button disabled while a server uses the runtime and says which', async () => {
    setup(systemFixture({ javaRuntimes: [managedRuntime], managedJava: [managedInfo(['srv-1'])] }));
    render(<App />);
    const section = await runtimesSection();
    expect(within(section).getByRole('button', { name: 'Entfernen' })).toBeDisabled();
    expect(within(section).getByText(/Wird gerade verwendet von: Survival/)).toBeInTheDocument();
  });

  it('installs a runtime by hand and offers the one this server needs first', async () => {
    setup(systemFixture({ javaRuntimes: [] }));
    api.set('POST /api/java/runtimes/21/install', () => ({ body: { runtime: managedRuntime, alreadyInstalled: false } }));
    const user = userEvent.setup();
    render(<App />);
    const section = await runtimesSection();
    expect(within(section).getByText('Beim ersten Start wird die benötigte Version automatisch installiert.')).toBeInTheDocument();
    const buttons = within(section).getAllByRole('button', { name: /^Java \d+ installieren$/ });
    expect(buttons.map((button) => button.textContent)).toEqual(['Java 8 installieren', 'Java 17 installieren', 'Java 21 installieren', 'Java 25 installieren']);
    await user.click(within(section).getByRole('button', { name: 'Java 21 installieren' }));
    await waitFor(() => expect(api.callsTo('POST /api/java/runtimes/21/install')).toHaveLength(1));
    expect(await screen.findByText('Java 21 wurde installiert.')).toBeInTheDocument();
  });

  it('keeps the success message while the runtime list is read again and then shows the new runtime', async () => {
    let installed = false;
    setup(systemFixture({ javaRuntimes: [] }));
    api.set('GET /api/system', () => ({ body: installed ? systemFixture({ javaRuntimes: [managedRuntime], managedJava: [managedInfo()] }) : systemFixture({ javaRuntimes: [] }) }));
    api.set('POST /api/java/runtimes/21/install', () => {
      installed = true;
      return { body: { runtime: managedRuntime, alreadyInstalled: false } };
    });
    const user = userEvent.setup();
    render(<App />);
    const section = await runtimesSection();
    await user.click(within(section).getByRole('button', { name: 'Java 21 installieren' }));
    expect(await screen.findByText('Java 21 wurde installiert.')).toBeInTheDocument();
    await waitFor(() => expect(within(section).getAllByRole('listitem')).toHaveLength(1));
    expect(screen.getByText('Java 21 wurde installiert.')).toBeInTheDocument();
    expect(within(section).getByText('Von LanQuarry installiert')).toBeInTheDocument();
  });

  it('shows the German text of the error code when the installation fails', async () => {
    setup(systemFixture({ javaRuntimes: [] }));
    api.set('POST /api/java/runtimes/8/install', () => ({ status: 422, body: { error: { code: 'JAVA_NOT_AVAILABLE', message: 'Eclipse Temurin does not offer Java 8 for Windows (arm64).', details: { major: 8, platform: 'Windows (arm64)' } } } }));
    const user = userEvent.setup();
    render(<App />);
    const section = await runtimesSection();
    await user.click(within(section).getByRole('button', { name: 'Java 8 installieren' }));
    expect(await screen.findByText('Eclipse Temurin bietet für Windows (arm64) kein Java 8 an. Bitte Java 8 manuell installieren und den Pfad im Server eintragen.')).toBeInTheDocument();
  });

  it('shows progress of a running installation from the event stream', async () => {
    setup(systemFixture({ javaRuntimes: [], javaInstalls: [{ major: 25, phase: 'download', percent: 10, message: 'Java 25 wird heruntergeladen (6 von 59 MB)' }] }));
    render(<App />);
    const section = await runtimesSection();
    expect(await within(section).findByText('Java 25 wird heruntergeladen (6 von 59 MB)')).toBeInTheDocument();
    FakeSocket.last.open();
    FakeSocket.last.receive({ type: 'java.install', major: 25, state: 'running', phase: 'extract', percent: 70, message: 'Java 25 wird entpackt ...', error: null });
    expect(await within(section).findByText('Java 25 wird entpackt ...')).toBeInTheDocument();
    expect(within(section).getByRole('progressbar', { name: 'Installation von Java 25' })).toHaveAttribute('aria-valuenow', '70');
    expect(within(section).getByRole('button', { name: 'Java 25 installieren' })).toBeDisabled();
  });

  it('explains a switched-off automatic installation and keeps the manual way visible', async () => {
    setup(systemFixture({ javaRuntimes: [], javaAutoInstall: false }));
    render(<App />);
    const section = await runtimesSection();
    expect(within(section).getByText(/Die automatische Installation ist abgeschaltet \(JAVA_AUTO_INSTALL=false\)/)).toBeInTheDocument();
    expect(within(section).getByText('Keine Java-Installation gefunden')).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: 'Java 21 installieren' })).toBeEnabled();
  });
});

describe('autostart and deleting', () => {
  it('saves the autostart switch', async () => {
    setup(systemFixture());
    api.set('PATCH /api/servers/srv-1', (call) => ({ body: { server: serverFixture(call.body as Record<string, unknown>), restartRequired: false } }));
    const user = userEvent.setup();
    render(<App />);
    const toggle = await screen.findByRole('switch', { name: 'Beim Start der Anwendung automatisch starten' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await user.click(toggle);
    const section = toggle.closest('section') as HTMLElement;
    await user.click(within(section).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(api.callsTo('PATCH /api/servers/srv-1')).toHaveLength(1));
    expect(api.callsTo('PATCH /api/servers/srv-1')[0]?.body).toEqual({ autoStart: true });
  });

  it('makes the user decide about the backups before a server with backups is deleted', async () => {
    setup(systemFixture());
    api.set('GET /api/servers/srv-1/backups', () => ({ body: { backups: [{ id: 'b1' }, { id: 'b2' }], schedule: { intervalHours: null, keepLast: 7, includeConfig: false }, totalBytes: 3 * 1024 * 1024, freeBytes: null, running: false } }));
    api.set('DELETE /api/servers/srv-1', () => ({ body: { deleted: true } }));
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Server löschen …' }));
    const dialog = await screen.findByRole('dialog', { name: 'Server endgültig löschen?' });
    const confirm = within(dialog).getByRole('button', { name: 'Server und Welt löschen' });
    await user.type(within(dialog).getByLabelText(/Zur Bestätigung den Namen/), 'Survival');
    expect(await within(dialog).findByText(/Was soll mit den 2 Backups \(3 MB\) geschehen\?/)).toBeInTheDocument();
    expect(confirm).toBeDisabled();
    await user.click(within(dialog).getByRole('radio', { name: /Behalten/ }));
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    await waitFor(() => expect(api.callsTo('DELETE /api/servers/srv-1')).toHaveLength(1));
    expect(api.callsTo('DELETE /api/servers/srv-1')[0]?.url).toBe('/api/servers/srv-1?confirm=true&backups=keep');
  });

  it('asks nothing about backups when there are none', async () => {
    setup(systemFixture());
    api.set('DELETE /api/servers/srv-1', () => ({ body: { deleted: true } }));
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Server löschen …' }));
    const dialog = await screen.findByRole('dialog', { name: 'Server endgültig löschen?' });
    await user.type(within(dialog).getByLabelText(/Zur Bestätigung den Namen/), 'Survival');
    expect(within(dialog).queryByRole('radio')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Server und Welt löschen' }));
    await waitFor(() => expect(api.callsTo('DELETE /api/servers/srv-1')).toHaveLength(1));
    expect(api.callsTo('DELETE /api/servers/srv-1')[0]?.url).toBe('/api/servers/srv-1?confirm=true');
  });
});
