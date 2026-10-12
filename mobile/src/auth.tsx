import type { AuthError, Session, SupabaseClient } from '@supabase/supabase-js';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';

import { api, setAuthToken } from './api';
import { createSupabase, enabledProviders } from './supabase';
import type { User } from './types';

WebBrowser.maybeCompleteAuthSession();

/** What a signed-in person still has to do before they can post. */
export type Missing = 'signin' | 'verify' | 'username' | null;

interface AuthState {
  /** False until the saved sign-in has been checked on launch. */
  ready: boolean;
  /** False when the server has no Supabase project connected (browsing still works). */
  enabled: boolean;
  providers: { apple: boolean; google: boolean };
  /** Where people can write for support, reports and privacy requests (from the server's settings). */
  contactEmail: string | null;
  /** How close (meters) you must be to a restroom to rate it. */
  visitRadiusM: number;
  user: User | null;
  /** The next step before this person can post, or null if they can. */
  missing: Missing;

  signIn: (email: string, password: string) => Promise<'ok' | 'verify'>;
  signUp: (email: string, password: string) => Promise<'ok' | 'verify'>;
  verifyEmail: (email: string, code: string) => Promise<void>;
  resendVerification: (email: string) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  resetPassword: (email: string, code: string, newPassword: string) => Promise<void>;
  changePassword: (newPassword: string) => Promise<void>;
  signInWithApple: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;

