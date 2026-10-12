import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError, api, searchPlaces, type PlaceResult } from '../api';
import { useAuth } from '../auth';
import { ReviewFields, isReviewComplete } from '../components/ReviewFields';
import { Chip, Field, Icon, Section, Separator, SheetHeader } from '../components/ui';
import { useTheme } from '../theme';
import { PLACE_TYPES, emptyReview, type LatLng, type PlaceType, type RestroomDetail } from '../types';

interface Props {
  coords: LatLng | null;
  onClose: () => void;
  onCreated: (restroom: RestroomDetail) => void;
}

type Details = ReturnType<typeof blankDetails>;

const blankDetails = () => ({
  name: '',
  type: 'restaurant' as PlaceType,
  address: '',
  city: '',
  country: '',
  free: true,
  accessible: false,
  babyChanging: false,
});

export function AddSheet({ coords, onClose, onCreated }: Props) {
  // A fresh form for every pin drop; keep the last one rendered while the sheet animates closed.
  const [shown, setShown] = useState(coords);
  if (coords && coords !== shown) setShown(coords);

  return (
    <Modal visible={!!coords} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {shown && (
        <AddForm key={`${shown.latitude},${shown.longitude}`} start={shown} onClose={onClose} onCreated={onCreated} />
      )}
    </Modal>
  );
}

