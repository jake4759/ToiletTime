import * as AppleAuthentication from 'expo-apple-authentication';
import * as Haptics from 'expo-haptics';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '../api';
import { useAuth } from '../auth';
import { Avatar, Button, Field, Icon, PasswordField, Section, Separator, SheetHeader, Stars } from '../components/ui';
import { ClosetSheet, LevelProgress } from '../character/ClosetSheet';
import { Character } from '../character/Character';
import { useTheme } from '../theme';
import { contactSupport, openLegal, useBlocked } from '../safety';
import type { MyReview } from '../types';

/** Colors people can pick for their character on the map. */
export const CHARACTER_COLORS = [
  '#0f3d3e',
  '#2563eb',
  '#7c3aed',
  '#db2777',
  '#dc2626',
  '#ea580c',
  '#ca8a04',
  '#16a34a',
];

interface Props {
  visible: boolean;
  /** Why the sheet was opened, e.g. "Sign in to add a restroom." Closes itself once the person can post. */
  reason?: string | null;
  onClose: () => void;
  onDismiss?: () => void;
  /** Open a restroom from My Reviews (the sheet closes first). */
  onOpenRestroom?: (restroomId: string) => void;
}

export function AccountSheet({ visible, reason, onClose, onDismiss, onOpenRestroom }: Props) {
  const theme = useTheme();
  const { ready, enabled, user, missing } = useAuth();

  // Opened to unlock posting: close as soon as the person is signed in, verified and has a username.
  useEffect(() => {
    if (visible && reason && user && !missing) onClose();
  }, [visible, reason, user, missing, onClose]);

  let content;
  if (!ready) content = <Loading onClose={onClose} />;
  else if (!enabled) content = <NotSetUp onClose={onClose} />;
  else if (user && missing === 'verify') content = <VerifyEmail email={user.email} onClose={onClose} signedIn />;
  else if (user && missing === 'username') content = <ChooseUsername onClose={onClose} />;
  else if (user) content = <Profile onClose={onClose} onOpenRestroom={onOpenRestroom} />;
  else content = <SignInFlow reason={reason} onClose={onClose} />;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      onDismiss={onDismiss}
    >
      <View style={[styles.container, { backgroundColor: theme.background }]}>{content}</View>
    </Modal>
  );
}

// ---------- shared bits ----------

function Screen({
  title,
  onClose,
  closeLabel = 'Cancel',
  children,
}: {
  title: string;
  onClose: () => void;
  closeLabel?: string;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <>
      <SheetHeader title={title} left={{ label: closeLabel, onPress: onClose }} />
      <ScrollView
        contentContainerStyle={{ paddingTop: 24, paddingBottom: insets.bottom + 32 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        {children}
      </ScrollView>
    </>
  );
}

function Intro({ title, text }: { title: string; text?: string | null }) {
  const theme = useTheme();
  return (
    <View style={styles.intro}>
      <Text style={[styles.lead, { color: theme.text }]}>{title}</Text>
      {!!text && <Text style={[styles.sub, { color: theme.textSecondary }]}>{text}</Text>}
    </View>
  );
}

function ErrorText({ error }: { error: string | null }) {
  const theme = useTheme();
  if (!error) return null;
  return (
    <Text style={[styles.error, { color: theme.danger }]} accessibilityRole="alert">
      {error}
    </Text>
  );
}

function LinkButton({
  label,
  onPress,
  color,
  align = 'center',
}: {
  label: string;
  onPress: () => void;
  color?: string;
  align?: 'center' | 'flex-end';
}) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} hitSlop={8} style={{ alignSelf: align }}>
      <Text style={[styles.link, { color: color ?? theme.brand }]}>{label}</Text>
    </Pressable>
  );
}

