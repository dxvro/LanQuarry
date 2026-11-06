import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { LANG_STORAGE_KEY, type Lang } from '../../i18n';
import { FakeSocket } from '../../test/fakes';
import { baseRoutes, mockApi, offline, serverFixture, type MockApi } from '../../test/mockApi';
import { isValidIp, isValidPlayerName, parseBanDate } from './PlayersTab';

type View = Record<string, unknown> & { whitelist: Array<Record<string, unknown>>; ops: Array<Record<string, unknown>>; bannedPlayers: Array<Record<string, unknown>>; bannedIps: Array<Record<string, unknown>> };

const playersView = (overrides: Record<string, unknown> = {}): View =>
  ({
    supported: true,
    mode: 'file',
    busy: false,
    online: [],
    whitelistEnabled: true,
    onlineMode: true,
    opPermissionLevel: 4,
    whitelist: [{ uuid: 'u-steve', name: 'Steve' }],
    ops: [{ uuid: 'u-alex', name: 'Alex', level: 3, bypassesPlayerLimit: true }],
    bannedPlayers: [{ uuid: 'u-grief', name: 'Griefer', created: '2025-03-01 12:00:00 +0100', source: 'Server', expires: 'forever', reason: 'Zerstört Bauten' }],
    bannedIps: [{ ip: '203.0.113.7', created: '2025-03-01 12:00:00 +0100', source: 'Konsole', expires: 'forever', reason: '' }],
    corrupt: [],
    pending: false,
    notice: null,
    ...overrides,
  }) as View;

const onlineStatus = { ...offline, state: 'online', players: ['Steve', 'Notch'] };
const offlineStatus: Record<string, unknown> = offline;

let api: MockApi;
let current: View;
let serverStatus: Record<string, unknown> = offlineStatus;

// the whole app on the players tab; the server's status comes from the (fake) server list, the language from the stored choice
function ui(status: Record<string, unknown> = offlineStatus, lang: Lang = 'de'): ReactNode {
  serverStatus = status;
  window.localStorage.setItem(LANG_STORAGE_KEY, lang);
  window.history.replaceState(null, '', '/servers/srv-1/players');
  return <App />;
}

// every change answers the whole view; the fake backend applies the obvious effect to `current`
function setup(view: View = playersView()): void {
  current = view;
  api = mockApi({
    ...baseRoutes(serverFixture()),
    'GET /api/servers': () => ({ body: { servers: [serverFixture({ status: serverStatus })] } }),
    'GET /api/servers/srv-1/players': () => ({ body: current }),
    'POST /api/servers/srv-1/players/whitelist': ({ body }) => {
      current = { ...current, whitelist: [...current.whitelist, { uuid: `u-${(body as { name: string }).name}`, name: (body as { name: string }).name }] };
      return { body: current };
    },
    'DELETE /api/servers/srv-1/players/whitelist/': ({ url }) => {
      const name = decodeURIComponent(url.split('/').pop() ?? '');
      current = { ...current, whitelist: current.whitelist.filter((entry) => entry['name'] !== name) };
      return { body: current };
    },
    'POST /api/servers/srv-1/players/ops': ({ body }) => {
      const input = body as { name: string; level?: number; bypassesPlayerLimit?: boolean };
      current = { ...current, ops: [...current.ops, { uuid: `u-${input.name}`, name: input.name, level: input.level ?? 4, bypassesPlayerLimit: input.bypassesPlayerLimit ?? false }] };
      return { body: current };
    },
    'DELETE /api/servers/srv-1/players/ops/': () => ({ body: { ...current, ops: [] } }),
    'POST /api/servers/srv-1/players/banned-players': ({ body }) => {
      const input = body as { name: string; reason?: string };
      current = {
        ...current,
        bannedPlayers: [...current.bannedPlayers, { uuid: `u-${input.name}`, name: input.name, created: '2025-03-02 12:00:00 +0100', source: 'CraftManager', expires: 'forever', reason: input.reason ?? '' }],
      };
      return { body: current };
    },
    'DELETE /api/servers/srv-1/players/banned-players/': () => ({ body: { ...current, bannedPlayers: [] } }),
    'POST /api/servers/srv-1/players/banned-ips': ({ body }) => {
      const input = body as { ip: string };
      current = { ...current, bannedIps: [...current.bannedIps, { ip: input.ip, created: '2025-03-02 12:00:00 +0100', source: 'CraftManager', expires: 'forever', reason: '' }] };
      return { body: current };
    },
    'DELETE /api/servers/srv-1/players/banned-ips/': () => ({ body: { ...current, bannedIps: [] } }),
    'POST /api/servers/srv-1/players/whitelist-enabled': ({ body }) => {
      current = { ...current, whitelistEnabled: (body as { enabled: boolean }).enabled };
      return { body: current };
    },
  });
}

