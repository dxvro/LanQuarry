import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { FakeSocket } from '../test/fakes';
import { baseRoutes, mockApi, serverFixture, offline, type MockApi } from '../test/mockApi';
import type { SystemUpdateState } from '../lib/types';
import { LANG_STORAGE_KEY } from './index';

// The pages converted to the dictionary, rendered in English: the rest of the suite pins German.
beforeEach(() => {
  FakeSocket.reset();
  vi.stubGlobal('WebSocket', FakeSocket);
  window.localStorage.setItem(LANG_STORAGE_KEY, 'en');
});
afterEach(() => vi.unstubAllGlobals());

const updateState = (overrides: Partial<SystemUpdateState> = {}): SystemUpdateState => ({
  currentVersion: '0.1.0',
  installMode: 'service',
  installModeNote: null,
  installModeNoteRef: null,
  lastCheckErrorRef: null,
  canApplyReasonRef: null,
  errorRef: null,
  checksEnabled: true,
  autoCheck: true,
  channel: 'stable',
  repo: 'dxvro/LanQuarry',
  countdownSeconds: 60,
  checking: false,
  lastCheckAt: Date.parse('2026-11-05T10:00:00Z'),
  lastCheckError: null,
  latest: { version: '0.2.0', name: 'LanQuarry 0.2.0', notes: '## New\n- **Update function**', publishedAt: '2026-11-05T09:00:00Z', htmlUrl: 'https://github.com/dxvro/LanQuarry/releases/tag/v0.2.0', prerelease: false, assetSizeBytes: 90 * 1024 * 1024 },
  updateAvailable: true,
  canApply: true,
  canApplyReason: null,
  phase: 'idle',
  progress: null,
  error: null,
  job: null,
  history: [],
  ...overrides,
});

describe('overview in English', () => {
  it('shows the headings, the host panel and the server row in English', async () => {
    window.history.replaceState(null, '', '/');
    mockApi({ ...baseRoutes(serverFixture({ status: offline })) });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByText('Addresses on the network')).toBeInTheDocument();
    expect(await screen.findByText('No LAN address found.')).toBeInTheDocument();
    expect(screen.getByText('Minecraft 1.21.1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New server' })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe('Overview · LanQuarry'));
  });

  it('invites to the first server in English when there is none', async () => {
    window.history.replaceState(null, '', '/');
    mockApi({ ...baseRoutes(serverFixture()), 'GET /api/servers': () => ({ body: { servers: [] } }) });
    render(<App />);
    expect(await screen.findByText('No server created yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create the first server' })).toBeInTheDocument();
  });
});

describe('system page in English', () => {
  it('shows the version, the update settings and the history in English', async () => {
    window.history.replaceState(null, '', '/system');
    mockApi({
      ...baseRoutes(serverFixture({ status: offline })),
      'GET /api/system/update': () => ({ body: updateState({ history: [] }) }),
    });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'System' })).toBeInTheDocument();
    expect(await screen.findByText('Installation type')).toBeInTheDocument();
    expect(screen.getByText('Service (update service available)')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Check for updates automatically' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Check now' })).toBeEnabled();
    expect(screen.getByRole('heading', { name: 'Release notes' })).toBeInTheDocument();
    expect(screen.getByText('No update has been performed yet.')).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe('System · LanQuarry'));
  });
});

describe('create wizard in English', () => {
  let api: MockApi;

  beforeEach(() => {
    window.history.replaceState(null, '', '/new');
    api = mockApi({
      ...baseRoutes(serverFixture({ status: offline })),
      'GET /api/servers': () => ({ body: { servers: [] } }),
      'GET /api/loaders': () => ({
        body: {
          loaders: [
            { id: 'vanilla', name: 'Vanilla', supportsMods: false, requiresInstallerJava: false },
            { id: 'fabric', name: 'Fabric', supportsMods: true, requiresInstallerJava: false },
          ],
        },
      }),
    });
  });

  it('shows the steps, the loader choice and the validation in English', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'New server' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'From an existing world' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Steps' })).toBeInTheDocument();
    expect(await screen.findByLabelText('Server name')).toBeInTheDocument();
    expect(screen.getByText('The unmodified server from Mojang. Without mods or plugins.')).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe('New server · LanQuarry'));

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Please enter a name.')).toBeInTheDocument();
    expect(screen.getByText('Please choose a loader.')).toBeInTheDocument();
    expect(screen.getByText('Please correct the marked fields.')).toBeInTheDocument();
    await waitFor(() => expect(api.callsTo('GET /api/loaders')).not.toHaveLength(0));
  });
});