/** Runs an async action with a busy flag and an error message. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (e) {
      const message = (e as Error).message;
      if (!/cancel/i.test(message) && (e as { code?: string }).code !== 'ERR_REQUEST_CANCELED') {
        setError(message);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}

function Loading({ onClose }: { onClose: () => void }) {
  return (
    <>
      <SheetHeader title="Account" left={{ label: 'Cancel', onPress: onClose }} />
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    </>
  );
}

function NotSetUp({ onClose }: { onClose: () => void }) {
  return (
    <Screen title="Account" onClose={onClose} closeLabel="Close">
      <Intro
        title="Accounts are coming soon"
        text="Sign-in isn't set up on this ToiletTime server yet. You can still browse every restroom and rating."
      />
    </Screen>
  );
}

// ---------- legal ----------

/** "Terms of Service" and "Privacy Policy" as tappable words inside a sentence. */
function LegalLinks() {
  const theme = useTheme();
  const link = { color: theme.brand, fontWeight: '600' as const };
  return (
    <>
      <Text style={link} onPress={() => openLegal('terms')} accessibilityRole="link">
        Terms of Service
      </Text>
      {' and '}
      <Text style={link} onPress={() => openLegal('privacy')} accessibilityRole="link">
        Privacy Policy
      </Text>
    </>
  );
}

function AgreeCheckbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => onChange(!checked)}
      style={styles.agree}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
    >
      <View
        style={[
          styles.checkbox,
          { borderColor: checked ? theme.brand : theme.muted, backgroundColor: checked ? theme.brand : 'transparent' },
        ]}
      >
        {checked && <Icon name="checkmark" size={13} color={theme.onBrand} />}
      </View>
      <Text style={[styles.agreeText, { color: theme.textSecondary }]}>
        I&apos;m 13 or older and agree to the <LegalLinks />.
      </Text>
    </Pressable>
  );
}

// ---------- signing in ----------

type Step = 'signIn' | 'signUp' | 'verify' | 'forgot' | 'reset';

function SignInFlow({ reason, onClose }: { reason?: string | null; onClose: () => void }) {
  const [step, setStep] = useState<Step>('signIn');
  const [email, setEmail] = useState('');
  const go = (next: Step, nextEmail?: string) => {
    if (nextEmail !== undefined) setEmail(nextEmail);
    setStep(next);
  };
  switch (step) {
    case 'signUp':
      return <SignUp email={email} onClose={onClose} go={go} />;
    case 'verify':
      return <VerifyEmail email={email} onClose={onClose} onBack={() => go('signUp')} onSignIn={() => go('signIn')} />;
    case 'forgot':
      return <ForgotPassword email={email} onClose={onClose} go={go} />;
    case 'reset':
      return <ResetPassword email={email} onClose={onClose} onBack={() => go('forgot')} />;
    default:
      return <SignIn reason={reason} email={email} onClose={onClose} go={go} />;
  }
}

function SocialButtons({ run, busy }: { run: (a: () => Promise<unknown>) => Promise<boolean>; busy: boolean }) {
  const theme = useTheme();
  const { providers, signInWithApple, signInWithGoogle } = useAuth();
  if (!providers.apple && !providers.google) return null;
  return (
    <View style={styles.social}>
      {providers.apple && (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
          buttonStyle={
            theme.dark
              ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
              : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
          }
          cornerRadius={14}
          style={styles.appleButton}
          onPress={() => !busy && run(signInWithApple)}
        />
      )}
      {providers.google && (
        <Pressable
          onPress={() => run(signInWithGoogle)}
          disabled={busy}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.googleButton,
            { backgroundColor: theme.surface, borderColor: theme.separator, opacity: pressed ? 0.75 : 1 },
          ]}
        >
          <Text style={styles.googleG}>G</Text>
          <Text style={[styles.googleText, { color: theme.text }]}>Continue with Google</Text>
        </Pressable>
      )}
      <Text style={[styles.legalNote, { color: theme.muted }]}>
        By continuing, you confirm you&apos;re 13 or older and agree to the <LegalLinks />.
      </Text>
      <View style={styles.dividerRow}>
        <View style={[styles.dividerLine, { backgroundColor: theme.separator }]} />
        <Text style={[styles.dividerText, { color: theme.muted }]}>or use email</Text>
        <View style={[styles.dividerLine, { backgroundColor: theme.separator }]} />
      </View>
    </View>
  );
}

