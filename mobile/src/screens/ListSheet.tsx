import { useMemo, useState } from 'react';
import { FlatList, Modal, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RestroomRow } from '../components/RestroomRow';
import { Chip, Icon, Separator, SheetHeader } from '../components/ui';
import { distanceMeters } from '../geo';
import { plural, useTheme } from '../theme';
import { PLACE_TYPES, type LatLng, type PlaceType, type Restroom } from '../types';

type Sort = 'nearest' | 'rating' | 'reviews' | 'newest';
const SORTS: [Sort, string][] = [
  ['nearest', 'Nearest'],
  ['rating', 'Top rated'],
  ['reviews', 'Most reviewed'],
  ['newest', 'Newest'],
];

interface Props {
  visible: boolean;
  restrooms: Restroom[];
  origin: LatLng | null;
  focusSearch: boolean;
  onClose: () => void;
  onDismiss: () => void;
  onSelect: (id: string) => void;
}

export function ListSheet({ visible, restrooms, origin, focusSearch, onClose, onDismiss, onSelect }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [type, setType] = useState<PlaceType | null>(null);
  const [sort, setSort] = useState<Sort>(origin ? 'nearest' : 'rating');
  const activeSort = sort === 'nearest' && !origin ? 'rating' : sort;

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = restrooms.filter(
      (r) =>
        (!type || r.type === type) &&
        (!q || [r.name, r.address, r.city, r.country].join(' ').toLowerCase().includes(q)),
    );
    const dist = (r: Restroom) => (origin ? distanceMeters(origin, { latitude: r.lat, longitude: r.lng }) : 0);
    const sorters: Record<Sort, (a: Restroom, b: Restroom) => number> = {
      nearest: (a, b) => dist(a) - dist(b),
      rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || b.reviewCount - a.reviewCount,
      reviews: (a, b) => b.reviewCount - a.reviewCount,
      newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
    };
    return list.sort(sorters[activeSort]);
  }, [restrooms, query, type, activeSort, origin]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      onDismiss={onDismiss}
    >
      <View style={[styles.container, { backgroundColor: theme.surface }]}>
        <SheetHeader title="Restrooms" right={{ label: 'Done', onPress: onClose, bold: true }} />

        <View style={styles.controls}>
          <View style={[styles.search, { backgroundColor: theme.surfaceAlt }]}>
            <Icon name="magnifyingglass" size={16} color={theme.muted} />
            <TextInput
              autoFocus={focusSearch}
              value={query}
              onChangeText={setQuery}
              placeholder="Name, city or country"
              placeholderTextColor={theme.muted}
              clearButtonMode="while-editing"
              returnKeyType="search"
              style={[styles.searchInput, { color: theme.text }]}
            />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {SORTS.filter(([s]) => s !== 'nearest' || origin).map(([s, label]) => (
              <Chip key={s} label={label} selected={activeSort === s} onPress={() => setSort(s)} />
            ))}
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            <Chip label="All types" selected={!type} onPress={() => setType(null)} />
            {(Object.keys(PLACE_TYPES) as PlaceType[]).map((t) => (
              <Chip
                key={t}
                label={PLACE_TYPES[t]}
                selected={type === t}
                onPress={() => setType(type === t ? null : t)}
              />
            ))}
          </ScrollView>
          <Text style={[styles.count, { color: theme.muted }]}>{plural(results.length, 'restroom')}</Text>
        </View>
        <Separator inset={0} />

        <FlatList
          data={results}
          keyExtractor={(r) => r.id}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          ItemSeparatorComponent={() => <Separator />}
          contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
          renderItem={({ item }) => <RestroomRow item={item} origin={origin} onPress={() => onSelect(item.id)} />}
          ListEmptyComponent={
            <Text style={[styles.empty, { color: theme.muted }]}>No restrooms match your filters.</Text>
          }
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  controls: { paddingTop: 12, gap: 10 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    paddingHorizontal: 10,
    height: 38,
    borderRadius: 10,
  },
  searchInput: { flex: 1, fontSize: 17 },
  chips: { gap: 8, paddingHorizontal: 16 },
  count: { fontSize: 13, paddingHorizontal: 16, paddingBottom: 8 },
  empty: { textAlign: 'center', padding: 40, fontSize: 15 },
});
