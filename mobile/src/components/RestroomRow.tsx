import { Pressable, StyleSheet, Text, View } from 'react-native';

import { distanceMeters, formatDistance } from '../geo';
import { plural, useTheme } from '../theme';
import { PLACE_TYPES, type LatLng, type Restroom } from '../types';
import { ScorePill, Stars } from './ui';

export function RestroomRow({ item, origin, onPress }: { item: Restroom; origin: LatLng | null; onPress: () => void }) {
  const theme = useTheme();
  const place = [item.city, item.country].filter(Boolean).join(', ');
  const distance = origin ? formatDistance(distanceMeters(origin, { latitude: item.lat, longitude: item.lng })) : null;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.surfaceAlt }]}
    >
      <View style={styles.text}>
        <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={[styles.sub, { color: theme.muted }]} numberOfLines={1}>
          {[PLACE_TYPES[item.type] ?? item.type, distance ?? place].filter(Boolean).join(' · ')}
        </Text>
        <View style={styles.ratingLine}>
          <Stars value={item.rating} />
          <Text style={[styles.sub, { color: theme.muted }]}>{plural(item.reviewCount, 'review')}</Text>
        </View>
      </View>
      <ScorePill rating={item.rating} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  text: { flex: 1, gap: 3 },
  name: { fontSize: 17, fontWeight: '600' },
  sub: { fontSize: 14 },
  ratingLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