function AddForm({ start, onClose, onCreated }: Omit<Props, 'coords'> & { start: LatLng }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const [details, setDetails] = useState(blankDetails);
  const [position, setPosition] = useState<LatLng>(start);
  const [review, setReview] = useState(emptyReview);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { expire } = useAuth();
  const trimmedQuery = query.trim();
  const visibleResults = trimmedQuery.length >= 3 ? results : [];

  const set = <K extends keyof Details>(key: K, v: Details[K]) => setDetails((d) => ({ ...d, [key]: v }));

  // Prefill the address from the dropped pin.
  useEffect(() => {
    fillAddressFrom(start, false);
  }, [start]);

  // Debounced business search near the pin.
  useEffect(() => {
    if (trimmedQuery.length < 3) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const hits = await searchPlaces(trimmedQuery, position);
        if (!cancelled) setResults(hits);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmedQuery, position]);

  async function fillAddressFrom(point: LatLng, overwrite: boolean) {
    try {
      const [place] = await Location.reverseGeocodeAsync(point);
      if (!place) return;
      setDetails((d) => ({
        ...d,
        address: overwrite || !d.address ? [place.streetNumber, place.street].filter(Boolean).join(' ') : d.address,
        city: overwrite || !d.city ? (place.city ?? place.subregion ?? '') : d.city,
        country: overwrite || !d.country ? (place.country ?? '') : d.country,
      }));
    } catch {
      // Reverse geocoding is best effort; the address can be typed in.
    }
  }

  const pickResult = (r: PlaceResult) => {
    Haptics.selectionAsync();
    setDetails((d) => ({ ...d, name: r.name, type: r.type, address: r.address, city: r.city, country: r.country }));
    setPosition({ latitude: r.lat, longitude: r.lng });
    mapRef.current?.animateToRegion(
      { latitude: r.lat, longitude: r.lng, latitudeDelta: 0.004, longitudeDelta: 0.004 },
      250,
    );
    setQuery('');
    setResults([]);
  };

  const canPublish = !!details.name.trim() && isReviewComplete(review);

  const publish = async () => {
    setSubmitting(true);
    try {
      const created = await api.create({ ...details, lat: position.latitude, lng: position.longitude, review });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onCreated(created);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        await expire();
        Alert.alert('Please sign in again', 'Your session has ended. Sign in, then add the restroom again.');
        onClose();
        return;
      }
      Alert.alert("Couldn't add restroom", (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <SheetHeader
        title="Add Restroom"
        left={{ label: 'Cancel', onPress: onClose }}
        right={{ label: 'Publish', onPress: publish, bold: true, disabled: !canPublish, loading: submitting }}
      />
      <ScrollView
        contentContainerStyle={{ paddingTop: 20, paddingBottom: insets.bottom + 24 }}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <Section title="Find the business" footer="Search to fill in the details automatically, or enter them below.">
          <View style={styles.searchRow}>
            <Icon name="magnifyingglass" size={16} color={theme.muted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search nearby businesses"
              placeholderTextColor={theme.muted}
              clearButtonMode="while-editing"
              autoCorrect={false}
              style={[styles.searchInput, { color: theme.text }]}
            />
            {searching && <ActivityIndicator />}
          </View>
          {visibleResults.map((r) => (
            <View key={r.id}>
              <Separator />
              <Pressable
                onPress={() => pickResult(r)}
                style={({ pressed }) => [styles.result, pressed && { backgroundColor: theme.surfaceAlt }]}
              >
                <Text style={[styles.resultName, { color: theme.text }]} numberOfLines={1}>
                  {r.name}
                </Text>
                <Text style={[styles.resultSub, { color: theme.muted }]} numberOfLines={1}>
                  {r.subtitle}
                </Text>
              </Pressable>
            </View>
          ))}
        </Section>

        <Section title="Location" footer="Drag the pin to the restroom's exact location.">
          <MapView
            ref={mapRef}
            style={styles.map}
            initialRegion={{ ...position, latitudeDelta: 0.004, longitudeDelta: 0.004 }}
            scrollEnabled={false}
            rotateEnabled={false}
            pitchEnabled={false}
          >
            <Marker
              coordinate={position}
              draggable
              pinColor={theme.brand}
              onDragEnd={(e) => {
                const point = e.nativeEvent.coordinate;
                setPosition(point);
                fillAddressFrom(point, true);
              }}
            />
          </MapView>
        </Section>

        <Section title="Details">
          <Field
            label="Name"
            placeholder="Required"
            value={details.name}
            onChangeText={(t) => set('name', t)}
            maxLength={100}
          />
          <Separator />
          <Field label="Address" value={details.address} onChangeText={(t) => set('address', t)} maxLength={200} />
          <Separator />
          <Field label="City" value={details.city} onChangeText={(t) => set('city', t)} maxLength={80} />
          <Separator />
          <Field label="Country" value={details.country} onChangeText={(t) => set('country', t)} maxLength={80} />
        </Section>

        <Text style={[styles.label, { color: theme.muted }]}>TYPE OF PLACE</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {(Object.keys(PLACE_TYPES) as PlaceType[]).map((t) => (
            <Chip key={t} label={PLACE_TYPES[t]} selected={details.type === t} onPress={() => set('type', t)} />
          ))}
        </ScrollView>

        <Section title="Amenities">
          <Toggle label="Free to use" value={details.free} onChange={(v) => set('free', v)} />
          <Separator />
          <Toggle label="Wheelchair accessible" value={details.accessible} onChange={(v) => set('accessible', v)} />
          <Separator />
          <Toggle label="Baby changing station" value={details.babyChanging} onChange={(v) => set('babyChanging', v)} />
        </Section>

        <ReviewFields value={review} onChange={setReview} />
      </ScrollView>
    </View>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  const theme = useTheme();
  return (
    <View style={styles.toggle}>
      <Text style={[styles.toggleLabel, { color: theme.text }]}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: '#1d7a5c' }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, minHeight: 46 },
  searchInput: { flex: 1, fontSize: 17, paddingVertical: 12 },
  result: { paddingHorizontal: 16, paddingVertical: 10, gap: 2 },
  resultName: { fontSize: 16, fontWeight: '500' },
  resultSub: { fontSize: 13 },
  map: { height: 180 },
  label: { fontSize: 13, marginLeft: 32, marginBottom: 7 },
  chips: { gap: 8, paddingHorizontal: 16, paddingBottom: 24 },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    minHeight: 46,
  },
  toggleLabel: { fontSize: 17 },
});