const region = (name: string): HTMLElement => screen.getByRole('region', { name });
const error = (code: string, message: string, status = 409): { status: number; body: unknown } => ({ status, body: { error: { code, message } } });

beforeEach(() => {
  FakeSocket.reset();
  vi.stubGlobal('WebSocket', FakeSocket);
});
afterEach(() => vi.unstubAllGlobals());

describe('helpers', () => {
  it('accepts IPv4 and IPv6 addresses and refuses everything else', () => {
    for (const good of ['203.0.113.7', '0.0.0.0', '255.255.255.255', '::1', '::', '2001:db8::1', '1:2:3:4:5:6:7:8', '::ffff:192.0.2.1', 'fe80::1']) expect(isValidIp(good), good).toBe(true);
    for (const bad of ['', 'abc', '256.1.1.1', '1.2.3', '1.2.3.4.5', '1:2:3:4:5:6:7', '1::2::3', ':1:2:3:4:5:6:7:8', 'fe80::1%eth0', '12345::1', 'g::1']) expect(isValidIp(bad), bad).toBe(false);
  });

  it('reads the date format of the ban files', () => {
    expect(parseBanDate('2025-03-01 12:00:00 +0100')?.toISOString()).toBe('2025-03-01T11:00:00.000Z');
    expect(parseBanDate('2025-03-01 12:00:00 -0500')?.toISOString()).toBe('2025-03-01T17:00:00.000Z');
    expect(parseBanDate('forever')).toBeNull();
    expect(parseBanDate('gestern')).toBeNull();
  });
});

