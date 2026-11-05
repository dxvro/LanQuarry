import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { FakeSocket } from '../test/fakes';

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const created = {
  id: 'srv-1',
  name: 'Survival',
  loader: 'fabric',
  mcVersion: '1.21.1',
  loaderVersion: '0.16.0',
  installState: 'pending',
  installError: null,
  port: 25565,
  minRamMb: 1024,
  maxRamMb: 2048,
  eulaAccepted: false,
  status: { state: 'offline', pid: null, startedAt: null, exitCode: null, message: null, players: [], port: null, cpuPercent: null, rssBytes: null },
};

function installFetch(system: { totalMemoryMb: number; javaRuntimes: unknown[] }): { posts: unknown[] } {
  const posts: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.startsWith('/api/auth/status')) return json(200, { authRequired: false, authenticated: true });
      if (url === '/api/servers' && init?.method === 'POST') {
        posts.push(JSON.parse(String(init.body)));
        return json(201, { server: created });
      }
      if (url.startsWith('/api/servers')) return json(200, { servers: [] });
      if (url.startsWith('/api/health')) return json(200, { status: 'ok', database: 'ok', lanUrls: [] });
      if (url.startsWith('/api/system')) return json(200, { freeMemoryMb: 4000, cpuCount: 4, platform: 'win32', arch: 'x64', ...system });
      if (url === '/api/loaders') {
        return json(200, {
          loaders: [
            { id: 'vanilla', name: 'Vanilla', supportsMods: false, requiresInstallerJava: false },
            { id: 'fabric', name: 'Fabric', supportsMods: true, requiresInstallerJava: false },
          ],
        });
      }
      if (url.includes('/mc-versions')) return json(200, { mcVersions: [{ id: '1.21.1', type: 'release' }, { id: '1.20.4', type: 'release' }] });
      if (url.includes('/versions?')) return json(200, { versions: [{ version: '0.15.0', stable: true, recommended: false }, { version: '0.16.0', stable: true, recommended: true }] });
      return json(404, { error: { code: 'NOT_FOUND', message: 'nicht gefunden' } });
    }),
  );
  return { posts };
}

describe('create wizard', () => {
  beforeEach(() => {
    FakeSocket.reset();
    vi.stubGlobal('WebSocket', FakeSocket);
    window.history.replaceState(null, '', '/new');
  });
  afterEach(() => vi.unstubAllGlobals());

  async function toReview(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await user.type(await screen.findByLabelText('Name des Servers'), 'Survival');
    await user.click(screen.getByRole('radio', { name: /Fabric/ }));
    await user.click(screen.getByRole('button', { name: 'Weiter' }));
    const version = await screen.findByLabelText('Minecraft-Version');
    await waitFor(() => expect(within(version).getAllByRole('option').length).toBeGreaterThan(1));
    await user.selectOptions(version, '1.21.1');
    await waitFor(() => expect(screen.getByLabelText('Fabric-Version')).toHaveValue('0.16.0'));
    await user.click(screen.getByRole('button', { name: 'Weiter' }));
    await screen.findByLabelText('Server-Port');
    await user.click(screen.getByRole('button', { name: 'Weiter' }));
  }

  it('blocks empty steps and explains why', async () => {
    installFetch({ totalMemoryMb: 16384, javaRuntimes: [{ path: 'C:/java', major: 21, version: '21.0.1', name: 'x', source: 'PATH' }] });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Weiter' }));
    expect(await screen.findByText('Bitte einen Namen eingeben.')).toBeInTheDocument();
    expect(screen.getByText('Bitte einen Loader wählen.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Minecraft-Version')).not.toBeInTheDocument();
  });

  it('bounds the RAM sliders by the real total and warns when no Java is installed', async () => {
    installFetch({ totalMemoryMb: 4096, javaRuntimes: [] });
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText('Name des Servers'), 'Survival');
    await user.click(screen.getByRole('radio', { name: /Fabric/ }));
    await user.click(screen.getByRole('button', { name: 'Weiter' }));
    const version = await screen.findByLabelText('Minecraft-Version');
    await waitFor(() => expect(within(version).getAllByRole('option').length).toBeGreaterThan(1));
    await user.selectOptions(version, '1.21.1');
    await waitFor(() => expect(screen.getByLabelText('Fabric-Version')).toHaveValue('0.16.0'));
    await user.click(screen.getByRole('button', { name: 'Weiter' }));

    const max = await screen.findByLabelText(/Maximaler Arbeitsspeicher/);
    expect(max).toHaveAttribute('max', '4096');
    expect(max).toHaveAttribute('min', '256');
    expect(await screen.findByText('Keine Java-Installation gefunden')).toBeInTheDocument();
  });

  it('leaves the EULA unticked, links its text, and creates the server without consent by default', async () => {
    const { posts } = installFetch({ totalMemoryMb: 16384, javaRuntimes: [{ path: 'C:/java', major: 21, version: '21.0.1', name: 'x', source: 'PATH' }] });
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);

    const eula = await screen.findByRole('checkbox', { name: /Minecraft-EULA/ });
    expect(eula).not.toBeChecked();
    const link = screen.getByRole('link', { name: /Minecraft-EULA/ });
    expect(link).toHaveAttribute('href', 'https://aka.ms/MinecraftEULA');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));

    await user.click(screen.getByRole('button', { name: 'Server anlegen' }));
    expect(await screen.findByRole('heading', { name: /wird installiert/ })).toBeInTheDocument();
    expect(posts).toEqual([{ name: 'Survival', loader: 'fabric', mcVersion: '1.21.1', loaderVersion: '0.16.0', port: 25565, minRamMb: 1024, maxRamMb: 2048, eulaAccepted: false }]);
  });

  it('sends the consent only after the box was ticked', async () => {
    const { posts } = installFetch({ totalMemoryMb: 16384, javaRuntimes: [] });
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    await user.click(await screen.findByRole('checkbox', { name: /Minecraft-EULA/ }));
    await user.click(screen.getByRole('button', { name: 'Server anlegen' }));
    await screen.findByRole('heading', { name: /wird installiert/ });
    expect(posts[0]).toMatchObject({ eulaAccepted: true });
  });
});
