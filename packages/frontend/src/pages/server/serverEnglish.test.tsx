import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { appendLines, emptyConsole } from '../../console/model';
import { ConsoleSession } from '../../console/session';
import { setCurrentLang } from '../../i18n/current';
import { LANG_STORAGE_KEY } from '../../i18n';
import { FakeSocket, line, lines } from '../../test/fakes';
import { baseRoutes, mockApi, offline, serverFixture } from '../../test/mockApi';
import { categoryLabel } from './StoreTab';

// The server page in English: the tests elsewhere pin German, these select English the way a user does (stored choice).
beforeEach(() => {
  FakeSocket.reset();
  vi.stubGlobal('WebSocket', FakeSocket);
  window.localStorage.setItem(LANG_STORAGE_KEY, 'en');
});
afterEach(() => vi.unstubAllGlobals());

const mod = {
  id: 'a',
  serverId: 'srv-1',
  source: 'modrinth',
  projectId: 'p-a',
  versionId: 'v1',
  versionNumber: '1.0',
  name: 'Alpha',
  fileName: 'a.jar',
  sha512: 'h-a',
  sizeBytes: 2048,
  isDependency: false,
  enabled: true,
  installedAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
};

function setup(path: string): void {
  window.history.replaceState(null, '', path);
  mockApi({
    ...baseRoutes(serverFixture({ status: offline })),
    'GET /api/servers/srv-1/backups': () => ({ body: { backups: [], schedule: { intervalHours: null, keepLast: 7, includeConfig: false }, totalBytes: 0, freeBytes: 1024 ** 3, running: false } }),
    'GET /api/servers/srv-1/properties': () => ({ body: { exists: true, properties: { 'server-port': 25565, gamemode: 'survival', difficulty: 'easy', 'white-list': false, 'max-players': 20, 'view-distance': 10, 'online-mode': true, motd: 'x' }, extra: {} } }),
    'GET /api/servers/srv-1/mods/backups': () => ({ body: { backups: [], totalBytes: 0, keep: 3 } }),
    'GET /api/servers/srv-1/mods': () => ({ body: { mods: [mod] } }),
    'GET /api/servers/srv-1/mods/search': () => ({ body: { hits: [], totalHits: 0, offset: 0, limit: 20 } }),
    'GET /api/modrinth': () => ({ body: { categories: [] } }),
  });
}

describe('server page in English', () => {
  it('shows the header, tabs and console in English', async () => {
    setup('/servers/srv-1');
    render(<App />);
    expect(await screen.findByRole('navigation', { name: 'Server sections' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Console' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Configuration' })).toBeInTheDocument();
    expect(screen.getByText('No players')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Filter console' })).toBeInTheDocument();
    expect(screen.getByText('Use the arrow keys (up/down) to recall earlier commands.')).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe('Survival · LanQuarry'));
  });

  it('shows the configuration tab in English', async () => {
    setup('/servers/srv-1/config');
    render(<App />);
    expect(await screen.findByText('Server properties')).toBeInTheDocument();
    expect(screen.getByLabelText('Maximum players')).toBeInTheDocument();
    expect(screen.getByText('Delete server')).toBeInTheDocument();
    expect(await screen.findByText('Java runtimes')).toBeInTheDocument();
  });

  it('shows the mods tab in English', async () => {
    setup('/servers/srv-1/mods');
    render(<App />);
    expect(await screen.findByText('Alpha')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeInTheDocument();
    expect(screen.getByText('Directly chosen Mods')).toBeInTheDocument();
    expect(screen.getByText(/Version 1.0/)).toBeInTheDocument();
  });

  it('shows the store tab in English', async () => {
    setup('/servers/srv-1/store');
    render(<App />);
    expect(await screen.findByText('Only matching Mods are shown')).toBeInTheDocument();
    expect(screen.getByLabelText('Search Mods')).toBeInTheDocument();
    expect(screen.getByLabelText('Sort by')).toBeInTheDocument();
    // categoryLabel reads the active language of the module-level state: make it explicit instead of relying on the render
    setCurrentLang('en');
    expect(categoryLabel('worldgen')).toBe('World generation');
  });

  it('shows the backups tab in English', async () => {
    setup('/servers/srv-1/backups');
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText('World backups')).toBeInTheDocument();
    expect(await screen.findByText('No backups yet')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Export world' }));
    expect(await screen.findByRole('button', { name: 'Create export' })).toBeInTheDocument();
  });

  it('words the gap marker and console errors in English', async () => {
    setCurrentLang('en');
    const model = appendLines(appendLines(emptyConsole(), lines(1, 2)), [line(6)]);
    expect(model.rows[2]?.text).toBe('3 lines are missing (buffer exceeded).');

    vi.useFakeTimers();
    try {
      const session = new ConsoleSession({ serverId: 'srv-1', factory: (url) => new FakeSocket(url), onChange: () => undefined, commandTimeoutMs: 100 });
      session.start();
      const assertion = expect(session.send('list')).rejects.toThrow('No connection to the console. The command was not sent.');
      await vi.advanceTimersByTimeAsync(200);
      await assertion;
      session.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
