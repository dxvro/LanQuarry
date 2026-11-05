import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { describeError, setUnauthorizedHandler } from '../lib/api';
import { authApi } from '../lib/endpoints';

export type AuthPhase = 'loading' | 'login' | 'ready' | 'error';

interface AuthContextValue {
  phase: AuthPhase;
  authRequired: boolean;
  error: string | null;
  // reads the login state from the server; used at start and whenever a socket was refused
  checkSession: () => Promise<void>;
  login: (token: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const [phase, setPhase] = useState<AuthPhase>('loading');
  const [authRequired, setAuthRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkSession = useCallback(async (): Promise<void> => {
    try {
      const status = await authApi.status();
      setAuthRequired(status.authRequired);
      setError(null);
      setPhase(status.authRequired && !status.authenticated ? 'login' : 'ready');
    } catch (cause) {
      setError(describeError(cause));
      setPhase((current) => (current === 'ready' ? current : 'error'));
    }
  }, []);

  useEffect(() => {
    // any 401 from the API means the session is gone: back to the login screen
    setUnauthorizedHandler(() => {
      setAuthRequired(true);
      setPhase('login');
    });
    void checkSession();
    return () => setUnauthorizedHandler(null);
  }, [checkSession]);

  const login = useCallback(async (token: string): Promise<void> => {
    await authApi.login(token);
    setError(null);
    setPhase('ready');
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await authApi.logout();
    } finally {
      setPhase('login');
    }
  }, []);

  const value = useMemo(() => ({ phase, authRequired, error, checkSession, login, logout }), [phase, authRequired, error, checkSession, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === null) throw new Error('useAuth muss innerhalb von AuthProvider verwendet werden.');
  return value;
}