function SignIn({
  reason,
  email: initialEmail,
  onClose,
  go,
}: {
  reason?: string | null;
  email: string;
  onClose: () => void;
  go: (s: Step, email?: string) => void;
}) {
  const theme = useTheme();
  const { signIn } = useAuth();
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const { busy, error, run } = useAction();
  const passwordRef = useRef<TextInput>(null);

  const submit = () =>
    run(async () => {
      if ((await signIn(email.trim(), password)) === 'verify') go('verify', email.trim());
    });

  return (
    <Screen title="Sign In" onClose={onClose}>
      <Intro title="Welcome back" text={reason ?? 'Sign in to rate restrooms and add new ones.'} />
      <SocialButtons run={run} busy={busy} />
      <Section>
        <Field
          label="Email"
          placeholder="you@example.com"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          keyboardType="email-address"
          textContentType="username"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
        />
        <Separator />
        <PasswordField
          ref={passwordRef}
          label="Password"
          placeholder="Required"
          value={password}
          onChangeText={setPassword}
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={submit}
        />
      </Section>
      <View style={styles.actions}>
        <LinkButton label="Forgot password?" onPress={() => go('forgot', email.trim())} align="flex-end" />
        <ErrorText error={error} />
        <Button title="Sign In" onPress={submit} loading={busy} disabled={!email.trim() || !password} />
        <Text style={[styles.switchText, { color: theme.textSecondary }]}>New to ToiletTime?</Text>
        <LinkButton label="Create an account" onPress={() => go('signUp', email.trim())} />
      </View>
    </Screen>
  );
}

function SignUp({
  email: initialEmail,
  onClose,
  go,
}: {
  email: string;
  onClose: () => void;
  go: (s: Step, email?: string) => void;
}) {
  const theme = useTheme();
  const { signUp } = useAuth();
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const { busy, error, run } = useAction();
  const passwordRef = useRef<TextInput>(null);

  const submit = () =>
    run(async () => {
      if (!agreed) throw new Error('Please confirm you are 13 or older and agree to the Terms and Privacy Policy.');
      if ((await signUp(email.trim(), password)) === 'verify') go('verify', email.trim());
    });

  return (
    <Screen title="Create Account" onClose={onClose}>
      <Intro title="Join ToiletTime" text="Rate restrooms and help others find the good ones." />
      <SocialButtons run={run} busy={busy} />
      <Section footer="Use at least 8 characters. You'll pick a username next.">
        <Field
          label="Email"
          placeholder="you@example.com"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
        />
        <Separator />
        <PasswordField
          ref={passwordRef}
          label="Password"
          placeholder="8+ characters"
          value={password}
          onChangeText={setPassword}
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={submit}
        />
      </Section>
      <View style={styles.actions}>
        <AgreeCheckbox checked={agreed} onChange={setAgreed} />
        <ErrorText error={error} />
        <Button
          title="Create Account"
          onPress={submit}
          loading={busy}
          disabled={!email.trim() || password.length < 8 || !agreed}
        />
        <Text style={[styles.switchText, { color: theme.textSecondary }]}>Already have an account?</Text>
        <LinkButton label="Sign in" onPress={() => go('signIn', email.trim())} />
      </View>
    </Screen>
  );
}

function CodeField({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.codeBox, { backgroundColor: theme.surface }]}>
      <TextInput
        value={value}
        onChangeText={(t) => onChange(t.replace(/\D/g, '').slice(0, 8))}
        placeholder="123456"
        placeholderTextColor={theme.starOff}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        autoFocus
        maxLength={8}
        onSubmitEditing={onSubmit}
        style={[styles.codeInput, { color: theme.text }]}
        accessibilityLabel="Verification code"
      />
    </View>
  );
}

/** Counts down after sending a code, so people don't hammer "Resend". */
function useCooldown(seconds: number) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return { left, restart: () => setLeft(seconds) };
}

