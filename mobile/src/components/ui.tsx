import * as Haptics from 'expo-haptics';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useState, type ReactNode, type Ref } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { API_URL } from '../api';
import { formatRating, ratingColor, useTheme } from '../theme';

/** An SF Symbol name (iOS). Android draws the matching Material Symbol from ANDROID_ICONS. */
export type SymbolName = Extract<SymbolViewProps['name'], string>;

const ANDROID_ICONS: Partial<Record<SymbolName, AndroidName>> = {
  magnifyingglass: 'search',
  'location.fill': 'near_me',
  plus: 'add',
  'list.bullet': 'format_list_bulleted',
  'person.crop.circle': 'account_circle',
  'person.fill': 'person',
  'star.fill': 'star',
  checkmark: 'check',
  'checkmark.circle.fill': 'check_circle',
  'xmark.circle': 'cancel',
  'chevron.right': 'chevron_right',
  'wifi.exclamationmark': 'wifi_off',
  'arrow.triangle.turn.up.right.diamond.fill': 'directions',
  'square.and.pencil': 'rate_review',
  'toilet.fill': 'wc',
  'fork.knife': 'restaurant',
  'cup.and.saucer.fill': 'local_cafe',
  'bag.fill': 'shopping_bag',
  'building.2.fill': 'storefront',
  'fuelpump.fill': 'local_gas_station',
  'wineglass.fill': 'local_bar',
  'bed.double.fill': 'hotel',
  mappin: 'place',
  'camera.fill': 'photo_camera',
  trash: 'delete',
  envelope: 'mail',
  'lock.fill': 'lock',
  'checkmark.seal.fill': 'verified',
  pencil: 'edit',
  eye: 'visibility',
  ellipsis: 'more_horiz',
  'doc.text': 'description',
  'hand.raised': 'pan_tool',
  questionmark: 'help',
  'eye.slash': 'visibility_off',
  photo: 'image',
  'rectangle.portrait.and.arrow.right': 'logout',
  paintpalette: 'palette',
  'envelope.badge': 'mark_email_read',
};
type AndroidName = Extract<Exclude<SymbolViewProps['name'], string>['android'], string>;

const symbol = (name: SymbolName): SymbolViewProps['name'] => ({ ios: name, android: ANDROID_ICONS[name] ?? 'circle' });

export function Icon({ name, size = 17, color }: { name: SymbolName; size?: number; color?: string }) {
  const theme = useTheme();
  return <SymbolView name={symbol(name)} size={size} tintColor={color ?? theme.text} weight="medium" />;
}

