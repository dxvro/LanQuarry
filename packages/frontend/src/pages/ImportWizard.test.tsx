import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { FakeSocket } from '../test/fakes';
import { FakeXhr } from '../test/fakeXhr';
import { baseRoutes, mockApi, serverFixture, systemFixture, type MockApi } from '../test/mockApi';

const analysis = {
  archive: { format: 'zip', sizeBytes: 5 * 1024 * 1024, entries: 40, uncompressedBytes: 9 * 1024 * 1024 },
  source: 'server',
  world: { folderName: 'world', levelName: 'Insel', layout: 'split', hasNether: true, hasEnd: true, otherWorlds: [], gameType: 1, hardcore: false, lastPlayed: 1_700_000_000_000, singleplayerPlayer: false },
  version: { mcVersion: '1.20.4', approximate: false, dataVersion: 3700, preOneNine: false },
  proposal: { loader: 'fabric', loaderVersion: '0.16.0', mcVersion: '1.21.1', evidence: ['2 Datei(en) im Archiv gehören zu Fabric.'] },
  modded: true,
  config: { properties: true, items: ['server.properties', 'ops.json'] },
  mods: [
    { key: 'jar:mods/sodium.jar', modId: 'sodium', name: 'Sodium', version: '0.6.0', fileName: 'sodium.jar', enabled: true, sha1: null, sha512: null, sizeBytes: 10, loaders: ['fabric'], side: 'both', origin: 'jar', projectId: null, versionId: null, dir: 'mods' },
    { key: 'fml:create', modId: 'create', name: 'create', version: '6.0', fileName: null, enabled: true, sha1: null, sha512: null, sizeBytes: 0, loaders: [], side: 'unknown', origin: 'level.dat', projectId: null, versionId: null, dir: 'mods' },
  ],
  hasJars: true,
  manifest: null,
  notices: [],
};

const stagedJob = { id: 'imp-1', mode: 'new', serverId: null, status: 'staged', phase: null, message: null, error: null, analysis, result: null, createdAt: 1, expiresAt: 2 };

const review = {
  notices: [{ code: 'WORLD_UPGRADE', level: 'warn', needsConfirm: true, text: 'Die Welt stammt aus Minecraft 1.20.4 und wird beim ersten Start auf 1.21.1 umgestellt.' }],
  matches: [
    { key: 'jar:mods/sodium.jar', state: 'jar-known', projectId: 'sodium', projectTitle: 'Sodium', versionId: 'v1', versionNumber: '0.6.0', candidates: [], selected: true },
    { key: 'fml:create', state: 'not-found', projectId: null, projectTitle: null, versionId: null, versionNumber: null, candidates: [], selected: false },
  ],
  modrinthAvailable: true,
};

let api: MockApi;
let created = false;

function setup(): void {
  created = false;
  FakeXhr.install({ status: 202, body: { import: { ...stagedJob, status: 'analyzing', analysis: null } } });
  api = mockApi({
    ...baseRoutes(serverFixture(), systemFixture()),
    'GET /api/loaders/fabric/mc-versions': () => ({ body: { mcVersions: [{ id: '1.21.1', type: 'release' }, { id: '1.20.4', type: 'release' }] } }),
    'GET /api/loaders/fabric/versions': () => ({ body: { versions: [{ version: '0.16.0', stable: true, recommended: true }] } }),
    'GET /api/loaders': () => ({
      body: {
        loaders: [
          { id: 'vanilla', name: 'Vanilla', supportsMods: false, requiresInstallerJava: false },
          { id: 'fabric', name: 'Fabric', supportsMods: true, requiresInstallerJava: false },
        ],
      },
    }),
    'GET /api/imports/limits': () => ({ body: { maxUploadBytes: 4096 * 1024 * 1024 } }),
    'GET /api/imports/imp-1': () => ({ body: { import: created ? { ...stagedJob, status: 'done', analysis: null, result: { serverId: 'new-1', folders: ['world'], jarsPlaced: ['sodium.jar'], modsInstalled: [], modsFailed: [{ name: 'create', reason: 'nicht gefunden' }], safetyBackupId: null, warnings: [] } } : stagedJob } }),
    'POST /api/imports/imp-1/review': () => ({ body: review }),
    'POST /api/imports/imp-1/create-server': () => {
      created = true;
      return { status: 202, body: { server: serverFixture({ id: 'new-1', name: 'Insel', installState: 'installing' }), import: { ...stagedJob, status: 'applying' } } };
    },
    'GET /api/servers/new-1/install-log': () => ({ body: { lines: [], totalLines: 0, truncated: false } }),
    'DELETE /api/imports/imp-1': () => ({ body: { deleted: true } }),
  });
}

beforeEach(() => {
  FakeSocket.reset();
  vi.stubGlobal('WebSocket', FakeSocket);
  window.history.replaceState(null, '', '/new/world');
  setup();
});
afterEach(() => vi.unstubAllGlobals());

