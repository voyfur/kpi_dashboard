import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiRequestError, getCurrentUser, login as loginRequest, logout as logoutRequest, type AuthUser } from './api';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'error';
type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  markUnauthenticated: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);

  const refresh = useCallback(async () => {
    setStatus('loading');
    try {
      const currentUser = await getCurrentUser();
      setUser(currentUser);
      setStatus('authenticated');
    } catch (error) {
      setUser(null);
      setStatus(error instanceof ApiRequestError && error.status === 401 ? 'unauthenticated' : 'error');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const authenticatedUser = await loginRequest(email, password);
    setUser(authenticatedUser);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    try {
      await logoutRequest();
    } finally {
      setUser(null);
      setStatus('unauthenticated');
    }
  }, []);

  const markUnauthenticated = useCallback(() => {
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  const value = useMemo(
    () => ({ status, user, refresh, login, logout, markUnauthenticated }),
    [status, user, refresh, login, logout, markUnauthenticated],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider');
  return value;
}