function VerifyEmail({
  email,
  onClose,
  onBack,
  onSignIn,
  signedIn,
}: {
  email: string;
  onClose: () => void;
  onBack?: () => void;
  /** For people who confirmed with the link in the email instead of the code. */
  onSignIn?: () => void;
  signedIn?: boolean;
}) {
  const theme = useTheme();
  const { verifyEmail, resendVerification, refreshUser, signOut } = useAuth();
  const [code, setCode] = useState('');
  const { busy, error, setError, run } = useAction();
  const cooldown = useCooldown(signedIn ? 0 : 60);
  const [sent, setSent] = useState(false);

  const submit = () =>
    run(async () => {
      await verifyEmail(email, code);
      await refreshUser();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    });
  const resend = () =>
    run(async () => {
      await resendVerification(email);
      cooldown.restart();
      setSent(true);
      setError(null);
    });

  return (
    <Screen title="Verify Email" onClose={onClose}>
      <View style={styles.badge}>
        <Icon name="envelope.badge" size={40} color={theme.brand} />
      </View>
      <Intro
        title="Check your email"
        text={`Enter the code we sent to ${email}. It can take a minute to arrive; check spam too.`}
      />
      <CodeField value={code} onChange={setCode} onSubmit={submit} />
      <View style={styles.actions}>
        <ErrorText error={error} />
        {sent && !error && <Text style={[styles.note, { color: theme.textSecondary }]}>New code sent.</Text>}
        <Button title="Verify" onPress={submit} loading={busy} disabled={code.length < 6} />
        <LinkButton
          label={cooldown.left > 0 ? `Resend code in ${cooldown.left}s` : 'Resend code'}
          onPress={() => cooldown.left <= 0 && resend()}
          color={cooldown.left > 0 ? theme.muted : undefined}
        />
        {onSignIn && <LinkButton label="Confirmed with the email link? Sign in" onPress={onSignIn} />}
        {onBack && <LinkButton label="Use a different email" onPress={onBack} color={theme.textSecondary} />}
        {signedIn && <LinkButton label="Sign out" onPress={signOut} color={theme.textSecondary} />}
      </View>
    </Screen>
  );
}

function ForgotPassword({
  email: initialEmail,
  onClose,
  go,
}: {
  email: string;
  onClose: () => void;
  go: (s: Step, email?: string) => void;
}) {
  const { sendPasswordReset } = useAuth();
  const [email, setEmail] = useState(initialEmail);
  const { busy, error, run } = useAction();
  const submit = () =>
    run(async () => {
      await sendPasswordReset(email.trim());
      go('reset', email.trim());
    });
  return (
    <Screen title="Reset Password" onClose={onClose}>
      <Intro
        title="Forgot your password?"
        text="Enter your account's email and we'll send you a code to set a new one."
      />
      <Section>
        <Field
          label="Email"
          placeholder="you@example.com"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          keyboardType="email-address"
          textContentType="username"
          returnKeyType="send"
          onSubmitEditing={submit}
        />
      </Section>
      <View style={styles.actions}>
        <ErrorText error={error} />
        <Button title="Send Code" onPress={submit} loading={busy} disabled={!email.trim()} />
        <LinkButton label="Back to sign in" onPress={() => go('signIn', email.trim())} />
      </View>
    </Screen>
  );
}

function ResetPassword({ email, onClose, onBack }: { email: string; onClose: () => void; onBack: () => void }) {
  const { resetPassword } = useAuth();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, run } = useAction();
  const submit = () =>
    run(async () => {
      await resetPassword(email, code, password);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Password updated', "You're signed in with your new password.");
    });
  return (
    <Screen title="Reset Password" onClose={onClose}>
      <Intro
        title="Enter your code"
        text={`If ${email} has an account, we sent it a code. Enter it with your new password.`}
      />
      <CodeField value={code} onChange={setCode} onSubmit={() => {}} />
      <Section footer="Use at least 8 characters.">
        <PasswordField
          label="New password"
          placeholder="8+ characters"
          value={password}
          onChangeText={setPassword}
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={submit}
        />
      </Section>
      <View style={styles.actions}>
        <ErrorText error={error} />
        <Button
          title="Save New Password"
          onPress={submit}
          loading={busy}
          disabled={code.length < 6 || password.length < 8}
        />
        <LinkButton label="Send a new code" onPress={onBack} />
      </View>
    </Screen>
  );
}

// ---------- after signing in ----------

function UsernameField({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.at, { color: theme.muted }]}>@</Text>
      <TextInput
        value={value}
        onChangeText={(t) => onChange(t.replace(/[^A-Za-z0-9_.]/g, '').slice(0, 20))}
        placeholder="username"
        placeholderTextColor={theme.muted}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={onSubmit}
        style={[styles.fieldInput, { color: theme.text }]}
        accessibilityLabel="Username"
      />
    </View>
  );
}