export function Stars({ value, size = 12 }: { value: number | null; size?: number }) {
  const theme = useTheme();
  const filled = value == null ? 0 : Math.round(value);
  return (
    <View style={styles.row} accessibilityLabel={value == null ? 'No rating' : `${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <SymbolView
          key={n}
          name={symbol('star.fill')}
          size={size}
          tintColor={n <= filled ? theme.star : theme.starOff}
        />
      ))}
    </View>
  );
}

export function StarInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const theme = useTheme();
  return (
    <View style={styles.starInput}>
      <Text style={[styles.body, { color: theme.text }]}>{label}</Text>
      <View style={styles.row} accessibilityRole="adjustable" accessibilityLabel={`${label}, ${value} of 5`}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable
            key={n}
            hitSlop={4}
            onPress={() => {
              Haptics.selectionAsync();
              onChange(n);
            }}
            style={styles.starButton}
          >
            <SymbolView name={symbol('star.fill')} size={26} tintColor={n <= value ? theme.star : theme.starOff} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function ScorePill({ rating, large }: { rating: number | null; large?: boolean }) {
  return (
    <View style={[styles.pill, large && styles.pillLarge, { backgroundColor: ratingColor(rating) }]}>
      <Text style={[styles.pillText, large && styles.pillTextLarge]}>{formatRating(rating)}</Text>
    </View>
  );
}

export function Button({
  title,
  onPress,
  icon,
  variant = 'primary',
  loading,
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  icon?: SymbolName;
  variant?: 'primary' | 'secondary' | 'plain';
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const bg = variant === 'primary' ? theme.brand : variant === 'secondary' ? theme.surfaceAlt : 'transparent';
  const fg = variant === 'primary' ? theme.onBrand : variant === 'secondary' ? theme.text : theme.brand;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.75 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon && <Icon name={icon} size={16} color={fg} />}
          <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? theme.brand : theme.surface,
          borderColor: selected ? theme.brand : theme.separator,
        },
      ]}
    >
      <Text style={[styles.chipText, { color: selected ? theme.onBrand : theme.text }]}>{label}</Text>
    </Pressable>
  );
}

/** iOS-style inset grouped section. */
export function Section({ title, footer, children }: { title?: string; footer?: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      {title && <Text style={[styles.sectionTitle, { color: theme.muted }]}>{title.toUpperCase()}</Text>}
      <View style={[styles.sectionBody, { backgroundColor: theme.surface }]}>{children}</View>
      {footer && <Text style={[styles.sectionFooter, { color: theme.muted }]}>{footer}</Text>}
    </View>
  );
}

export function Separator({ inset = 16 }: { inset?: number }) {
  const theme = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.separator, marginLeft: inset }} />;
}

export function Field({ label, ref, ...props }: TextInputProps & { label: string; ref?: Ref<TextInput> }) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: theme.text }]}>{label}</Text>
      <TextInput
        ref={ref}
        placeholderTextColor={theme.muted}
        style={[styles.fieldInput, { color: theme.text }]}
        {...props}
      />
    </View>
  );
}

/** Top bar for page sheets: left action, centered title, right action. */
export function SheetHeader({
  title,
  left,
  right,
}: {
  title?: string;
  left?: { label: string; onPress: () => void };
  right?: { label: string; onPress: () => void; disabled?: boolean; bold?: boolean; loading?: boolean };
}) {
  const theme = useTheme();
  return (
    <View style={[styles.sheetHeader, { borderBottomColor: theme.separator }]}>
      <View style={styles.sheetSide}>
        {left && (
          <Pressable onPress={left.onPress} hitSlop={10}>
            <Text style={[styles.headerAction, { color: theme.brand }]}>{left.label}</Text>
          </Pressable>
        )}
      </View>
      <Text style={[styles.sheetTitle, { color: theme.text }]} numberOfLines={1}>
        {title}
      </Text>
      <View style={[styles.sheetSide, { alignItems: 'flex-end' }]}>
        {right &&
          (right.loading ? (
            <ActivityIndicator color={theme.brand} />
          ) : (
            <Pressable onPress={right.onPress} disabled={right.disabled} hitSlop={10}>
              <Text
                style={[
                  styles.headerAction,
                  { color: theme.brand, opacity: right.disabled ? 0.4 : 1, fontWeight: right.bold ? '600' : '400' },
                ]}
              >
                {right.label}
              </Text>
            </Pressable>
          ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  body: { fontSize: 17 },
  starInput: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  starButton: { paddingHorizontal: 2 },
  pill: {
    minWidth: 40,
    height: 26,
    paddingHorizontal: 7,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillLarge: { minWidth: 56, height: 36, borderRadius: 9 },
  pillText: { color: '#fff', fontWeight: '700', fontSize: 14, fontVariant: ['tabular-nums'] },
  pillTextLarge: { fontSize: 18 },
  button: {
    height: 50,
    borderRadius: 14,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  buttonText: { fontSize: 17, fontWeight: '600' },
  chip: { paddingHorizontal: 14, height: 34, borderRadius: 17, borderWidth: 1, justifyContent: 'center' },
  chipText: { fontSize: 15, fontWeight: '500' },
  section: { marginHorizontal: 16, marginBottom: 24 },
  sectionTitle: { fontSize: 13, marginLeft: 16, marginBottom: 7 },
  sectionBody: { borderRadius: 12, overflow: 'hidden' },
  sectionFooter: { fontSize: 13, marginHorizontal: 16, marginTop: 7, lineHeight: 18 },
  field: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, minHeight: 46, gap: 8 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  fieldLabel: { fontSize: 17, width: 96 },
  fieldInput: { flex: 1, fontSize: 17, paddingVertical: 12 },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 56,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetSide: { width: 90 },
  sheetTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600' },
  headerAction: { fontSize: 17 },
});

/** A profile picture, or the person's initial when they haven't set one. */
export function Avatar({
  url,
  name,
  size = 34,
  color,
}: {
  url?: string | null;
  name?: string | null;
  size?: number;
  color?: string | null;
}) {
  const theme = useTheme();
  const [failed, setFailed] = useState(false);
  const round = { width: size, height: size, borderRadius: size / 2 };
  if (url && !failed) {
    return (
      <Image
        source={{ uri: url.startsWith('http') ? url : `${API_URL}${url}` }}
        style={[round, { backgroundColor: theme.surfaceAlt }]}
        onError={() => setFailed(true)}
        accessibilityIgnoresInvertColors
      />
    );
  }
  const initial = (name ?? '')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 1)
    .toUpperCase();
  return (
    <View style={[round, styles.avatarFallback, { backgroundColor: color ?? theme.brandSoft }]}>
      {initial ? (
        <Text style={{ color: color ? '#fff' : theme.brand, fontWeight: '700', fontSize: size * 0.42 }}>{initial}</Text>
      ) : (
        <Icon name="person.fill" size={size * 0.5} color={color ? '#fff' : theme.brand} />
      )}
    </View>
  );
}

/** A password box with a show/hide button. */
export function PasswordField({ label, ref, ...props }: TextInputProps & { label: string; ref?: Ref<TextInput> }) {
  const theme = useTheme();
  const [visible, setVisible] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: theme.text }]}>{label}</Text>
      <TextInput
        ref={ref}
        placeholderTextColor={theme.muted}
        style={[styles.fieldInput, { color: theme.text }]}
        secureTextEntry={!visible}
        autoCapitalize="none"
        autoCorrect={false}
        {...props}
      />
      <Pressable
        onPress={() => setVisible((v) => !v)}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={visible ? 'Hide password' : 'Show password'}
      >
        <Icon name={visible ? 'eye.slash' : 'eye'} size={18} color={theme.muted} />
      </Pressable>
    </View>
  );
}
