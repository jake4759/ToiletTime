import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { StatusBar } from 'expo-status-bar';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { API_URL, api } from './src/api';
import { Button, Icon, ScorePill, Stars, type SymbolName } from './src/components/ui';
import { distanceMeters, formatDistance } from './src/geo';
import { AddSheet } from './src/screens/AddSheet';
import { DetailSheet } from './src/screens/DetailSheet';
import { ListSheet } from './src/screens/ListSheet';
import { formatRating, plural, ratingColor, useTheme } from './src/theme';
import { PLACE_TYPES, type LatLng, type Restroom } from './src/types';

const WORLD: Region = { latitude: 30, longitude: 0, latitudeDelta: 120, longitudeDelta: 180 };

export default function App() {
  return (
    <SafeAreaProvider>
      <MapScreen />
    </SafeAreaProvider>
  );
}

function MapScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);

  const [restrooms, setRestrooms] = useState<Restroom[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [list, setList] = useState<{ open: boolean; focusSearch: boolean }>({ open: false, focusSearch: false });
  const [detailId, setDetailId] = useState<string | null>(null);
  const [addCoords, setAddCoords] = useState<LatLng | null>(null);
  const pendingDetail = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRestrooms(await api.list());
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const pos = (await Location.getLastKnownPositionAsync()) ?? (await Location.getCurrentPositionAsync());
      const here = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      setUserLocation(here);
      mapRef.current?.animateToRegion({ ...here, latitudeDelta: 0.08, longitudeDelta: 0.08 }, 600);
    })().catch(() => {});
  }, [load]);

  const selected = useMemo(() => restrooms.find((r) => r.id === selectedId) ?? null, [restrooms, selectedId]);

  const focusOn = (r: Restroom) => {
    mapRef.current?.animateToRegion(
      { latitude: r.lat, longitude: r.lng, latitudeDelta: 0.02, longitudeDelta: 0.02 },
      400,
    );
  };

  const locateMe = async () => {
    Haptics.selectionAsync();
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;
    const pos = await Location.getCurrentPositionAsync();
    const here = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
    setUserLocation(here);
    mapRef.current?.animateToRegion({ ...here, latitudeDelta: 0.03, longitudeDelta: 0.03 }, 400);
  };

  const startAdd = async (coords?: LatLng) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (coords) return setAddCoords(coords);
    if (userLocation) return setAddCoords(userLocation);
    const camera = await mapRef.current?.getCamera();
    setAddCoords(camera?.center ?? { latitude: WORLD.latitude, longitude: WORLD.longitude });
  };

  return (
    <View style={styles.flex}>
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={WORLD}
        showsUserLocation={!!userLocation}
        showsPointsOfInterests={false}
        showsCompass={false}
        userInterfaceStyle={theme.dark ? 'dark' : 'light'}
        onPress={(e) => {
          if (e.nativeEvent.action !== 'marker-press') setSelectedId(null);
        }}
        onLongPress={(e) => startAdd(e.nativeEvent.coordinate)}
      >
        {restrooms.map((r) => (
          <RestroomPin
            key={r.id}
            restroom={r}
            selected={r.id === selectedId}
            onPress={() => {
              Haptics.selectionAsync();
              setSelectedId(r.id);
              focusOn(r);
            }}
          />
        ))}
      </MapView>

      {/* Top: search bar */}
      <View style={[styles.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <Pressable
          onPress={() => setList({ open: true, focusSearch: true })}
          style={[styles.searchBar, styles.shadow, { backgroundColor: theme.surface }]}
        >
          <Icon name="magnifyingglass" size={17} color={theme.muted} />
          <Text style={[styles.searchText, { color: theme.muted }]}>Search restrooms</Text>
          {loading ? (
            <ActivityIndicator />
          ) : (
            <Text style={[styles.count, { color: theme.muted }]}>{restrooms.length}</Text>
          )}
        </Pressable>

        {loadError && (
          <View style={[styles.banner, styles.shadow, { backgroundColor: theme.surface }]}>
            <Icon name="wifi.exclamationmark" size={20} color={theme.danger} />
            <View style={styles.flex}>
              <Text style={[styles.bannerTitle, { color: theme.text }]}>Not connected</Text>
              <Text style={[styles.bannerText, { color: theme.muted }]}>
                Couldn't reach {API_URL}. Make sure the server is running on the same Wi-Fi.
              </Text>
            </View>
            <Pressable onPress={load} hitSlop={10}>
              <Text style={[styles.bannerAction, { color: theme.brand }]}>Retry</Text>
            </Pressable>
          </View>
        )}
      </View>

      {/* Bottom: selected preview + actions */}
      <View style={[styles.bottom, { paddingBottom: insets.bottom + 12 }]} pointerEvents="box-none">
        {selected && <PreviewCard restroom={selected} origin={userLocation} onPress={() => setDetailId(selected.id)} />}
        <View style={styles.actionRow}>
          <RoundButton icon="list.bullet" label="List" onPress={() => setList({ open: true, focusSearch: false })} />
          <Button title="Add Restroom" icon="plus" onPress={() => startAdd()} style={[styles.flex, styles.shadow]} />
          <RoundButton icon="location.fill" label="My location" onPress={locateMe} />
        </View>
        {!selected && !loadError && (
          <View style={[styles.hint, { backgroundColor: theme.surface }]}>
            <Text style={[styles.hintText, { color: theme.textSecondary }]}>
              Touch and hold the map to add a restroom there
            </Text>
          </View>
        )}
      </View>

      <ListSheet
        visible={list.open}
        focusSearch={list.focusSearch}
        restrooms={restrooms}
        origin={userLocation}
        onClose={() => setList((l) => ({ ...l, open: false }))}
        onSelect={(id) => {
          pendingDetail.current = id;
          setList((l) => ({ ...l, open: false }));
        }}
        onDismiss={() => {
          // Present the detail sheet only once the list sheet has finished dismissing.
          const id = pendingDetail.current;
          pendingDetail.current = null;
          const r = restrooms.find((x) => x.id === id);
          if (!id || !r) return;
          setSelectedId(id);
          focusOn(r);
          setDetailId(id);
        }}
      />

      <DetailSheet id={detailId} origin={userLocation} onClose={() => setDetailId(null)} onChanged={load} />

      <AddSheet
        coords={addCoords}
        onClose={() => setAddCoords(null)}
        onCreated={(created) => {
          setAddCoords(null);
          load();
          setSelectedId(created.id);
          focusOn(created);
        }}
      />
    </View>
  );
}

const RestroomPin = memo(function RestroomPin({
  restroom,
  selected,
  onPress,
}: {
  restroom: Restroom;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Marker
      // Remount when selection or rating changes so the snapshot of the custom view refreshes.
      key={`${restroom.id}-${selected}-${restroom.rating}`}
      coordinate={{ latitude: restroom.lat, longitude: restroom.lng }}
      onPress={onPress}
      tracksViewChanges={false}
      anchor={{ x: 0.5, y: 0.5 }}
      zIndex={selected ? 10 : 1}
      accessibilityLabel={`${restroom.name}, rated ${formatRating(restroom.rating)}`}
    >
      <View style={[styles.pin, selected && styles.pinSelected, { backgroundColor: ratingColor(restroom.rating) }]}>
        <Text style={[styles.pinText, selected && styles.pinTextSelected]}>{formatRating(restroom.rating)}</Text>
      </View>
    </Marker>
  );
});

function PreviewCard({
  restroom,
  origin,
  onPress,
}: {
  restroom: Restroom;
  origin: LatLng | null;
  onPress: () => void;
}) {
  const theme = useTheme();
  const distance = origin
    ? formatDistance(distanceMeters(origin, { latitude: restroom.lat, longitude: restroom.lng }))
    : [restroom.city, restroom.country].filter(Boolean).join(', ');
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.preview,
        styles.shadow,
        { backgroundColor: theme.surface, opacity: pressed ? 0.9 : 1 },
      ]}
    >
      <View style={styles.flex}>
        <Text style={[styles.previewName, { color: theme.text }]} numberOfLines={1}>
          {restroom.name}
        </Text>
        <Text style={[styles.previewSub, { color: theme.muted }]} numberOfLines={1}>
          {[PLACE_TYPES[restroom.type], distance].filter(Boolean).join(' · ')}
        </Text>
        <View style={styles.previewRating}>
          <Stars value={restroom.rating} />
          <Text style={[styles.previewSub, { color: theme.muted }]}>{plural(restroom.reviewCount, 'review')}</Text>
        </View>
      </View>
      <ScorePill rating={restroom.rating} large />
      <Icon name="chevron.right" size={14} color={theme.muted} />
    </Pressable>
  );
}

