import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { accountApi, clearCsrfMemory } from './client';
import type { AccountUser } from './client';

export interface AuthContextValue {
  status: 'loading' | 'guest' | 'authenticated';
  user: AccountUser | null;
  error: string | null;
  refresh: () => Promise<AccountUser | null>;
  signIn: (email: string, password: string) => Promise<AccountUser>;
  signOut: () => Promise<void>;
  setUser: (user: AccountUser) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthContextValue['status']>('loading');
  const [user, setCurrentUser] = useState<AccountUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await accountApi.session();
      setCurrentUser(result.user);
      setStatus(result.user ? 'authenticated' : 'guest');
      setError(null);
      return result.user;
    } catch (reason) {
      setCurrentUser(null);
      setStatus('guest');
      if (reason instanceof Error && !('status' in reason && reason.status === 401)) setError(reason.message);
      else setError(null);
      return null;
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await accountApi.login(email, password);
    setCurrentUser(result.user);
    setStatus('authenticated');
    setError(null);
    return result.user;
  }, []);
  const signOut = useCallback(async () => {
    try { await accountApi.logout(); }
    finally {
      clearCsrfMemory();
      setCurrentUser(null);
      setStatus('guest');
    }
  }, []);
  const setUser = useCallback((value: AccountUser) => {
    setCurrentUser(value);
    setStatus('authenticated');
  }, []);

  const value = useMemo(() => ({ status, user, error, refresh, signIn, signOut, setUser }), [status, user, error, refresh, signIn, signOut, setUser]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  // Keep the game shell embeddable in isolated UI tests and story previews. The real application always mounts
  // AuthProvider at the root; the fallback is an unauthenticated, non-persistent guest state.
  return context ?? {
    status: 'loading', user: null, error: null,
    refresh: async () => null,
    signIn: async () => { throw new Error('Authentication provider is unavailable.'); },
    signOut: async () => undefined,
    setUser: () => undefined,
  };
}
