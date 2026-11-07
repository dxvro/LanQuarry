import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { DISCLAIMER } from '../components/Disclaimer';
import { passwordStrength } from '../lib/password';
import { FakeSocket } from '../test/fakes';
import { baseRoutes, mockApi, networkFixture, serverFixture, type MockApi } from '../test/mockApi';

let api: MockApi;

function setup(options: { auth?: { authRequired: boolean; credential: string; authenticated?: boolean }; network?: Record<string, unknown> } = {}): void {
  const auth = options.auth ?? { authRequired: true, credential: 'token' };
  api = mockApi({
    ...baseRoutes(serverFixture()),
    'GET /api/auth/status': () => ({ body: { authRequired: auth.authRequired, authenticated: auth.authenticated ?? true, credential: auth.credential } }),
    'GET /api/system/network': () => ({ body: networkFixture(options.network) }),
    'POST /api/auth/password': () => ({ body: { authRequired: true, authenticated: true, credential: 'password' } }),
  });
}

beforeEach(() => {
  FakeSocket.reset();
  vi.stubGlobal('WebSocket', FakeSocket);
  window.history.replaceState(null, '', '/system');
});
afterEach(() => vi.unstubAllGlobals());

describe('disclaimer', () => {
  it('is on the login page', async () => {
    setup({ auth: { authRequired: true, credential: 'token', authenticated: false } });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Anmeldung erforderlich' })).toBeInTheDocument();
    expect(screen.getByText(DISCLAIMER)).toBeInTheDocument();
  });

  it('is on the pages of the app (sidebar on desktop, footer on phones)', async () => {
    setup();
    window.history.replaceState(null, '', '/');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Übersicht' })).toBeInTheDocument();
    expect(screen.getAllByText(DISCLAIMER).length).toBeGreaterThanOrEqual(1);
    expect(DISCLAIMER).toBe('Kein offizielles Minecraft-Produkt. Nicht von Mojang oder Microsoft genehmigt oder mit ihnen verbunden.');
  });

  it('asks for the password once one was set', async () => {
    setup({ auth: { authRequired: true, credential: 'password', authenticated: false } });
    render(<App />);
    expect(await screen.findByLabelText('Passwort')).toBeInTheDocument();
    expect(screen.getByText(/craftmanager reset-password/)).toBeInTheDocument();
  });
});

describe('password strength hint', () => {
  it('grades length and variety', () => {
    expect(passwordStrength('kurz')).toMatchObject({ level: 0, label: 'Zu kurz' });
    expect(passwordStrength('aaaaaaaaaaaa').level).toBe(1);
    expect(passwordStrength('abcdefghijkl').level).toBe(1);
    expect(passwordStrength('Abcdefg123').level).toBe(2);
    expect(passwordStrength('Correct-Horse-Battery9')).toMatchObject({ level: 3, label: 'Stark' });
  });
});

describe('password section', () => {
  it('changes the password with the current one and keeps the session', async () => {
    setup();
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Passwort' })).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Passwort ändern' });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText('Aktuelles Passwort'), 'altes-token-1');
    await user.type(screen.getByLabelText('Neues Passwort'), 'kurz');
    expect(screen.getByText('Mindestens 10 Zeichen.')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Neues Passwort'));
    await user.type(screen.getByLabelText('Neues Passwort'), 'Correct-Horse-Battery9');
    expect(screen.getByText(/Stark\./)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Neues Passwort wiederholen'), 'Correct-Horse-Battery');
    expect(screen.getByText('Die beiden Eingaben stimmen nicht überein.')).toBeInTheDocument();
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText('Neues Passwort wiederholen'), '9');
    expect(submit).toBeEnabled();
    await user.click(submit);
    await waitFor(() => expect(api.callsTo('POST /api/auth/password')).toHaveLength(1));
    expect(api.callsTo('POST /api/auth/password')[0]?.body).toEqual({ currentPassword: 'altes-token-1', newPassword: 'Correct-Horse-Battery9' });
    expect(await screen.findByText('Das Passwort wurde geändert')).toBeInTheDocument();
    expect(screen.getByLabelText('Neues Passwort')).toHaveValue('');
  });

  it('shows the German reason for a wrong current password', async () => {
    setup();
    api.set('POST /api/auth/password', () => ({ status: 403, body: { error: { code: 'CURRENT_PASSWORD_WRONG', message: 'Das aktuelle Passwort ist falsch.' } } }));
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText('Aktuelles Passwort'), 'falsch-falsch');
    await user.type(screen.getByLabelText('Neues Passwort'), 'Correct-Horse-Battery9');
    await user.type(screen.getByLabelText('Neues Passwort wiederholen'), 'Correct-Horse-Battery9');
    await user.click(screen.getByRole('button', { name: 'Passwort ändern' }));
    expect(await screen.findByText('Das aktuelle Passwort ist falsch.')).toBeInTheDocument();
    expect(screen.queryByText('Das Passwort wurde geändert')).not.toBeInTheDocument();
  });

  it('warns about open access and sets a first password without a current one', async () => {
    setup({ auth: { authRequired: false, credential: 'none' } });
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText('Es ist kein Passwort gesetzt')).toBeInTheDocument();
    expect(screen.queryByLabelText('Aktuelles Passwort')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Neues Passwort'), 'Correct-Horse-Battery9');
    await user.type(screen.getByLabelText('Neues Passwort wiederholen'), 'Correct-Horse-Battery9');
    await user.click(screen.getByRole('button', { name: 'Passwort festlegen' }));
    await waitFor(() => expect(api.callsTo('POST /api/auth/password')[0]?.body).toEqual({ newPassword: 'Correct-Horse-Battery9' }));
  });
});