describe('import wizard', () => {
  it('is reachable from the create wizard', async () => {
    window.history.replaceState(null, '', '/new');
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('link', { name: 'Aus vorhandener Welt' }));
    expect(await screen.findByRole('heading', { name: 'Server aus vorhandener Welt' })).toBeInTheDocument();
  });

  it('uploads, shows the analysis, needs the warning acknowledged, then creates the server with the chosen mods', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    expect(await screen.findByRole('heading', { name: 'Server aus vorhandener Welt' })).toBeInTheDocument();
    expect(await screen.findByText(/höchstens 4 GB/)).toBeInTheDocument();

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File([new Uint8Array(2048)], 'meine-welt.zip', { type: 'application/zip' }));

    // preview of what the archive contains
    const facts = await screen.findByTestId('analysis-facts');
    expect(facts).toHaveTextContent('Server-Ordner');
    expect(facts).toHaveTextContent('Insel');
    expect(facts).toHaveTextContent('Kreativ');
    expect(facts).toHaveTextContent('1.20.4');
    expect(facts).toHaveTextContent('getrennte Ordner');
    expect(FakeXhr.sent).toEqual([expect.objectContaining({ method: 'POST', url: '/api/imports', headers: expect.objectContaining({ 'Content-Type': 'application/octet-stream' }) })]);

    // proposal filled in
    await waitFor(() => expect(screen.getByLabelText('Minecraft-Version')).toHaveValue('1.21.1'));
    expect(screen.getByLabelText('Loader')).toHaveValue('fabric');
    expect(screen.getByLabelText('Name des Servers')).toHaveValue('Insel');

    // mods: found, missing and the warnings
    const rows = await screen.findAllByTestId('mod-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText('Datei aus dem Archiv, auf Modrinth erkannt')).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText('Nicht gefunden')).toBeInTheDocument();
    expect(await screen.findByText(/wird beim ersten Start auf 1.21.1 umgestellt/)).toBeInTheDocument();
    expect(screen.getByText(/Diese Mods der Welt werden nicht bereitgestellt: create/)).toBeInTheDocument();

    const submit = screen.getByRole('button', { name: 'Server anlegen' });
    expect(submit).toBeDisabled();
    const acks = screen.getAllByRole('checkbox', { name: 'Verstanden, trotzdem fortfahren' });
    expect(acks).toHaveLength(2);
    for (const box of acks) await user.click(box);
    await waitFor(() => expect(submit).toBeEnabled());

    await user.click(screen.getByRole('checkbox', { name: /Minecraft-EULA/ }));
    await user.click(submit);

    await waitFor(() => expect(api.callsTo('POST /api/imports/imp-1/create-server')).toHaveLength(1));
    const body = api.callsTo('POST /api/imports/imp-1/create-server')[0]?.body as Record<string, unknown>;
    expect(body).toMatchObject({
      server: { name: 'Insel', loader: 'fabric', mcVersion: '1.21.1', loaderVersion: '0.16.0', eulaAccepted: true },
      importConfig: true,
      selection: { jars: ['jar:mods/sodium.jar'], install: [] },
      acknowledged: expect.arrayContaining(['WORLD_UPGRADE', 'MODS_MISSING']),
    });

    // progress and result
    expect(await screen.findByRole('heading', { name: '„Insel“ ist angelegt' })).toBeInTheDocument();
    expect(screen.getByText(/Ordner: world/)).toBeInTheDocument();
    expect(screen.getByText(/create: nicht gefunden/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Server öffnen' })).toBeInTheDocument();
  });

  it('shows a readable error when the archive is refused', async () => {
    FakeXhr.install({ status: 413, body: { error: { code: 'IMPORT_TOO_LARGE', message: 'Die Datei ist zu groß (höchstens 1 MB).' } } });
    const user = userEvent.setup();
    const { container } = render(<App />);
    await screen.findByRole('heading', { name: 'Server aus vorhandener Welt' });
    await user.upload(container.querySelector('input[type="file"]') as HTMLInputElement, new File(['x'], 'gross.zip'));
    expect(await screen.findByText('Die Datei ist zu groß (höchstens 1 MB).')).toBeInTheDocument();
    expect(screen.getByText('Das Archiv wurde nicht angenommen')).toBeInTheDocument();
  });

  it('blocks the import when the world is newer than the chosen version', async () => {
    api.set('POST /api/imports/imp-1/review', () => ({
      body: { ...review, notices: [{ code: 'WORLD_NEWER', level: 'error', needsConfirm: false, text: 'Die Welt ist neuer als die gewählte Version.' }] },
    }));
    const user = userEvent.setup();
    const { container } = render(<App />);
    await screen.findByRole('heading', { name: 'Server aus vorhandener Welt' });
    await user.upload(container.querySelector('input[type="file"]') as HTMLInputElement, new File(['x'], 'w.zip'));
    expect(await screen.findByText('Die Welt ist neuer als die gewählte Version.')).toBeInTheDocument();
    for (const box of screen.queryAllByRole('checkbox', { name: 'Verstanden, trotzdem fortfahren' })) await user.click(box);
    await user.click(screen.getByRole('checkbox', { name: /Minecraft-EULA/ }));
    expect(screen.getByRole('button', { name: 'Server anlegen' })).toBeDisabled();
  });
});