function ChooseUsername({ onClose }: { onClose: () => void }) {
  const { updateProfile, signOut } = useAuth();
  const theme = useTheme();
  const [username, setUsername] = useState('');
  const { busy, error, run } = useAction();
  const submit = () => run(() => updateProfile({ username }));
  return (
    <Screen title="Choose Username" onClose={onClose}>
      <Intro title="Pick a username" text="This is the name people see on your reviews. You can change it later." />
      <Section footer="3–20 letters, numbers, underscores or dots.">
        <UsernameField value={username} onChange={setUsername} onSubmit={submit} />
      </Section>
      <View style={styles.actions}>
        <ErrorText error={error} />
        <Button title="Continue" onPress={submit} loading={busy} disabled={username.length < 3} />
        <LinkButton label="Sign out" onPress={signOut} color={theme.textSecondary} />
      </View>
    </Screen>
  );
}

async function pickPhoto(source: 'library' | 'camera'): Promise<string | null> {
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
  };
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera access needed', 'Allow camera access in Settings to take a profile picture.');
      return null;
    }
  }
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets[0]) return null;
  // Shrink to a small square JPEG before uploading.
  const image = await ImageManipulator.ImageManipulator.manipulate(result.assets[0].uri)
    .resize({ width: 320 })
    .renderAsync();
  const saved = await image.saveAsync({ format: ImageManipulator.SaveFormat.JPEG, compress: 0.8, base64: true });
  return saved.base64 ?? null;
}

