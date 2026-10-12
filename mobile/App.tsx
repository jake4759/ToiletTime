import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { StatusBar } from 'expo-status-bar';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { API_URL, IS_HOSTED_API, api } from './src/api';
import { AuthProvider, useAuth } from './src/auth';
import { Button, Icon, ScorePill, Stars, type SymbolName } from './src/components/ui';
import { distanceMeters, formatDistance } from './src/geo';
import { AccountSheet } from './src/screens/AccountSheet';
import { AddSheet, type AddRequest } from './src/screens/AddSheet';
import { DetailSheet } from './src/screens/DetailSheet';
import { ListSheet } from './src/screens/ListSheet';
import { formatRating, plural, ratingColor, useTheme } from './src/theme';
import { PLACE_TYPES, type LatLng, type Place, type PlaceType, type Restroom } from './src/types';

const WORLD: Region = { latitude: 30, longitude: 0, latitudeDelta: 120, longitudeDelta: 180 };
/** Nearby places load once the map is zoomed in at least this far (degrees of latitude on screen). */
const PLACES_MAX_DELTA = 0.1;

const TYPE_ICONS: Record<PlaceType, SymbolName> = {
  public: 'toilet.fill',
  restaurant: 'fork.knife',
  cafe: 'cup.and.saucer.fill',
  store: 'bag.fill',
  mall: 'building.2.fill',
  gas_station: 'fuelpump.fill',
  bar: 'wineglass.fill',
  hotel: 'bed.double.fill',
  other: 'mappin',
};

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <MapScreen />
      </AuthProvider>
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
  const [addRequest, setAddRequest] = useState<AddRequest | null>(null);
  const pendingDetail = useRef<string | null>(null);
  const { user } = useAuth();
  const [account, setAccount] = useState<{ open: boolean; reason: string | null }>({ open: false, reason: null });
  const addAfterSignIn = useRef<AddRequest | null>(null);

  const [places, setPlaces] = useState<Place[]>([]);
  const [zoomedOut, setZoomedOut] = useState(true);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const placesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const placesRequest = useRef(0);

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

  // Businesses and mapped restrooms that nobody has rated yet (rated ones show as restroom pins).
  const unratedPlaces = useMemo(() => {
    const rated = new Set(restrooms.map((r) => r.osmId).filter(Boolean));
    return places.filter((p) => !rated.has(p.osmId));
  }, [places, restrooms]);
  const selectedPlace = useMemo(
    () => unratedPlaces.find((p) => p.osmId === selectedPlaceId) ?? null,
    [unratedPlaces, selectedPlaceId],
  );

  const loadPlaces = (region: Region) => {
    if (placesTimer.current) clearTimeout(placesTimer.current);
    if (region.latitudeDelta > PLACES_MAX_DELTA) {
      setZoomedOut(true);
      return;
    }
    setZoomedOut(false);
    placesTimer.current = setTimeout(async () => {
      const half = (d: number) => Math.min(d / 2, 0.06);
      const bbox = {
        south: Math.max(-90, region.latitude - half(region.latitudeDelta)),
        north: Math.min(90, region.latitude + half(region.latitudeDelta)),
        west: Math.max(-180, region.longitude - half(region.longitudeDelta)),
        east: Math.min(180, region.longitude + half(region.longitudeDelta)),
      };
      const request = ++placesRequest.current;
      try {
        const result = await api.places(bbox);
        if (request !== placesRequest.current) return; // a newer map position already asked
        setPlaces((prev) => {
          // Keep places already on screen so pins don't flicker while panning.
          const byId = new Map(prev.map((p) => [p.osmId, p]));
          for (const p of result.places) byId.set(p.osmId, p);
          return [...byId.values()].slice(-800);
        });
      } catch {
        // Places are a bonus; rated restrooms still show if this fails.
      }
    }, 450);
  };

  const selectRestroom = (id: string | null) => {
    setSelectedId(id);
    if (id) setSelectedPlaceId(null);
  };

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

  const openAdd = (request: AddRequest) => {
    if (user) return setAddRequest(request);
    // Ask the user to sign in first, then continue to the add sheet.
    addAfterSignIn.current = request;
    setAccount({
      open: true,
      reason: request.place ? 'Sign in to rate this restroom.' : 'Sign in to add a restroom. It only takes a moment.',
    });
  };

  const startAdd = async (coords?: LatLng) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const camera = coords || userLocation ? null : await mapRef.current?.getCamera();
    const target = coords ?? userLocation ?? camera?.center ?? { latitude: WORLD.latitude, longitude: WORLD.longitude };
    openAdd({ coords: target });
  };

  const ratePlace = (place: Place) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    openAdd({ coords: { latitude: place.lat, longitude: place.lng }, place });
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
          if (e.nativeEvent.action === 'marker-press') return;
          setSelectedId(null);
          setSelectedPlaceId(null);
        }}
        onLongPress={(e) => startAdd(e.nativeEvent.coordinate)}
        onRegionChangeComplete={loadPlaces}
      >
        {unratedPlaces.map((p) => (
          <PlacePin
            key={p.osmId}
            place={p}
            selected={p.osmId === selectedPlaceId}
            onPress={() => {
              Haptics.selectionAsync();
              setSelectedPlaceId(p.osmId);
              setSelectedId(null);
            }}
          />
        ))}
        {restrooms.map((r) => (
          <RestroomPin
            key={r.id}
            restroom={r}
            selected={r.id === selectedId}
            onPress={() => {
              Haptics.selectionAsync();
              selectRestroom(r.id);
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
          <View style={[styles.divider, { backgroundColor: theme.separator }]} />
          <Pressable
            onPress={() => setAccount({ open: true, reason: null })}
            hitSlop={8}
            accessibilityLabel={user ? `Account, signed in as ${user.name}` : 'Sign in'}
          >
            {user ? (
              <View style={[styles.miniAvatar, { backgroundColor: theme.brandSoft }]}>
                <Text style={[styles.miniAvatarText, { color: theme.brand }]}>
                  {user.name.slice(0, 1).toUpperCase()}
                </Text>
              </View>
            ) : (
              <Icon name="person.crop.circle" size={26} color={theme.brand} />
            )}
          </Pressable>
        </Pressable>

        {loadError && (
          <View style={[styles.banner, styles.shadow, { backgroundColor: theme.surface }]}>
            <Icon name="wifi.exclamationmark" size={20} color={theme.danger} />
            <View style={styles.flex}>
              <Text style={[styles.bannerTitle, { color: theme.text }]}>Not connected</Text>
              <Text style={[styles.bannerText, { color: theme.muted }]}>
                {IS_HOSTED_API
                  ? "Couldn't reach ToiletTime. Check your internet connection and try again."
                  : `Couldn't reach ${API_URL}. Make sure the server is running on the same Wi-Fi.`}
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
        {selectedPlace && (
          <PlaceCard place={selectedPlace} origin={userLocation} onRate={() => ratePlace(selectedPlace)} />
        )}
        <View style={styles.actionRow}>
          <RoundButton icon="list.bullet" label="List" onPress={() => setList({ open: true, focusSearch: false })} />
          <Button title="Add Restroom" icon="plus" onPress={() => startAdd()} style={[styles.flex, styles.shadow]} />
          <RoundButton icon="location.fill" label="My location" onPress={locateMe} />
        </View>
        {!selected && !selectedPlace && !loadError && (
          <View style={[styles.hint, { backgroundColor: theme.surface }]}>
            <Text style={[styles.hintText, { color: theme.textSecondary }]}>
              {zoomedOut
                ? 'Zoom in to see restaurants, stores and restrooms'
                : 'Tap a place to rate its restroom, or touch and hold to add one'}
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
          selectRestroom(id);
          focusOn(r);
          setDetailId(id);
        }}
      />

      <DetailSheet id={detailId} origin={userLocation} onClose={() => setDetailId(null)} onChanged={load} />

      <AccountSheet
        visible={account.open}
        reason={account.reason}
        onClose={() => setAccount((a) => ({ ...a, open: false }))}
        onDismiss={() => {
          // Continue to the add sheet once the account sheet has finished closing.
          const request = addAfterSignIn.current;
          addAfterSignIn.current = null;
          if (request && user) setAddRequest(request);
        }}
      />

      <AddSheet
        request={addRequest}
        onClose={() => setAddRequest(null)}
        onCreated={(created) => {
          setAddRequest(null);
          load();
          selectRestroom(created.id);
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

const PlacePin = memo(function PlacePin({
  place,
  selected,
  onPress,
}: {
  place: Place;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const restroom = place.isRestroom;
  return (
    <Marker
      key={`${place.osmId}-${selected}-${theme.dark}`}
      coordinate={{ latitude: place.lat, longitude: place.lng }}
      onPress={onPress}
      tracksViewChanges={false}
      anchor={{ x: 0.5, y: 0.5 }}
      zIndex={selected ? 9 : 0}
      accessibilityLabel={`${place.name}, not rated yet`}
    >
      <View
        style={[
          styles.placePin,
          selected && styles.placePinSelected,
          { backgroundColor: restroom ? theme.brand : theme.surface, borderColor: restroom ? '#fff' : theme.brand },
        ]}
      >
        <Icon name={TYPE_ICONS[place.type]} size={selected ? 17 : 13} color={restroom ? theme.onBrand : theme.brand} />
      </View>
    </Marker>
  );
});

function PlaceCard({ place, origin, onRate }: { place: Place; origin: LatLng | null; onRate: () => void }) {
  const theme = useTheme();
  const distance = origin
    ? formatDistance(distanceMeters(origin, { latitude: place.lat, longitude: place.lng }))
    : null;
  const facts = [
    place.accessible && 'Accessible',
    place.babyChanging && 'Baby changing',
    !place.free && 'Customers only',
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <View style={[styles.preview, styles.shadow, { backgroundColor: theme.surface }]}>
      <View style={[styles.placeIcon, { backgroundColor: theme.brandSoft }]}>
        <Icon name={TYPE_ICONS[place.type]} size={18} color={theme.brand} />
      </View>
      <View style={styles.flex}>
        <Text style={[styles.previewName, { color: theme.text }]} numberOfLines={1}>
          {place.name}
        </Text>
        <Text style={[styles.previewSub, { color: theme.muted }]} numberOfLines={1}>
          {[PLACE_TYPES[place.type], distance].filter(Boolean).join(' · ')}
        </Text>
        <Text style={[styles.previewSub, { color: theme.textSecondary }]} numberOfLines={1}>
          {facts ? `Not rated yet · ${facts}` : 'Not rated yet'}
        </Text>
      </View>
      <Button title="Rate" icon="star.fill" onPress={onRate} style={styles.rateButton} />
    </View>
  );
}

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
  divider: { width: StyleSheet.hairlineWidth, height: 24 },
  miniAvatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  miniAvatarText: { fontSize: 13, fontWeight: '700' },
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
  placePin: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placePinSelected: { width: 36, height: 36, borderRadius: 18, borderWidth: 2 },
  placeIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  rateButton: { height: 40, paddingHorizontal: 14, borderRadius: 12 },
});