function RoundButton({ icon, label, onPress }: { icon: SymbolName; label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.round,
        styles.shadow,
        { backgroundColor: theme.surface, opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <Icon name={icon} size={19} color={theme.brand} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  shadow: {
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  top: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: 16, gap: 10 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 50,
    borderRadius: 14,
    paddingHorizontal: 16,
  },
  searchText: { flex: 1, fontSize: 17 },
  count: { fontSize: 15, fontVariant: ['tabular-nums'] },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, padding: 14 },
  bannerTitle: { fontSize: 15, fontWeight: '600' },
  bannerText: { fontSize: 13, marginTop: 2 },
  bannerAction: { fontSize: 15, fontWeight: '600' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, gap: 10 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  round: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  hint: { alignSelf: 'center', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 5, opacity: 0.92 },
  hintText: { fontSize: 13, fontWeight: '500' },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, padding: 14 },
  previewName: { fontSize: 17, fontWeight: '600' },
  previewSub: { fontSize: 14, marginTop: 2 },
  previewRating: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  pin: {
    minWidth: 34,
    height: 34,
    borderRadius: 17,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  pinSelected: { minWidth: 44, height: 44, borderRadius: 22, borderWidth: 3 },
  pinText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  pinTextSelected: { fontSize: 15 },
});
