import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError, api } from '../api';
import { useAuth } from '../auth';
import { ReviewFields, isReviewComplete } from '../components/ReviewFields';
import { Avatar, Button, Icon, Separator, SheetHeader, Stars, type SymbolName } from '../components/ui';
import { distanceMeters, formatDistance } from '../geo';
import { formatRating, plural, useTheme } from '../theme';
import { AccountSheet } from './AccountSheet';
import { PLACE_TYPES, emptyReview, type LatLng, type RestroomDetail, type Review } from '../types';

interface Props {
  id: string | null;
  origin: LatLng | null;
  onClose: () => void;
  onChanged: () => void;
}

export function DetailSheet({ id, origin, onClose, onChanged }: Props) {
  // Keep showing the last restroom while the sheet animates closed.
  const [shownId, setShownId] = useState(id);
  if (id && id !== shownId) setShownId(id);

  return (
    <Modal visible={!!id} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {shownId && <DetailContent key={shownId} id={shownId} origin={origin} onClose={onClose} onChanged={onChanged} />}
    </Modal>
  );
}

function DetailContent({ id, origin, onClose, onChanged }: Props & { id: string }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [detail, setDetail] = useState<RestroomDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [draft, setDraft] = useState(emptyReview);
  const [submitting, setSubmitting] = useState(false);
  const { user, missing, expire } = useAuth();
  const [accountOpen, setAccountOpen] = useState(false);
  const writeAfterSignIn = useRef(false);
  const myReview = user ? detail?.reviews.find((r) => r.userId === user.id) : undefined;

  const beginWriting = () => {
    setDraft(
      myReview
        ? {
            overall: myReview.overall,
            cleanliness: myReview.cleanliness,
            supplies: myReview.supplies,
            privacy: myReview.privacy,
            comment: myReview.comment,
          }
        : emptyReview(),
    );
    setWriting(true);
  };

  const startReview = () => {
    if (user && !missing) return beginWriting();
    writeAfterSignIn.current = true;
    setAccountOpen(true);
  };

  const load = useCallback(
    () =>
      api.get(id).then(
        (d) => {
          setDetail(d);
          setError(null);
        },
        (e: Error) => setError(e.message),
      ),
    [id],
  );

  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    setSubmitting(true);
    try {
      await api.review(id, draft);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setWriting(false);
      setDraft(emptyReview());
      await load();
      onChanged();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        await expire();
        setWriting(false);
        Alert.alert('Please sign in again', 'Your session has ended. Sign in to post your review.');
      } else {
        Alert.alert("Couldn't post review", (e as Error).message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const openDirections = () => {
    if (!detail) return;
    const q = encodeURIComponent(detail.name);
    const at = `${detail.lat},${detail.lng}`;
    Linking.openURL(
      Platform.OS === 'ios'
        ? `https://maps.apple.com/?daddr=${at}&q=${q}`
        : `https://www.google.com/maps/dir/?api=1&destination=${at}`,
    );
  };

  const header = writing ? (
    <SheetHeader
      title={myReview ? 'Edit Your Review' : 'Write a Review'}
      left={{ label: 'Cancel', onPress: () => setWriting(false) }}
      right={{ label: 'Post', onPress: submit, bold: true, disabled: !isReviewComplete(draft), loading: submitting }}
    />
  ) : (
    <SheetHeader right={{ label: 'Done', onPress: onClose, bold: true }} />
  );

  return (
    <View style={[styles.container, { backgroundColor: writing ? theme.background : theme.surface }]}>
      {header}
      {!detail ? (
        <View style={styles.center}>
          {error ? (
            <>
              <Text style={[styles.errorText, { color: theme.textSecondary }]}>{error}</Text>
              <Button title="Try again" variant="secondary" onPress={load} />
            </>
          ) : (
            <ActivityIndicator />
          )}
        </View>
      ) : writing ? (
        <ScrollView
          contentContainerStyle={{ paddingTop: 20, paddingBottom: insets.bottom + 24 }}
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets
        >
          <Text style={[styles.writingFor, { color: theme.muted }]}>{detail.name}</Text>
          <ReviewFields value={draft} onChange={setDraft} />
          <View style={styles.writeFooter}>
            <Button
              title={myReview ? 'Update Review' : 'Post Review'}
              icon="checkmark"
              onPress={submit}
              loading={submitting}
              disabled={!isReviewComplete(draft)}
            />
          </View>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
          <Text style={[styles.kicker, { color: theme.muted }]}>{PLACE_TYPES[detail.type] ?? detail.type}</Text>
          <Text style={[styles.title, { color: theme.text }]}>{detail.name}</Text>
          <AddressLine detail={detail} origin={origin} />

          <View style={styles.actions}>
            <Button
              title="Directions"
              icon="arrow.triangle.turn.up.right.diamond.fill"
              onPress={openDirections}
              style={styles.flex}
            />
            <Button
              title={myReview ? 'Edit Review' : 'Review'}
              icon="square.and.pencil"
              variant="secondary"
              onPress={startReview}
              style={styles.flex}
            />
          </View>

          <Summary detail={detail} />

          <View style={styles.amenities}>
            <Amenity on={detail.free} yes="Free to use" no="Paying customers only" />
            <Amenity on={detail.accessible} yes="Wheelchair accessible" no="Not wheelchair accessible" />
            <Amenity on={detail.babyChanging} yes="Baby changing station" no="No baby changing station" />
          </View>

          <Text style={[styles.sectionTitle, { color: theme.text }]}>Reviews</Text>
          {detail.reviews.length === 0 ? (
            <Text style={[styles.emptyReviews, { color: theme.muted }]}>No reviews yet. Be the first to rate it.</Text>
          ) : (
            detail.reviews.map((r, i) => (
              <View key={r.id}>
                {i > 0 && <Separator inset={0} />}
                <ReviewItem
                  review={r}
                  mine={!!user && r.userId === user.id}
                  onDelete={() =>
                    Alert.alert('Delete your review?', 'This removes your rating and comment.', [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Delete',
                        style: 'destructive',
                        onPress: async () => {
                          try {
                            await api.deleteReview(r.id);
                            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                            await load();
                            onChanged();
                          } catch (e) {
                            Alert.alert("Couldn't delete review", (e as Error).message);
                          }
                        },
                      },
                    ])
                  }
                />
              </View>
            ))
          )}
        </ScrollView>
      )}
      <AccountSheet
        visible={accountOpen}
        reason="Sign in to rate this restroom. Your review is saved to your account."
        onClose={() => setAccountOpen(false)}
        onDismiss={() => {
          if (writeAfterSignIn.current && user && !missing) beginWriting();
          writeAfterSignIn.current = false;
        }}
      />
    </View>
  );
}

function AddressLine({ detail, origin }: { detail: RestroomDetail; origin: LatLng | null }) {
  const theme = useTheme();
  const address = [detail.address, detail.city, detail.country].filter(Boolean).join(', ');
  const distance = origin
    ? formatDistance(distanceMeters(origin, { latitude: detail.lat, longitude: detail.lng }))
    : null;
  if (!address && !distance) return null;
  return (
    <Text style={[styles.address, { color: theme.textSecondary }]}>
      {[distance && `${distance} away`, address].filter(Boolean).join(' · ')}
    </Text>
  );
}

function Summary({ detail }: { detail: RestroomDetail }) {
  const theme = useTheme();
  const bars: [string, number | null][] = [
    ['Cleanliness', detail.cleanliness],
    ['Supplies', detail.supplies],
    ['Privacy', detail.privacy],
  ];
  return (
    <View style={[styles.summary, { backgroundColor: theme.surfaceAlt }]}>
      <View style={styles.summaryLeft}>
        <Text style={[styles.bigScore, { color: theme.text }]}>{formatRating(detail.rating)}</Text>
        <Stars value={detail.rating} size={13} />
        <Text style={[styles.small, { color: theme.muted }]}>{plural(detail.reviewCount, 'review')}</Text>
      </View>
      <View style={styles.bars}>
        {bars.map(([label, value]) => (
          <View key={label} style={styles.barRow}>
            <Text style={[styles.barLabel, { color: theme.textSecondary }]}>{label}</Text>
            <View style={[styles.track, { backgroundColor: theme.separator }]}>
              <View style={[styles.fill, { width: `${((value ?? 0) / 5) * 100}%`, backgroundColor: theme.brand }]} />
            </View>
            <Text style={[styles.barValue, { color: theme.text }]}>{formatRating(value)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function Amenity({ on, yes, no }: { on: boolean; yes: string; no: string }) {
  const theme = useTheme();
  const icon: SymbolName = on ? 'checkmark.circle.fill' : 'xmark.circle';
  return (
    <View style={styles.amenity}>
      <Icon name={icon} size={18} color={on ? '#1d7a5c' : theme.muted} />
      <Text style={[styles.amenityText, { color: on ? theme.text : theme.muted }]}>{on ? yes : no}</Text>
    </View>
  );
}

function ReviewItem({ review, mine, onDelete }: { review: Review; mine: boolean; onDelete: () => void }) {
  const theme = useTheme();
  const date = new Date(review.createdAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return (
    <View style={styles.review}>
      <View style={styles.reviewTop}>
        <Avatar url={review.authorAvatarUrl} name={review.author} size={34} />
        <View style={styles.flex}>
          <Text style={[styles.reviewAuthor, { color: theme.text }]}>
            {review.author}
            {mine && <Text style={{ color: theme.brand }}> · You</Text>}
          </Text>
          <Text style={[styles.small, { color: theme.muted }]}>{date}</Text>
        </View>
        <Stars value={review.overall} />
      </View>
      <Text style={[styles.small, { color: theme.muted }]}>
        Cleanliness {review.cleanliness} · Supplies {review.supplies} · Privacy {review.privacy}
      </Text>
      {!!review.comment && <Text style={[styles.reviewBody, { color: theme.textSecondary }]}>{review.comment}</Text>}
      {mine && (
        <Pressable onPress={onDelete} hitSlop={8} style={styles.deleteReview} accessibilityRole="button">
          <Icon name="trash" size={14} color={theme.danger} />
          <Text style={[styles.small, { color: theme.danger }]}>Delete my review</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 },
  errorText: { fontSize: 15, textAlign: 'center' },
  content: { paddingHorizontal: 20, paddingTop: 8 },
  flex: { flex: 1 },
  kicker: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { fontSize: 28, fontWeight: '700', letterSpacing: -0.4, marginTop: 4 },
  address: { fontSize: 15, marginTop: 6, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  summary: { flexDirection: 'row', gap: 20, alignItems: 'center', borderRadius: 14, padding: 16, marginTop: 20 },
  summaryLeft: { alignItems: 'flex-start', gap: 4 },
  bigScore: { fontSize: 44, fontWeight: '700', letterSpacing: -1, fontVariant: ['tabular-nums'] },
  small: { fontSize: 13 },
  bars: { flex: 1, gap: 9 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barLabel: { fontSize: 13, width: 78 },
  track: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
  barValue: { fontSize: 13, fontWeight: '600', width: 26, textAlign: 'right', fontVariant: ['tabular-nums'] },
  amenities: { gap: 10, marginTop: 20 },
  amenity: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  amenityText: { fontSize: 16 },
  sectionTitle: { fontSize: 20, fontWeight: '700', marginTop: 28, marginBottom: 4 },
  emptyReviews: { fontSize: 15, paddingVertical: 12 },
  review: { paddingVertical: 14, gap: 6 },
  reviewTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontWeight: '600', fontSize: 13 },
  reviewAuthor: { fontSize: 16, fontWeight: '600' },
  reviewBody: { fontSize: 16, lineHeight: 22 },
  writeFooter: { marginHorizontal: 16 },
  deleteReview: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, alignSelf: 'flex-start' },
  writingFor: { fontSize: 15, textAlign: 'center', marginBottom: 16, marginHorizontal: 32 },
});
