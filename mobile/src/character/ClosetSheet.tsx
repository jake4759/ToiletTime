import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '../api';
import { useAuth } from '../auth';
import { Chip, Icon, SheetHeader } from '../components/ui';
import { plural, useTheme } from '../theme';
import type { CharacterCatalog, ClosetItem, User } from '../types';
import { Character } from './Character';
import { DEFAULT_CHARACTER, type CharacterConfig } from './draw';

const COLOR_KEY: Record<string, keyof CharacterConfig> = {
  hair: 'hairColor',
  top: 'topColor',
  bottom: 'bottomColor',
};

const itemList = (names: string[]) =>
  names.length > 2 ? `${names.slice(0, 2).join(', ')} and ${names.length - 2} more` : names.join(' and ');

/** Your level, reviews so far and what you'll unlock next. */
export function LevelProgress({ user }: { user: User }) {
  const theme = useTheme();
  const next = user.nextUnlock;
  const fraction = next ? Math.min(user.reviewCount / next.at, 1) : 1;
  const toGo = next ? next.at - user.reviewCount : 0;
  return (
    <View>
      <View style={styles.levelRow}>
        <View style={[styles.levelBadge, { backgroundColor: theme.brand }]}>
          <Icon name="sparkles" size={12} color={theme.onBrand} />
          <Text style={[styles.levelText, { color: theme.onBrand }]}>{user.level.name}</Text>
        </View>
        <Text style={[styles.count, { color: theme.textSecondary }]}>
          {plural(user.reviewCount, 'restroom')} reviewed
        </Text>
      </View>
      <View style={[styles.track, { backgroundColor: theme.surfaceAlt }]}>
        <View style={[styles.fill, { backgroundColor: theme.star, width: `${Math.max(fraction * 100, 4)}%` }]} />
      </View>
      <Text style={[styles.goal, { color: theme.muted }]}>
        {next
          ? `Review ${plural(toGo, 'more restroom')} to unlock ${itemList(next.items.map((i) => i.name))}`
          : 'You’ve unlocked everything. Royal Flush status!'}
      </Text>
    </View>
  );
}

export function ClosetSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { user } = useAuth();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible && user && <Closet user={user} onClose={onClose} />}
    </Modal>
  );
}

