import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { StatusBar } from 'expo-status-bar';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Circle, Marker, type Region } from 'react-native-maps';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { API_URL, IS_HOSTED_API, api } from './src/api';
import { AuthProvider, useAuth } from './src/auth';
import { BlockedProvider } from './src/safety';
import { Avatar, Button, Icon, ScorePill, Stars, type SymbolName } from './src/components/ui';
import { distanceMeters, formatDistance } from './src/geo';
import { CharacterBadge } from './src/character/Character';
import { useRewards } from './src/character/rewards';
import { AccountSheet } from './src/screens/AccountSheet';
import { AddSheet, type AddRequest } from './src/screens/AddSheet';
import { DetailSheet } from './src/screens/DetailSheet';
import { ListSheet } from './src/screens/ListSheet';
import { formatRating, plural, ratingColor, useTheme } from './src/theme';
import { PLACE_TYPES, type Here, type LatLng, type Place, type PlaceType, type Restroom } from './src/types';
import { canReview, useVisitPings } from './src/visits';

const WORLD: Region = { latitude: 30, longitude: 0, latitudeDelta: 120, longitudeDelta: 180 };
/** Nearby places load once the map is zoomed in at least this far (degrees of latitude on screen). */
const PLACES_MAX_DELTA = 0.08;

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
        <BlockedProvider>
          <MapScreen />
        </BlockedProvider>
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
  const [fix, setFix] = useState<Here | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [list, setList] = useState<{ open: boolean; focusSearch: boolean }>({ open: false, focusSearch: false });
  const [detailId, setDetailId] = useState<string | null>(null);
  const [addRequest, setAddRequest] = useState<AddRequest | null>(null);
  const pendingDetail = useRef<string | null>(null);
  const { user, missing, visitRadiusM } = useAuth();
  const pendingRestroom = useRef<string | null>(null);
  const [account, setAccount] = useState<{ open: boolean; reason: string | null }>({ open: false, reason: null });
  const addAfterSignIn = useRef<AddRequest | null>(null);

  const [places, setPlaces] = useState<Place[]>([]);
  const [zoomedOut, setZoomedOut] = useState(true);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const placesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const placesRequest = useRef(0);
  const lastRegion = useRef<Region | null>(null);
  const [placesStatus, setPlacesStatus] = useState<'idle' | 'loading' | 'failed'>('idle');

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
    let watcher: Location.LocationSubscription | undefined;
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted' || cancelled) return;
      const pos = (await Location.getLastKnownPositionAsync()) ?? (await Location.getCurrentPositionAsync());
      const here = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      setUserLocation(here);
      setFix({ lat: here.latitude, lng: here.longitude, accuracy: pos.coords.accuracy ?? 50 });
      mapRef.current?.animateToRegion({ ...here, latitudeDelta: 0.03, longitudeDelta: 0.03 }, 600);
      // Keep your character on the map in step with where you are.
      watcher = await Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, distanceInterval: 15 }, (p) => {
        setUserLocation({ latitude: p.coords.latitude, longitude: p.coords.longitude });
        setFix({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? 50 });
      });
      if (cancelled) watcher.remove();
    })().catch(() => {});
    return () => {
      cancelled = true;
      watcher?.remove();
    };
  }, [load]);

  // Remember which restrooms you pass by, so you can rate them later today.
  const recentVisits = useVisitPings(!!user && !missing, fix, restrooms, places);
  // What you can rate right now: inside your circle, or somewhere you were in the last 24 hours.
  const reviewable = useMemo(() => {
    const ids = new Set<string>();
    for (const r of restrooms) if (canReview(r, fix, visitRadiusM, recentVisits)) ids.add(r.id);
    for (const p of places) if (canReview(p, fix, visitRadiusM, recentVisits)) ids.add(p.osmId);
    return ids;
  }, [restrooms, places, fix, visitRadiusM, recentVisits]);
  const { celebrate, closet } = useRewards();

  const closeAccount = useCallback(() => setAccount((a) => ({ ...a, open: false })), []);

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

  const loadPlaces = (region: Region, attempt = 0) => {
    lastRegion.current = region;
    if (placesTimer.current) clearTimeout(placesTimer.current);
    if (region.latitudeDelta > PLACES_MAX_DELTA) {
      setZoomedOut(true);
      return;
    }
    setZoomedOut(false);
    placesTimer.current = setTimeout(
      async () => {
        const half = (d: number) => Math.min(d / 2, 0.03);
        const bbox = {
          south: Math.max(-90, region.latitude - half(region.latitudeDelta)),
          north: Math.min(90, region.latitude + half(region.latitudeDelta)),
          west: Math.max(-180, region.longitude - half(region.longitudeDelta)),
          east: Math.min(180, region.longitude + half(region.longitudeDelta)),
        };
        const request = ++placesRequest.current;
        setPlacesStatus('loading');
        try {
          const result = await api.places(bbox);
          if (request !== placesRequest.current) return; // a newer map position already asked
          setPlacesStatus('idle');
          setPlaces((prev) => {
            // Keep places already on screen so pins don't flicker while panning.
            const byId = new Map(prev.map((p) => [p.osmId, p]));
            for (const p of result.places) byId.set(p.osmId, p);
            return [...byId.values()].slice(-800);
          });
        } catch {
          if (request !== placesRequest.current) return;
          // Try once more on our own (OpenStreetMap is sometimes busy), then let the user retry.
          if (attempt === 0) loadPlaces(region, 1);
          else setPlacesStatus('failed');
        }
      },
      attempt === 0 ? 450 : 3000,
    );
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
    if (user && !missing) return setAddRequest(request);
    // Finish signing in (or verifying, or picking a username) first, then continue to the add sheet.
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
        showsUserLocation={false}
        showsPointsOfInterests={false}
        showsCompass={false}
        userInterfaceStyle={theme.dark ? 'dark' : 'light'}
        onPress={(e) => {
          if (e.nativeEvent.action === 'marker-press') return;
          setSelectedId(null);
          setSelectedPlaceId(null);
        }}
        onLongPress={(e) => startAdd(e.nativeEvent.coordinate)}
        onRegionChangeComplete={(region) => loadPlaces(region)}
      >
        {userLocation && (
          <Circle
            center={userLocation}
            radius={visitRadiusM}
            strokeWidth={2}
            strokeColor={theme.dark ? 'rgba(127,209,176,0.85)' : 'rgba(15,61,62,0.6)'}
            fillColor={theme.dark ? 'rgba(127,209,176,0.14)' : 'rgba(15,61,62,0.10)'}
            zIndex={0}
          />
        )}
        {userLocation && <CharacterMarker coordinate={userLocation} />}
        {unratedPlaces.map((p) => (
          <PlacePin
            key={p.osmId}
            place={p}
            selected={p.osmId === selectedPlaceId}
            reviewable={reviewable.has(p.osmId)}
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
            reviewable={reviewable.has(r.id)}
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
            accessibilityLabel={user ? `Profile, signed in as ${user.username ?? user.email}` : 'Sign in'}
          >
            {user ? (
              <Avatar url={user.avatarUrl} name={user.username} size={30} color={user.markerColor} />
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
        {selected && (
          <PreviewCard
            restroom={selected}
            origin={userLocation}
            reviewable={reviewable.has(selected.id)}
            radius={visitRadiusM}
            onPress={() => setDetailId(selected.id)}
          />
        )}
        {selectedPlace && (
          <PlaceCard
            place={selectedPlace}
            origin={userLocation}
            reviewable={reviewable.has(selectedPlace.osmId)}
            radius={visitRadiusM}
            onRate={() => ratePlace(selectedPlace)}
          />
        )}
        <View style={styles.actionRow}>
          <RoundButton icon="list.bullet" label="List" onPress={() => setList({ open: true, focusSearch: false })} />
          <Button title="Add Restroom" icon="plus" onPress={() => startAdd()} style={[styles.flex, styles.shadow]} />
          <RoundButton icon="location.fill" label="My location" onPress={locateMe} />
        </View>
        {!selected && !selectedPlace && !loadError && (
          <Pressable
            disabled={placesStatus !== 'failed' || zoomedOut}
            onPress={() => lastRegion.current && loadPlaces(lastRegion.current)}
            style={[styles.hint, { backgroundColor: theme.surface }]}
          >
            {placesStatus === 'loading' && !zoomedOut && <ActivityIndicator size="small" />}
            <Text style={[styles.hintText, { color: theme.textSecondary }]}>
              {zoomedOut
                ? 'Zoom in to see restaurants, stores and restrooms'
                : placesStatus === 'failed'
                  ? "Couldn't load nearby places. Tap to retry."
                  : placesStatus === 'loading'
                    ? 'Finding nearby places…'
                    : reviewable.size > 0
                      ? `✓ ${plural(reviewable.size, 'place')} you can review right now`
                      : userLocation
                        ? `You can review places inside your ${formatDistance(visitRadiusM)} circle`
                        : 'Tap a place to rate its restroom, or touch and hold to add one'}
            </Text>
          </Pressable>
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
        onClose={closeAccount}
        onOpenRestroom={(id) => {
          pendingRestroom.current = id;
          closeAccount();
        }}
        onDismiss={() => {
          // Continue once the account sheet has finished closing.
          const request = addAfterSignIn.current;
          addAfterSignIn.current = null;
          if (request && user && !missing) setAddRequest(request);
          const restroomId = pendingRestroom.current;
          pendingRestroom.current = null;
          if (restroomId) {
            const r = restrooms.find((x) => x.id === restroomId);
            if (r) {
              selectRestroom(r.id);
              focusOn(r);
            }
            setDetailId(restroomId);
          }
        }}
      />

      <AddSheet
        request={addRequest}
        onClose={() => setAddRequest(null)}
        onOpenExisting={(id) => {
          setAddRequest(null);
          setTimeout(() => {
            selectRestroom(id);
            setDetailId(id);
          }, 500);
        }}
        onCreated={(created) => {
          setAddRequest(null);
          // Let the sheet slide away before celebrating.
          setTimeout(() => celebrate(created.rewards), 450);
          load();
          selectRestroom(created.id);
          focusOn(created);
        }}
      />
      {closet}
    </View>
  );
}

/** A small green check on pins you can review right now. */
function ReviewableCheck() {
  return (
    <View style={styles.check}>
      <Icon name="checkmark" size={9} color="#fff" />
    </View>
  );
}

const RestroomPin = memo(function RestroomPin({
  restroom,
  selected,
  reviewable,
  onPress,
}: {
  restroom: Restroom;
  selected: boolean;
  reviewable: boolean;
  onPress: () => void;
}) {
  return (
    <Marker
      // Remount when selection or rating changes so the snapshot of the custom view refreshes.
      key={`${restroom.id}-${selected}-${restroom.rating}-${reviewable}`}
      coordinate={{ latitude: restroom.lat, longitude: restroom.lng }}
      onPress={onPress}
      tracksViewChanges={false}
      anchor={{ x: 0.5, y: 0.5 }}
      zIndex={selected ? 10 : 1}
      accessibilityLabel={`${restroom.name}, rated ${formatRating(restroom.rating)}${reviewable ? ', you can review it' : ''}`}
    >
      <View style={styles.pinWrap}>
        <View style={[styles.pin, selected && styles.pinSelected, { backgroundColor: ratingColor(restroom.rating) }]}>
          <Text style={[styles.pinText, selected && styles.pinTextSelected]}>{formatRating(restroom.rating)}</Text>
        </View>
        {reviewable && <ReviewableCheck />}
      </View>
    </Marker>
  );
});

/** You on the map: your Flush Buddy in a round badge, dressed in whatever you picked in the Closet. */
function CharacterMarker({ coordinate }: { coordinate: LatLng }) {
  const { user } = useAuth();
  const look = user?.character;
  return (
    <Marker
      // Remount when the outfit changes so the marker's snapshot refreshes.
      key={`me-${look ? Object.values(look).join('-') : 'default'}`}
      coordinate={coordinate}
      anchor={{ x: 0.5, y: 0.5 }}
      zIndex={20}
      // Just one marker, so it can afford to track changes (the drawing renders after the first frame).
      tracksViewChanges
      accessibilityLabel="You are here"
    >
      <View style={styles.character}>
        <CharacterBadge character={look} size={66} />
      </View>
    </Marker>
  );
}

const PlacePin = memo(function PlacePin({
  place,
  selected,
  reviewable,
  onPress,
}: {
  place: Place;
  selected: boolean;
  reviewable: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const restroom = place.isRestroom;
  return (
    <Marker
      key={`${place.osmId}-${selected}-${theme.dark}-${reviewable}`}
      coordinate={{ latitude: place.lat, longitude: place.lng }}
      onPress={onPress}
      tracksViewChanges={false}
      anchor={{ x: 0.5, y: 0.5 }}
      zIndex={selected ? 9 : 0}
      accessibilityLabel={`${place.name}, not rated yet${reviewable ? ', you can review it' : ''}`}
    >
      <View style={styles.pinWrap}>
        <View
          style={[
            styles.placePin,
            selected && styles.placePinSelected,
            { backgroundColor: restroom ? theme.brand : theme.surface, borderColor: restroom ? '#fff' : theme.brand },
          ]}
        >
          <Icon name={TYPE_ICONS[place.type]} size={selected ? 17 : 13} color={restroom ? theme.onBrand : theme.brand} />
        </View>
        {reviewable && <ReviewableCheck />}
      </View>
    </Marker>
  );
});

/** Under a card: whether you can review this place now. */
function ReviewStatus({ reviewable, radius }: { reviewable: boolean; radius: number }) {
  const theme = useTheme();
  return (
    <Text style={[styles.previewSub, { color: reviewable ? '#1d7a5c' : theme.muted, fontWeight: reviewable ? '600' : '400' }]} numberOfLines={1}>
      {reviewable ? '✓ You can review this' : `Get within ${formatDistance(radius)} to review`}
    </Text>
  );
}

function PlaceCard({
  place,
  origin,
  reviewable,
  radius,
  onRate,
}: {
  place: Place;
  origin: LatLng | null;
  reviewable: boolean;
  radius: number;
  onRate: () => void;
}) {
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
          {facts ? `Not rated yet · ${facts}` : 'Not rated yet · Be the first! 🚩'}
        </Text>
        <ReviewStatus reviewable={reviewable} radius={radius} />
        <Text style={[styles.credit, { color: theme.muted }]}>Place data © OpenStreetMap contributors</Text>
      </View>
      <Button title="Rate" icon="star.fill" onPress={onRate} style={styles.rateButton} />
    </View>
  );
}

function PreviewCard({
  restroom,
  origin,
  reviewable,
  radius,
  onPress,
}: {
  restroom: Restroom;
  origin: LatLng | null;
  reviewable: boolean;
  radius: number;
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
        <ReviewStatus reviewable={reviewable} radius={radius} />
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
  pinWrap: { padding: 6 },
  check: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#1d7a5c',
    borderWidth: 1.5,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  character: {
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, padding: 14 },
  bannerTitle: { fontSize: 15, fontWeight: '600' },
  bannerText: { fontSize: 13, marginTop: 2 },
  bannerAction: { fontSize: 15, fontWeight: '600' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, gap: 10 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  round: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'center',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 5,
    opacity: 0.92,
  },
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
  credit: { fontSize: 10, marginTop: 3 },
  rateButton: { height: 40, paddingHorizontal: 14, borderRadius: 12 },
});
