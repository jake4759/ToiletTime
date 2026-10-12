import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActionSheetIOS, Alert, Linking, Platform } from 'react-native';

import { API_URL } from './api';

// ---------- legal pages and support ----------

export function openLegal(page: 'terms' | 'privacy') {
  WebBrowser.openBrowserAsync(`${API_URL}/${page}`).catch(() => Linking.openURL(`${API_URL}/${page}`));
}

export function contactSupport(email: string | null, subject = 'ToiletTime support') {
  if (!email) {
    Alert.alert('Contact', 'A support email has not been set up for this ToiletTime server yet.');
    return;
  }
  Linking.openURL(`mailto:${email}?subject=${encodeURIComponent(subject)}`).catch(() =>
    Alert.alert('Contact us', `Email ${email}`),
  );
}

// ---------- choosing from a list ----------

/** Shows an action sheet (iOS) or alert (Android) and resolves with the chosen index, or null. */
export function chooseOption(title: string, options: string[], destructiveIndex?: number): Promise<number | null> {
  return new Promise((resolve) => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title,
          options: [...options, 'Cancel'],
          cancelButtonIndex: options.length,
          destructiveButtonIndex: destructiveIndex,
        },
        (i) => resolve(i === options.length ? null : i),
      );
    } else {
      Alert.alert(title, undefined, [
        ...options.map((text, i) => ({
          text,
          style: (i === destructiveIndex ? 'destructive' : 'default') as 'destructive' | 'default',
          onPress: () => resolve(i),
        })),
        { text: 'Cancel', style: 'cancel' as const, onPress: () => resolve(null) },
      ]);
    }
  });
}

export const REPORT_REASONS: [string, string][] = [
  ['spam', 'Spam or advertising'],
  ['offensive', 'Offensive or hateful'],
  ['false', 'False or misleading'],
  ['private', "Shares someone's private information"],
  ['other', 'Something else'],
];

export async function chooseReportReason(): Promise<string | null> {
  const i = await chooseOption(
    'Why are you reporting this review?',
    REPORT_REASONS.map(([, label]) => label),
  );
  return i === null ? null : REPORT_REASONS[i][0];
}

// ---------- blocked people (kept on this device) ----------

export interface BlockedPerson {
  id: string;
  username: string;
}

interface BlockedState {
  blocked: BlockedPerson[];
  isBlocked: (userId: string | null | undefined) => boolean;
  block: (person: BlockedPerson) => void;
  unblock: (userId: string) => void;
}

const KEY = 'toilettime.blocked';
const BlockedContext = createContext<BlockedState | null>(null);

export function BlockedProvider({ children }: { children: ReactNode }) {
  const [blocked, setBlocked] = useState<BlockedPerson[]>([]);

  useEffect(() => {
    SecureStore.getItemAsync(KEY)
      .then((raw) => raw && setBlocked(JSON.parse(raw)))
      .catch(() => {});
  }, []);

  const save = useCallback((next: BlockedPerson[]) => {
    setBlocked(next);
    SecureStore.setItemAsync(KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  const value = useMemo<BlockedState>(() => {
    const ids = new Set(blocked.map((b) => b.id));
    return {
      blocked,
      isBlocked: (id) => !!id && ids.has(id),
      block: (person) => !ids.has(person.id) && save([...blocked, person]),
      unblock: (id) => save(blocked.filter((b) => b.id !== id)),
    };
  }, [blocked, save]);

  return <BlockedContext.Provider value={value}>{children}</BlockedContext.Provider>;
}

export function useBlocked(): BlockedState {
  const ctx = useContext(BlockedContext);
  if (!ctx) throw new Error('useBlocked must be used inside BlockedProvider');
  return ctx;
}
