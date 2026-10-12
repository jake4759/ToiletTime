import * as Haptics from 'expo-haptics';
import { useRef, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../auth';
import { Button, Field, Section, Separator, SheetHeader } from '../components/ui';
import { useTheme } from '../theme';

interface Props {
  visible: boolean;
  /** Why the sheet was opened, e.g. "Sign in to add a restroom." */
  reason?: string | null;
  onClose: () => void;
  onDismiss?: () => void;
}

export function AccountSheet({ visible, reason, onClose, onDismiss }: Props) {
  const theme = useTheme();
  const { user } = useAuth();
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      onDismiss={onDismiss}
    >
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        {user ? <Profile onClose={onClose} /> : <SignInForm reason={reason} onDone={onClose} onCancel={onClose} />}
      </View>
    </Modal>
  );
}

function SignInForm({
  reason,
  onDone,
  onCancel,
}: {
  reason?: string | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const isSignUp = mode === 'signUp';
  const canSubmit = !!email.trim() && password.length >= (isSignUp ? 8 : 1) && (!isSignUp || !!name.trim());

  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (isSignUp) await signUp(name.trim(), email.trim(), password);
      else await signIn(email.trim(), password);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onDone();
    } catch (e) {
      setError((e as Error).message);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SheetHeader title={isSignUp ? 'Create Account' : 'Sign In'} left={{ label: 'Cancel', onPress: onCancel }} />
      <ScrollView
        contentContainerStyle={{ paddingTop: 24, paddingBottom: insets.bottom + 24 }}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <Text style={[styles.lead, { color: theme.text }]}>{isSignUp ? 'Join ToiletTime' : 'Welcome back'}</Text>
        <Text style={[styles.sub, { color: theme.textSecondary }]}>
          {reason ?? 'Sign in to rate restrooms and add new ones. Your reviews are saved to your account.'}
        </Text>

        <Section
          footer={isSignUp ? 'Your name is shown on your reviews. Passwords need at least 8 characters.' : undefined}
        >
          {isSignUp && (
            <>
              <Field
                label="Name"
                placeholder="Shown on reviews"
                value={name}
                onChangeText={setName}
                autoComplete="name"
                textContentType="name"
                returnKeyType="next"
                onSubmitEditing={() => emailRef.current?.focus()}
                maxLength={40}
              />
              <Separator />
            </>
          )}
          <Field
            ref={emailRef}
            label="Email"
            placeholder="you@example.com"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            keyboardType="email-address"
            textContentType={isSignUp ? 'emailAddress' : 'username'}
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
          <Separator />
          <Field
            ref={passwordRef}
            label="Password"
            placeholder={isSignUp ? '8+ characters' : 'Required'}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={isSignUp ? 'new-password' : 'current-password'}
            textContentType={isSignUp ? 'newPassword' : 'password'}
            returnKeyType="go"
            onSubmitEditing={submit}
          />
        </Section>

        {error && <Text style={[styles.error, { color: theme.danger }]}>{error}</Text>}

        <View style={styles.actions}>
          <Button
            title={isSignUp ? 'Create Account' : 'Sign In'}
            onPress={submit}
            loading={busy}
            disabled={!canSubmit}
          />
          <Pressable
            onPress={() => {
              setMode(isSignUp ? 'signIn' : 'signUp');
              setError(null);
            }}
            hitSlop={8}
            style={styles.switch}
          >
            <Text style={[styles.switchText, { color: theme.textSecondary }]}>
              {isSignUp ? 'Already have an account? ' : 'New to ToiletTime? '}
              <Text style={{ color: theme.brand, fontWeight: '600' }}>{isSignUp ? 'Sign In' : 'Create Account'}</Text>
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </>
  );
}

function Profile({ onClose }: { onClose: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { user, signOut, deleteAccount } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!user) return null;

  const initials = user.name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const since = new Date(user.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const confirmDelete = () =>
    Alert.alert(
      'Delete your account?',
      'This permanently deletes your account. Your reviews stay on ToiletTime but no longer show your name.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Account',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await deleteAccount();
              onClose();
            } catch (e) {
              Alert.alert("Couldn't delete account", (e as Error).message);
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );

  return (
    <>
      <SheetHeader title="Account" right={{ label: 'Done', onPress: onClose, bold: true }} />
      <ScrollView contentContainerStyle={{ paddingTop: 28, paddingBottom: insets.bottom + 24 }}>
        <View style={styles.profileTop}>
          <View style={[styles.avatar, { backgroundColor: theme.brandSoft }]}>
            <Text style={[styles.avatarText, { color: theme.brand }]}>{initials}</Text>
          </View>
          <Text style={[styles.profileName, { color: theme.text }]}>{user.name}</Text>
          <Text style={[styles.sub, { color: theme.muted, marginBottom: 0 }]}>{user.email}</Text>
          <Text style={[styles.since, { color: theme.muted }]}>Member since {since}</Text>
        </View>

        <Section>
          <Pressable
            disabled={busy}
            onPress={async () => {
              await signOut();
              onClose();
            }}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.surfaceAlt }]}
          >
            <Text style={[styles.rowText, { color: theme.brand }]}>Sign Out</Text>
          </Pressable>
        </Section>
        <Section footer="Deleting your account can't be undone.">
          <Pressable
            disabled={busy}
            onPress={confirmDelete}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.surfaceAlt }]}
          >
            <Text style={[styles.rowText, { color: theme.danger }]}>Delete Account</Text>
          </Pressable>
        </Section>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  lead: { fontSize: 28, fontWeight: '700', letterSpacing: -0.4, marginHorizontal: 32 },
  sub: { fontSize: 15, lineHeight: 21, marginHorizontal: 32, marginTop: 6, marginBottom: 24 },
  error: { fontSize: 15, marginHorizontal: 32, marginTop: -8, marginBottom: 16 },
  actions: { marginHorizontal: 16, gap: 18 },
  switch: { alignSelf: 'center' },
  switchText: { fontSize: 15 },
  profileTop: { alignItems: 'center', marginBottom: 28 },
  avatar: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  avatarText: { fontSize: 28, fontWeight: '600' },
  profileName: { fontSize: 22, fontWeight: '700' },
  since: { fontSize: 13, marginTop: 4 },
  row: { paddingHorizontal: 16, minHeight: 46, justifyContent: 'center' },
  rowText: { fontSize: 17 },
});
