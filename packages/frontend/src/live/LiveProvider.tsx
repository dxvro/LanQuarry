import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { describeError, isAbort } from '../lib/api';
import { serversApi } from '../lib/endpoints';
import { ReconnectingSocket, websocketUrl } from '../lib/socket';
import type { EventsServerMessage, RuntimeStatus, ServerView } from '../lib/types';
import { initialLiveState, liveReducer, needsRefetch, statusOf, type LiveState } from './reducer';

interface LiveContextValue {
  state: LiveState;
  listError: string | null;
  statusFor: (server: ServerView) => RuntimeStatus;
  refresh: () => Promise<void>;
  setRestartNeeded: (serverId: string, needed: boolean) => void;
}

const LiveContext = createContext<LiveContextValue | null>(null);

const REFETCH_DELAY_MS = 150;

function isEventsMessage(value: unknown): value is EventsServerMessage {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}

export function LiveProvider({ children }: { children: ReactNode }): ReactNode {
  const { checkSession } = useAuth();
  const [state, dispatch] = useReducer(liveReducer, undefined, initialLiveState);
  const [listError, setListError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const servers = await serversApi.list(controller.signal);
      dispatch({ type: 'servers', servers });
      setListError(null);
    } catch (error) {
      if (!isAbort(error)) setListError(describeError(error));
    }
  }, []);

  useEffect(() => {
    const scheduleRefetch = (): void => {
      if (refetchTimer.current !== null) clearTimeout(refetchTimer.current);
      refetchTimer.current = setTimeout(() => void refresh(), REFETCH_DELAY_MS);
    };
    const socket = new ReconnectingSocket({
      url: () => websocketUrl('/api/events'),
      onState: (connection) => dispatch({ type: 'connection', connection }),
      // events may have been missed while the socket was down, so the list is read again on every open
      onOpen: () => void refresh(),
      onRejected: () => void checkSession(),
      onMessage: (message) => {
        if (!isEventsMessage(message)) return;
        dispatch({ type: 'message', message });
        if (needsRefetch(message)) scheduleRefetch();
      },
    });
    socket.start();
    void refresh();
    const retry = (): void => socket.retryNow();
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', retry);
    return () => {
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', retry);
      if (refetchTimer.current !== null) clearTimeout(refetchTimer.current);
      abortRef.current?.abort();
      socket.stop();
    };
  }, [refresh, checkSession]);

  const setRestartNeeded = useCallback((serverId: string, needed: boolean) => dispatch({ type: 'restart-needed', serverId, needed }), []);
  const statusFor = useCallback((server: ServerView) => statusOf(state, server), [state]);
  const value = useMemo<LiveContextValue>(
    () => ({ state, listError, statusFor, refresh, setRestartNeeded }),
    [state, listError, statusFor, refresh, setRestartNeeded],
  );
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveContextValue {
  const value = useContext(LiveContext);
  if (value === null) throw new Error('useLive muss innerhalb von LiveProvider verwendet werden.');
  return value;
}