describe('network section', () => {
  it('lists the addresses, tucks virtual adapters away and explains the router tip', async () => {
    setup();
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Netzwerk & Zugriff' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'http://192.168.178.20:3000' })).toHaveAttribute('href', 'http://192.168.178.20:3000');
    expect(screen.getByRole('link', { name: 'http://MCPC:3000' })).toBeInTheDocument();
    const virtual = screen.getByText(/VPN \/ virtuelle Adapter \(1\)/);
    expect(virtual.closest('details')).not.toBeNull();
    expect(within(virtual.closest('details') as HTMLElement).getByText('http://172.28.16.1:3000')).toBeInTheDocument();
    expect(screen.getByText(/immer die gleiche IPv4-Adresse zuweisen/)).toBeInTheDocument();
  });

  it('offers the local addresses and saves; values equal to the config file defaults are sent as "not set"', async () => {
    setup();
    api.set('PUT /api/system/network', (call) => {
      const body = call.body as Record<string, unknown>;
      return {
        body: networkFixture({
          settings: { bindHost: body['bindHost'], port: body['port'], allowedHosts: body['allowedHosts'], publicAddress: body['publicAddress'] },
          restartRequired: true,
          pending: { host: '192.168.178.20', port: 3100, allowedHosts: ['minecraft.fritz.box'], urls: ['http://192.168.178.20:3100'] },
        }),
      };
    });
    const user = userEvent.setup();
    render(<App />);
    const select = await screen.findByLabelText('Lauschen auf');
    expect(within(select).getByRole('option', { name: '192.168.178.20 (Ethernet)' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'Nur dieser Rechner (127.0.0.1)' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: /172\.28\.16\.1.*VPN\/virtuell/ })).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Speichern' });
    expect(save).toBeDisabled();
    await user.selectOptions(select, '192.168.178.20');
    await user.clear(screen.getByLabelText('Web-Port'));
    await user.type(screen.getByLabelText('Web-Port'), '3100');
    await user.type(screen.getByLabelText('Weitere erlaubte Rechnernamen'), 'minecraft.fritz.box');
    await user.click(save);
    await waitFor(() => expect(api.callsTo('PUT /api/system/network')).toHaveLength(1));
    expect(api.callsTo('PUT /api/system/network')[0]?.body).toEqual({ bindHost: '192.168.178.20', port: 3100, allowedHosts: ['minecraft.fritz.box'], publicAddress: null });
    expect(await screen.findByText(/Gespeichert\. Ein Neustart übernimmt/)).toBeInTheDocument();
    expect(screen.getByText(/muss den neuen Port 3100 erlauben/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Jetzt neu starten' })).toBeInTheDocument();
  });

  it('shows server-side validation errors', async () => {
    setup();
    api.set('PUT /api/system/network', () => ({ status: 422, body: { error: { code: 'NETWORK_PORT_IN_USE', message: 'Der Port 3555 ist auf diesem Rechner bereits belegt. Bitte einen freien Port wählen.' } } }));
    const user = userEvent.setup();
    render(<App />);
    await user.clear(await screen.findByLabelText('Web-Port'));
    await user.type(screen.getByLabelText('Web-Port'), '3555');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByText(/bereits belegt/)).toBeInTheDocument();
  });

  it('shows the fallback warning from the start', async () => {
    setup({ network: { warnings: ['Die Adresse 10.9.9.9 ist auf diesem Rechner nicht vorhanden.'] } });
    render(<App />);
    expect(await screen.findByText(/10\.9\.9\.9 ist auf diesem Rechner nicht vorhanden/)).toBeInTheDocument();
  });

  it('restarts only after the confirmation, which names the stopped servers and the new address', async () => {
    setup({ network: { restartRequired: true, pending: { host: '0.0.0.0', port: 3100, allowedHosts: [], urls: ['http://192.168.178.20:3100'] } } });
    api.set('POST /api/system/restart', () => ({ status: 202, body: { restarting: true, urls: ['http://192.168.178.20:3100'], automatic: true, note: 'Der Dienst startet neu.' } }));
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Jetzt neu starten' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Alle laufenden Minecraft-Server werden gestoppt/)).toBeInTheDocument();
    expect(within(dialog).getByText('http://192.168.178.20:3100')).toBeInTheDocument();
    expect(api.callsTo('POST /api/system/restart')).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Jetzt neu starten' }));
    await waitFor(() => expect(api.callsTo('POST /api/system/restart')).toHaveLength(1));
    expect(api.callsTo('POST /api/system/restart')[0]?.body).toEqual({ confirm: true });
    expect(await screen.findByText('LanQuarry startet neu …')).toBeInTheDocument();
  });

  it('tells a manual installation to start the program again by hand', async () => {
    const note = 'Diese Installation läuft ohne Dienst: LanQuarry beendet sich und muss danach von Hand wieder gestartet werden.';
    setup({ network: { restartRequired: true, restart: { automatic: false, note } } });
    api.set('POST /api/system/restart', () => ({ status: 202, body: { restarting: true, urls: ['http://192.168.178.20:3000'], automatic: false, note } }));
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Jetzt neu starten' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Jetzt neu starten' }));
    expect(await screen.findByText('Bitte LanQuarry jetzt von Hand wieder starten')).toBeInTheDocument();
  });
});