  updateProfile: (fields: Parameters<typeof api.updateMe>[0]) => Promise<void>;
  setAvatar: (imageBase64: string) => Promise<void>;
  removeAvatar: () => Promise<void>;
  refreshUser: () => Promise<void>;
  /** Signs out locally after the server rejected the session. */
  expire: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/** Turns Supabase errors into plain messages. */
function friendly(error: AuthError | Error): Error {
  const code = 'code' in error ? error.code : undefined;
  const messages: Record<string, string> = {
    invalid_credentials: 'Incorrect email or password.',
    email_not_confirmed: 'Please verify your email first.',
    user_already_exists: 'An account with this email already exists. Try signing in.',
    email_exists: 'An account with this email already exists. Try signing in.',
    weak_password: 'Choose a stronger password: at least 8 characters, not a common one.',
    otp_expired: 'That code is wrong or has expired. Check the latest email or send a new code.',
    over_email_send_rate_limit: 'Too many emails sent. Please wait a few minutes and try again.',
    over_request_rate_limit: 'Too many attempts. Please wait a few minutes and try again.',
    same_password: 'Your new password must be different from the old one.',
    email_address_invalid: 'Enter a valid email address.',
    validation_failed: 'Check your email and password and try again.',
    provider_disabled: 'That sign-in option is not turned on yet.',
  };
  return new Error((code && messages[code]) || error.message || 'Something went wrong. Please try again.');
}

function check<R extends { data: unknown; error: AuthError | null }>(result: R): R['data'] {
  if (result.error) throw friendly(result.error);
  return result.data;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [providers, setProviders] = useState({ apple: false, google: false });
  const [contactEmail, setContactEmail] = useState<string | null>(null);
  const [visitRadiusM, setVisitRadiusM] = useState(200);
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const clientRef = useRef<SupabaseClient | null>(null);

  const refreshUser = useCallback(async () => {
    try {
      setUser(await api.me());
    } catch {
      // Keep the last known profile when offline.
    }
  }, []);

  // Connect to Supabase using the settings the server publishes, then restore the saved sign-in.
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    (async () => {
      let config = null;
      for (let attempt = 0; attempt < 3 && !config; attempt++) {
        try {
          const settings = await api.config();
          setContactEmail(settings.contactEmail);
          if (settings.rules?.visitRadiusM) setVisitRadiusM(settings.rules.visitRadiusM);
          config = settings.auth;
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
      if (!config) return;
      const supabase = createSupabase(config);
      clientRef.current = supabase;
      setClient(supabase);
      enabledProviders(config).then((p) => setProviders({ ...p, apple: p.apple && Platform.OS === 'ios' }));

      const { data } = await supabase.auth.getSession();
      setAuthToken(data.session?.access_token ?? null);
      setSession(data.session);
      const sub = supabase.auth.onAuthStateChange((_event, next) => {
        setAuthToken(next?.access_token ?? null);
        setSession(next);
        if (!next) setUser(null);
      });
      unsubscribe = () => sub.data.subscription.unsubscribe();
    })().finally(() => setReady(true));
    return () => unsubscribe?.();
  }, []);

  // Load the profile whenever someone signs in.
  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
    let current = true;
    api.me().then(
      (me) => current && setUser(me),
      () => {}, // keep the last known profile when offline
    );
    return () => {
      current = false;
    };
  }, [userId]);

  // Keep the session fresh only while the app is open.
  useEffect(() => {
    if (!client) return;
    const handle = (state: string) =>
      state === 'active' ? client.auth.startAutoRefresh() : client.auth.stopAutoRefresh();
    handle(AppState.currentState);
    const sub = AppState.addEventListener('change', handle);
    return () => sub.remove();
  }, [client]);

  const value = useMemo<AuthState>(() => {
    const need = () => {
      if (!clientRef.current) throw new Error('Sign-in is not set up on this server yet.');
      return clientRef.current.auth;
    };
    const missing: Missing = !session
      ? 'signin'
      : !user
        ? null
        : !user.emailVerified
          ? 'verify'
          : !user.username
            ? 'username'
            : null;

    return {
      ready,
      enabled: !!client,
      providers,
      contactEmail,
      visitRadiusM,
      user: session ? user : null,
      missing,

      signIn: async (email, password) => {
        const { error } = await need().signInWithPassword({ email, password });
        if (error?.code === 'email_not_confirmed') {
          await need().resend({ type: 'signup', email });
          return 'verify';
        }
        if (error) throw friendly(error);
        return 'ok';
      },
      signUp: async (email, password) => {
        const data = check(await need().signUp({ email, password }));
        return data.session ? 'ok' : 'verify';
      },
      verifyEmail: async (email, code) => {
        const first = await need().verifyOtp({ email, token: code, type: 'email' });
        if (first.error) check(await need().verifyOtp({ email, token: code, type: 'signup' }));
      },
      resendVerification: async (email) => {
        check(await need().resend({ type: 'signup', email }));
      },
      sendPasswordReset: async (email) => {
        check(await need().resetPasswordForEmail(email));
      },
      resetPassword: async (email, code, newPassword) => {
        check(await need().verifyOtp({ email, token: code, type: 'recovery' }));
        check(await need().updateUser({ password: newPassword }));
      },
      changePassword: async (newPassword) => {
        check(await need().updateUser({ password: newPassword }));
      },
      signInWithApple: async () => {
        const credential = await AppleAuthentication.signInAsync({
          requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL],
        });
        if (!credential.identityToken) throw new Error('Apple did not return a sign-in token.');
        check(await need().signInWithIdToken({ provider: 'apple', token: credential.identityToken }));
      },
      signInWithGoogle: async () => {
        const redirectTo = Linking.createURL('auth-callback');
        const data = check(
          await need().signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: true } }),
        );
        if (!data.url) throw new Error('Google sign-in is not available right now.');
        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
        if (result.type !== 'success') return; // the person closed the sign-in window
        const params = new URL(result.url).searchParams;
        const code = params.get('code');
        if (!code) throw new Error(params.get('error_description') ?? 'Google sign-in was cancelled.');
        check(await need().exchangeCodeForSession(code));
      },
      signOut: async () => {
        await clientRef.current?.auth.signOut();
        setUser(null);
      },
      deleteAccount: async () => {
        await api.deleteAccount();
        await clientRef.current?.auth.signOut({ scope: 'local' });
        setUser(null);
      },

      updateProfile: async (fields) => setUser(await api.updateMe(fields)),
      setAvatar: async (image) => setUser(await api.setAvatar(image)),
      removeAvatar: async () => setUser(await api.removeAvatar()),
      refreshUser,
      expire: async () => {
        await clientRef.current?.auth.signOut({ scope: 'local' });
        setUser(null);
      },
    };
  }, [ready, client, providers, contactEmail, visitRadiusM, session, user, refreshUser]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