describe('players tab', () => {
  it('shows all four lists with their details', async () => {
    setup();
    render(ui());
    expect(await screen.findByRole('region', { name: 'Whitelist' })).toBeInTheDocument();
    expect(within(region('Whitelist')).getByText('Steve')).toBeInTheDocument();
    const op = within(region('Operatoren')).getByTestId('op-row');
    expect(op).toHaveTextContent('Alex');
    expect(op).toHaveTextContent('Level 3');
    expect(op).toHaveTextContent('Limit umgehen');
    const ban = within(region('Gesperrte Spieler')).getByTestId('ban-row');
    expect(ban).toHaveTextContent('Griefer');
    expect(ban).toHaveTextContent('Zerstört Bauten');
    expect(ban).toHaveTextContent('Von Server');
    expect(ban).toHaveTextContent(/Gesperrt am 01\.03\.25/);
    expect(ban).not.toHaveTextContent('Bis');
    const ip = within(region('Gesperrte IP-Adressen')).getByTestId('ip-ban-row');
    expect(ip).toHaveTextContent('203.0.113.7');
    expect(ip).toHaveTextContent('Kein Grund angegeben');
  });

  it('explains how the lists are edited depending on the mode', async () => {
    setup();
    const { unmount } = render(ui());
    expect(await screen.findByText(/Der Server ist gestoppt: Die Dateien werden direkt bearbeitet/)).toBeInTheDocument();
    unmount();
    setup(playersView({ mode: 'live' }));
    render(ui(onlineStatus));
    expect(await screen.findByText(/Änderungen werden sofort über die Konsole angewendet/)).toBeInTheDocument();
  });

  it('adds and removes whitelist entries', async () => {
    setup();
    const user = userEvent.setup();
    render(ui());
    const list = await screen.findByRole('region', { name: 'Whitelist' });
    await user.type(within(list).getByLabelText('Spielername'), ' Notch_1 ');
    await user.click(within(list).getByRole('button', { name: 'Hinzufügen' }));
    await waitFor(() => expect(api.callsTo('POST /api/servers/srv-1/players/whitelist')).toHaveLength(1));
    expect(api.callsTo('POST /api/servers/srv-1/players/whitelist')[0]?.body).toEqual({ name: 'Notch_1' });
    expect(await within(list).findByText('Notch_1')).toBeInTheDocument();
    expect(within(list).getByLabelText('Spielername')).toHaveValue('');

    await user.click(within(list).getByRole('button', { name: 'Steve von der Whitelist entfernen' }));
    await waitFor(() => expect(within(list).queryByText('Steve')).not.toBeInTheDocument());
    expect(api.callsTo('DELETE /api/servers/srv-1/players/whitelist/')[0]?.url).toBe('/api/servers/srv-1/players/whitelist/Steve');
  });

  it('checks names before sending anything', async () => {
    setup();
    const user = userEvent.setup();
    render(ui());
    const list = await screen.findByRole('region', { name: 'Whitelist' });
    await user.click(within(list).getByRole('button', { name: 'Hinzufügen' }));
    expect(await within(list).findByText('Bitte einen Spielernamen eingeben.')).toBeInTheDocument();
    await user.type(within(list).getByLabelText('Spielername'), 'viel zu langer name!');
    await user.click(within(list).getByRole('button', { name: 'Hinzufügen' }));
    expect(await within(list).findByRole('alert')).toHaveTextContent('Ungültiger Name');
    expect(within(list).getByLabelText('Spielername')).toBeInvalid();
    expect(api.callsTo('POST /api/servers/srv-1/players/whitelist')).toHaveLength(0);
    // typing clears the message
    await user.clear(within(list).getByLabelText('Spielername'));
    await user.type(within(list).getByLabelText('Spielername'), 'Steve2');
    expect(within(list).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('makes an operator with a level and the player limit flag while the server is stopped', async () => {
    setup();
    const user = userEvent.setup();
    render(ui());
    const ops = await screen.findByRole('region', { name: 'Operatoren' });
    const level = within(ops).getByLabelText('Level');
    expect(level).toHaveValue('4');
    expect(within(ops).getByText(/Darf alles, auch den Server beenden/)).toBeInTheDocument();
    await user.selectOptions(level, '2');
    expect(within(ops).getByText(/Darf die meisten Spielbefehle nutzen/)).toBeInTheDocument();
    await user.click(within(ops).getByRole('checkbox', { name: /Spielerlimit umgehen/ }));
    await user.type(within(ops).getByLabelText('Spielername'), 'Notch');
    await user.click(within(ops).getByRole('button', { name: 'Zum Operator machen' }));
    await waitFor(() => expect(api.callsTo('POST /api/servers/srv-1/players/ops')).toHaveLength(1));
    expect(api.callsTo('POST /api/servers/srv-1/players/ops')[0]?.body).toEqual({ name: 'Notch', level: 2, bypassesPlayerLimit: true });
    expect(await within(ops).findByText('Level 2')).toBeInTheDocument();
  });

  it('only offers the default level while the server runs', async () => {
    setup(playersView({ mode: 'live', opPermissionLevel: 4 }));
    const user = userEvent.setup();
    render(ui(onlineStatus));
    const ops = await screen.findByRole('region', { name: 'Operatoren' });
    expect(within(ops).getByText(/vergibt „\/op“ immer den Standard-Level \(4\)/)).toBeInTheDocument();
    const level = within(ops).getByLabelText('Level');
    expect(level).toHaveValue('4');
    for (const option of within(level).getAllByRole('option')) {
      if (option.getAttribute('value') === '4') expect(option).toBeEnabled();
      else expect(option).toBeDisabled();
    }
    expect(within(ops).getByRole('checkbox', { name: /Spielerlimit umgehen/ })).toBeDisabled();
    await user.type(within(ops).getByLabelText('Spielername'), 'Notch');
    await user.click(within(ops).getByRole('button', { name: 'Zum Operator machen' }));
    await waitFor(() => expect(api.callsTo('POST /api/servers/srv-1/players/ops')).toHaveLength(1));
    // no level, no flag: the server decides
    expect(api.callsTo('POST /api/servers/srv-1/players/ops')[0]?.body).toEqual({ name: 'Notch' });
  });

  it('removes operator rights', async () => {
    setup();
    const user = userEvent.setup();
    render(ui());
    const ops = await screen.findByRole('region', { name: 'Operatoren' });
    await user.click(within(ops).getByRole('button', { name: 'Alex die Operatorrechte entziehen' }));
    await waitFor(() => expect(within(ops).getByText('Es gibt keine Operatoren.')).toBeInTheDocument());
    expect(api.callsTo('DELETE /api/servers/srv-1/players/ops/')[0]?.url).toBe('/api/servers/srv-1/players/ops/Alex');
  });

  it('bans a player with a reason and lifts the ban again', async () => {
    setup();
    const user = userEvent.setup();
    render(ui());
    const bans = await screen.findByRole('region', { name: 'Gesperrte Spieler' });
    await user.type(within(bans).getByLabelText('Spielername'), 'Spammer');
    await user.type(within(bans).getByLabelText('Grund (optional)'), 'Werbung im Chat');
    await user.click(within(bans).getByRole('button', { name: 'Sperren' }));
    await waitFor(() => expect(api.callsTo('POST /api/servers/srv-1/players/banned-players')).toHaveLength(1));
    expect(api.callsTo('POST /api/servers/srv-1/players/banned-players')[0]?.body).toEqual({ name: 'Spammer', reason: 'Werbung im Chat' });
    expect(await within(bans).findByText('Werbung im Chat')).toBeInTheDocument();
    expect(within(bans).getByLabelText('Grund (optional)')).toHaveValue('');

    await user.click(within(bans).getByRole('button', { name: 'Griefer entsperren' }));
    await waitFor(() => expect(within(bans).getByText('Es sind keine Spieler gesperrt.')).toBeInTheDocument());
    expect(api.callsTo('DELETE /api/servers/srv-1/players/banned-players/')[0]?.url).toBe('/api/servers/srv-1/players/banned-players/Griefer');
  });

  it('bans and unbans IP addresses, and checks the address first', async () => {
    setup();
    const user = userEvent.setup();
    render(ui());
    const ips = await screen.findByRole('region', { name: 'Gesperrte IP-Adressen' });
    await user.type(within(ips).getByLabelText('IP-Adresse'), '999.1.1.1');
    await user.click(within(ips).getByRole('button', { name: 'Sperren' }));
    expect(await within(ips).findByText('Ungültige IP-Adresse (IPv4 oder IPv6).')).toBeInTheDocument();
    expect(api.callsTo('POST /api/servers/srv-1/players/banned-ips')).toHaveLength(0);

    await user.clear(within(ips).getByLabelText('IP-Adresse'));
    await user.type(within(ips).getByLabelText('IP-Adresse'), '2001:db8::1');
    await user.click(within(ips).getByRole('button', { name: 'Sperren' }));
    await waitFor(() => expect(api.callsTo('POST /api/servers/srv-1/players/banned-ips')).toHaveLength(1));
    expect(api.callsTo('POST /api/servers/srv-1/players/banned-ips')[0]?.body).toEqual({ ip: '2001:db8::1' });
    expect(await within(ips).findByText('2001:db8::1')).toBeInTheDocument();

    await user.click(within(ips).getByRole('button', { name: '203.0.113.7 entsperren' }));
    await waitFor(() => expect(within(ips).getByText('Es sind keine IP-Adressen gesperrt.')).toBeInTheDocument());
    expect(api.callsTo('DELETE /api/servers/srv-1/players/banned-ips/')[0]?.url).toBe('/api/servers/srv-1/players/banned-ips/203.0.113.7');
  });

  it('offers quick actions for the players who are online', async () => {
    setup(playersView({ mode: 'live', online: ['Steve', 'Notch'] }));
    const user = userEvent.setup();
    render(ui(onlineStatus));
    const online = await screen.findByRole('region', { name: 'Online-Spieler' });
    const rows = within(online).getAllByTestId('online-row');
    expect(rows).toHaveLength(2);
    // Steve is whitelisted already, Notch is not
    expect(within(rows[0] as HTMLElement).getByText('Steve')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText('Steht auf der Whitelist')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).queryByRole('button', { name: 'Steve auf die Whitelist setzen' })).not.toBeInTheDocument();

    await user.click(within(online).getByRole('button', { name: 'Notch auf die Whitelist setzen' }));
    await waitFor(() => expect(api.callsTo('POST /api/servers/srv-1/players/whitelist')[0]?.body).toEqual({ name: 'Notch' }));
    await user.click(within(online).getByRole('button', { name: 'Notch zum Operator machen' }));
    await waitFor(() => expect(api.callsTo('POST /api/servers/srv-1/players/ops')[0]?.body).toEqual({ name: 'Notch' }));
  });

  it('asks before banning an online player and sends the reason', async () => {
    setup(playersView({ mode: 'live', online: ['Notch'] }));
    const user = userEvent.setup();
    render(ui(onlineStatus));
    await user.click(await screen.findByRole('button', { name: 'Notch sperren' }));
    const dialog = await screen.findByRole('dialog', { name: 'Notch sperren?' });
    expect(api.callsTo('POST /api/servers/srv-1/players/banned-players')).toHaveLength(0);
    await user.type(within(dialog).getByLabelText('Grund (optional)'), 'Cheating');
    await user.click(within(dialog).getByRole('button', { name: 'Sperren' }));
    await waitFor(() => expect(api.callsTo('POST /api/servers/srv-1/players/banned-players')).toHaveLength(1));
    expect(api.callsTo('POST /api/servers/srv-1/players/banned-players')[0]?.body).toEqual({ name: 'Notch', reason: 'Cheating' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Notch sperren?' })).not.toBeInTheDocument());
    expect(await within(region('Gesperrte Spieler')).findByText('Cheating')).toBeInTheDocument();
  });

  it('can cancel the ban dialog', async () => {
    setup(playersView({ mode: 'live', online: ['Notch'] }));
    const user = userEvent.setup();
    render(ui(onlineStatus));
    await user.click(await screen.findByRole('button', { name: 'Notch sperren' }));
    const dialog = await screen.findByRole('dialog', { name: 'Notch sperren?' });
    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Notch sperren?' })).not.toBeInTheDocument());
    expect(api.callsTo('POST /api/servers/srv-1/players/banned-players')).toHaveLength(0);
  });

  it('switches the whitelist enforcement through its endpoint and takes over the lists it answers with', async () => {
    setup(playersView({ mode: 'live', whitelistEnabled: false }));
    const user = userEvent.setup();
    // the answer also carries a list change made meanwhile: it must show up, not the stale view
    // the answer also carries a list change made meanwhile and a notice: both must show up, not the stale view
    api.set('POST /api/servers/srv-1/players/whitelist-enabled', ({ body }) => {
      current = {
        ...current,
        whitelistEnabled: (body as { enabled: boolean }).enabled,
        whitelist: [...current.whitelist, { uuid: 'u-frisch', name: 'Frisch' }],
        notice: 'Der Server hat die Änderung noch nicht in die Datei geschrieben.',
      };
      return { body: current };
    });
    render(ui(onlineStatus));
    const toggle = await screen.findByRole('switch', { name: 'Whitelist erzwingen' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(/Die Umschaltung wird sofort über die Konsole angewendet/)).toBeInTheDocument();
    await user.click(toggle);
    await waitFor(() => expect(api.callsTo('POST /api/servers/srv-1/players/whitelist-enabled')).toHaveLength(1));
    expect(api.callsTo('POST /api/servers/srv-1/players/whitelist-enabled')[0]?.body).toEqual({ enabled: true });
    expect(api.callsTo('PUT /api/servers/srv-1/properties/entries')).toHaveLength(0);
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Whitelist erzwingen' })).toHaveAttribute('aria-checked', 'true'));
    expect(await within(region('Whitelist')).findByText('Frisch')).toBeInTheDocument();
    expect(screen.getByText('Der Server hat die Änderung noch nicht in die Datei geschrieben.')).toBeInTheDocument();
    // applied live: no restart is asked for
    expect(screen.queryByText('Neustart nötig')).not.toBeInTheDocument();
  });

  it('limits the name input to 16 characters for Mojang names and to 32 for offline or dotted names', async () => {
    setup();
    const user = userEvent.setup();
    render(ui());
    const list = await screen.findByRole('region', { name: 'Whitelist' });
    const input = within(list).getByLabelText('Spielername');
    expect(input).toHaveAttribute('maxLength', '16');
    await user.type(input, '.Bedrock');
    expect(input).toHaveAttribute('maxLength', '32');
  });

  it('limits the name input to 32 characters in offline mode', async () => {
    setup(playersView({ onlineMode: false }));
    render(ui());
    const list = await screen.findByRole('region', { name: 'Whitelist' });
    expect(within(list).getByLabelText('Spielername')).toHaveAttribute('maxLength', '32');
  });

  it('preselects level 1 in file mode when the server default is 0', async () => {
    setup(playersView({ opPermissionLevel: 0 }));
    render(ui());
    const ops = await screen.findByRole('region', { name: 'Operatoren' });
    expect(within(ops).getByLabelText('Level')).toHaveValue('1');
    expect(within(ops).getByLabelText('Level')).toBeEnabled();
  });

  it('shows a live default of 0 as fixed and sends only the name', async () => {
    setup(playersView({ mode: 'live', opPermissionLevel: 0 }));
    const user = userEvent.setup();
    render(ui(onlineStatus));
    const ops = await screen.findByRole('region', { name: 'Operatoren' });
    const level = within(ops).getByLabelText('Level');
    expect(level).toHaveValue('0');
    expect(level).toBeDisabled();
    await user.type(within(ops).getByLabelText('Spielername'), 'Notch');
    await user.click(within(ops).getByRole('button', { name: 'Zum Operator machen' }));
    await waitFor(() => expect(api.callsTo('POST /api/servers/srv-1/players/ops')).toHaveLength(1));
    expect(api.callsTo('POST /api/servers/srv-1/players/ops')[0]?.body).toEqual({ name: 'Notch' });
  });

  it('checks player names by the mode: online names follow the Mojang rule, offline names any printable ASCII', async () => {
    expect(isValidPlayerName('Notch_1', true)).toBe(true);
    expect(isValidPlayerName('Ümlaut', true)).toBe(false);
    expect(isValidPlayerName('.Notch', true)).toBe(true);
    expect(isValidPlayerName('Ümlaut', false)).toBe(false);
    expect(isValidPlayerName('name with space', false)).toBe(false);
    expect(isValidPlayerName('@Notch', false)).toBe(false);
    expect(isValidPlayerName('x'.repeat(33), false)).toBe(false);
    expect(isValidPlayerName('Notch.Bedrock-1!', false)).toBe(true);
    expect(isValidPlayerName('x'.repeat(32), false)).toBe(true);
  });

  it('accepts a name with dots while the server is in offline mode and says why otherwise', async () => {
    setup(playersView({ onlineMode: false }));
    const user = userEvent.setup();
    render(ui());
    const list = await screen.findByRole('region', { name: 'Whitelist' });
    await user.type(within(list).getByLabelText('Spielername'), 'Ein Name');
    await user.click(within(list).getByRole('button', { name: 'Hinzufügen' }));
    expect(await within(list).findByText('Ungültiger Name: 1 bis 32 sichtbare Zeichen ohne Leerzeichen, darf nicht mit @ beginnen.')).toBeInTheDocument();
    expect(api.callsTo('POST /api/servers/srv-1/players/whitelist')).toHaveLength(0);
    await user.clear(within(list).getByLabelText('Spielername'));
    await user.type(within(list).getByLabelText('Spielername'), '.Bedrock-1');
    await user.click(within(list).getByRole('button', { name: 'Hinzufügen' }));
    await waitFor(() => expect(api.callsTo('POST /api/servers/srv-1/players/whitelist')).toHaveLength(1));
    expect(api.callsTo('POST /api/servers/srv-1/players/whitelist')[0]?.body).toEqual({ name: '.Bedrock-1' });
  });

  it('keeps the online rule for ordinary names and lets a dotted name through to the server', async () => {
    setup();
    const user = userEvent.setup();
    render(ui());
    const list = await screen.findByRole('region', { name: 'Whitelist' });
    await user.type(within(list).getByLabelText('Spielername'), 'Ümlaut');
    await user.click(within(list).getByRole('button', { name: 'Hinzufügen' }));
    expect(await within(list).findByText('Ungültiger Name: 1 bis 16 Zeichen, nur Buchstaben, Ziffern und Unterstrich.')).toBeInTheDocument();
    expect(api.callsTo('POST /api/servers/srv-1/players/whitelist')).toHaveLength(0);
  });

  it('does not check the names of the quick actions for online players, dotted ones included', async () => {
    setup(playersView({ mode: 'live', onlineMode: true, online: ['.Bedrock-1'] }));
    const user = userEvent.setup();
    render(ui(onlineStatus));
    const online = await screen.findByRole('region', { name: 'Online-Spieler' });
    await user.click(within(online).getByRole('button', { name: '.Bedrock-1 auf die Whitelist setzen' }));
    await waitFor(() => expect(api.callsTo('POST /api/servers/srv-1/players/whitelist')[0]?.body).toEqual({ name: '.Bedrock-1' }));
  });

  it('warns when online mode is off', async () => {
    setup(playersView({ onlineMode: false }));
    render(ui());
    expect(await screen.findByText(/Der Online-Modus ist ausgeschaltet/)).toBeInTheDocument();
  });

  it('shows the refusal of the backend next to the list that was changed', async () => {
    setup();
    api.set('POST /api/servers/srv-1/players/whitelist', () => error('PLAYER_NOT_FOUND', 'Spieler nicht gefunden: Der Name „Nobody“ existiert bei Mojang nicht.', 404));
    const user = userEvent.setup();
    render(ui());
    const list = await screen.findByRole('region', { name: 'Whitelist' });
    await user.type(within(list).getByLabelText('Spielername'), 'Nobody');
    await user.click(within(list).getByRole('button', { name: 'Hinzufügen' }));
    expect(await within(list).findByText(/existiert bei Mojang nicht/)).toBeInTheDocument();
    expect(within(list).getByText('Fehlercode: PLAYER_NOT_FOUND')).toBeInTheDocument();
    // the name stays so it can be corrected
    expect(within(list).getByLabelText('Spielername')).toHaveValue('Nobody');
    expect(within(region('Operatoren')).queryByText(/existiert bei Mojang nicht/)).not.toBeInTheDocument();
  });

  it('shows an unsupported Minecraft version instead of the lists', async () => {
    setup(playersView({ supported: false, whitelist: [], ops: [], bannedPlayers: [], bannedIps: [] }));
    render(ui());
    expect(await screen.findByText('Spielerlisten nicht verfügbar')).toBeInTheDocument();
    expect(screen.getByText(/Minecraft 1\.21\.1 führt Whitelist/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Whitelist' })).not.toBeInTheDocument();
  });

  it('locks every form while the server starts or stops', async () => {
    setup(playersView({ busy: true }));
    render(ui({ ...offlineStatus, state: 'starting' }));
    expect(await screen.findByText(/startet oder stoppt gerade/)).toBeInTheDocument();
    const list = region('Whitelist');
    expect(within(list).getByLabelText('Spielername')).toBeDisabled();
    expect(within(list).getByRole('button', { name: 'Hinzufügen' })).toBeDisabled();
    expect(within(list).getByRole('button', { name: 'Steve von der Whitelist entfernen' })).toBeDisabled();
    expect(within(region('Gesperrte IP-Adressen')).getByRole('button', { name: 'Sperren' })).toBeDisabled();
  });

  it('warns about a damaged list file and leaves only that list locked', async () => {
    setup(playersView({ corrupt: ['ops'], ops: [] }));
    render(ui());
    const ops = await screen.findByRole('region', { name: 'Operatoren' });
    expect(within(ops).getByText(/Die Datei ops\.json ist beschädigt/)).toBeInTheDocument();
    expect(within(ops).getByRole('button', { name: 'Zum Operator machen' })).toBeDisabled();
    expect(within(region('Whitelist')).getByRole('button', { name: 'Hinzufügen' })).toBeEnabled();
  });

  it('tells when a live change is not visible in the file yet and can read again', async () => {
    setup(playersView({ mode: 'live', pending: true, notice: 'Der Server hat die Änderung noch nicht in die Datei geschrieben.' }));
    const user = userEvent.setup();
    render(ui(onlineStatus));
    expect(await screen.findByText(/noch nicht in die Datei geschrieben/)).toBeInTheDocument();
    const before = api.callsTo('GET /api/servers/srv-1/players').length;
    current = { ...current, pending: false, notice: null };
    await user.click(screen.getByRole('button', { name: 'Aktualisieren' }));
    await waitFor(() => expect(api.callsTo('GET /api/servers/srv-1/players').length).toBe(before + 1));
    await waitFor(() => expect(screen.queryByText(/noch nicht in die Datei geschrieben/)).not.toBeInTheDocument());
  });

  it('reads the lists again when the server state or its players change', async () => {
    setup();
    render(ui(offlineStatus));
    await screen.findByRole('region', { name: 'Whitelist' });
    expect(api.callsTo('GET /api/servers/srv-1/players')).toHaveLength(1);
    const events = FakeSocket.instances.find((entry) => entry.url.includes('/api/events'));
    if (events === undefined) throw new Error('Kein Ereignis-Socket');
    act(() => events.open());
    current = playersView({ mode: 'live', online: ['Steve'] });
    act(() => events.receive({ type: 'server.status', serverId: 'srv-1', status: { ...onlineStatus, players: ['Steve'] } }));
    await waitFor(() => expect(api.callsTo('GET /api/servers/srv-1/players')).toHaveLength(2));
    expect(await screen.findByText('1 Spieler online')).toBeInTheDocument();
    // the lists stay on screen during the reload
    expect(screen.getByRole('region', { name: 'Whitelist' })).toBeInTheDocument();
    act(() => events.receive({ type: 'server.status', serverId: 'srv-1', status: { ...onlineStatus, players: ['Steve', 'Notch'] } }));
    await waitFor(() => expect(api.callsTo('GET /api/servers/srv-1/players')).toHaveLength(3));
  });

  it('offers a retry when the lists cannot be loaded', async () => {
    setup();
    api.set('GET /api/servers/srv-1/players', () => error('INTERNAL_ERROR', 'Es ist ein interner Fehler aufgetreten.', 500));
    const user = userEvent.setup();
    render(ui());
    expect(await screen.findByText('Die Spielerlisten konnten nicht geladen werden')).toBeInTheDocument();
    api.set('GET /api/servers/srv-1/players', () => ({ body: current }));
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByRole('region', { name: 'Whitelist' })).toBeInTheDocument();
  });

  it('renders in English', async () => {
    setup(playersView({ mode: 'live', online: ['Notch'] }));
    render(ui(onlineStatus, 'en'));
    expect(await screen.findByRole('region', { name: 'Operators' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Banned players' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Banned IP addresses' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Online players' })).toBeInTheDocument();
    expect(screen.getByText('1 player online')).toBeInTheDocument();
    expect(screen.getByText(/changes are applied immediately through the console/)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Enforce whitelist' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ban Notch' })).toBeInTheDocument();
    expect(screen.getByText(/While the server runs, "\/op" always assigns the default level/)).toBeInTheDocument();
    expect(screen.queryByText('Spielername')).not.toBeInTheDocument();
  });
});
