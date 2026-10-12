import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { ApiError, api, setAuthToken } from './api';
import type { User } from './types';

const TOKEN_KEY = 'toilettime.session';

interface AuthState {
  /** False until the saved session has been checked on launch. */
  ready: boolean;
  user: User | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  /** Clears a session the server no longer accepts. */
  expire: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  const clear = useCallback(async () => {
    setAuthToken(null);
    setUser(null);
    await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
  }, []);

  const start = useCallback(async (session: { token: string; user: User }) => {
    await SecureStore.setItemAsync(TOKEN_KEY, session.token);
    setAuthToken(session.token);
    setUser(session.user);
  }, []);

  // Restore the saved session on launch.
  useEffect(() => {
    (async () => {
      const token = await SecureStore.getItemAsync(TOKEN_KEY).catch(() => null);
      if (!token) return;
      try {
        const me = await api.me(token);
        setAuthToken(token);
        setUser(me);
      } catch (e) {
        // Only forget the session if the server rejected it; keep it when offline.
        if (e instanceof ApiError && e.status === 401) await clear();
        else setAuthToken(token);
      }
    })().finally(() => setReady(true));
  }, [clear]);

  const value = useMemo<AuthState>(
    () => ({
      ready,
      user,
      signIn: async (email, password) => start(await api.signIn(email, password)),
      signUp: async (name, email, password) => start(await api.signUp(name, email, password)),
      signOut: async () => {
        await api.signOut().catch(() => {});
        await clear();
      },
      deleteAccount: async () => {
        await api.deleteAccount();
        await clear();
      },
      expire: clear,
    }),
    [ready, user, start, clear],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