function Profile({ onClose, onOpenRestroom }: { onClose: () => void; onOpenRestroom?: (id: string) => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const { blocked, unblock } = useBlocked();
  const user = auth.user!;
  const [reviews, setReviews] = useState<MyReview[] | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [username, setUsername] = useState(user.username ?? '');
  const [changingPassword, setChangingPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [closetOpen, setClosetOpen] = useState(false);
  const { busy, error, setError, run } = useAction();

  const loadReviews = useCallback(() => {
    api.myReviews().then(setReviews, () => setReviews([]));
  }, []);
  useEffect(loadReviews, [loadReviews]);

  const changePhoto = () => {
    const choices = ['Choose from Library', 'Take Photo', ...(user.avatarUrl ? ['Remove Photo'] : [])];
    const handle = (i: number) => {
      if (i === 0 || i === 1) {
        run(async () => {
          const base64 = await pickPhoto(i === 0 ? 'library' : 'camera');
          if (base64) await auth.setAvatar(base64);
        });
      } else if (i === 2) run(auth.removeAvatar);
    };
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...choices, 'Cancel'],
          cancelButtonIndex: choices.length,
          destructiveButtonIndex: user.avatarUrl ? 2 : undefined,
        },
        handle,
      );
    } else {
      Alert.alert('Profile picture', undefined, [
        ...choices.map((text, i) => ({
          text,
          onPress: () => handle(i),
          style: (i === 2 ? 'destructive' : 'default') as 'destructive' | 'default',
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    }
  };

  const deleteReview = (r: MyReview) =>
    Alert.alert('Delete this review?', `Your review of ${r.restroomName} will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          run(async () => {
            await api.deleteReview(r.id);
            setReviews((list) => list?.filter((x) => x.id !== r.id) ?? null);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }),
      },
    ]);

  const confirmDeleteAccount = () =>
    Alert.alert(
      'Delete your account?',
      'This permanently deletes your account and profile picture. Your reviews stay on ToiletTime without your name.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Account',
          style: 'destructive',
          onPress: () =>
            run(async () => {
              await auth.deleteAccount();
              onClose();
            }),
        },
      ],
    );

  const since = new Date(user.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const color = user.markerColor ?? CHARACTER_COLORS[0];

  return (
    <>
      <SheetHeader title="Profile" right={{ label: 'Done', onPress: onClose, bold: true }} />
      <ScrollView
        contentContainerStyle={{ paddingTop: 24, paddingBottom: insets.bottom + 32 }}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <View style={styles.profileTop}>
          <Pressable onPress={changePhoto} accessibilityRole="button" accessibilityLabel="Change profile picture">
            <Avatar url={user.avatarUrl} name={user.username} size={96} color={user.avatarUrl ? null : color} />
            <View style={[styles.cameraBadge, { backgroundColor: theme.brand, borderColor: theme.background }]}>
              <Icon name="camera.fill" size={14} color={theme.onBrand} />
            </View>
          </Pressable>
          <Text style={[styles.profileName, { color: theme.text }]}>@{user.username}</Text>
          <View style={styles.emailRow}>
            <Text style={[styles.sub, { color: theme.muted, marginTop: 0 }]}>{user.email}</Text>
            {user.emailVerified && <Icon name="checkmark.seal.fill" size={14} color="#1d7a5c" />}
          </View>
          <Text style={[styles.since, { color: theme.muted }]}>Member since {since}</Text>
        </View>

        {error && (
          <View style={styles.actions}>
            <ErrorText error={error} />
          </View>
        )}

        <Section title="Username">
          {editingName ? (
            <>
              <UsernameField value={username} onChange={setUsername} onSubmit={() => {}} />
              <Separator />
              <View style={styles.inlineActions}>
                <LinkButton
                  label="Cancel"
                  color={theme.textSecondary}
                  onPress={() => {
                    setEditingName(false);
                    setUsername(user.username ?? '');
                    setError(null);
                  }}
                />
                <LinkButton
                  label={busy ? 'Saving…' : 'Save'}
                  onPress={() =>
                    run(async () => {
                      await auth.updateProfile({ username });
                      setEditingName(false);
                    })
                  }
                />
              </View>
            </>
          ) : (
            <Row label={`@${user.username}`} action="Change" onPress={() => setEditingName(true)} />
          )}
        </Section>

        <Section title="Your character" footer="This is you on the map. Rate restrooms you visit to unlock new hats, outfits and extras.">
          <Pressable
            onPress={() => setClosetOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Open your closet"
            style={({ pressed }) => [styles.buddy, { opacity: pressed ? 0.7 : 1 }]}
          >
            <View style={[styles.buddyStage, { backgroundColor: theme.brandSoft }]}>
              <Character character={user.character} height={96} />
            </View>
            <View style={styles.flex}>
              <LevelProgress user={user} />
            </View>
          </Pressable>
          <Separator />
          <Row label="Open Closet" action="Customize" onPress={() => setClosetOpen(true)} />
        </Section>
        <ClosetSheet visible={closetOpen} onClose={() => setClosetOpen(false)} />

        <Section title={`My reviews${reviews ? ` (${reviews.length})` : ''}`}>
          {reviews === null ? (
            <View style={styles.row}>
              <ActivityIndicator />
            </View>
          ) : reviews.length === 0 ? (
            <View style={styles.row}>
              <Text style={[styles.rowText, { color: theme.muted }]}>You haven&apos;t reviewed any restrooms yet.</Text>
            </View>
          ) : (
            reviews.map((r, i) => (
              <View key={r.id}>
                {i > 0 && <Separator />}
                <View style={styles.reviewRow}>
                  <Pressable
                    style={styles.flex}
                    disabled={!onOpenRestroom}
                    onPress={() => onOpenRestroom?.(r.restroomId)}
                    accessibilityRole={onOpenRestroom ? 'button' : undefined}
                  >
                    <Text style={[styles.reviewName, { color: theme.text }]} numberOfLines={1}>
                      {r.restroomName}
                    </Text>
                    <View style={styles.reviewMeta}>
                      <Stars value={r.overall} />
                      <Text style={[styles.small, { color: theme.muted }]}>
                        {new Date(r.createdAt).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </Text>
                    </View>
                    {!!r.comment && (
                      <Text style={[styles.small, { color: theme.textSecondary }]} numberOfLines={2}>
                        {r.comment}
                      </Text>
                    )}
                    {r.hidden && (
                      <Text style={[styles.small, { color: theme.danger, marginTop: 2 }]}>
                        Hidden after reports. Edit it to post it again, or contact support.
                      </Text>
                    )}
                  </Pressable>
                  <Pressable
                    onPress={() => deleteReview(r)}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete review of ${r.restroomName}`}
                  >
                    <Icon name="trash" size={18} color={theme.danger} />
                  </Pressable>
                </View>
              </View>
            ))
          )}
        </Section>

        {blocked.length > 0 && (
          <Section title="Hidden people" footer="You don't see reviews from these people. Only you can see this list.">
            {blocked.map((b, i) => (
              <View key={b.id}>
                {i > 0 && <Separator />}
                <Row label={b.username} action="Show again" onPress={() => unblock(b.id)} />
              </View>
            ))}
          </Section>
        )}

        <Section title="About & help">
          <Row label="Terms of Service" onPress={() => openLegal('terms')} chevron />
          <Separator />
          <Row label="Privacy Policy" onPress={() => openLegal('privacy')} chevron />
          <Separator />
          <Row label="Contact support" onPress={() => contactSupport(auth.contactEmail)} chevron />
        </Section>

        <Section title="Account">
          {changingPassword ? (
            <>
              <PasswordField
                label="New password"
                placeholder="8+ characters"
                value={newPassword}
                onChangeText={setNewPassword}
                autoComplete="new-password"
                textContentType="newPassword"
                autoFocus
              />
              <Separator />
              <View style={styles.inlineActions}>
                <LinkButton
                  label="Cancel"
                  color={theme.textSecondary}
                  onPress={() => {
                    setChangingPassword(false);
                    setNewPassword('');
                    setError(null);
                  }}
                />
                <LinkButton
                  label={busy ? 'Saving…' : 'Save'}
                  onPress={() =>
                    newPassword.length >= 8
                      ? run(async () => {
                          await auth.changePassword(newPassword);
                          setChangingPassword(false);
                          setNewPassword('');
                          Alert.alert('Password changed');
                        })
                      : setError('Use at least 8 characters.')
                  }
                />
              </View>
            </>
          ) : (
            <Row label="Change password" onPress={() => setChangingPassword(true)} chevron />
          )}
          <Separator />
          <Row label="Sign out" onPress={() => run(auth.signOut)} color={theme.brand} />
        </Section>
        <Section footer="Deleting your account can't be undone.">
          <Row label="Delete account" onPress={confirmDeleteAccount} color={theme.danger} />
        </Section>
      </ScrollView>
    </>
  );
}