function Closet({ user, onClose }: { user: User; onClose: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { updateProfile } = useAuth();
  const [catalog, setCatalog] = useState<CharacterCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<CharacterConfig>({ ...DEFAULT_CHARACTER, ...user.character });
  const [slot, setSlot] = useState('hat');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.characterCatalog().then(
      (c) => !cancelled && setCatalog(c),
      (e: Error) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const changed = useMemo(
    () => (Object.keys(draft) as (keyof CharacterConfig)[]).some((k) => draft[k] !== user.character?.[k]),
    [draft, user.character],
  );

  const save = async () => {
    setSaving(true);
    try {
      await updateProfile({ character: draft });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
    } catch (e) {
      Alert.alert("Couldn't save your outfit", (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const pick = (item: ClosetItem) => {
    if (item.unlock > user.reviewCount) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      const toGo = item.unlock - user.reviewCount;
      Alert.alert(
        `${item.name} is locked`,
        `Review ${plural(item.unlock, 'restroom')} to unlock it. Just ${toGo} more to go!\n\n` +
          'You can rate restrooms you’ve visited in the last 24 hours.',
      );
      return;
    }
    Haptics.selectionAsync();
    setDraft((d) => ({ ...d, [slot]: item.id }));
  };

  const current = catalog?.slots[slot];
  const palette = catalog && current?.color ? catalog.colors[current.color] : null;
  const colorKey = COLOR_KEY[slot];
  const columns = width > 500 ? 5 : 3;
  const tile = (Math.min(width, 700) - 32 - (columns - 1) * 10) / columns;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <SheetHeader
        title="Closet"
        left={{ label: 'Cancel', onPress: onClose }}
        right={{ label: 'Save', onPress: save, bold: true, disabled: !changed, loading: saving }}
      />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
        <View style={[styles.stage, { backgroundColor: theme.brandSoft }]}>
          <Character character={draft} height={210} />
        </View>
        <View style={[styles.card, { backgroundColor: theme.surface }]}>
          <LevelProgress user={user} />
        </View>

        {!catalog ? (
          <View style={styles.loading}>
            {error ? <Text style={{ color: theme.danger }}>{error}</Text> : <ActivityIndicator />}
          </View>
        ) : (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
              {Object.entries(catalog.slots).map(([key, s]) => (
                <Chip key={key} label={s.label} selected={key === slot} onPress={() => setSlot(key)} />
              ))}
            </ScrollView>

            {palette && colorKey && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.swatches}>
                {palette.map((c) => {
                  const selected = draft[colorKey] === c;
                  return (
                    <Pressable
                      key={c}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setDraft((d) => ({ ...d, [colorKey]: c }));
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Color ${c}`}
                      accessibilityState={{ selected }}
                      style={[
                        styles.swatch,
                        { backgroundColor: c, borderColor: selected ? theme.text : theme.separator },
                      ]}
                    >
                      {selected && <Icon name="checkmark" size={14} color={c === '#f8fafc' || c === '#f4f1ea' ? '#111' : '#fff'} />}
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}

            <View style={styles.grid}>
              {current?.items.map((item) => {
                const locked = item.unlock > user.reviewCount;
                const selected = draft[slot as keyof CharacterConfig] === item.id;
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => pick(item)}
                    accessibilityRole="button"
                    accessibilityLabel={locked ? `${item.name}, locked` : item.name}
                    accessibilityState={{ selected }}
                    style={({ pressed }) => [
                      styles.tile,
                      {
                        width: tile,
                        backgroundColor: theme.surface,
                        borderColor: selected ? theme.brand : 'transparent',
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <View style={{ opacity: locked ? 0.35 : 1 }}>
                      <Character
                        // Show hairstyles without a hat covering them.
                        character={{ ...draft, [slot]: item.id, ...(slot === 'hair' ? { hat: 'none' } : {}) }}
                        height={tile * 0.95}
                      />
                    </View>
                    <Text style={[styles.itemName, { color: theme.text }]} numberOfLines={1}>
                      {item.name}
                    </Text>
                    {locked ? (
                      <View style={[styles.lock, { backgroundColor: theme.text }]}>
                        <Icon name="lock.fill" size={10} color={theme.background} />
                        <Text style={[styles.lockText, { color: theme.background }]}>{item.unlock}</Text>
                      </View>
                    ) : (
                      selected && (
                        <View style={[styles.lock, { backgroundColor: theme.brand }]}>
                          <Icon name="checkmark" size={10} color={theme.onBrand} />
                        </View>
                      )
                    )}
                  </Pressable>
                );
              })}
            </View>
            <Text style={[styles.footer, { color: theme.muted }]}>
              Unlock new hats, outfits and extras by rating restrooms you’ve visited. The number on a lock is how many
              restrooms you need to have reviewed.
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  stage: { alignItems: 'center', paddingTop: 20, paddingBottom: 8, marginBottom: 12 },
  card: { marginHorizontal: 16, borderRadius: 12, padding: 14 },
  levelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  levelBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  levelText: { fontSize: 13, fontWeight: '700' },
  count: { fontSize: 13, fontWeight: '500' },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  goal: { fontSize: 13, marginTop: 8, lineHeight: 18 },
  loading: { padding: 40, alignItems: 'center' },
  tabs: { gap: 8, paddingHorizontal: 16, paddingTop: 18, paddingBottom: 6 },
  swatches: { gap: 10, paddingHorizontal: 16, paddingVertical: 10 },
  swatch: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 16, paddingTop: 8 },
  tile: { borderRadius: 14, borderWidth: 2, alignItems: 'center', paddingTop: 8, paddingBottom: 10 },
  itemName: { fontSize: 13, fontWeight: '600', marginTop: 4, paddingHorizontal: 6 },
  lock: {
    position: 'absolute',
    top: 6,
    right: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    height: 20,
    minWidth: 20,
    justifyContent: 'center',
    borderRadius: 10,
  },
  lockText: { fontSize: 11, fontWeight: '700' },
  footer: { fontSize: 13, lineHeight: 18, paddingHorizontal: 20, paddingTop: 16 },
});
