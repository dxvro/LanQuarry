import { describe, expect, it } from 'vitest';
import type { RuntimeStatus, ServerView } from '../lib/types';
import { initialLiveState, liveReducer, needsRefetch, offlineStatus, statusOf, type LiveAction, type LiveState } from './reducer';

const server = (id: string, overrides: Partial<ServerView> = {}): ServerView =>
  ({ id, name: `Server ${id}`, installState: 'installed', installError: null, status: offlineStatus(), ...overrides }) as ServerView;

const status = (overrides: Partial<RuntimeStatus> = {}): RuntimeStatus => ({ ...offlineStatus(), ...overrides });

const apply = (state: LiveState, ...actions: LiveAction[]): LiveState => actions.reduce(liveReducer, state);
const message = (value: unknown): LiveAction => ({ type: 'message', message: value as never });

describe('liveReducer', () => {
  it('replaces all statuses by the snapshot and treats unknown servers as offline afterwards', () => {
    const a = server('a', { status: status({ state: 'online' }) });
    let state = apply(initialLiveState(), { type: 'servers', servers: [a] });
    expect(statusOf(state, a).state).toBe('online');
    state = apply(state, message({ type: 'snapshot', serverTime: 1, servers: [] }));
    expect(statusOf(state, a).state).toBe('offline');
  });

  it('follows status and metrics events', () => {
    const state = apply(
      initialLiveState(),
      message({ type: 'server.status', serverId: 'a', status: status({ state: 'online', pid: 5 }) }),
      message({ type: 'server.metrics', serverId: 'a', cpuPercent: 12.5, rssBytes: 1000 }),
    );
    expect(state.statuses['a']).toMatchObject({ state: 'online', cpuPercent: 12.5, rssBytes: 1000 });
  });

  it('ignores metrics for servers it has no status for', () => {
    const state = apply(initialLiveState(), message({ type: 'server.metrics', serverId: 'zzz', cpuPercent: 1, rssBytes: 1 }));
    expect(state.statuses).toEqual({});
  });

  it('keeps crash details until the server starts again', () => {
    let state = apply(initialLiveState(), message({ type: 'server.status', serverId: 'a', status: status({ state: 'crashed', exitCode: 1 }) }), message({ type: 'server.crashed', serverId: 'a', exitCode: 1, lastLines: ['boom'] }));
    expect(state.crashes['a']).toEqual({ exitCode: 1, lastLines: ['boom'] });
    state = apply(state, message({ type: 'server.status', serverId: 'a', status: status({ state: 'starting' }) }));
    expect(state.crashes['a']).toBeUndefined();
  });

  it('remembers "restart needed" until the next start', () => {
    let state = apply(initialLiveState(), { type: 'restart-needed', serverId: 'a', needed: true });
    expect(state.restartNeeded['a']).toBe(true);
    state = apply(state, message({ type: 'server.status', serverId: 'a', status: status({ state: 'starting' }) }));
    expect(state.restartNeeded['a']).toBeUndefined();
  });

  it('tracks installation progress and a capped log, and patches the server row', () => {
    let state = apply(initialLiveState(), { type: 'servers', servers: [server('a', { installState: 'pending' })] });
    state = apply(
      state,
      message({ type: 'install.state', serverId: 'a', installState: 'installing', installError: null }),
      message({ type: 'install.progress', serverId: 'a', phase: 'download', percent: 40, message: 'server.jar' }),
      message({ type: 'install.log', serverId: 'a', line: 'Zeile 1' }),
    );
    expect(state.installs['a']).toMatchObject({ phase: 'download', percent: 40, log: ['Zeile 1'] });
    expect(state.servers?.[0]?.installState).toBe('installing');

    for (let i = 0; i < 600; i++) state = apply(state, message({ type: 'install.log', serverId: 'a', line: `l${i}` }));
    expect(state.installs['a']?.log).toHaveLength(400);

    state = apply(state, message({ type: 'install.state', serverId: 'a', installState: 'failed', installError: 'Download fehlgeschlagen' }));
    expect(state.servers?.[0]).toMatchObject({ installState: 'failed', installError: 'Download fehlgeschlagen' });
  });

  it('removes everything about a deleted server', () => {
    let state = apply(initialLiveState(), { type: 'servers', servers: [server('a'), server('b')] }, message({ type: 'server.status', serverId: 'a', status: status({ state: 'online' }) }));
    state = apply(state, message({ type: 'server.changed', serverId: 'a', reason: 'deleted' }));
    expect(state.servers?.map((entry) => entry.id)).toEqual(['b']);
    expect(state.statuses['a']).toBeUndefined();
  });

  it('stores the result of the update check after a start', () => {
    const state = apply(initialLiveState(), message({ type: 'mods.updates', serverId: 'a', ok: true, count: 2, projects: ['A', 'B'], error: null }));
    expect(state.modUpdates['a']).toEqual({ ok: true, count: 2, projects: ['A', 'B'], error: null });
  });
});

describe('needsRefetch', () => {
  it('asks for the list after creation, update and finished installs only', () => {
    expect(needsRefetch({ type: 'server.changed', serverId: 'a', reason: 'created' })).toBe(true);
    expect(needsRefetch({ type: 'server.changed', serverId: 'a', reason: 'deleted' })).toBe(false);
    expect(needsRefetch({ type: 'install.state', serverId: 'a', installState: 'installed', installError: null })).toBe(true);
    expect(needsRefetch({ type: 'install.state', serverId: 'a', installState: 'installing', installError: null })).toBe(false);
    expect(needsRefetch({ type: 'server.metrics', serverId: 'a', cpuPercent: 1, rssBytes: 1 })).toBe(false);
  });
});