function Row({
  label,
  action,
  onPress,
  color,
  chevron,
}: {
  label: string;
  action?: string;
  onPress: () => void;
  color?: string;
  chevron?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.surfaceAlt }]}
    >
      <Text style={[styles.rowText, styles.flex, { color: color ?? theme.text }]}>{label}</Text>
      {action && <Text style={[styles.rowText, { color: theme.brand }]}>{action}</Text>}
      {chevron && <Icon name="chevron.right" size={13} color={theme.muted} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  intro: { marginHorizontal: 32, marginBottom: 24 },
  lead: { fontSize: 28, fontWeight: '700', letterSpacing: -0.4 },
  sub: { fontSize: 15, lineHeight: 21, marginTop: 6 },
  error: { fontSize: 15, textAlign: 'center' },
  note: { fontSize: 15, textAlign: 'center' },
  link: { fontSize: 15, fontWeight: '600' },
  actions: { marginHorizontal: 16, gap: 14 },
  switchText: { fontSize: 15, textAlign: 'center', marginTop: 8, marginBottom: -8 },
  social: { marginHorizontal: 16, gap: 10, marginBottom: 20 },
  appleButton: { height: 50 },
  googleButton: {
    height: 50,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth * 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  googleG: { fontSize: 19, fontWeight: '800', color: '#4285F4' },
  googleText: { fontSize: 17, fontWeight: '600' },
  legalNote: { fontSize: 12, lineHeight: 17, textAlign: 'center', marginTop: 2 },
  agree: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 4 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  agreeText: { flex: 1, fontSize: 14, lineHeight: 20 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth },
  dividerText: { fontSize: 13 },
  badge: { alignItems: 'center', marginBottom: 12 },
  codeBox: { marginHorizontal: 16, borderRadius: 12, marginBottom: 20 },
  codeInput: {
    fontSize: 32,
    fontWeight: '600',
    letterSpacing: 10,
    textAlign: 'center',
    paddingVertical: 14,
    fontVariant: ['tabular-nums'],
  },
  field: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, minHeight: 46 },
  fieldInput: { flex: 1, fontSize: 17, paddingVertical: 12 },
  at: { fontSize: 17, marginRight: 2 },
  profileTop: { alignItems: 'center', marginBottom: 24, gap: 4 },
  cameraBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileName: { fontSize: 22, fontWeight: '700', marginTop: 10 },
  emailRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  since: { fontSize: 13 },
  inlineActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 24,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  buddy: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14 },
  buddyStage: { borderRadius: 14, paddingHorizontal: 10, paddingTop: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, minHeight: 46 },
  rowText: { fontSize: 17 },
  reviewRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  reviewName: { fontSize: 16, fontWeight: '600' },
  reviewMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3, marginBottom: 3 },
  small: { fontSize: 13 },
});
